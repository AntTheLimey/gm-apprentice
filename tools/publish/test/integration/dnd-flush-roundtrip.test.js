require('../helpers/quiet-legacy-warning.js');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const path = require('path'); const os = require('os');
const { build } = require('../../lib/build');
const { applyDnDFlush } = require('../../lib/flush/dnd-writeback');
const { fit } = require('../../js/dnd-live');

// The write-back must find, in the note, every cell the build made live. For every D&D PC
// fixture: build, change everything live, flush, rebuild from the flushed note, compare.
const FIXTURES = path.join(__dirname, '..', 'fixtures');
const PCS = path.join('Characters', 'PCs');

function copyAndBuild(sourceVault, mutate) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-publish-dnd-roundtrip-'));
  const vault = path.join(work, 'vault');
  fs.cpSync(sourceVault, vault, { recursive: true });
  const cfg = path.join(vault, '_meta', 'vault-config.md');
  if (!/live_stats: true/.test(fs.readFileSync(cfg, 'utf8'))) {
    fs.writeFileSync(cfg, fs.readFileSync(cfg, 'utf8').replace('system: dnd-5e-2024', 'system: dnd-5e-2024\n  live_stats: true'));
  }
  if (mutate) mutate(vault);
  const configPath = path.join(work, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    vaultPath: vault, outputDir: path.join(work, 'docs'), attachmentsDir: '_attachments', siteTitle: 'D&D Test',
    system: 'dnd-5e-2024', excludeDirs: ['_meta', '_Templates'], excludeSections: ['GM Notes'],
    folderMap: { 'Characters/PCs': 'characters/pcs', Creatures: 'creatures', Items: 'items' },
  }, null, 2));
  const realWarn = console.warn; const realLog = console.log;
  console.warn = () => {}; console.log = () => {};
  try { build({ configPath, assumeKv: true }); } finally { console.warn = realWarn; console.log = realLog; }
  const island = file => {
    const html = fs.readFileSync(path.join(work, 'docs', 'characters', 'pcs', file.replace(/_/g, '-').replace(/\.md$/, '').toLowerCase() + '.html'), 'utf8');
    const m = html.match(/<script type="application\/json" id="dnd-live-data">([\s\S]*?)<\/script>/);
    return m ? JSON.parse(m[1].replace(/\\u003c/g, '<')) : null;
  };
  return { work, vault, island };
}

// Fixture notes that have no live island on purpose. Any other note without one is a failure.
const NO_ISLAND = [];

// A PC whose live cells are all emphasised or carry a reason: the page reads them, so flush must write them.
const EMPHASIS = [
  ['| HP (Current) | 38 |', '| HP (Current) | **38** (after the fall) |'],
  ['| Temp HP | 0 |', '| Temp HP | *0* |'],
  ['| Exhaustion | 0 |', '| Exhaustion | **0** |'],
  ['| Hit Dice (Spent/Max) | 1/5 |', '| Hit Dice (Spent/Max) | **1/5** |'],
  ['| Death Saves (S/F) | 0/0 |', '| Death Saves (S/F) | *0*/*0* |'],
  ['| Lay on Hands | Bonus Action | 25 | 7 |', '| Lay on Hands | Bonus Action | 25 | **7** |'],
  ['| Channel Divinity |  | 2 | 1 |', '| Channel Divinity |  | 2 | *1* |'],
  ['| 1st | 4 | 1 |', '| 1st | 4 | **1** |'],
  ['| 2nd | 2 | 0 |', '| 2nd | 2 | *0* |'],
  ['| No | 7 | 2 |', '| No | 7 | **2** |'],
];
const EMPHASIS_FILE = 'Emphasis_Test.md';
function addEmphasis(vault) {
  let text = fs.readFileSync(path.join(vault, PCS, 'Brannoch_Vale.md'), 'utf8').replace(/\r\n/g, '\n');
  for (const [from, to] of EMPHASIS) {
    assert.ok(text.includes(from), `fixture no longer has ${from}`);
    text = text.replace(from, to);
  }
  fs.writeFileSync(path.join(vault, PCS, EMPHASIS_FILE), text.replace(/^player_name: .*$/m, 'player_name: "Kit"'));
}

