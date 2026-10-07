const { describe, it } = require('node:test');
const assert = require('node:assert');
const { framedPortrait } = require('../../lib/skins/portrait');
const { baseShell } = require('../../lib/templates/base');

describe('skins: framedPortrait', () => {
  it('frames initials when there is no picture', () => {
    const h = framedPortrait({ frame: 'ring', imgUrl: '', alt: 'Karl Brenner', initials: 'KB' });
    assert.match(h, /^<div class="pc-portrait sk-portrait" data-frame="ring">/);
    assert.match(h, /<div class="sk-pic" style="clip-path:circle\(50%\)"><span class="sk-initials">KB<\/span><\/div>/);
    assert.match(h, /<svg class="sk-frame" viewBox="0 0 120 120" aria-hidden="true" focusable="false">/);
  });
  it('frames a picture and keeps its alt text', () => {
    const h = framedPortrait({ frame: 'hex', imgUrl: '../../images/a b.png', alt: 'Jane "J" Ashford', initials: 'JA' });
    assert.match(h, /<img src="\.\.\/\.\.\/images\/a b\.png" alt="Jane &quot;J&quot; Ashford">/);
    assert.doesNotMatch(h, /sk-initials/);
  });
  it('escapes initials', () => {
    assert.match(framedPortrait({ frame: 'ring', imgUrl: '', alt: 'x', initials: '<b' }), /&lt;b/);
  });
});

describe('baseShell: skin hooks', () => {
  const base = { title: 'T', siteTitle: 'S', cssHref: '../../css/style.css', navHtml: '<nav></nav>', rootHref: '../../', content: '<p>x</p>' };
  it('is unchanged when the hooks are absent', () => {
    const html = baseShell(base);
    assert.match(html, /<main class="content">\n/);
    assert.doesNotMatch(html, /skins\.css/);
    assert.strictEqual(baseShell({ ...base, mainAttrs: '', extraCss: [] }), html);
  });
  it('writes the attribute and links extra CSS after theme.css', () => {
    const html = baseShell({ ...base, mainAttrs: ' data-skin="ledger"', extraCss: ['../../css/skins.css'], overridesCss: true });
    assert.match(html, /<main class="content" data-skin="ledger">/);
    const order = ['css/style.css', 'css/theme.css', 'css/skins.css', 'css/overrides.css'].map(f => html.indexOf(f));
    assert.deepStrictEqual([...order].sort((a, b) => a - b), order);
    assert.ok(order.every(i => i > 0));
  });
});
