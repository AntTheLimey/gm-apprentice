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
