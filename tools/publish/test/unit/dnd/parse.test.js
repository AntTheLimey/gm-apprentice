const { describe, it } = require('node:test');
const assert = require('node:assert');
const { sectionsFromMarkdown } = require('../../helpers/sections');
const { parseDnd, splitReason } = require('../../../lib/templates/dnd/parse');
const { consumeTable } = require('../../../lib/templates/sheet-parse');

const parse = md => parseDnd({ type: 'pc' }, sectionsFromMarkdown(md));

const STAT = `
## Stat Sheet

### Core

| Attribute | Value |
|---|---|
| Level | 5 |
| XP | 6500 |
| Proficiency Bonus | +3 |
| Heroic Inspiration | Yes |

### Ability Scores

| Ability | Score | Modifier | Save Proficiency | Save |
|---|---|---|---|---|
| STR | 18 | +4 | No | +4 |
| DEX | 10 | +0 | No | +0 |
| CON | 14 | +2 | No | +2 |
| INT | 8 | -1 | No | -1 |
| WIS | 12 | +1 | Yes | +4 |
| CHA | 16 | +3 | Yes | +6 |

### Combat

| Attribute | Value |
|---|---|
| AC | 19 |
| Initiative | +3 (Alert) |
| Speed | 30 ft |
| HP (Current) | 38 |
| HP (Max) | 44 |
| Temp HP | 0 |
| Hit Dice (Spent/Max) | 1/5 |
| Death Saves (S/F) | 0/0 |
| Exhaustion | 0 |
| Conditions | — |
| Lucky Coin | heads |

### Senses

| Attribute | Value |
|---|---|
| Passive Perception | 14 |
| Darkvision | 60 ft |

### Defences

**Resistances:** fire

**Armour Class:** chain mail 16, shield +2
`;

describe('parseDnd: Stat Sheet', () => {
  const m = parse(STAT);
  it('reads the header and core', () => {
    assert.equal(m.header.level, '5');
    assert.equal(m.pb, '+3');
    assert.equal(m.inspiration, 'Yes');
    assert.deepEqual(m.core, [['XP', '6500']]);
  });
  it('reads abilities with saves', () => {
    assert.deepEqual(m.abilities.WIS, { score: '12', mod: '+1', saveProf: true, save: '+4' });
    assert.equal(Object.keys(m.abilities).length, 6);
  });
  it('reads combat rows and keeps the unknown one', () => {
    assert.equal(m.combat.ac, '19');
    assert.equal(m.combat.initiative, '+3 (Alert)');
    assert.equal(m.combat.hpCur, '38');
    assert.equal(m.combat.hpMax, '44');
    assert.equal(m.combat.conditions, '');
    assert.deepEqual(m.combat.hitDice, [{ label: 'Hit Dice', spent: 1, max: 5 }]);
    assert.deepEqual(m.combat.deathSaves, { s: 0, f: 0 });
    assert.deepEqual(m.combat.other, [['Lucky Coin', 'heads']]);
  });
  it('reads senses and defences', () => {
    assert.deepEqual(m.senses, [['Passive Perception', '14'], ['Darkvision', '60 ft']]);
    assert.deepEqual(m.defences, [['Resistances', 'fire'], ['Armour Class', 'chain mail 16, shield +2']]);
  });
  it('leaves nothing as written', () => assert.deepEqual(m.asWritten.statSheet, []));
});

