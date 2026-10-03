'use strict';

// `manifest rename`: what renaming one note would change in the files the publish tool
// owns, so a rename never quietly takes a page off the site. It writes nothing. The
// answer is { files: { <vault path>: <new full text> }, pin?: { live_key } }:
//
//   companions  files the site pairs to the note by name, which move with it (a PC's
//          `_Story.md`): [{ from, to }]. `detaches`, a one-line reason, instead says the
//          note is such a companion and cannot be renamed alone.
//   files  the publish list (_meta/publish-manifest.md) and the vault-config settings that
//          name the note: an `overrides.fields` path, and a `landing` featured_npcs /
//          featured_locations / quick_links name. Text comes back byte for byte but for
//          the changed name, line endings kept.
//   unpublishes  a reason, when `to` would take a page that publishes off the site.
//   published  with `--name`: the notes the site publishes (vault paths).
//   owners  with `--name <spelling>` (repeated): where the build's link map sends each spelling,
//          { spelling: vault path | null }.
//   pin    present when the note is a PC page, which the site keys live state by (its
//          slug of the filename unless `live_key` pins it): the key it has now, so the
//          caller can pin it before the file name changes. Only `pcLiveKey` knows it.
const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('util');
const { parseNote } = require('./frontmatter');
const { canonicalPath, ENTRY_RE } = require('./manifest');
const { canonicalNfc } = require('./unicode');
const {
  pcLiveKey, storyPathOf, storyOwnerPath, isStoryCompanion, scanVaultReport, buildLinkMap,
} = require('./scanner');
const { resolveConfig, scanConfigFor, vaultRelPath, loadVaultConfig } = require('./config');
const { mapFolder, dirIsExcluded } = require('./scanner');
const { decidePage, publishesPage } = require('./publish-decision');
const { loadManifest } = require('./manifest');
const { publishedPages } = require('./published-pages');
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

function frontmatterOf(vault, rel) {
  const file = path.join(vault, rel);
  if (!fs.existsSync(file)) return null;
  try { return parseNote(fs.readFileSync(file, 'utf-8')).data || {}; } catch (e) { return null; }
}

// Files the site pairs to `from` by name, which must move with it; why `from` itself cannot
// move alone; and why `to` cannot be used. The pairing is scanner.js's `isStoryCompanion`:
// a typed `<PC>_Story.md` beside a PC.
function companionsOf(vault, from, to) {
  const fromFm = frontmatterOf(vault, from);
  const owner = storyOwnerPath(from);
  if (owner !== null && isStoryCompanion(frontmatterOf(vault, owner), fromFm)) {
    const pc = path.posix.basename(owner, '.md');
    return { detaches: `${from} is ${pc}'s story; rename ${pc} and the story moves with it` };
  }
  const story = storyPathOf(from);
  const isPc = !!fromFm && fromFm.type === 'pc';
  if (isPc && isStoryCompanion(fromFm, frontmatterOf(vault, story))) {
    return { companions: [{ from: story, to: storyPathOf(to) }] };
  }
  // A note moved onto `<PC>_Story.md` beside a PC, or a PC moved onto a name whose story
  // file is already there, would be swallowed by the build as that PC's story.
  const newOwner = storyOwnerPath(to);
  if (fromFm && fromFm.type && newOwner !== null && newOwner !== from
      && isStoryCompanion(frontmatterOf(vault, newOwner), fromFm)) {
    return { refusal: `${to} would attach to ${path.posix.basename(newOwner, '.md')} as its story` };
  }
  const there = storyPathOf(to);
  if (isPc && there !== to && isStoryCompanion(fromFm, frontmatterOf(vault, there))) {
    return { refusal: `${there} would attach to ${path.posix.basename(to, '.md')} as its story` };
  }
  return {};
}

