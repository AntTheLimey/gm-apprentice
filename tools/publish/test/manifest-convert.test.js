'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { convertPublishList } = require('../lib/publish-list-convert');
const { loadManifest } = require('../lib/manifest');

const OLD = [
  '---', 'generated: 2026-10-13T01:53:45.512Z', 'vault: "C"', 'mode: player', 'total_files: 6', 'publishing: 2', 'excluded: 2', 'needs_decision: 2', '---', '',
  '## Publishing (2 files)', '', '- [x] NPCs/Vex.md', '- [ ] NPCs/Unticked.md', '',
  '## Excluded (2 files)', '', '- [x] Sessions/Next.md — prep', '- Reason: old notes', '  - Archive/Old.md', '',
  '## Needs Decision (2 files)', '', '- [ ] Drafts/Idea.md', '- [x] Drafts/Resolved.md', '',
].join('\n');

function vaultWith(text) {
  const v = fs.mkdtempSync(path.join(os.tmpdir(), 'convert-'));
  fs.mkdirSync(path.join(v, '_meta'));
  fs.writeFileSync(path.join(v, '_meta', 'publish-manifest.md'), text);
  return v;
}
const file = (v, f) => path.join(v, '_meta', f);

test('converts all of it, then keeps the old file as publish-manifest.md.converted', () => {
  const v = vaultWith(OLD);
  const r = convertPublishList(v);
  assert.equal(r.ok, true);
  assert.equal(fs.existsSync(file(v, 'publish-manifest.md')), false);
  assert.equal(fs.readFileSync(file(v, 'publish-manifest.md.converted'), 'utf8'), OLD);
  assert.ok(r.lines.includes('The old file is kept as _meta/publish-manifest.md.converted.'), r.lines.join('\n'));
  const list = loadManifest(v);
  assert.deepEqual(list.publishing, ['NPCs/Vex.md']);
  assert.deepEqual(list.excluded.sort(), ['Archive/Old.md', 'Sessions/Next.md']);
  assert.equal(list.reasons.get('Sessions/Next.md'), 'prep');
  assert.equal(list.reasons.get('Archive/Old.md'), 'old notes');
  assert.deepEqual(list.needsDecision.sort(), ['Drafts/Idea.md', 'Drafts/Resolved.md', 'NPCs/Unticked.md']);
  assert.ok(r.lines.some((l) => /still are not/.test(l)));
  assert.match(r.lines[0], /^Moved the publish list to _meta\/publish-list\.yaml: 1 publishing, 2 excluded, 3 needing a decision\.$/);
});

test('--check writes nothing', () => {
  const v = vaultWith(OLD);
  const r = convertPublishList(v, { check: true });
  assert.equal(r.ok, true);
  assert.equal(fs.readFileSync(file(v, 'publish-manifest.md'), 'utf8'), OLD);
  assert.equal(fs.existsSync(file(v, 'publish-list.yaml')), false);
  assert.equal(fs.existsSync(file(v, 'publish-list.yaml.convert')), false);
});

test('a read-back that differs leaves the old file and no new one', () => {
  const v = vaultWith(OLD);
  const r = convertPublishList(v, { deps: { readBack: (list) => ({ ...list, publishing: [] }) } });
  assert.equal(r.ok, false);
  assert.match(r.blockers.join('\n'), /NPCs\/Vex\.md/);
  assert.equal(fs.readFileSync(file(v, 'publish-manifest.md'), 'utf8'), OLD);
  assert.equal(fs.existsSync(file(v, 'publish-list.yaml')), false);
  assert.equal(fs.existsSync(file(v, 'publish-list.yaml.convert')), false);
});

test('a write that fails half way leaves the old file and no new one', () => {
  const v = vaultWith(OLD);
  assert.throws(() => convertPublishList(v, { deps: { writeTemp: () => { throw new Error('disk full'); } } }), /disk full/);
  assert.equal(fs.readFileSync(file(v, 'publish-manifest.md'), 'utf8'), OLD);
  assert.equal(fs.existsSync(file(v, 'publish-list.yaml')), false);
});

test('a stop between placing the new file and setting the old aside is finished by the next run', () => {
  const v = vaultWith(OLD);
  assert.throws(() => convertPublishList(v, { deps: { moveOld: () => { throw new Error('stopped'); } } }), /stopped/);
  assert.ok(fs.existsSync(file(v, 'publish-list.yaml')) && fs.existsSync(file(v, 'publish-manifest.md')));
  const again = convertPublishList(v);
  assert.equal(again.ok, true);
  assert.equal(fs.existsSync(file(v, 'publish-manifest.md')), false);
  assert.equal(fs.readFileSync(file(v, 'publish-manifest.md.converted'), 'utf8'), OLD);
});

