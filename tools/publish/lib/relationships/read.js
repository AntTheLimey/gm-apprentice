'use strict';
// Every note's relationships, with the line each one is on. The base the relationship checks
// (check.js) and fixes (fix.js) stand on.
//
// The vault is read whole: a target, an alias and an inbound count need every note. What a run
// was asked about (`files`, `folder`, `newerThan`) only marks a note `inScope`; the checks
// report on in-scope notes alone.
//
// The notes read are the ones `vault_check.py` walks (vaultlib.vault_files): `.md` files, not in
// a hidden folder, not under a top-level `_Templates`, `_templates` or `_inbox`. `_meta` is a
// note like any other.
//
//   Note  { rel, name, aliases, type, fields, edges, links, poiLinks, inScope }   (poiLinks: the names in points_of_interest alone)
//   Field { raw, target, line }      parent_location / current_holder. `target` is the rel of the
//                                    note it names when the value is exactly one wiki-link to a
//                                    note that exists, else null.
//   Edge  { index, line, typeLine, type, target, targetRel, bidirectional, strength, tone,
//           toneLine, strengthLine, description, gmOnly, mobrpg, form, rawTarget }
//         (`description` is the value as the YAML reader gives it, '' when none; `gmOnly` is whether
//         the site drops the edge, read by the site's own rule, processor.js isGmOnlyEdge)
//
// `target` is read by the site's rule (connections.js targetRef); where that names no note
// it is '' (and `targetRel` null), and `rawTarget` keeps the text as written.
//
// `line` and `typeLine` are 1-based lines of the FILE (the opening `---` is line 1, so the
// frontmatter starts at 2), the numbers `vault_check.py` prints. `typeLine` is the line of the
// `type:` (or `predicate:`) key; for the map form it is the line of the relationship's own key
// (`ally:`). `line` is where the edge starts: its first key, or for the map form its target.
//
// `index` is what the fix step finds an edge by, together with `form` and `mobrpg`:
//   list form   the edge's position in the note's `relationships:` list (a list item that is not
//               a map takes a position and gives no edge)
//   map form    its place in the flattened order connections.js uses: keys in written order, each
//               key's targets in written order, a target that is not a string skipped
//   mobrpg      its position in the `mobrpg:` node's own `relationships:` list
//
// A note whose frontmatter cannot be read goes to `faults` once and is not a note: it has no
// edges and is no one's target (the build skips it the same way).
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const { parseNote } = require('../frontmatter');
const { buildLinkMap } = require('../scanner');
const { canonicalNfc } = require('../unicode');
const { wikilinkRe, parseWikilink } = require('../wikilink');
const { targetRef } = require('../connections');

const SKIP_DIRS = new Set(['_Templates', '_templates', '_inbox']);
const FIELDS = ['parent_location', 'current_holder'];

// vaultlib.normalize_file_arg: slashes forward, any leading "./" off, trailing "/" off.
function normalizeFileArg(raw) {
  let value = String(raw).trim().replace(/\\/g, '/');
  while (value.startsWith('./')) value = value.slice(2);
  return value.replace(/\/+$/, '');
}

function listNotes(vaultPath) {
  const found = [];
  (function walk(dir, rel) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!rel && SKIP_DIRS.has(entry.name)) continue;
        walk(path.join(dir, entry.name), childRel);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        found.push({ rel: childRel, full: path.join(dir, entry.name) });
      }
    }
  })(vaultPath, '');
  return found.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}

const scalarOf = (node) => (YAML.isScalar(node) ? node.value : undefined);
const textOf = (node) => {
  const v = scalarOf(node);
  return v === null || v === undefined ? '' : String(v);
};

function pairOf(map, name) {
  if (!YAML.isMap(map)) return null;
  return map.items.find((p) => YAML.isScalar(p.key) && String(p.key.value) === name) || null;
}

// The name when the whole value is one wiki-link, else null.
function soleLink(value) {
  const text = String(value).trim();
  const m = wikilinkRe('').exec(text);
  return m && m.index === 0 && m[0].length === text.length ? parseWikilink(m[1]).name.trim() : null;
}

