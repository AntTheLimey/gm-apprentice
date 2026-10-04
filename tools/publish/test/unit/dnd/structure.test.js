// The structures added for what real characters carry: Bonuses, half
// proficiency, Magic Items, a spell's Source, extra speeds, Attacks per Action
// and Save DC rows, Advantages, Companions, Gear weights and Carrying.
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { sectionsFromMarkdown } = require('../../helpers/sections');
const { parseDnd } = require('../../../lib/templates/dnd/parse');
const { renderDnDSheet, isDndConsumedTitle } = require('../../../lib/templates/dnd/index');

// Wikilinks are resolved to anchors before a renderer runs; `LINK(href~text)` in a test note stands for one.
const sections = md => sectionsFromMarkdown(md).map(s => ({ ...s, html: s.html.replace(/LINK\(([^~)]*)~([^)]*)\)/g, '<a href="$1">$2</a>') }));
const parse = md => parseDnd({ type: 'pc' }, sections(md));
const render = md => renderDnDSheet({ type: 'pc' }, sections(md));
const count = (html, needle) => html.split(needle).length - 1;

const ABILITIES = `
### Ability Scores

| Ability | Score | Modifier | Save Proficiency | Save |
|---|---|---|---|---|
| STR | 10 | +0 | No | +0 |
`;
const stat = rest => `## Stat Sheet\n${ABILITIES}\n${rest}`;

