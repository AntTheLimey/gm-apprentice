'use strict';
// The run sheet's view of a vault: every note by path, how a [[link]] resolves, and the sections a
// note holds. Read-only. Only the vault root not listing throws. The soft answers, each with a
// warning in `warnings`: a note whose frontmatter does not parse, or a file that cannot be read,
// keeps its name, reads as `{}` and is marked unreadable; a sub-folder that cannot be listed is
// left out; pictures that cannot be listed give no portraits.

const path = require('node:path');
const { scanAllNotes, scanAttachments } = require('../scanner');
const { parseNote } = require('../frontmatter');
const { nameList, gmAliasList, portraitBasename } = require('../processor');
const { canonicalNfc, nfcLookupTable } = require('../unicode');
const { readSettings } = require('../settings/read');
const { readerFrom } = require('../vault-reader');
const { HEADING_LINE } = require('./plan-text');
const { WORKSPACE_FOLDERS } = require('../shared-lists');

// The folders the reader never indexes, matched in any case: housekeeping, and the plugin's workspace
// folders as every tool lists them (the ontology's workspace_folders, `_inbox` among them).
const LEFT_OUT_DIRS = ['_Templates', '_meta', '_archive', 'node_modules', ...WORKSPACE_FOLDERS];
const LEFT_OUT = new Set(LEFT_OUT_DIRS.map((d) => d.toLowerCase()));

