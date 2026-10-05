const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const matter = require('gray-matter');
const { sectionsFromMarkdown } = require('../../helpers/sections');
const { parseDnd } = require('../../../lib/templates/dnd/parse');
const { liveKey, liveOf, shown } = require('../../../lib/templates/dnd/live-key');
const { buildDndLiveData, recoveryKind, conditionsOf, STANDARD_CONDITIONS } = require('../../../lib/templates/dnd/live-data');

const PCS = path.join(__dirname, '../../fixtures/with-dnd-pc/Characters/PCs');
const META = { campaignId: 'camp', pcSlug: 'pc', buildVersion: 'v' };
const model = file => parseDnd({ type: 'pc' }, sectionsFromMarkdown(matter(fs.readFileSync(path.join(PCS, file), 'utf8')).content.replace(/\r\n/g, '\n')));
const island = file => buildDndLiveData(model(file), META);
const track = (data, key) => data.tracks.find(t => t.key === key);

describe('liveKey', () => {
  it('joins kind and name, trimmed, single-spaced, lower-cased', () => {
    assert.equal(liveKey('class', '  Channel   Divinity '), 'class:channel divinity');
  });
  it('liveOf answers only for a key the model holds live', () => {
    assert.equal(liveOf({}, 'hd:hit dice'), undefined);
    assert.deepEqual(liveOf({ liveKeys: new Set(['ds:s']) }, 'ds:s', 'made'), { key: 'ds:s', fill: 'made' });
    assert.equal(liveOf({ liveKeys: new Set(['ds:s']) }, 'ds:f'), undefined);
  });
});

describe('shown', () => {
  it('reads an alias, an escaped-pipe alias, a bare link and plain text', () => {
    assert.equal(shown('[[Wand_of_Magic_Missiles|Wand of Magic Missiles]]'), 'Wand of Magic Missiles');
    assert.equal(shown('[[Wand_of_Magic_Missiles\\|Wand of Magic Missiles]]'), 'Wand of Magic Missiles');
    assert.equal(shown('[[Ilse_Varn]]'), 'Ilse Varn');
    assert.equal(shown('[[Items/Wand_of_Fire]]'), 'Wand of Fire');
    assert.equal(shown('Plain name'), 'Plain name');
  });
});

describe('recoveryKind', () => {
  it('reads the three phrases, any case and spacing', () => {
    assert.equal(recoveryKind('Long Rest'), 'long');
    assert.equal(recoveryKind(' short  rest '), 'short');
    assert.equal(recoveryKind('1 Short Rest, all Long Rest'), 'short1');
  });
  it('leaves anything else to the player', () => {
    for (const t of ['', 'Dawn', '1d6+1 at dawn', 'Long Rest or a prayer']) assert.equal(recoveryKind(t), 'none');
  });
});

describe('conditionsOf', () => {
  it('splits on commas and drops a dash or blank', () => {
    assert.deepEqual(conditionsOf('Poisoned,  Cursed by the well'), ['Poisoned', 'Cursed by the well']);
    assert.deepEqual(conditionsOf('—'), []);
    assert.deepEqual(conditionsOf(''), []);
  });
  it('there are 14 standard conditions and Exhaustion is not one', () => {
    assert.equal(STANDARD_CONDITIONS.length, 14);
    assert.ok(!STANDARD_CONDITIONS.includes('Exhaustion'));
  });
});

