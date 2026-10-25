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
const { isPropNote, propKindOf, propFileOf, propAddressOf } = require('./note');
const { PROP_FILE_EXTS, addressKey, defaultPropAddress, addressShapeProblem } = require('./address');
const { cutHtml } = require('./html-cut');
const { localRefs } = require('./links');

const MARKUP_EXTS = new Set(['.html', '.htm', '.svg']);
// What a prop page may pull in beside itself. HTML is not here: a linked page would be a
// second hand-made page with Keeper parts of its own.
const LINKED_EXTS = new Set([
  '.css', '.js', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico',
  '.woff', '.woff2', '.ttf', '.otf', '.mp3', '.ogg', '.wav', '.mp4', '.webm', '.pdf',
]);
const LINK_FIX = 'put the file beside the prop file and link it by a relative path';

function sha1(buf) {
  return crypto.createHash('sha1').update(buf).digest('hex');
}

function within(real, root) {
  return real === root || real.startsWith(root + path.sep);
}

function realOrNull(p) {
  try { return fs.realpathSync(p); } catch { return null; }
}

// Walk `segments` down from `base`. Each directory entered and the file found must
// real-path inside every root. Returns { full } or { why: 'missing' | 'outside' | 'case', name }.
function findUnder(base, segments, roots) {
  let dir = base;
  const spelled = [];
  for (let i = 0; i < segments.length; i++) {
    const realDir = realOrNull(dir);
    if (!realDir) return { why: 'missing' };
    if (!roots.every((r) => within(realDir, r))) return { why: 'outside' };
    let names;
    try { names = fs.readdirSync(dir); } catch { return { why: 'missing' }; }
    const want = canonicalNfc(segments[i]);
    const exact = names.find((n) => canonicalNfc(n) === want);
    if (!exact) {
      const folded = names.find((n) => canonicalNfc(n).toLowerCase() === want.toLowerCase());
      if (folded) return { why: 'case', name: [...spelled, folded, ...segments.slice(i + 1)].join('/') };
      return { why: 'missing' };
    }
    spelled.push(exact);
    dir = path.join(dir, exact);
  }
  const real = realOrNull(dir);
  if (!real) return { why: 'missing' };
  if (!roots.every((r) => within(real, r))) return { why: 'outside' };
  if (!fs.statSync(real).isFile()) return { why: 'missing' };
  return { full: dir, real };
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

function planProps({ vaultPath, pages, relOf, ships, taken, cutKeeper }) {
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
      address: null, source: null, files: [], hash: null,
    };
    props.push(plan);
    const propFile = propFileOf(fm);
    if (!propFile) continue;
    const say = plan.ships ? problem : () => {};

    const ext = path.extname(propFile).toLowerCase();
    if (!PROP_FILE_EXTS.has(ext)) {
      say(rel, `the prop file "${propFile}" is not a page, PDF or picture`, 'use an .html, .pdf or picture file');
      continue;
    }
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
    plan.source = found.real;
    plan._full = found.full;
    plan._ext = ext;
    plan._propFile = propFile;
    plan.hash = sha1(fs.readFileSync(found.real));

    const def = defaultPropAddress(rel, ext);
    const asked = propAddressOf(fm);
    const shape = asked === null ? null : addressShapeProblem(asked, ext);
    if (asked !== null && shape) {
      say(rel, `prop_address "${asked}" ${shape}; it is published at ${def}`, `write a path such as ${def}`);
    }
    plan._explicit = asked !== null && !shape;
    plan.address = plan._explicit ? canonicalNfc(asked) : def;
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

  // Each winner's own file, then (for a page or SVG) every file it reaches, each once.
  for (const p of order) {
    if (!p.address) continue;
    const markup = (ext) => MARKUP_EXTS.has(ext);
    const first = { source: p.source, out: p.address, cut: Boolean(cutKeeper) && markup(p._ext) };
    p.files.push(first);
    if (!markup(p._ext)) continue;
    const propDir = path.dirname(p._full);
    const propDirReal = realOrNull(propDir);
    const shownDir = path.posix.dirname(p._propFile.replace(/\\/g, '/'));
    const seen = new Set([p.source]);
    const queue = [{ entry: first, full: p._full, at: '', ext: p._ext }];
    while (queue.length) {
      const { entry, full, at, ext } = queue.shift();
      let text = fs.readFileSync(entry.source, 'utf8');
      if (entry.cut) text = cutHtml(text).text;
      const { refs, rooted } = localRefs(text, ext === '.css' ? '.css' : '.html');
      const shown = entry === first ? p._propFile : canonicalNfc(path.posix.join(shownDir, at, path.basename(full)));
      const linkProblem = (raw, which) => problem(p.rel, `${shown} links "${raw}", which ${which}`, LINK_FIX);
      for (const raw of rooted) linkProblem(raw, 'starts with /, an address on the site');
      for (const { raw, path: ref } of refs) {
        const joined = segmentsBelow(path.posix.join(at || '.', ref));
        if (!joined) { linkProblem(raw, 'is outside its folder'); continue; }
        const lext = path.extname(ref).toLowerCase();
        if (!LINKED_EXTS.has(lext)) { linkProblem(raw, 'is a kind of file a prop does not copy'); continue; }
        const hit = findUnder(propDir, joined, [vaultReal, propDirReal]);
        if (hit.why === 'outside') { linkProblem(raw, 'is outside its folder'); continue; }
        if (hit.why === 'case') { linkProblem(raw, `differs in letter case from ${hit.name}`); continue; }
        if (!hit.full) { linkProblem(raw, 'is not there'); continue; }
        const rewrite = () => { if (canonicalNfc(raw) !== raw) (entry.rewrite = entry.rewrite || []).push([raw, canonicalNfc(raw)]); };
        if (seen.has(hit.real)) { rewrite(); continue; }
        seen.add(hit.real);
        const out = canonicalNfc(path.posix.join(path.posix.dirname(p.address), ...joined));
        const hash = sha1(fs.readFileSync(hit.real));
        const why = taken.has(out, { explicit: p._explicit });
        const prior = claimed.get(addressKey(out));
        if (!why && prior && prior.hash === hash) { rewrite(); continue; } // the same bytes: one file serves both
        if (why || prior) {
          problem(p.rel, `${shown} links "${raw}", which would land on ${out}, taken by ${why ? takerName(why) : prior.rel}`, 'give it another prop_address');
          continue;
        }
        rewrite();
        claimed.set(addressKey(out), { rel: p.rel, hash });
        const next = { source: hit.real, out, cut: Boolean(cutKeeper) && markup(lext) };
        if (p._explicit && keptReplaced(out)) next.replacesKept = true;
        p.files.push(next);
        if (lext === '.css' || lext === '.svg') queue.push({ entry: next, full: hit.full, at: joined.slice(0, -1).join('/'), ext: lext });
      }
    }
  }

  for (const p of props) {
    delete p._full; delete p._ext; delete p._propFile; delete p._explicit;
  }
  return { props, problems };
}

module.exports = { planProps, LINKED_EXTS };