// A PC whose rows stop short of the cell flush would write. The renderer pads a short row, so
// the page makes each of these live; flush adds no cell, so each value must be named.
const SHORT = [
  ['| Temp HP | 0 |', '| Temp HP |', 'temp'],
  ['| Channel Divinity |  | 2 | 1 | 1 Short Rest, all Long Rest | Fuels Divine Sense and Sacred Weapon. |', '| Channel Divinity |  | 2 |', 'class:channel divinity'],
  ['| 1st | 4 | 1 |', '| 1st | 4 |', 'slot:1st'],
];
const SHORT_FILE = 'Short_Rows_Test.md';
function addShort(vault) {
  let text = fs.readFileSync(path.join(vault, PCS, 'Brannoch_Vale.md'), 'utf8').replace(/\r\n/g, '\n');
  for (const [from, to] of SHORT) {
    assert.ok(text.includes(from), `fixture no longer has ${from}`);
    text = text.replace(from, to);
  }
  fs.writeFileSync(path.join(vault, PCS, SHORT_FILE), text.replace(/^player_name: .*$/m, 'player_name: "Sam"'));
}

// A PC whose Conditions cell is the GM's own writing (square brackets), and whose Temp HP says None.
const ODD_FILE = 'Odd_Conditions_Test.md';
function addOdd(vault) {
  let text = fs.readFileSync(path.join(vault, PCS, 'Brannoch_Vale.md'), 'utf8').replace(/\r\n/g, '\n');
  for (const [from, to] of [['| Conditions | — |', '| Conditions | Hexed [Bob], Prone |'], ['| Temp HP | 0 |', '| Temp HP | None |']]) {
    assert.ok(text.includes(from), `fixture no longer has ${from}`);
    text = text.replace(from, to);
  }
  fs.writeFileSync(path.join(vault, PCS, ODD_FILE), text.replace(/^player_name: .*$/m, 'player_name: "Odd"'));
}

