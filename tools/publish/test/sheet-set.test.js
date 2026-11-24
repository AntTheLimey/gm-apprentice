const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const matter = require('gray-matter');
const { runSheetSet, COC_CONDITIONS } = require('../lib/sheet-set');
const { vitalsColumns } = require('../lib/shared-lists');
const { liveSheet } = require('../lib/flush/dnd-writeback');

// `sheet set` (#749): the wrap-up's end-of-session vitals go into the Stat Sheet by the
// writers flush uses. Every run here is on text held in memory; nothing touches a fixture.

const FIX = path.join(__dirname, 'fixtures');
const read = rel => fs.readFileSync(path.join(FIX, rel), 'utf8').replace(/\r\n/g, '\n');
const row = (md, re) => md.split('\n').find(l => re.test(l));

// Brannoc after session 2 on Snowbound: 34 of 44, no Hit Die spent yet.
const BRANNOC = read('with-dnd-pc/Characters/PCs/Brannoch_Vale.md')
  .replace('| HP (Current) | 38 |', '| HP (Current) | 34 |')
  .replace('| Hit Dice (Spent/Max) | 1/5 |', '| Hit Dice (Spent/Max) | 0/5 |');
const TAMSIN = read('with-dnd-pc/Characters/PCs/Tamsin_Reed.md');
const JANE = read('with-coc-pc/Characters/PCs/Jane_Ashford.md');          // Regency
const JANE_7E = JANE.replace('system: regency-cthulhu', 'system: coc-7e');
const KARL = read('with-gurps-pc/Characters/PCs/Karl Brenner.md');

// One PC note on a pretend disk: `sheet set --pc` finds it through the scan, as `sheet show` does.
function run(text, pairs, over = {}) {
  const files = { '/vault/Characters/PCs/Pc.md': text };
  const fm = matter(text).data;
  const name = over.name || 'Brannoc';
  const out = [];
  const err = [];
  const writes = [];
  const deps = Object.assign({
    pc: name,
    pairs,
    config: { vaultPath: '/vault' },
    publishConfig: { system: 'system' in over ? over.system : 'dnd-5e-2024' },
    scan: () => [{ sourcePath: '/vault/Characters/PCs/Pc.md', title: name, displayTitle: name, frontmatter: fm, markdown: text }],
    readFile: p => files[p],
    writeFile: (p, s) => { writes.push(p); files[p] = s; },
    out: m => out.push(String(m)),
    err: m => err.push(String(m)),
  }, over.deps || {});
  return runSheetSet(deps).then(code => ({ code, out: out.join('\n'), err: err.join('\n'), writes, text: files['/vault/Characters/PCs/Pc.md'] }));
}

test("Brannoc's wrap-up: hp=41 hit-dice=1/5 puts 41 and 1/5 on the sheet", async () => {
  const r = await run(BRANNOC, ['hp=41', 'hit-dice=1/5']);
  assert.equal(r.code, 0, r.err);
  assert.match(row(r.text, /^\| HP \(Current\)/), /\| 41 \|/);
  assert.match(row(r.text, /^\| HP \(Max\)/), /\| 44 \|/);
  assert.match(row(r.text, /^\| Hit Dice/), /\| 1\/5 \|/);
  assert.equal(r.out, '✓ Brannoc — HP (Current) 34→41, Hit Dice (Spent/Max) 0/5→1/5');
  assert.deepEqual(r.writes, ['/vault/Characters/PCs/Pc.md']);
  // Nothing else in the note moved.
  const a = BRANNOC.split('\n'), b = r.text.split('\n');
  assert.equal(a.length, b.length);
  assert.equal(a.filter((l, i) => l !== b[i]).length, 2);
});

test('D&D: every key lands in its own cell', async () => {
  const r = await run(BRANNOC, ['temp=5', 'exhaustion=2', 'conditions=Poisoned, Prone', 'inspiration=no', 'death-saves=2/1', 'hit-dice=3']);
  assert.equal(r.code, 0, r.err);
  assert.match(row(r.text, /^\| Temp HP/), /\| 5 \|/);
  assert.match(row(r.text, /^\| Exhaustion/), /\| 2 \|/);
  assert.match(row(r.text, /^\| Conditions/), /\| Poisoned, Prone \|/);
  assert.match(row(r.text, /^\| Heroic Inspiration/), /\| No \|/);
  assert.match(row(r.text, /^\| Death Saves/), /\| 2\/1 \|/);
  assert.match(row(r.text, /^\| Hit Dice/), /\| 3\/5 \|/);
  assert.match(row(r.text, /^\| HP \(Current\)/), /\| 34 \|/, 'hp was not given, so it stays');
  const twice = await run(BRANNOC, ['conditions=Poisoned, poisoned']);
  assert.equal(twice.code, 0, twice.err);
  assert.match(twice.text, /\| Conditions \| Poisoned \|/);
  const cleared = await run(r.text, ['conditions=none']);
  assert.match(row(cleared.text, /^\| Conditions/), /\| — \|/);
});

