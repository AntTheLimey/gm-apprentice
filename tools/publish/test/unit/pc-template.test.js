const { describe, it } = require('node:test');
const assert = require('node:assert');
const { pcTemplate } = require('../../lib/templates/pc');

const page = { frontmatter: { type: 'pc', player_name: 'X' }, displayTitle: 'Hero', outputPath: 'pcs/hero.html', title: 'Hero' };
const noop = () => '';
const cfg = { siteTitle: 'S', footer: '' };

describe('pcTemplate combat tab', () => {
  it('renders a Combat tab when systemCombatHtml is present', () => {
    const html = pcTemplate(page, { html: '', relationships: '' }, [], noop, cfg, {}, undefined,
      { systemCombatHtml: '<div id="probe-combat">x</div>' });
    assert.ok(html.includes("data-tab=\"combat\""));
    assert.ok(html.includes('probe-combat'));
  });
  it('omits the Combat tab when no combat HTML', () => {
    const html = pcTemplate(page, { html: '', relationships: '' }, [], noop, cfg, {}, undefined, {});
    assert.ok(!html.includes("data-tab=\"combat\""));
  });
  it('uses systemEquipmentHtml for the equipment tab when present', () => {
    const html = pcTemplate(page, { html: '', relationships: '' }, [], noop, cfg, {}, undefined,
      { systemEquipmentHtml: '<div id="probe-equip">e</div>' });
    assert.ok(html.includes('probe-equip'));
  });
});

describe('pcTemplate GURPS consumed-titles graceful degradation', () => {
  const gurpsConfig = { publishConfig: { system: 'gurps-4e' } };
  const skillsSection = { title: 'Skills', id: 'skills', html: '<p>Some skills content</p>' };
  const combatSection = { title: 'Combat Action Chains', id: 'combat-action-chains', html: '<p>chains</p>' };

  it('GURPS PC with null sheetHtml keeps Skills accordion visible', () => {
    // systemSheetHtml is null — renderer returned nothing. Skills must NOT be suppressed.
    const html = pcTemplate(
      page,
      { html: '', relationships: '' },
      [skillsSection],
      noop,
      cfg,
      {},
      undefined,
      { ...gurpsConfig, systemSheetHtml: null, systemCombatHtml: null },
    );
    assert.ok(html.includes('Some skills content'), 'Skills accordion must appear when sheetHtml is null');
  });

  it('GURPS PC with real sheetHtml suppresses Skills accordion (deduplication)', () => {
    // systemSheetHtml is present — Skills is consumed, so accordion should be suppressed.
    const html = pcTemplate(
      page,
      { html: '', relationships: '' },
      [skillsSection],
      noop,
      cfg,
      {},
      undefined,
      { ...gurpsConfig, systemSheetHtml: '<div class="gurps-sheet">sheet</div>', systemCombatHtml: null },
    );
    assert.ok(!html.includes('Some skills content'), 'Skills accordion must be suppressed when sheetHtml is present');
  });

  it('GURPS PC with null combatHtml keeps Combat Action Chains accordion visible', () => {
    // systemCombatHtml is null — combat chains must stay in accordions.
    const html = pcTemplate(
      page,
      { html: '', relationships: '' },
      [combatSection],
      noop,
      cfg,
      {},
      undefined,
      { ...gurpsConfig, systemSheetHtml: null, systemCombatHtml: null },
    );
    assert.ok(html.includes('chains'), 'Combat chains accordion must appear when combatHtml is null');
  });

  it('GURPS PC with real combatHtml suppresses Combat Action Chains accordion', () => {
    const html = pcTemplate(
      page,
      { html: '', relationships: '' },
      [combatSection],
      noop,
      cfg,
      {},
      undefined,
      { ...gurpsConfig, systemSheetHtml: null, systemCombatHtml: '<div>combat</div>' },
    );
    assert.ok(!html.includes('chains'), 'Combat chains accordion must be suppressed when combatHtml is present');
  });
});

