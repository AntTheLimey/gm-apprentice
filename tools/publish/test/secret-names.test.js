const { describe, it } = require('node:test');
const assert = require('node:assert');

const { secretNamesOf, findSecretNames, pageText } = require('../lib/note-faults');

// The secret-name matchers on their own (#352, #415): a vault of notes in memory, a page as HTML.
function secrets({ withheld = [], gmAliases = [], neverShow = [] } = {}) {
  const notes = withheld.map((name) => ({ vaultPath: `Characters/${name.replace(/ /g, '_')}`, displayTitle: name, frontmatter: { withheld: true } }));
  if (gmAliases.length) notes.push({ vaultPath: 'Characters/Lord_Vane', displayTitle: 'Lord Vane', frontmatter: { gm_aliases: gmAliases } });
  return secretNamesOf({ notes, publishedRels: new Set(), outOf: () => null, linkMap: {}, neverShow });
}
const hits = (s, html) => findSecretNames(html, s.names, { publicWords: new Set() });
const page = (body) => `<html><head><title>T</title></head><body><main>${body}</main></body></html>`;

describe('&shy; and the other invisible entities inside a name (#415)', () => {
  it('pageText decodes them, so the text reads as the name with nothing between its letters', () => {
    for (const entity of ['&shy;', '&ZeroWidthSpace;', '&NoBreak;', '&SHY;']) {
      assert.match(pageText(`<p>Ke${entity}strel</p>`).replace(/[­​⁠]/g, ''), /^Kestrel$/, entity);
    }
  });
  it('a withheld name, a gm_aliases name and a never-show word split by one are found', () => {
    const s = secrets({ withheld: ['Kestrel'], gmAliases: ['Elias Crowe'], neverShow: ['Blackwood'] });
    const found = hits(s, page('<p>Ke&shy;strel met E&ZeroWidthSpace;lias Crowe at Black&NoBreak;wood.</p>')).map((h) => h.alias).sort();
    assert.deepStrictEqual(found, ['Blackwood', 'Elias Crowe', 'Kestrel']);
  });
  it('the quick look that decides whether a page is read at all sees the name too', () => {
    const s = secrets({ withheld: ['Kestrel'] });
    assert.strictEqual(s.mayHold(page('<p>Ke&shy;strel</p>')), true);
    assert.strictEqual(s.mayHold(page('<p>Ke&ZeroWidthSpace;strel</p>')), true);
  });
});

describe('a plural of a secret name (#352)', () => {
  it('"the Lord Zorns" is a hit, as a name written with a capital', () => {
    const s = secrets({ withheld: ['Lord Zorn'], gmAliases: ['Fox'] });
    assert.deepStrictEqual(hits(s, page('<p>The Lord Zorns rode out.</p>')).map((h) => h.alias), ['Lord Zorn']);
    assert.deepStrictEqual(hits(s, page('<p>Then the Lord Zorns rode out.</p>')).map((h) => h.alias), ['Lord Zorn']);
    assert.deepStrictEqual(hits(s, page('<p>Lord Zorns ride.</p>')).map((h) => h.alias), ['Lord Zorn']);
    assert.deepStrictEqual(hits(s, page('<p>We saw two Foxes come.</p>')).map((h) => h.alias), ['Fox']);
  });
  it('a lower-case plural is a word, not the name: "hopes" for a note named Hope', () => {
    const s = secrets({ withheld: ['Hope'] });
    assert.deepStrictEqual(hits(s, page('<p>Her hopes were high.</p>')), []);
    assert.deepStrictEqual(hits(s, page('<p>We read of the Hopes in Arkham.</p>')).map((h) => h.alias), ['Hope']);
  });
  it('a one-word name\'s plural counts only written with a capital mid-sentence (not a sentence start, heading or title)', () => {
    const s = secrets({ withheld: ['Hope', 'Mark', 'Zorn'] });
    assert.deepStrictEqual(hits(s, page('<p>Hopes were high.</p>')), []);
    assert.deepStrictEqual(hits(s, page('<p>It rained. Hopes were high.</p>')), []);
    assert.deepStrictEqual(hits(s, page('<h2>Lost Hopes</h2><p>Nothing.</p>')), []);
    assert.deepStrictEqual(hits(s, page('<p>Marks of the beast.</p>')), []);
    assert.deepStrictEqual(hits(s, page('<p>We read The Lost Hopes Of Old aloud.</p>')), []);
    assert.deepStrictEqual(hits(s, page('<p>Home›Hopes›Lost</p>')), []);
    assert.deepStrictEqual(hits(s, page('<p>And the Zorns came.</p>')).map((h) => h.alias), ['Zorn']);
    // The name itself, not a plural, is matched as it always was.
    assert.deepStrictEqual(hits(s, page('<p>Hope was high.</p>')).map((h) => h.alias), ['Hope']);
  });
  it('a markdown heading line or sentence start is read the same in a note\'s text', () => {
    const { nameMatcher, nameHits } = require('../lib/note-faults');
    const hope = nameMatcher('Hope');
    assert.deepStrictEqual(nameHits(hope, '## Lost Hopes\n\nHopes were high.\n- Hopes again'), []);
    assert.strictEqual(nameHits(hope, 'We lost the Hopes.').length, 1);
    assert.strictEqual(nameHits(nameMatcher('Lord Zorn'), '## the Lord Zorns').length, 1);
  });
  it('a longer word is still not the name', () => {
    const s = secrets({ withheld: ['Lord Zorn'] });
    assert.deepStrictEqual(hits(s, page('<p>Lord Zornish things. Lord Zornsby.</p>')), []);
  });
});

describe('a name in a script written without spaces, followed by a particle (#352)', () => {
  it('is a hit with a letter on either side', () => {
    const s = secrets({ withheld: ['影の王'] });
    assert.deepStrictEqual(hits(s, page('<p>昨日影の王は来た。</p>')).map((h) => h.alias), ['影の王']);
  });
  it('a Latin name keeps its word edges against Latin letters, and is found in Japanese text', () => {
    const s = secrets({ withheld: ['Zorn'] });
    assert.deepStrictEqual(hits(s, page('<p>Zornish aZorn</p>')), []);
    assert.deepStrictEqual(hits(s, page('<p>昨日Zornは来た。</p>')).map((h) => h.alias), ['Zorn']);
  });
});

describe('a name in the first paragraph, which the page also prints as its pull-quote (#352)', () => {
  it('is counted once', () => {
    const s = secrets({ withheld: ['Lord Zorn'], gmAliases: ['Elias Crowe'] });
    const html = page('<div class="pull-quote">Lord Zorn and Elias Crowe ride.</div><div class="content"><p>Lord Zorn and Elias Crowe ride.</p></div>');
    assert.deepStrictEqual(hits(s, html).map((h) => [h.alias, h.count]).sort(), [['Elias Crowe', 1], ['Lord Zorn', 1]]);
  });
  it('a name only the pull-quote prints is still found', () => {
    const s = secrets({ withheld: ['Lord Zorn'] });
    const html = page('<div class="pull-quote">Lord Zorn rides.</div><div class="content"><p>Nothing.</p></div>');
    assert.deepStrictEqual(hits(s, html).map((h) => [h.alias, h.count]), [['Lord Zorn', 1]]);
  });
  it('two in the body are two', () => {
    const s = secrets({ withheld: ['Lord Zorn'] });
    const html = page('<div class="pull-quote">Lord Zorn rides.</div><div class="content"><p>Lord Zorn rides.</p><p>Lord Zorn again.</p></div>');
    assert.deepStrictEqual(hits(s, html).map((h) => h.count), [2]);
  });
});
