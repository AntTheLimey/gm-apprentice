'use strict';
const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { readText } = require('./helpers/run-sheet-lines');
const { buildIndex } = require('../lib/run-sheet/notes');
const { readBeats } = require('../lib/run-sheet/beats');
const { foesOf, foesFor, beatCanFight } = require('../lib/run-sheet/foes');
const { systemFor } = require('../lib/run-sheet/systems');

// Every scratch dir is removed when the file's tests finish.
const made = [];
const mkTmp = (prefix) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); made.push(d); return d; };
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

const FIXTURE = path.join(__dirname, 'fixtures', 'run-sheet');
const GMA = path.join(__dirname, '..', '..', '..', 'skills', 'shared', 'scripts', 'gma.py');
const PLAN = 'Chapters/Chapter 1/Sessions/Session 02/Session 02 - The Test - Plan.md';

function setup(edit, files = {}) {
  const dir = mkTmp('rs-');
  fs.cpSync(FIXTURE, dir, { recursive: true });
  for (const [f, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), text);
  }
  if (edit) {
    const p = path.join(dir, PLAN);
    fs.writeFileSync(p, edit(readText(p)));
  }
  const index = buildIndex(dir);
  return { index, beats: readBeats(index.read(PLAN).body, index).beats };
}
const one = (index, name, count = 1) => foesOf(`Creatures/${name}.md`, index, count, 'b-test');
const npc = (index, name, count = 1) => foesOf(`Characters/NPCs/${name}.md`, index, count, 'b-test');

