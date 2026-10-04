// Second whole-branch review fixes for the D&D sheet.
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { sectionsFromMarkdown } = require('../../helpers/sections');
const { parseDnd } = require('../../../lib/templates/dnd/parse');
const { usesHtml, marks } = require('../../../lib/templates/dnd/render');
const { renderSkills } = require('../../../lib/templates/dnd/blocks/skills');
const { renderGear } = require('../../../lib/templates/dnd/blocks/gear');
const { renderVitals } = require('../../../lib/templates/dnd/blocks/vitals');
const { renderDefences } = require('../../../lib/templates/dnd/blocks/defences');
const { renderSpells } = require('../../../lib/templates/dnd/blocks/spells');
const { renderCompanions } = require('../../../lib/templates/dnd/blocks/companions');
const { renderTracks } = require('../../../lib/templates/dnd/blocks/tracks');

const css = fs.readFileSync(path.join(__dirname, '../../../css/style.css'), 'utf8');
const parse = md => parseDnd({ type: 'pc' }, sectionsFromMarkdown(md));
const link = (href, text) => `<a href="${href}">${text}</a>`;
const table = (head, rows) => `<table><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
const parseHtml = (title, html) => parseDnd({ type: 'pc' }, [{ title, id: title.toLowerCase(), html }]);
const FEATURES = rows => `## Class Features\n\n| Name | Action | Uses | Used | Recovers | Summary |\n|---|---|---|---|---|---|\n${rows}\n`;

