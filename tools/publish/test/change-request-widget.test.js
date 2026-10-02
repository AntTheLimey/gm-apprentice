const { test } = require('node:test');
const assert = require('node:assert');
const { pcTemplate } = require('../lib/templates/pc');

const page = { frontmatter: { type: 'pc', name: 'Six' }, displayTitle: 'Six', outputPath: 'pcs/six.html', title: 'Six' };
const noop = () => '';
const cfg = { siteTitle: 'S', footer: '' };

const inboxOn = { publishConfig: { live: { inbox: true } } };

test('PC page prepends the change-request widget when inbox is enabled', () => {
  const html = pcTemplate(page, { html: '', relationships: '' }, [], noop, cfg, {}, undefined, inboxOn);
  assert.ok(html.includes('id="cr-root"'), 'widget root present');
  assert.ok(html.includes('data-character="Six"'), 'character tagged');
  assert.ok(html.includes('js/change-request.js'), 'widget script included');
  assert.ok(html.indexOf('id="cr-root"') < html.indexOf('class="tab-bar"'), 'widget is above the sheet');
  assert.ok(html.includes('class="tab-bar"'), 'sheet tabs still present');
  assert.ok(html.includes('id="tab-sheet"'), 'sheet panel still present');
});

test('widget falls back to displayTitle when frontmatter.name is absent', () => {
  const p2 = { frontmatter: { type: 'pc' }, displayTitle: 'Hero', outputPath: 'pcs/hero.html', title: 'Hero' };
  const html = pcTemplate(p2, { html: '', relationships: '' }, [], noop, cfg, {}, undefined, inboxOn);
  assert.ok(html.includes('data-character="Hero"'));
});

// The attribute is the only author-typed string that leaves the build and comes
// back at runtime: the browser posts it as the inbox entry's `character`, which
// the GM side matches against vault note names. A decomposed name emitted as-is
// never matches a composed note title, so normalize at this boundary like every
// other comparison site does (#139).
test('data-character is emitted NFC-normalized even when the name is decomposed', () => {
  const nfd = 'Gonza\u0301lez'; // n, a, combining acute
  const nfc = 'Gonz\u00e1lez';   // precomposed a-acute
  const p = { frontmatter: { type: 'pc', name: nfd }, displayTitle: nfd, outputPath: 'pcs/gonzalez.html', title: nfd };
  const html = pcTemplate(p, { html: '', relationships: '' }, [], noop, cfg, {}, undefined, inboxOn);
  assert.ok(html.includes(`data-character="${nfc}"`), 'attribute carries the composed form');
  assert.ok(!html.includes(`data-character="${nfd}"`), 'attribute does not carry the decomposed form');
});

const fs = require('node:fs');
test('widget script ships the chat-log and hint UI hooks', () => {
  const src = fs.readFileSync(require('path').join(__dirname, '../js/change-request.js'), 'utf8');
  assert.ok(src.includes('cr-hint'), 'has the helper-text element');
  assert.ok(src.includes('cr-log-btn'), 'has the always-visible chat-history button');
  assert.ok(src.includes('cr-text'), 'has the resizable message box');
  assert.ok(src.includes("'cr:log'"), 'uses the cr:log storage key');
});

// With sheets off (#cr-root data-sheets="off") the widget is a question channel:
// no sheet or change wording anywhere a player can read, same payload as ever.
const cr = require('../js/change-request.js');
const readSrc = () => fs.readFileSync(require('path').join(__dirname, '../js/change-request.js'), 'utf8');

test('default widget copy is unchanged without data-sheets', () => {
  const html = cr.widgetHtml(cr.copyFor(false));
  assert.ok(html.includes('✎ Request a change / ask a question'));
  assert.ok(html.includes('Type a change ("spend 1 xp to raise Streetwise") or a question ("is it worth raising DX?").'));
  assert.ok(html.includes('placeholder="Type your change or question…"'));
  assert.ok(html.includes('💬 History'));
  const c = cr.copyFor(false);
  assert.strictEqual(c.empty, 'Type your request first.');
  assert.strictEqual(c.received, 'Request received.');
  assert.strictEqual(c.live, '✓ your change is live');
});

test('sheets-off widget asks a question and mentions no sheet or change', () => {
  const html = cr.widgetHtml(cr.copyFor(true));
  assert.ok(html.includes('>Ask the GM</button>'), 'toggle button');
  assert.ok(html.includes('placeholder="Your question for the GM"'), 'placeholder');
  assert.ok(!/sheet|change|\bxp\b|raise/i.test(html), 'no sheet-edit wording in markup');
  for (const [k, v] of Object.entries(cr.copyFor(true))) {
    assert.ok(!/sheet|change/i.test(v), `copy.${k} has no sheet wording`);
  }
  assert.ok(!/sheet|change/i.test(cr.GONE_TEXT), 'expiry message has no sheet wording');
  assert.ok(html.includes('class="cr-send"') && html.includes('class="cr-text"'), 'same form controls');
});

test('widget reads data-sheets once and posts the same payload shape', () => {
  const src = readSrc();
  assert.ok(src.includes("root.dataset.sheets === 'off'"));
  assert.ok(src.includes('JSON.stringify({ code: code, character: character, text: text })'));
});
