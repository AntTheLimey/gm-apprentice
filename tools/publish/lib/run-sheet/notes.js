'use strict';
// The run sheet's view of a vault: every note by path, how a [[link]] resolves, and the sections a
// note holds. Read-only. A read that fails throws (vault-reader.js); the one soft answer is a note
// whose frontmatter does not parse, which keeps its name, reads as `{}`, and is marked unreadable.

const path = require('node:path');
const { scanAllNotes, scanAttachments } = require('../scanner');
const { parseNote } = require('../frontmatter');
const { nameList, gmAliasList, portraitBasename } = require('../processor');
const { canonicalNfc, nfcLookupTable } = require('../unicode');
const { readSettings } = require('../settings/read');
const { readerFrom } = require('../vault-reader');

const LEFT_OUT = new Set(['_Templates', '_midwife', '_meta', '_archive', '_QA', 'node_modules']);

const toPosix = (p) => p.split(path.sep).join('/');
const isLeftOut = (rel) => rel.split('/').slice(0, -1).some((seg) => seg.startsWith('.') || LEFT_OUT.has(seg));
const stemOf = (rel) => path.posix.basename(rel, path.posix.extname(rel));

function wikiTarget(value) {
  const m = /\[\[([^\]|#]+)/.exec(String(value || ''));
  if (m) return m[1].trim();
  return String(value || '').split(/[|#]/)[0].trim();
}

// The heading lines of a body: [{ level, title, start, end }] (start: line of the heading), fences skipped.
function headings(lines) {
  const out = [];
  let fence = null;
  lines.forEach((line, i) => {
    const f = /^\s*(```|~~~)/.exec(line);
    if (f) { fence = fence === null ? f[1] : (fence === f[1] ? null : fence); return; }
    if (fence) return;
    const m = /^(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/.exec(line);
    if (m) out.push({ level: m[1].length, title: m[2].trim(), at: i });
  });
  return out;
}

// The text under the first heading of `level` titled `title`, to the next heading of that level or higher.
function sectionOf(body, title, level, from = 0, to = Infinity) {
  const lines = body.split('\n');
  const heads = headings(lines);
  const want = canonicalNfc(title).trim().toLowerCase();
  const i = heads.findIndex((h) => h.at >= from && h.at < to && h.level === level && canonicalNfc(h.title).toLowerCase() === want);
  if (i < 0) return null;
  const next = heads.slice(i + 1).find((h) => h.level <= level);
  const end = next ? next.at : lines.length;
  return { text: lines.slice(heads[i].at + 1, end).join('\n').trim(), start: heads[i].at, end };
}

function buildIndex(vaultPath, { deps } = {}) {
  const rd = readerFrom(deps);
  const warnings = [];
  const seen = new Set();
  const warn = (kind, note, text) => {
    const key = JSON.stringify([kind, note, text]);
    if (seen.has(key)) return;
    seen.add(key);
    warnings.push({ kind, note, text });
  };

  const pages = [];
  // The scan reads every note once; a file it cannot read is answered empty there, so the walk goes on,
  // and is read (and fails) again below, where it is marked unreadable. A folder that cannot be listed still throws.
  const scanDeps = {
    ...(deps || {}),
    readFile: (p) => { try { return rd.readFile(p); } catch { return ''; } },
    // A sub-folder that cannot be listed is warned about and left out; the vault root still throws.
    readdir: (dir) => {
      try { return rd.readdir(dir); } catch (err) {
        const rel = toPosix(path.relative(vaultPath, dir));
        if (!rel) throw err;
        warn('unreadable-folder', rel, `could not be listed: ${String(err.message).split('\n')[0]}`);
        return [];
      }
    },
  };
  for (const page of scanAllNotes(vaultPath, scanDeps)) {
    const rel = toPosix(path.relative(vaultPath, page.sourcePath));
    if (isLeftOut(rel)) continue;
    let text = null;
    let fm = {};
    let body = '';
    let unreadable = false;
    // A file that cannot be read keeps its name, like one whose frontmatter does not parse.
    try { text = rd.readFile(page.sourcePath).replace(/\r\n?/g, '\n'); } catch (err) {
      unreadable = true;
      warn('unreadable-note', rel, `could not be read: ${String(err.message).split('\n')[0]}`);
    }
    if (text !== null) try {
      const parsed = parseNote(text);
      fm = parsed.data || {};
      body = parsed.content;
    } catch (err) {
      unreadable = true;
      body = text;
      warn('unreadable-frontmatter', rel, `frontmatter does not parse: ${String(err.message).split('\n')[0]}`);
    }
    pages.push({ path: rel, stem: stemOf(rel), fm, body, unreadable });
  }
  pages.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const byPath = new Map(pages.map((p) => [p.path, p]));

  // Resolve order as buildLinkMap: file name stem (non-superseded first, a superseded one redirecting
  // to its superseded_by), vault path, aliases, then gm_aliases.
  const table = Object.create(null);
  const stems = new Map();
  for (const p of pages) {
    const k = canonicalNfc(p.stem);
    if (!stems.has(k)) stems.set(k, []);
    stems.get(k).push(p);
  }
  const ambiguous = new Set();
  const superseded = (p) => String(p.fm.canon_status || '').toUpperCase() === 'SUPERSEDED';
  for (const [k, group] of stems) {
    const live = group.filter((p) => !superseded(p));
    if (live.length > 1) {
      warn('ambiguous-name', null, `${group[0].stem} names ${live.length} notes (${live.map((p) => p.path).join(', ')}); link them by path`);
      ambiguous.add(k);
      continue;
    }
    if (live.length === 1) table[k] = live[0].path;
  }
  for (const [k, group] of stems) {
    if (k in table || !group.some(superseded)) continue;
    const p = group.find(superseded);
    const target = p.fm.superseded_by ? canonicalNfc(wikiTarget(p.fm.superseded_by)) : null;
    table[k] = (target && table[target]) || p.path;
  }
  for (const p of pages) {
    const k = canonicalNfc(p.path.replace(/\.md$/i, ''));
    if (!(k in table)) table[k] = p.path;
  }
  for (const p of pages) {
    for (const a of [...nameList(p.fm.aliases), ...gmAliasList(p.fm)]) {
      const k = canonicalNfc(a);
      if (!(k in table) && !ambiguous.has(k)) table[k] = p.path;
    }
  }
  const lookup = nfcLookupTable(table);

  // Pictures: found lazily, once.
  let attachments = null;
  const attached = () => {
    if (attachments) return attachments;
    const settings = readSettings({ vaultPath, deps });
    // Settings values are nested by group: `vault.attachments` is values.vault.attachments.
    const values = settings.values || {};
    const dir = values.vault && values.vault.attachments;
    // The GM sees every portrait: the players' hide list does not apply, only the workspace
    // folders the index itself leaves out.
    attachments = scanAttachments({ vaultPath, attachmentsDir: dir, excludeDirs: [...LEFT_OUT] }, deps);
    return attachments;
  };

  const need = (p) => {
    const page = byPath.get(p);
    if (!page) throw new Error(`run sheet: no note at ${p}`);
    return page;
  };

  return {
    resolve(target) {
      if (target === null || target === undefined) return null;
      const key = canonicalNfc(wikiTarget(target)).replace(/\.md$/i, '');
      if (!key) return null;
      const hit = lookup[key];
      return typeof hit === 'string' ? hit : null;
    },
    read(p) {
      const page = need(p);
      return { fm: page.fm, body: page.body, unreadable: page.unreadable };
    },
    // `### title` inside the note's `## GM Notes`, or '' when it is not there.
    gmSection(p, title) {
      const body = need(p).body;
      const gm = sectionOf(body, 'GM Notes', 2);
      if (!gm) return '';
      const sub = sectionOf(body, title, 3, gm.start, gm.end);
      return sub ? sub.text : '';
    },
    section(p, title, level = 2) {
      const sec = sectionOf(need(p).body, title, level);
      return sec ? sec.text : '';
    },
    notes() { return pages.map((p) => p.path); },
    portrait(p) {
      const name = portraitBasename(need(p).fm);
      if (!name) return null;
      const hit = attached()[name];
      const rel = hit ? toPosix(path.relative(vaultPath, hit.sourcePath)) : null;
      return rel && !isLeftOut(rel) ? rel : null;
    },
    warnings,
  };
}

module.exports = { buildIndex };
