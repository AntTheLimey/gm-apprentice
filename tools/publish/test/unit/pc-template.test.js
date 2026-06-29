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