const toPosix = (p) => p.split(path.sep).join('/');
const isLeftOut = (rel) => rel.split('/').slice(0, -1).some((seg) => seg.startsWith('.') || LEFT_OUT.has(seg.toLowerCase()));
const stemOf = (rel) => path.posix.basename(rel, path.posix.extname(rel));
// A name shown for a note with none of its own: its stem with underscores as spaces (`Harmonische_Wachter`).
const stemName = (rel) => stemOf(rel).replace(/_+/g, ' ').replace(/\s+/g, ' ').trim() || stemOf(rel);

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
    const m = HEADING_LINE.exec(line);
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
  // Notes in a folder the reader leaves out, by stem and by path without `.md`: a link to one says so.
  const excluded = new Set();
  const markExcluded = (rel) => {
    excluded.add(canonicalNfc(stemOf(rel)));
    excluded.add(canonicalNfc(rel.replace(/\.md$/i, '')));
  };
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
    if (isLeftOut(rel)) { markExcluded(rel); continue; }
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
    if (k in table || ambiguous.has(k) || !group.some(superseded)) continue;
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
  // Letter case aside, as a link is followed everywhere on the site (scanner.js buildLinkMap; #790).
  const lookup = nfcLookupTable(table, { foldCase: true });

  // Notes in dot folders (`.trash`): the scan never walks them, so they are listed only when a link
  // fails to resolve, once. `.git` and node_modules hold no notes of the GM's.
  let dotWalked = false;
  const walkDotFolders = () => {
    if (dotWalked) return;
    dotWalked = true;
    const walk = (dir, inDot) => {
      // Listed only to name excluded notes: a folder that cannot be listed here names none. The
      // scan already warned about any folder it needed and could not list.
      let entries;
      try { entries = rd.readdir(dir); } catch { return; }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        const dot = inDot || e.name.startsWith('.');
        if (e.isDirectory()) {
          // a dot folder can sit at any depth, so every folder is listed (names only)
          if (e.name !== '.git' && e.name !== 'node_modules') walk(full, dot);
        } else if (dot && e.isFile() && e.name.toLowerCase().endsWith('.md')) {
          markExcluded(toPosix(path.relative(vaultPath, full)));
        }
      }
    };
    walk(vaultPath, false);
  };

  // Pictures: found lazily, once. A picture folder that cannot be listed gives no portraits and a warning.
  let attachments = null;
  const attached = () => {
    if (attachments) return attachments;
    try {
      const settings = readSettings({ vaultPath, deps });
      // Settings values are nested by group: `vault.attachments` is values.vault.attachments.
      const values = settings.values || {};
      const dir = values.vault && values.vault.attachments;
      // The GM sees every portrait: the players' hide list does not apply, only the workspace
      // folders the index itself leaves out.
      attachments = scanAttachments({ vaultPath, attachmentsDir: dir, excludeDirs: LEFT_OUT_DIRS }, deps);
    } catch (err) {
      attachments = {};
      warn('unreadable-attachments', null, `the vault's pictures could not be listed (${String(err.message).split('\n')[0]}): the sheet shows no portraits`);
    }
    return attachments;
  };
  const keyOf = (target) => canonicalNfc(wikiTarget(target)).replace(/\.md$/i, '');

  const self = {
    resolve(target) {
      if (target === null || target === undefined) return null;
      const key = keyOf(target);
      if (!key) return null;
      const hit = lookup[key];
      return typeof hit === 'string' ? hit : null;
    },
    // True when the target names several notes and so resolves to none.
    isAmbiguous(target) {
      if (target === null || target === undefined || self.resolve(target) !== null) return false;
      return ambiguous.has(keyOf(target));
    },
    // Why `target` resolves to no note, as a warning's kind and text: it names several notes, it is a
    // note in a folder the reader skips, or it matches none. Null when it resolves.
    linkProblem(target) {
      const t = String(target == null ? '' : target).trim();
      if (!t || self.resolve(t) !== null) return null;
      if (self.isAmbiguous(t)) return { kind: 'ambiguous-link', text: `[[${t}]] names several notes in the vault: link it by path` };
      walkDotFolders();
      if (excluded.has(keyOf(t))) return { kind: 'excluded-note', text: `[[${t}]] is a note in a folder the reader skips (a dot or workspace folder)` };
      return { kind: 'missing-note', text: `[[${t}]] matches no note in the vault` };
    },
  };

  const need = (p) => {
    const page = byPath.get(p);
    if (!page) throw new Error(`run sheet: no note at ${p}`);
    return page;
  };

  return Object.assign(self, {
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
    // The item (or prop) note a loot line is about: the note its leading link names, else the note whose
    // name or alias opens the line, up to a `(`, a `,` or the end. Null when no item note does.
    itemOf(text) {
      const t = String(text == null ? '' : text).replace(/^[\s*_]+/, '');
      const isItem = (p) => {
        if (p === null || !byPath.has(p)) return false;
        const type = String(byPath.get(p).fm.type || '').trim().toLowerCase();
        return type === 'item' || type === 'prop';
      };
      const link = /^\[\[([^\]]+)\]\]/.exec(t);
      const lead = link ? link[1] : t.split(/[(,]/)[0].replace(/[\s*_.:;]+$/, '');
      const hit = lead ? self.resolve(lead) : null;
      return isItem(hit) ? hit : null;
    },
    has(p) { return typeof p === 'string' && byPath.has(p); },
    // The picture an embed names (`rook.png`, `Pictures/rook.png`), vault-relative, or null: one in the
    // pictures folder by its name, else a vault path that is there. Never a folder the reader skips.
    picture(name) {
      const n = String(name == null ? '' : name).trim().replace(/\\/g, '/').replace(/^\/+/, '');
      if (!n || !/\.(jpe?g|png|webp|gif|svg|avif)$/i.test(n) || n.split('/').includes('..')) return null;
      const hit = attached()[path.posix.basename(n)];
      let rel = hit ? toPosix(path.relative(vaultPath, hit.sourcePath)) : null;
      if (!rel && rd.exists(path.join(vaultPath, ...n.split('/')))) rel = n;
      return rel && !isLeftOut(rel) ? rel : null;
    },
    // The note's portrait picture, vault-relative, or null. A portrait the frontmatter names that no
    // picture the reader sees matches warns `no-portrait` on that note. `field` names another
    // picture field read the same way (a disguised NPC's `unmasked_portrait`).
    portrait(p, field = 'portrait') {
      // A picture written as a link (`[[rook.png]]`, `![[a/rook.png|200]]`) or as a list of one is that picture,
      // as reveal --unmask reads it.
      const raw = [need(p).fm[field]].flat(Infinity).filter((v) => typeof v === 'string' && v.trim());
      const one = raw.length === 1 ? raw[0].trim() : raw.length ? raw : null;
      const link = typeof one === 'string' ? /^!?\[\[([\s\S]*?)\]\]$/.exec(one) : null;
      const name = portraitBasename({ portrait: link ? link[1].split('|')[0].trim() : one });
      if (!name) return null;
      const hit = attached()[name];
      const rel = hit ? toPosix(path.relative(vaultPath, hit.sourcePath)) : null;
      if (rel && !isLeftOut(rel)) return rel;
      const lacks = field === 'portrait' ? 'no portrait on the sheet' : 'the Unmask has no face';
      warn('no-portrait', p, rel
        ? `its ${field} ${name} is in a folder the reader skips: ${lacks}`
        : `its ${field} ${name} matches no picture in the vault: ${lacks}`);
      return null;
    },
    warnings,
  });
}

module.exports = { buildIndex, stemOf, stemName };