describe('Bonuses', () => {
  const md = stat(`### Bonuses

| Applies To | Bonus | Source |
|---|---|---|
| Saves | +1 | Ring of Protection |
| Ability Checks, Saves | +1 | LINK(stone.html~Stone of Good Luck) |
| Initiative | PB | |
| | | |
`);
  it('are read as rows, a linked source included, and the empty row is no row', () => {
    const m = parse(md);
    assert.deepEqual(m.bonuses.map(b => [b.applies, b.bonus, b.source]), [
      ['Saves', '+1', 'Ring of Protection'], ['Ability Checks, Saves', '+1', 'Stone of Good Luck'], ['Initiative', 'PB', '']]);
    assert.match(m.bonuses[1].sourceHtml, /<a href="stone.html">/);
    assert.deepEqual(m.asWritten.statSheet, []);
  });
  it('show on the Sheet as written: source, what it applies to, the bonus', () => {
    const html = render(md).sheetHtml;
    assert.match(html, /dnd5e-blk-bonuses/);
    assert.match(html, /dnd5e-entry-name">Ring of Protection<[\s\S]*?dnd5e-tag">Saves<[\s\S]*?dnd5e-num">\+1</);
    assert.match(html, /<a href="stone.html">Stone of Good Luck<\/a>[\s\S]*?dnd5e-tag">Ability Checks<\/span><span class="dnd5e-tag">Saves</);
    // No source: the row is named by what it applies to.
    assert.match(html, /dnd5e-entry-name">Initiative<[\s\S]*?dnd5e-num">PB</);
  });
  it('a row with an extra cell is shown as written, once', () => {
    const html = render(stat('### Bonuses\n\n| Applies To | Bonus | Source | Until |\n|---|---|---|---|\n| Saves | +1 | Ring | dawn |\n')).sheetHtml;
    assert.equal(count(html, 'dawn'), 1);
    assert.match(html, /dnd5e-as-written/);
  });
  it('the site adds nothing: a save stays as the note has it', () => {
    assert.match(render(md).sheetHtml, /Save <span class="dnd5e-num">\+0</);
  });
});

describe('half proficiency', () => {
  const md = `${stat('')}\n## Skills\n\n| Skill | Ability | Proficient | Expertise | Modifier |\n|---|---|---|---|---|\n| Arcana | INT | Half | No | +1 |\n| Stealth | DEX | Yes | No | +4 |\n| History | INT | half | Yes | +9 |\n`;
  it('is its own state, not proficient and not expert', () => {
    const m = parse(md);
    assert.deepEqual(m.skills.map(s => [s.name, s.half, s.proficient, s.expert]), [['Arcana', true, false, false], ['Stealth', false, true, false]]);
    const html = render(md).sheetHtml;
    assert.match(html, /<li class="dnd5e-skill is-half"><span class="dnd5e-dot" title="Half proficiency">/);
    assert.match(html, /<li class="dnd5e-skill is-prof">/);
  });
  it('Half with Expertise is not a state the sheet has: the row is shown as written', () => {
    const html = render(md).sheetHtml;
    assert.match(html, /dnd5e-as-written[\s\S]*<td>History<\/td>/);
    assert.equal(count(html, 'History'), 1);
  });
});

describe('Magic Items', () => {
  const md = `${stat('')}\n## Equipment\n\n### Magic Items\n
| Item | Attuned | Charges | Used | Recovers | Notes |
|---|---|---|---|---|---|
| LINK(wand.html~Wand of Magic Missiles) | No | 7 | 2 | 1d6+1 at dawn | Spend charges to cast. |
| Ring of Protection | Yes | | | | +1 AC and saves |
| Staff of Healing | Yes | 20 | 13 | 2d4+2 at dawn | |
| Rope of Climbing | | | | | |
| Odd Thing | maybe | | | | |
| | | | | | |
`;
  it('are read: attuned, charges, a linked name; a cell it cannot read leaves the row as written', () => {
    const m = parse(md);
    assert.deepEqual(m.magicItems.map(i => [i.name, i.attuned, i.charges, i.used, i.recovers]), [
      ['Wand of Magic Missiles', false, 7, 2, '1d6+1 at dawn'], ['Ring of Protection', true, null, null, ''],
      ['Staff of Healing', true, 20, 13, '2d4+2 at dawn'], ['Rope of Climbing', false, null, null, '']]);
    assert.equal(m.asWritten.equipment.length, 1);
    assert.match(m.asWritten.equipment[0], /Odd Thing/);
  });
  it('show on Equipment: the attuned count against three, charges as marks or a count, recovery and notes', () => {
    const html = render(md).equipmentHtml;
    assert.match(html, /<h3>Magic items <span class="dnd5e-cap">2 of 3 attuned<\/span><\/h3>/);
    assert.match(html, /dnd5e-entry-name"><a href="wand.html">Wand of Magic Missiles<\/a>/);
    assert.match(html, /aria-label="Wand of Magic Missiles: 5 of 7 left"/);
    assert.equal(count(html.split('Wand of Magic Missiles: 5 of 7 left')[1].split('</span></span>')[0], 'dnd5e-mark is-spent'), 2);
    assert.match(html, /dnd5e-recovers">1d6\+1 at dawn</);
    assert.match(html, /Ring of Protection<\/span><span class="dnd5e-tags"><span class="dnd5e-tag">Attuned</);
    assert.match(html, /<span class="dnd5e-num">7<\/span> \/ 20/);
    assert.match(html, /\+1 AC and saves/);
    assert.equal(count(html, 'Odd Thing'), 1);
    assert.ok(!/<button|<script/.test(html));
  });
  it('the old Magic Item Attunement table is still read and shown as before', () => {
    const html = render(`${stat('')}\n## Equipment\n\n### Magic Item Attunement\n\n| Slot | Item |\n|---|---|\n| 1 | Cloak of Protection |\n| 2 | — |\n`).equipmentHtml;
    assert.match(html, /<h3>Attunement <span class="dnd5e-cap">1 of 2 used<\/span><\/h3>/);
    assert.match(html, /<strong>1:<\/strong> Cloak of Protection/);
  });
  it('the template\'s empty row alone gives no block', () => {
    const out = render(`${stat('')}\n## Equipment\n\n### Magic Items\n\n| Item | Attuned | Charges | Used | Recovers | Notes |\n|---|---|---|---|---|---|\n| | | | | | |\n`);
    assert.equal(out.equipmentHtml, null);
  });
});

describe('a spell\'s Source', () => {
  const head = cols => `${stat('')}\n## Spellcasting\n\n### Spells\n\n| ${cols.join(' | ')} |\n|${cols.map(() => '---').join('|')}|\n`;
  const TEN = ['Spell', 'Level', 'Time', 'Range', 'Components', 'Duration', 'Hit / DC', 'Tags', 'Source', 'Summary'];
  const NINE = TEN.filter(c => c !== 'Source');
  it('is read from the ten-column table and shown as a tag', () => {
    const md = head(TEN) + '| Fireball | 3 | Action | 150 ft | V, S | Instant | DC 17 Dex | 3 charges | Staff of Fire | A burst of flame. |\n| Bless | 1 | Action | 30 ft | V, S, M | 1 min | | C | | A blessing. |\n';
    const m = parse(md);
    assert.deepEqual(m.spells.map(s => [s.name, s.source, s.summaryHtml]), [['Fireball', 'Staff of Fire', 'A burst of flame.'], ['Bless', '', 'A blessing.']]);
    const html = render(md).spellsHtml;
    assert.match(html, /<span class="dnd5e-tag is-source">Staff of Fire<\/span>/);
    assert.equal(count(html, 'is-source'), 1);
    assert.match(html, /dnd5e-tag">3 charges</);
  });
  it('the nine-column table without Source is still read', () => {
    const m = parse(head(NINE) + '| Bless | 1 | Action | 30 ft | V, S, M | 1 min | | C | A blessing. |\n');
    assert.deepEqual(m.spells.map(s => [s.name, s.source, s.summaryHtml]), [['Bless', '', 'A blessing.']]);
    assert.deepEqual(m.asWritten.spellcasting, []);
  });
});

describe('Combat rows', () => {
  const md = stat(`### Combat

| Attribute | Value |
|---|---|
| AC | 17 |
| Speed | 30 ft |
| Fly Speed | 60 ft |
| Swim Speed | 30 ft |
| Climb Speed | 20 ft |
| Burrow Speed | 5 ft |
| Attacks per Action | 2 |
| Maneuver Save DC | 15 |
| Breath Weapon Save DC | 14 |
| Lucky Coin | heads |
`);
  it('extra speeds join the Speed tile in the pinned strip', () => {
    const html = render(md).vitalsHtml;
    assert.match(html, /Speed<\/span><span class="dnd5e-num">30 ft<\/span><span class="dnd5e-sub">fly 60 ft<\/span><span class="dnd5e-sub">swim 30 ft<\/span><span class="dnd5e-sub">climb 20 ft<\/span><span class="dnd5e-sub">burrow 5 ft<\/span>/);
  });
  it('a fly speed with no Speed row still shows', () => {
    const html = render(stat('### Combat\n\n| Attribute | Value |\n|---|---|\n| Fly Speed | 60 ft |\n')).vitalsHtml;
    assert.match(html, /Speed<\/span><span class="dnd5e-sub">fly 60 ft</);
  });
  it('Attacks per Action and each Save DC are tiles at the top of the Combat tab; other rows stay tiles below', () => {
    const out = render(md + '\n## Equipment\n\n### Weapons & Damage Cantrips\n\n| Name | Atk Bonus / DC | Damage & Type | Notes |\n|---|---|---|---|\n| Longsword | +7 | 1d8+4 slashing | |\n');
    const html = out.combatHtml;
    const attacks = html.split('dnd5e-blk-attacks')[1].split('</section>')[0];
    assert.match(attacks, /Attacks per Action<\/span><span class="dnd5e-num">2</);
    assert.match(attacks, /Maneuver Save DC<\/span><span class="dnd5e-num">15</);
    assert.match(attacks, /Breath Weapon Save DC<\/span><span class="dnd5e-num">14</);
    assert.ok(attacks.indexOf('Attacks per Action') < attacks.indexOf('Longsword'));
    assert.match(html.split('dnd5e-blk-tracks')[1], /Lucky Coin<\/span><span class="dnd5e-num">heads</);
    for (const s of ['Attacks per Action', 'Maneuver Save DC', 'Lucky Coin', '60 ft']) assert.equal(count(everything(out), s), 1, s);
  });
  it('with no attack rows the tiles still show', () => {
    assert.match(render(md).combatHtml, /dnd5e-blk-attacks[\s\S]*Attacks per Action/);
  });
  it('a second Fly Speed row is shown as written, not dropped', () => {
    const out = render(stat('### Combat\n\n| Attribute | Value |\n|---|---|\n| Fly Speed | 60 ft |\n| Fly Speed | 90 ft (hasted) |\n'));
    assert.match(out.sheetHtml, /90 ft \(hasted\)/);
  });
});
const everything = out => [out.sheetHtml, out.combatHtml, out.spellsHtml, out.equipmentHtml, out.vitalsHtml].filter(Boolean).join('\n');

describe('Defences', () => {
  it('reads Advantages', () => {
    const out = render(stat('### Defences\n\n**Resistances:** fire\n\n**Advantages:** saves against poison\n'));
    assert.match(out.combatHtml, /<strong>Advantages:<\/strong> saves against poison/);
    assert.ok(!out.sheetHtml.includes('poison'));
  });
  it('a line holding a dash or nothing is not shown', () => {
    const out = render(stat('### Defences\n\n**Resistances:** —\n\n**Immunities:** -\n\n**Vulnerabilities:**\n\n**Condition Immunities:** {list}\n\n**Advantages:** –\n\n**Armour Class:** leather 11\n'));
    const page = everything(out);
    for (const s of ['Resistances', 'Immunities', 'Vulnerabilities', 'Advantages']) assert.ok(!page.includes(s), s);
    assert.match(out.combatHtml, /<strong>Armour Class:<\/strong> leather 11/);
    assert.ok(!page.includes('dnd5e-as-written'));
  });
  it('only dashes: no Defences block at all', () => {
    const out = render(stat('### Defences\n\n**Resistances:** —\n'));
    assert.ok(!everything(out).includes('Defences'));
  });
  it('a line of the author\'s own is still shown as written', () => {
    const out = render(stat('### Defences\n\n**Resistances:** —\n\n**Wards:** a circle of salt\n'));
    assert.equal(count(everything(out), 'a circle of salt'), 1);
  });
});

describe('Companions', () => {
  const md = `${stat('')}\n## Companions\n\n> Delete this section if the character has no companion.\n
| Companion | Kind | AC | HP | Speed | Notes |
|---|---|---|---|---|---|
| LINK(warhorse.html~Warhorse) | Steed | 11 | 19 | 60 ft | Carries the pack. |
| Owl | Familiar | 11 | 1 | 5 ft, fly 60 ft | |
| | | | | | |

She keeps a kennel too.
`;
  it('is a consumed title', () => assert.ok(isDndConsumedTitle('Companions')));
  it('is read: name (a link works), kind, AC, HP, speed, notes', () => {
    const m = parse(md);
    assert.deepEqual(m.companions.map(c => [c.name, c.kind, c.ac, c.hp, c.speed]), [['Warhorse', 'Steed', '11', '19', '60 ft'], ['Owl', 'Familiar', '11', '1', '5 ft, fly 60 ft']]);
  });
  it('is a block of entries at the end of the Combat tab; prose under the table is kept; the template note is not shown', () => {
    const html = render(md).combatHtml;
    assert.ok(html.trim().endsWith('</section></div>'));
    const blk = html.split('dnd5e-blk-companions')[1];
    assert.ok(blk && !html.split('dnd5e-blk-companions')[2]);
    assert.match(blk, /dnd5e-entry-name"><a href="warhorse.html">Warhorse<\/a><\/span><span class="dnd5e-tags"><span class="dnd5e-tag">Steed</);
    assert.match(blk, /AC<\/span> <span class="dnd5e-num">11<\/span>[\s\S]*?HP<\/span> <span class="dnd5e-num">19<\/span>[\s\S]*?Speed<\/span> <span class="dnd5e-num">60 ft</);
    assert.match(blk, /Carries the pack\./);
    assert.match(blk, /She keeps a kennel too\./);
    assert.ok(!html.includes('Delete this section'));
  });
  it('the template\'s untouched section gives no block and no warning', () => {
    const out = render(`${stat('')}\n## Companions\n\n> Delete this section if the character has no companion.\n\n| Companion | Kind | AC | HP | Speed | Notes |\n|---|---|---|---|---|---|\n| | | | | | |\n`);
    assert.ok(!everything(out).includes('ompanion'));
    assert.deepEqual(out.warnings, []);
  });
  it('a note without the section shows nothing', () => {
    assert.ok(!everything(render(stat(''))).includes('ompanion'));
  });
  it('a table of another shape is shown as written', () => {
    const html = render(`${stat('')}\n## Companions\n\n| Name | Breed |\n|---|---|\n| Biscuit | mastiff |\n`).combatHtml;
    assert.match(html, /dnd5e-blk-companions[\s\S]*dnd5e-as-written[\s\S]*Biscuit/);
  });
});

describe('Gear weight and Carrying', () => {
  const md = `${stat('')}\n## Equipment\n\n### Gear\n
| Item | Qty | Weight | Notes |
|---|---|---|---|
| Chain Mail | 1 | 55 lb | worn |
| Javelin | 4 | 2 | |
| Holy Symbol | 1 | — | |

### Carrying

| Attribute | Value |
|---|---|
| Carried Weight | 412 lb |
| Carrying Capacity | 300 lb (Powerful Build) |
| Drag / Lift / Push | |
| Encumbrance | Over capacity (Speed 5 ft) |
`;
  it('the weight of one is on the entry as written; a bare number gets its unit; a dash is no tag', () => {
    const m = parse(md);
    assert.deepEqual(m.gear.map(g => [g.name, g.qty, g.weight]), [['Chain Mail', '1', '55 lb'], ['Javelin', '4', '2'], ['Holy Symbol', '1', '']]);
    const html = render(md).equipmentHtml;
    assert.match(html, /Chain Mail<\/span><span class="dnd5e-tags"><span class="dnd5e-tag">55 lb</);
    assert.match(html, /Javelin<\/span><span class="dnd5e-tags"><span class="dnd5e-tag">× 4<\/span><span class="dnd5e-tag">2 lb each</);
    assert.match(html, /Holy Symbol<\/span><\/div>/);
  });
  it('the three-column Gear table is still read', () => {
    const m = parse(`${stat('')}\n## Equipment\n\n### Gear\n\n| Item | Qty | Notes |\n|---|---|---|\n| Rope | 1 | hempen |\n`);
    assert.deepEqual(m.gear.map(g => [g.name, g.qty, g.weight, g.notesHtml]), [['Rope', '1', '', 'hempen']]);
    assert.deepEqual(m.asWritten.equipment, []);
  });
  it('Carrying is tiles on Equipment, as written; an unfilled value is no tile; nothing is added up', () => {
    const html = render(md).equipmentHtml;
    const blk = html.split('dnd5e-blk-carrying')[1].split('</section>')[0];
    assert.match(blk, /Carried Weight<\/span><span class="dnd5e-num">412 lb</);
    assert.match(blk, /Carrying Capacity<\/span><span class="dnd5e-num" title="Powerful Build">300 lb<\/span><span class="dnd5e-why">Powerful Build</);
    assert.match(blk, /Encumbrance<\/span><span class="dnd5e-num" title="Speed 5 ft">Over capacity<\/span><span class="dnd5e-why">Speed 5 ft</);
    assert.ok(!blk.includes('Drag'));
  });
  it('the untouched Carrying table gives no block', () => {
    const out = render(`${stat('')}\n## Equipment\n\n### Carrying\n\n| Attribute | Value |\n|---|---|\n| Carried Weight | |\n| Carrying Capacity | |\n| Drag / Lift / Push | |\n| Encumbrance | |\n`);
    assert.equal(out.equipmentHtml, null);
  });
});

describe('the Hit label', () => {
  const attacks = rows => render(`${stat('')}\n## Equipment\n\n### Weapons & Damage Cantrips\n\n| Name | Atk Bonus / DC | Damage & Type | Notes |\n|---|---|---|---|\n${rows}`).combatHtml;
  it('is shown for a signed number', () => {
    assert.match(attacks('| Longsword | +7 | 1d8+4 slashing | |\n'), /dnd5e-lbl">Hit<\/span> <span class="dnd5e-num">\+7</);
    assert.match(attacks('| Sling | -1 | 1d4 | |\n'), /dnd5e-lbl">Hit<\/span> <span class="dnd5e-num">-1</);
  });
  it('is not shown for a save DC: the cell says what it is', () => {
    const html = attacks('| Vicious Mockery | DC 13 Wis | 1d6 psychic | |\n');
    assert.ok(!html.includes('>Hit<'));
    assert.match(html, /<span class="dnd5e-num">DC 13 Wis</);
  });
  it('on a spell: Hit for a signed number, nothing for a DC', () => {
    const spells = row => render(`${stat('')}\n## Spellcasting\n\n### Spells\n\n| Spell | Level | Time | Range | Components | Duration | Hit / DC | Tags | Summary |\n|---|---|---|---|---|---|---|---|---|\n${row}`).spellsHtml;
    assert.match(spells('| Fire Bolt | Cantrip | Action | 120 ft | V, S | Instant | +5 | | Flame. |\n'), /dnd5e-lbl">Hit<\/span> <span class="dnd5e-num">\+5</);
    const dc = spells('| Sacred Flame | Cantrip | Action | 60 ft | V, S | Instant | DC 13 | | Radiance. |\n');
    assert.ok(!dc.includes('dnd5e-lbl'));
    assert.match(dc, /<span class="dnd5e-num">DC 13</);
  });
});

describe('the pinned strip says only what it has to', () => {
  const vit = rows => render(stat(`### Combat\n\n| Attribute | Value |\n|---|---|\n| AC | 15 |\n${rows}`)).vitalsHtml;
  it('nothing to say: the chips row is marked quiet', () => {
    assert.match(vit('| Exhaustion | 0 |\n| Conditions | — |\n'), /<div class="dnd5e-chips is-quiet"><span class="dnd5e-chip is-quiet">No conditions<\/span><span class="dnd5e-chip is-quiet">Exhaustion 0<\/span><\/div>/);
  });
  it('a condition, exhaustion above 0 or inspiration is not quiet', () => {
    assert.match(vit('| Conditions | Prone |\n'), /<div class="dnd5e-chips"><span class="dnd5e-chip">Prone</);
    assert.match(vit('| Exhaustion | 2 |\n'), /<div class="dnd5e-chips"><span class="dnd5e-chip is-quiet">No conditions<\/span><span class="dnd5e-chip">Exhaustion 2</);
    const lit = render(`## Stat Sheet\n\n### Core\n\n| Attribute | Value |\n|---|---|\n| Heroic Inspiration | Yes |\n${ABILITIES}`).vitalsHtml;
    assert.match(lit, /<div class="dnd5e-chips"><span class="dnd5e-chip is-on">Heroic Inspiration</);
  });
});