function poiLinks(frontmatter) {
  const names = new Set();
  const poi = frontmatter.points_of_interest;
  for (const item of Array.isArray(poi) ? poi : [poi]) {
    if (typeof item !== 'string') continue;
    for (const m of item.matchAll(wikilinkRe('g', true))) {
      if (m[0].startsWith('!')) continue;
      const name = parseWikilink(m[1]).name.trim();
      if (name) names.add(name);
    }
  }
  return [...names];
}

function bodyLinks(content, frontmatter) {
  const names = new Set();
  const take = (text) => {
    for (const m of String(text).matchAll(wikilinkRe('g', true))) {
      if (m[0].startsWith('!')) continue; // an embed shows a file, it does not link a note
      const name = parseWikilink(m[1]).name.trim();
      if (name) names.add(name);
    }
  };
  take(content);
  const poi = frontmatter.points_of_interest;
  for (const item of Array.isArray(poi) ? poi : [poi]) if (typeof item === 'string') take(item);
  return [...names];
}

function readVault(vaultPath, { files, folder, newerThan } = {}) {
  const faults = [];
  const parsed = [];
  for (const { rel, full } of listNotes(vaultPath)) {
    let stat;
    let text;
    try {
      stat = fs.statSync(full);
      text = fs.readFileSync(full, 'utf8');
    } catch (e) {
      faults.push({ rel, message: `cannot read the file: ${e.message}`, mtime: stat ? stat.mtimeMs / 1000 : Infinity });
      continue;
    }
    let note;
    try {
      note = parseNote(text);
    } catch (e) {
      faults.push({ rel, message: e.message, mtime: stat.mtimeMs / 1000 });
      continue;
    }
    const lineCounter = new YAML.LineCounter();
    // gray-matter leaves a lone `\r` at the end of a CRLF note's frontmatter, which YAML refuses;
    // the line count is the same without it.
    const doc = YAML.parseDocument((note.matter || '').replace(/\r\n/g, '\n').replace(/\r$/, ''), { lineCounter, keepSourceTokens: true });
    if (doc.errors.length) {
      faults.push({ rel, message: doc.errors[0].message.split('\n')[0], mtime: stat.mtimeMs / 1000 });
      continue;
    }
    const data = YAML.isMap(doc.contents) ? doc.toJS() || {} : {};
    parsed.push({ rel, mtime: stat.mtimeMs / 1000, doc, lineCounter, data, content: note.content });
  }

  const lookup = buildLinkMap(parsed.map((p) => ({
    title: path.posix.basename(p.rel, '.md'),
    vaultPath: p.rel.replace(/\.md$/, ''),
    outputPath: p.rel,
    frontmatter: p.data,
  })));
  const resolve = (name) => {
    const hit = name ? lookup[canonicalNfc(name)] : undefined;
    return typeof hit === 'string' ? hit : null;
  };

  const wanted = files ? new Set(files.map(normalizeFileArg)) : null;
  const prefix = folder ? `${String(folder).replace(/^\/+|\/+$/g, '')}/` : null;
  const inScope = (p) => !(
    (prefix && !p.rel.startsWith(prefix))
    || (wanted && !wanted.has(p.rel))
    || (newerThan !== undefined && newerThan !== null && p.mtime < newerThan));

  // A note that cannot be read is in scope by the same rule; `check` reports it once if it is.
  for (const f of faults) f.inScope = inScope({ rel: f.rel, mtime: f.mtime });

  const notes = parsed.map((p) => {
    const lineOf = (node) => p.lineCounter.linePos(node.range[0]).line;
    const root = YAML.isMap(p.doc.contents) ? p.doc.contents : null;
    const edges = [];

    const fields = {};
    for (const name of FIELDS) {
      const pair = pairOf(root, name);
      const value = pair && scalarOf(pair.value);
      if (typeof value !== 'string') continue;
      const sole = soleLink(value);
      fields[name] = { raw: value, target: sole ? resolve(sole) : null, line: lineOf(pair.key) };
    }

    const edge = (fieldsOf) => {
      // The target is read by the site's own rule (connections.js targetRef). Where that rule
      // names no note (two links, or nothing), `target` is '' and `rawTarget` keeps the text.
      const rawTarget = fieldsOf.target === undefined ? '' : fieldsOf.target;
      const ref = rawTarget.trim() ? targetRef(rawTarget) : { name: '', links: 0 };
      const target = ref.links > 1 ? '' : ref.name;
      edges.push({
        ...fieldsOf,
        target,
        targetRel: target ? resolve(target) : null,
        rawTarget,
        mobrpg: !!fieldsOf.mobrpg,
      });
    };

    const relPair = pairOf(root, 'relationships');
    const rels = relPair && relPair.value;
    if (YAML.isSeq(rels)) {
      rels.items.forEach((item, index) => {
        if (!YAML.isMap(item)) return;
        const get = (key) => { const pair = pairOf(item, key); return pair ? pair : null; };
        const typePair = get('type');
        const target = get('target');
        const bidirectional = get('bidirectional');
        const strength = get('strength');
        const tone = get('tone');
        const description = get('description');
        const gmOnly = get('gm_only');
        const toneText = tone ? textOf(tone.value) : '';
        edge({
          index,
          line: lineOf(item),
          typeLine: lineOf((typePair || { key: item }).key),
          type: typePair ? textOf(typePair.value) : '',
          target: target ? textOf(target.value) : '',
          bidirectional: bidirectional && typeof scalarOf(bidirectional.value) === 'boolean' ? scalarOf(bidirectional.value) : null,
          strength: strength ? (YAML.isScalar(strength.value) ? strength.value.value : strength.value.toJS(p.doc)) : undefined,
          tone: toneText || null,
          toneLine: tone ? lineOf(tone.key) : null,
          strengthLine: strength ? lineOf(strength.key) : null,
          description: description ? textOf(description.value) : '',
          gmOnly: gmOnly ? require('../processor').isGmOnlyEdge({ gm_only: scalarOf(gmOnly.value) }) : false,
          form: 'list',
        });
      });
    } else if (YAML.isMap(rels)) {
      let index = 0;
      for (const pair of rels.items) {
        const type = textOf(pair.key);
        const targets = YAML.isSeq(pair.value) ? pair.value.items : [pair.value];
        for (const t of targets) {
          if (typeof scalarOf(t) !== 'string' || !scalarOf(t).trim()) continue;
          edge({
            index: index++,
            line: lineOf(t),
            typeLine: lineOf(pair.key),
            type,
            target: scalarOf(t),
            bidirectional: null,
            strength: undefined,
            tone: null,
            form: 'map',
          });
        }
      }
    }

    // The machine-managed sync node: `mobrpg: { relationships: [ { predicate, target } ] }`.
    const mobSeq = (pairOf(pairOf(root, 'mobrpg') && pairOf(root, 'mobrpg').value, 'relationships') || {}).value;
    if (YAML.isSeq(mobSeq)) {
      mobSeq.items.forEach((item, index) => {
        const predicate = pairOf(item, 'predicate');
        if (!predicate) return;
        const target = pairOf(item, 'target');
        edge({
          index,
          line: lineOf(item),
          typeLine: lineOf(predicate.key),
          type: textOf(predicate.value),
          target: target ? textOf(target.value) : '',
          bidirectional: null,
          strength: undefined,
          tone: null,
          form: 'list',
          mobrpg: true,
        });
      });
    }

    const aliases = Array.isArray(p.data.aliases) ? p.data.aliases.filter((a) => typeof a === 'string') : [];
    return {
      rel: p.rel,
      name: path.posix.basename(p.rel, '.md'),
      aliases,
      type: typeof p.data.type === 'string' ? p.data.type : '',
      fields,
      edges,
      links: bodyLinks(p.content, p.data),
      poiLinks: poiLinks(p.data),
      inScope: inScope(p),
    };
  });

  return { notes, faults, resolve };
}

module.exports = { readVault };
