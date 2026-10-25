'use strict';

// The one plan of a site's props: which prop files ship, where, and which files they
// link. The build writes what this plans and the leak gate checks against the same plan,
// so the two can never disagree about what a prop put on the site.
//
// Every file is found by walking the folders one name at a time, comparing names in NFC
// and with their letter case (Cloudflare is case-sensitive, macOS is not), and every
// directory and file is real-pathed before it is read: a symlink that points out of the
// vault, the note's folder or the prop's folder is outside, and nothing outside is read.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { canonicalNfc } = require('../unicode');
const { isPropNote, propKindOf, propFileOf, propAddressOf, propStyleOf } = require('./note');
const { PROP_FILE_EXTS, addressKey, defaultPropAddress, addressShapeProblem } = require('./address');
const { cutHtml } = require('./html-cut');
const { within, realOrNull, findUnder } = require('./paths');
const { localRefs } = require('./links');
const { styleLoader } = require('./styles');

const MARKUP_EXTS = new Set(['.html', '.htm', '.svg']);
// What a prop page may pull in beside itself: styles, scripts, pictures and fonts. Never a
// page (a second hand-made page with Keeper parts of its own), a note, audio, video or PDF.
const LINKED_EXTS = new Set([
  '.css', '.js', '.mjs', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif', '.ico',
  '.woff2', '.woff', '.ttf', '.otf',
]);
const LINK_FIX = 'put the file beside the prop file and link it by a relative path';
const KIND_FIX = 'a prop page cannot carry this kind of file: a PDF can be published as its own prop (its own note with prop_file), a picture can take its place; otherwise leave it out (the site does not publish audio, video or other pages)';

function sha1(buf) {
  return crypto.createHash('sha1').update(buf).digest('hex');
}

// A markup file's or stylesheet's text, and the encoding it was read from when that is not
// UTF-8 (`was`). The site writes it as UTF-8, as hosts serve it: after a UTF-16 byte-order
// mark (a Word "Unicode" save) it is UTF-16, otherwise windows-1252 (an old Windows "Web page").
// A UTF-8 file's byte-order mark is kept, so its text writes back byte for byte.
const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
function textOf(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(bytes), was: 'UTF-16' };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(bytes), was: 'UTF-16' };
  try { return { text: UTF8.decode(bytes), was: null }; } catch (e) { return { text: new TextDecoder('windows-1252').decode(bytes), was: 'windows-1252' }; }
}

