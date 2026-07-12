const { test } = require('node:test');
const assert = require('node:assert');
const { pcTemplate } = require('../lib/templates/pc');

const page = { frontmatter: { type: 'pc', name: 'Six' }, displayTitle: 'Six', outputPath: 'pcs/six.html', title: 'Six' };
const noop = () => '';
const cfg = { siteTitle: 'S', footer: '' };

test('PC page prepends the change-request widget above the sheet, sheet intact', () => {
  const html = pcTemplate(page, { html: '', relationships: '' }, [], noop, cfg, {}, undefined, {});
  // widget present, tagged with the character
  assert.ok(html.includes('id="cr-root"'), 'widget root present');
  assert.ok(html.includes('data-character="Six"'), 'character tagged');
  assert.ok(html.includes('js/change-request.js'), 'widget script included');
  // widget appears BEFORE the sheet tab bar (i.e. above the sheet body)
  assert.ok(html.indexOf('id="cr-root"') < html.indexOf('class="tab-bar"'), 'widget is above the sheet');
  // sheet body itself still renders unchanged
  assert.ok(html.includes('class="tab-bar"'), 'sheet tabs still present');
  assert.ok(html.includes('id="tab-sheet"'), 'sheet panel still present');
});

test('widget falls back to displayTitle when frontmatter.name is absent', () => {
  const p2 = { frontmatter: { type: 'pc' }, displayTitle: 'Hero', outputPath: 'pcs/hero.html', title: 'Hero' };
  const html = pcTemplate(p2, { html: '', relationships: '' }, [], noop, cfg, {}, undefined, {});
  assert.ok(html.includes('data-character="Hero"'));
});

const fs = require('node:fs');
test('widget script ships the chat-log and hint UI hooks', () => {
  const src = fs.readFileSync(require('path').join(__dirname, '../js/change-request.js'), 'utf8');
  assert.ok(src.includes('cr-hint'), 'has the helper-text element');
  assert.ok(src.includes('cr-log'), 'has the chat-log button/panel');
  assert.ok(src.includes('cr-expand'), 'has the expand/contract control');
  assert.ok(src.includes("'cr:log'"), 'uses the cr:log storage key');
});
