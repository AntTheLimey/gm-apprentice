const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const matter = require('gray-matter');
const { extractSections } = require('../../lib/processor');
const { renderDnDSheet } = require('../../lib/templates/pc-dnd');
const { pcTemplate } = require('../../lib/templates/pc');

// The real template the skills hand a GM. Tests build their PC from it so the
// renderer and the template cannot drift apart again (#271).
const TEMPLATE = path.join(__dirname, '../../../../skills/shared/templates/pc-dnd-5e-2024.md');

function templateBody() {
  return matter(fs.readFileSync(TEMPLATE, 'utf8')).content;
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

// A 3rd-level wizard, filled in the way a GM fills the template.
function wizardBody() {
  let b = templateBody();
  b = setRow(b, 'Level', ['3']);
  b = setRow(b, 'XP', ['900']);
  b = setRow(b, 'STR', ['8', '-1', 'No']);
  b = setRow(b, 'DEX', ['14', '+2', 'No']);
  b = setRow(b, 'INT', ['17', '+3', 'Yes']);
  b = setRow(b, 'WIS', ['12', '+1', 'Yes']);
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
  b = replace(b, '**Class/Subclass:** {Class (Subclass)}', '**Class/Subclass:** Wizard (Evoker)');
  b = replace(b, '**Background:** {Background name}', '**Background:** Sage');
  b = replace(b, '**Cantrips:** {list}', '**Cantrips:** Fire Bolt, Light');
  b = replace(b, '**1st Level:** {list}', '**1st Level:** Magic Missile, Shield');
  b = replace(b, '**Languages:** {list}', '**Languages:** Common, Elvish');
  b = replace(b, '{Selected class features by level.}', 'Arcane Recovery.');
  return b;
}

function render(body, fm = { type: 'pc' }) {
  return renderDnDSheet(fm, extractSections(body));
}

describe('renderDnDSheet from the real template body', () => {
  it('renders a sheet for the untouched template', () => {
    const html = render(templateBody());
    assert.ok(html, 'the blank template must still produce a sheet');
    assert.ok(html.includes('dnd-ability-scores'));
  });

  it('shows the header: level, class/subclass, species, background', () => {
    const html = render(wizardBody());
    const header = html.match(/<div class="dnd-header">[\s\S]*?<\/div>/)[0];
    assert.match(header, /Level 3/);
    assert.match(header, /Wizard \(Evoker\)/);
    assert.match(header, /Elf/);
    assert.match(header, /Sage/);
  });

  it('leaves template placeholders out of the header', () => {
    const html = render(templateBody());
    assert.ok(!html.includes('{Species name}'));
    assert.ok(!html.includes('{Class (Subclass)}'));
  });

  it('shows abilities with the sheet\'s modifiers and save proficiency', () => {
    const html = render(wizardBody());
    const int = html.match(/<div class="dnd-ability-card[^"]*">\s*<span class="ability-name">INT<\/span>[\s\S]*?<\/div>/)[0];
    assert.match(int, />17</);
    assert.match(int, />\+3</);
    assert.match(int, /ability-save/);
    const str = html.match(/<div class="dnd-ability-card[^"]*">\s*<span class="ability-name">STR<\/span>[\s\S]*?<\/div>/)[0];
    assert.match(str, />-1</);
    assert.ok(!str.includes('ability-save'));
  });

  it('shows AC, HP, Initiative, Speed and Passive Perception', () => {
    const html = render(wizardBody());
    const stat = label => html.match(new RegExp(`<span class="stat-label">${label}</span><span class="stat-value">([^<]*)<`))[1];
    assert.strictEqual(stat('AC'), '12');
    assert.strictEqual(stat('HP'), '14 / 17');
    assert.strictEqual(stat('Initiative'), '+2');
    assert.strictEqual(stat('Speed'), '30 ft');
    assert.strictEqual(stat('Passive Perception'), '11');
  });

  it('keeps every other Core and Combat row', () => {
    const html = render(wizardBody());
    for (const label of ['XP', 'Proficiency Bonus', 'Heroic Inspiration', 'Size', 'Hit Dice \\(Spent/Max\\)', 'Death Saves \\(S/F\\)']) {
      assert.match(html, new RegExp(`<span class="stat-label">${label}</span>`), label);
    }
    assert.match(html, /<span class="stat-label">XP<\/span><span class="stat-value">900</);
  });

  it('lists all skills and marks proficiency and expertise', () => {
    const html = render(wizardBody());
    assert.strictEqual((html.match(/class="dnd-skill[ "]/g) || []).length, 18);
    const arcana = html.match(/<li class="dnd-skill[^"]*">(?:(?!<\/li>)[\s\S])*Arcana[\s\S]*?<\/li>/)[0];
    assert.match(arcana, /is-expert/);
    assert.match(arcana, /\+7/);
    const history = html.match(/<li class="dnd-skill[^"]*">(?:(?!<\/li>)[\s\S])*History[\s\S]*?<\/li>/)[0];
    assert.match(history, /is-proficient/);
    assert.ok(!history.includes('is-expert'));
    const stealth = html.match(/<li class="dnd-skill[^"]*">(?:(?!<\/li>)[\s\S])*Stealth[\s\S]*?<\/li>/)[0];
    assert.ok(!stealth.includes('is-proficient'));
  });

  it('shows spellcasting ability, attack, DC, slots and prepared spells', () => {
    const html = render(wizardBody());
    assert.match(html, /<span class="stat-label">Spellcasting Ability<\/span><span class="stat-value">INT</);
    assert.match(html, /<span class="stat-label">Spell Attack Modifier<\/span><span class="stat-value">\+5</);
    assert.match(html, /<span class="stat-label">Spell Save DC<\/span><span class="stat-value">13</);
    assert.match(html, /<span class="stat-label">1st<\/span><span class="stat-value">3 \/ 4</);
    assert.match(html, /<span class="stat-label">2nd<\/span><span class="stat-value">2 \/ 2</);
    assert.ok(!html.includes('<span class="stat-label">3rd</span>'), 'levels with no slots are left out');
    assert.ok(html.includes('Magic Missile, Shield'));
    assert.ok(!html.includes('Omit this section'));
  });

  it('leaves spellcasting out when the section is unfilled', () => {
    const html = render(templateBody());
    assert.ok(!html.includes('Spellcasting'));
    assert.ok(!html.includes('Cantrips'));
  });

  it('keeps prepared spells even with no stats or slots', () => {
    const body = replace(templateBody(), '**Cantrips:** {list}', '**Cantrips:** Prestidigitation');
    assert.ok(render(body).includes('Prestidigitation'));
  });

  it('shows proficiencies', () => {
    const html = render(wizardBody());
    assert.ok(html.includes('Common, Elvish'));
  });

  it('passes an unrecognised Stat Sheet subsection through rather than dropping it', () => {
    const body = replace(wizardBody(), '## Background', '### Senses\n\nDarkvision 60 ft\n\n## Background');
    assert.ok(render(body).includes('Darkvision 60 ft'));
  });

  it('passes a Skills section it cannot parse through whole', () => {
    const body = wizardBody().replace(/## Skills[\s\S]*?## Class Features/, '## Skills\n\nArcana and History, mostly.\n\n## Class Features');
    assert.ok(render(body).includes('Arcana and History, mostly.'));
  });

  it('escapes cell text', () => {
    const html = render(setRow(wizardBody(), 'Speed', ['30 ft <b>fly</b> & swim']));
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
    'prose under the Combat table': b => replace(b, '## Background', 'MARKER combat note.\n\n## Background'),
    'prose under the Spell Slots table': b => replace(b, '### Prepared Spells', 'MARKER slots recharge.\n\n### Prepared Spells'),
    'an extra column in Core': b => replace(replace(b, '| Attribute | Value |\n|-----------|-------|\n| Level', '| Attribute | Value | Notes |\n|---|---|---|\n| Level'), '| XP | 900 |', '| XP | 900 | MARKER |'),
    'an extra column in Skills': b => replace(replace(b, '| Skill | Ability | Proficient | Expertise | Modifier |\n|-------|---------|-----------|-----------|----------|', '| Skill | Ability | Proficient | Expertise | Modifier | Notes |\n|---|---|---|---|---|---|'), '| Stealth | DEX | No | No | +0 |', '| Stealth | DEX | No | No | +0 | MARKER |'),
    'an ability row the sheet has no card for': b => replace(b, '| CHA | 10 | +0 | No |', '| CHA | 10 | +0 | No |\n| MARKER Honor | 11 | +0 | No |'),
    'a proficiency cell that is not yes or no': b => replace(b, '| Stealth | DEX | No | No | +0 |', '| Stealth | DEX | MARKER Half | No | +1 |'),
    'a spell slot row with a word for a total': b => setRow(b, '3rd', ['MARKER two', '']),
    'a spell slot row with only Expended': b => setRow(b, '4th', ['', 'MARKER']),
    'a repeated ## Skills section': b => b + '\n## Skills\n\nMARKER second skills.\n',
    'a repeated ### Combat subsection': b => replace(b, '## Background', '### Combat\n\n| Attribute | Value |\n|---|---|\n| MARKER AC | 15 |\n\n## Background'),
    'a loosely titled section (## Stat-Sheet)': b => replace(b, '## Stat Sheet', '## Stat-Sheet').replace('| Medium |', '| MARKER |'),
    'an author blockquote beside the template note': b => replace(b, '> Omit this section if the character has no spellcasting.', '> Omit this section if the character has no spellcasting.\n> MARKER keep me.'),
    'a skills table with other columns': b => b.replace(/\| Skill \| Ability \| Proficient \| Expertise \| Modifier \|[\s\S]*?\| Survival .*\n/, '| Skill | Ability | Proficient | Modifier |\n|---|---|---|---|\n| Stealth | DEX | Yes | MARKER +9 |\n'),
    'a second table in Skills': b => replace(b, '## Class Features', '| Tool | Mod |\n|---|---|\n| MARKER Thieves | +9 |\n\n## Class Features'),
    'a transposed ability table': b => b.replace(/\| Ability \| Score[\s\S]*?\| CHA .*\n/, '| STR | DEX | CON | INT | WIS | CHA |\n|---|---|---|---|---|---|\n| MARKER 8 | 14 | 13 | 17 | 12 | 10 |\n'),
    'a slots table with a Remaining column': b => b.replace('| Level | Total | Expended |', '| Level | Total | Remaining |').replace('| 1st | 4 | 1 |', '| 1st | 4 | MARKER 3 |'),
    'more slots expended than there are': b => setRow(b, '2nd', ['2', '5']).replace('| 2nd | 2 | 5 |', '| MARKER 2nd | 2 | 5 |'),
    'braces an author wrote in Proficiencies': b => replace(b, '**Tools:** {list}', "**Tools:** {MARKER Thieves' Tools}"),
    'a spellcasting value of a dash': b => setRow(b, 'Spell Save DC', ['—']).replace('Spell Save DC', 'MARKER DC'),
  };
  for (const [name, mutate] of Object.entries(cases)) {
    it(`keeps ${name}`, () => {
      const html = render(mutate(wizardBody()));
      if (!name.includes('inline markup')) assert.ok(html.includes('MARKER'), 'the marker must reach the sheet');
      // and the rest of the sheet still renders
      assert.match(html, /<span class="stat-label">AC<\/span><span class="stat-value">12</);
      assert.match(html, /<span>Level 3<\/span>/);
    });
  }

  it('keeps an image-only subsection', () => {
    const body = replace(wizardBody(), '## Background', '### Token\n\n![tok](token.png)\n\n## Background');
    assert.match(render(body), /<h3>Token<\/h3>[\s\S]*<img/);
  });

  it('recognises proficiency words', () => {
    const html = render(setRow(wizardBody(), 'Stealth', ['DEX', 'Proficient', 'Expert', '+6']));
    assert.match(html, /class="dnd-skill is-proficient is-expert"(?:(?!<\/li>)[\s\S])*Stealth/);
  });

  it('drops the template placeholders that share a paragraph with real lines', () => {
    const body = replace(wizardBody(), '**Armor Training:** {list}\n\n**Weapons:** {list}\n\n**Tools:** {list}\n\n', '**Armor Training:** {list}\n**Weapons:** Daggers\n**Tools:** {list}\n');
    const html = render(body);
    assert.ok(html.includes('Daggers'));
    assert.ok(!html.includes('{list}'));
  });

  it('reads a header value with bold in it, and Race for Species', () => {
    const body = replace(wizardBody(), '**Species:** Elf', '**Race:** Half-**Elf** & kin');
    assert.match(render(body), /<span>Half-Elf &amp; kin<\/span>/);
  });

  it('shows max HP as a maximum when current is blank', () => {
    const html = render(setRow(wizardBody(), 'HP (Current)', ['']));
    assert.match(html, /<span class="stat-label">HP<\/span><span class="stat-value">— \/ 17</);
  });

  it('reads abilities written with full names', () => {
    const html = render(replace(wizardBody(), '| STR | 8 |', '| Strength | 8 |'));
    assert.match(html, /<span class="ability-name">STR<\/span>\s*<span class="ability-score">8</);
  });

  it('does not double-escape a passed-through subsection title', () => {
    const body = replace(wizardBody(), '## Background', '### Rage & Fury\n\nTwice a day.\n\n## Background');
    assert.ok(render(body).includes('<h3>Rage &amp; Fury</h3>'));
  });

  it('every title the page drops from its accordions is one the sheet read', () => {
    const { isDndConsumedTitle } = require('../../lib/templates/pc-dnd');
    for (const t of ['Stat Sheet', 'Stat-Sheet', 'SKILLS', 'Spellcasting', 'Proficiencies']) assert.ok(isDndConsumedTitle(t), t);
    for (const t of ['Background', 'Class Features', 'Equipment', 'Notes']) assert.ok(!isDndConsumedTitle(t), t);
  });
});

describe('pcTemplate with a D&D sheet', () => {
  const page = { frontmatter: { type: 'pc', player_name: 'X' }, displayTitle: 'Hero', outputPath: 'pcs/hero.html', title: 'Hero' };
  const noop = () => '';
  const cfg = { siteTitle: 'S', footer: '' };
  const sections = extractSections(wizardBody());
  const accordionTitles = html => [...html.matchAll(/<button class="accordion-header"[^>]*>([^<]*)</g)].map(m => m[1]);

  it('drops the sections the sheet consumed and keeps the prose ones', () => {
    const html = pcTemplate(page, { html: '', relationships: '' }, sections, noop, cfg, {}, undefined,
      { publishConfig: { system: 'dnd-5e-2024' }, systemSheetHtml: renderDnDSheet(page.frontmatter, sections) });
    const titles = accordionTitles(html);
    for (const consumed of ['Stat Sheet', 'Skills', 'Spellcasting', 'Proficiencies']) {
      assert.ok(!titles.includes(consumed), `${consumed} must not repeat as an accordion`);
    }
    for (const kept of ['Background', 'Class Features', 'Species Traits', 'Feats', 'Notes']) {
      assert.ok(titles.includes(kept), `${kept} must stay as an accordion`);
    }
    assert.ok(html.includes('dnd-sheet'));
  });

  it('keeps every section as an accordion when no sheet rendered', () => {
    const html = pcTemplate(page, { html: '', relationships: '' }, sections, noop, cfg, {}, undefined,
      { publishConfig: { system: 'dnd-5e-2024' }, systemSheetHtml: null });
    assert.ok(accordionTitles(html).includes('Stat Sheet'));
  });

  it('does not consume those titles for another system', () => {
    const html = pcTemplate(page, { html: '', relationships: '' }, sections, noop, cfg, {}, undefined,
      { publishConfig: { system: 'fitd' }, systemSheetHtml: '<div>x</div>' });
    assert.ok(accordionTitles(html).includes('Spellcasting'));
  });
});

describe('renderDnDSheet frontmatter fallback', () => {
  it('renders 6 ability score cards', () => {
    const fm = {
      type: 'pc',
      ability_scores: { STR: 16, DEX: 14, CON: 12, INT: 10, WIS: 13, CHA: 8 },
    };
    const html = renderDnDSheet(fm, []);
    assert.ok(html.includes('dnd-ability-scores'));
    assert.ok(html.includes('STR'));
    assert.ok(html.includes('16'));
    assert.ok(html.includes('+3'));
  });

  it('calculates modifiers correctly', () => {
    const fm = {
      type: 'pc',
      ability_scores: { STR: 10, DEX: 8, CON: 15, INT: 1, WIS: 20, CHA: 18 },
    };
    const html = renderDnDSheet(fm, []);
    assert.ok(html.includes('+0'));
    assert.ok(html.includes('-1'));
    assert.ok(html.includes('+2'));
    assert.ok(html.includes('+5'));
    assert.ok(html.includes('+4'));
  });

  it('prefers the body abilities over frontmatter', () => {
    const html = renderDnDSheet({ type: 'pc', ability_scores: { STR: 20 } }, extractSections(wizardBody()));
    const str = html.match(/<span class="ability-name">STR<\/span>[\s\S]*?<\/div>/)[0];
    assert.match(str, />8</);
  });

  it('renders proficiencies as pills', () => {
    const fm = {
      type: 'pc',
      proficiencies: ['Athletics', 'Perception', 'Stealth'],
    };
    const html = renderDnDSheet(fm, []);
    assert.ok(html.includes('dnd-proficiencies'));
    assert.ok(html.includes('Athletics'));
    assert.ok(html.includes('Perception'));
  });

  it('renders class features', () => {
    const fm = {
      type: 'pc',
      class_features: [
        { name: 'Sneak Attack', level: 1, description: 'Extra damage on finesse attacks' },
        { name: 'Cunning Action', level: 2, description: 'Bonus action to Dash, Disengage, or Hide' },
      ],
    };
    const html = renderDnDSheet(fm, []);
    assert.ok(html.includes('Sneak Attack'));
    assert.ok(html.includes('Level 1'));
  });

  it('renders spell slots when present', () => {
    const fm = {
      type: 'pc',
      spell_slots: { 1: 4, 2: 3, 3: 2 },
    };
    const html = renderDnDSheet(fm, []);
    assert.ok(html.includes('Spell Slots'));
  });

  it('falls back to frontmatter when the body section is unfilled', () => {
    const html = renderDnDSheet({ type: 'pc', proficiencies: ['FMPROF'], spell_slots: { 1: 4 } }, extractSections(templateBody()));
    assert.ok(html.includes('FMPROF'));
    assert.ok(html.includes('Spell Slots'));
  });

  it('survives malformed frontmatter', () => {
    const html = renderDnDSheet({ type: 'pc', ability_scores: { STR: 'abc' }, class_features: [null, 'Second Wind'] }, []);
    assert.ok(!html.includes('NaN'));
    assert.ok(html.includes('Second Wind'));
  });

  it('accepts a single proficiency string and lowercase ability keys', () => {
    const html = renderDnDSheet({ type: 'pc', proficiencies: 'Common', ability_scores: { str: 16 } }, []);
    assert.ok(html.includes('Common'));
    assert.match(html, /<span class="ability-name">STR<\/span>/);
  });

  it('returns null when no D&D data present', () => {
    const html = renderDnDSheet({ type: 'pc' }, []);
    assert.strictEqual(html, null);
  });
});
