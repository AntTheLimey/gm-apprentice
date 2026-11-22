'use strict';
// The run sheet's systems layer (step 6b Task 1): `systemFor` picks a system by the vault's `system`, D&D's
// reading moved into systems/dnd.js unchanged, and the rules a fight carries (`f.rules`, D&D's when it has none).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { buildIndex } = require('../lib/run-sheet/notes');
const { readRunSheet } = require('../lib/run-sheet/read');
const { foesOf } = require('../lib/run-sheet/foes');
const { systemFor } = require('../lib/run-sheet/systems');
const { statSection, currentOf } = require('../lib/run-sheet/systems/stat-section');
const RS = require('../lib/run-sheet/web/state');
const FM = require('../lib/run-sheet/web/fight-math');
const { copyFixture, withSystem, removeFixture, FIXTURES } = require('./helpers/systems-fixture');

const sha = (s) => crypto.createHash('sha1').update(String(s).replace(/\r\n?/g, '\n')).digest('hex').slice(0, 12);

// What main's foes.js gave for every note of the two D&D fixtures, captured before the move: `inspect`'s stats (by
// hash), and for a note with stats `readNumbers(stats, behaviour)` and `lacks(name, nums)`.
const MAIN = {
  "run-sheet/Chapters/Chapter 1/Chapter 1.md": {"stats":""},
  "run-sheet/Chapters/Chapter 1/Planning/Arc.md": {"stats":""},
  "run-sheet/Chapters/Chapter 1/Props/Ash's Note.md": {"stats":""},
  "run-sheet/Chapters/Chapter 1/Scenes/The Bell Tower.md": {"stats":""},
  "run-sheet/Chapters/Chapter 1/Scenes/Unplayed.md": {"stats":""},
  "run-sheet/Chapters/Chapter 1/Sessions/Session 02/Session 02 - The Test - Plan.md": {"stats":""},
  "run-sheet/Chapters/Chapter 1/Sessions/Session 02/Session 02 - The Test.md": {"stats":""},
  "run-sheet/Chapters/Chapter 1/Sessions/Session 03/Session 03 - Next - Plan.md": {"stats":""},
  "run-sheet/Characters/NPCs/Abbot Rime.md": {"stats":"b23fd4e8ac07","nums":{"ac":15,"hp":99,"init":0,"legendaryResistance":2,"legendaryActions":0,"recharge":[],"rechargeAt":{},"lair":false,"lairActions":""},"lacks":[]},
  "run-sheet/Characters/NPCs/Broken.md": {"stats":""},
  "run-sheet/Characters/NPCs/Brother Ash.md": {"stats":"ea6ba5c2ad69","nums":{"ac":12,"hp":9,"init":1,"legendaryResistance":0,"legendaryActions":0,"recharge":[],"rechargeAt":{},"lair":false,"lairActions":""},"lacks":[]},
  "run-sheet/Characters/NPCs/Brother Venn.md": {"stats":"23a41330ee04","nums":{"ac":15,"hp":48,"init":2,"legendaryResistance":0,"legendaryActions":0,"recharge":[],"rechargeAt":{},"lair":false,"lairActions":""},"lacks":[]},
  "run-sheet/Characters/NPCs/Garrick Fell.md": {"stats":"fa7307eafcd3","nums":{"ac":16,"hp":38,"init":0,"legendaryResistance":0,"legendaryActions":0,"recharge":[],"rechargeAt":{},"lair":false,"lairActions":""},"lacks":[]},
  "run-sheet/Characters/NPCs/Lucan Grey.md": {"stats":"98b563c2bec4","nums":{"ac":13,"hp":16,"init":2,"legendaryResistance":0,"legendaryActions":0,"recharge":[],"rechargeAt":{},"lair":false,"lairActions":""},"lacks":[]},
  "run-sheet/Characters/NPCs/Sister Fen.md": {"stats":""},
  "run-sheet/Characters/PCs/Ada Moss.md": {"stats":""},
  "run-sheet/Characters/PCs/Ben Hart.md": {"stats":""},
  "run-sheet/Creatures/Frost Wolf.md": {"stats":"69892cb775f2","nums":{"ac":13,"hp":15,"init":2,"legendaryResistance":1,"legendaryActions":2,"recharge":["Howl"],"rechargeAt":{"Howl":5},"lair":true,"lairActions":""},"lacks":[]},
  "run-sheet/Creatures/Glacier Wyrm.md": {"stats":"27f128917e53","nums":{"ac":17,"hp":183,"init":3,"legendaryResistance":2,"legendaryActions":3,"recharge":[],"rechargeAt":{},"lair":true,"lairActions":"- The ice shifts."},"lacks":[]},
  "run-sheet/Creatures/Hollow Stalker.md": {"stats":""},
  "run-sheet/Creatures/Ice Drake.md": {"stats":"b569797e2204","nums":{"ac":null,"hp":null,"init":null,"legendaryResistance":0,"legendaryActions":0,"recharge":[],"rechargeAt":{},"lair":false,"lairActions":""},"lacks":[{"kind":"no-numbers","text":"Ice Drake names a stat block with no numbers in the vault: fill them in prep"}]},
  "run-sheet/Creatures/Ice Mephit.md": {"stats":"1e8eda7e7605","nums":{"ac":11,"hp":21,"init":1,"legendaryResistance":0,"legendaryActions":0,"recharge":[],"rechargeAt":{},"lair":false,"lairActions":""},"lacks":[]},
  "run-sheet/Documents/Map of the Gate.md": {"stats":""},
  "run-sheet/Locations/North/index.md": {"stats":""},
  "run-sheet/Locations/South/index.md": {"stats":""},
  "run-sheet/Locations/The Bell Tower Room.md": {"stats":""},
  "run-sheet/Locations/The Chapel Yard.md": {"stats":""},
  "run-sheet/Locations/The Gate House.md": {"stats":""},
  "run-sheet/Locations/The Gate.md": {"stats":""},
  "run-sheet-players/Chapters/Chapter 1/Chapter 1.md": {"stats":""},
  "run-sheet-players/Chapters/Chapter 1/Planning/Arc.md": {"stats":""},
  "run-sheet-players/Chapters/Chapter 1/Props/Ash's Note.md": {"stats":""},
  "run-sheet-players/Chapters/Chapter 1/Scenes/Midnight Peal.md": {"stats":""},
  "run-sheet-players/Chapters/Chapter 1/Scenes/Unplayed.md": {"stats":""},
  "run-sheet-players/Chapters/Chapter 1/Sessions/Session 01/Session 01 - The Start - Wrap-Up.md": {"stats":""},
  "run-sheet-players/Chapters/Chapter 1/Sessions/Session 01/Session 01 - The Start.md": {"stats":""},
  "run-sheet-players/Chapters/Chapter 1/Sessions/Session 02/Session 02 - The Test - Plan.md": {"stats":""},
  "run-sheet-players/Chapters/Chapter 1/Sessions/Session 02/Session 02 - The Test - Table Log.md": {"stats":""},
  "run-sheet-players/Chapters/Chapter 1/Sessions/Session 02/Session 02 - The Test.md": {"stats":""},
  "run-sheet-players/Chapters/Chapter 1/Sessions/Session 03/Session 03 - Next - Plan.md": {"stats":""},
  "run-sheet-players/Chapters/Chapter 1/Sessions/Session 03/Session 03 - Next.md": {"stats":""},
  "run-sheet-players/Chapters/Chapter 2/Chapter 2.md": {"stats":""},
  "run-sheet-players/Chapters/Chapter 2/Sessions/Session 01/Session 01 - Snowmelt - Plan.md": {"stats":""},
  "run-sheet-players/Chapters/Chapter 2/Sessions/Session 01/Session 01 - Snowmelt.md": {"stats":""},
  "run-sheet-players/Characters/NPCs/Abbot Rime.md": {"stats":"b23fd4e8ac07","nums":{"ac":15,"hp":99,"init":0,"legendaryResistance":2,"legendaryActions":0,"recharge":[],"rechargeAt":{},"lair":false,"lairActions":""},"lacks":[]},
  "run-sheet-players/Characters/NPCs/Broken.md": {"stats":""},
  "run-sheet-players/Characters/NPCs/Brother Ash.md": {"stats":"ea6ba5c2ad69","nums":{"ac":12,"hp":9,"init":1,"legendaryResistance":0,"legendaryActions":0,"recharge":[],"rechargeAt":{},"lair":false,"lairActions":""},"lacks":[]},
  "run-sheet-players/Characters/NPCs/Brother Venn.md": {"stats":"7a77bf636e23","nums":{"ac":6179,"hp":7343,"init":91,"legendaryResistance":0,"legendaryActions":0,"recharge":[],"rechargeAt":{},"lair":false,"lairActions":""},"lacks":[]},
  "run-sheet-players/Characters/NPCs/Garrick Fell.md": {"stats":"fa7307eafcd3","nums":{"ac":16,"hp":38,"init":0,"legendaryResistance":0,"legendaryActions":0,"recharge":[],"rechargeAt":{},"lair":false,"lairActions":""},"lacks":[]},
  "run-sheet-players/Characters/NPCs/Hidden Abbot.md": {"stats":"bbdf53169c74","nums":{"ac":6178,"hp":7344,"init":94,"legendaryResistance":0,"legendaryActions":0,"recharge":[],"rechargeAt":{},"lair":false,"lairActions":""},"lacks":[]},
  "run-sheet-players/Characters/NPCs/Lucan Grey.md": {"stats":"98b563c2bec4","nums":{"ac":13,"hp":16,"init":2,"legendaryResistance":0,"legendaryActions":0,"recharge":[],"rechargeAt":{},"lair":false,"lairActions":""},"lacks":[]},
  "run-sheet-players/Characters/NPCs/Masked Gilt.md": {"stats":"0f64d2023207","nums":{"ac":6176,"hp":7345,"init":90,"legendaryResistance":0,"legendaryActions":0,"recharge":[],"rechargeAt":{},"lair":false,"lairActions":""},"lacks":[]},
  "run-sheet-players/Characters/NPCs/Quiet Dead.md": {"stats":""},
  "run-sheet-players/Characters/NPCs/Sister Fen.md": {"stats":""},
  "run-sheet-players/Characters/PCs/Ada Moss.md": {"stats":""},
  "run-sheet-players/Characters/PCs/Ben Hart.md": {"stats":""},
  "run-sheet-players/Creatures/Frost Wolf.md": {"stats":"8f37a905ed71","nums":{"ac":6177,"hp":7346,"init":95,"legendaryResistance":1,"legendaryActions":2,"recharge":["Howl"],"rechargeAt":{"Howl":5},"lair":true,"lairActions":""},"lacks":[]},
  "run-sheet-players/Creatures/Glacier Wyrm.md": {"stats":"a67db7d65975","nums":{"ac":6174,"hp":7342,"init":92,"legendaryResistance":2,"legendaryActions":3,"recharge":["Cold Breath"],"rechargeAt":{"Cold Breath":5},"lair":true,"lairActions":"- The ice shifts.\n- Fog rises."},"lacks":[]},
  "run-sheet-players/Creatures/Hollow Stalker.md": {"stats":""},
  "run-sheet-players/Creatures/Ice Drake.md": {"stats":"b569797e2204","nums":{"ac":null,"hp":null,"init":null,"legendaryResistance":0,"legendaryActions":0,"recharge":[],"rechargeAt":{},"lair":false,"lairActions":""},"lacks":[{"kind":"no-numbers","text":"Ice Drake names a stat block with no numbers in the vault: fill them in prep"}]},
  "run-sheet-players/Creatures/Ice Mephit.md": {"stats":"33c7465b590d","nums":{"ac":6173,"hp":7341,"init":97,"legendaryResistance":0,"legendaryActions":0,"recharge":["Frost Breath"],"rechargeAt":{"Frost Breath":6},"lair":false,"lairActions":""},"lacks":[]},
  "run-sheet-players/Creatures/Rime Imp.md": {"stats":"62cb302882a5","nums":{"ac":6175,"hp":21,"init":93,"legendaryResistance":0,"legendaryActions":0,"recharge":[],"rechargeAt":{},"lair":false,"lairActions":""},"lacks":[]},
  "run-sheet-players/Documents/Map of the Gate (GM).md": {"stats":""},
  "run-sheet-players/Documents/Map of the Gate.md": {"stats":""},
  "run-sheet-players/Locations/North/index.md": {"stats":""},
  "run-sheet-players/Locations/South/index.md": {"stats":""},
  "run-sheet-players/Locations/The Bell Tower Room.md": {"stats":""},
  "run-sheet-players/Locations/The Chapel Yard.md": {"stats":""},
  "run-sheet-players/Locations/The Gate House.md": {"stats":""},
  "run-sheet-players/Locations/The Gate.md": {"stats":""},
};