test('both files that disagree: nothing is removed', () => {
  const v = vaultWith(OLD);
  fs.writeFileSync(file(v, 'publish-list.yaml'), 'publishing:\n  - Other.md\n');
  const r = convertPublishList(v);
  assert.equal(r.ok, false);
  assert.ok(r.blockers.length > 0);
  assert.equal(fs.readFileSync(file(v, 'publish-manifest.md'), 'utf8'), OLD);
});

test('a second run does nothing', () => {
  const v = vaultWith(OLD);
  convertPublishList(v);
  const before = fs.readFileSync(file(v, 'publish-list.yaml'), 'utf8');
  const r = convertPublishList(v);
  assert.equal(r.converted, false);
  assert.equal(fs.readFileSync(file(v, 'publish-list.yaml'), 'utf8'), before);
});

test('what publishes does not change: the site before converting equals the site after', () => {
  const { buildBoth } = require('./helpers/gm-build');
  const { build } = require('../lib/build');
  const files = Object.fromEntries(['NPCs/Vex.md', 'NPCs/Unticked.md', 'Sessions/Next.md', 'Archive/Old.md', 'Drafts/Idea.md', 'Drafts/Resolved.md']
    .map((rel) => [rel, `---\ntype: npc\n---\nText of ${rel}.\n`]));
  files['_meta/publish-manifest.md'] = OLD;
  const s = buildBoth(files, { sites: ['player'], gm: { publish: false } });
  const quiet = (fn) => { const l = console.log; const w = console.warn; console.log = () => {}; console.warn = () => {}; try { fn(); } finally { console.log = l; console.warn = w; } };
  const snapshot = () => Object.fromEntries(s.player.files().map((f) => [path.relative(s.player.dir, f), fs.readFileSync(f, 'utf8')]));
  try {
    const before = snapshot();
    assert.ok(Object.keys(before).some((f) => f.includes('vex')), 'the listed note published');
    assert.equal(Object.keys(before).some((f) => f.includes('unticked')), false, 'the unticked one did not');
    assert.equal(convertPublishList(path.join(s.root, 'vault')).ok, true);
    quiet(() => build({ configPath: s.configPath, site: 'player' }));
    assert.deepEqual(snapshot(), before);
  } finally { s.cleanup(); }
});

test('manifest list and manifest convert answer through the command', async () => {
  const { runManifest } = require('../lib/manifest-cli');
  const v = vaultWith(OLD);
  const lines = [];
  const d = { out: (t) => lines.push(t) };
  assert.equal(await runManifest({ verb: 'convert', vaultPath: v, check: true }, d), 0);
  assert.match(lines.pop(), /^Would move the publish list/);
  assert.equal(await runManifest({ verb: 'convert', vaultPath: v }, d), 0);
  assert.equal(await runManifest({ verb: 'list', vaultPath: v, json: true }, d), 0);
  const payload = JSON.parse(lines.pop());
  assert.equal(payload.listed, true);
  assert.deepEqual(payload.publishing, ['NPCs/Vex.md']);
  assert.deepEqual(payload.excluded.map((e) => e.path).sort(), ['Archive/Old.md', 'Sessions/Next.md']);
  assert.deepEqual(payload.counts, { publishing: 1, excluded: 2, needs_decision: 3 });
  assert.equal(await runManifest({ verb: 'list' }, d), 1);
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'no-list-'));
  try {
    assert.equal(await runManifest({ verb: 'list', vaultPath: bare, json: true }, d), 0);
    assert.equal(JSON.parse(lines.pop()).listed, false);
  } finally { fs.rmSync(bare, { recursive: true, force: true }); }
});

test('a reason beside a Publishing entry round-trips', () => {
  const v = vaultWith(['## Publishing (1 files)', '', '- [x] NPCs/Vex.md — stays hidden: x', ''].join('\n'));
  const r = convertPublishList(v);
  assert.equal(r.ok, true, r.blockers.join('\n'));
  const list = loadManifest(v);
  assert.deepEqual(list.publishing, ['NPCs/Vex.md']);
  assert.equal(list.reasons.get('NPCs/Vex.md'), 'stays hidden: x');
  assert.match(fs.readFileSync(file(v, 'publish-list.yaml'), 'utf8'), /path: NPCs\/Vex\.md/);
});

