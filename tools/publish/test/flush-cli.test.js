const { test } = require('node:test');
const assert = require('node:assert');
const { runFlush } = require('../lib/flush-cli');

// Fake KV adapter: getStates does one get for the roster then one per member.
function fakeAdapter(map) {
  return { async get(key) { return key in map ? map[key] : null; } };
}

const CONFIG = { vaultPath: '/vault', siteTitle: 'Test Campaign', excludeDirs: [], folderMap: {} };

const JANE_MD = [
  '### Derived', '', '| Attribute | Max | Current |', '|--|--|--|',
  '| HP | 11 | 11 |', '',
  '### Status', '', '- [ ] Dying', '',
].join('\n');

function pages() {
  return [
    { sourcePath: '/vault/PCs/Jane_Ashford.md', title: 'Jane_Ashford', displayTitle: 'Jane Ashford', frontmatter: { type: 'pc' } },
    { sourcePath: '/vault/NPCs/Gatekeeper.md', title: 'Gatekeeper', displayTitle: 'Gatekeeper', frontmatter: { type: 'npc' } },
  ];
}

function run(over = {}) {
  const writes = {};
  const lines = [];
  const adapter = fakeAdapter({
    'roster:test-campaign': JSON.stringify(['loadout:test-campaign:jane-ashford:ABCD', 'loadout:test-campaign:ghost:ZZZZ']),
    'loadout:test-campaign:jane-ashford:ABCD': JSON.stringify({ hp: 7, conditions: { dying: true }, updatedAt: 5 }),
    'loadout:test-campaign:ghost:ZZZZ': JSON.stringify({ hp: 3, conditions: {}, updatedAt: 9 }),
  });
  const deps = Object.assign({
    config: CONFIG, adapter, scan: pages,
    readFile: (p) => (p === '/vault/PCs/Jane_Ashford.md' ? JANE_MD : ''),
    writeFile: (p, s) => { writes[p] = s; },
    out: (m) => lines.push(String(m)),
  }, over);
  return { promise: runFlush(deps), writes, lines };
}

test('flush writes the newest blob into the matching PC sheet only', async () => {
  const r = run();
  const code = await r.promise;
  assert.equal(code, 0);
  assert.ok(r.writes['/vault/PCs/Jane_Ashford.md'], 'Jane sheet written');
  assert.match(r.writes['/vault/PCs/Jane_Ashford.md'], /\| HP \| 11 \| 7 \|/);
  assert.match(r.writes['/vault/PCs/Jane_Ashford.md'], /- \[x\] \*\*Dying\*\*/);
  assert.ok(r.lines.some((l) => /Jane Ashford/.test(l) && /HP 11→7/.test(l)));
});

test('flush warns for a KV slug with no matching vault sheet', async () => {
  const r = run();
  await r.promise;
  assert.ok(r.lines.some((l) => /ghost/.test(l) && /no matching vault sheet/.test(l)));
  assert.equal(r.writes['/vault/NPCs/Gatekeeper.md'], undefined); // NPCs untouched
});

test('flush reports nothing to flush when the roster is empty', async () => {
  const r = run({ adapter: fakeAdapter({ 'roster:test-campaign': '[]' }) });
  const code = await r.promise;
  assert.equal(code, 0);
  assert.equal(Object.keys(r.writes).length, 0);
  assert.ok(r.lines.some((l) => /no players have saved/.test(l)));
});

test('flush returns non-zero and writes nothing when the KV read fails', async () => {
  const boom = { async get() { throw new Error('Authentication error [code: 10000]'); } };
  const r = run({ adapter: boom });
  const code = await r.promise;
  assert.equal(code, 1);
  assert.equal(Object.keys(r.writes).length, 0);
  assert.ok(r.lines.some((l) => /Could not read live state/.test(l)));
});

test('flush does not write when the sheet already holds the values', async () => {
  const already = [
    '### Derived', '', '| Attribute | Max | Current |', '|--|--|--|',
    '| HP | 11 | 7 |', '', '### Status', '', '- [x] **Dying**', '',
  ].join('\n');
  const r = run({ readFile: () => already });
  await r.promise;
  assert.equal(r.writes['/vault/PCs/Jane_Ashford.md'], undefined);
  assert.ok(r.lines.some((l) => /Jane Ashford/.test(l) && /no change/.test(l)));
});