const T0 = Date.parse('2026-11-22T19:00:00.000Z');
let tick = 0;
const now = () => new Date(T0 + (++tick) * 60000).toISOString();

describe('run sheet systems', () => {
  it('systemFor resolves ids and aliases', () => {
    const dnd = systemFor('dnd-5e-2024').describe();
    assert.equal(dnd.id, 'dnd-5e-2024');
    assert.equal(dnd.family, 'dnd');
    assert.equal(dnd.fights, true);
    for (const id of ['dnd', 'DnD5e', ' d&d ', '5e']) assert.deepEqual(systemFor(id).describe(), dnd, id);
    // a vault with no system runs as D&D, as before 6b
    assert.equal(systemFor(null).fights, true);
    assert.equal(systemFor(undefined).describe().fights, true);
    assert.equal(systemFor(null).describe().family, 'dnd');
    // CoC and GURPS have no system module yet (Tasks 3 and 4): no Fight button, as on main; nor PF2e, FitD or an
    // unknown system
    for (const [raw, id] of [['coc', 'coc-7e'], ['coc-7e', 'coc-7e'], ['coc-7e-regency', 'coc-7e-regency'],
      ['regency-cthulhu', 'coc-7e-regency'], ['gurps4e', 'gurps-4e'], ['gurps-4e', 'gurps-4e'], ['pf2e', 'pf2e'],
      ['pathfinder', 'pf2e'], ['fitd', 'fitd'], ['blades', 'fitd'], ['nonsense', null], ['', null]]) {
      const sys = systemFor(raw);
      assert.equal(sys.fights, false, raw);
      assert.equal(sys.describe().fights, false, raw);
      assert.equal(sys.describe().id, id, raw);
    }
  });

  it('describe gives plain JSON with every key, and the fight part cut from it', () => {
    const r = systemFor('dnd-5e-2024').describe();
    assert.deepEqual(JSON.parse(JSON.stringify(r)), r);
    assert.deepEqual(Object.keys(r).sort(), ['autoOut', 'consequences', 'defences', 'family', 'fight', 'fights', 'firearmBonus',
      'hpFloor', 'id', 'initDecimals', 'initiative', 'label', 'manoeuvres', 'marks', 'orderFixed', 'panelBoxes', 'pools',
      'prompts', 'rowNumbers', 'statuses', 'tiredAt', 'toggles', 'vitals', 'words', 'wounding'].sort());
    const FIGHT = ['initiative', 'initDecimals', 'orderFixed', 'hpFloor', 'autoOut', 'marks', 'tiredAt', 'prompts',
      'firearmBonus', 'pools', 'wounding', 'consequences', 'defences', 'manoeuvres'];
    assert.deepEqual(Object.keys(r.fight).sort(), FIGHT.slice().sort());
    for (const k of FIGHT) assert.deepEqual(r.fight[k], r[k], k);
    assert.equal(r.initiative, 'roll');
    assert.equal(r.hpFloor, 0);
    assert.equal(r.autoOut, true);
    assert.equal(r.orderFixed, false);
    assert.deepEqual(r.statuses, FM.DND_STATUSES);
    assert.deepEqual(Object.keys(r.toggles).sort(), ['concentration', 'counters', 'deathSaves', 'defences', 'exhaustion', 'gun',
      'half', 'hitChips', 'longRest', 'manoeuvres', 'resisted', 'temp'].sort());
    for (const k of ['half', 'resisted', 'temp', 'deathSaves', 'concentration', 'exhaustion', 'counters', 'longRest']) assert.equal(r.toggles[k], true, k);
    for (const k of ['gun', 'hitChips', 'defences', 'manoeuvres']) assert.equal(r.toggles[k], false, k);
    for (const k of ['wounding', 'consequences', 'defences', 'manoeuvres']) assert.equal(r[k], null, k);
  });

  it('dnd.readFoe gives what foes.js gave', () => {
    const dnd = systemFor('dnd-5e-2024');
    let seen = 0;
    for (const fx of ['run-sheet', 'run-sheet-players']) {
      const index = buildIndex(path.join(FIXTURES, fx));
      for (const notePath of index.notes()) {
        const want = MAIN[`${fx}/${notePath}`];
        assert.ok(want, `${fx}/${notePath} is in the snapshot`);
        seen += 1;
        const got = dnd.readFoe({ notePath, index, text: index.read(notePath).body });
        // A statless note that now finds a block (S6-D4 as widened) would fail here: none of the D&D fixtures has one.
        const old = index.gmSection(notePath, 'Stats');
        if (!want.stats) {
          assert.equal(got.stats, '', notePath);
          continue;
        }
        // main's block, byte for byte, is still what `gmSection` gives; the finder gives it with the HTML comments
        // dropped (the closing `<!-- /gm-only -->` that used to trail it), the one change in the text
        assert.equal(sha(old), want.stats, notePath);
        assert.equal(sha(got.stats), sha(old.replace(/<!--[\s\S]*?-->/g, '').trim()), notePath);
        assert.equal(got.statsHeading, 'Stats', notePath);
        assert.deepEqual(got.nums, want.nums, notePath);
        assert.deepEqual(got.lacks, want.lacks, notePath);
      }
    }
    assert.equal(seen, Object.keys(MAIN).length);
  });

  it('the model carries its system\'s rules: D&D fights, CoC and GURPS not yet', () => {
    const m = readRunSheet(path.join(FIXTURES, 'run-sheet-app'), 'Chapters/Chapter 1/Sessions/Session 02/Session 02 - The Test - Plan.md');
    assert.deepEqual(m.rules, systemFor(m.system).describe());
    assert.equal(m.rules.fights, true);
    for (const [fx, plan] of [['run-sheet-coc', 'Session 01 - Fog Bound - Plan.md'], ['run-sheet-gurps', 'Session 01 - Crates - Plan.md']]) {
      const dir = copyFixture(fx);
      try {
        const at = `Chapters/Chapter 1/Sessions/Session 01/${plan}`;
        assert.equal(readRunSheet(dir, at).rules.fights, false, fx);
        withSystem(dir, 'dnd');
        assert.equal(readRunSheet(dir, at).rules.fights, true, `${fx} as dnd`);
      } finally { removeFixture(dir); }
    }
  });

  it('a fight with no rules sorts and floors as D&D', () => {
    const dnd = systemFor('dnd-5e-2024').describe().fight;
    assert.deepEqual(FM.rulesOf({}), dnd);
    assert.deepEqual(FM.rulesOf(null), dnd);
    assert.deepEqual(FM.rulesOf({ rules: { hpFloor: null } }), { hpFloor: null });
    assert.deepEqual(FM.afterDamage({ hp: 3, temp: 2 }, 10), { hp: 0, temp: 0 });
    assert.deepEqual(FM.afterDamage({ hp: 3, temp: 2 }, 10, FM.rulesOf({})), { hp: 0, temp: 0 });
    // the floor is the rules' own: none lets HP go below 0
    assert.deepEqual(FM.afterDamage({ hp: 3, temp: 2 }, 10, { ...dnd, hpFloor: null }), { hp: -5, temp: 0 });
    assert.deepEqual(FM.parseEntry('-7', FM.rulesOf({})), FM.parseEntry('-7'));
    const rows = [{ id: 'a', in: true, ini: 5 }, { id: 'b', in: true, ini: 12 }, { id: 'c', in: false, ini: 20 }, { id: 'd', in: true, ini: 12, kind: 'pc' }];
    assert.deepEqual(FM.sortRows(rows, FM.rulesOf({})).map((r) => r.id), FM.sortRows(rows).map((r) => r.id));
    assert.deepEqual(FM.sortRows(rows).map((r) => r.id), ['d', 'b', 'a', 'c']);
    // through the reducer: a fight started with no rules (as one saved before 6b) floors at 0
    let s = RS.emptyState({ stateId: 's', session: 'x', plan: 'p.md' });
    s = RS.reduce(s, { id: 'f1', type: 'fightStart', title: 'T', rows: [{ id: 'r1', kind: 'foe', name: 'Wolf', in: true, hp: 4, max: 4, conds: [] }] }, now());
    assert.equal(s.fight.rules, undefined);
    s = RS.reduce(s, { id: 'a2', type: 'hp', fight: 'f1', row: 'r1', entry: '-9' }, now());
    assert.equal(s.fight.rows[0].hp, 0);
    assert.equal(s.fight.rows[0].out, true);
  });

  it('fightStart keeps rules', () => {
    const rules = { ...systemFor('dnd-5e-2024').describe().fight, hpFloor: null };
    let s = RS.emptyState({ stateId: 's', session: 'x', plan: 'p.md' });
    s = RS.reduce(s, { id: 'f1', type: 'fightStart', title: 'T', rules, rows: [{ id: 'r1', kind: 'foe', name: 'Wolf', in: true, hp: 4, max: 4, conds: [] }] }, now());
    assert.deepEqual(s.fight.rules, rules);
    assert.notEqual(s.fight.rules, rules);
    assert.deepEqual(FM.rulesOf(s.fight), rules);
    // the handlers read the fight's own rules: no floor lets HP go below 0
    s = RS.reduce(s, { id: 'a2', type: 'hp', fight: 'f1', row: 'r1', entry: '-9' }, now());
    assert.equal(s.fight.rows[0].hp, -5);
    // rules that are not an object are not kept
    let t = RS.emptyState({ stateId: 's', session: 'x', plan: 'p.md' });
    t = RS.reduce(t, { id: 'f2', type: 'fightStart', title: 'T', rules: 'dnd', rows: [] }, now());
    assert.equal(t.fight.rules, undefined);
  });

  describe('the stat section finder (S6-D4 as widened)', () => {
    const NPCS = 'Characters/NPCs';
    const foundIn = (fx, note, crlf = false) => {
      const dir = copyFixture(fx, { crlf });
      try { return statSection(buildIndex(dir).read(`${NPCS}/${note}.md`).body); } finally { removeFixture(dir); }
    };

    it('finds each of the CoC fixture\'s five heading spellings', () => {
      for (const [note, heading, first] of [
        ['Wick Tamsin', 'Stats', '**Wick Tamsin**'],
        ['Nurse Orla Penn', 'Statistics', '**Orla Penn**'],
        ['Tobias Reed', 'Statistics \u2014 Call of Cthulhu 7th Edition', '**Tobias Reed**'],
        ['Marcus Lowe', 'Combat Stats (CoC 7e) \u2014 Before', '| STR'],
        ['Edda Voss', 'Attributes', '**Edda Voss**'],
      ]) {
        const got = foundIn('run-sheet-coc', note);
        assert.ok(got, note);
        assert.equal(got.heading, heading, note);
        assert.ok(got.md.startsWith(first), `${note}: ${got.md.slice(0, 20)}`);
        assert.ok(!got.md.includes('<!--'), `${note} drops the gm-only comment`);
      }
      assert.equal(foundIn('run-sheet-coc', 'Pell Ashby'), null);
    });

    it('a CRLF checkout gives the same sections', () => {
      for (const note of ['Wick Tamsin', 'Nurse Orla Penn', 'Tobias Reed', 'Marcus Lowe', 'Edda Voss']) {
        assert.deepEqual(foundIn('run-sheet-coc', note, true), foundIn('run-sheet-coc', note), note);
      }
    });

    it('Physical Characteristics is found: the block shows, with no numbers (the accepted false hit)', () => {
      const got = statSection('## Overview\n\nA cook.\n\n## Physical Characteristics\n\nTall, stooped, left-handed.\n\n## Notes\n\nx');
      assert.deepEqual(got, { heading: 'Physical Characteristics', md: 'Tall, stooped, left-handed.' });
    });

    it('### Stats under GM Notes beats an earlier ## Statistics; the first match is taken otherwise', () => {
      const body = '## Statistics\n\nHP 3\n\n## GM Notes\n\n### Stats\n\nHP 9\n\n### Behaviour\n\nx\n';
      assert.deepEqual(statSection(body), { heading: 'Stats', md: 'HP 9' });
      assert.equal(statSection('## Statistics\n\nHP 3\n\n## Combat Stats\n\nHP 4\n').md, 'HP 3');
      // a `### Stats` outside GM Notes is no more than a heading that holds a stats word
      assert.equal(statSection('## Overview\n\n### Stats\n\nHP 5\n\n## GM Notes\n\nx').md, 'HP 5');
    });

    it('a heading inside a code fence is not one; a section runs to the next heading of its level or higher', () => {
      assert.equal(statSection('## Notes\n\n```\n## Stats\nHP 1\n```\n\ntext\n'), null);
      assert.equal(statSection('## Notes\n\n~~~\n### Stats\n~~~\n'), null);
      const got = statSection('## Stats\n\nHP 8\n\n### Attacks\n\nBite\n\n## Next\n\nz');
      assert.equal(got.md, 'HP 8\n\n### Attacks\n\nBite');
      assert.equal(statSection('## Overview\n\nnothing\n'), null);
      assert.equal(statSection(''), null);
      assert.equal(statSection(null), null);
    });

    it('markers are ignored in the title, and case', () => {
      assert.equal(statSection('### **STAT BLOCK**\n\nHP 5').heading, 'STAT BLOCK');
      assert.equal(statSection('## Combat `Stats`\n\nHP 5').heading, 'Combat Stats');
      assert.ok(statSection('## _Stats_\n\nHP 5'));
    });

    it('currentOf reads (currently N) after the HP figure and HP n/m as current over max', () => {
      assert.equal(currentOf('**HP** 10 (currently 4) \u00b7 **MP** 6'), 4);
      assert.equal(currentOf('HP: 10 (Currently 0)'), 0);
      assert.equal(currentOf('HP 6/9 \u00b7 FP 10'), 6);
      assert.equal(currentOf('Hit Points 12 / 20'), 12);
      assert.equal(currentOf('HP 10'), null);
      assert.equal(currentOf('currently 4 elsewhere, HP 10'), null);
      assert.equal(currentOf('AC 14 (currently 3)'), null);
      assert.equal(currentOf(''), null);
      assert.equal(currentOf(null), null);
    });

    it('readFoe gives hpStart: (currently 4) on the CoC note, HP 6/9 on the GURPS one, CRLF alike', () => {
      const dnd = systemFor('dnd-5e-2024');
      for (const crlf of [false, true]) {
        const coc = copyFixture('run-sheet-coc', { crlf });
        const gurps = copyFixture('run-sheet-gurps', { crlf });
        try {
          const a = buildIndex(coc);
          const wick = `${NPCS}/Wick Tamsin.md`;
          assert.equal(dnd.readFoe({ notePath: wick, index: a, text: a.read(wick).body }).hpStart, 4, `wick crlf=${crlf}`);
          const orla = `${NPCS}/Nurse Orla Penn.md`;
          assert.equal(dnd.readFoe({ notePath: orla, index: a, text: a.read(orla).body }).hpStart, null);
          const b = buildIndex(gurps);
          const tam = `${NPCS}/Tam Osier.md`;
          assert.equal(dnd.readFoe({ notePath: tam, index: b, text: b.read(tam).body }).hpStart, 6, `tam crlf=${crlf}`);
        } finally { removeFixture(coc); removeFixture(gurps); }
      }
    });

    it('a foe row of the CoC fixture\'s Wick Tamsin carries hp 10 and hpStart 4 (the row start is in the fight-math tests)', () => {
      const dir = copyFixture('run-sheet-coc');
      try {
        const index = buildIndex(dir);
        const got = foesOf(`${NPCS}/Wick Tamsin.md`, index, 1, 'b-test').foes[0];
        assert.equal(got.hp, 10);
        assert.equal(got.hpStart, 4);
      } finally { removeFixture(dir); }
    });
  });
});
