'use strict';
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const manifest = require('../../lib/manifest');
const { loadManifest, listText, writePublishList, counts } = manifest;
const { decidePage } = require('../../lib/publish-decision');

const SHAPE = [
  'publishing:',
  '  - Characters/NPCs/Vex.md',
  'excluded:',
  '  - path: Sessions/Session 09.md',
  '    reason: prep',
  '  - path: NPCs/Old.md',
  'needs_decision:',
  '  - Drafts/Idea.md',
  '',
].join('\n');

function vaultWith(files) {
  const v = fs.mkdtempSync(path.join(os.tmpdir(), 'publist-'));
  fs.mkdirSync(path.join(v, '_meta'));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(v, '_meta', name), text);
  return v;
}
const read = (v, opts) => {
  const warnings = [];
  const list = loadManifest(v, { warn: (m) => warnings.push(m), ...opts });
  return { list, warnings };
};

describe('the YAML publish list', () => {
  beforeEach(() => manifest.resetNotices());

  it('reads the documented shape', () => {
    const { list, warnings } = read(vaultWith({ 'publish-list.yaml': SHAPE }));
    assert.deepEqual(warnings, []);
    assert.equal(list.file, 'new');
    assert.deepEqual(list.publishing, ['Characters/NPCs/Vex.md']);
    assert.deepEqual(list.excluded, ['Sessions/Session 09.md', 'NPCs/Old.md']);
    assert.deepEqual(list.needsDecision, ['Drafts/Idea.md']);
    assert.deepEqual([...list.reasons], [['Sessions/Session 09.md', 'prep']]);
  });

  it('a missing file is null', () => {
    assert.equal(loadManifest(vaultWith({})), null);
  });

  it('invalid YAML throws, naming the file', () => {
    const v = vaultWith({ 'publish-list.yaml': 'publishing: [unclosed\n' });
    assert.throws(() => loadManifest(v), /^Error: _meta\/publish-list\.yaml is not valid YAML: /);
  });

  it('a plain text entry under excluded reads as a path with no reason', () => {
    const { list } = read(vaultWith({ 'publish-list.yaml': 'excluded:\n  - NPCs/A.md\n' }));
    assert.deepEqual(list.excluded, ['NPCs/A.md']);
    assert.equal(list.reasons.size, 0);
  });

  it('drops an entry that is not text, with a warning', () => {
    const { list, warnings } = read(vaultWith({ 'publish-list.yaml': 'publishing:\n  - 42\n  - NPCs/A.md\nexcluded:\n  - path: 7\n' }));
    assert.deepEqual(list.publishing, ['NPCs/A.md']);
    assert.deepEqual(list.excluded, []);
    assert.equal(warnings.length, 2);
  });

  it('warns once for an unknown top-level key and ignores it', () => {
    const { list, warnings } = read(vaultWith({ 'publish-list.yaml': 'publishing: []\nbogus: 1\n' }));
    assert.deepEqual(list.publishing, []);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /bogus/);
  });

  it('a path in publishing and excluded: publishing wins, one warning', () => {
    const { list, warnings } = read(vaultWith({ 'publish-list.yaml': 'publishing:\n  - A.md\nexcluded:\n  - A.md\n' }));
    assert.deepEqual(list.publishing, ['A.md']);
    assert.deepEqual(list.excluded, []);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /A\.md/);
  });

  it('reads paths in NFC', () => {
    const nfd = 'Café.md';
    const { list } = read(vaultWith({ 'publish-list.yaml': `publishing:\n  - ${nfd}\n` }));
    assert.deepEqual(list.publishing, [nfd.normalize('NFC')]);
  });

  it('old file only: reads it, and says so once per process', () => {
    const v = vaultWith({ 'publish-manifest.md': '## Publishing (1 files)\n\n- [x] A.md\n' });
    const first = read(v);
    assert.equal(first.list.file, 'old');
    assert.deepEqual(first.list.publishing, ['A.md']);
    assert.equal(first.warnings.length, 1);
    assert.match(first.warnings[0], /still in _meta\/publish-manifest\.md/);
    assert.equal(read(v).warnings.length, 0);
  });

  it('old file only: a reason beside a Needs Decision entry is read', () => {
    const v = vaultWith({ 'publish-manifest.md': '## Needs Decision (1 files)\n\n- [ ] Drafts/Idea.md — ask the players\n' });
    const { list } = read(v);
    assert.deepEqual(list.needsDecision, ['Drafts/Idea.md']);
    assert.deepEqual([...list.reasons], [['Drafts/Idea.md', 'ask the players']]);
  });

  it('both files: reads the new one and warns the old is left over', () => {
    const v = vaultWith({ 'publish-manifest.md': '## Publishing (1 files)\n\n- [x] Old.md\n', 'publish-list.yaml': 'publishing:\n  - New.md\n' });
    const { list, warnings } = read(v);
    assert.equal(list.file, 'new');
    assert.deepEqual(list.publishing, ['New.md']);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /left over/);
  });

  it('listText round-trips', () => {
    const v = vaultWith({ 'publish-list.yaml': SHAPE });
    const { list } = read(v);
    const text = listText(list);
    const v2 = vaultWith({ 'publish-list.yaml': text });
    const again = read(v2).list;
    assert.deepEqual(again.publishing, list.publishing.slice().sort());
    assert.deepEqual(again.excluded.slice().sort(), list.excluded.slice().sort());
    assert.deepEqual(again.needsDecision, list.needsDecision);
    assert.deepEqual([...again.reasons], [...list.reasons]);
  });

  it('listText keeps long paths on one line and sorts', () => {
    const long = `Characters/${'x'.repeat(120)}.md`;
    const text = listText({ publishing: [long, 'A.md'], excluded: [], needsDecision: [], reasons: new Map() });
    assert.ok(text.includes(`- ${long}`));
    assert.ok(text.indexOf('A.md') < text.indexOf(long));
  });

  it('writePublishList writes the file, and counts counts', () => {
    const v = vaultWith({});
    const list = { publishing: ['A.md'], excluded: ['B.md'], needsDecision: [], reasons: new Map([['B.md', 'why']]) };
    writePublishList(v, list);
    const back = read(v).list;
    assert.deepEqual(back.excluded, ['B.md']);
    assert.equal(back.reasons.get('B.md'), 'why');
    assert.deepEqual(counts(list), { publishing: 1, excluded: 1, needsDecision: 0 });
  });

  it('decidePage words its reasons for the publish list', () => {
    const list = { publishing: [], excluded: ['X.md'], needsDecision: ['Y.md'], reasons: new Map() };
    const page = (rel) => decidePage({ frontmatter: { type: 'npc' } }, { rel, manifest: list, publishConfig: { mode: 'player' } });
    assert.equal(page('X.md').reason, 'publish list: excluded');
    assert.equal(page('Y.md').reason, 'publish list: needs a decision');
    assert.equal(page('Z.md').reason, 'not on the publish list');
  });
});

describe('a reason beside a publishing entry', () => {
  beforeEach(() => manifest.resetNotices());
  it('is read, written back and kept', () => {
    const v = vaultWith({ 'publish-list.yaml': 'publishing:\n  - path: A.md\n    reason: "stays hidden: x"\n  - B.md\n' });
    const { list, warnings } = read(v);
    assert.deepEqual(warnings, []);
    assert.deepEqual(list.publishing, ['A.md', 'B.md']);
    assert.equal(list.reasons.get('A.md'), 'stays hidden: x');
    const again = read(vaultWith({ 'publish-list.yaml': listText(list) })).list;
    assert.equal(again.reasons.get('A.md'), 'stays hidden: x');
    assert.ok(listText(list).includes('  - B.md\n'));
  });
});