describe('run sheet foes', () => {
  it('an ally starts from the carried hit points; a foe never does', () => {
    const { index } = setup();
    const lucan = 'Characters/NPCs/Lucan Grey.md';
    const wolf = 'Creatures/Frost Wolf.md';
    const hp = new Map([[lucan, 3], [wolf, 1]]);
    const carried = { of: (n) => (hp.has(n) ? { hp: hp.get(n), log: 'Log.md' } : null) };
    const [a] = foesOf(lucan, index, 1, 'b-test', new Set(), carried).foes;
    assert.deepStrictEqual([a.ally, a.hp, a.hpNow, a.carriedFrom], [true, 16, 3, 'Log.md']);
    const [w] = foesOf(wolf, index, 1, 'b-test', new Set(), carried).foes;
    assert.deepStrictEqual([w.ally, w.hpNow, w.carriedFrom], [false, null, null]);
    // nothing carried: both null
    const [b] = foesOf(lucan, index, 1, 'b-test').foes;
    assert.deepStrictEqual([b.hpNow, b.carriedFrom], [null, null]);
  });

  it('every copy of a counted foe carries the block\'s hpStart', () => {
    const { index } = setup();
    const note = 'Characters/NPCs/Hurt Sexton.md';
    const withBlock = { has: (p) => p === note, read: () => ({ fm: { name: 'Hurt Sexton', type: 'npc' }, body: '## Stats\n\n**HP** 10 (currently 4) \u00b7 **AC** 11\n' }), gmSection: () => '', resolve: index.resolve, itemOf: index.itemOf };
    const { foes } = foesOf(note, withBlock, 3, 'b-test');
    assert.deepStrictEqual(foes.map((f) => [f.name, f.hp, f.hpStart]), [['Hurt Sexton 1', 10, 4], ['Hurt Sexton 2', 10, 4], ['Hurt Sexton 3', 10, 4]]);
  });

  it('tuned hit points beat the stock figure', () => {
    const { index } = setup();
    const [f] = one(index, 'Frost Wolf').foes;
    assert.deepStrictEqual([f.hp, f.ac, f.init], [15, 13, 2]);
    assert.deepStrictEqual(f.recharge, ['Howl']);
    assert.strictEqual(f.legendaryResistance, 1);
    assert.strictEqual(f.legendaryActions, 2);
    assert.strictEqual(f.lair, true);
    assert.ok(f.stats.startsWith('AC 13, Hit Points 11'));
  });

  it('counts make numbered foes with stable keys', () => {
    const { index } = setup();
    const a = one(index, 'Frost Wolf', 3).foes;
    assert.deepStrictEqual(a.map((f) => f.name), ['Frost Wolf 1', 'Frost Wolf 2', 'Frost Wolf 3']);
    assert.strictEqual(new Set(a.map((f) => f.key)).size, 3);
    assert.deepStrictEqual(a.map((f) => f.key), one(index, 'Frost Wolf', 3).foes.map((f) => f.key));
    assert.strictEqual(one(index, 'Frost Wolf').foes[0].name, 'Frost Wolf');
    assert.strictEqual(a[0].note, 'Creatures/Frost Wolf.md');
  });

  it('boss counters read', () => {
    const { index } = setup();
    const w = one(index, 'Glacier Wyrm').foes[0];
    assert.deepStrictEqual([w.ac, w.hp, w.init, w.legendaryResistance, w.legendaryActions, w.lair, w.recharge],
      [17, 183, 3, 2, 3, true, []]);
  });

  it('reads the SRD 5.2.1 legendary counts: (3/Day, or 4/Day in Lair) and Legendary Action Uses (Review L3)', () => {
    const dir = mkTmp('rs-');
    fs.cpSync(FIXTURE, dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'Creatures', 'Old Dragon.md'), [
      '---', 'name: Old Dragon', 'type: creature', '---', '', '## GM Notes', '', '### Stats', '',
      '**AC** 18; **HP** 200; **Initiative** +4 (14)', '',
      '***Legendary Resistance (3/Day, or 4/Day in Lair).*** If the dragon fails a saving throw, it can choose to succeed instead.', '',
      '**Legendary Action Uses:** 3 (4 in Lair). Immediately after another creature\'s turn, the dragon can expend a use.', '',
    ].join('\r\n'));
    const [d] = foesOf('Creatures/Old Dragon.md', buildIndex(dir), 1, 'b-test').foes;
    assert.deepStrictEqual([d.ac, d.hp, d.legendaryResistance, d.legendaryActions], [18, 200, 3, 3]);
  });

  it('reads every real stat-block shape', () => {
    const { index } = setup();
    const abbot = npc(index, 'Abbot Rime').foes[0];
    assert.deepStrictEqual([abbot.ac, abbot.hp, abbot.init, abbot.legendaryResistance, abbot.ally], [15, 99, 0, 2, false]);
    const monk = npc(index, 'Brother Venn').foes[0];
    assert.deepStrictEqual([monk.ac, monk.hp, monk.init], [15, 48, 2]);
    const guard = npc(index, 'Garrick Fell').foes[0];
    assert.deepStrictEqual([guard.ac, guard.hp, guard.init, guard.ally], [16, 38, 0, true]);
    const mephit = one(index, 'Ice Mephit').foes[0];
    assert.deepStrictEqual([mephit.ac, mephit.hp, mephit.init], [11, 21, 1]);
  });

  it('an ally comes from the stat block, not the Plan line', () => {
    const { index } = setup();
    assert.strictEqual(npc(index, 'Lucan Grey').foes[0].ally, true);
    assert.strictEqual(one(index, 'Frost Wolf').foes[0].ally, false);
  });

  it('no stats, no foe', () => {
    const { index } = setup();
    for (const p of ['Creatures/Hollow Stalker.md', 'Characters/NPCs/Sister Fen.md', 'Chapters/Chapter 1/Sessions/Session 02/Session 02 - The Test - Plan.md']) {
      assert.deepStrictEqual(foesOf(p, index, 2, 'b-test').foes, []);
    }
    assert.deepStrictEqual(foesOf('Nowhere.md', index, 1, 'b-test'), { foes: [], warnings: [] });
  });

  it('a creature with no stats, or a crowd with none, warns no-stats; a lone social NPC does not', () => {
    const { index } = setup();
    const kinds = (p, n) => foesOf(p, index, n, 'b-test').warnings.map((w) => [w.kind, w.note]);
    assert.deepStrictEqual(kinds('Creatures/Hollow Stalker.md', 1), [['no-stats', 'Creatures/Hollow Stalker.md']]);
    assert.deepStrictEqual(kinds('Characters/NPCs/Sister Fen.md', 3), [['no-stats', 'Characters/NPCs/Sister Fen.md']]);
    assert.deepStrictEqual(kinds('Characters/NPCs/Sister Fen.md', 1), []);
    const { beats, index: ix } = setup((t) => t.replace('- **[[Missing Person]]:** watching from the trees', '- **[[Hollow Stalker]]:** watching from the trees'));
    const c = beats.find((b) => b.contingency);
    assert.ok(foesFor(c, ix).warnings.some((w) => w.kind === 'no-stats' && w.note === 'Creatures/Hollow Stalker.md'));
    // S6-D7: the warning says what to do, and no row is dropped
    assert.ok(foesFor(c, ix).warnings.some((w) => w.text === 'Hollow Stalker: no numbers in the vault: type them in the fight, or fill them in prep'));
  });

  // S6-D7: a beat that can fight gives blank rows to type into: a creature or counted entry with no stats, a counted
  // line with no note, a counted link to a group note; a single statless NPC is a benched blank row (D4).
  describe('blank rows in a fight beat', () => {
    const WARDENS = { 'Factions/Gate Wardens.md': '---\nname: Gate Wardens\ntype: faction\n---\n\nThe gate\'s keepers.\n' };
    const withLines = (lines) => (t) => t.replace('- **[[Lucan Grey]] (Lucan):** helps\n', `- **[[Lucan Grey]] (Lucan):** helps\n${lines}\n`);
    const gate = (beats) => beats.find((b) => b.title === 'The Gate');
    const foesOfGate = (lines, files) => { const { index, beats } = setup(withLines(lines), files); return foesFor(gate(beats), index); };
    const NO_NUMBERS = (n) => `${n}: no numbers in the vault: type them in the fight, or fill them in prep`;

    it('a no-note counted line gives four numbered rows', () => {
      const r = foesOfGate('- **Foam-covered guards \u00d74:** rifles');
      const rows = r.foes.filter((f) => /^Foam/.test(f.name));
      assert.deepStrictEqual(rows.map((f) => [f.name, f.note, f.hp]), [1, 2, 3, 4].map((i) => [`Foam-covered guards ${i}`, null, null]));
      assert.strictEqual(new Set(rows.map((f) => f.key)).size, 4);
      assert.ok(r.warnings.some((w) => w.text === NO_NUMBERS('Foam-covered guards')));
    });

    it('"four guards" counts', () => {
      const r = foesOfGate('- **four guards:** rifles');
      assert.deepStrictEqual(r.foes.filter((f) => /^guards/.test(f.name)).map((f) => f.name), ['guards 1', 'guards 2', 'guards 3', 'guards 4']);
    });

    it('a counted faction link gives four rows carrying the faction note', () => {
      const r = foesOfGate('- **[[Gate Wardens|Warden guards]] \u00d74:** hold the door', WARDENS);
      const rows = r.foes.filter((f) => f.note === 'Factions/Gate Wardens.md');
      assert.deepStrictEqual(rows.map((f) => f.name), [1, 2, 3, 4].map((i) => `Warden guards ${i}`));
      assert.ok(rows.every((f) => f.ally === false && !f.benched));
    });

    it('a single statless NPC is a benched blank row', () => {
      const r = foesOfGate('- **[[Sister Fen]]:** hides');
      const fen = r.foes.find((f) => f.note === 'Characters/NPCs/Sister Fen.md');
      assert.deepStrictEqual([fen.name, fen.benched, fen.hp, fen.ac], ['Sister Fen', true, null, null]);
    });

    it('a single no-note line is one benched blank row with no warning', () => {
      const r = foesOfGate('- **The shikarri:** wants a clean drive');
      const row = r.foes.filter((f) => f.name === 'The shikarri');
      assert.deepStrictEqual(row.map((f) => [f.note, f.benched, f.hp]), [[null, true, null]]);
      assert.ok(!r.warnings.some((w) => /shikarri/.test(w.text)));
    });

    it('a capitalised number word stays a name: one benched row, not four', () => {
      const r = foesOfGate('- **Four Guards:** rifles');
      assert.deepStrictEqual(r.foes.filter((f) => /Guards/.test(f.name)).map((f) => [f.name, f.benched]), [['Four Guards', true]]);
    });

    it('a dead creature in a fight beat raises no warning: there is no row to type into', () => {
      const dead = { 'Creatures/Old Bones.md': '---\nname: Old Bones\ntype: creature\nstatus: dead\n---\n\nGone.\n' };
      const r = foesOfGate('- **[[Old Bones]]:** lies there', dead);
      assert.ok(!r.foes.some((f) => f.name === 'Old Bones'));
      assert.ok(!r.warnings.some((w) => /Old Bones/.test(w.text)));
    });

    // S6-D7: a beat with no Type at all can fight, so this one is typed social to stay a beat that cannot
    it('a social beat (typed social, nobody counted) gives no rows for statless people', () => {
      const { index, beats } = setup((t) => t.replace('**Starts it:** The bell has rung and the wolves are quiet.\n', '**Starts it:** The bell has rung and the wolves are quiet.\n**Type:** social\n**NPCs**\n- **[[Sister Fen]]:** watching\n'));
      const social = beats.filter((b) => b.title === 'The Gate')[1];
      assert.deepStrictEqual(social.who.map((w) => w.name), ['Sister Fen']);
      assert.deepStrictEqual(foesFor(social, index), { foes: [], treasure: [], warnings: [] });
    });

    it('a dead counted creature gives no rows and no warning', () => {
      const dead = { 'Creatures/Old Bones.md': '---\nname: Old Bones\ntype: creature\nstatus: dead\n---\n\nGone.\n' };
      const r = foesOfGate('- **[[Old Bones]] \u00d73:** lie there', dead);
      assert.ok(!r.foes.some((f) => /Old Bones/.test(f.name)));
      assert.ok(!r.warnings.some((w) => /Old Bones/.test(w.text)));
    });

    // Task 23b B3: a blank row's figures are all null in every system, never undefined
    for (const [id, keys] of [['coc-7e', ['init', 'dex']], ['gurps-4e', ['init', 'speed']]]) {
      it(`a blank ${id} row carries null for its initiative figures`, () => {
        const { index, beats } = setup(withLines('- **Four Guards:** rifles'));
        const r = foesFor(gate(beats), index, new Set(), null, null, systemFor(id));
        const blank = r.foes.find((f) => /Guards/.test(f.name));
        assert.ok(blank, 'the blank row');
        for (const k of ['ac', 'hp', ...keys]) assert.strictEqual(blank[k], null, k);
      });
    }

    it('a dead person in a fight beat gets no blank row', () => {
      const dead = { 'Characters/NPCs/Quiet Dead.md': '---\nname: Quiet Dead\ntype: npc\nstatus: dead\n---\n\nGone.\n' };
      const r = foesOfGate('- **[[Quiet Dead]]:** lies there', dead);
      assert.ok(!r.foes.some((f) => f.name === 'Quiet Dead'));
    });

    it('the warning names only ticked rows', () => {
      const r = foesOfGate('- **[[Sister Fen]]:** hides\n- **Foam-covered guards \u00d74:** rifles');
      const no = r.warnings.filter((w) => /no numbers in the vault: type them in the fight/.test(w.text)).map((w) => w.text);
      assert.deepStrictEqual(no, [NO_NUMBERS('Foam-covered guards')], 'the benched person raises none');
    });
  });

  it('Armor Class reads as AC, and each missing figure warns on its own', () => {
    const dir = mkTmp('rs-');
    fs.cpSync(FIXTURE, dir, { recursive: true });
    const note = (n, stats) => fs.writeFileSync(path.join(dir, 'Creatures', `${n}.md`),
      `---\nname: ${n}\ntype: creature\n---\n\n## GM Notes\n\n### Stats\n\n${stats}\n`);
    note('Spelled', '**Armor Class** 14 · **Hit Points** 22 · **Initiative** +1');
    note('NoAc', '**Hit Points** 22 · **Initiative** +1');
    note('NoHp', '**AC** 12');
    const index = buildIndex(dir);
    const s = one(index, 'Spelled');
    assert.deepStrictEqual([s.foes[0].ac, s.foes[0].hp, s.foes[0].init], [14, 22, 1]);
    assert.deepStrictEqual(s.warnings, []);
    assert.deepStrictEqual(one(index, 'NoAc').warnings.map((w) => w.kind), ['no-ac']);
    assert.deepStrictEqual(one(index, 'NoHp').warnings.map((w) => w.kind), ['no-hp', 'no-initiative']);
  });

  it('one creature on two lines of a beat: unique keys, numbered across the beat', () => {
    const { index, beats } = setup();
    const c = beats.find((b) => b.contingency);
    const wolf = c.who.find((w) => w.note === 'Creatures/Frost Wolf.md');
    const { foes } = foesFor({ ...c, who: [wolf, { ...wolf, count: 1 }] }, index);
    assert.deepStrictEqual(foes.map((f) => f.name), ['Frost Wolf 1', 'Frost Wolf 2', 'Frost Wolf 3']);
    assert.strictEqual(new Set(foes.map((f) => f.key)).size, 3);
  });

  it('a stock name with no numbers warns once, hp null', () => {
    const { index, beats } = setup((t) => t.replace('- **[[Missing Person]]:** watching from the trees', '- **[[Missing Person]]:** watching\n- **[[Ice Drake]]:** circling')
      .replace('- **[[Brother Ash]]:** wants the bell rung', '- **[[Brother Ash]]:** wants the bell rung\n- **[[Ice Drake]]:** above'));
    const seen = new Set();
    const warnings = [];
    let drakes = 0;
    for (const b of beats) {
      const r = foesFor(b, index, seen);
      warnings.push(...r.warnings);
      for (const f of r.foes.filter((x) => x.note === 'Creatures/Ice Drake.md')) {
        drakes++;
        assert.strictEqual(f.hp, null);
        assert.strictEqual(f.ac, null);
        assert.strictEqual(f.init, null);
      }
    }
    assert.ok(drakes >= 2);
    const none = warnings.filter((w) => w.kind === 'no-numbers');
    assert.strictEqual(none.length, 1);
    assert.strictEqual(none[0].note, 'Creatures/Ice Drake.md');
    assert.ok(none[0].text.includes('Ice Drake names a stat block with no numbers in the vault'));
    // no numbers at all is one warning, not a second one for the initiative
    assert.strictEqual(warnings.filter((w) => w.kind === 'no-initiative' && w.note === 'Creatures/Ice Drake.md').length, 0);
  });

  it('a block with numbers but no initiative warns for the initiative', () => {
    const dir = mkTmp('rs-');
    fs.cpSync(FIXTURE, dir, { recursive: true });
    const wolf = path.join(dir, 'Creatures/Frost Wolf.md');
    fs.writeFileSync(wolf, readText(wolf).replace('AC 13, Hit Points 11, Initiative +2', 'AC 13, Hit Points 11'));
    const { warnings } = one(buildIndex(dir), 'Frost Wolf');
    assert.deepStrictEqual(warnings.map((w) => w.kind), ['no-initiative']);
  });

  it('a contingency gets its foes', () => {
    const { index, beats } = setup();
    const c = beats.find((b) => b.contingency);
    const { foes } = foesFor(c, index);
    // S6-D7 (single no-note line): the person whose link matches no note is one benched blank row, after the wolves
    assert.deepStrictEqual(foes.map((f) => [f.name, !!f.benched]), [['Frost Wolf 1', false], ['Frost Wolf 2', false], ['Missing Person', true]]);
  });

  it('a foe note\'s treasure joins the beat once', () => {
    const { index, beats } = setup();
    const c = beats.find((b) => b.contingency);
    assert.deepStrictEqual(c.treasure, []);
    const r = foesFor({ ...c, who: [...c.who, ...c.who] }, index);
    assert.strictEqual(r.treasure.length, 1);
    assert.strictEqual(r.treasure[0].text, 'A wolf-tooth necklace');
    assert.strictEqual(r.treasure[0].box, false);
    assert.ok(r.treasure[0].key.includes('.loot.'));
  });

  it('a beat with its own treasure gets none from the foe note', () => {
    const { index, beats } = setup();
    const gate = beats[0];
    assert.ok(gate.treasure.length > 0);
    assert.ok(gate.who.some((w) => w.note === 'Creatures/Frost Wolf.md'));
    assert.deepStrictEqual(foesFor(gate, index).treasure, []);
  });

  it('numbers stay on their line and a typeset minus reads', () => {
    const dir = mkTmp('rs-');
    fs.cpSync(FIXTURE, dir, { recursive: true });
    const note = (n, stats) => fs.writeFileSync(path.join(dir, 'Creatures', `${n}.md`),
      `---\nname: ${n}\ntype: creature\n---\n\n## GM Notes\n\n### Stats\n\n${stats}\n`);
    note('Minus', '**AC** 12 · **Initiative** \u22121 (9) · **HP** 9');
    note('Dash', '**Initiative** \u20131 (9) **AC** 12 **HP** 5');
    note('Wrap', 'AC 12 Initiative +1\ntrait ends in HP\n1d6 more\nAC\n14');
    const index = buildIndex(dir);
    assert.strictEqual(one(index, 'Minus').foes[0].init, -1);
    assert.strictEqual(one(index, 'Dash').foes[0].init, -1);
    const w = one(index, 'Wrap').foes[0];
    assert.deepStrictEqual([w.hp, w.ac], [null, 12]);
  });

  it('a filled note gives init, hp, ac and recharge', () => {
    const dir = mkTmp('rs-');
    fs.cpSync(FIXTURE, dir, { recursive: true });
    fs.mkdirSync(path.join(dir, '_Campaign'));
    fs.writeFileSync(path.join(dir, '_Campaign', 'Overview.md'),
      '---\ntype: campaign_overview\ngame_system: dnd-5e-2024\n---\n');
    const note = (n, stats) => fs.writeFileSync(path.join(dir, 'Creatures', `${n}.md`),
      `---\nname: ${n}\ntype: creature\n---\n\n<!-- gm-only -->\n\n## GM Notes\n\n### Stats\n\n${stats}\n\n<!-- /gm-only -->\n`);
    note('Blinded Mephit', 'Ice Mephit (SRD). Blinded.\n\nHP 9 after the fall.');
    note('Wyrmling', 'As Young White Dragon.');
    const run = spawnSync('python3', [GMA, 'stat-fill', dir, 'Creatures/Blinded Mephit.md', 'Creatures/Wyrmling.md', '--write'],
      { encoding: 'utf8' });
    assert.strictEqual(run.status, 0, run.stdout + run.stderr);
    const index = buildIndex(dir);
    const m = one(index, 'Blinded Mephit');
    assert.deepStrictEqual(m.warnings, []);
    // The tuned line is written after the block, so it wins.
    assert.deepStrictEqual([m.foes[0].ac, m.foes[0].hp, m.foes[0].init, m.foes[0].recharge], [11, 9, 1, ['Frost Breath']]);
    const d = one(index, 'Wyrmling');
    assert.deepStrictEqual(d.warnings, []);
    assert.deepStrictEqual([d.foes[0].ac, d.foes[0].hp, d.foes[0].init], [17, 123, 3]);
  });

  describe('reader fixes from the prototype pass', () => {
    const stats = (body) => `---\nname: X\ntype: npc\n---\n\n## GM Notes\n\n### Stats\n\n${body}\n`;
    const vault = (notes) => {
      const dir = mkTmp('rs-');
      fs.cpSync(FIXTURE, dir, { recursive: true });
      for (const [rel, text] of Object.entries(notes)) fs.writeFileSync(path.join(dir, rel), text);
      return buildIndex(dir);
    };
    const NOTES = {
      'Characters/NPCs/Dragon Keeper.md': stats('SRD **Young White Dragon**\n\n- AC 17; HP 123\n- tuning: breath at round 2'),
      'Characters/NPCs/Guard Captain.md': stats('SRD Guard\n\n**Actions**\n\n*Melee Attack Roll:* +4 to hit. *Hit:* 5 damage'),
      'Characters/NPCs/Clerk.md': stats('Clerk, a plain note with no numbers'),
      'Characters/NPCs/Clerk Two.md': stats('Clerk, a plain note with no numbers'),
    };
    const beat = (extra) => ({ key: 'b-x', type: '', contingency: false, who: [], ...extra });
    const who = (name, count = 1) => ({ note: `Characters/NPCs/${name}.md`, count });

    it('a stock block with only tuning warns stock-no-actions', () => {
      const index = vault(NOTES);
      const r = foesOf('Characters/NPCs/Dragon Keeper.md', index, 1, 'b-x');
      const w = r.warnings.filter((x) => x.kind === 'stock-no-actions');
      assert.strictEqual(w.length, 1);
      assert.strictEqual(w[0].text, 'X names a stock stat block but no actions are in the vault: fill them in prep (gma stat-fill)');
    });

    it('stock-no-actions is quiet at a beat that cannot fight: the row carries it', () => {
      const r = foesFor(beat({ type: 'social', who: [who('Dragon Keeper')] }), vault(NOTES));
      assert.deepStrictEqual(r.warnings.filter((x) => x.kind === 'stock-no-actions'), []);
      assert.match(r.foes[0].prepNote, /names a stock stat block but no actions/);
    });

    it('a pasted block does not', () => {
      const r = foesOf('Characters/NPCs/Guard Captain.md', vault(NOTES), 1, 'b-x');
      assert.strictEqual(r.foes.length, 1, 'the Guard Captain has his fight row');
      assert.strictEqual(r.foes[0].note, 'Characters/NPCs/Guard Captain.md');
      assert.deepStrictEqual(r.warnings.filter((x) => x.kind === 'stock-no-actions'), []);
    });

    it('a recharge with no number is no recharge, and does not stop the read', () => {
      const index = vault({ 'Characters/NPCs/Half.md': stats('Half, AC 12, HP 9\n\n***Breath (Recharge -).*** draft\n\n***Bite (Recharge 5–6).*** x\n\n***Roar (Recharge 6).*** y') });
      const [f] = foesOf('Characters/NPCs/Half.md', index, 1, 'b-x').foes;
      assert.deepStrictEqual(f.recharge, ['Bite', 'Roar']);
      assert.deepStrictEqual(f.rechargeAt, { Bite: 5, Roar: 6 });
    });

    it('no-numbers is quiet at a social beat: no warning, the text on the row', () => {
      const index = vault(NOTES);
      const r = foesFor(beat({ type: 'social', who: [who('Clerk'), who('Clerk Two')] }), index);
      assert.deepStrictEqual(r.warnings, []);
      assert.strictEqual(r.foes.length, 2);
      for (const f of r.foes) assert.match(f.prepNote, /names a stat block with no numbers in the vault: fill them in prep/);
    });

    it('no-numbers still warns at a combat beat', () => {
      const r = foesFor(beat({ type: 'combat', who: [who('Clerk')] }), vault(NOTES));
      assert.deepStrictEqual(r.warnings.map((w) => w.kind), ['no-numbers']);
      assert.strictEqual(r.foes[0].prepNote, null);
      for (const type of ['fight', 'battle', 'ambush']) {
        assert.strictEqual(foesFor(beat({ type, who: [who('Clerk')] }), vault(NOTES)).warnings.length, 1, type);
      }
    });

    it('and with a creature present, a count above 1, or at a contingency', () => {
      const index = vault(NOTES);
      const withCreature = foesFor(beat({ type: 'social', who: [who('Clerk'), { note: 'Creatures/Frost Wolf.md', count: 1 }] }), index);
      assert.ok(withCreature.warnings.some((w) => w.kind === 'no-numbers'));
      const many = foesFor(beat({ type: 'social', who: [who('Clerk', 2)] }), index);
      assert.ok(many.warnings.some((w) => w.kind === 'no-numbers'));
      const contingency = foesFor(beat({ type: 'social', contingency: true, who: [who('Clerk')] }), index);
      assert.ok(contingency.warnings.some((w) => w.kind === 'no-numbers'));
    });

    it('a row of numbers missing only at a social beat keeps its text as prepNote too', () => {
      const index = vault({ 'Characters/NPCs/Half.md': stats('Half, AC 12') });
      const r = foesFor(beat({ type: 'social', who: [who('Half')] }), index);
      assert.deepStrictEqual(r.warnings, []);
      assert.match(r.foes[0].prepNote, /no hit points/);
      assert.match(r.foes[0].prepNote, /no initiative/);
    });
  });
});