// ---- The site holds the list back -----------------------------------------------------------------------

function siteWith({ toolVersion = null, steps = {}, files = {}, pkgScripts = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'convert-site-'));
  fs.writeFileSync(path.join(dir, 'vault.config.json'), '{}');
  if (toolVersion) {
    const pkg = path.join(dir, 'node_modules', 'gm-apprentice-publish');
    fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ version: toolVersion }));
  }
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
  if (pkgScripts) fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: pkgScripts }));
  return { dir, config: path.join(dir, 'vault.config.json'), steps };
}
const unmanaged = () => ({ ok: true, ours: false, spec: '1.26.0', installedBefore: '1.26.0' });
const snapshotOf = (v) => fs.readdirSync(path.join(v, '_meta')).sort().map((f) => [f, fs.readFileSync(file(v, f), 'utf8')]);

test('a site tool older than 1.27.0 holds the list where it is', () => {
  const v = vaultWith(OLD);
  const s = siteWith({ toolVersion: '1.26.0' });
  const before = snapshotOf(v);
  for (const check of [true, false]) {
    const r = convertPublishList(v, { check, siteConfigPath: s.config, deps: { pinCheck: unmanaged } });
    assert.equal(r.ok, true);
    assert.equal(r.held, 'site-tool');
    assert.equal(r.lines[0], "stays in _meta/publish-manifest.md until the site's publish tool is 1.27.0 or later");
    assert.deepEqual(snapshotOf(v), before);
  }
});

test('a site tool the update is bringing up to date does not hold it', () => {
  const v = vaultWith(OLD);
  const s = siteWith({ toolVersion: '1.26.0' });
  const ours = () => ({ ok: false, ours: true, spec: 'file:plugin', installedBefore: '1.26.0' });
  const r = convertPublishList(v, { check: true, siteConfigPath: s.config, siteToolUpdated: true, deps: { pinCheck: ours } });
  assert.equal(r.held, false);
  assert.equal(r.ok, true);
});

test('a build step that reads the old file holds the list, naming the script', () => {
  const v = vaultWith(OLD);
  const s = siteWith({ files: { 'scripts/add-props.mjs': "readFileSync('../vault/_meta/publish-manifest.md')" }, pkgScripts: { postbuild: 'node scripts/add-props.mjs' } });
  const before = snapshotOf(v);
  const r = convertPublishList(v, { siteConfigPath: s.config, deps: { pinCheck: () => ({}) } });
  assert.equal(r.held, 'site-step');
  assert.match(r.lines[0], /^stays in _meta\/publish-manifest\.md: your build step scripts\/add-props\.mjs reads it\. Change the script to ask `gm-apprentice-publish manifest list --json`, then run the update again\.$/);
  assert.deepEqual(snapshotOf(v), before);
});

test('a build step set in the vault settings is searched too, and a clean script is not a hold', () => {
  const v = vaultWith(OLD);
  fs.writeFileSync(file(v, 'vault-config.yaml'), 'version: 1\nplayer_site:\n  after_build:\n    - node scripts/add-props.mjs\n');
  const dirty = siteWith({ files: { 'scripts/add-props.mjs': 'reads _meta/publish-manifest.md' } });
  assert.equal(convertPublishList(v, { check: true, siteConfigPath: dirty.config, deps: { pinCheck: () => ({}) } }).held, 'site-step');
  const clean = siteWith({ files: { 'scripts/add-props.mjs': 'asks the tool' } });
  const r = convertPublishList(v, { check: true, siteConfigPath: clean.config, deps: { pinCheck: () => ({}) } });
  assert.equal(r.held, false);
  assert.equal(r.ok, true);
});

test('a step word that leaves the site folder is not read', () => {
  const v = vaultWith(OLD);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'outside-'));
  fs.writeFileSync(path.join(outside, 'x.mjs'), 'publish-manifest.md');
  const s = siteWith({ pkgScripts: { postbuild: `node ${path.join(outside, 'x.mjs')}` } });
  assert.equal(convertPublishList(v, { check: true, siteConfigPath: s.config, deps: { pinCheck: () => ({}) } }).held, false);
});