test('D&D: a sheet with two Hit Dice rows names each; plain hit-dice is refused', async () => {
  const both = await run(TAMSIN, ['hit-dice=1'], { name: 'Tamsin' });
  assert.equal(both.code, 1);
  assert.match(both.err, /2 Hit Dice rows: name one \(hit-dice-d10, hit-dice-d6\)/);
  assert.deepEqual(both.writes, []);
  const one = await run(TAMSIN, ['hit-dice-d6=2/2'], { name: 'Tamsin' });
  assert.equal(one.code, 0, one.err);
  assert.match(row(one.text, /^\| Hit Dice d6/), /\| 2\/2 \|/);
  assert.match(row(one.text, /^\| Hit Dice d10/), /\| 1\/3 \|/);
  assert.deepEqual(liveSheet(TAMSIN).hitDice.map(h => h.key), ['hd:hit dice d10', 'hd:hit dice d6']);
  // One row with a die named: plain hit-dice finds it.
  const single = TAMSIN.replace(/^\| Hit Dice d6 .*\n/m, '');
  const d10 = await run(single, ['hit-dice=2/3'], { name: 'Tamsin' });
  assert.equal(d10.code, 0, d10.err);
  assert.match(row(d10.text, /^\| Hit Dice d10/), /\| 2\/3 \|/);
});

test('an unknown key writes nothing and names the keys this sheet takes', async () => {
  const r = await run(BRANNOC, ['hp=41', 'stamina=3']);
  assert.equal(r.code, 1);
  assert.match(r.err, /unknown key "stamina"\. Keys for this sheet: hp, temp, exhaustion, conditions, inspiration, death-saves, hit-dice/);
  assert.deepEqual(r.writes, []);
});

