const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const matter = require('gray-matter');
const { extractSections } = require('../../../lib/processor');
const { renderDnDSheet, isDndConsumedTitle } = require('../../../lib/templates/dnd/index');
const { pcTemplate } = require('../../../lib/templates/pc');

// The real template the skills hand a GM. Tests build their PC from it so the
// renderer and the template cannot drift apart again (#271).
const TEMPLATE = path.join(__dirname, '../../../../../skills/shared/templates/pc-dnd-5e-2024.md');

function templateBody() {
  // A Windows checkout has CRLF line endings; the mutations below match on \n.
  return matter(fs.readFileSync(TEMPLATE, 'utf8')).content.replace(/\r\n/g, '\n');
}

// Replace one table row, found by its first cell, with new cells.
function setRow(body, first, cells) {
  const re = new RegExp(`^\\| ${first.replace(/[()/]/g, '\\$&')} \\|.*$`, 'm');
  assert.ok(re.test(body), `template has no "${first}" row`);
  return body.replace(re, `| ${[first, ...cells].join(' | ')} |`);
}

function replace(body, from, to) {
  assert.ok(body.includes(from), `template has no "${from}"`);
  return body.replace(from, to);
}

const EMPTY_FEATURE = '| | | | | | |';
const EMPTY_SPELL = '| | | | | | | | | | |';

// A 3rd-level wizard, filled in the way a GM fills the template.
function wizardBody() {
  let b = templateBody();
  b = setRow(b, 'Level', ['3']);
  b = setRow(b, 'XP', ['900']);
  b = setRow(b, 'STR', ['8', '-1', 'No', '-1']);
  b = setRow(b, 'DEX', ['14', '+2', 'No', '+2']);
  b = setRow(b, 'INT', ['17', '+3', 'Yes', '+5']);
  b = setRow(b, 'WIS', ['12', '+1', 'Yes', '+3']);
  b = setRow(b, 'AC', ['12']);
  b = setRow(b, 'Initiative', ['+2']);
  b = setRow(b, 'Passive Perception', ['11']);
  b = setRow(b, 'HP (Current)', ['14']);
  b = setRow(b, 'HP (Max)', ['17']);
  b = setRow(b, 'Hit Dice (Spent/Max)', ['1/3']);
  b = setRow(b, 'Arcana', ['INT', 'Yes', 'Yes', '+7']);
  b = setRow(b, 'History', ['INT', 'Yes', 'No', '+5']);
  b = setRow(b, 'Spellcasting Ability', ['INT']);
  b = setRow(b, 'Spell Attack Modifier', ['+5']);
  b = setRow(b, 'Spell Save DC', ['13']);
  b = setRow(b, '1st', ['4', '1']);
  b = setRow(b, '2nd', ['2', '0']);
  b = replace(b, '**Species:** {Species name}', '**Species:** Elf');
  b = replace(b, '**Class/Subclass:** {Class (Subclass)}', '**Class/Subclass:** Wizard 3 (Evoker)');
  b = replace(b, '**Background:** {Background name}', '**Background:** Sage');
  b = replace(b, '**Languages:** {list}', '**Languages:** Common, Elvish');
  // The template's three feature tables are alike; fill the first (Class Features).
  b = replace(b, EMPTY_FEATURE, '| Arcane Recovery | | 1 | 0 | Long Rest | Regain some spent slots after a short rest. |');
  b = replace(b, EMPTY_SPELL, [
    '| Fire Bolt | Cantrip | Action | 120 ft | V, S | Instant | +5 | | | A bolt of flame. |',
    '| Magic Missile | 1 | Action | 120 ft | V, S | Instant | | | | Darts that always hit. |',
    '| Shield | 1 | Reaction | Self | V, S | 1 round | | | | A brief barrier. |',
  ].join('\n'));
  return b;
}

