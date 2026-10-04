// Whole-branch review fixes for the D&D sheet: each case is one place a note's
// words were dropped, doubled or mislabelled before.
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { sectionsFromMarkdown } = require('../../helpers/sections');
const { parseDnd } = require('../../../lib/templates/dnd/parse');
const { renderDnDSheet } = require('../../../lib/templates/dnd/index');
const { buildSheet } = require('../../../lib/templates/dnd/layout');
const { usesHtml, marks } = require('../../../lib/templates/dnd/render');
const { renderVitals } = require('../../../lib/templates/dnd/blocks/vitals');
const { renderSpells } = require('../../../lib/templates/dnd/blocks/spells');
const { renderAttacks } = require('../../../lib/templates/dnd/blocks/attacks');
const { renderActions } = require('../../../lib/templates/dnd/blocks/actions');
const { renderAttunement } = require('../../../lib/templates/dnd/blocks/attunement');
const { renderSkills } = require('../../../lib/templates/dnd/blocks/skills');
const { pcTemplate } = require('../../../lib/templates/pc');

const parse = md => parseDnd({ type: 'pc' }, sectionsFromMarkdown(md));
const empty = () => parse('');

const FEATURES = rows => `## Class Features\n\n| Name | Action | Uses | Used | Recovers | Summary |\n|---|---|---|---|---|---|\n${rows}\n`;