describe('a skill modifier with a reason (finding 1)', () => {
  it('the reason is drawn as its own row across the columns after the dot', () => {
    const m = parse('## Skills\n\n| Skill | Ability | Proficient | Expertise | Modifier |\n|---|---|---|---|---|\n| Stealth | DEX | No | No | +7 (GM boon) |\n');
    const html = renderSkills(m);
    assert.match(html, /<span class="dnd5e-num" title="GM boon">\+7<\/span><span class="dnd5e-why">GM boon<\/span><\/li>/);
    const rule = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].find(([, sel]) => sel.replace(/\/\*[\s\S]*?\*\//g, '').trim() === '.dnd5e-skill .dnd5e-why');
    assert.ok(rule, 'a rule for the reason inside a skill row');
    assert.match(rule[2], /grid-column:\s*2\s*\/\s*-1/);
  });
});

describe('a reason beside an ability modifier or save (finding 1, other grids)', () => {
  it('is a block of body text under the number, not a letter-wide column', () => {
    const rule = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].find(([, sel]) => sel.replace(/\/\*[\s\S]*?\*\//g, '').trim() === '.dnd5e-ab .dnd5e-why');
    assert.ok(rule);
    assert.match(rule[2], /display:\s*block/);
    assert.match(rule[2], /font-family:\s*var\(--font-body\)/);
  });
});

describe('a link in an Attribute | Value cell (finding 3)', () => {
  it('the AC tile is placed by its text and the row is not left as a raw table', () => {
    const m = parseHtml('Stat Sheet', `<h3>Combat</h3>${table(['Attribute', 'Value'], [['AC', `20 (${link('plate.html', 'Plate Armor')})`], ['Initiative', '+2']])}`);
    assert.equal(m.combat.ac, '20 (Plate Armor)');
    assert.deepEqual(m.asWritten.statSheet, []);
    assert.match(renderVitals(m), /<span class="dnd5e-num" title="Plate Armor">20<\/span>/);
    assert.match(renderVitals(m), /<span class="dnd5e-why"><a href="plate.html">Plate Armor<\/a><\/span>/);
  });
  it('a link in the value itself leaves the row as written', () => {
    const m = parseHtml('Stat Sheet', `<h3>Combat</h3>${table(['Attribute', 'Value'], [['AC', link('plate.html', '20')]])}`);
    assert.equal(m.combat.ac, '');
    assert.equal(m.asWritten.statSheet.length, 1);
  });
  it('an image in the cell still leaves the row as written', () => {
    const m = parseHtml('Stat Sheet', `<h3>Combat</h3>${table(['Attribute', 'Value'], [['AC', '<img src="a.png">']])}`);
    assert.equal(m.asWritten.statSheet.length, 1);
  });
  it('a link in Senses and Carrying keeps the row placed', () => {
    const m = parseHtml('Stat Sheet', `<h3>Senses</h3>${table(['Attribute', 'Value'], [['Darkvision', `60 ft (${link('elf.html', 'Elf')})`]])}`);
    assert.equal(m.senses.length, 1);
    assert.deepEqual(m.asWritten.statSheet, []);
  });
});

describe('links in text-only cells are kept (finding 4)', () => {
  it('a feature Recovers link', () => {
    const m = parseHtml('Class Features', table(['Name', 'Action', 'Uses', 'Used', 'Recovers', 'Summary'], [['Rage', '', '', '', link('rest.html', 'Long Rest'), 'x']]));
    assert.match(usesHtml(m.features.class[0]), /dnd5e-recovers"><a href="rest.html">Long Rest<\/a>/);
  });
  it('a Defences line link', () => {
    const m = parseHtml('Stat Sheet', `<h3>Defences</h3><p><strong>Resistances:</strong> ${link('fire.html', 'fire')}, cold</p>`);
    assert.match(renderDefences(m), /<strong>Resistances:<\/strong> <a href="fire.html">fire<\/a>, cold/);
  });
  it('a spell tag link, beside plain tags', () => {
    const cells = ['Shield', '1', '1 reaction', 'Self', 'V, S', '1 round', '', `${link('abj.html', 'Abjuration')}, C`, 'x'];
    const m = parseHtml('Spellcasting', `<h3>Spells</h3>${table(['Spell', 'Level', 'Casting Time', 'Range', 'Components', 'Duration', 'Hit / DC', 'Tags', 'Summary'], [cells])}`);
    const html = renderSpells(m).join('');
    assert.match(html, /<span class="dnd5e-tag"><a href="abj.html">Abjuration<\/a><\/span>/);
    assert.match(html, /dnd5e-tag is-conc">Concentration/);
  });
  it('a companion Kind link', () => {
    const m = parseHtml('Companions', table(['Companion', 'Kind', 'AC', 'HP', 'Speed', 'Notes'], [['Rex', link('wolf.html', 'Wolf'), '13', '11', '40 ft', 'x']]));
    assert.match(renderCompanions(m), /<span class="dnd5e-tag"><a href="wolf.html">Wolf<\/a><\/span>/);
  });
  it('a cell with no link renders as before', () => {
    const m = parse(FEATURES('| Rage | Bonus Action | | | Long Rest | x |'));
    assert.match(usesHtml(m.features.class[0]), /dnd5e-recovers">Long Rest<\/span>/);
  });
});

describe('a spent 0 with no total (finding 5)', () => {
  it('is blank: the row is placed, not shown raw', () => {
    const m = parse(FEATURES('| Naturally Stealthy | | | 0 | | x |'));
    assert.equal(m.features.class.length, 1);
    assert.deepEqual(m.asWritten.classFeatures, []);
  });
  it('a spent 2 with no total is still shown as written', () => {
    const m = parse(FEATURES('| Naturally Stealthy | | | 2 | | x |'));
    assert.equal(m.features.class.length, 0);
    assert.equal(m.asWritten.classFeatures.length, 1);
  });
});

describe('zero counts draw something (finding 6)', () => {
  it('0 uses is text', () => {
    assert.match(usesHtml({ name: 'X', uses: 0, used: 0 }), /dnd5e-count[^>]*><span class="dnd5e-num">0<\/span> \/ 0/);
    assert.match(marks(0, 0, 'X'), /0<\/span> \/ 0/);
  });
  it('hit dice 0/0 are text, not an empty marks row', () => {
    const m = parse('## Stat Sheet\n\n### Combat\n\n| Attribute | Value |\n|---|---|\n| Hit Dice d8 (spent / max) | 0/0 |\n');
    const html = renderTracks(m);
    assert.match(html, /0<\/span> \/ 0/);
    assert.ok(!html.includes('dnd5e-marks'));
  });
});

describe('a gear weight with a unit (finding 7)', () => {
  const gear = w => renderGear({ gear: [{ name: 'Dart', nameHtml: 'Dart', qty: '1', weight: w, notesHtml: '' }], asWritten: { equipment: [] } });
  for (const [w, shown] of [['1/4', '1/4 lb'], ['2', '2 lb'], ['0.5', '0.5 lb'], ['1 1/2', '1 1/2 lb'], ['2 lb', '2 lb']]) {
    it(w, () => assert.match(gear(w), new RegExp(`dnd5e-tag">${shown}<`)));
  }
});

describe('the phone strip with a reasoned AC (finding 9)', () => {
  const m = parse('## Stat Sheet\n\n### Combat\n\n| Attribute | Value |\n|---|---|\n| AC | 18 (Chain Mail, Shield) |\n| Initiative | +3 (Alert) |\n\n### Defences\n\n**Armour Class:** Chain Mail 16 + Shield 2\n');
  it('the AC reason is marked as shown again under Defences, and Initiative is not', () => {
    const html = renderVitals(m);
    assert.match(html, /dnd5e-why is-dup">Chain Mail, Shield/);
    assert.match(html, /dnd5e-why">Alert/);
  });
  it('with no Armour Class line the AC reason is the only place and is kept', () => {
    const none = parse('## Stat Sheet\n\n### Combat\n\n| Attribute | Value |\n|---|---|\n| AC | 18 (Chain Mail, Shield) |\n');
    assert.match(renderVitals(none), /dnd5e-why">Chain Mail, Shield/);
  });
  it('a phone hides the marked reason', () => {
    assert.match(css, /@media \(max-width: 480px\)[\s\S]*\.dnd5e-vitals \.dnd5e-why\.is-dup \{ display: none; \}/);
  });
});
