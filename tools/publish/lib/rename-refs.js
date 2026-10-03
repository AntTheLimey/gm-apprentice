'use strict';

// `manifest rename`: what renaming one note would change in the files the publish tool
// owns, so a rename never quietly takes a page off the site. It writes nothing. The
// answer is { files: { <vault path>: <new full text> }, pin?: { live_key } }:
//
//   files  the publish list (_meta/publish-manifest.md) and the vault-config settings that
//          name the note: an `overrides.fields` path, and a `landing` featured_npcs /
//          featured_locations / quick_links name. Text comes back byte for byte but for
//          the changed name, line endings kept.
//   pin    present when the note is a PC page, which the site keys live state by (its
//          slug of the filename unless `live_key` pins it): the key it has now, so the
//          caller can pin it before the file name changes. Only `pcLiveKey` knows it.
const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('util');
const { parseNote } = require('./frontmatter');
const { canonicalPath, ENTRY_RE } = require('./manifest');
const { canonicalNfc } = require('./unicode');
const { pcLiveKey } = require('./scanner');
const { splitFrontmatter, locateBlock } = require('./vault-config-edit');

const MANIFEST_REL = '_meta/publish-manifest.md';
const CONFIG_REL = '_meta/vault-config.md';
const NAME_LISTS = ['featured_npcs', 'featured_locations', 'quick_links'];

function lines(text) {
  return text.match(/[^\n]*\n|[^\n]+$/g) || [];
}

function renameInManifest(text, from, to) {
  const want = canonicalPath(from);
  let section = null;
  let changed = false;
  const out = lines(text).map((line) => {
    const eol = /\r?\n$/.exec(line);
    const body = eol ? line.slice(0, -eol[0].length) : line;
    const heading = /^## (.+)/.exec(body);
    if (heading) {
      const title = heading[1].trim();
      section = title.startsWith('Publishing') || title.startsWith('Needs Decision') || title.startsWith('Excluded') ? title : null;
      return line;
    }
    if (!section) return line;
    const prefix = /^(?:- \[[ xX]\]\s+|\s+-\s+)/.exec(body);
    if (!prefix) return line;
    const rest = body.slice(prefix[0].length);
    const entry = ENTRY_RE.exec(rest.trim());
    const named = entry ? entry[1] : rest.trim();
    if (canonicalPath(named) !== want || !rest.startsWith(named)) return line;
    changed = true;
    return prefix[0] + to + rest.slice(named.length) + (eol ? eol[0] : '');
  });
  return changed ? out.join('') : null;
}

const stemOf = (rel) => path.posix.basename(rel).replace(/\.md$/i, '');

function mdFiles(vault) {
  const found = [];
  (function walk(dir, rel) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      if (e.isDirectory()) walk(path.join(dir, e.name), rel ? `${rel}/${e.name}` : e.name);
      else if (e.name.endsWith('.md')) found.push(rel ? `${rel}/${e.name}` : e.name);
    }
  }(vault, ''));
  return found;
}