describe('pcTemplate pull quote', () => {
  const { templateBody } = require('../helpers/pc-template');
  const sheet = { systemSheetHtml: '<div>sheet</div>' };
  const quoted = (frontmatter, context, body = '## Stat Sheet\n\n| STR | 50 |\n|---|---|\n') => pcTemplate(
    { frontmatter: { type: 'pc', ...frontmatter }, displayTitle: 'Hero', outputPath: 'pcs/hero.html', title: 'Hero', markdown: body, content: body },
    { html: '', relationships: '' }, [], noop, cfg, {}, undefined, context);
  const quote = html => (html.match(/<div class="pull-quote">([\s\S]*?)<\/div>/) || [])[1];
  const prose = '\n## Background\n\nA sailor out of Brest. He owes the Guild.\n';

  it('quotes key_traits', () => {
    assert.strictEqual(quote(quoted({ key_traits: ['bold', 'wry'] }, sheet)), 'bold, wry');
  });
  it('shows no quote for an empty key_traits list and a body of stats', () => {
    assert.ok(!quoted({ key_traits: [] }, sheet).includes('pull-quote'));
  });
  it('ignores blank key_traits entries', () => {
    assert.ok(!quoted({ key_traits: ['', null] }, sheet).includes('pull-quote'));
    assert.strictEqual(quote(quoted({ key_traits: ['', 'wry'] }, {})), 'wry');
  });

  // 1.11.43 dropped the excerpt whenever a system sheet rendered, which took the
  // quote off every CoC and GURPS PC without key_traits. The junk it was after came
  // from FitD's label lines, which the excerpt now skips instead.
  const sheets = {
    'CoC': '## Stat Sheet\n\n### Characteristics\n\n| STR | CON |\n|---|---|\n| 50 | 60 |\n\n### Conditions\n\n- [ ] Major Wound\n- [ ] Dying\n\n**Occupation:** Sailor\n',
    'GURPS': '## Stat Sheet\n\n**ST** 12\n\n| Attribute | Level |\n|---|---|\n| DX | 11 |\n\n**Basic Speed:** 5.75\n',
    'D&D': '## Stat Sheet\n\n**Species:** Human\n\n**Class/Subclass:** Fighter\n\n| Ability | Score |\n|---|---|\n| STR | 16 |\n',
  };
  for (const [system, body] of Object.entries(sheets)) {
    it(`quotes the prose of a ${system} PC that has a sheet and no key_traits`, () => {
      assert.strictEqual(quote(quoted({}, sheet, body + prose)), 'A sailor out of Brest.');
    });
  }
  it('never quotes a FitD sheet\'s label lines', () => {
    const body = '## Stat Sheet\n\n**Playbook:** Cutter\n\n### Action Ratings\n\n**Insight**\n\n| Action | Rating |\n|---|---|\n| Hunt | 1 |\n\n'
      + '**Prowess**\n\n**Resolve**\n\n**Playbook XP:** 0 / 8\n\n**Stress**: 3\n';
    assert.ok(!quoted({}, sheet, body).includes('pull-quote'));
    assert.strictEqual(quote(quoted({}, sheet, body + prose)), 'A sailor out of Brest.');
  });
  it('never quotes tick-boxes or an unfilled template', () => {
    assert.ok(!quoted({}, sheet, '## Conditions\n\n- [ ] Major Wound\n- [x] Dying\n').includes('pull-quote'));
    for (const template of ['pc-fitd.md', 'pc-coc-7e.md', 'pc-coc-7e-regency.md', 'pc-generic.md']) {
      assert.ok(!quoted({}, sheet, templateBody(template)).includes('pull-quote'), template);
    }
  });
  it('keeps a bold phrase that opens a sentence', () => {
    assert.strictEqual(quote(quoted({}, sheet, '## Background\n\n**Jacob** was the coachman. He said little.\n')), 'Jacob was the coachman.');
  });
});