describe('D&D flush round trip, every fixture note', () => {
  let first, second, short, odd;
  const files = fs.readdirSync(path.join(FIXTURES, 'with-dnd-pc', PCS)).filter(f => f.endsWith('.md')).concat(EMPHASIS_FILE);
  const flushed = {};
  const blobs = {};
  before(() => {
    first = copyAndBuild(path.join(FIXTURES, 'with-dnd-pc'), (vault) => { addEmphasis(vault); addShort(vault); addOdd(vault); });
    for (const file of files) {
      const d = first.island(file);
      if (!d) continue;
      const note = fs.readFileSync(path.join(first.vault, PCS, file), 'utf8').replace(/\r\n/g, '\n');
      const b = { v: 1, used: {}, concentrating: false, conditions: ['Prone', 'Stunned'] };
      if (d.defaults.hp !== null) b.hp = d.defaults.hp > 0 ? d.defaults.hp - 1 : 1;
      b.temp = d.defaults.temp + 1;
      if (d.exhaustionLive) b.exhaustion = (d.defaults.exhaustion + 1) % 7;
      if (d.inspirationLive) b.inspiration = !d.defaults.inspiration;
      for (const t of d.tracks) b.used[t.key] = (t.used + 1) % (t.max + 1);
      blobs[file] = b;
      flushed[file] = { note, island: d, result: applyDnDFlush(note, b) };
    }
    {
      const island = first.island(SHORT_FILE);
      const note = fs.readFileSync(path.join(first.vault, PCS, SHORT_FILE), 'utf8').replace(/\r\n/g, '\n');
      const b = { v: 1, hp: island.defaults.hp - 1, temp: 3, exhaustion: 1, inspiration: !island.defaults.inspiration, conditions: ['Prone'], used: {} };
      for (const t of island.tracks) b.used[t.key] = (t.used + 1) % (t.max + 1);
      short = { island, note, blob: b, result: applyDnDFlush(note, b) };
    }
    {
      const island = first.island(ODD_FILE);
      const note = fs.readFileSync(path.join(first.vault, PCS, ODD_FILE), 'utf8').replace(/\r\n/g, '\n');
      // What the page would save after a session: its own fit of a record that tried to change conditions.
      const b = fit({ hp: island.defaults.hp - 2, temp: 3, conditions: ['Stunned'] }, island);
      odd = { island, note, blob: b, result: applyDnDFlush(note, b) };
    }
    second = copyAndBuild(path.join(FIXTURES, 'with-dnd-pc'), (vault) => {
      addEmphasis(vault);
      addShort(vault);
      fs.writeFileSync(path.join(vault, PCS, SHORT_FILE), short.result.markdown);
      addOdd(vault);
      fs.writeFileSync(path.join(vault, PCS, ODD_FILE), odd.result.markdown);
      for (const file of files) if (flushed[file]) fs.writeFileSync(path.join(vault, PCS, file), flushed[file].result.markdown);
    });
  });
  after(() => { for (const s of [first, second]) if (s) fs.rmSync(s.work, { recursive: true, force: true }); });

  it('covers every D&D PC fixture note that goes live', () => {
    assert.equal(files.length, 7 + 1,  // the seven fixtures and the generated emphasised note
       'a fixture note was added or removed: say whether it goes live');
    const dark = files.filter(f => !flushed[f]).sort();
    assert.deepEqual(dark, NO_ISLAND.slice().sort(), 'a note without an island must be listed in NO_ISLAND');
    assert.equal(Object.keys(flushed).length, files.length - NO_ISLAND.length);
  });

  for (const file of files) {
    it(`${file}: names only cells the note truly lacks, keeps its lines, rebuilds to what was flushed, and is stable`, () => {
      const f = flushed[file];
      if (!f) return;
      const expected = file === 'Ilse_Varn_Old_Layout.md' ? ['conditions', 'exhaustion', 'temp'] : [];
      assert.deepEqual(f.result.skipped.slice().sort(), expected);
      assert.equal(f.result.markdown.split('\n').length, f.note.split('\n').length);
      const d2 = second.island(file);
      const b = blobs[file];
      for (const k of ['hp', 'temp', 'exhaustion', 'inspiration']) {
        if (b[k] !== undefined && !expected.includes(k)) assert.equal(d2.defaults[k], b[k], `${file}: ${k}`);
      }
      if (!expected.includes('conditions')) assert.deepEqual(d2.defaults.conditions, b.conditions);
      assert.deepEqual(d2.defaults.used, b.used);
      assert.deepEqual(d2.tracks.map(t => [t.key, t.max]), f.island.tracks.map(t => [t.key, t.max]));
      const again = applyDnDFlush(f.result.markdown, b);
      assert.deepEqual(again.changes, []);
      assert.equal(again.markdown, f.result.markdown);
    });
  }

  it('a row short of its last cell: live on the page, named by flush, never given a cell, and the rest still written', () => {
    const keys = SHORT.map(x => x[2]);
    // The page: every short row is live, starting from what a blank cell means.
    assert.equal(short.island.tempLive, true);
    assert.equal(short.island.defaults.temp, 0);
    for (const k of keys.slice(1)) assert.equal(short.island.tracks.find(t => t.key === k).used, 0, k);
    // Flush: exactly those are named; no line gains a cell; every other value lands.
    assert.deepEqual(short.result.skipped.slice().sort(), keys.slice().sort());
    const before = short.note.split('\n'), after = short.result.markdown.split('\n');
    assert.equal(after.length, before.length);
    for (const [, line] of SHORT) assert.ok(after.includes(line), line);
    // The rebuilt page: the named values are still the note's; the rest is what was saved.
    const d2 = second.island(SHORT_FILE);
    assert.equal(d2.defaults.temp, 0);
    assert.equal(d2.defaults.hp, short.blob.hp);
    assert.equal(d2.defaults.exhaustion, 1);
    assert.deepEqual(d2.defaults.conditions, ['Prone']);
    for (const t of d2.tracks) assert.equal(t.used, keys.includes(t.key) ? 0 : short.blob.used[t.key], t.key);
    assert.deepEqual(d2.tracks.map(t => t.key), short.island.tracks.map(t => t.key));
    const again = applyDnDFlush(short.result.markdown, short.blob);
    assert.deepEqual(again.changes, []);
    assert.deepEqual(again.skipped.slice().sort(), keys.slice().sort());
  });

  it('conditions the page shows as written: held to the note on the page, left alone by flush, the rest still written', () => {
    assert.equal(odd.island.conditionsLive, false);
    assert.deepEqual(odd.island.defaults.conditions, ['Hexed [Bob]', 'Prone']);
    assert.deepEqual(odd.blob.conditions, ['Hexed [Bob]', 'Prone']);
    assert.deepEqual(odd.result.skipped, []);
    const lines = odd.result.markdown.split('\n');
    assert.ok(lines.includes('| Conditions | Hexed [Bob], Prone |'));
    assert.ok(lines.includes('| Temp HP | 3 |'));
    assert.deepEqual(odd.result.changes.map(c => c.field).sort(), ['HP (Current)', 'Temp HP']);
    const d2 = second.island(ODD_FILE);
    assert.equal(d2.conditionsLive, false);
    assert.deepEqual(d2.defaults.conditions, ['Hexed [Bob]', 'Prone']);
    assert.equal(d2.defaults.temp, 3);
    assert.equal(d2.defaults.hp, odd.blob.hp);
    const again = applyDnDFlush(odd.result.markdown, odd.blob);
    assert.deepEqual(again.changes, []);
    assert.deepEqual(again.skipped, []);
  });
});