test('a value of the wrong shape writes nothing', async () => {
  for (const [pairs, said] of [
    [['hp=45'], /hp=45: this sheet's HP \(Max\) is 44/],
    [['hp=forty'], /hp=forty: want a whole number/],
    [['hit-dice=1/6'], /Hit Dice \(Spent\/Max\) has 5, not 6/],
    [['exhaustion=7'], /exhaustion=7: at most 6/],
    [['inspiration=maybe'], /want yes or no/],
    [['death-saves=4/0'], /death-saves=4\/0/],
    [['conditions=Poisoned, Restrained/Grappled, Cursed: no healing'], /can't hold "Restrained\/Grappled", "Cursed: no healing"/],
    [['conditions=Grappled.'], /can't hold "Grappled\."/],
    [['hp=41', 'hp=40'], /hp is given twice/],
    [['hp'], /hp: want key=value/],
    [[], /at least one key=value/],
  ]) {
    const r = await run(BRANNOC, pairs);
    assert.equal(r.code, 1, pairs.join(' '));
    assert.match(r.err, said);
    assert.deepEqual(r.writes, []);
  }
});

test("a row the sheet doesn't have is said and left alone; the other keys are written", async () => {
  const noTemp = BRANNOC.replace(/^\| Temp HP \|.*\n/m, '');
  const r = await run(noTemp, ['temp=3', 'hp=41']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /✓ Brannoc — HP \(Current\) 34→41/);
  assert.match(r.out, /⚠ Brannoc — no writable Temp HP row on this sheet: temp left alone/);
  assert.doesNotMatch(r.text, /Temp HP/);
  // A value equal to what the missing row means is still said: there is no row.
  const zero = await run(noTemp, ['temp=0']);
  assert.match(zero.out, /no writable Temp HP row on this sheet/);
  assert.deepEqual(zero.writes, []);
  const noHd = await run(BRANNOC.replace(/^\| Hit Dice .*\n/m, ''), ['hit-dice=1/5']);
  assert.match(noHd.out, /no writable Hit Dice row on this sheet: hit-dice left alone/);
});

test('a value already on the sheet is said, not rewritten', async () => {
  const r = await run(BRANNOC, ['hp=34', 'exhaustion=0']);
  assert.equal(r.code, 0);
  assert.equal(r.out, '· Brannoc — already so: hp, exhaustion');
  assert.deepEqual(r.writes, []);
});

test('--dry-run prints the same lines and writes nothing', async () => {
  const r = await run(BRANNOC, ['hp=41', 'hit-dice=1/5'], { deps: { dryRun: true } });
  assert.equal(r.code, 0);
  assert.equal(r.out, 'DRY RUN — nothing will be written.\n✓ Brannoc — HP (Current) 34→41, Hit Dice (Spent/Max) 0/5→1/5  (would write)');
  assert.deepEqual(r.writes, []);
  assert.equal(r.text, BRANNOC);
});

test('a PC not in the vault is refused, naming the PCs there', async () => {
  const r = await run(BRANNOC, ['hp=41'], { deps: { pc: 'Nobody' } });
  assert.equal(r.code, 1);
  assert.match(r.err, /No PC named "Nobody"\. PCs: Brannoc/);
  assert.deepEqual(r.writes, []);
});

test('CoC 7e: each key writes its Derived Current cell or Status box', async () => {
  const opts = { name: 'Jane', system: 'coc-7e' };
  const r = await run(JANE_7E, ['hp=9', 'mp=10', 'luck=60', 'san=30', 'dying=yes', 'major-wound=yes'], opts);
  assert.equal(r.code, 0, r.err);
  assert.match(row(r.text, /^\| HP /), /\| 11 \| 9 \|/);
  assert.match(row(r.text, /^\| MP /), /\| 13 \| 10 \|/);
  assert.match(row(r.text, /^\| Luck /), /\| 60 \(starting 65\) \|/);
  assert.match(row(r.text, /^\| Sanity /), /\| 30 \(starting 60\) \|/);
  assert.match(r.text, /- \[x\] \*\*Dying\*\*/);
  assert.match(r.text, /- \[x\] \*\*Major Wound\*\*/);
  // A box not named stays as it was: Indefinite Insanity was ticked.
  assert.match(r.text, /- \[x\] \*\*Indefinite Insanity\*\*/);
  assert.match(r.text, /- \[ \] Unconscious/);
  assert.match(r.out, /✓ Jane — HP 11→9, MP 13→10, Luck 68→60, Sanity 35→30, Dying on, Major Wound on/);
  const off = await run(r.text, ['indefinite-insanity=no', 'temporary-insanity=yes', 'unconscious=yes'], opts);
  assert.match(off.text, /- \[ \] Indefinite Insanity/);
  assert.match(off.text, /- \[x\] \*\*Temporary Insanity\*\*/);
  assert.match(off.text, /- \[x\] \*\*Unconscious\*\*/);
});

test('CoC 7e: rep is not a key; a missing row or a blank cell is said', async () => {
  const opts = { name: 'Jane', system: 'coc-7e' };
  const rep = await run(JANE_7E, ['rep=50'], opts);
  assert.equal(rep.code, 1);
  assert.match(rep.err, /unknown key "rep"\. Keys for this sheet: hp, mp, luck, san, temporary-insanity, indefinite-insanity, major-wound, unconscious, dying/);
  const noMp = await run(JANE_7E.replace(/^\| MP \|.*\n/m, ''), ['mp=5', 'hp=10'], opts);
  assert.equal(noMp.code, 0);
  assert.match(noMp.out, /✓ Jane — HP 11→10/);
  assert.match(noMp.out, /⚠ Jane — no writable MP row on this sheet: mp left alone/);
  // The template's blank Current cell: flush's writer changes a number, never fills a blank.
  const blank = await run(JANE_7E.replace('| HP | 11 | 11 |', '| HP | 11 | |'), ['hp=9'], opts);
  assert.match(blank.out, /no writable HP row on this sheet: hp left alone/);
  assert.deepEqual(blank.writes, []);
  const noBox = await run(JANE_7E.replace(/^- \[ \] Dying\n/m, ''), ['dying=yes'], opts);
  assert.match(noBox.out, /no writable Dying row on this sheet/);
});

test('CoC 7e: HP, MP or Sanity over the sheet\'s maximum is refused and nothing is written', async () => {
  const opts = { name: 'Jane', system: 'coc-7e' };
  for (const [pair, said] of [['hp=12', /hp=12: this sheet's HP maximum is 11/], ['mp=14', /mp=14: this sheet's MP maximum is 13/]]) {
    const r = await run(JANE_7E, [pair, 'luck=60'], opts);
    assert.equal(r.code, 1, pair);
    assert.match(r.err, said);
    assert.deepEqual(r.writes, []);
  }
  const big = await run(JANE_7E, ['luck=1' + '0'.repeat(309)], opts);
  assert.equal(big.code, 1);
  assert.match(big.err, /too large/);
  assert.deepEqual(big.writes, []);
});

test('CoC Regency: rep writes Current Reputation, and the CoC keys work too', async () => {
  const opts = { name: 'Jane', system: 'regency-cthulhu' };
  const r = await run(JANE, ['rep=64', 'san=34'], opts);
  assert.equal(r.code, 0, r.err);
  assert.match(row(r.text, /^\| Current Reputation/), /\| 64 \|/);
  assert.match(row(r.text, /^\| Starting Reputation/), /\| 45 \|/);
  assert.match(r.out, /Sanity 35→34, Reputation 71→64|Reputation 71→64, Sanity 35→34/);
  const bad = await run(JANE, ['honour=3'], opts);
  assert.match(bad.err, /Keys for this sheet: hp, mp, luck, san, rep, /);
});

test("GURPS: hp and fp go to Current Status's HP/FP lines through flush's writer", async () => {
  const r = await run(KARL, ['hp=5', 'fp=3'], { name: 'Karl', system: 'gurps-4e' });
  assert.equal(r.code, 0, r.err);
  assert.match(r.text, /## Current Status[\s\S]*\*\*HP:\*\* 5\/11/);
  assert.match(r.text, /\*\*FP:\*\* 3\/11/);
  const over = await run(KARL, ['hp=12'], { name: 'Karl', system: 'gurps-4e' });
  assert.equal(over.code, 1);
  assert.match(over.err, /hp=12: this sheet's HP maximum is 11/);
  assert.deepEqual(over.writes, []);
  const down = await run(KARL, ['hp=-4', 'fp=-1'], { name: 'Karl', system: 'gurps-4e' });
  assert.equal(down.code, 0, down.err);
  assert.match(down.text, /\*\*HP:\*\* -4\/11/);
  assert.match(down.text, /\*\*FP:\*\* -1\/11/);
  const pinned = KARL.replace('status: active', 'status:\n  hp: 9');
  const p = await run(pinned, ['hp=5'], { name: 'Karl', system: 'gurps-4e' });
  assert.equal(p.code, 1);
  assert.match(p.err, /pinned in frontmatter/);
  assert.deepEqual(p.writes, []);
});

test('Pathfinder, Forged in the Dark and an unnamed system have no live-sheet writer', async () => {
  for (const [system, said] of [['pf2e', /no live-sheet writer for pf2e/], ['fitd', /no live-sheet writer for fitd/],
    ['generic', /no live-sheet writer for generic/], ['', /no live-sheet writer for a campaign with no system set/]]) {
    const r = await run(JANE.replace('system: regency-cthulhu\n', ''), ['hp=3'], { name: 'Jane', system });
    assert.equal(r.code, 1, `${system}: ${r.out}`);
    assert.match(r.err, said);
    assert.deepEqual(r.writes, []);
  }
});

test('--stdin: the note comes in, JSON goes out, nothing is written', async () => {
  const out = [];
  const writes = [];
  const code = await runSheetSet({
    vault: '/vault', file: 'Characters/PCs/Brannoc.md', stdinText: BRANNOC, pairs: ['hp=41', 'hit-dice=1/5', 'temp=0'],
    readSettings: () => ({ values: { vault: { system: 'dnd-5e-2024' }, player_site: {} }, origins: {} }),
    writeFile: p => writes.push(p),
    readFile: () => { throw new Error('read from disk'); },
    out: m => out.push(m), err: m => out.push(m),
  });
  assert.equal(code, 0, out.join('\n'));
  assert.deepEqual(writes, []);
  const answer = JSON.parse(out[0]);
  assert.equal(answer.pc, 'Brannoc');
  assert.equal(answer.changed, true);
  assert.match(row(answer.markdown, /^\| HP \(Current\)/), /\| 41 \|/);
  assert.deepEqual(answer.lines, [
    { kind: 'set', text: '✓ Brannoc — HP (Current) 34→41, Hit Dice (Spent/Max) 0/5→1/5' },
    { kind: 'same', text: '· Brannoc — already so: temp' },
  ]);
});

test('--stdin refuses a note that is not a PC', async () => {
  const err = [];
  const code = await runSheetSet({
    vault: '/vault', file: 'Characters/NPCs/Bob.md', stdinText: '---\ntype: npc\n---\n', pairs: ['hp=1'],
    readSettings: () => ({ values: { vault: { system: 'dnd-5e-2024' }, player_site: {} }, origins: {} }),
    out: () => {}, err: m => err.push(m),
  });
  assert.equal(code, 1);
  assert.match(err.join(''), /is not a PC note/);
});

// The command line itself, on a copy of the D&D fixture.
const CLI = path.join(__dirname, '..', 'bin', 'gm-publish.js');
function copyVault() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-sheet-set-'));
  const vault = path.join(root, 'vault');
  fs.cpSync(path.join(FIX, 'with-dnd-pc'), vault, { recursive: true });
  fs.writeFileSync(path.join(vault, '_meta', 'vault-config.yaml'),
    'vault:\n  system: dnd-5e-2024\nplayer_site:\n  title: T\n  folder_map:\n    Characters/PCs: characters/pcs\n');
  fs.writeFileSync(path.join(vault, 'Characters', 'PCs', 'Brannoch_Vale.md'), BRANNOC);
  fs.writeFileSync(path.join(root, 'vault.config.json'), JSON.stringify({ vaultPath: 'vault' }));
  return { root, note: path.join(vault, 'Characters', 'PCs', 'Brannoch_Vale.md') };
}

test('CLI: sheet set writes the note; --dry-run and --stdin do not', () => {
  const { root, note } = copyVault();
  const cli = args => spawnSync(process.execPath, [CLI, 'sheet', 'set', ...args], { cwd: root, encoding: 'utf8' });
  const dry = cli(['--pc', 'Brannoch Vale', 'hp=41', 'hit-dice=1/5', '--dry-run']);
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /✓ Brannoch Vale — HP \(Current\) 34→41, Hit Dice \(Spent\/Max\) 0\/5→1\/5 {2}\(would write\)/);
  assert.equal(fs.readFileSync(note, 'utf8'), BRANNOC);
  const viaStdin = execFileSync(process.execPath, [CLI, 'sheet', 'set', '--vault', 'vault', '--file', 'Characters/PCs/Brannoch_Vale.md', '--stdin', 'hp=41'],
    { cwd: root, input: BRANNOC, encoding: 'utf8' });
  assert.equal(JSON.parse(viaStdin).changed, true);
  assert.equal(fs.readFileSync(note, 'utf8'), BRANNOC);
  const real = cli(['--pc', 'Brannoch Vale', 'hp=41', 'hit-dice=1/5']);
  assert.equal(real.status, 0, real.stderr);
  assert.match(row(fs.readFileSync(note, 'utf8'), /^\| HP \(Current\)/), /\| 41 \|/);
  assert.match(row(fs.readFileSync(note, 'utf8'), /^\| Hit Dice/), /\| 1\/5 \|/);
});

test('CLI: usage errors exit 1 before anything is read', () => {
  const { root, note } = copyVault();
  const cli = args => spawnSync(process.execPath, [CLI, 'sheet', 'set', ...args], { cwd: root, encoding: 'utf8' });
  for (const [args, said] of [
    [['hp=41'], /sheet set needs --pc <name>/],
    [['--pc', 'Brannoch Vale', '--nope', 'hp=41'], /Unknown argument: --nope/],
    [['--vault', 'vault', '--file', 'x.md', 'hp=1'], /--vault and --file go with --stdin/],
    [['--stdin', 'hp=1'], /--stdin needs --vault <dir> and --file <note>/],
    [['--pc', 'Brannoch Vale', 'bogus=1'], /unknown key "bogus"/],
  ]) {
    const r = cli(args);
    assert.equal(r.status, 1, args.join(' '));
    assert.match(r.stderr, said);
  }
  assert.equal(fs.readFileSync(note, 'utf8'), BRANNOC);
});

// Task 23b B14: the run sheet's CoC conditions (the ontology's) and the keys `sheet set` writes are one list: a sixth on
// either side would pass silently otherwise
for (const id of ['coc-7e', 'coc-7e-regency']) {
  test(`${id}: the ontology's five status keys are all of sheet set's status keys`, () => {
    const col = vitalsColumns(id).find((c) => c.field === 'conditions');
    const ontology = Object.values(col.sheet).sort();
    const written = COC_CONDITIONS.map((c) => c[0]).sort();
    assert.strictEqual(ontology.length, 5);
    assert.deepStrictEqual(ontology, written);
  });
}