describe('buildDndLiveData', () => {
  it('the paladin: hit points, hit dice, slots, a one-back feature and an item left to the player', () => {
    const d = island('Brannoch_Vale.md');
    assert.equal(d.system, 'dnd');
    assert.equal(d.campaignId, 'camp');
    assert.equal(d.hpMax, 44);
    // The counts the fixture note itself gives: Hit Dice 1/5, Lay on Hands 7, Channel Divinity 1,
    // Divine Smite 0, Faithful Steed 1, 1st slots 1, 2nd slots 0, the wand 2, no death saves.
    assert.deepEqual(d.defaults, { hp: 38, temp: 0, exhaustion: 0, inspiration: true, concentrating: false, conditions: [], used: {
      'hd:hit dice': 1, 'class:lay on hands': 7, 'class:channel divinity': 1, 'class:divine smite': 0, 'class:faithful steed': 1,
      'slot:1st': 1, 'slot:2nd': 0, 'item:wand of magic missiles': 2, 'ds:s': 0, 'ds:f': 0,
    } });
    assert.deepEqual(track(d, 'hd:hit dice'), { key: 'hd:hit dice', label: 'Hit Dice', max: 5, used: 1, rest: 'long' });
    assert.equal(track(d, 'class:channel divinity').rest, 'short1');
    assert.equal(track(d, 'class:channel divinity').used, 1);
    // A linked name keys on its shown text.
    const wand = track(d, 'item:wand of magic missiles');
    assert.deepEqual([wand.max, wand.used, wand.rest], [7, 2, 'none']);
    assert.deepEqual(track(d, 'ds:s'), { key: 'ds:s', label: 'Death saves made', max: 3, used: 0, rest: 'reset', fill: 'made' });
    assert.equal(d.defaults.used['hd:hit dice'], 1);
    assert.equal(d.defaults.concentrating, false);
    assert.deepEqual(d.warnings, []);
  });
  it('the warlock: a Pact slot row comes back on a short rest', () => {
    const d = island('Oriel_Thackeray.md');
    const pact = d.tracks.find(t => t.key.startsWith('slot:pact'));
    assert.deepEqual([pact.max, pact.used, pact.rest], [2, 1, 'short']);
  });
  it('two kinds of hit dice are two tracks', () => {
    const d = island('Tamsin_Reed.md');
    assert.equal(track(d, 'hd:hit dice d10').max, 3);
    assert.equal(track(d, 'hd:hit dice d6').max, 2);
  });
  it('a count the note over-spent is not live', () => {
    // Tamsin's Action Surge is written 2 used of 1; build one shows it as written.
    assert.equal(track(island('Tamsin_Reed.md'), 'class:action surge'), undefined);
  });
  it('a feature with no Uses has no track', () => {
    assert.equal(track(island('Oriel_Thackeray.md'), 'class:pact of the chain'), undefined);
  });
  it('an old-layout note still goes live for what it can read', () => {
    const d = island('Ilse_Varn_Old_Layout.md');
    assert.ok(d);
    assert.equal(track(d, 'hd:hit dice').max, 3);
  });
  it('nothing readable: no island', () => {
    assert.equal(buildDndLiveData(parseDnd({ type: 'pc' }, sectionsFromMarkdown('## Notes\n\nNothing here.\n')), META), null);
  });
  it('two rows with one name share a count and say so', () => {
    const md = '## Class Features\n\n| Name | Action | Uses | Used | Recovers | Summary |\n|---|---|---|---|---|---|\n| Rage |  | 2 | 0 | Long Rest | a |\n| Rage |  | 3 | 1 | Long Rest | b |\n';
    const d = buildDndLiveData(parseDnd({ type: 'pc' }, sectionsFromMarkdown(md)), META);
    assert.equal(d.tracks.filter(t => t.key === 'class:rage').length, 1);
    assert.match(d.warnings[0], /Rage/);
  });
  it('a name whose first row is not live keeps the key: a later row of it is not live either', () => {
    const md = '## Class Features\n\n| Name | Action | Uses | Used | Recovers | Summary |\n|---|---|---|---|---|---|\n| Rage |  | 2 | 3 | Long Rest | a |\n| Rage |  | 3 | 1 | Long Rest | b |\n';
    const d = buildDndLiveData(parseDnd({ type: 'pc' }, sectionsFromMarkdown(md)), META);
    assert.equal(d, null);   // nothing else readable, so no live row slipped through
    const withHp = parseDnd({ type: 'pc' }, sectionsFromMarkdown(md));
    withHp.combat.hpMax = '10';
    const e = buildDndLiveData(withHp, META);
    assert.equal(track(e, 'class:rage'), undefined);
    assert.equal(e.defaults.used['class:rage'], undefined);
    assert.match(e.warnings[0], /Rage/);
  });
  it('tempLive: a whole number, a number with a reason, or blank is live; dice are not', () => {
    const tempLive = tempHp => withHpMax(tempHp).tempLive;
    function withHpMax(tempHp) {
      const m = parseDnd({ type: 'pc' }, sectionsFromMarkdown('## Notes\n\nNothing here.\n'));
      Object.assign(m.combat, { hpMax: '44' }, tempHp === undefined ? {} : { tempHp });
      return buildDndLiveData(m, META);
    }
    for (const t of [undefined, '', '  ', '0', '5', '5 (false life)']) assert.equal(tempLive(t), true, String(t));
    for (const t of ['2d4', 'lots', '5 temp']) assert.equal(tempLive(t), false, t);
  });
  it('board facts are the note\'s own words', () => {
    const d = island('Brannoch_Vale.md');
    assert.deepEqual(d.board, { who: 'Paladin 5 (Oath of Devotion)', ac: '20', pp: '14', dc: '14' });
    assert.equal(d.defaults.hp, 38);
    assert.equal(d.hpMax, 44);
  });
  it('who is the class text alone when it carries its level, with the level when it does not', () => {
    assert.equal(island('Tamsin_Reed.md').board.who, 'Fighter 3 (Champion) / Wizard 2');
    assert.equal(island('Perrin_Lowe.md').board.who, 'Bard 2');
    assert.equal(island('Ilse_Varn_Old_Layout.md').board.who, 'Level 3 Wizard (Evoker)');
  });
  it('the first Spell Save DC row is the spell DC, even with a class in brackets', () => {
    const md = '## Spellcasting\n\n| Attribute | Value |\n|---|---|\n| Spellcasting Ability | INT |\n| Spell Save DC (Wizard) | 13 |\n| Spell Save DC (Cleric) | 15 |\n';
    const m = parseDnd({ type: 'pc' }, sectionsFromMarkdown(md));
    m.combat = { hpMax: '10' };
    assert.equal(buildDndLiveData(m, META).board.dc, '13');
  });
  describe('defaults from the note', () => {
    const withCombat = combat => {
      const m = parseDnd({ type: 'pc' }, sectionsFromMarkdown('## Notes\n\nNothing here.\n'));
      Object.assign(m.combat, combat);
      return buildDndLiveData(m, META);
    };
    it('current hit points above the maximum are cut to the maximum', () => {
      const d = withCombat({ hpCur: '60', hpMax: '44' });
      assert.equal(d.defaults.hp, 44);
    });
    it('temporary hit points default to 0 and are read when given', () => {
      assert.equal(withCombat({ hpMax: '44' }).defaults.temp, 0);
      assert.equal(withCombat({ hpMax: '44', tempHp: '5' }).defaults.temp, 5);
    });
    it('exhaustion is cut to 6', () => {
      assert.equal(withCombat({ hpMax: '44', exhaustion: '9' }).defaults.exhaustion, 6);
    });
    it('conditions are read from the note', () => {
      assert.deepEqual(withCombat({ hpMax: '44', conditions: 'Poisoned, Prone' }).defaults.conditions, ['Poisoned', 'Prone']);
    });
  });
});
