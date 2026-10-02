const { describe, it } = require('node:test');
const assert = require('node:assert');
const { templateBody, setRow, replace, sectionsOf, druidBody } = require('../helpers/pc-template');
const { renderPF2eSheet, isPF2eConsumedTitle } = require('../../lib/templates/pc-pf2e');
const { pcTemplate } = require('../../lib/templates/pc');

const blank = () => templateBody('pc-pf2e.md');


const render = (body, fm = { type: 'pc' }) => renderPF2eSheet(fm, sectionsOf(body));
const stat = (html, label) => {
  const m = html.match(new RegExp(`<span class="stat-label">${label.replace(/[()/]/g, '\\$&')}</span><span class="stat-value">([^<]*)<`));
  return m ? m[1] : null;
};

describe('renderPF2eSheet from the real template body', () => {
  it('renders a sheet for the untouched template', () => {
    const html = render(blank());
    assert.ok(html.includes('pf2e-sheet'));
    assert.ok(!html.includes('{'), 'no template placeholder reaches the sheet');
    assert.ok(!html.includes('Spellcasting'));
    assert.ok(!html.includes('Remaster attributes are modifiers'));
  });

  it('shows the header: level, class, ancestry, heritage, background', () => {
    const header = render(druidBody()).match(/<div class="dnd-header">[\s\S]*?<\/div>/)[0];
    for (const bit of ['Level 2', 'Druid \\(Leaf\\)', 'Elf', 'Woodland Elf', 'Herbalist']) assert.match(header, new RegExp(`<span>${bit}</span>`));
  });

  it('shows the six attribute modifiers', () => {
    const html = render(druidBody());
    assert.match(html, /<span class="ability-name">WIS<\/span>\s*<span class="ability-score">\+4</);
    assert.match(html, /<span class="ability-name">CHA<\/span>\s*<span class="ability-score">-1</);
    assert.strictEqual((html.match(/class="dnd-ability-card/g) || []).length, 6);
  });

  it('shows every Core and Combat row', () => {
    const html = render(druidBody());
    assert.strictEqual(stat(html, 'AC'), '17');
    assert.strictEqual(stat(html, 'HP'), '20 / 26');
    assert.strictEqual(stat(html, 'Will'), '+10 (Expert)');
    assert.strictEqual(stat(html, 'Hero Points'), '2');
    assert.strictEqual(stat(html, 'Class DC'), '18');
    for (const label of ['XP', 'Shield (Hardness/HP/BT)', 'Speed', 'Size', 'Perception', 'Fortitude', 'Reflex']) {
      assert.notStrictEqual(stat(html, label), null, label);
    }
  });

  it('merges a bare HP row with HP (Max)', () => {
    const html = render(replace(druidBody(), '| HP (Current) | 20 |', '| HP | 20 |'));
    assert.strictEqual(stat(html, 'HP'), '20 / 26');
    assert.strictEqual((html.match(/<span class="stat-label">HP<\/span>/g) || []).length, 1);
  });

  it('lists skills with their rank, and leaves the unfilled Lore row out', () => {
    const html = render(druidBody());
    assert.strictEqual((html.match(/class="dnd-skill[ "]/g) || []).length, 16);
    const nature = html.match(/<li class="dnd-skill[^"]*">(?:(?!<\/li>)[\s\S])*Nature[\s\S]*?<\/li>/)[0];
    assert.match(nature, /is-proficient/);
    assert.match(nature, /<span class="skill-rank" title="Expert"[^>]*>E</);
    assert.match(nature, /\+10/);
    const medicine = html.match(/<li class="dnd-skill[^"]*">(?:(?!<\/li>)[\s\S])*Medicine[\s\S]*?<\/li>/)[0];
    assert.match(medicine, /title="Trained"[^>]*>T</);
    assert.ok(!html.includes('{topic}'));
  });

  it('keeps a Lore row once it is filled in', () => {
    const html = render(replace(druidBody(), '| Lore ({topic}) | INT | U | +0 |', '| Lore (Herbalism) | INT | T | +5 |'));
    assert.ok(html.includes('Lore (Herbalism)'));
  });

  it('shows spellcasting, slots by rank, focus points and spells', () => {
    const html = render(druidBody());
    assert.strictEqual(stat(html, 'Tradition'), 'Primal');
    assert.strictEqual(stat(html, 'Prepared / Spontaneous'), 'Prepared');
    assert.strictEqual(stat(html, 'Spell DC'), '18');
    assert.strictEqual(stat(html, 'Rank 1'), '2 / 3');
    assert.strictEqual(stat(html, 'Rank 2'), null);
    assert.strictEqual(stat(html, 'Focus Points (Current/Max)'), '1/1');
    assert.ok(html.includes('Heal, Gust of Wind'));
    assert.ok(html.includes('Cornucopia'));
  });

  it('shows proficiencies', () => {
    assert.ok(render(druidBody()).includes('Common, Elven, Fey'));
  });
});

describe('renderPF2eSheet drops nothing from a consumed section', () => {
  const cases = {
    'prose under the Attributes table': b => replace(b, '### Combat', 'MARKER drained.\n\n### Combat'),
    'an attribute row the sheet has no card for': b => replace(b, '| CHA | -1 |', '| CHA | -1 |\n| MARKER | +1 |'),
    'a Notes column in Combat': b => replace(b, '| Attribute | Value |\n|-----------|-------|\n| AC | 17 |', '| Attribute | Value | Notes |\n|---|---|---|\n| AC | 17 | MARKER shield raised |'),
    'a rank the sheet does not know': b => setRow(b, 'Stealth', ['DEX', 'MARKER', '+2']),
    'an unknown Stat Sheet subsection': b => replace(b, '## Background', '### Senses\n\nMARKER low-light vision.\n\n## Background'),
    'a focus table with rows under it': b => replace(b, '| Focus Points (Current/Max) | 1/1 |\n|----------------------------|--|', '| Focus Points (Current/Max) | 1/1 |\n|----------------------------|--|\n| MARKER | 2 |'),
    'a slot row with a word for a total': b => setRow(b, '2', ['MARKER', '']),
    'a repeated ## Proficiencies section': b => b + '\n## Proficiencies\n\nMARKER again.\n',
    'braces an author wrote': b => replace(b, '**Armor:** {list with ranks}', '**Armor:** {MARKER light}'),
  };
  for (const [name, mutate] of Object.entries(cases)) {
    it(`keeps ${name}`, () => {
      const html = render(mutate(druidBody()));
      assert.ok(html.includes('MARKER'), 'the marker must reach the sheet');
      assert.strictEqual(stat(html, 'AC') === '17' || name.includes('Notes column'), true);
    });
  }
});

describe('pcTemplate with a PF2e sheet', () => {
  const page = { frontmatter: { type: 'pc', player_name: 'X' }, displayTitle: 'Hero', outputPath: 'pcs/hero.html', title: 'Hero' };
  const sections = sectionsOf(druidBody());
  const accordionTitles = html => [...html.matchAll(/<button class="accordion-header"[^>]*>([^<]*)</g)].map(m => m[1]);
  const build = (system, sheet) => pcTemplate(page, { html: '', relationships: '' }, sections, () => '', { siteTitle: 'S', footer: '' }, {}, undefined,
    { publishConfig: { system }, systemSheetHtml: sheet });

  it('drops the consumed sections and keeps the prose ones, for every alias', () => {
    for (const system of ['pf2e', 'pathfinder-2e', 'pathfinder']) {
      const titles = accordionTitles(build(system, renderPF2eSheet(page.frontmatter, sections)));
      for (const t of ['Stat Sheet', 'Skills', 'Spellcasting', 'Proficiencies']) assert.ok(!titles.includes(t), `${system}: ${t}`);
      for (const t of ['Background', 'Class Features', 'Ancestry Feats', 'Class Feats', 'Skill &amp; General Feats', 'Notes']) assert.ok(titles.includes(t), `${system}: ${t}`);
    }
  });

  it('keeps every section when no sheet rendered', () => {
    assert.ok(accordionTitles(build('pf2e', null)).includes('Stat Sheet'));
  });

  it('matches titles the way the renderer reads them', () => {
    assert.ok(isPF2eConsumedTitle('Stat-Sheet'));
    assert.ok(!isPF2eConsumedTitle('Class Feats'));
  });
});

describe('renderPF2eSheet body sections', () => {
  it('renders 6 attribute cards with signed modifiers', () => {
    const html = render([
      '## Stat Sheet', '', '### Attributes', '',
      '| Attribute | Modifier |', '|---|---|',
      '| STR | +4 |', '| DEX | +2 |', '| CON | +3 |', '| INT | +0 |', '| WIS | +1 |', '| CHA | -1 |',
    ].join('\n'));
    assert.strictEqual((html.match(/class="dnd-ability-card/g) || []).length, 6);
    assert.ok(html.includes('+4'));
    assert.ok(html.includes('+0'));
    assert.ok(html.includes('-1'));
  });

  it('prefers the body attributes over frontmatter', () => {
    const html = render(druidBody(), { type: 'pc', attributes: { WIS: 9 } });
    assert.ok(!html.includes('+9'));
  });

  it('renders body skills with their rank', () => {
    const html = render([
      '## Skills', '', '| Skill | Attribute | Rank | Modifier |', '|---|---|---|---|',
      '| Athletics | STR | Expert | +9 |', '| Acrobatics | DEX | Trained | +5 |',
    ].join('\n'));
    assert.ok(html.includes('dnd-skills'));
    assert.ok(html.includes('Athletics'));
    assert.ok(html.includes('Expert'));
    assert.ok(html.includes('Acrobatics'));
  });

  it('renders hero points from the body Core table', () => {
    const body = '## Stat Sheet\n\n### Core\n\n| Attribute | Value |\n|---|---|\n| Level | 2 |\n| Hero Points | 2 |\n';
    assert.strictEqual(stat(render(body), 'Hero Points'), '2');
  });

  it('renders spell slots by rank from the body', () => {
    const html = render([
      '## Spellcasting', '', '### Spell Slots', '',
      '| Rank | Total | Expended |', '|---|---|---|', '| 1 | 3 | 0 |', '| 2 | 2 | 0 |',
    ].join('\n'));
    assert.ok(html.includes('Spell Slots'));
    assert.strictEqual(stat(html, 'Rank 1'), '3 / 3');
  });
});

// The note body is the only source: a frontmatter copy of any stat is not read.
describe('renderPF2eSheet ignores frontmatter stats', () => {
  const sentinel = {
    type: 'pc',
    attributes: { STR: 77, DEX: 77, CON: 77, INT: 77, WIS: 77, CHA: 77 },
    skill_proficiencies: [{ name: 'FMSKILL', rank: 'Expert' }, 'FMSTRING'],
    class_features: [{ name: 'FMFEATURE', level: 1 }],
    hero_points: 7,
    spell_slots: { 1: 5 },
  };

  it('returns null when only frontmatter carries stats', () => {
    assert.strictEqual(renderPF2eSheet(sentinel, []), null);
  });

  it('leaves every frontmatter value off a sheet built from the template body', () => {
    const html = render(blank(), sentinel);
    for (const s of ['77', 'FMSKILL', 'FMSTRING', 'FMFEATURE', 'Spell Slots']) {
      assert.ok(!html.includes(s), `${s} must not come from frontmatter`);
    }
    assert.notStrictEqual(stat(html, 'Hero Points'), '7');
  });

  it('does not choke on malformed frontmatter values', () => {
    assert.strictEqual(renderPF2eSheet({ type: 'pc', attributes: { STR: 'abc' }, skill_proficiencies: 'Stealth', class_features: [null] }, []), null);
  });

  it('returns null when no PF2e data present', () => {
    assert.strictEqual(renderPF2eSheet({ type: 'pc' }, []), null);
  });
});