describe('a wikilinked item works in every table the parser reads', () => {
  // A built page has the link already turned into an anchor by the time the sheet reads the section.
  const table = (title, head, rows) => [{
    title, id: title.toLowerCase(),
    html: `<table><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`,
  }];
  const link = (href, text) => `<a href="${href}">${text}</a>`;
  it('attunement places a linked row, counts it and keeps its link', () => {
    const m = parseDnd({ type: 'pc' }, [{
      title: 'Equipment', id: 'equipment',
      html: `<h3>Magic Item Attunement</h3>${table('x', ['Slot', 'Item'], [['1', link('cloak.html', 'Cloak of Protection')], ['2', 'Ring of Protection'], ['3', '—']])[0].html}`,
    }]);
    assert.equal(m.attunement.length, 3);
    assert.deepEqual(m.asWritten.equipment, []);
    const html = renderAttunement(m);
    assert.match(html, /2 of 3 used/);
    assert.match(html, /<strong>1:<\/strong> <a href="cloak.html">Cloak of Protection<\/a>/);
    assert.match(html, /<strong>3:<\/strong> empty/);
  });
  it('a skill name may be a link', () => {
    const m = parseDnd({ type: 'pc' }, table('Skills', ['Skill', 'Ability', 'Proficient', 'Expertise', 'Modifier'], [[link('stealth.html', 'Stealth'), 'DEX', 'Yes', 'No', '+5']]));
    assert.equal(m.skills.length, 1);
    assert.deepEqual(m.asWritten.skills, []);
    assert.match(renderSkills(m), /dnd5e-skill-name"><a href="stealth.html">Stealth<\/a>/);
  });
});

describe('feature cells are not dropped', () => {
  const rec = n => ({ name: n, nameHtml: n, uses: null, used: null, recovers: 'Long Rest' });
  it('Recovers shows with no Uses', () => {
    assert.match(usesHtml(rec('Arcane Recovery')), /dnd5e-recovers">Long Rest/);
  });
  it('Recovers shows beside a Used over Uses count', () => {
    const html = usesHtml({ name: 'X', uses: 1, used: 2, recovers: 'Short Rest' });
    assert.match(html, /2 used of 1/);
    assert.match(html, /dnd5e-recovers">Short Rest/);
  });
  it('a row with Recovers and no Uses is placed and drawn', () => {
    const m = parse(FEATURES('| Arcane Recovery | | | | Long Rest | Regain slots. |'));
    assert.equal(m.features.class.length, 1);
    assert.deepEqual(m.asWritten.classFeatures, []);
  });
  it('a Used count with no Uses is shown as written, not placed', () => {
    const m = parse(FEATURES('| Luck | | | 1 | Long Rest | Reroll. |'));
    assert.deepEqual(m.features.class, []);
    assert.match(m.asWritten.classFeatures.join(''), /Luck[\s\S]*<td>1<\/td>[\s\S]*Long Rest/);
  });
});

describe('a vitals-only note keeps its Stat Sheet prose and Level', () => {
  const md = '## Stat Sheet\n\nPlayed as a one-shot.\n\n### Core\n\n| Attribute | Value |\n|---|---|\n| Level | 4 |\n\n### Combat\n\n| Attribute | Value |\n|---|---|\n| AC | 15 |\n';
  it('the sheet holds the level and the prose', () => {
    const html = buildSheet(parse(md));
    assert.match(html, /Level 4/);
    assert.match(html, /Played as a one-shot\./);
  });
  it('a vitals-only note with nothing else still has a sheet', () => {
    const out = renderDnDSheet({ type: 'pc' }, sectionsFromMarkdown('## Stat Sheet\n\n### Combat\n\n| Attribute | Value |\n|---|---|\n| AC | 15 |\n'));
    assert.ok(out.sheetHtml);
  });
});

describe('vitals show what the note wrote', () => {
  const m = () => { const x = empty(); x.combat = { ...x.combat, hitDice: [], other: [] }; return x; };
  it('shows Proficiency Bonus, Conditions and Exhaustion with no AC, HP, Initiative or Speed', () => {
    const x = m();
    x.pb = '+3'; x.combat.conditions = 'Poisoned'; x.combat.exhaustion = '2'; x.combat.tempHp = '4';
    const html = renderVitals(x);
    assert.ok(html, 'vitals exist');
    for (const s of ['+3', 'Poisoned', 'Exhaustion 2', '+ 4 temp']) assert.ok(html.includes(s), s);
  });
  it('Heroic Inspiration written as something other than yes or no is shown as written', () => {
    const x = m();
    x.combat.ac = '15'; x.inspiration = 'Yes (session 3)';
    assert.match(renderVitals(x), /Heroic Inspiration: Yes \(session 3\)/);
    x.inspiration = 'No';
    assert.ok(!renderVitals(x).includes('Heroic'));
  });
  it('Inspiration alone is vitals', () => {
    const x = m();
    x.inspiration = 'Yes (session 3)';
    assert.match(renderVitals(x), /Yes \(session 3\)/);
  });
});

describe('a dash is not a value', () => {
  it('a spell with — in Hit / DC prints no label', () => {
    const x = empty();
    x.spells = [{ name: 'Shield', nameHtml: 'Shield', level: '1', time: 'Reaction', hit: '—', tags: [], summaryHtml: '' }];
    assert.ok(!renderSpells(x).join('').includes('Hit / DC'));
  });
  it('an attack with — in Hit prints no label', () => {
    const x = empty();
    x.attacks = [{ name: 'Fireball', nameHtml: 'Fireball', hit: '—', damage: '8d6 Fire', notesHtml: '' }];
    assert.ok(!renderAttacks(x).includes('>Hit<'));
  });
});

describe('spell times with a leading 1', () => {
  it('1 bonus action and 1 reaction are grouped on Combat', () => {
    const x = empty();
    const sp = (name, time) => ({ name, nameHtml: name, level: '1', time, tags: [], summaryHtml: '' });
    x.spells = [sp('Healing Word', '1 bonus action'), sp('Shield', '1 Reaction'), sp('Bless', 'Action')];
    const html = renderActions(x).join('');
    assert.match(html, /Bonus action[\s\S]*Healing Word/);
    assert.match(html, /Reaction[\s\S]*Shield/);
    assert.ok(!html.includes('Bless'));
  });
});

describe('a count above ten is labelled for assistive tech', () => {
  it('the count span has a role', () => assert.match(marks(25, 7, 'Lay on Hands'), /<span class="dnd5e-count" role="img" aria-label=/));
});

describe('equipment the sheet does not draw still reaches the Equipment tab', () => {
  const page = { frontmatter: { type: 'pc', player_name: 'X', equipment: ['Brass lantern'] }, displayTitle: 'Hero', outputPath: 'pcs/hero.html', title: 'Hero' };
  const sec = (title, html) => ({ title, id: title.toLowerCase(), html });
  const build = (system, sections, ctx = {}) => pcTemplate(page, { html: '', relationships: '' }, sections, () => '', { siteTitle: 'S', footer: '' }, {}, undefined,
    { publishConfig: { system }, systemSheetHtml: '<div>sheet</div>', ...ctx });
  const tab = html => html.split('id="tab-equipment"')[1].split('id="tab-story"')[0];
  const sections = [sec('Equipment', '<p>consumed</p>'), sec('Inventory', '<p>rope-and-lantern</p>'), sec('Weapons', '<p>a-long-knife</p>')];

  it('D&D: Inventory, Weapons and the frontmatter list follow the sheet\'s equipment, once each', () => {
    const html = build('dnd-5e-2024', sections, { systemEquipmentHtml: '<div>drawn-gear</div>' });
    const t = tab(html);
    for (const s of ['drawn-gear', 'rope-and-lantern', 'a-long-knife', 'Brass lantern']) assert.equal(t.split(s).length - 1, 1, s);
    assert.ok(!html.includes('consumed'), 'the consumed Equipment section is not repeated');
    assert.equal(html.split('rope-and-lantern').length - 1, 1, 'and not in an accordion');
  });
  it('D&D without equipment from the sheet is as before', () => {
    const t = tab(build('dnd-5e-2024', sections));
    assert.ok(t.includes('Brass lantern'));
  });
  it('another system that supplies equipment HTML shows it alone, as before', () => {
    for (const system of ['gurps-4e', 'coc-7e']) {
      const html = build(system, sections, { systemEquipmentHtml: '<div>drawn-gear</div>' });
      assert.ok(html.includes('drawn-gear'), system);
      // Inventory and Weapons stay out of the page, as on main, and so does the frontmatter list.
      assert.ok(!html.includes('rope-and-lantern') && !html.includes('a-long-knife') && !html.includes('Brass lantern'), system);
    }
  });
});

describe('Pathfinder and Forged in the Dark keep their inline tab list', () => {
  const page = { frontmatter: { type: 'pc', player_name: 'X' }, displayTitle: 'Hero', outputPath: 'pcs/hero.html', title: 'Hero' };
  for (const system of ['pf2e', 'fitd']) {
    it(system, () => {
      const html = pcTemplate(page, { html: '', relationships: '' }, [], () => '', { siteTitle: 'S', footer: '' }, {}, undefined,
        { publishConfig: { system }, systemSheetHtml: '<div>sheet</div>' });
      assert.deepEqual([...html.matchAll(/<button class="pc-tab[^>]*data-tab="([^"]+)"/g)].map(m => m[1]), ['sheet', 'equipment', 'story', 'journey']);
    });
  }
});
