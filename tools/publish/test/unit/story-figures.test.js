const { describe, it } = require('node:test');
const assert = require('node:assert');
const { figureCandidates, paragraphsOf, mentionsOf, placeFigures, figuresHtml, withFigures, pageNames, nameHolders, scenePicture, sceneCandidates } = require('../../lib/story-figures');
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

  it('an alias beginning with "The" is a description: a link counts, the words do not; a title beginning with "The" still counts', () => {
    const p = page('Hooghly', { type: 'location', aliases: ['The River', 'the capital', 'THE STATION', 'Theodora', 'Ganga'] });
    assert.deepEqual(cand(p).terms, ['Hooghly', 'Theodora', 'Ganga']);
    assert.deepEqual(mentions(cand(p), '<p>They crossed The River.</p>'), []);
    assert.deepEqual(mentions(cand(p), '<p>They crossed <a href="../npcs/hooghly.html">The River</a>.</p>'), [{ para: 0, at: 13 }]);
    assert.deepEqual(mentions(cand(page('The Auberge')), '<p>At The Auberge.</p>'), [{ para: 0, at: 3 }]);
    assert.deepEqual(pageNames([p], {}).get(p.outputPath), ['Hooghly', 'Theodora', 'Ganga']);
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

  it('a one-word alias that is the first name of another page in the recap is not a mention of this one; a link or its title still is (#628)', () => {
    const clara = cand(page('Clara Fen', { aliases: ['Anna'] }));
    const anna = nameHolders([page('Anna Lindqvist')], {})[0];
    const others = { lists: [[clara], [anna]] };
    const ofClara = (html) => mentionsOf(clara, paras(html), others);
    // The other Anna is in the recap (by her full name, or by a link): unlinked "Anna" is hers or Clara's, so it names neither.
    assert.deepEqual(ofClara('<p>Adler was grooming Anna.</p><p>Anna Lindqvist left.</p>'), []);
    assert.deepEqual(ofClara('<p>Adler was grooming Anna.</p><p><a href="../npcs/anna-lindqvist.html">She</a> left.</p>'), []);
    // She is not in this recap, or not on the site: "Anna" is Clara's alias as ever.
    assert.deepEqual(ofClara('<p>Adler was grooming Anna.</p>'), [{ para: 0, at: 19 }]);
    assert.deepEqual(ofClara('<p>Adler met Clara Fen.</p><p>Anna Lindqvist left.</p>'), [{ para: 0, at: 10 }]);
    assert.deepEqual(ofClara('<p>Adler met <a href="../npcs/clara-fen.html">Anna</a>.</p><p>Anna Lindqvist left.</p>'), [{ para: 0, at: 10 }]);
    // Her title is her name even when another page's first word is the same.
    const six = cand(page('Six'));
    assert.equal(mentionsOf(six, paras('<p>Six ran.</p><p>Six Pack came.</p>'), nameHolders([page('Six Pack')], {})).length, 1);
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

  it('straight and curled quotes match each other (the recap is typeset with curled ones), at the same offsets', () => {
    assert.deepEqual(mentions(cand(page("O'Hara")), '<p>Then O’Hara came.</p>'), [{ para: 0, at: 5 }]);
    assert.deepEqual(mentions(cand(page('O’Hara')), "<p>Then O'Hara came.</p>"), [{ para: 0, at: 5 }]);
    assert.deepEqual(mentions(cand(page('The “Rook” Inn')), '<p>At the "Rook" Inn.</p>'), [{ para: 0, at: 3 }]);
    assert.deepEqual(mentions(cand(page('The "Rook" Inn')), '<p>At the “Rook” Inn.</p>'), [{ para: 0, at: 3 }]);
    assert.deepEqual(mentions(cand(page("O'Hara")), '<p>‘Quiet,’ said O’Hara.</p>'), [{ para: 0, at: 14 }]);
  });

  it('a name inside the words of a link to another page is not a mention; inside a link to the page itself it is', () => {
    const station = cand(page('MacMillian Station IV', { type: 'location', aliases: ['MacMillian Station'] }));
    const hq = '<a href="../locations/macmillian-station-security-hq.html">MacMillian Station security HQ</a>';
    assert.deepEqual(mentions(station, `<p>Six went to ${hq}.</p>`), []);
    assert.deepEqual(mentions(station, `<p>Six went to <em>${hq}</em>.</p>`), []);
    // Outside the link, in the same paragraph, the name still counts.
    assert.deepEqual(mentions(station, `<p>Six went to ${hq} on MacMillian Station.</p>`), [{ para: 0, at: 46 }]);
    // A link to the page itself counts, by its words and as a link.
    assert.deepEqual(mentions(station, '<p>Six went to <a href="../npcs/macmillian-station-iv.html">MacMillian Station</a>.</p>'), [{ para: 0, at: 12 }]);
    // A link off the site is not a page: a name in its words still counts.
    assert.deepEqual(mentions(station, '<p>See <a href="https://example.com/">MacMillian Station</a>.</p>'), [{ para: 0, at: 4 }]);
    // A scene is linked by any of its pages: one of its names inside a link to another of them still counts for it.
    const scene = { ...station, outputPath: null, hrefs: new Set(['npcs/macmillian-station-iv.html', 'locations/macmillian-station-security-hq.html']), scene: true };
    assert.deepEqual(mentions(scene, `<p>Six went to ${hq}.</p>`), [{ para: 0, at: 12 }]);
  });

  it('link words are found where they stand in the text the names are read in, after decomposed letters are composed', () => {
    const station = cand(page('MacMillian Station IV', { type: 'location', aliases: ['MacMillian Station'] }));
    const decomposed = (n) => 'Café '.repeat(n);   // "Café", the accent a mark of its own: one letter fewer once composed
    const hq = '<a href="../locations/macmillian-station-security-hq.html">MacMillian Station security HQ</a>';
    assert.deepEqual(mentions(station, `<p>${decomposed(3)}${hq}.</p>`), []);
    // A plain mention just after a link to another page still counts.
    const office = '<a href="../locations/office.html">the security office of the station</a>';
    assert.deepEqual(mentions(station, `<p>${decomposed(20)}${office} MacMillian Station.</p>`), [{ para: 0, at: 135 }]);
    // A link's offset is where its words start in the same text.
    assert.deepEqual(mentions(station, `<p>${decomposed(3)}<a href="../npcs/macmillian-station-iv.html">it</a>.</p>`), [{ para: 0, at: 15 }]);
  });

  it('a page whose address is decomposed is still linked by its own links', () => {
    const nfc = 'locations/château-noir.html';
    const chateau = { ...cand(page('Château Noir', { type: 'location' })), outputPath: nfc.normalize('NFD') };
    assert.deepEqual(mentions(chateau, '<p>Six went to <a href="../locations/château-noir.html">the house</a>.</p>'), [{ para: 0, at: 12 }]);
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

  it('longest match wins: a name lying wholly inside a longer name of another page does not count there', () => {
    const goodwin = cand(page('Goodwin'));
    const peter = cand(page('Peter Goodwin'));
    assert.deepEqual(titles(place([goodwin, peter], '<p>Peter Goodwin smiled.</p>')), { 0: ['Peter Goodwin'] });
    // Elsewhere in the paragraph, or in another paragraph, the shorter name still counts.
    assert.deepEqual(titles(place([goodwin, peter], '<p>Peter Goodwin smiled at Goodwin.</p>')), { 0: ['Peter Goodwin', 'Goodwin'] });
    assert.deepEqual(titles(place([goodwin, peter], '<p>Peter Goodwin smiled.</p><p>Goodwin left.</p>')), { 0: ['Peter Goodwin'], 1: ['Goodwin'] });
    // The real case: an alias inside another page's title.
    const james = cand(page('James Pelham', { aliases: ['Pelham'] }));
    const anne = cand(page('Lady Anne Pelham', { portrait: 'b.png' }));
    assert.deepEqual(titles(place([james, anne], '<p>Lady Anne Pelham poured.</p>')), { 0: ['Lady Anne Pelham'] });
    // A link always counts.
    assert.deepEqual(titles(place([james, anne], '<p>Lady Anne Pelham poured for <a href="../npcs/james-pelham.html">him</a>.</p>')), { 0: ['Lady Anne Pelham', 'James Pelham'] });
    // Without the longer page among the candidates, the shorter name counts.
    assert.deepEqual(titles(place([james], '<p>Lady Anne Pelham poured.</p>')), { 0: ['James Pelham'] });
  });

  it('longest match wins against the name of every page players see, portrait or not, PCs too', () => {
    const james = cand(page('James Pelham', { aliases: ['Pelham'] }));
    const anne = page('Lady Anne Pelham', { portrait: undefined });
    const pc = page('Ned Pelham Junior', { type: 'pc', portrait: undefined });
    const hidden = page('Mrs Pelham Smith', { portrait: undefined });
    const holders = nameHolders([anne, pc, hidden, james.page], { onPlayerSite: new Set([anne, pc, james.page]) });
    assert.deepEqual(holders.map((h) => h.terms), [['Lady Anne Pelham'], ['Ned Pelham Junior'], ['James Pelham', 'Pelham']]);
    const draw = (recap) => withFigures(recap, { candidates: [james], blockers: holders, fromPath: 'story/s1.html', imageMap });
    assert.ok(!draw('<p>Lady Anne Pelham arrived.</p>').includes('<figure'));
    assert.ok(!draw('<p>Ned Pelham Junior arrived.</p>').includes('<figure'));
    // A page players do not see names nothing; the candidate's own names never block it.
    assert.ok(draw('<p>Mrs Pelham Smith arrived.</p>').includes('<figcaption>James Pelham</figcaption>'));
    assert.ok(draw('<p>James Pelham arrived.</p>').includes('<figcaption>James Pelham</figcaption>'));
    // An alias beginning with "The" names nothing here either.
    const desc = nameHolders([page('Gatehouse', { aliases: ['The Pelham Arms'], portrait: undefined })]);
    assert.ok(withFigures('<p>The Pelham Arms.</p>', { candidates: [james], blockers: desc, fromPath: 'story/s1.html', imageMap }).includes('<figure'));
  });

  it('two pages with the same name both count', () => {
    const x = cand(page('Xavier'));
    const y = cand(page('Yves', { aliases: ['Xavier'] }));
    assert.deepEqual(titles(place([x, y], '<p>Xavier.</p>')), { 0: ['Xavier', 'Yves'] });
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

describe('scenePicture', () => {
  it('the first embed after the H1, before the first heading', () => {
    assert.equal(scenePicture('# Docks\n\nThe tide ![[a.png]] and ![[b.png]].\n\n## GM Notes\n\n![[c.png]]\n'), 'a.png');
    assert.equal(scenePicture('# Docks\n\n![[a.png|The pier]]\n'), 'a.png');
    assert.equal(scenePicture('\n\n# Docks\n\n![[a.png]]\n'), 'a.png');
    assert.equal(scenePicture('# Docks\n\n![[Some note]] ![[a.svg]]\n'), 'a.svg');
  });

  it('skips one in a gm-only fence, a %% comment or a callout', () => {
    assert.equal(scenePicture('# D\n\n<!-- gm-only -->\n![[x.png]]\n<!-- /gm-only -->\n\n![[a.png]]\n'), 'a.png');
    assert.equal(scenePicture('# D\n\n%% ![[x.png]] %%\n\n![](a.png)\n'), 'a.png');
    assert.equal(scenePicture('# D\n\n%%\n![[x.png]]\n%%\n\n![[a.png]]\n'), 'a.png');
    assert.equal(scenePicture('# D\n\n> [!note] Keeper\n> ![[x.png]]\n\n![[a.png]]\n'), 'a.png');
  });

  it('a scene whose only picture is under GM Notes, or in a gm-only GM Notes, has none', () => {
    assert.equal(scenePicture('# D\n\n**Situation:** words.\n\n## GM Notes\n\n![[x.png]]\n'), null);
    assert.equal(scenePicture('# D\n\nWords.\n\n<!-- gm-only -->\n\n## GM Notes\n\n![[x.png]]\n\n<!-- /gm-only -->\n'), null);
    assert.equal(scenePicture(''), null);
    assert.equal(scenePicture(null), null);
  });

  it('a scene with no H1 (the template shape) reads from the top; a markdown image by its file name', () => {
    assert.equal(scenePicture('**Situation:** ![[a.png]]\n\n## GM Notes\n'), 'a.png');
    assert.equal(scenePicture('# D\n\n![x](../_attachments/my%20pic.png)\n'), 'my pic.png');
    assert.equal(scenePicture('# D\n\n![x](https://example.com/a.png)\n'), null);
    assert.equal(scenePicture('# D\n\n```\n![[x.png]]\n```\n'), null);
  });
});

describe('scenePicture: setext headings, avif and single-quoted titles', () => {
  it('a heading underlined with --- or === is a heading: a picture under it is not the scene\'s', () => {
    assert.equal(scenePicture('# D\n\nWords.\n\nGM Notes\n--------\n\n![[x.png]]\n'), null);
    assert.equal(scenePicture('# D\n\nWords.\n\nGM Notes\n===\n\n![[x.png]]\n'), null);
    assert.equal(scenePicture('# D\n\nGM Notes ![[x.png]]\n---\n'), null);
    // An H1 written with === starts the scene; a --- after a blank line is a rule, not a heading.
    assert.equal(scenePicture('Docks\n=====\n\n![[a.png]]\n'), 'a.png');
    assert.equal(scenePicture('# D\n\nWords.\n\n---\n\n![[a.png]]\n'), 'a.png');
  });

  it('an HTML heading line is a heading: a picture under it is not the scene\'s; an HTML h1 starts the scene', () => {
    assert.equal(scenePicture('# D\n\nWords.\n\n<h2>GM Notes</h2>\n![[x.png]]\n'), null);
    assert.equal(scenePicture('# D\n\n<H3 class="gm">Keeper</H3>\n\n![[x.png]]\n'), null);
    assert.equal(scenePicture('<h1>Docks</h1>\n\n![[a.png]]\n'), 'a.png');
    assert.equal(scenePicture('# D\n\n<hr>\n![[a.png]]\n'), 'a.png');
  });

  it('an avif picture counts, and a markdown image with a title in single quotes', () => {
    assert.equal(scenePicture('# D\n\n![[a.avif]]\n'), 'a.avif');
    assert.equal(scenePicture("# D\n\n![x](a.png 'The pier')\n"), 'a.png');
    assert.equal(scenePicture('# D\n\n![x](a.png "The pier")\n'), 'a.png');
  });
});

describe('sceneCandidates', () => {
  const V = '/vault';
  const note = (rel, frontmatter, body = '# Scene\n\n![[a.png]]\n') => {
    const title = rel.split('/').pop();
    return { title, displayTitle: title, vaultPath: rel, sourcePath: `${V}/${rel}.md`, frontmatter, body };
  };
  const S = 'Chapters/C1/Sessions';
  const hub1 = note(`${S}/Session 1/Session 1`, { type: 'session', chapter: '[[C1]]' }, '');
  const hub2 = note(`${S}/Session 2/Session 2`, { type: 'session', chapter: '[[C1]]' }, '');
  const wrap2 = note(`${S}/Session 2/Session 2 Wrap-Up`, { type: 'session_wrap', session: '[[Session 2]]' }, '');
  const plan1 = note(`${S}/Session 1/Session 1 Plan`, { type: 'session-plan', session: '[[Session 1]]' }, '');
  const plan2 = note(`${S}/Session 2/Session 2 Plan`, { type: 'session-plan', session: '[[Session 2]]' }, '');
  const docks = { outputPath: 'locations/the-docks.html', displayTitle: 'The Docks', frontmatter: { type: 'location', aliases: ['Docks Quarter', 'Smugglers Row'], gm_aliases: ['Smugglers Row'] } };
  const six = { outputPath: 'pcs/six.html', displayTitle: 'Six', frontmatter: { type: 'pc' } };
  const hidden = { outputPath: 'locations/vault.html', displayTitle: 'The Vault', frontmatter: { type: 'location' } };
  const names = pageNames([docks, six, hidden], { onPlayerSite: new Set([docks, six]) });
  const linkMap = { 'The Docks': docks.outputPath, 'Smugglers Row': docks.outputPath, Six: six.outputPath, 'The Vault': hidden.outputPath };
  const unit1 = { kind: 'session', sourcePage: { sourcePath: hub1.sourcePath }, wrapUpPage: null };
  const unit2 = { kind: 'session', sourcePage: { sourcePath: hub2.sourcePath }, wrapUpPage: { sourcePath: wrap2.sourcePath } };
  // A scene marked played, as a played scene in a real vault is; a test about its status sets its own.
  const scene = (rel, fm, body) => note(rel, { type: 'scene', status: 'played', locations: ['[[The Docks]]'], ...fm }, body);
  const forUnits = (notes) => {
    const of = sceneCandidates([hub1, hub2, wrap2, plan1, plan2, ...notes], { names, imageMap, linkMap });
    return [of(unit1).length, of(unit2).length];
  };

  it('pageNames: player-site pages that are not PCs, by published title and aliases, never gm_aliases', () => {
    assert.deepEqual([...names], [['locations/the-docks.html', ['The Docks', 'Docks Quarter']]]);
  });

  it('a scene is pictured by its places: no caption, a place, keyed by its picture', () => {
    const of = sceneCandidates([hub1, hub2, scene(`${S}/Session 1/Scenes/Docks`, { played_in: ['[[Session 1]]'] })], { names, imageMap, linkMap });
    const [c] = of(unit1);
    assert.deepEqual({ ...c, hrefs: [...c.hrefs] }, { key: 'a.png', outputPath: null, title: '', terms: ['The Docks', 'Docks Quarter'], hrefs: ['locations/the-docks.html'],
      pages: [{ href: 'locations/the-docks.html', terms: ['The Docks', 'Docks Quarter'] }], place: true, scene: true, words: [] });
  });

  it('played_in decides first: the session it names (index or wrap-up), even from another session\'s Scenes folder', () => {
    assert.deepEqual(forUnits([scene(`${S}/Session 1/Scenes/Docks`, { played_in: ['[[Session 2]]'] })]), [0, 1]);
    assert.deepEqual(forUnits([scene('Chapters/C1/Scenes/Docks', { played_in: ['[[Session 2 Wrap-Up]]'] })]), [0, 1]);
    assert.deepEqual(forUnits([scene('Chapters/C1/Scenes/Docks', { played_in: ['[[Session 1]]', '[[Session 2]]'] })]), [1, 1]);
  });

  it('with no played_in, a played scene: a session: link to the index or its Plan, else its session folder\'s Scenes/', () => {
    const played = { status: 'played' };
    assert.deepEqual(forUnits([scene(`${S}/Session 1/Scenes/Docks`, played)]), [1, 0]);
    assert.deepEqual(forUnits([scene(`${S}/Session 1/Scenes/Docks`, { ...played, played_in: [] })]), [1, 0]);
    assert.deepEqual(forUnits([scene(`${S}/Session 1/Scenes/Docks`, { status: ' Played ' })]), [1, 0]);
    assert.deepEqual(forUnits([scene('Chapters/C1/Scenes/Docks', { ...played, session: '[[Session 2]]' })]), [0, 1]);
    assert.deepEqual(forUnits([scene('Chapters/C1/Scenes/Docks', { ...played, session: '[[Session 1 Plan]]' })]), [1, 0]);
    assert.deepEqual(forUnits([scene('Chapters/C1/Scenes/Docks', played)]), [0, 0]);
  });

  it('a session: link beats the Scenes/ folder: a played scene re-linked to another session counts only there', () => {
    assert.deepEqual(forUnits([scene(`${S}/Session 1/Scenes/Docks`, { status: 'played', session: '[[Session 2]]' })]), [0, 1]);
  });

  it('a dropped or paused scene counts for no session', () => {
    assert.deepEqual(forUnits([scene(`${S}/Session 1/Scenes/Docks`, { status: 'dropped', played_in: ['[[Session 1]]'] })]), [0, 0]);
    assert.deepEqual(forUnits([scene(`${S}/Session 1/Scenes/Docks`, { status: 'Paused' })]), [0, 0]);
  });

  it('with no played_in, a scene not marked played counts for no session: prep linked to a Plan, or in a Scenes/ folder', () => {
    assert.deepEqual(forUnits([scene('Chapters/C1/Scenes/Docks', { status: 'ready', session: '[[Session 2 Plan]]' })]), [0, 0]);
    assert.deepEqual(forUnits([scene(`${S}/Session 2/Scenes/Docks`, { status: 'ready', session: '[[Session 2 Plan]]' })]), [0, 0]);
    for (const status of ['planned', 'modified', 'ready', '']) {
      assert.deepEqual(forUnits([scene(`${S}/Session 1/Scenes/Docks`, { status, session: '[[Session 1]]' })]), [0, 0], status);
    }
    assert.deepEqual(forUnits([scene(`${S}/Session 1/Scenes/Docks`, { status: undefined })]), [0, 0]);
    // played_in still decides for a scene whose status was never updated.
    assert.deepEqual(forUnits([scene(`${S}/Session 1/Scenes/Docks`, { status: 'ready', played_in: ['[[Session 1]]'] })]), [1, 0]);
  });

  it('no page players see among its places and people, no picture, or a picture the build lacks: nothing', () => {
    const at = `${S}/Session 1/Scenes/Docks`;
    assert.deepEqual(forUnits([scene(at, { locations: ['[[The Vault]]'], entities: ['[[Six]]'] })]), [0, 0]);
    assert.deepEqual(forUnits([scene(at, {}, '# Docks\n\nNo picture.\n')]), [0, 0]);
    assert.deepEqual(forUnits([scene(at, {}, '# Docks\n\n![[nope.png]]\n')]), [0, 0]);
    assert.deepEqual(forUnits([note(at, { type: 'npc', locations: ['[[The Docks]]'] })]), [0, 0]);
  });

  it('a scene linking a page by its gm_alias is named by the page\'s published names, never the gm_alias', () => {
    const [c] = sceneCandidates([hub1, scene(`${S}/Session 1/Scenes/Docks`, { locations: ['[[Smugglers Row]]'] })], { names, imageMap, linkMap })(unit1);
    assert.deepEqual(c.terms, ['The Docks', 'Docks Quarter']);
    assert.deepEqual([...c.hrefs], ['locations/the-docks.html']);
    assert.ok(![...names.values()].flat().includes('Smugglers Row'));
  });

  it('a scene linking by a gm_alias the link map lacks gives no candidate', () => {
    const { 'Smugglers Row': _gone, ...bare } = linkMap;
    assert.deepEqual(sceneCandidates([hub1, scene(`${S}/Session 1/Scenes/Docks`, { locations: ['[[Smugglers Row]]'], entities: [] })], { names, imageMap, linkMap: bare })(unit1), []);
  });

  it('a place linked in another case or with underscores is read by the folded name the build resolves links with', () => {
    const fold = (n) => n.toLowerCase().replace(/_/g, ' ');
    const folded = (n) => Object.entries(linkMap).find(([k]) => fold(k) === fold(n))?.[1];
    for (const link of ['[[the docks]]', '[[The_Docks]]']) {
      const notes = [hub1, scene(`${S}/Session 1/Scenes/Docks`, { locations: [link] })];
      assert.deepEqual(sceneCandidates(notes, { names, imageMap, linkMap })(unit1), [], 'without the resolver');
      const [c] = sceneCandidates(notes, { names, imageMap, linkMap, folded })(unit1);
      assert.deepEqual([...c.hrefs], ['locations/the-docks.html'], link);
    }
  });

  it('a flat Sessions folder: the Scenes/ folder rule counts only when one session index sits beside it', () => {
    const flat1 = note('Sessions/Session 1', { type: 'session' }, '');
    const flat2 = note('Sessions/Session 2', { type: 'session' }, '');
    const u = (h) => ({ kind: 'session', sourcePage: { sourcePath: h.sourcePath }, wrapUpPage: null });
    const loose = scene('Sessions/Scenes/Docks', {});
    const two = sceneCandidates([flat1, flat2, loose], { names, imageMap, linkMap });
    assert.deepEqual([two(u(flat1)).length, two(u(flat2)).length], [0, 0]);
    const one = sceneCandidates([flat1, loose], { names, imageMap, linkMap });
    assert.equal(one(u(flat1)).length, 1);
    const linked = sceneCandidates([flat1, flat2, scene('Sessions/Scenes/Docks', { session: '[[Session 2]]' })], { names, imageMap, linkMap });
    assert.deepEqual([linked(u(flat1)).length, linked(u(flat2)).length], [0, 1]);
  });

  it('its people count as well as its places; a chapter unit takes no scene', () => {
    const of = sceneCandidates([hub1, scene(`${S}/Session 1/Scenes/Docks`, { locations: [], entities: ['[[Six]]', '[[The Docks]]'] })], { names, imageMap, linkMap });
    assert.equal(of(unit1).length, 1);
    assert.deepEqual(of({ kind: 'chapter', sourcePage: { sourcePath: hub1.sourcePath } }), []);
  });

  it('the scene\'s mention is a link to or a name of one of its pages; it renders with no caption and an empty alt', () => {
    const [c] = sceneCandidates([hub1, scene(`${S}/Session 1/Scenes/Docks`, {})], { names, imageMap, linkMap })(unit1);
    assert.deepEqual(mentions(c, '<p>Then to Docks Quarter.</p>'), [{ para: 0, at: 8 }]);
    const html = withFigures('<p>Off to <a href="../locations/the-docks.html">the pier</a>.</p>', { candidates: [], scenes: [c], fromPath: 'story/s1.html', imageMap });
    assert.match(html, /<figure class="story-figure story-figure--place"><a class="story-figure__open" href="\.\.\/images\/a\.png" aria-label="Open picture"><img src="\.\.\/images\/a\.png" alt="" loading="lazy">/);
    assert.ok(!html.includes('<figcaption>'));
  });

  it('a scene whose picture is a portrait offered: one picture, beside the paragraph naming the most of the page and the scene\'s places', () => {
    const smith = { outputPath: 'npcs/old-smith.html', displayTitle: 'Old Smith', frontmatter: { type: 'npc', portrait: 'a.png' } };
    const [c] = sceneCandidates([hub1, scene(`${S}/Session 1/Scenes/Docks`, {})], { names, imageMap, linkMap })(unit1);
    const portrait = cand(smith);
    const before = { ...portrait, terms: [...portrait.terms] };
    const used = new Set();
    const html = withFigures('<p>Nothing yet.</p><p>Off to the Docks Quarter.</p><p>Old Smith waits.</p>', { candidates: [portrait], scenes: [c], fromPath: 'story/s1.html', imageMap, usedImages: used });
    assert.equal((html.match(/<figure /g) || []).length, 1);
    assert.ok(html.indexOf('<figure') < html.indexOf('Off to'), html);
    assert.deepEqual([...used], ['a.png']);
    assert.deepEqual(portrait, before);
    const own = withFigures('<p>Old Smith at the Docks Quarter.</p>', { candidates: [portrait], scenes: [c], exclude: new Set([smith]), fromPath: 'story/s1.html', imageMap });
    assert.ok(!own.includes('<figcaption>') && own.includes('alt=""'), own);
  });

  it('a merged picture beside a paragraph that names only the scene\'s pages is drawn as the scene\'s: no name of the page', () => {
    const smith = { outputPath: 'npcs/old-smith.html', displayTitle: 'Old Smith', frontmatter: { type: 'npc', portrait: 'a.png' } };
    const [c] = sceneCandidates([hub1, scene(`${S}/Session 1/Scenes/Docks`, {})], { names, imageMap, linkMap })(unit1);
    const portrait = cand(smith);
    const draw = (recap) => withFigures(recap, { candidates: [portrait], scenes: [c], fromPath: 'story/s1.html', imageMap });
    for (const recap of ['<p>Nothing yet.</p><p>Off to the Docks Quarter.</p><p>Old Smith waits.</p>', '<p>To <a href="../locations/the-docks.html">the pier</a>.</p>']) {
      const html = draw(recap);
      assert.equal((html.match(/<figure /g) || []).length, 1, html);
      assert.ok(!html.includes('Old Smith</figcaption>') && !html.includes('alt="Old Smith"'), html);
      assert.ok(!html.includes('<figcaption>') && html.includes('alt=""') && html.includes('story-figure--place'), html);
      assert.ok(html.includes('aria-label="Open picture"'), html);
    }
    // Beside a paragraph that names the page itself, it is the page's picture, under its name.
    for (const recap of ['<p>Old Smith at the Docks Quarter.</p>', '<p>Then <a href="../npcs/old-smith.html">he</a> came.</p><p>The Docks Quarter.</p>']) {
      const html = draw(recap);
      assert.ok(html.includes('<figcaption>Old Smith</figcaption>') && html.includes('alt="Old Smith"'), html);
      assert.ok(!html.includes('story-figure--place') && !html.includes('aria-label'), html);
    }
  });

  it('a merged picture whose page is named only inside another page\'s longer name is drawn as the scene\'s', () => {
    const james = { outputPath: 'npcs/james-pelham.html', displayTitle: 'James Pelham', frontmatter: { type: 'npc', portrait: 'a.png', aliases: ['Pelham'] } };
    const anne = cand({ outputPath: 'npcs/lady-anne-pelham.html', displayTitle: 'Lady Anne Pelham', frontmatter: { type: 'npc', portrait: 'b.png' } });
    const [c] = sceneCandidates([hub1, scene(`${S}/Session 1/Scenes/Docks`, {})], { names, imageMap, linkMap })(unit1);
    const html = withFigures('<p>Lady Anne Pelham at the Docks Quarter.</p>', { candidates: [cand(james), anne], scenes: [c], fromPath: 'story/s1.html', imageMap });
    assert.equal((html.match(/<figure /g) || []).length, 2, html);
    assert.ok(!html.includes('James Pelham') && html.includes('<figcaption>Lady Anne Pelham</figcaption>'), html);
  });

  describe('where a scene\'s picture goes', () => {
    const rook = { outputPath: 'npcs/captain-rook.html', displayTitle: 'Captain Rook', frontmatter: { type: 'npc' } };
    const bay = { outputPath: 'locations/the-bay.html', displayTitle: 'The Bay', frontmatter: { type: 'location' } };
    const more = pageNames([docks, rook, bay], {});
    const links = { ...linkMap, 'Captain Rook': rook.outputPath, 'The Bay': bay.outputPath };
    const sceneWith = (key, ...places) => {
      const [c] = sceneCandidates([hub1, scene(`${S}/Session 1/Scenes/${key}`, { locations: places.map((t) => `[[${t}]]`) }, `# S\n\n![[${key}]]\n`)],
        { names: more, imageMap: { ...imageMap, 'c.png': { relPath: 'c.png' } }, linkMap: links })(unit1);
      return c;
    };
    const three = sceneWith('a.png', 'The Docks', 'Captain Rook', 'The Bay');
    const [A, B] = ['Alpha', 'Bravo'].map((t) => cand(page(t)));
    const at = (recap, cs) => [...placeFigures(cs, paras(recap))].map(([k, v]) => [k, v.map((x) => x.title || x.key)]);

    it('beside the paragraph that mentions the most of its places and people, not the first', () => {
      assert.deepEqual(at('<p>At the Docks Quarter.</p><p>Captain Rook waited.</p><p>The Bay, the Docks Quarter and Captain Rook.</p>', [three]), [[2, ['a.png']]]);
      // A link counts as a mention, as for a page.
      assert.deepEqual(at('<p>The Bay.</p><p>To <a href="../npcs/captain-rook.html">him</a> at the Docks Quarter.</p>', [three]), [[1, ['a.png']]]);
    });

    it('a tie goes to the earliest of those paragraphs; a paragraph that mentions none is never chosen', () => {
      assert.deepEqual(at('<p>Nobody yet.</p><p>Captain Rook at The Bay.</p><p>The Docks and Captain Rook.</p>', [three]), [[1, ['a.png']]]);
      assert.deepEqual(at('<p>Nobody yet.</p>', [three]), []);
    });

    it('a scene claims first; page pictures fill what is left', () => {
      assert.deepEqual(at('<p>Alpha and Bravo at the Docks Quarter.</p>', [A, B, three]), [[0, ['a.png', 'Alpha']]]);
      assert.deepEqual(at('<p>Alpha and Bravo at the Docks Quarter.</p><p>Bravo again.</p>', [A, B, three]), [[0, ['a.png', 'Alpha']], [1, ['Bravo']]]);
    });

    it('an unplayed scene linked to a Plan is never pictured, even where a paragraph names the most of its pages', () => {
      const recap = '<p>Bravo arrives.</p><p>The Bay, the Docks Quarter and Captain Rook.</p>';
      const draw = (fm) => {
        const notes = [hub1, plan1, scene(`${S}/Session 1/Scenes/Prep`, { locations: ['[[The Docks]]', '[[Captain Rook]]', '[[The Bay]]'], ...fm }, '# S\n\n![[b.png]]\n')];
        const scenes = sceneCandidates(notes, { names: more, imageMap, linkMap: links })(unit1);
        const used = new Set();
        const html = withFigures(recap, { candidates: [B], scenes, fromPath: 'story/s1.html', imageMap, usedImages: used });
        return { html, used: [...used].sort() };
      };
      for (const status of ['ready', 'planned', 'modified']) {
        const { html, used } = draw({ status, session: '[[Session 1 Plan]]', played_in: undefined });
        assert.deepEqual(used, ['a.png'], status);
        assert.equal((html.match(/<figure /g) || []).length, 1, status);
        assert.ok(html.includes('<figcaption>Bravo</figcaption>') && !html.includes('b.png'), html);
      }
      // Played, the same scene is pictured, beside that paragraph.
      const { html, used } = draw({ status: 'played', session: '[[Session 1 Plan]]' });
      assert.deepEqual(used, ['a.png', 'b.png']);
      assert.ok(html.indexOf('b.png') > html.indexOf('Bravo arrives.'), html);
    });

    it('two scenes choosing one paragraph both take a slot there, in the order the paragraph names them; a third takes its next best', () => {
      const docksOnly = sceneWith('b.png', 'The Docks');
      const bayOnly = sceneWith('c.png', 'The Bay');
      assert.deepEqual(at('<p>The Bay, then the Docks and Alpha.</p>', [docksOnly, bayOnly, A]), [[0, ['c.png', 'b.png']]]);
      assert.deepEqual(at('<p>The Bay, Captain Rook, the Docks.</p><p>Later the Docks.</p>', [docksOnly, bayOnly, three]), [[0, ['c.png', 'a.png']], [1, ['b.png']]]);
    });
  });

  describe('a scene\'s title words place its picture (#614)', () => {
    // The shape of Canticle Ch4 S1-S7: the people of the scene are named all through the recap, so by pages alone the
    // setup paragraph ties the paragraph the picture depicts, and the earlier wins. The scene's title says which.
    const harcourt = { outputPath: 'npcs/harcourt.html', displayTitle: 'Harcourt', frontmatter: { type: 'npc' } };
    const endicott = { outputPath: 'npcs/endicott.html', displayTitle: 'Endicott', frontmatter: { type: 'npc' } };
    const trieste = { outputPath: 'locations/trieste.html', displayTitle: 'Trieste', frontmatter: { type: 'location' } };
    const all = pageNames([harcourt, endicott, trieste], {});
    const links = { Harcourt: harcourt.outputPath, Endicott: endicott.outputPath, Trieste: trieste.outputPath };
    const recap = '<p>Harcourt bade them farewell at Trieste.</p>'
      + '<p>Endicott boarded with Harcourt.</p>'
      + '<p>The ship was becalmed for three days; Endicott and Harcourt paced the deck.</p>'
      + '<p>At last the wind came and Harcourt wept.</p>';
    const place = (h1, entities = ['[[Harcourt]]', '[[Endicott]]']) => {
      const [c] = sceneCandidates([hub1, scene(`${S}/Session 1/Scenes/X`, { locations: [], entities }, `# ${h1}\n\n![[a.png]]\n`)],
        { names: all, imageMap, linkMap: links })(unit1);
      return [...placeFigures([c], paras(recap))].map(([k]) => k);
    };

    it('without a title word in the recap the earliest paragraph naming the most of its people still wins', () => {
      assert.deepEqual(place('The Crew'), [1]);
      assert.deepEqual(place('Nothing Relevant Here'), [1]);
    });

    it('a title word read in one paragraph (in any ending) puts the picture there, though an earlier one ties it', () => {
      assert.deepEqual(place('The Becalming'), [2]);
      assert.deepEqual(place('Leaving Trieste', ['[[Harcourt]]']), [0]);
      assert.deepEqual(place('The Wind Came', ['[[Harcourt]]']), [3]);
      assert.deepEqual(place('Harcourt Wept', ['[[Harcourt]]', '[[Endicott]]']), [3]);
    });

    it('a title word read in a paragraph naming none of its people does not place it there', () => {
      const [c] = sceneCandidates([hub1, scene(`${S}/Session 1/Scenes/X`, { locations: [], entities: ['[[Endicott]]'] }, '# The Wind\n\n![[a.png]]\n')],
        { names: all, imageMap, linkMap: links })(unit1);
      assert.deepEqual([...placeFigures([c], paras(recap))].map(([k]) => k), [1]);
    });

    it('the title words never reach the page', () => {
      const [c] = sceneCandidates([hub1, scene(`${S}/Session 1/Scenes/X`, { locations: [], entities: ['[[Harcourt]]'] }, '# The Becalming\n\n![[a.png]]\n')],
        { names: all, imageMap, linkMap: links })(unit1);
      const html = withFigures(recap, { candidates: [], scenes: [c], fromPath: 'story/s1.html', imageMap });
      assert.ok(!/alt="[^"]/.test(html) && !html.includes('<figcaption>'), html);
    });
  });

  it('a scene joining a portrait whose address is decomposed counts the page once', () => {
    const nfc = 'locations/zoë-hall.html';
    const zoe = { ...cand(page('Zoë Hall', { type: 'location' })), outputPath: nfc.normalize('NFD') };
    const pagesOf = [['Zoë Hall', nfc], ['Docks Quarter', 'locations/the-docks.html'], ['Captain Rook', 'npcs/captain-rook.html']]
      .map(([t, href]) => ({ href, terms: [t] }));
    const sc = { key: 'a.png', outputPath: null, title: '', terms: pagesOf.flatMap((x) => x.terms), hrefs: new Set(pagesOf.map((x) => x.href)), pages: pagesOf, place: true, scene: true };
    // Counted twice, the hall alone would tie the paragraph naming two of the scene's pages, and the earlier would win.
    const html = withFigures('<p>Zoë Hall.</p><p>Captain Rook at the Docks Quarter.</p>', { candidates: [zoe], scenes: [sc], fromPath: 'story/s1.html', imageMap });
    assert.ok(html.indexOf('<figure') > html.indexOf('Hall.</p>'), html);
  });

  it('a scene whose picture is a portrait already offered, or already shown, adds nothing', () => {
    const [c] = sceneCandidates([hub1, scene(`${S}/Session 1/Scenes/Docks`, {})], { names, imageMap, linkMap })(unit1);
    const portrait = cand({ ...docks, frontmatter: { ...docks.frontmatter, portrait: 'a.png' } });
    const html = withFigures('<p>The Docks.</p>', { candidates: [portrait], scenes: [c], fromPath: 'story/s1.html', imageMap });
    assert.equal((html.match(/<figure /g) || []).length, 1);
    assert.ok(html.includes('<figcaption>The Docks</figcaption>'));
    const shown = withFigures('<p>The Docks.</p><p><img src="../images/a.png"></p>', { candidates: [], scenes: [c], fromPath: 'story/s1.html', imageMap });
    assert.ok(!shown.includes('<figure'));
    const twice = withFigures('<p>The Docks.</p>', { candidates: [], scenes: [c, { ...c }], fromPath: 'story/s1.html', imageMap });
    assert.equal((twice.match(/<figure /g) || []).length, 1);
  });
});

describe('companions', () => {
  it('an NPC marked companion: true is never a candidate, nor named by a scene; its names still hold their words', () => {
    const thomas = page('Thomas Wyndham', { companion: true });
    const silas = page('Silas Wyndham', { aliases: ['Wyndham'] });
    assert.deepEqual(figureCandidates([thomas, silas], { imageMap }).map((c) => c.title), ['Silas Wyndham']);
    assert.ok(!pageNames([thomas, silas], {}).has(thomas.outputPath));
    assert.deepEqual(nameHolders([thomas, silas], {}).map((h) => h.outputPath), [thomas.outputPath, silas.outputPath]);
    const html = withFigures('<p>Thomas Wyndham waited.</p>', { candidates: figureCandidates([thomas, silas], { imageMap }), blockers: nameHolders([thomas, silas], {}), fromPath: 'story/s1.html', imageMap });
    assert.ok(!html.includes('<figure'), html);
  });

  it('companion read from the source frontmatter; false or absent is not a companion', () => {
    const p = page('Thomas Wyndham', { companion: true });
    p.sourceFrontmatter = p.frontmatter;
    p.frontmatter = { portrait: 'a.png' };
    assert.deepEqual(figureCandidates([p], { imageMap }), []);
    assert.equal(figureCandidates([page('Ann', { companion: false }), page('Bea'), page('Cy', { companion: 'no' })], { imageMap }).length, 3);
    assert.deepEqual(figureCandidates([page('Di', { companion: 'yes' })], { imageMap }), []);
  });
});

describe('withFigures: once per chapter (shown, pictured)', () => {
  const mara = page('Mara Quill');
  const rook = page('Captain Rook', { portrait: 'b.png' });
  const all = () => figureCandidates([mara, rook], { imageMap });

  it('a picture already shown earlier in the chapter is left out; the others still place', () => {
    const pictured = new Set();
    const html = withFigures('<p>Mara Quill and Captain Rook.</p>', { candidates: all(), fromPath: 'story/s1.html', imageMap, shown: new Set(['a.png']), pictured });
    assert.ok(!html.includes('alt="Mara Quill"') && html.includes('alt="Captain Rook"'), html);
    assert.deepEqual([...pictured], ['b.png']);
  });

  it('pictured holds the page pictures placed and the pictures the recap already shows', () => {
    const pictured = new Set();
    withFigures('<p>Mara Quill.</p><p><img src="../images/b.png"></p>', { candidates: all(), fromPath: 'story/s1.html', imageMap, pictured });
    assert.deepEqual([...pictured].sort(), ['a.png', 'b.png']);
    const none = new Set();
    withFigures('<p><img src="../images/b.png"></p>', { candidates: [], fromPath: 'story/s1.html', imageMap, pictured: none });
    assert.deepEqual([...none], ['b.png']);
  });

  it('a scene\'s picture is never left out by shown and is not pictured; a scene sharing a shown portrait stands as the scene\'s', () => {
    const scene = { key: 'a.png', outputPath: null, title: '', terms: ['Docks Quarter'], hrefs: new Set(['locations/the-docks.html']),
      pages: [{ href: 'locations/the-docks.html', terms: ['Docks Quarter'] }], place: true, scene: true };
    const pictured = new Set();
    const html = withFigures('<p>Mara Quill at the Docks Quarter.</p>', { candidates: all(), scenes: [scene], fromPath: 'story/s1.html', imageMap, shown: new Set(['a.png']), pictured });
    assert.equal((html.match(/images\/a\.png" alt=""/g) || []).length, 1, html);
    assert.ok(!html.includes('alt="Mara Quill"'), html);
    assert.deepEqual([...pictured], []);
  });
});
