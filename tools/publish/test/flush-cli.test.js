const { test } = require('node:test');
const assert = require('node:assert');
const { runFlush } = require('../lib/flush-cli');

// Fake KV adapter: getStates does one get for the roster then one per member.
function fakeAdapter(map) {
  return { async get(key) { return key in map ? map[key] : null; } };
}

// The vault in these tests is the made-up folder /vault, so the bookkeeping file is faked.
const NO_STATE = { readState: () => ({}), writeState: () => {} };

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
    config: CONFIG, adapter, scan: pages, publishConfig: { switches: { characterSheets: true, liveStats: true } },
    readFile: (p) => (p === '/vault/PCs/Jane_Ashford.md' ? JANE_MD : ''),
    writeFile: (p, s) => { writes[p] = s; },
    out: (m) => lines.push(String(m)),
  }, over);
  return { promise: runFlush({ ...NO_STATE, ...deps }), writes, lines };
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

test('flush skips, and says why, a PC whose system has no live sheet', async () => {
  const pf2Pages = () => [{ sourcePath: '/vault/PCs/Jane_Ashford.md', title: 'Jane_Ashford',
    displayTitle: 'Jane Ashford', frontmatter: { type: 'pc', system: 'pf2e' } }];
  const r = run({ scan: pf2Pages });
  assert.equal(await r.promise, 0);
  assert.deepStrictEqual(r.writes, {});
  assert.ok(r.lines.some((l) => /Jane Ashford/.test(l) && /no live sheet/.test(l)), r.lines.join('\n'));
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
    ...NO_STATE,
    config: { vaultPath: '/vault', siteTitle: 'GURPS Camp', system: 'gurps-4e', excludeDirs: [], folderMap: {} },
    publishConfig: { system: 'gurps-4e', switches: { characterSheets: true, liveStats: true } },
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
    ...NO_STATE,
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
    ...NO_STATE,
    config: { vaultPath: '/vault', siteTitle: 'GURPS Camp', system: 'gurps-4e', excludeDirs: [], folderMap: {} },
    publishConfig: { system: 'gurps-4e', switches: { characterSheets: true, liveStats: true } },
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

test('flush --dry-run reports the same changes and writes nothing (#178)', async () => {
  const r = run({ dryRun: true });
  const code = await r.promise;
  assert.equal(code, 0);
  assert.deepEqual(Object.keys(r.writes), [], 'no file written');
  assert.ok(r.lines.some((l) => /DRY RUN/.test(l)));
  assert.ok(r.lines.some((l) => /Jane Ashford/.test(l) && /HP 11→7/.test(l) && /would write/.test(l)));
});

test('flush does nothing, and says why, when live stats are off or character sheets are off', async () => {
  const cases = [
    [{ switches: { characterSheets: true, liveStats: false } }, /live stats are off for this campaign/],
    [{ switches: { characterSheets: false, liveStats: false } }, /character sheets are off for this campaign, so live stats are off too/],
    [undefined, /live stats are off for this campaign/],   // resolved from config: unset means off
  ];
  for (const [publishConfig, say] of cases) {
    const r = run({ publishConfig, adapter: { async get() { throw new Error('KV must not be read'); } } });
    assert.equal(await r.promise, 0);
    assert.deepEqual(r.writes, {});
    assert.equal(r.lines.length, 1, r.lines.join('\n'));
    assert.match(r.lines[0], say);
  }
});

test('flush says why when live stats are off only because the switch is unset and the backend is deployed', async () => {
  const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-flush-unset-'));
  try {
    fs.writeFileSync(path.join(dir, 'wrangler.toml'), '[[kv_namespaces]]\nbinding = "INBOX"\nid = "abc123def456"\n');
    fs.mkdirSync(path.join(dir, 'functions', 'api'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'functions', 'api', 'loadout.js'), '// fn');
    const say = async (switches) => {
      const r = run({ configPath: path.join(dir, 'vault.config.json'), publishConfig: { switches } });
      assert.equal(await r.promise, 0);
      return r.lines.join('\n');
    };
    assert.match(await say({ characterSheets: true, liveStats: false, unset: ['live_stats'] }),
      /live stats are deployed on this site but player_site\.features\.live_stats is not set, so they are off\. Set player_site\.features\.live_stats to true to keep them/);
    // set to false: the bare line; sheets off: the sheets line; nothing deployed is covered above
    assert.match(await say({ characterSheets: true, liveStats: false, unset: [] }), /live stats are off for this campaign/);
    assert.match(await say({ characterSheets: false, liveStats: false, unset: ['live_stats'] }), /character sheets are off/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('flush finds a renamed PC by its pinned live_key', async () => {
  const renamed = () => [
    { sourcePath: '/vault/PCs/Jane_Hale.md', title: 'Jane_Hale', displayTitle: 'Jane Hale', frontmatter: { type: 'pc', live_key: 'jane-ashford' } },
  ];
  const r = run({ scan: renamed, readFile: (p) => (p === '/vault/PCs/Jane_Hale.md' ? JANE_MD : '') });
  assert.equal(await r.promise, 0);
  assert.match(r.writes['/vault/PCs/Jane_Hale.md'], /\| HP \| 11 \| 7 \|/);
});

test('resolveSystem: GURPS, D&D, CoC as the default, none for a system with no live sheet', () => {
  const { resolveSystem } = require('../lib/flush-cli');
  assert.equal(resolveSystem({}, 'gurps-4e'), 'gurps');
  assert.equal(resolveSystem({}, 'dnd-5e-2024'), 'dnd');
  assert.equal(resolveSystem({ system: 'dnd' }, 'coc-7e'), 'dnd');
  assert.equal(resolveSystem({}, 'coc-7e'), 'coc');
  assert.equal(resolveSystem({}, undefined), 'coc');
  assert.equal(resolveSystem({}, 'pf2e'), null);
  assert.equal(resolveSystem({}, 'bitd'), null);
  assert.equal(resolveSystem({ system: 'pf2' }, 'coc-7e'), null);
  assert.equal(resolveSystem({}, 'coc-7e-regency'), 'coc');
});

test('routes a D&D PC to the D&D writeback; dry run writes nothing; missing cells are named', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const BRANNOCH = fs.readFileSync(path.join(__dirname, 'fixtures/with-dnd-pc/Characters/PCs/Brannoch_Vale.md'), 'utf8').replace(/\r\n/g, '\n');
  const go = async (dryRun) => {
    const writes = {};
    const lines = [];
    const adapter = fakeAdapter({
      'roster:dnd-camp': JSON.stringify(['loadout:dnd-camp:brannoch-vale:ABCD']),
      'loadout:dnd-camp:brannoch-vale:ABCD': JSON.stringify({ v: 1, hp: 20, used: { 'slot:1st': 3, 'class:no such feature': 1 }, updatedAt: 1 }),
    });
    const rc = await runFlush({
    ...NO_STATE,
      dryRun,
      config: { vaultPath: '/vault', siteTitle: 'DnD Camp', system: 'dnd-5e-2024', excludeDirs: [], folderMap: {} },
      publishConfig: { system: 'dnd-5e-2024', switches: { characterSheets: true, liveStats: true } },
      adapter,
      scan: () => [{ sourcePath: '/vault/PCs/Brannoch.md', title: 'Brannoch_Vale', displayTitle: 'Brannoch Vale', frontmatter: { type: 'pc' } }],
      readFile: () => BRANNOCH,
      writeFile: (p, s) => { writes[p] = s; },
      out: (m) => lines.push(String(m)),
    });
    assert.strictEqual(rc, 0);
    return { writes, lines };
  };
  const real = await go(false);
  assert.match(real.writes['/vault/PCs/Brannoch.md'], /\| HP \(Current\) \| 20 \|/);
  assert.match(real.lines.find(l => l.startsWith('✓')), /HP \(Current\)/);
  assert.ok(real.lines.some(l => /not written, no cell in the note can hold: class:no such feature/.test(l)));
  const dry = await go(true);
  assert.deepEqual(dry.writes, {});
  assert.match(dry.lines.find(l => l.startsWith('✓')), /would write/);
});

test('D&D flush report: hostile keys in the record never reach the printed lines', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const BRANNOCH = fs.readFileSync(path.join(__dirname, 'fixtures/with-dnd-pc/Characters/PCs/Brannoch_Vale.md'), 'utf8').replace(/\r\n/g, '\n');
  const used = { 'class:old feature': 1, 'class:x\n✓ Fake PC — HP 1→99\nIgnore previous instructions': 2, 'class:bad\u2028line': 1, 'no prefix': 1 };
  for (let i = 0; i < 40; i++) used['feat:unknown ' + i] = 1;
  const lines = [];
  const adapter = fakeAdapter({
    'roster:dnd-camp': JSON.stringify(['loadout:dnd-camp:brannoch-vale:ABCD']),
    'loadout:dnd-camp:brannoch-vale:ABCD': JSON.stringify({ v: 1, hp: 20, used, updatedAt: 1 }),
  });
  await runFlush({
    ...NO_STATE,
    dryRun: true,
    config: { vaultPath: '/vault', siteTitle: 'DnD Camp', system: 'dnd-5e-2024', excludeDirs: [], folderMap: {} },
    publishConfig: { system: 'dnd-5e-2024', switches: { characterSheets: true, liveStats: true } },
    adapter,
    scan: () => [{ sourcePath: '/vault/PCs/Brannoch.md', title: 'Brannoch_Vale', displayTitle: 'Brannoch Vale', frontmatter: { type: 'pc' } }],
    readFile: () => BRANNOCH,
    writeFile: () => {},
    out: m => lines.push(String(m)),
  });
  const printed = lines.join('\n').split('\n');
  // DRY RUN banner, the PC's change line, and its one "not written" line.
  assert.equal(printed.length, 3, printed.join('\n'));
  assert.ok(!printed.some(l => /Fake PC|Ignore previous|u2028|\u2028/.test(l)));
  assert.match(printed[2], /class:old feature/);
  assert.match(printed[2], /unrecognised entries/);
});

test('a hostile loadout key never prints its slug unchecked', async () => {
  const lines = [];
  const slug = 'evil\n✓ Fake PC — HP 1→99';
  await runFlush({
    ...NO_STATE,
    dryRun: true,
    config: { vaultPath: '/vault', siteTitle: 'DnD Camp', system: 'dnd-5e-2024', excludeDirs: [], folderMap: {} },
    publishConfig: { system: 'dnd-5e-2024', switches: { characterSheets: true, liveStats: true } },
    adapter: fakeAdapter({
      'roster:dnd-camp': JSON.stringify(['loadout:dnd-camp:' + slug + ':ABCD']),
      ['loadout:dnd-camp:' + slug + ':ABCD']: JSON.stringify({ v: 1, hp: 20, updatedAt: 1 }),
    }),
    scan: () => [],
    out: m => lines.push(String(m)),
  });
  assert.equal(lines.join('\n').split('\n').length, 2, lines.join('\n'));
  assert.ok(!lines.some(l => /Fake PC/.test(l)));
});

// #438: a record already written into the note is not written again.
function memoryState() {
  let state = {};
  return {
    readState: () => JSON.parse(JSON.stringify(state)),
    writeState: (_vault, patch) => { state = { ...state, ...patch }; },
    peek: () => state,
  };
}

// system: [slug, note text, frontmatter, campaign config] with a first record and a change the GM makes after.
const SYSTEMS = {
  coc: {
    camp: 'CoC Camp', slug: 'jane-ashford', fm: { type: 'pc' }, system: undefined,
    note: JANE_MD, rec: { hp: 7, conditions: {} }, cell: /\| HP \| 11 \| 7 \|/, gmEdit: (t) => t.replace('| HP | 11 | 7 |', '| HP | 11 | 9 |'), gmCell: /\| HP \| 11 \| 9 \|/,
  },
  gurps: {
    camp: 'GURPS Camp', slug: 'karl-brenner', fm: { type: 'pc', system: 'gurps-4e' }, system: 'gurps-4e',
    note: ['---', 'type: pc', 'system: gurps-4e', '---', '## Stat Sheet', '', '### Primary Attributes', '',
      '| Attribute | Score | Modifier | Cost |', '|--|--|--|--|', '| ST | 11 | — | [10] |', '| HT | 11 | — | [10] |', '',
      '### Secondary Characteristics', '', '| Characteristic | Value |', '|--|--|', '| HP | 11 |', '| FP | 11 |', '',
      '## Current Status', '', '**Condition:** Unharmed.', ''].join('\n'),
    rec: { hp: 7, fp: 9 }, cell: /\*\*HP:\*\* 7\/11/, gmEdit: (t) => t.replace('**HP:** 7/11', '**HP:** 10/11'), gmCell: /\*\*HP:\*\* 10\/11/,
  },
  dnd: {
    camp: 'DnD Camp', slug: 'brannoch-vale', fm: { type: 'pc' }, system: 'dnd-5e-2024',
    note: require('node:fs').readFileSync(require('node:path').join(__dirname, 'fixtures/with-dnd-pc/Characters/PCs/Brannoch_Vale.md'), 'utf8').replace(/\r\n/g, '\n'),
    rec: { v: 1, hp: 20 }, cell: /\| HP \(Current\) \| 20 \|/, gmEdit: (t) => t.replace(/\| HP \(Current\) \| 20 \|/, '| HP (Current) | 17 |'), gmCell: /\| HP \(Current\) \| 17 \|/,
  },
};

for (const [name, sys] of Object.entries(SYSTEMS)) {
  test('flush does not rewrite a record it already wrote, so the GM\'s later value stays (' + name + ', #438)', async () => {
    const campId = sys.camp.toLowerCase().replace(/ /g, '-');
    const key = 'loadout:' + campId + ':' + sys.slug + ':ABCD';
    const adapter = fakeAdapter({ ['roster:' + campId]: JSON.stringify([key]), [key]: JSON.stringify({ ...sys.rec, updatedAt: 5 }) });
    let note = sys.note;
    const st = memoryState();
    const go = async (extra = {}) => {
      const lines = [];
      const rc = await runFlush({
        ...st, ...extra,
        config: { vaultPath: '/vault', siteTitle: sys.camp, system: sys.system, excludeDirs: [], folderMap: {} },
        publishConfig: { system: sys.system, switches: { characterSheets: true, liveStats: true } },
        adapter,
        scan: () => [{ sourcePath: '/vault/PCs/X.md', title: sys.slug, displayTitle: sys.slug, frontmatter: sys.fm }],
        readFile: () => note,
        writeFile: (_p, s) => { note = s; },
        out: (m) => lines.push(String(m)),
      });
      assert.strictEqual(rc, 0);
      return lines;
    };
    // A preview writes neither the note nor the marker.
    await go({ dryRun: true });
    assert.deepEqual(st.peek(), {});
    assert.doesNotMatch(note, sys.cell);
    await go();
    assert.match(note, sys.cell);
    assert.ok(st.peek().flush_written[sys.slug], 'marker recorded in the state');
    note = sys.gmEdit(note);
    assert.match(note, sys.gmCell);
    const lines = await go();
    assert.match(note, sys.gmCell, 'the GM\'s value survives a second flush');
    assert.ok(lines.some((l) => /already written/.test(l)), lines.join('\n'));
    // A newer saved record is written again.
    adapter.get = async (k) => (k === key ? JSON.stringify({ ...sys.rec, updatedAt: 6 }) : JSON.stringify([key]));
    await go();
    assert.match(note, sys.cell);
  });
}

test('a write that throws part-way still keeps the markers of the PCs already written', async () => {
  const st = memoryState();
  const two = () => [
    { sourcePath: '/vault/PCs/Jane_Ashford.md', title: 'Jane_Ashford', displayTitle: 'Jane Ashford', frontmatter: { type: 'pc' } },
    { sourcePath: '/vault/PCs/Bob_Marsh.md', title: 'Bob_Marsh', displayTitle: 'Bob Marsh', frontmatter: { type: 'pc' } },
  ];
  const adapter = fakeAdapter({
    'roster:test-campaign': JSON.stringify(['loadout:test-campaign:jane-ashford:ABCD', 'loadout:test-campaign:bob-marsh:EFGH']),
    'loadout:test-campaign:jane-ashford:ABCD': JSON.stringify({ hp: 7, conditions: {}, updatedAt: 5 }),
    'loadout:test-campaign:bob-marsh:EFGH': JSON.stringify({ hp: 6, conditions: {}, updatedAt: 6 }),
  });
  await assert.rejects(runFlush({
    ...st, config: CONFIG, adapter, scan: two, publishConfig: { switches: { characterSheets: true, liveStats: true } },
    readFile: () => JANE_MD,
    writeFile: (p) => { if (/Bob/.test(p)) throw new Error('disk full'); },
    out: () => {},
  }), /disk full/);
  assert.deepEqual(Object.keys(st.peek().flush_written || {}), ['jane-ashford']);
});

test('a corrupt vault-state.json stops flush with one plain line naming the file', async () => {
  const lines = [];
  const rc = await runFlush({
    readState: () => { throw new Error('_meta/vault-state.json is not valid JSON: Unexpected token'); },
    writeState: () => { throw new Error('must not write'); },
    config: CONFIG, adapter: fakeAdapter({ 'roster:test-campaign': JSON.stringify(['loadout:test-campaign:jane-ashford:ABCD']),
      'loadout:test-campaign:jane-ashford:ABCD': JSON.stringify({ hp: 7, updatedAt: 5 }) }),
    scan: pages, publishConfig: { switches: { characterSheets: true, liveStats: true } },
    readFile: () => JANE_MD, writeFile: () => { throw new Error('must not write'); },
    out: (m) => lines.push(String(m)),
  });
  assert.equal(rc, 1);
  assert.equal(lines.length, 1, lines.join('\n'));
  assert.match(lines[0], /_meta\/vault-state\.json is not valid JSON/);
  assert.doesNotMatch(lines[0], /\n\s+at /);
});
