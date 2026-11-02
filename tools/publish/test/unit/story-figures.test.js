const { describe, it } = require('node:test');
const assert = require('node:assert');
const { figureCandidates, paragraphsOf, mentionsOf } = require('../../lib/story-figures');
const { createMarks } = require('../../lib/gm-marks');

const imageMap = { 'a.png': { relPath: 'a.png' }, 'b.png': { relPath: 'b.png' } };
const page = (title, fm = {}, extra = {}) => ({ displayTitle: title, outputPath: `npcs/${title.toLowerCase().replace(/\W+/g, '-')}.html`, frontmatter: { type: 'npc', portrait: 'a.png', ...fm }, ...extra });
const cand = (p, options = {}) => figureCandidates([p], { imageMap, ...options })[0];
const paras = (html, options = {}) => paragraphsOf(html, { fromPath: 'story/s1.html', ...options });
const mentions = (c, html) => mentionsOf(c, paras(html));

describe('figureCandidates', () => {
  it('a candidate has its key, output path, title, terms and place flag', () => {
    const c = cand(page('Peter Goodwin', { aliases: ['Pete', 'peter goodwin'] }));
    assert.deepEqual(c, { page: c.page, key: 'a.png', outputPath: 'npcs/peter-goodwin.html', title: 'Peter Goodwin', terms: ['Peter Goodwin', 'Pete'], place: false });
    assert.equal(cand(page('The Rook', { type: 'location' })).place, true);
    assert.equal(cand(page('The Rook', { type: 'faction' })).place, true);
    assert.equal(cand(page('The Rook', { type: 'item' })).place, true);
  });

  it('gm_aliases never count; an alias hidden by hide.fields never counts', () => {
    const p = page('Mara', { aliases: ['Meg'], gm_aliases: ['The Widow'] });
    assert.deepEqual(cand(p).terms, ['Mara', 'Meg']);
    assert.deepEqual(cand(p, { excludeFields: ['aliases'] }).terms, ['Mara']);
    assert.deepEqual(cand(p, { excludeFields: ['aliases'], overridesOf: () => ({ include: ['aliases'] }) }).terms, ['Mara', 'Meg']);
    assert.deepEqual(cand(page('Mara', { aliases: 'Meg', publish_exclude_fields: ['aliases'] })).terms, ['Mara']);
  });

  it('PCs, pages with no portrait, a portrait the build has no file for, a web-address portrait and excluded pages are not candidates', () => {
    const own = page('Own');
    const pages = [
      page('Six', { type: 'pc' }),
      page('Bare', { portrait: undefined }),
      page('Lost', { portrait: 'nope.png' }),
      page('Web', { portrait: 'https://example.com/a.png' }),
      own,
      page('Fine', { portrait: '[[b.png]]'.replace(/\[|\]/g, '') }),
    ];
    const out = figureCandidates(pages, { imageMap, exclude: new Set([own]) });
    assert.deepEqual(out.map((c) => c.title), ['Fine']);
    assert.equal(out[0].key, 'b.png');
  });

  it('a PC is not a candidate even when exclude_fields hides its type', () => {
    const p = page('Six', { type: 'pc' });
    p.sourceFrontmatter = p.frontmatter;
    p.frontmatter = { portrait: 'a.png' };
    assert.deepEqual(figureCandidates([p], { imageMap }), []);
  });

  it('on the GM site only pages the player site publishes count', () => {
    const a = page('Alpha');
    const b = page('Beta');
    assert.deepEqual(figureCandidates([a, b], { imageMap, onPlayerSite: new Set([b]) }).map((c) => c.title), ['Beta']);
  });
});

