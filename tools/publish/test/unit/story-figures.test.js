const { describe, it } = require('node:test');
const assert = require('node:assert');
const { figureCandidates, paragraphsOf, mentionsOf, placeFigures, figuresHtml } = require('../../lib/story-figures');
const { createMarks, renderMarks, withoutMarked } = require('../../lib/gm-marks');

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

  it('a hidden alias names nothing in the recap; a hidden portrait gives no picture', () => {
    const p = page('Mara', { aliases: ['Meg'] });
    assert.deepEqual(mentions(cand(p, { excludeFields: ['aliases'] }), '<p>Then Meg left.</p>'), []);
    assert.deepEqual(mentions(cand(page('Mara', { aliases: ['Meg'], publish_exclude_fields: ['aliases'] })), '<p>Then Meg left.</p>'), []);
    assert.deepEqual(figureCandidates([p], { imageMap, excludeFields: ['portrait'] }), []);
    assert.deepEqual(figureCandidates([page('Mara', { publish_exclude_fields: ['portrait'] })], { imageMap }), []);
    // A field override that re-admits the field brings it back.
    assert.equal(figureCandidates([p], { imageMap, excludeFields: ['portrait'], overridesOf: () => ({ include: ['portrait'] }) }).length, 1);
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

  it('a mark carried across blocks keeps its own label, not another mark\'s', () => {
    const marks = createMarks();
    const seen = marks.open('gm_aliases', 'gm_aliases; players see: Vex');
    const gm = marks.open('gm_only', 'gm only');
    const html = `<p>The ${seen}Elias${marks.close()} came.</p><p>${gm}</p><p>Hidden.</p><p>${marks.close()}</p><p>After.</p>`;
    assert.deepEqual(paras(html, { marks }).map((p) => p.text), ['The Vex came.', '', '', '', 'After.']);
  });

  it('a mark labelled with what players see leaves those words', () => {
    const marks = createMarks();
    const open = marks.open('gm_aliases', 'gm_aliases; players see: Vex');
    assert.equal(paras(`<p>The ${open}Elias${marks.close()} came.</p>`, { marks })[0].text, 'The Vex came.');
  });
});

describe('placeFigures', () => {
  const [A, B, C] = ['Alpha', 'Bravo', 'Charlie'].map((t) => cand(page(t)));
  const place = (cs, html, options) => placeFigures(cs, paras(html), options);
  const titles = (map) => Object.fromEntries([...map].map(([k, v]) => [k, v.map((c) => c.title)]));

  it('two per paragraph; the third goes to its next mention', () => {
    const out = place([A, B, C], '<p>Alpha, Bravo and Charlie.</p><p>Nobody.</p><p>Charlie again.</p>');
    assert.deepEqual(titles(out), { 0: ['Alpha', 'Bravo'], 2: ['Charlie'] });
  });

  it('left out when no mention has room; never beside a paragraph that does not name it', () => {
    const out = place([A, B, C], '<p>Alpha, Bravo and Charlie.</p><p>Nobody.</p>');
    assert.deepEqual(titles(out), { 0: ['Alpha', 'Bravo'] });
    assert.ok(![...out.values()].flat().includes(C));
  });

  it('first mention order decides, then position in the paragraph, then title', () => {
    assert.deepEqual(titles(place([A, B], '<p>Bravo met Alpha.</p>')), { 0: ['Bravo', 'Alpha'] });
    assert.deepEqual(titles(place([B, A, C], '<p>Charlie later.</p><p>Bravo and Alpha.</p>')), { 0: ['Charlie'], 1: ['Bravo', 'Alpha'] });
    const x = cand(page('Xavier'));
    const y = cand(page('Yves', { aliases: ['Xavier'] }));
    assert.deepEqual(titles(place([y, x], '<p>Xavier.</p>')), { 0: ['Xavier', 'Yves'] });
  });

  it('a paragraph with an <img> takes none', () => {
    const out = place([A], '<p>Alpha <img src="a.png"></p><p>Alpha.</p>');
    assert.deepEqual(titles(out), { 1: ['Alpha'] });
  });

  it('a taken key is skipped', () => {
    assert.equal(place([A], '<p>Alpha.</p>', { taken: new Set(['a.png']) }).size, 0);
    const other = cand(page('Other', { portrait: 'b.png' }));
    assert.deepEqual(titles(place([A, other], '<p>Alpha and Other.</p>', { taken: new Set(['a.png']) })), { 0: ['Other'] });
  });

  it('perParagraph can be changed', () => {
    assert.deepEqual(titles(place([A, B, C], '<p>Alpha Bravo Charlie.</p>', { perParagraph: 3 })), { 0: ['Alpha', 'Bravo', 'Charlie'] });
  });

  it('a title inside another page\'s title: both are placed once, never twice', () => {
    const goodwin = cand(page('Goodwin'));
    const peter = cand(page('Peter Goodwin'));
    const out = place([goodwin, peter], '<p>Peter Goodwin smiled.</p>');
    assert.deepEqual(titles(out), { 0: ['Peter Goodwin', 'Goodwin'] });
    assert.equal([...out.values()].flat().length, 2);
  });

  it('a recap with no paragraph places nothing', () => {
    assert.equal(place([A], '<ul><li>Alpha</li></ul><blockquote><p>Alpha</p></blockquote>').size, 0);
  });
});

describe('figuresHtml', () => {
  // How deep inside GM marks each `story-figures` float sits in the rendered GM page.
  const markDepthAtFloats = (html) => {
    const out = [];
    const stack = [];
    for (const m of html.matchAll(/<(\/?)(div|span)\b([^>]*)>/g)) {
      if (m[1]) { stack.pop(); continue; }
      if (/class="story-figures/.test(m[3])) out.push(stack.filter(Boolean).length);
      stack.push(/gm-mark/.test(m[3]));
    }
    return out;
  };

  it('a GM mark still open at the placed paragraph is closed before the float and opened again inside the paragraph', () => {
    const marks = createMarks();
    const open = marks.open('gm_only', 'gm only');
    const recap = `<p>${open}</p><p>Hidden words${marks.close()} and Alpha came.</p>`;
    const paragraphs = paras(recap, { marks });
    const A = cand(page('Alpha'));
    const placement = placeFigures([A], paragraphs);
    assert.deepEqual([...placement.keys()], [1]);
    const out = figuresHtml(recap, placement, { fromPath: 'story/s1.html', imageMap, paragraphs });
    assert.ok(out.includes(`\uE002<div class="story-figures">`), out);
    assert.ok(out.includes(`</div><p>${open}Hidden words`), out);
    assert.deepEqual(markDepthAtFloats(renderMarks(out, marks)), [0]);
    // Players see the same words, with nothing left over from the mark.
    const words = (html) => withoutMarked(html, marks).replace(/<div class="story-figures">[\s\S]*<\/div>/, '').replace(/<[^>]*>/g, '');
    assert.equal(words(out), words(recap));
  });

  it('with no mark open the float goes straight before the paragraph', () => {
    const recap = '<p>Alpha came.</p>';
    const paragraphs = paras(recap);
    const out = figuresHtml(recap, placeFigures([cand(page('Alpha'))], paragraphs), { fromPath: 'story/s1.html', imageMap, paragraphs });
    assert.match(out, /^<div class="story-figures"><figure[\s\S]*<\/figure><\/div><p>Alpha came\.<\/p>$/);
  });
});
