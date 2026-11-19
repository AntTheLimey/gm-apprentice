'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildIndex } = require('../lib/run-sheet/notes');
const { readBeats } = require('../lib/run-sheet/beats');
const { foesOf, foesFor } = require('../lib/run-sheet/foes');

const FIXTURE = path.join(__dirname, 'fixtures', 'run-sheet');
const PLAN = 'Chapters/Chapter 1/Sessions/Session 02/Session 02 - The Test - Plan.md';

function setup(edit) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-'));
  fs.cpSync(FIXTURE, dir, { recursive: true });
  if (edit) {
    const p = path.join(dir, PLAN);
    fs.writeFileSync(p, edit(fs.readFileSync(p, 'utf8')));
  }
  const index = buildIndex(dir);
  return { index, beats: readBeats(index.read(PLAN).body, index).beats };
}
const one = (index, name, count = 1) => foesOf(`Creatures/${name}.md`, index, count, 'b-test');
const npc = (index, name, count = 1) => foesOf(`Characters/NPCs/${name}.md`, index, count, 'b-test');

describe('run sheet foes', () => {
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
      assert.deepStrictEqual(foesOf(p, index, 2, 'b-test'), { foes: [], warnings: [] });
    }
    assert.deepStrictEqual(foesOf('Nowhere.md', index, 1, 'b-test'), { foes: [], warnings: [] });
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
    assert.strictEqual(warnings.filter((w) => w.kind === 'no-initiative' && w.note === 'Creatures/Ice Drake.md').length, 1);
  });

  it('a contingency gets its foes', () => {
    const { index, beats } = setup();
    const c = beats.find((b) => b.contingency);
    const { foes } = foesFor(c, index);
    assert.deepStrictEqual(foes.map((f) => f.name), ['Frost Wolf 1', 'Frost Wolf 2']);
  });

  it('a foe note\'s treasure joins the beat once', () => {
    const { index, beats } = setup();
    const gate = beats[0];
    const r = foesFor({ ...gate, who: [...gate.who, ...gate.who] }, index);
    const loot = r.treasure.filter((t) => t.text === 'A wolf-tooth necklace');
    assert.strictEqual(loot.length, 1);
    assert.strictEqual(loot[0].box, false);
    assert.ok(loot[0].key.includes('.loot.'));
    const keys = [...gate.treasure, ...r.treasure].map((t) => t.key);
    assert.strictEqual(new Set(keys).size, keys.length);
  });
});
