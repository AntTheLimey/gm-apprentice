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
const { foesOf, foesFor } = require('../lib/run-sheet/foes');

// Every scratch dir is removed when the file's tests finish.
const made = [];
const mkTmp = (prefix) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); made.push(d); return d; };
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

const FIXTURE = path.join(__dirname, 'fixtures', 'run-sheet');
const GMA = path.join(__dirname, '..', '..', '..', 'skills', 'shared', 'scripts', 'gma.py');
const PLAN = 'Chapters/Chapter 1/Sessions/Session 02/Session 02 - The Test - Plan.md';

function setup(edit) {
  const dir = mkTmp('rs-');
  fs.cpSync(FIXTURE, dir, { recursive: true });
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
    assert.deepStrictEqual(foes.map((f) => f.name), ['Frost Wolf 1', 'Frost Wolf 2']);
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

    it('a pasted block does not', () => {
      const r = foesOf('Characters/NPCs/Guard Captain.md', vault(NOTES), 1, 'b-x');
      assert.deepStrictEqual(r.warnings.filter((x) => x.kind === 'stock-no-actions'), []);
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
