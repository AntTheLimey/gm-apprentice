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

test('converts all of it, then removes the old file', () => {
  const v = vaultWith(OLD);
  const r = convertPublishList(v);
  assert.equal(r.ok, true);
  assert.equal(fs.existsSync(file(v, 'publish-manifest.md')), false);
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

test('a stop between the rename and the removal is finished by the next run', () => {
  const v = vaultWith(OLD);
  assert.throws(() => convertPublishList(v, { deps: { removeOld: () => { throw new Error('stopped'); } } }), /stopped/);
  assert.ok(fs.existsSync(file(v, 'publish-list.yaml')) && fs.existsSync(file(v, 'publish-manifest.md')));
  const again = convertPublishList(v);
  assert.equal(again.ok, true);
  assert.equal(fs.existsSync(file(v, 'publish-manifest.md')), false);
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
  assert.deepEqual(payload.publishing, ['NPCs/Vex.md']);
  assert.deepEqual(payload.excluded.map((e) => e.path).sort(), ['Archive/Old.md', 'Sessions/Next.md']);
  assert.deepEqual(payload.counts, { publishing: 1, excluded: 2, needs_decision: 3 });
  assert.equal(await runManifest({ verb: 'list' }, d), 1);
});