describe('run sheet foes: recharge forms and lair actions (5b)', () => {
  const noteWith = (stats) => {
    const dir = mkTmp('rs-');
    fs.cpSync(FIXTURE, dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'Creatures', 'Shape.md'),
      `---\nname: Shape\ntype: creature\n---\n\n<!-- gm-only -->\n\n## GM Notes\n\n### Stats\n\n${stats}\n\n<!-- /gm-only -->\n`);
    return foesOf('Creatures/Shape.md', buildIndex(dir), 1, 'b-test').foes[0];
  };

  it('a plain recharge in a one-line block', () => {
    const f = noteWith('SRD **Ice Mephit** (CR 1/2). **AC** 11 · **Initiative** +1 · **HP** 21 (6d6). Claw +3, 1d4+1 Slashing plus 1d4 Cold. Frost Breath (Recharge 6): 15-ft cone, Con save DC 10. Fog Cloud 1/day.');
    assert.deepStrictEqual(f.recharge, ['Frost Breath']);
    assert.deepStrictEqual(f.rechargeAt, { 'Frost Breath': 6 });
    const range = noteWith('AC 11 HP 9 Initiative +1. Breath Weapon (Recharge 5–6): a cone.');
    assert.deepStrictEqual(range.rechargeAt, { 'Breath Weapon': 5 });
  });

  it('the bold form still wins its name', () => {
    const f = noteWith('AC 11 HP 9 Initiative +1. Cold Breath (Recharge 6) in the summary.\n\n***Cold Breath (Recharge 5–6).*** A cone.');
    assert.deepStrictEqual(f.recharge, ['Cold Breath']);
    assert.deepStrictEqual(f.rechargeAt, { 'Cold Breath': 5 });
  });

  it('a bold name with lower-case words gives no stray plain name', () => {
    const f = noteWith('AC 11 HP 9 Initiative +1\n\n- ***Breath Under the Ice (Recharge 5–6).*** He breathes.');
    assert.deepStrictEqual(f.recharge, ['Breath Under the Ice']);
    assert.deepStrictEqual(f.rechargeAt, { 'Breath Under the Ice': 5 });
  });

  it('plain names with small words read as the bold ones do', () => {
    const plain = noteWith('AC 11 HP 9 Initiative +1. Breath of Frost (Recharge 5–6): a cone. Touch of Frost (Recharge 6): a touch.');
    const bold = noteWith('AC 11 HP 9 Initiative +1\n\n***Breath of Frost (Recharge 5–6).*** A cone.\n\n***Touch of Frost (Recharge 6).*** A touch.');
    assert.deepStrictEqual(plain.recharge, ['Breath of Frost', 'Touch of Frost']);
    assert.deepStrictEqual(plain.rechargeAt, { 'Breath of Frost': 5, 'Touch of Frost': 6 });
    assert.deepStrictEqual([plain.recharge, plain.rechargeAt], [bold.recharge, bold.rechargeAt]);
  });

  it("lair actions are the block's list", () => {
    const { index } = setup();
    const wyrm = one(index, 'Glacier Wyrm').foes[0];
    assert.strictEqual(wyrm.lairActions, '- The ice shifts.', 'the fixture\'s indented list');
    const top = noteWith('AC 11 HP 9 Initiative +1\n\n**Lair Actions** (anywhere in the house). On initiative count 20, he takes one of these.\n- ***The Hymn.*** The brothers sing.\n- ***Rime.*** Frost climbs.\n\n**Villain Actions.** At the end of a round.\n- ***1. Peace.*** Fear.');
    assert.strictEqual(top.lairActions, '- ***The Hymn.*** The brothers sing.\n- ***Rime.*** Frost climbs.', 'the Severin shape: a top-level list under the line');
    assert.strictEqual(one(index, 'Frost Wolf').foes[0].lairActions, '', 'a Lair Actions line with no list');
    assert.strictEqual(one(index, 'Ice Mephit').foes[0].lairActions, '', 'no Lair Actions at all');
    const nested = noteWith('AC 11 HP 9 Initiative +1\n\n- ***Lair Actions*** (on initiative 20):\n    - Icefall.\n      - A sub-point.\n    - Fog.');
    assert.strictEqual(nested.lairActions, '- Icefall.\n  - A sub-point.\n- Fog.');
    assert.strictEqual(noteWith('AC 11 HP 9 Initiative +1\n\nLair actions work here, recast.\n\n- ***Lair Actions*** (on 20):\n  - Fog.').lairActions, '- Fog.', 'a prose mention before the real line');
  });
});