// The settings in vault-config.md that name the note, edited on their lines and checked by
// reading the result back: anything that does not come out as intended is an error.
function renameInConfig(text, vault, from, to) {
  let data;
  try { data = parseNote(text).data; } catch (e) { return null; }
  const publish = data && data.publish;
  if (!publish || typeof publish !== 'object') return null;
  const want = canonicalPath(from);
  const oldStem = canonicalNfc(stemOf(from));
  const newStem = stemOf(to);
  const expected = JSON.parse(JSON.stringify(data));
  const overrides = expected.publish.overrides;
  const fields = overrides && overrides.fields;
  const pathKey = fields && typeof fields === 'object' ? Object.keys(fields).find((k) => canonicalPath(k) === want) : undefined;
  const landing = expected.publish.landing;
  const listed = (key) => landing && Array.isArray(landing[key])
    && landing[key].some((n) => typeof n === 'string' && canonicalNfc(n) === oldStem);
  let lists = oldStem === canonicalNfc(newStem) ? [] : NAME_LISTS.filter(listed);
  // A name is the filename: where another note has it too, it may mean that one.
  if (lists.length && mdFiles(vault).some((f) => canonicalNfc(stemOf(f)) === oldStem && canonicalPath(f) !== want)) lists = [];
  if (pathKey === undefined && lists.length === 0) return null;

  if (pathKey !== undefined) { fields[to] = fields[pathKey]; delete fields[pathKey]; }
  for (const key of lists) landing[key] = landing[key].map((n) => (typeof n === 'string' && canonicalNfc(n) === oldStem ? newStem : n));

  const fm = splitFrontmatter(text);
  if (fm.error) throw new Error(`${CONFIG_REL}: ${fm.error}`);
  const edit = fm.lines.slice();
  const block = locateBlock(edit);
  if (block.error || block.absent) throw new Error(`${CONFIG_REL}: cannot edit the publish block`);
  const quoted = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (pathKey !== undefined) {
    const re = new RegExp(`^(\\s*)(["']?)${quoted(pathKey)}\\2(\\s*:)`);
    for (let i = block.start; i < block.end; i++) edit[i] = edit[i].replace(re, (m, ind, q, colon) => `${ind}${q}${to}${q}${colon}`);
  }
  const landingKey = block.keys.find((k) => k.key === 'landing');
  if (landingKey) {
    const re = new RegExp(`(^|[\\[\\s,-])(["']?)${quoted(oldStem)}\\2(?=\\s*(?:[,\\]#]|$))`, 'g');
    let active = false;
    for (let i = landingKey.from + 1; i < landingKey.to; i++) {
      const k = /^\s*(["']?)([A-Za-z_]+)\1\s*:/.exec(edit[i]);
      if (k) active = lists.includes(k[2]);
      if (active) edit[i] = edit[i].replace(re, (m, lead, q) => `${lead}${q}${newStem}${q}`);
    }
  }
  const next = fm.head + edit.map((l) => l + fm.eol).join('') + fm.tail;
  let after;
  try { after = parseNote(next).data; } catch (e) { after = null; }
  if (!isDeepStrictEqual(after, expected)) throw new Error(`${CONFIG_REL}: the edit for ${from} did not verify`);
  return next;
}

function pinOf(vault, from, to) {
  const file = path.join(vault, from);
  if (!fs.existsSync(file)) return null;
  let data;
  try { data = parseNote(fs.readFileSync(file, 'utf-8')).data; } catch (e) { return null; }
  if (!data || data.type !== 'pc') return null;
  const key = pcLiveKey(data, path.basename(from, '.md'));
  // A move, or a rename that slugs the same, keeps the key: nothing to pin.
  if (pcLiveKey(data, path.basename(to, '.md')) === key) return null;
  return { live_key: key };
}

function renameRefs(vault, from, to) {
  const files = {};
  const read = (rel) => {
    const file = path.join(vault, rel);
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : null;
  };
  const manifest = read(MANIFEST_REL);
  const renamed = manifest === null ? null : renameInManifest(manifest, from, to);
  if (renamed !== null) files[MANIFEST_REL] = renamed;
  const config = read(CONFIG_REL);
  const edited = config === null ? null : renameInConfig(config, vault, from, to);
  if (edited !== null) files[CONFIG_REL] = edited;
  const answer = { files };
  const pin = pinOf(vault, from, to);
  if (pin) answer.pin = pin;
  return answer;
}

function runRename(options, deps) {
  const out = (deps && deps.out) || console.log;
  const { vaultPath: vault, from, to } = options;
  for (const [flag, value] of [['--vault', vault], ['--from', from], ['--to', to]]) {
    if (!value) { console.error(`Error: manifest rename needs ${flag}`); return 1; }
  }
  if (!fs.existsSync(vault) || !fs.statSync(vault).isDirectory()) {
    console.error(`Error: --vault is not a folder: ${vault}`);
    return 1;
  }
  const norm = (p) => String(p).replace(/\\/g, '/').replace(/^\.\//, '');
  try {
    out(JSON.stringify(renameRefs(path.resolve(vault), norm(from), norm(to))));
  } catch (e) {
    console.error(`Error: ${String(e.message).split('\n')[0]}`);
    return 1;
  }
  return 0;
}

module.exports = { runRename, renameRefs, renameInManifest };