// A transcoded file's own charset declarations, now utf-8: a page's <meta charset> and
// http-equiv Content-Type, an SVG's XML declaration, a stylesheet's @charset.
function utf8Charset(text, ext) {
  if (ext === '.css') return text.replace(/^(\ufeff?@charset\s*["'])[^"']*/i, '$1utf-8');
  return text
    .replace(/^(\s*<\?xml\b[^>]*?\bencoding\s*=\s*["'])[^"']*/i, '$1utf-8')
    .replace(/<meta\b(?:"[^"]*"|'[^']*'|[^>"'])*>/gi, (tag) => tag.replace(/(\bcharset\s*=\s*["']?)[^"'\s;>/]+/i, '$1utf-8'));
}

function readOrError(p) {
  try { return { bytes: fs.readFileSync(p) }; } catch (e) { return { error: e.code || e.message }; }
}

// The spelling a link should have on the site: NFC, kept percent-encoded if it was.
function nfcSpelling(raw) {
  const fixed = canonicalNfc(raw);
  const cut = fixed.search(/[?#]/);
  const base = cut === -1 ? fixed : fixed.slice(0, cut);
  let plain;
  try { plain = decodeURIComponent(base); } catch { return fixed; }
  if (canonicalNfc(plain) === plain) return fixed;
  return encodeURI(canonicalNfc(plain)) + (cut === -1 ? '' : fixed.slice(cut));
}

// A relative path that stays at or below its folder, as posix segments; null if it climbs out.
function segmentsBelow(rel) {
  const p = String(rel).replace(/\\/g, '/');
  if (p.startsWith('/') || /^[a-z]:/i.test(p)) return null;
  const norm = path.posix.normalize(p);
  if (norm === '..' || norm.startsWith('../') || norm === '.' || norm === '') return null;
  return norm.split('/');
}

// `has()` says "inside the site's css/ folder"; the problem says "taken by the site's css/ folder".
function takerName(why) {
  return String(why).replace(/^inside /, '');
}

// The bytes the plan read for each planned file, so what is written is what was planned.
const BYTES = new WeakMap();
function bytesOf(entry) {
  return BYTES.get(entry) || null;
}

// A prop's page comes from, in order: its `prop_file` (published as it is; a `prop_style` beside it
// is not used, with a row); a container (`prop_kind: container`), a listing the tool makes, styled
// when it names a style; a `prop_style`, a page the tool makes from the note's words. A made prop
// has no source: its one file is `{ source: null, out: address, made }`, written by the build.
// `styles` loads a style by name; `plan.styles` lists the files of each style a shipping made prop uses.
//
// `cleanup: true` also plans, for a prop that does not ship but names a prop_address inside a
// kept folder, the files an earlier build would have written there (`keptCopies`). Nothing
// is claimed for them and they never ship: the build compares them with what is in the folder.
function planProps({ vaultPath, pages, relOf, ships, taken, cutKeeper, cleanup = false, styles = styleLoader({ vaultPath }) }) {
  const problems = [];
  const vaultReal = realOrNull(path.resolve(vaultPath));
  const problem = (rel, detail, fix) => problems.push({ rel, code: 'PROP_NOT_COPIED', severity: 'warning', detail, fix });

  const props = [];
  for (const page of pages) {
    const fm = page.sourceFrontmatter || page.frontmatter;
    if (!isPropNote(fm)) continue;
    const rel = canonicalNfc(relOf(page));
    const plan = {
      rel, page, ships: Boolean(ships(page)), kind: propKindOf(fm),
      // `shared`: outputs another prop's files already put there, with the same bytes. Written once, under that
      // prop; listed here so the leak gate counts the file as this prop's too.
      address: null, source: null, files: [], shared: [], hash: null, style: null, made: null,
    };
    props.push(plan);
    const propFile = propFileOf(fm);
    const styleName = propStyleOf(fm);
    const say = plan.ships ? problem : () => {};
    // Where a page the tool makes lands: as a prop file's would, with .html.
    const placeAt = (ext) => {
      const def = defaultPropAddress(rel, ext);
      const asked = propAddressOf(fm);
      const shape = asked === null ? null : addressShapeProblem(asked, ext);
      if (asked !== null && shape) {
        say(rel, `prop_address "${asked}" ${shape}; it is published at ${def}`, `write a path such as ${def}`);
      }
      plan._explicit = asked !== null && !shape;
      plan.address = plan._explicit ? canonicalNfc(asked) : def;
    };
    if (!propFile) {
      if (plan.kind !== 'container' && !styleName) continue;
      if (styleName) {
        const loaded = styles(styleName);
        if (loaded.problem) { say(rel, loaded.problem.detail, loaded.problem.fix); continue; }
        plan.style = loaded.style;
      }
      plan.made = plan.style ? 'style' : 'container';
      placeAt('.html');
      continue;
    }
    if (styleName) say(rel, `prop_style "${styleName}" is not used: the note names a prop_file, which is published as it is`, 'remove prop_style, or remove prop_file to use the style');

    const ext = path.extname(propFile).toLowerCase();
    const wrongKind = () => say(rel, `the prop file "${propFile}" is not a page, PDF or picture`, 'use an .html, .pdf or picture file');
    if (!PROP_FILE_EXTS.has(ext)) { wrongKind(); continue; }
    const outside = () => say(rel, `the prop file "${propFile}" is outside the note's folder`, "move the file into the note's folder (or a folder under it)");
    const segments = segmentsBelow(propFile);
    const noteDir = path.dirname(page.sourcePath);
    const noteReal = realOrNull(noteDir);
    if (!segments || !vaultReal || !noteReal || !within(noteReal, vaultReal)) { outside(); continue; }
    const found = findUnder(noteDir, segments, [vaultReal, noteReal]);
    if (found.why === 'outside') { outside(); continue; }
    if (!found.full) {
      const folder = path.posix.dirname(rel);
      say(rel, `the prop file "${propFile}" is not in ${folder === '.' ? "the vault's top folder" : folder}`, 'put the file beside the note, or correct prop_file');
      continue;
    }
    // The real file is the one that ships, so its own name must be an allowed kind too.
    if (!PROP_FILE_EXTS.has(path.extname(found.real).toLowerCase())) { wrongKind(); continue; }
    const read = readOrError(found.real);
    if (read.error) {
      say(rel, `the prop file "${propFile}" could not be read (${read.error})`, 'make the file readable, or correct prop_file');
      continue;
    }
    plan.source = found.real;
    plan._full = found.full;
    plan._ext = ext;
    plan._propFile = propFile;
    plan._bytes = read.bytes;
    plan.hash = sha1(read.bytes);
    placeAt(ext);
  }

  // Claims among shipping props: an explicit address before a default, then vault-path order.
  const order = props.filter((p) => p.ships && p.address)
    .sort((a, b) => (Number(b._explicit) - Number(a._explicit)) || (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  const claimed = new Map(); // addressKey -> { rel, hash }
  const keptReplaced = (address) => taken.has(address) && !taken.has(address, { explicit: true });
  for (const p of order) {
    const why = taken.has(p.address, { explicit: p._explicit });
    const prior = claimed.get(addressKey(p.address));
    if (why || prior) {
      problem(p.rel, `its address ${p.address} is taken by ${why ? takerName(why) : prior.rel}`, 'give it another prop_address');
      p.address = null;
      continue;
    }
    claimed.set(addressKey(p.address), { rel: p.rel, hash: p.hash });
    if (p._explicit && keptReplaced(p.address)) p.replacesKept = true;
  }

  // A prop's own file, then (for a page or SVG) every file it reaches, each once, into `files`.
  const markup = (ext) => MARKUP_EXTS.has(ext);
  function planFiles(p, files, problem, claimed) {
    const first = { source: p.source, out: p.address, cut: Boolean(cutKeeper) && markup(p._ext) };
    BYTES.set(first, p._bytes);
    files.push(first);
    if (!markup(p._ext)) return;
    const propDir = path.dirname(p._full);
    const propDirReal = realOrNull(propDir);
    const shownDir = path.posix.dirname(p._propFile.replace(/\\/g, '/'));
    // Outputs planned for this prop, and the first output of each real file. A picture
    // reached by two paths is planned at both (same bytes); a stylesheet or SVG is followed
    // once, because its links read from where it sits and a symlink loop would never end.
    const planned = new Set([addressKey(p.address)]);
    const firstOut = new Map([[p.source, p.address]]);
    const queue = [{ entry: first, full: p._full, at: '', ext: p._ext, bytes: p._bytes }];
    while (queue.length) {
      const { entry, full, at, ext, bytes } = queue.shift();
      let { text } = textOf(bytes);
      if (entry.cut) text = cutHtml(text).text;
      const { refs, rooted } = localRefs(text, ext === '.css' ? '.css' : '.html');
      const shown = entry === first ? p._propFile : canonicalNfc(path.posix.join(shownDir, at, path.basename(full)));
      const linkProblem = (raw, which, fix = LINK_FIX) => problem(p.rel, `${shown} links "${raw}", which ${which}`, fix);
      for (const raw of rooted) linkProblem(raw, 'starts with /, an address on the site');
      for (const { raw, path: ref } of refs) {
        const joined = segmentsBelow(path.posix.join(at || '.', ref));
        if (!joined) { linkProblem(raw, 'is outside its folder'); continue; }
        const lext = path.extname(ref).toLowerCase();
        const notCopied = () => linkProblem(raw, 'is a kind of file a prop does not copy', KIND_FIX);
        if (!LINKED_EXTS.has(lext)) { notCopied(); continue; }
        const hit = findUnder(propDir, joined, [vaultReal, propDirReal]);
        if (hit.why === 'outside') { linkProblem(raw, 'is outside its folder'); continue; }
        if (hit.why === 'case') { linkProblem(raw, `differs in letter case from ${hit.name}`); continue; }
        if (!hit.full) { linkProblem(raw, 'is not there'); continue; }
        if (!LINKED_EXTS.has(path.extname(hit.real).toLowerCase())) { linkProblem(raw, `is not really a ${lext} file`, 'link the real file, not a link to another kind of file'); continue; }
        const rewrite = () => {
          const spelled = nfcSpelling(raw);
          if (spelled !== raw) (entry.rewrite = entry.rewrite || []).push([raw, spelled]);
        };
        const out = canonicalNfc(path.posix.join(path.posix.dirname(p.address), ...joined));
        if (planned.has(addressKey(out))) { rewrite(); continue; }
        const follows = lext === '.css' || lext === '.svg';
        if (firstOut.has(hit.real) && (follows || hit.real === p.source)) {
          linkProblem(raw, `is the same file as ${firstOut.get(hit.real)}, reached by another path`);
          continue;
        }
        const read = readOrError(hit.real);
        if (read.error) {
          problem(p.rel, `${shown} links "${raw}", which could not be read (${read.error})`, 'make the file readable');
          continue;
        }
        const hash = sha1(read.bytes);
        const why = taken.has(out, { explicit: p._explicit });
        const prior = claimed.get(addressKey(out));
        if (!why && prior && prior.hash === hash) { // the same bytes: one file serves both
          planned.add(addressKey(out));
          rewrite();
          if (prior.rel !== p.rel) p.shared.push(out);
          // A shared stylesheet or SVG is walked from this prop's own folder too: what it reaches is shared when the
          // bytes match, and a conflict when this prop's file there differs. Nothing of it is written for this prop.
          if (follows) {
            if (!firstOut.has(hit.real)) firstOut.set(hit.real, out);
            queue.push({ entry: { source: hit.real, out, cut: Boolean(cutKeeper) && markup(lext) }, full: hit.full, at: joined.slice(0, -1).join('/'), ext: lext, bytes: read.bytes });
          }
          continue;
        }
        if (why || prior) {
          problem(p.rel, `${shown} links "${raw}", which would land on ${out}, taken by ${why ? takerName(why) : prior.rel}`, 'give it another prop_address');
          continue;
        }
        rewrite();
        planned.add(addressKey(out));
        if (!firstOut.has(hit.real)) firstOut.set(hit.real, out);
        claimed.set(addressKey(out), { rel: p.rel, hash });
        const next = { source: hit.real, out, cut: Boolean(cutKeeper) && markup(lext) };
        BYTES.set(next, read.bytes);
        if (p._explicit && keptReplaced(out)) next.replacesKept = true;
        files.push(next);
        if (follows) queue.push({ entry: next, full: hit.full, at: joined.slice(0, -1).join('/'), ext: lext, bytes: read.bytes });
      }
    }
  }
  for (const p of order) {
    if (!p.address) continue;
    if (p.made) p.files.push({ source: null, out: p.address, made: p.made });
    else planFiles(p, p.files, problem, claimed);
  }

  // Each style a shipping made prop uses, once: its stylesheet, script and assets under props/styles/<name>/.
  const used = new Map();
  for (const p of order) if (p.address && p.style && !used.has(p.style.name)) used.set(p.style.name, p.style);
  const stylePlans = [...used.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).map((st) => {
    const at = (rel) => `props/styles/${st.name}/${rel}`;
    const files = [{ source: st.css, out: at('style.css') }];
    if (st.script) files.push({ source: st.script, out: at('script.js') });
    for (const a of st.assets) files.push({ source: a.source, out: at(a.rel) });
    return { name: st.name, from: st.from, replaces: st.replaces, files };
  });
  if (cleanup) {
    for (const p of props) {
      if (p.ships || !p.source || !p._explicit || !keptReplaced(p.address)) continue;
      const files = [];
      planFiles(p, files, () => {}, new Map());
      p.keptCopies = files.filter((f) => keptReplaced(f.out));
    }
  }

  for (const p of props) {
    delete p._full; delete p._ext; delete p._propFile; delete p._explicit; delete p._bytes;
  }
  return { props, problems, styles: stylePlans };
}

module.exports = { planProps, bytesOf, textOf, utf8Charset, LINKED_EXTS };
