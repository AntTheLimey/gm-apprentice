'use strict';
// `manifest hidden` (#500): a vault converted before 1.48.2 may still publish, in _meta/publish-list.yaml, a page whose
// line in the old _meta/publish-manifest.md was hidden by `%%` or `<!-- -->`. The old text survives as
// _meta/publish-manifest.md.converted. The command names each path the #498 comment rule hides there that the list
// still publishes, and `--decide` moves them to needs_decision, the file's comments and order kept.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runManifest } = require('../lib/manifest-cli');
const { commentHiddenEntries } = require('../lib/manifest-legacy');
const { loadManifest, moveToNeedsDecision } = require('../lib/manifest');

const made = [];
after(() => made.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

const CONVERTED = `---
type: meta
---
# Publish Manifest

## Publishing (6 files)

- [x] NPCs/Mara.md
%%
- [x] NPCs/Secret One.md
%%
<!--
- [x] NPCs/Secret Two.md — the twist
-->
- [x] Locations/Harbour.md
%% - [x] NPCs/Inline.md %%
%%
- [x] NPCs/Again.md
- [x] NPCs/Gone.md
%%
- [x] NPCs/Again.md

## Needs Decision (0 files)

## Excluded (0 files)
`;

// What the old convert wrote (the commented lines published), with a comment the GM added since.
const LIST = `# The campaign's publish list
publishing:
  - Locations/Harbour.md
  - NPCs/Again.md
  - NPCs/Mara.md
  # carried over from the old file
  - NPCs/Secret One.md
  - path: NPCs/Secret Two.md
    reason: the twist
excluded:
  - path: Drafts/Idea.md
    reason: prep
needs_decision:
  - Sessions/Session 09.md # undecided
`;

function vault({ converted = CONVERTED, list = LIST } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-hidden-'));
  made.push(dir);
  fs.mkdirSync(path.join(dir, '_meta'));
  if (converted !== null) fs.writeFileSync(path.join(dir, '_meta', 'publish-manifest.md.converted'), converted);
  if (list !== null) fs.writeFileSync(path.join(dir, '_meta', 'publish-list.yaml'), list);
  return dir;
}

async function run(args) {
  const out = [];
  const code = await runManifest({ verb: 'hidden', json: true, ...args }, { out: (l) => out.push(String(l)) });
  return { code, data: JSON.parse(out.join('\n')) };
}

// A line that starts with its comment marker (the inline shape) was never read as ticked, before 1.48.2 or since.
test('the entries a comment hides are the ones the old reader read and the comment rule does not', () => {
  assert.deepEqual(commentHiddenEntries(CONVERTED).publishing, ['NPCs/Secret One.md', 'NPCs/Secret Two.md', 'NPCs/Gone.md']);
  assert.deepEqual(commentHiddenEntries('## Publishing\n\n- [x] A.md\n').publishing, []);
});

test('a %%-hidden and a <!-- -->-hidden entry still under publishing are named; one also ticked elsewhere, or no longer listed, is not', async () => {
  const dir = vault();
  const { code, data } = await run({ vaultPath: dir });
  assert.equal(code, 0);
  assert.equal(data.converted, true);
  assert.deepEqual(data.hidden, ['NPCs/Secret One.md', 'NPCs/Secret Two.md', 'NPCs/Gone.md']);
  assert.deepEqual(data.publishing, ['NPCs/Secret One.md', 'NPCs/Secret Two.md']);
  assert.deepEqual(data.moved, []);
  assert.equal(fs.readFileSync(path.join(dir, '_meta', 'publish-list.yaml'), 'utf8'), LIST, 'the check writes nothing');
});

test('--decide moves them to needs_decision, keeping the file\'s comments, order and reasons', async () => {
  const dir = vault();
  const { code, data } = await run({ vaultPath: dir, decide: true });
  assert.equal(code, 0);
  assert.deepEqual(data.moved, ['NPCs/Secret One.md', 'NPCs/Secret Two.md']);
  const text = fs.readFileSync(path.join(dir, '_meta', 'publish-list.yaml'), 'utf8');
  assert.equal(text, `# The campaign's publish list
publishing:
  - Locations/Harbour.md
  - NPCs/Again.md
  - NPCs/Mara.md
excluded:
  - path: Drafts/Idea.md
    reason: prep
needs_decision:
  - Sessions/Session 09.md # undecided
  # carried over from the old file
  - NPCs/Secret One.md
  - path: NPCs/Secret Two.md
    reason: the twist
`);
  const list = loadManifest(dir, { warn: () => {} });
  assert.deepEqual(list.publishing, ['Locations/Harbour.md', 'NPCs/Again.md', 'NPCs/Mara.md']);
  assert.deepEqual(list.needsDecision, ['Sessions/Session 09.md', 'NPCs/Secret One.md', 'NPCs/Secret Two.md']);
  // Asked again, nothing is left to move.
  assert.deepEqual((await run({ vaultPath: dir })).data.publishing, []);
});

test('an empty or missing needs_decision is made a block list', () => {
  const dir = vault({ list: 'publishing:\n  - A.md\n  - B.md\nexcluded: []\nneeds_decision: []\n' });
  moveToNeedsDecision(dir, ['B.md']);
  assert.equal(fs.readFileSync(path.join(dir, '_meta', 'publish-list.yaml'), 'utf8'), 'publishing:\n  - A.md\nexcluded: []\nneeds_decision:\n  - B.md\n');
  const bare = vault({ list: 'publishing:\n  - A.md\n  - B.md\n' });
  moveToNeedsDecision(bare, ['A.md']);
  assert.deepEqual(loadManifest(bare, { warn: () => {} }).needsDecision, ['A.md']);
  assert.deepEqual(loadManifest(bare, { warn: () => {} }).publishing, ['B.md']);
});

const read = (dir) => fs.readFileSync(path.join(dir, '_meta', 'publish-list.yaml'), 'utf8');

test('a page also under excluded leaves publishing and stays excluded; one already under needs_decision just leaves publishing', () => {
  const dir = vault({ list: 'publishing:\n  - A.md\n  - B.md\n  - C.md\nexcluded:\n  - path: A.md\n    reason: x\nneeds_decision:\n  - B.md\n  - D.md\n' });
  const moved = moveToNeedsDecision(dir, ['A.md', 'B.md']);
  assert.deepEqual(moved, [{ path: 'A.md', now: 'excluded' }, { path: 'B.md', now: 'needs_decision' }]);
  assert.equal(read(dir), 'publishing:\n  - C.md\nexcluded:\n  - path: A.md\n    reason: x\nneeds_decision:\n  - B.md\n  - D.md\n');
  const list = loadManifest(dir, { warn: () => {} });
  assert.deepEqual(list.publishing, ['C.md']);
  assert.deepEqual(list.excluded, ['A.md']);
  assert.deepEqual(list.needsDecision, ['B.md', 'D.md']);
});

test('the CLI names where each page went', async () => {
  const dir = vault({ list: 'publishing:\n  - NPCs/Secret One.md\n  - NPCs/Secret Two.md\nexcluded:\n  - NPCs/Secret Two.md\n' });
  const { data } = await run({ vaultPath: dir, decide: true });
  assert.deepEqual(data.moved, ['NPCs/Secret One.md', 'NPCs/Secret Two.md']);
  assert.deepEqual(data.now, { 'NPCs/Secret One.md': 'needs_decision', 'NPCs/Secret Two.md': 'excluded' });
});

test('the comment above the first entry moves with it', () => {
  const dir = vault({ list: 'publishing:\n  # keep off: spoiler\n  - B.md\n  # about A\n  - A.md\nneeds_decision: []\n' });
  moveToNeedsDecision(dir, ['B.md']);
  assert.equal(read(dir), 'publishing:\n  # about A\n  - A.md\nneeds_decision:\n  # keep off: spoiler\n  - B.md\n');
});

test('the file keeps its line ends and its indentation', () => {
  const crlf = vault({ list: '# list\r\npublishing:\r\n  - A.md\r\n  - B.md\r\nneeds_decision:\r\n  - C.md\r\n' });
  moveToNeedsDecision(crlf, ['B.md']);
  assert.equal(read(crlf), '# list\r\npublishing:\r\n  - A.md\r\nneeds_decision:\r\n  - C.md\r\n  - B.md\r\n');
  const flat = vault({ list: 'publishing:\n- A.md\n- B.md\nneeds_decision:\n- C.md\n' });
  moveToNeedsDecision(flat, ['A.md']);
  assert.equal(read(flat), 'publishing:\n- B.md\nneeds_decision:\n- C.md\n- A.md\n');
  const wide = vault({ list: 'publishing:\n    - A.md\n    - B.md\n' });
  moveToNeedsDecision(wide, ['A.md']);
  assert.equal(read(wide), 'publishing:\n    - B.md\nneeds_decision:\n    - A.md\n');
});

test('moving a path the list does not publish is refused, and the file is left as it was', () => {
  const dir = vault();
  assert.throws(() => moveToNeedsDecision(dir, ['NPCs/Gone.md']), /NPCs\/Gone\.md is not under publishing/);
  assert.equal(fs.readFileSync(path.join(dir, '_meta', 'publish-list.yaml'), 'utf8'), LIST);
});

test('a vault without the .converted file, or without a publish-list.yaml, has nothing to name', async () => {
  const none = await run({ vaultPath: vault({ converted: null }) });
  assert.equal(none.code, 0);
  assert.deepEqual(none.data, { converted: false, hidden: [], publishing: [], moved: [], now: {} });
  const noList = await run({ vaultPath: vault({ list: null }) });
  assert.deepEqual(noList.data.publishing, []);
});

test('the command needs --vault', async () => {
  const out = [];
  assert.equal(await runManifest({ verb: 'hidden' }, { out: (l) => out.push(l) }), 1);
  assert.match(out.join('\n'), /--vault/);
});