test('a stop between the new file and setting the old aside leaves both; the next run finishes', () => {
  const v = vaultWith(OLD);
  const boom = () => { throw new Error('stopped'); };
  assert.throws(() => convertPublishList(v, { deps: { moveOld: boom } }), /stopped/);
  assert.equal(fs.existsSync(file(v, 'publish-manifest.md')), true);
  assert.equal(fs.existsSync(file(v, 'publish-list.yaml')), true);
  assert.equal(fs.existsSync(file(v, 'publish-list.yaml.convert')), false);
  const r = convertPublishList(v);
  assert.equal(r.ok, true);
  assert.equal(fs.existsSync(file(v, 'publish-manifest.md')), false);
  assert.equal(fs.existsSync(file(v, 'publish-list.yaml')), true);
});

test('the command takes --config: a step reading the old file holds the list and says so', async () => {
  const { runManifest } = require('../lib/manifest-cli');
  const v = vaultWith(OLD);
  const s = siteWith({ files: { 'build.mjs': 'publish-manifest.md' }, pkgScripts: { prebuild: 'node build.mjs' } });
  const lines = [];
  const d = { out: (t) => lines.push(t) };
  assert.equal(await runManifest({ verb: 'convert', vaultPath: v, configPath: s.config, check: true, json: true }, d), 0);
  const r = JSON.parse(lines.pop());
  assert.equal(r.held, 'site-step');
  assert.equal(await runManifest({ verb: 'convert', vaultPath: v, configPath: s.config }, d), 0);
  assert.match(lines.pop(), /^The publish list stays in _meta\/publish-manifest\.md: your build step build\.mjs reads it/);
  assert.equal(fs.existsSync(file(v, 'publish-manifest.md')), true);
});

test('without --config the site folder the vault names is asked: a step reading the old file holds the list', () => {
  const s = siteWith({ files: { 'scripts/add-props.mjs': 'publish-manifest.md' }, pkgScripts: { postbuild: 'node scripts/add-props.mjs' } });
  const v = vaultWith(OLD);
  fs.writeFileSync(file(v, 'vault-config.yaml'), `version: 1\nplayer_site:\n  folder: ${JSON.stringify(s.dir)}\n`);
  const before = snapshotOf(v);
  const r = convertPublishList(v, { deps: { pinCheck: () => ({}) } });
  assert.equal(r.held, 'site-step');
  assert.deepEqual(snapshotOf(v), before);
});

// ---- Nothing the GM wrote is lost (review C2, I1) ---------------------------------------------------------

const WRITTEN = [
  '---', 'mode: player', '---', '',
  'A paragraph the GM wrote.', '',
  '## Publishing (2 files)', '', '- [x] NPCs/Vex.md', '- [ ] NPCs/Later.md — not ready yet', '',
  '## Excluded (2 files)', '', '- [x] Sessions/Next.md — prep', '- [ ] Drafts/Unticked Excl.md — spoils the twist', '',
  '## Needs Decision (2 files)', '', '- [ ] Drafts/Idea.md — waiting on Sam', '- [x] Drafts/Resolved.md — decided: keep it hidden', '',
  '## Notes', '', 'Free prose.', '',
].join('\n');

test('an unticked Excluded entry stays excluded, with its reason', () => {
  const v = vaultWith(WRITTEN);
  const r = convertPublishList(v);
  assert.equal(r.ok, true, r.blockers.join('\n'));
  const list = loadManifest(v, { warn: () => {} });
  assert.ok(list.excluded.includes('Drafts/Unticked Excl.md'), list.excluded.join(', '));
  assert.equal(list.reasons.get('Drafts/Unticked Excl.md'), 'spoils the twist');
});

test('a reason beside a needs-decision entry is kept, and an unticked Publishing entry keeps its reason', () => {
  const v = vaultWith(WRITTEN);
  assert.equal(convertPublishList(v).ok, true);
  const list = loadManifest(v, { warn: () => {} });
  assert.deepEqual(list.needsDecision, ['Drafts/Idea.md', 'Drafts/Resolved.md', 'NPCs/Later.md']);
  assert.equal(list.reasons.get('Drafts/Idea.md'), 'waiting on Sam');
  assert.equal(list.reasons.get('Drafts/Resolved.md'), 'decided: keep it hidden');
  assert.equal(list.reasons.get('NPCs/Later.md'), 'not ready yet');
  assert.match(fs.readFileSync(file(v, 'publish-list.yaml'), 'utf8'), /needs_decision:\n {2}- path: Drafts\/Idea\.md\n {4}reason: waiting on Sam\n/);
});