// What the site publishes, worked out as the build does it (config as the build reads it,
// the scan, publishedPages). `configPath`, the site's vault.config.json, is read when given,
// for settings the vault file does not hold.
function siteContext(vault, configPath) {
  const raw = configPath && fs.existsSync(configPath) ? loadVaultConfig(configPath) : {};
  const { config, publishConfig } = resolveConfig(raw, vault, () => {});
  const scanConfig = scanConfigFor(Object.assign({}, config, { vaultPath: vault }), publishConfig);
  const relOf = (page) => canonicalPath(vaultRelPath(vault, page.sourcePath));
  const manifest = loadManifest(vault);
  const pages = scanVaultReport(scanConfig).pages;
  const { published } = publishedPages(pages, { vaultPath: vault, publishConfig, manifest, relOf });
  return { scanConfig, publishConfig, manifest, pages, published, relOf };
}

// The vault path of the note the build's link map gives each spelling (titles, paths,
// aliases; NFC); null when it maps to nothing. The site resolves a spelling by exact key, so
// each spelling a note is linked by is asked, not just the filename. Also the notes that
// publish: a link in any other note is not read through the site's map.
function ownersOf(ctx, spellings) {
  const linkMap = buildLinkMap(ctx.published);
  const owners = {};
  for (const spelling of spellings) {
    const out = linkMap[spelling];
    const page = out === undefined ? null : ctx.published.find((p) => p.outputPath === out);
    owners[spelling] = page ? ctx.relOf(page) : null;
  }
  return { owners, published: ctx.published.map(ctx.relOf) };
}

// Why `to` would not publish a page that publishes at `from`: a folder the scanner skips (a
// hidden one, publish.exclude_dirs, one missing from publish.folder_map), or the build's own
// verdict for the page there. null when the page keeps publishing, or did not to begin with.
function unpublishReason(ctx, from, to) {
  const old = ctx.pages.find((p) => ctx.relOf(p) === canonicalPath(from));
  if (!old || !ctx.published.includes(old)) return null;
  const dir = path.posix.dirname(to) === '.' ? '' : path.posix.dirname(to);
  let why = null;
  if (dir.split('/').some((seg) => seg.startsWith('.'))) why = 'it is in a hidden folder';
  else if (dir && dirIsExcluded(dir, ctx.publishConfig.exclude_dirs)) why = 'its folder is in publish.exclude_dirs';
  else if (dir && !mapFolder(dir, ctx.scanConfig.folderMap || {})) why = 'its folder is not in publish.folder_map';
  if (!why) {
    const hyp = ctx.manifest ? Object.assign({}, ctx.manifest, {
      publishing: ctx.manifest.publishing.map((r) => (r === canonicalPath(from) ? canonicalPath(to) : r)),
    }) : null;
    const verdict = decidePage(old, { rel: canonicalPath(to), publishConfig: ctx.publishConfig, manifest: hyp });
    if (!publishesPage(verdict)) why = verdict.reason;
  }
  return why ? `${to} would not publish: ${why}` : null;
}

function renameRefs(vault, from, to, configPath, names) {
  const found = companionsOf(vault, from, to);
  if (found.detaches) return { files: {}, detaches: found.detaches };
  if (found.refusal) return { files: {}, refusal: found.refusal };
  const moves = [{ from, to }].concat(found.companions || []);
  const files = {};
  const read = (rel) => {
    const file = path.join(vault, rel);
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : null;
  };
  const manifest = read(MANIFEST_REL);
  const config = read(CONFIG_REL);
  let manifestText = manifest;
  let configText = config;
  for (const move of moves) {
    if (manifestText !== null) manifestText = renameInManifest(manifestText, move.from, move.to) ?? manifestText;
    if (configText !== null) configText = renameInConfig(configText, vault, move.from, move.to) ?? configText;
  }
  if (manifest !== null && manifestText !== manifest) files[MANIFEST_REL] = manifestText;
  if (config !== null && configText !== config) files[CONFIG_REL] = configText;
  const answer = { files };
  const ctx = siteContext(vault, configPath);
  const unpublishes = unpublishReason(ctx, from, to);
  if (unpublishes) answer.unpublishes = unpublishes;
  if (names && names.length) Object.assign(answer, ownersOf(ctx, names));
  if (found.companions) answer.companions = found.companions;
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
    out(JSON.stringify(renameRefs(path.resolve(vault), norm(from), norm(to), options.configPath, options.names)));
  } catch (e) {
    console.error(`Error: ${String(e.message).split('\n')[0]}`);
    return 1;
  }
  return 0;
}

module.exports = { runRename, renameRefs, renameInManifest };
