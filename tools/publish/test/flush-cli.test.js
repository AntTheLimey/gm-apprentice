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

test('routes a GURPS PC to the GURPS writeback (injects HP/FP)', async () => {
  const KARL = [
    '---', 'type: pc', 'system: gurps-4e', '---',
    '## Stat Sheet', '',
    '### Primary Attributes', '',
    '| Attribute | Score | Modifier | Cost |', '|--|--|--|--|',
    '| ST | 11 | — | [10] |', '| HT | 11 | — | [10] |', '',
    '### Secondary Characteristics', '',
    '| Characteristic | Value |', '|--|--|', '| HP | 11 |', '| FP | 11 |', '',
    '## Current Status', '', '**Condition:** Unharmed.', '',
  ].join('\n');
  const writes = {};
  const lines = [];
  const adapter = fakeAdapter({
    'roster:gurps-camp': JSON.stringify(['loadout:gurps-camp:karl-brenner:ABCD']),
    'loadout:gurps-camp:karl-brenner:ABCD': JSON.stringify({ hp: 7, fp: 9, updatedAt: 5 }),
  });
  const rc = await runFlush({
    config: { vaultPath: '/vault', siteTitle: 'GURPS Camp', system: 'gurps-4e', excludeDirs: [], folderMap: {} },
    adapter,
    scan: () => [{ sourcePath: '/vault/PCs/Karl.md', title: 'Karl_Brenner', displayTitle: 'Karl Brenner', frontmatter: { type: 'pc', system: 'gurps-4e' } }],
    readFile: () => KARL,
    writeFile: (p, s) => { writes[p] = s; },
    out: (m) => lines.push(String(m)),
  });
  assert.strictEqual(rc, 0);
  assert.match(writes['/vault/PCs/Karl.md'], /\*\*HP:\*\* 7\/11/);
  assert.match(writes['/vault/PCs/Karl.md'], /\*\*FP:\*\* 9\/11/);
});

test('routes a GURPS PC when system comes only from publishConfig (_meta/vault-config.md), not vault.config.json or frontmatter', async () => {
  const KARL = [
    '---', 'type: pc', '---',                       // NOTE: no `system` in frontmatter
    '## Stat Sheet', '',
    '### Primary Attributes', '',
    '| Attribute | Score | Modifier | Cost |', '|--|--|--|--|',
    '| ST | 11 | — | [10] |', '| HT | 11 | — | [10] |', '',
    '### Secondary Characteristics', '',
    '| Characteristic | Value |', '|--|--|', '| HP | 11 |', '| FP | 11 |', '',
    '## Current Status', '', '**Condition:** Unharmed.', '',
  ].join('\n');
  const writes = {};
  const lines = [];
  const adapter = fakeAdapter({
    'roster:gurps-camp': JSON.stringify(['loadout:gurps-camp:karl-brenner:ABCD']),
    'loadout:gurps-camp:karl-brenner:ABCD': JSON.stringify({ hp: 7, fp: 9, updatedAt: 5 }),
  });
  const rc = await runFlush({
    config: { vaultPath: '/vault', siteTitle: 'GURPS Camp', excludeDirs: [], folderMap: {} }, // NOTE: no `system`
    publishConfig: { system: 'gurps-4e' },          // system as _meta/vault-config.md would supply it
    adapter,
    scan: () => [{ sourcePath: '/vault/PCs/Karl.md', title: 'Karl_Brenner', displayTitle: 'Karl Brenner', frontmatter: { type: 'pc' } }],
    readFile: () => KARL,
    writeFile: (p, s) => { writes[p] = s; },
    out: (m) => lines.push(String(m)),
  });
  assert.strictEqual(rc, 0);
  assert.match(writes['/vault/PCs/Karl.md'], /\*\*HP:\*\* 7\/11/);
  assert.match(writes['/vault/PCs/Karl.md'], /\*\*FP:\*\* 9\/11/);
});

test('flush skips a GURPS PC whose HP/FP are pinned in frontmatter (status object)', async () => {
  const KARL = [
    '---', 'type: pc', 'system: gurps-4e', '---',
    '## Stat Sheet', '',
    '### Primary Attributes', '',
    '| Attribute | Score | Modifier | Cost |', '|--|--|--|--|',
    '| ST | 11 | — | [10] |', '| HT | 11 | — | [10] |', '',
    '### Secondary Characteristics', '',
    '| Characteristic | Value |', '|--|--|', '| HP | 11 |', '| FP | 11 |', '',
    '## Current Status', '', '**Condition:** Unharmed.', '',
  ].join('\n');
  const writes = {};
  const lines = [];
  const adapter = fakeAdapter({
    'roster:gurps-camp': JSON.stringify(['loadout:gurps-camp:karl-brenner:ABCD']),
    'loadout:gurps-camp:karl-brenner:ABCD': JSON.stringify({ hp: 5, fp: 9, updatedAt: 5 }),
  });
  const rc = await runFlush({
    config: { vaultPath: '/vault', siteTitle: 'GURPS Camp', system: 'gurps-4e', excludeDirs: [], folderMap: {} },
    adapter,
    scan: () => [{ sourcePath: '/vault/PCs/Karl.md', title: 'Karl_Brenner', displayTitle: 'Karl Brenner', frontmatter: { type: 'pc', system: 'gurps-4e', status: { hp: '11/11', fp: '11/11' } } }],
    readFile: () => KARL,
    writeFile: (p, s) => { writes[p] = s; },
    out: (m) => lines.push(String(m)),
  });
  assert.strictEqual(rc, 0);
  assert.equal(writes['/vault/PCs/Karl.md'], undefined, 'sheet must not be written');
  assert.ok(lines.some((l) => /Karl Brenner/.test(l) && /frontmatter/.test(l)), 'warns about frontmatter-pinned vitals');
});

// #160: flush's wrangler spawn was unbounded. Milder than the watcher poll it
// mirrors (#154) — a GM sees the flush hang rather than a background watcher
// going quietly dark — but a hung wrangler still blocks the flush forever.
test('the wrangler call flush runs through is bounded by a timeout', () => {
  const { defaultRunWrangler, WRANGLER_TIMEOUT_MS } = require('../lib/flush-cli');
  const seen = [];
  const res = defaultRunWrangler(['kv', 'key', 'get', 'x'], (cmd, args, opts) => {
    seen.push({ cmd, args, opts });
    return { code: 0, stdout: '{}', stderr: '' };
  });
  assert.equal(res.code, 0);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].cmd, 'npx');
  assert.deepEqual(seen[0].args, ['wrangler@4', 'kv', 'key', 'get', 'x']);
  assert.ok(Number.isFinite(seen[0].opts.timeoutMs) && seen[0].opts.timeoutMs > 0,
    `expected a finite positive timeoutMs, got ${JSON.stringify(seen[0].opts)}`);
  assert.equal(seen[0].opts.timeoutMs, WRANGLER_TIMEOUT_MS);
});

test('the flush wrapper passes the process error through', () => {
  const { defaultRunWrangler } = require('../lib/flush-cli');
  const res = defaultRunWrangler(['kv', 'key', 'get', 'x'],
    () => ({ code: 1, stdout: '', stderr: '', error: 'ETIMEDOUT' }));
  assert.equal(res.error, 'ETIMEDOUT');
});
