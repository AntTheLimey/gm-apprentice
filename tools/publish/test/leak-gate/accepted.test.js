'use strict';
// tools/publish/test/leak-gate/accepted.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadManifest, loadPublishList, listText, writeAccepted, resetNotices } = require('../../lib/manifest');
const { leakSite, hashTree } = require('../helpers/leak-site');

const vaultWith = (text) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lg-acc-'));
  fs.mkdirSync(path.join(dir, '_meta'));
  if (text !== null) fs.writeFileSync(path.join(dir, '_meta', 'publish-list.yaml'), text);
  return dir;
};

describe('the publish list: accepted', () => {
  it('reads accepted entries and knows the key', () => {
    resetNotices();
    const warnings = [];
    const dir = vaultWith('publishing:\n  - A.md\naccepted:\n  - page: npcs/a.html\n    text: the baker is a kind man\n    note: NPCs/A.md\n  - page: npcs/b.html\n');
    try {
      const list = loadManifest(dir, { warn: (m) => warnings.push(m) });
      assert.deepEqual(list.accepted, [{ page: 'npcs/a.html', text: 'the baker is a kind man', note: 'NPCs/A.md' }]);
      assert.equal(warnings.length, 1);
      assert.match(warnings[0], /accepted/);
      assert.ok(!warnings.some((w) => /is not a section/.test(w)));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it('an absent accepted is an empty list, and a list without it is written as today', () => {
    const dir = vaultWith('publishing:\n  - A.md\n');
    try {
      const list = loadManifest(dir, { warn: () => {} });
      assert.deepEqual(list.accepted, []);
      assert.equal(listText(list), listText({ ...list, accepted: undefined }));
      assert.ok(!/accepted/.test(listText(list)));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it('writeAccepted writes the entries sorted and keeps the three lists', () => {
    const dir = vaultWith('publishing:\n  - A.md\nexcluded:\n  - path: B.md\n    reason: prep\n');
    try {
      writeAccepted(dir, [{ page: 'z.html', text: 'b b b b', note: 'Z.md' }, { page: 'a.html', text: 'a a a a', note: 'A.md' }]);
      const list = loadManifest(dir, { warn: () => {} });
      assert.deepEqual(list.publishing, ['A.md']);
      assert.deepEqual(list.excluded, ['B.md']);
      assert.deepEqual(list.accepted.map((a) => a.page), ['a.html', 'z.html']);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it('writeAccepted refuses a vault whose list is not moved yet', () => {
    const dir = vaultWith(null);
    fs.writeFileSync(path.join(dir, '_meta', 'publish-manifest.md'), '## Publishing\n\n- [x] A.md\n');
    try {
      assert.throws(() => writeAccepted(dir, []), /update|manifest convert/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('the publish list: a vault with no list can accept (amendment 7a)', () => {
  const ENTRY = { page: 'npcs/a.html', text: 'the baker is a kind man', note: 'NPCs/A.md' };
  it('writeAccepted creates the file holding only accepted', () => {
    const dir = vaultWith(null);
    try {
      writeAccepted(dir, [ENTRY]);
      const text = fs.readFileSync(path.join(dir, '_meta', 'publish-list.yaml'), 'utf8');
      assert.match(text, /^accepted:/);
      assert.ok(!/publishing|excluded|needs_decision/.test(text));
      assert.deepEqual(loadPublishList(dir, { warn: () => {} }).accepted, [ENTRY]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it('loadManifest treats such a file as no publish list, so page decisions are unchanged', () => {
    const dir = vaultWith(null);
    try {
      assert.equal(loadManifest(dir, { warn: () => {} }), null);
      writeAccepted(dir, [ENTRY]);
      assert.equal(loadManifest(dir, { warn: () => {} }), null);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it('emptying it keeps it accepted-only: it never becomes an empty publish list', () => {
    const dir = vaultWith(null);
    try {
      writeAccepted(dir, [ENTRY]);
      writeAccepted(dir, []);
      assert.equal(loadManifest(dir, { warn: () => {} }), null);
      assert.deepEqual(loadPublishList(dir, { warn: () => {} }).accepted, []);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it('a file with a publishing list is still a publish list', () => {
    const dir = vaultWith('publishing: []\n');
    try { assert.ok(loadManifest(dir, { warn: () => {} })); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it('a vault with no list builds the same site before and after an accept', () => {
    const notes = {
      'NPCs/A.md': '---\ntype: npc\n---\nThe baker is a kind man.\n',
      'NPCs/B.md': '---\ntype: npc\n---\nA fisher.\n',
    };
    const before = leakSite(notes, { player: { folder_map: { NPCs: 'npcs' } } });
    const after = leakSite({ ...notes, '_meta/publish-list.yaml': 'accepted:\n  - page: npcs/b.html\n    text: the baker poisoned the mayor\n    note: NPCs/A.md\n' }, { player: { folder_map: { NPCs: 'npcs' } } });
    try {
      assert.ok(after.player.exists('npcs', 'a.html') && after.player.exists('npcs', 'b.html'));
      assert.equal(hashTree(after.outputDir), hashTree(before.outputDir));
    } finally { before.cleanup(); after.cleanup(); }
  });
});