describe('parseDnd: old layout', () => {
  const old = STAT
    .replace('| Ability | Score | Modifier | Save Proficiency | Save |\n|---|---|---|---|---|', '| Ability | Score | Modifier | Save Proficiency |\n|---|---|---|---|')
    .replace(/^(\| (?:STR|DEX|CON|INT|WIS|CHA) \|.*?) \| [+-]\d \|$/gm, '$1 |')
    .replace('| Lucky Coin | heads |', '| Passive Perception | 13 |')
    .replace(/### Senses[\s\S]*?### Defences/, '### Defences');
  const m = parse(old);
  it('reads four-column abilities with no save number', () => {
    assert.deepEqual(m.abilities.WIS, { score: '12', mod: '+1', saveProf: true, save: '' });
  });
  it('moves Passive Perception from Combat to senses', () => {
    assert.deepEqual(m.senses, [['Passive Perception', '13']]);
    assert.deepEqual(m.combat.other, []);
  });
});

describe('parseDnd: features', () => {
  const m = parse(`
## Class Features

| Name | Action | Uses | Used | Recovers | Summary |
|---|---|---|---|---|---|
| Lay on Hands | Bonus Action | 25 | 7 | Long Rest | Heal from a pool. |
| Channel Divinity | | 2 | 1 | 1 Short Rest, all Long Rest | Powers two options. |
| [[Extra Attack]] | | | | | Attack twice. |
| Odd | | lots | | | Not a number. |

Some loose prose.

## Feats

{Selected feats with descriptions.}
`);
  it('reads rows, links included', () => {
    assert.equal(m.features.class.length, 3);
    assert.deepEqual(
      { ...m.features.class[0], nameHtml: undefined, summaryHtml: undefined },
      { name: 'Lay on Hands', nameHtml: undefined, action: 'Bonus Action', uses: 25, used: 7, recovers: 'Long Rest', summaryHtml: undefined });
    assert.equal(m.features.class[1].action, '');
    assert.equal(m.features.class[2].uses, null);
    assert.match(m.features.class[2].nameHtml, /Extra Attack/);
  });
  it('shows the unreadable row and the prose as written', () => {
    const left = m.asWritten.classFeatures.join('\n');
    assert.match(left, /<td>Odd<\/td>/);
    assert.match(left, /Some loose prose\./);
  });
  it('drops the template placeholder', () => {
    assert.deepEqual(m.features.feats, []);
    assert.deepEqual(m.asWritten.feats, []);
  });
});

describe('parseDnd: spellcasting', () => {
  const m = parse(`
## Spellcasting

| Attribute | Value |
|---|---|
| Spellcasting Ability | CHA |
| Spell Attack Modifier | +6 |
| Spell Save DC | 14 |

### Spell Slots

| Level | Total | Expended |
|---|---|---|
| 1st | 4 | 1 |
| 2nd | 2 | 0 |
| 3rd | | |
| Pact (3rd) | 2 | 1 |

### Spells

| Spell | Level | Time | Range | Components | Duration | Hit / DC | Tags | Summary |
|---|---|---|---|---|---|---|---|---|
| Bless | 1 | Action | 30 ft | V, S, M | 1 min | | C | Three creatures add 1d4. |
| Light | Cantrip | Action | Touch | V, M | 1 hour | | | An object glows. |

### Prepared Spells

**Cantrips:** Guidance
`);
  it('reads stats, slots and spells', () => {
    assert.equal(m.casting.length, 3);
    assert.deepEqual(m.slots, [
      { level: '1st', total: 4, expended: 1 }, { level: '2nd', total: 2, expended: 0 },
      { level: 'Pact (3rd)', total: 2, expended: 1 }]);
    assert.deepEqual(m.spells.map(s => [s.name, s.level, s.tags]), [['Bless', '1', ['C']], ['Light', '0', []]]);
    assert.equal(m.hasSpellcasting, true);
  });
  it('keeps an old Prepared Spells list as written', () => {
    assert.match(m.asWritten.spellcasting.join(''), /<h4>Prepared Spells<\/h4>[\s\S]*Guidance/);
  });
  it('an untouched template section is no spellcasting', () => {
    const empty = parse(`
## Spellcasting

> Omit this section if the character has no spellcasting.

| Attribute | Value |
|---|---|
| Spellcasting Ability | |
| Spell Attack Modifier | |
| Spell Save DC | |

### Spell Slots

| Level | Total | Expended |
|---|---|---|
| 1st | | |
`);
    assert.equal(empty.hasSpellcasting, false);
  });
});

describe('parseDnd: equipment', () => {
  const m = parse(`
## Equipment

### Weapons & Damage Cantrips

| Name | Atk Bonus / DC | Damage & Type | Notes |
|---|---|---|---|
| Longsword | +7 | 1d8+4 Slashing | Versatile, Sap |

### Gear

| Item | Qty | Notes |
|---|---|---|
| [[Amulet of Health]] | 1 | Attuned |
| Javelin | 4 | |

### Magic Item Attunement

| Slot | Item |
|---|---|
| 1 | Amulet of Health |
| 2 | — |

### Coins

| CP | SP | EP | GP | PP |
|---|---|---|---|---|
| 0 | 14 | 0 | 62 | 1 |
`);
  it('reads attacks, gear with links, attunement and coins', () => {
    assert.deepEqual(m.attacks.map(a => [a.name, a.hit, a.damage]), [['Longsword', '+7', '1d8+4 Slashing']]);
    assert.equal(m.gear.length, 2);
    assert.match(m.gear[0].nameHtml, /Amulet of Health/);
    assert.deepEqual(m.attunement, [['1', 'Amulet of Health'], ['2', '']]);
    assert.deepEqual(m.coins, [['CP', '0'], ['SP', '14'], ['EP', '0'], ['GP', '62'], ['PP', '1']]);
    assert.deepEqual(m.asWritten.equipment, []);
  });
  it('keeps a prose gear list as written', () => {
    const p = parse('## Equipment\n\n### Gear\n\nSpellbook, ink and quill.\n');
    assert.deepEqual(p.gear, []);
    assert.match(p.asWritten.equipment.join(''), /<h3>Gear<\/h3>[\s\S]*Spellbook/);
  });
});

describe('splitReason', () => {
  it('splits a value from its reason', () => {
    assert.deepEqual(splitReason('+7 (cloak of elvenkind)'), { value: '+7', reason: 'cloak of elvenkind' });
    assert.deepEqual(splitReason('30 ft'), { value: '30 ft', reason: '' });
    assert.deepEqual(splitReason(''), { value: '', reason: '' });
  });
});

describe('consumeTable rich option', () => {
  const html = '<table><thead><tr><th>Item</th><th>Qty</th></tr></thead><tbody><tr><td><a href="x.html">Rope</a></td><td>1</td></tr></tbody></table>';
  it('does not offer a linked row by default', () => {
    const seen = [];
    const left = consumeTable(html, [/^item$/i, /^qty$/i], c => { seen.push(c); return true; });
    assert.deepEqual(seen, []);
    assert.match(left, /Rope/);
  });
  it('offers it with rich, with the cell HTML', () => {
    const seen = [];
    const left = consumeTable(html, [/^item$/i, /^qty$/i], (c, h) => { seen.push([c, h]); return true; }, { rich: true });
    assert.deepEqual(seen, [[['Rope', '1'], ['<a href="x.html">Rope</a>', '1']]]);
    assert.equal(left, '');
  });
});
