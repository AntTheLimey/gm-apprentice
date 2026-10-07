const { describe, it } = require('node:test');
const assert = require('node:assert');
const { pcTemplate } = require('../../lib/templates/pc');
const { siteLook } = require('../../lib/skins');

const noop = () => '';
const cfg = { siteTitle: 'S', footer: '' };
const mkPage = (fm = {}) => ({
  frontmatter: { type: 'pc', player_name: 'X', ...fm }, displayTitle: 'Jane "J" Ashford', outputPath: 'pcs/jane.html', title: 'Jane',
});
const imageMap = { 'jane.png': { relPath: 'jane.png' } };
const render = (page, context = {}, map = {}) =>
  pcTemplate(page, { html: '', relationships: '' }, [], noop, cfg, map, undefined, context);
const withLook = (publish, extra = {}) => ({ publishConfig: { sheetLook: siteLook(publish), ...extra } });

describe('pcTemplate: look wiring', () => {
  it('no look set: today\'s markup, no hooks', () => {
    const h = render(mkPage({ portrait: 'jane.png' }), {}, imageMap);
    assert.match(h, /<main class="content">\n/);
    assert.doesNotMatch(h, /skins\.css|sk-portrait|data-skin/);
    assert.match(h, /<img class="hero-cinematic-img"/);
  });
  it('frame none and skin plain: today\'s markup', () => {
    const plain = render(mkPage({ portrait: 'jane.png' }), {}, imageMap);
    const h = render(mkPage({ portrait: 'jane.png' }), withLook({ sheet_skin: 'plain', sheet_frame: 'none' }), imageMap);
    assert.strictEqual(h, plain);
  });
  it('a real portrait under a frame is the square framed block, alt kept, no tall image', () => {
    const h = render(mkPage({ portrait: 'jane.png' }), withLook({ sheet_frame: 'ring' }), imageMap);
    assert.match(h, /<div class="hero-cinematic hero-cinematic-framed">/);
    assert.match(h, /data-frame="ring"/);
    assert.match(h, /<img src="[^"]*jane\.png" alt="Jane &quot;J&quot; Ashford">/);
    assert.doesNotMatch(h, /hero-cinematic-img/);
    assert.match(h, /<div class="hero-cinematic-overlay">/);
  });
  it('no portrait under a frame: framed initials', () => {
    const h = render(mkPage(), withLook({ sheet_frame: 'hex' }));
    assert.match(h, /hero-cinematic-framed/);
    assert.match(h, /<span class="sk-initials">/);
    assert.doesNotMatch(h, /hero-cinematic-no-img/);
  });
  it('a dressed page carries data-skin and links skins.css; a PC value beats the site', () => {
    const h = render(mkPage({ sheet_skin: 'ledger' }), withLook({ sheet_skin: 'console' }));
    assert.match(h, /<main class="content" data-skin="ledger">/);
    assert.match(h, /href="\.\.\/css\/skins\.css"/);
  });
  it('reports the look to the build', () => {
    const seen = [];
    const page = mkPage({ sheet_frame: 'thorns' });
    render(page, { ...withLook({}), onLook: (look, p) => seen.push([look, p]) });
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0][0].frame, 'thorns');
    assert.strictEqual(seen[0][1], page);
  });
  describe('CoC portrait slot', () => {
    const slot = '<div class="sheet"><img class="portrait" data-portrait></div>';
    const coc = (publish, extra = {}) => render(mkPage({ portrait: 'jane.png' }),
      { systemSheetHtml: slot, ...withLook(publish, { system: 'coc-7e', ...extra }) }, imageMap);
    it('frame none keeps the tall photograph slot', () => {
      const h = coc({ sheet_frame: 'none' });
      assert.match(h, /<img class="portrait" src="[^"]*jane\.png" alt="Jane &quot;J&quot; Ashford">/);
      assert.doesNotMatch(h, /sk-portrait/);
    });
    it('a frame replaces the slot with the framed block', () => {
      const h = coc({ sheet_frame: 'laurel' });
      assert.match(h, /<div class="sheet"><div class="pc-portrait sk-portrait" data-frame="laurel">/);
      assert.match(h, /alt="Jane &quot;J&quot; Ashford"/);
      assert.doesNotMatch(h, /data-portrait/);
    });
  });
});