test('the old file, prose and all, is kept beside the new one and is never read as a note or a list', () => {
  const v = vaultWith(WRITTEN);
  assert.equal(convertPublishList(v).ok, true);
  assert.equal(fs.readFileSync(file(v, 'publish-manifest.md.converted'), 'utf8'), WRITTEN);
  const warned = [];
  loadManifest(v, { warn: (m) => warned.push(m) });
  assert.deepEqual(warned.filter((m) => /left over/.test(m)), []);
  const { listVaultMarkdown } = require('../lib/manifest-cli');
  assert.equal(listVaultMarkdown(v, []).some((rel) => rel.includes('publish-manifest')), false);
});

test('a second conversion never overwrites an earlier kept copy', () => {
  const v = vaultWith(OLD);
  assert.equal(convertPublishList(v).ok, true);
  fs.rmSync(file(v, 'publish-list.yaml'));
  fs.writeFileSync(file(v, 'publish-manifest.md'), WRITTEN);
  assert.equal(convertPublishList(v).ok, true);
  assert.equal(fs.readFileSync(file(v, 'publish-manifest.md.converted'), 'utf8'), OLD);
  assert.equal(fs.readFileSync(file(v, 'publish-manifest.md.converted.2'), 'utf8'), WRITTEN);
});

test('the check counts every path line of the old file, not what the readers parse', () => {
  const { lostFromOld } = require('../lib/publish-list-convert');
  const text = ['## Excluded (1 files)', '', '- [ ] Drafts/A.md — why', '- Reason: old', '  - Archive/B.md', '', '## Notes', '', '- not a path line', ''].join('\n');
  assert.deepEqual(lostFromOld(text, { publishing: [], excluded: ['Archive/B.md'], needsDecision: [] }), ['Drafts/A.md']);
  assert.deepEqual(lostFromOld(text, { publishing: [], excluded: ['Archive/B.md'], needsDecision: ['Drafts/A.md'] }), []);
});

test('manifest list --json on an unconverted vault keeps the reasons the old reader finds', async () => {
  const { runManifest } = require('../lib/manifest-cli');
  const v = vaultWith(['## Publishing (1 files)', '', '- [x] NPCs/Vex.md — stays hidden: x', '',
    '## Excluded (2 files)', '', '- [x] Sessions/Next.md — prep', '- Reason: old notes', '  - Archive/Old.md', ''].join('\n'));
  const lines = [];
  assert.equal(await runManifest({ verb: 'list', vaultPath: v, json: true }, { out: (t) => lines.push(t) }), 0);
  const payload = JSON.parse(lines.pop());
  assert.deepEqual(payload.publishing_reasons, { 'NPCs/Vex.md': 'stays hidden: x' });
  assert.deepEqual(payload.excluded, [{ path: 'Sessions/Next.md', reason: 'prep' }, { path: 'Archive/Old.md', reason: 'old notes' }]);
  assert.equal(fs.existsSync(file(v, 'publish-manifest.md')), true, 'listing moves nothing');
});

test('a read-back that loses a path line refuses, and the old file stays', () => {
  const v = vaultWith(WRITTEN);
  const drop = (list) => ({ ...list, excluded: list.excluded.filter((rel) => rel !== 'Drafts/Unticked Excl.md') });
  const r = convertPublishList(v, { deps: { readBack: drop } });
  assert.equal(r.ok, false);
  assert.match(r.blockers.join('\n'), /Drafts\/Unticked Excl\.md/);
  assert.equal(fs.readFileSync(file(v, 'publish-manifest.md'), 'utf8'), WRITTEN);
  assert.equal(fs.existsSync(file(v, 'publish-list.yaml')), false);
});

test('a commented-out entry is left out of the new list, and the report says so (#498)', () => {
  const text = [
    '---', 'type: meta', '---', '',
    '## Publishing (3 files)', '', '- [x] NPCs/Vex.md', '%%', '- [x] NPCs/Hidden.md', '%%', '<!-- - [x] NPCs/Old.md -->', '',
    '## Excluded (0 files)', '',
  ].join('\n');
  const v = vaultWith(text);
  const r = convertPublishList(v);
  assert.equal(r.ok, true, r.blockers.join('\n'));
  const list = loadManifest(v);
  assert.deepEqual(list.publishing, ['NPCs/Vex.md']);
  assert.deepEqual(list.needsDecision, []);
  assert.ok(!fs.readFileSync(file(v, 'publish-list.yaml'), 'utf8').includes('Hidden'));
  assert.ok(r.lines.includes('2 entries commented out with %% or <!-- --> are left out: they were hidden in Obsidian and are not published.'), r.lines.join('\n'));
});