function render(body, fm = { type: 'pc' }) {
  return renderDnDSheet(fm, extractSections(body));
}
const everything = out => [out.sheetHtml, out.combatHtml, out.spellsHtml, out.equipmentHtml, out.vitalsHtml].filter(Boolean).join('\n');

describe('the real D&D template', () => {
  it('untouched, renders a sheet with nothing left as written', () => {
    const out = render(templateBody());
    assert.ok(out.sheetHtml);
    for (const part of [out.sheetHtml, out.combatHtml, out.equipmentHtml, out.vitalsHtml]) {
      assert.ok(!/\{[^}]*\}/.test(part || ''), 'a template placeholder reached the page');
      assert.ok(!(part || '').includes('dnd5e-as-written'), 'template content was not placed');
    }
    assert.equal(out.spellsHtml, null); // an unfilled Spellcasting section is no spellcasting
    // The optional tables and the Companions section, untouched, add no block and no warning.
    assert.ok(!/Companion|Bonuses|Carrying|Magic items|Attunement/.test(everything(out)), 'an unfilled optional table became a block');
    assert.deepEqual(out.warnings, []);
  });

  it('every Stat Sheet, Skills and Equipment label in the template is read', () => {
    // Fill each table cell with a unique token and assert each token is on the page.
    let b = templateBody();
    let n = 0;
    b = b.replace(/^(\| (?:Level|XP|AC|Speed|Size|HP \(Current\)|HP \(Max\)|Temp HP|Exhaustion|Passive [A-Za-z]+) \|)[^|]*\|$/gm,
      (whole, head) => `${head} T${++n}X |`);
    const out = render(b);
    const page = [out.sheetHtml, out.combatHtml, out.vitalsHtml].join('\n');
    for (let i = 1; i <= n; i++) assert.ok(page.includes(`T${i}X`), `token ${i} missing`);
    assert.ok(n >= 12);
  });

  it('an untouched empty row in each table is placed, not shown', () => {
    const body = templateBody();
    for (const row of [EMPTY_FEATURE, EMPTY_SPELL]) assert.ok(body.includes(row));
    const out = render(body);
    assert.ok(!everything(out).includes('dnd5e-entry'), 'an empty template row became an entry');
    // and the same rows in a note that also has real rows add nothing
    const filled = render(wizardBody());
    assert.equal((filled.sheetHtml.match(/dnd5e-entry"/g) || []).length, 1);
  });

  it('each table the template gained is read once it is filled', () => {
    let b = templateBody();
    b = replace(b, '| | | |\n\n### Defences', '| Saves | +1 | Ring of Protection |\n\n### Defences');
    b = replace(b, '**Advantages:** {list}', '**Advantages:** saves against poison');
    b = replace(b, '| | | | |\n\n### Carrying', '| Rope | 1 | 5 lb | hempen |\n\n### Carrying');
    b = setRow(b, 'Carried Weight', ['5 lb']);
    b = setRow(b, 'Encumbrance', ['Within capacity']);
    b = replace(b, '| | | | | | |\n\n### Coins', '| Wand of Magic Missiles | No | 7 | 1 | 1d6+1 at dawn | |\n\n### Coins');
    b = replace(b, '| | | | | | |\n\n## Current Status', '| Warhorse | Steed | 11 | 19 | 60 ft | |\n\n## Current Status');
    b = replace(b, EMPTY_SPELL, '| Magic Missile | 1 | Action | 120 ft | V, S | Instant | | 1 charge | Wand of Magic Missiles | Darts that always hit. |');
    const out = render(b);
    assert.ok(!everything(out).includes('dnd5e-as-written'), 'a filled template row was not placed');
    assert.match(out.sheetHtml, /dnd5e-blk-bonuses[\s\S]*Ring of Protection/);
    assert.match(out.combatHtml, /Advantages:<\/strong> saves against poison/);
    assert.match(out.combatHtml, /dnd5e-blk-companions[\s\S]*Warhorse/);
    assert.match(out.equipmentHtml, /dnd5e-tag">5 lb<[\s\S]*dnd5e-blk-carrying[\s\S]*Within capacity[\s\S]*dnd5e-blk-magic-items[\s\S]*0 of 3 attuned/);
    assert.match(out.spellsHtml, /is-source">Wand of Magic Missiles</);
    assert.ok(!everything(out).includes('Delete this section'));
  });

  it('with no Spellcasting section at all, there is no spells part', () => {
    const out = render(templateBody().replace(/## Spellcasting[\s\S]*?## Proficiencies/, '## Proficiencies'));
    assert.ok(out.sheetHtml);
    assert.equal(out.spellsHtml, null);
  });
});

describe('renderDnDSheet from the real template body', () => {
  it('shows the header: level, class/subclass, species, background', () => {
    const header = render(wizardBody()).sheetHtml.match(/<div class="dnd5e-header">[\s\S]*?<\/div>/)[0];
    assert.match(header, /Level 3/);
    assert.match(header, /Wizard 3 \(Evoker\)/);
    assert.match(header, /Elf/);
    assert.match(header, /Sage/);
  });

  it('leaves template placeholders out of the header', () => {
    const html = render(templateBody()).sheetHtml;
    assert.ok(!html.includes('{Species name}'));
    assert.ok(!html.includes('{Class (Subclass)}'));
  });

  it('shows abilities with the sheet\'s modifiers and saves', () => {
    const html = render(wizardBody()).sheetHtml;
    const int = html.match(/<div class="dnd5e-ab[ "][^>]*>\s*<span class="dnd5e-lbl">INT<\/span>[\s\S]*?<\/div>/)[0];
    assert.match(int, />17</);
    assert.match(int, />\+3</);
    assert.match(int, /Save <span class="dnd5e-num">\+5</);
    assert.match(int, /is-prof/);
  });

  it('shows a blank Modifier cell as a dash: the site computes nothing', () => {
    const html = render(setRow(wizardBody(), 'STR', ['16', '', 'No', ''])).sheetHtml;
    const str = html.match(/<span class="dnd5e-lbl">STR<\/span>[\s\S]*?<\/div>/)[0];
    assert.match(str, /dnd5e-ab-mod"><span class="dnd5e-num">—</);
    assert.ok(!str.includes('+3'));
  });

  it('shows AC, HP, Initiative, Speed and Proficiency Bonus in the vitals', () => {
    const v = render(wizardBody()).vitalsHtml;
    const tile = label => v.match(new RegExp(`<span class="dnd5e-lbl">${label}</span><span class="dnd5e-num">([^<]*)<`))[1];
    assert.strictEqual(tile('AC'), '12');
    assert.strictEqual(tile('Init'), '+2');
    assert.strictEqual(tile('Speed'), '30 ft');
    assert.strictEqual(tile('Prof'), '+2');
    assert.match(v, /<span class="dnd5e-hp-line"><span class="dnd5e-num">14<\/span> <span class="dnd5e-of">\/ 17</);
  });

  it('keeps every other Core and Combat row on the page', () => {
    const page = everything(render(wizardBody()));
    for (const label of ['XP', 'Size', 'Hit Dice', 'Saved', 'Failed']) assert.ok(page.includes(`>${label}<`), label);
    assert.match(page, /<span class="dnd5e-lbl">XP<\/span><span class="dnd5e-num">900</);
  });

  it('lists all skills and marks proficiency and expertise', () => {
    const html = render(wizardBody()).sheetHtml;
    assert.strictEqual((html.match(/class="dnd5e-skill[ "]/g) || []).length, 18);
    const item = name => html.match(new RegExp(`<li class="dnd5e-skill[^"]*">(?:(?!</li>)[\\s\\S])*${name}[\\s\\S]*?</li>`))[0];
    assert.match(item('Arcana'), /is-expert/);
    assert.match(item('Arcana'), /\+7/);
    assert.match(item('History'), /is-prof/);
    assert.ok(!item('History').includes('is-expert'));
    assert.ok(!item('Stealth').includes('is-prof'));
  });

  it('puts spellcasting, slots and spells on the spells part', () => {
    const out = render(wizardBody());
    const s = out.spellsHtml;
    assert.match(s, /<span class="dnd5e-lbl">Spellcasting Ability<\/span><span class="dnd5e-num">INT</);
    assert.match(s, /<span class="dnd5e-lbl">Spell Save DC<\/span><span class="dnd5e-num">13</);
    assert.match(s, /Spell slots, 1st: 3 of 4 left/);
    assert.match(s, /Spell slots, 2nd: 2 of 2 left/);
    assert.ok(!s.includes('3rd'), 'levels with no slots are left out');
    for (const name of ['Fire Bolt', 'Magic Missile', 'Shield']) assert.ok(s.includes(name), name);
    assert.ok(!everything(out).includes('Omit this section'));
  });

  it('shows proficiencies', () => {
    assert.ok(render(wizardBody()).sheetHtml.includes('Common, Elvish'));
  });

  it('passes an unrecognised Stat Sheet subsection through rather than dropping it', () => {
    const body = replace(wizardBody(), '## Background', '### Auras\n\nShimmering 10 ft\n\n## Background');
    assert.ok(everything(render(body)).includes('Shimmering 10 ft'));
  });

  it('passes a Skills section it cannot parse through whole', () => {
    const body = wizardBody().replace(/## Skills[\s\S]*?## Class Features/, '## Skills\n\nArcana and History, mostly.\n\n## Class Features');
    assert.ok(everything(render(body)).includes('Arcana and History, mostly.'));
  });

  it('escapes cell text', () => {
    const html = everything(render(setRow(wizardBody(), 'Speed', ['30 ft <b>fly</b> & swim'])));
    assert.ok(!html.includes('<b>fly</b>'));
    assert.ok(html.includes('&amp; swim'));
  });
});

// The contract pc.js relies on: a consumed section is on the sheet in full.
// Each case adds a marker somewhere the sheet has no structured place for.
describe('renderDnDSheet drops nothing from a consumed section', () => {
  const cases = {
    'a ### heading with inline markup': b => replace(b, '### Combat', '### **Combat**'),
    'prose under the Core table': b => replace(b, '### Ability Scores', 'MARKER core note.\n\n### Ability Scores'),
    'prose under the Ability Scores table': b => replace(b, '### Combat', 'MARKER ability note.\n\n### Combat'),
    'prose under the Combat table': b => replace(b, '### Senses', 'MARKER combat note.\n\n### Senses'),
    'prose under the Spell Slots table': b => replace(b, '### Spells', 'MARKER slots recharge.\n\n### Spells'),
    'an extra column in Core': b => replace(replace(b, '| Attribute | Value |\n|-----------|-------|\n| Level', '| Attribute | Value | Notes |\n|---|---|---|\n| Level'), '| XP | 900 |', '| XP | 900 | MARKER |'),
    'an extra column in Skills': b => replace(replace(b, '| Skill | Ability | Proficient | Expertise | Modifier |\n|-------|---------|-----------|-----------|----------|', '| Skill | Ability | Proficient | Expertise | Modifier | Notes |\n|---|---|---|---|---|---|'), '| Stealth | DEX | No | No | +0 |', '| Stealth | DEX | No | No | +0 | MARKER |'),
    'an extra column in the feature table': b => replace(replace(b, '| Name | Action | Uses | Used | Recovers | Summary |', '| Name | Action | Uses | Used | Recovers | Summary | Source |'), '| Arcane Recovery |', '| Arcane Recovery |').replace('Regain some spent slots after a short rest. |', 'Regain some spent slots after a short rest. | MARKER |'),
    'an ability row the sheet has no card for': b => replace(b, '| CHA | 10 | +0 | No | +0 |', '| CHA | 10 | +0 | No | +0 |\n| MARKER Honor | 11 | +0 | No | +0 |'),
    'a proficiency cell that is not yes or no': b => replace(b, '| Stealth | DEX | No | No | +0 |', '| Stealth | DEX | MARKER Half | No | +1 |'),
    'a spell slot row with a word for a total': b => setRow(b, '3rd', ['MARKER two', '']),
    'a spell slot row with only Expended': b => setRow(b, '4th', ['', 'MARKER']),
    'a repeated ## Skills section': b => b + '\n## Skills\n\nMARKER second skills.\n',
    'a repeated ### Combat subsection': b => replace(b, '### Senses', '### Combat\n\n| Attribute | Value |\n|---|---|\n| MARKER AC | 15 |\n\n### Senses'),
    'a loosely titled section (## Stat-Sheet)': b => replace(b, '## Stat Sheet', '## Stat-Sheet').replace('| Medium |', '| MARKER |'),
    'an author blockquote beside the template note': b => replace(b, '> Omit this section if the character has no spellcasting.', '> Omit this section if the character has no spellcasting.\n> MARKER keep me.'),
    'a skills table with other columns': b => b.replace(/\| Skill \| Ability \| Proficient \| Expertise \| Modifier \|[\s\S]*?\| Survival .*\n/, '| Skill | Ability | Proficient | Modifier |\n|---|---|---|---|\n| Stealth | DEX | Yes | MARKER +9 |\n'),
    'a second table in Skills': b => replace(b, '## Class Features', '| Tool | Mod |\n|---|---|\n| MARKER Thieves | +9 |\n\n## Class Features'),
    'a transposed ability table': b => b.replace(/\| Ability \| Score[\s\S]*?\| CHA .*\n/, '| STR | DEX | CON | INT | WIS | CHA |\n|---|---|---|---|---|---|\n| MARKER 8 | 14 | 13 | 17 | 12 | 10 |\n'),
    'a slots table with a Remaining column': b => b.replace('| Level | Total | Expended |', '| Level | Total | Remaining |').replace('| 1st | 4 | 1 |', '| 1st | 4 | MARKER 3 |'),
    'more slots expended than there are': b => setRow(b, '2nd', ['2', '5']).replace('| 2nd | 2 | 5 |', '| MARKER 2nd | 2 | 5 |'),
    'braces an author wrote in Proficiencies': b => replace(b, '**Tools:** {list}', "**Tools:** {MARKER Thieves' Tools}"),
    'an image in a Combat cell': b => setRow(b, 'Size', ['![MARKER](size.png)']),
    'a link in a Core cell': b => replace(b, '| XP | 900 |', '| XP | [900](MARKER.html) |'),
    'a label-only spellcasting row': b => replace(b, '| Spell Save DC | 13 |', '| Spell Save DC | 13 |\n| MARKER Focus | |'),
    'a label-only spell slot row': b => replace(b, '| 9th | | |', '| 9th | | |\n| MARKER Pact | | |'),
    'bold text before an author {list}': b => replace(b, '**Tools:** {list}', 'Carries **MARKER** {list} of tools.'),
    'a spellcasting value of a dash': b => setRow(b, 'Spell Save DC', ['—']).replace('Spell Save DC', 'MARKER DC'),
    'a feature row with a summary and no name': b => replace(b, EMPTY_FEATURE, '| | | | | | MARKER stray summary |'),
    'a spell row with a name and no level': b => replace(b, '| Shield | 1 |', '| MARKER Spell | | | | | | | | |\n| Shield | 1 |'),
    'a feature whose Uses is a word': b => replace(b, EMPTY_FEATURE, '| MARKER Rage | | many | | | |'),
  };
  for (const [name, mutate] of Object.entries(cases)) {
    it(`keeps ${name}`, () => {
      const out = render(mutate(wizardBody()));
      if (!name.includes('inline markup')) assert.ok(everything(out).includes('MARKER'), 'the marker must reach the sheet');
      // and the rest of the sheet still renders
      assert.match(out.vitalsHtml, /<span class="dnd5e-lbl">AC<\/span><span class="dnd5e-num">12</);
    });
  }

  it('keeps an image-only subsection', () => {
    const body = replace(wizardBody(), '## Background', '### Token\n\n![tok](token.png)\n\n## Background');
    assert.match(everything(render(body)), /<h3>Token<\/h3>[\s\S]*<img/);
  });

  it('recognises proficiency words', () => {
    const html = render(setRow(wizardBody(), 'Stealth', ['DEX', 'Proficient', 'Expert', '+6'])).sheetHtml;
    assert.match(html, /class="dnd5e-skill is-prof is-expert"(?:(?!<\/li>)[\s\S])*Stealth/);
  });

  it('drops the template placeholders that share a paragraph with real lines', () => {
    const body = replace(wizardBody(), '**Armor Training:** {list}\n\n**Weapons:** {list}\n\n**Weapon Mastery:** {list}\n\n**Tools:** {list}\n\n', '**Armor Training:** {list}\n**Weapons:** Daggers\n**Tools:** {list}\n');
    const html = everything(render(body));
    assert.ok(html.includes('Daggers'));
    assert.ok(!html.includes('{list}'));
  });

  it('reads a header value with bold in it, and Race for Species', () => {
    const body = replace(wizardBody(), '**Species:** Elf', '**Race:** Half-**Elf** & kin');
    assert.match(render(body).sheetHtml, /<span>Half-Elf &amp; kin<\/span>/);
  });

  it('shows max HP as a maximum when current is blank', () => {
    const v = render(setRow(wizardBody(), 'HP (Current)', [''])).vitalsHtml;
    assert.match(v, /<span class="dnd5e-num">—<\/span> <span class="dnd5e-of">\/ 17</);
  });

  it('does not read bold prose as a header field', () => {
    const body = replace(wizardBody(), '**Alignment:** {Alignment}', 'She hated **class** distinctions deeply.').replace('**Class/Subclass:** Wizard 3 (Evoker)', '');
    assert.ok(!everything(render(body)).includes('distinctions'));
  });

  it('reads several header fields written on one line', () => {
    const body = replace(wizardBody(), '**Species:** Elf', '**Species:** Elf (**Drow**) **Age:** 112');
    assert.match(render(body).sheetHtml, /<span>Elf \(Drow\)<\/span>/);
  });

  it('keeps an author {list} in prose and in code', () => {
    const body = replace(wizardBody(), '**Tools:** {list}', 'Keep a {list} here and `{list}` there.');
    const html = everything(render(body));
    assert.ok(html.includes('Keep a {list} here'));
    assert.ok(html.includes('<code>{list}</code>'));
  });

  it('reads abilities written with full names', () => {
    const html = render(replace(wizardBody(), '| STR | 8 |', '| Strength | 8 |')).sheetHtml;
    assert.match(html, /<span class="dnd5e-lbl">STR<\/span><span class="dnd5e-ab-mod"><span class="dnd5e-num">-1<\/span><\/span><span class="dnd5e-ab-score">8</);
  });

  it('does not double-escape a passed-through subsection title', () => {
    const body = replace(wizardBody(), '## Background', '### Rage & Fury\n\nTwice a day.\n\n## Background');
    assert.ok(everything(render(body)).includes('<h3>Rage &amp; Fury</h3>'));
  });

  it('shows a linked feature name as an entry with a link (wikilinks resolve before the renderer runs)', () => {
    const body = replace(wizardBody(), EMPTY_FEATURE, '| [Lucky](../npcs/lucky.html) | | | | | Reroll a die. |');
    assert.match(render(body).sheetHtml, /dnd5e-entry-name"><a href=/);
  });

  it('every title the page drops from its accordions is one the sheet read', () => {
    for (const t of ['Stat Sheet', 'Stat-Sheet', 'SKILLS', 'Spellcasting', 'Proficiencies', 'Class Features', 'Species Traits', 'Feats', 'Equipment']) assert.ok(isDndConsumedTitle(t), t);
    for (const t of ['Background', 'Notes', 'Current Status']) assert.ok(!isDndConsumedTitle(t), t);
  });
});

describe('pcTemplate with a D&D sheet', () => {
  const page = { frontmatter: { type: 'pc', player_name: 'X' }, displayTitle: 'Hero', outputPath: 'pcs/hero.html', title: 'Hero' };
  const noop = () => '';
  const cfg = { siteTitle: 'S', footer: '' };
  const sections = extractSections(wizardBody());
  const accordionTitles = html => [...html.matchAll(/<button class="accordion-header"[^>]*>([^<]*)</g)].map(m => m[1]);
  const ctx = (system, out) => ({
    publishConfig: { system },
    systemSheetHtml: out.sheetHtml, systemCombatHtml: out.combatHtml, systemSpellsHtml: out.spellsHtml,
    systemEquipmentHtml: out.equipmentHtml, systemVitalsHtml: out.vitalsHtml,
  });
  const build = (system, out) => pcTemplate(page, { html: '', relationships: '' }, sections, noop, cfg, {}, undefined, ctx(system, out));

  it('drops the sections the sheet consumed and keeps the prose ones', () => {
    const html = build('dnd-5e-2024', renderDnDSheet(page.frontmatter, sections));
    const titles = accordionTitles(html);
    for (const consumed of ['Stat Sheet', 'Skills', 'Spellcasting', 'Proficiencies', 'Class Features', 'Equipment']) {
      assert.ok(!titles.includes(consumed), `${consumed} must not repeat as an accordion`);
    }
    for (const kept of ['Background', 'Notes']) assert.ok(titles.includes(kept), `${kept} must stay as an accordion`);
    assert.ok(html.includes('dnd5e-tab-sheet'));
  });

  it('puts the vitals above the tab bar and gives a caster a Spells tab', () => {
    const html = build('dnd-5e-2024', renderDnDSheet(page.frontmatter, sections));
    assert.ok(html.indexOf('dnd5e-vitals') < html.indexOf('class="tab-bar"'));
    assert.ok(html.includes('data-tab="spells"') && html.includes('id="tab-spells"'));
  });

  it('keeps every section as an accordion when no sheet rendered', () => {
    const html = build('dnd-5e-2024', { sheetHtml: null });
    assert.ok(accordionTitles(html).includes('Stat Sheet'));
    assert.ok(!html.includes('data-tab="spells"'));
  });

  it('does not consume those titles for another system', () => {
    const html = build('fitd', { sheetHtml: '<div>x</div>' });
    assert.ok(accordionTitles(html).includes('Spellcasting'));
  });
});

// A page whose system supplies no Spells tab keeps exactly the inline tab list
// it had before the Spells tab existed (the built Pathfinder, FitD, GURPS, CoC
// and generic pages are byte-identical to 1.12).
describe('the inline tab list', () => {
  const { pageTabs } = require('../../../lib/templates/pc');
  it('is the pre-Spells literal when no system supplies spells', () => {
    assert.deepEqual(pageTabs(false, false), ['sheet', 'combat', 'equipment', 'story', 'journey']);
    assert.deepEqual(pageTabs(false, true), ['sheet', 'story', 'journey']);
  });
  it('gains spells, after combat, only when a system supplies it', () => {
    assert.deepEqual(pageTabs(true, false), ['sheet', 'combat', 'spells', 'equipment', 'story', 'journey']);
    assert.deepEqual(pageTabs(true, true), ['sheet', 'story', 'journey']);
  });
});