// Task 9: rows from a contingency's Then links and from an older Plan's Entities line.
describe('run sheet foes: Then links and Entities lines', () => {
  const note = (name, type, extra = '') => `---\nname: ${name}\ntype: ${type}\n---\n\n${extra}`;
  const STATS = '## Stats\n\nAC 12, Hit Points 9, Initiative +1\n';
  const FILES = {
    'Characters/NPCs/Arriver One.md': note('Arriver One', 'npc', STATS),
    'Characters/NPCs/Arriver Bare.md': note('Arriver Bare', 'npc'),
    'Creatures/Arriver Beast.md': note('Arriver Beast', 'creature', STATS),
    'Locations/Arriver Hall.md': note('Arriver Hall', 'location'),
    'Items/Arriver Lamp.md': note('Arriver Lamp', 'item'),
    'Chapters/Scene Note.md': note('Scene Note', 'scene'),
  };
  const P = (n) => `Characters/NPCs/${n}.md`;
  const beat = (extra) => ({ key: 'b-x', title: 'The arrival', type: '', contingency: false, who: [], then: '', entities: [], ...extra });
  const rowsOf = (b, others = []) => { const { index } = setup(null, FILES); return foesFor(b, index, new Set(), null, null, undefined, others); };

  it('Then links give ticked rows', () => {
    const r = rowsOf(beat({ contingency: true, then: 'The [[Arriver One]], [[Arriver Beast]] and [[Arriver Bare]] come in. See [[Arriver Hall]].' }));
    assert.deepStrictEqual(r.foes.map((f) => [f.name, !f.benched, f.hp]), [['Arriver One', true, 9], ['Arriver Beast', true, 9], ['Arriver Bare', true, null]]);
    assert.ok(r.warnings.some((w) => w.kind === 'who-from-then' && w.text === 'The arrival: no NPCs block; its rows come from the people its Then lines link'));
    assert.ok(r.warnings.some((w) => w.text === 'Arriver Bare: no numbers in the vault: type them in the fight, or fill them in prep'));
    assert.ok(!r.warnings.some((w) => /Arriver One:/.test(w.text)));
  });

  it('a person already in the fight it joins is skipped', () => {
    const planned = beat({ who: [{ note: P('Arriver One'), count: 1 }] });
    const c = beat({ contingency: true, then: '[[Arriver One]] and [[Arriver Beast]] come in.' });
    assert.deepStrictEqual(rowsOf(c, [planned, c]).foes.map((f) => f.name), ['Arriver Beast']);
  });

  it('a contingency with an NPCs block ignores its Then links', () => {
    const c = beat({ contingency: true, who: [{ note: P('Arriver One'), count: 1 }], then: '[[Arriver Beast]] comes in.' });
    const r = rowsOf(c);
    assert.deepStrictEqual(r.foes.map((f) => f.name), ['Arriver One']);
    assert.ok(!r.warnings.some((w) => w.kind === 'who-from-then'));
  });

  it('Entities give rows: creature ticked, NPC benched', () => {
    const r = rowsOf(beat({ type: 'combat', sceneNote: 'Chapters/Scene Note.md', entities: ['Creatures/Arriver Beast.md', P('Arriver One')] }));
    assert.deepStrictEqual(r.foes.map((f) => [f.name, !!f.benched]), [['Arriver Beast', false], ['Arriver One', true]]);
    assert.ok(r.warnings.some((w) => w.kind === 'who-from-entities' && w.note === 'Chapters/Scene Note.md'));
  });

  it('an untyped beat\'s Entities give rows, NPCs benched', () => {
    const r = rowsOf(beat({ type: '', entities: [P('Arriver One'), P('Arriver Bare'), 'Creatures/Arriver Beast.md'] }));
    assert.deepStrictEqual(r.foes.map((f) => [f.name, !!f.benched]), [['Arriver One', true], ['Arriver Bare', true], ['Arriver Beast', false]]);
    assert.ok(!r.warnings.some((w) => /Arriver (One|Bare):/.test(w.text)));
  });

  it('a dead creature in the Entities gives no row and no warning', () => {
    const { index } = setup(null, { ...FILES, 'Creatures/Arriver Husk.md': note('Arriver Husk', 'creature', STATS).replace('type: creature', 'type: creature\nstatus: dead') });
    const r = foesFor(beat({ type: 'combat', entities: ['Creatures/Arriver Husk.md', P('Arriver One')] }), index);
    assert.deepStrictEqual([r.foes.map((f) => f.name), r.warnings.filter((w) => /Husk/.test(w.text))], [['Arriver One'], []]);
  });

  it('a dead statless NPC linked from a Then line gives no row and no warning', () => {
    const { index } = setup(null, { ...FILES, 'Characters/NPCs/Arriver Gone.md': note('Arriver Gone', 'npc').replace('type: npc', 'type: npc\nstatus: dead') });
    const r = foesFor(beat({ contingency: true, then: '[[Arriver Gone]] and [[Arriver One]] come in.' }), index);
    assert.deepStrictEqual([r.foes.map((f) => f.name), r.warnings.filter((w) => /Gone/.test(w.text))], [['Arriver One'], []]);
  });

  it('a social beat\'s Entities give none', () => {
    const r = rowsOf(beat({ type: 'social', entities: [P('Arriver One'), 'Creatures/Arriver Beast.md'] }));
    assert.deepStrictEqual([r.foes, r.warnings], [[], []]);
  });

  it('a place, an item and the scene note among the Entities give no row', () => {
    const r = rowsOf(beat({ type: 'combat', entities: ['Locations/Arriver Hall.md', 'Items/Arriver Lamp.md', 'Chapters/Scene Note.md', P('Arriver One')] }));
    assert.deepStrictEqual(r.foes.map((f) => f.name), ['Arriver One']);
  });
});

describe('beatCanFight with no type', () => {
  it('an empty, blank or missing type can fight; a social type cannot', () => {
    const { index } = setup();
    const b = (type) => ({ contingency: false, who: [], ...(type === undefined ? {} : { type }) });
    assert.deepStrictEqual([undefined, '', '  ', null].map((t) => beatCanFight(b(t), index)), [true, true, true, true]);
    assert.strictEqual(beatCanFight(b('social'), index), false);
  });
});