describe('mentionsOf', () => {
  it('a link counts; a title and an alias count as whole words, any case for two-word names', () => {
    const p = page('Peter Goodwin', { aliases: ['Meg'] });
    const c = cand(p);
    assert.deepEqual(mentions(c, '<p>They met peter goodwin at dusk.</p>'), [{ para: 0, at: 9 }]);
    assert.deepEqual(mentions(c, '<p>Then Meg left.</p>'), [{ para: 0, at: 5 }]);
    assert.deepEqual(mentions(c, '<p>See <a href="../npcs/peter-goodwin.html#top">the old man</a>.</p>'), [{ para: 0, at: 4 }]);
    assert.deepEqual(mentions(c, '<p>See <a href="../npcs/other.html">Peter</a>.</p>'), []);
    assert.deepEqual(mentions(c, '<p>Nothing here.</p>'), []);
  });

  it('a link href that is percent-encoded or outside the site still resolves or is ignored', () => {
    const c = cand(page('Dr Who'));
    assert.deepEqual(mentions(c, '<p><a href="../npcs/dr-who.html">x</a> <a href="https://x.org/npcs/dr-who.html">y</a></p>'), [{ para: 0, at: 0 }]);
    const sp = cand({ ...page('Zed'), outputPath: 'npcs/a b.html' });
    assert.deepEqual(mentions(sp, '<p>x <a href="../npcs/a%20b.html">link</a></p>'), [{ para: 0, at: 2 }]);
  });

  it('a one-word name counts only capitalised', () => {
    const c = cand(page('Six'));
    assert.equal(mentions(c, "<p>Six's plan</p>").length, 1);
    assert.equal(mentions(c, '<p>Six ran</p>').length, 1);
    assert.equal(mentions(c, '<p>six guards</p>').length, 0);
    assert.equal(mentions(c, '<p>Sixty guards</p>').length, 0);
    assert.equal(mentions(c, '<p>SIX guards</p>').length, 0);
  });

  it('names inside punctuation, emphasis and possessives, and a name shorter than two characters', () => {
    assert.equal(mentions(cand(page('Monroe')), '<p>Then, "Monroe," said he.</p>').length, 1);
    assert.equal(mentions(cand(page('Albatross')), '<p>The <em>Albatross</em>.</p>').length, 1);
    assert.equal(mentions(cand(page('Albatross')), '<p>The <em>Albatross</em>.</p>')[0].at, 4);
    assert.equal(mentions(cand(page('X')), '<p>X marks it.</p>').length, 0);
    assert.equal(mentions(cand(page('Élodie')), '<p>Élodie came.</p>').length, 1);
    assert.equal(mentions(cand(page('Lodie')), '<p>Élodie came.</p>').length, 0);
  });

  it('a page named by title and alias in one paragraph has one mention there, at the earliest', () => {
    const c = cand(page('Peter Goodwin', { aliases: ['Pete'] }));
    assert.deepEqual(mentions(c, '<p>Pete said Peter Goodwin was late.</p>'), [{ para: 0, at: 0 }]);
    assert.deepEqual(mentions(c, '<p>One.</p><p>Pete and Peter Goodwin.</p><p>Pete.</p>'), [{ para: 1, at: 0 }, { para: 2, at: 0 }]);
  });

  it('entities are decoded and tags stripped before reading', () => {
    const c = cand(page("O'Neil"));
    assert.deepEqual(mentions(c, '<p>&amp; <strong>O&#39;Neil</strong> &amp; co</p>'), [{ para: 0, at: 2 }]);
  });

  it('a candidate with a set of hrefs is linked by any of them', () => {
    const c = { terms: [], hrefs: new Set(['places/a.html', 'places/b.html']) };
    assert.deepEqual(mentions(c, '<p>x</p><p><a href="../places/b.html">B</a></p>'), [{ para: 1, at: 0 }]);
  });
});

describe('paragraphsOf', () => {
  it('top-level paragraphs only, numbered among the top-level elements', () => {
    const out = paras('<h3>Day</h3><p>One <a href="../npcs/x.html#a?b">x</a></p>\n<ul><li>List</li></ul><p>Two <img src="a.png"></p><blockquote><p>Quote</p></blockquote>');
    assert.deepEqual(out.map((p) => [p.block, p.text, p.hasImage]), [[1, 'One x', false], [3, 'Two ', true]]);
    assert.deepEqual([...out[0].hrefs], ['npcs/x.html']);
  });

  it('a recap with no paragraph, or only lists, blockquotes and tables, has none', () => {
    assert.deepEqual(paras('<ul><li>Mara went.</li></ul><blockquote><p>Mara spoke.</p></blockquote><table><tr><td>Mara</td></tr></table>'), []);
    assert.deepEqual(paras(''), []);
    assert.deepEqual(paras(null), []);
  });

  it('marked text is not read on the GM site', () => {
    const marks = createMarks();
    const open = marks.open('withheld_names', 'withheld_names');
    const c = cand(page('Vex'));
    const html = `<p>Before ${open}Vex${marks.close()} after.</p><p>Plain Vex.</p>`;
    assert.deepEqual(mentionsOf(c, paras(html, { marks })), [{ para: 1, at: 6 }]);
    assert.equal(paras(html, { marks })[0].text, 'Before  after.');
  });

  it('a mark that runs across blocks drops the blocks inside it, and block numbers stay true', () => {
    const marks = createMarks();
    const open = marks.open('gm_only', 'gm only');
    const html = `<p>Keep.</p><p>${open}</p><p>Vex hidden <a href="../npcs/vex.html">v</a></p><p>${marks.close()}</p><p>Vex shown.</p>`;
    const out = paras(html, { marks });
    assert.deepEqual(out.map((p) => [p.block, p.text]), [[0, 'Keep.'], [1, ''], [2, ''], [3, ''], [4, 'Vex shown.']]);
    assert.equal(out[2].hrefs.size, 0);
    assert.deepEqual(mentionsOf(cand(page('Vex')), out), [{ para: 4, at: 0 }]);
  });

  it('a mark labelled with what players see leaves those words', () => {
    const marks = createMarks();
    const open = marks.open('gm_aliases', 'gm_aliases; players see: Vex');
    assert.equal(paras(`<p>The ${open}Elias${marks.close()} came.</p>`, { marks })[0].text, 'The Vex came.');
  });
});
