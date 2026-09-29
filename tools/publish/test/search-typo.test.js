const test = require('node:test');
const assert = require('node:assert');
const search = require('../js/search.js');

// #267: typo tolerance, full-body indexing.
function buildIdx(pages) {
  const lunr = require('lunr');
  const { buildSearchIndex } = require('../lib/search-index');
  const full = pages.map((p) => ({
    outputPath: p.path, displayTitle: p.title, title: p.title,
    frontmatter: { type: p.type || 'npc' }, markdown: p.body || '',
  }));
  const built = buildSearchIndex(full);
  // Refs are short ids (documents map id -> entry with the real path in href).
  const idx = lunr.Index.load(built.index);
  const wrapped = { query: (fn) => idx.query(fn).map((h) => Object.assign({}, h, { ref: built.documents[h.ref].href })) };
  return { lunr, idx: wrapped };
}

test('runSearch: a one-letter typo in a title still finds the page', () => {
  const { lunr, idx } = buildIdx([
    { path: 'npcs/alderic.html', title: 'Alderic Vane' },
    { path: 'npcs/other.html', title: 'Someone Else' },
  ]);
  for (const q of ['Aldric', 'Alderik', 'Alderc', 'Alderic']) {
    const hits = search.runSearch(idx, q, lunr);
    assert.strictEqual(hits[0] && hits[0].ref, 'npcs/alderic.html', `query "${q}"`);
  }
});

test('runSearch: prefix and multi-word queries still work', () => {
  const { lunr, idx } = buildIdx([
    { path: 'npcs/alderic.html', title: 'Alderic Vane' },
    { path: 'npcs/marta.html', title: 'Marta Voss' },
  ]);
  assert.strictEqual(search.runSearch(idx, 'alde', lunr)[0].ref, 'npcs/alderic.html');
  assert.strictEqual(search.runSearch(idx, 'marta vo', lunr)[0].ref, 'npcs/marta.html');
});

test('runSearch: exact/prefix hits outrank fuzzy ones', () => {
  const { lunr, idx } = buildIdx([
    { path: 'a.html', title: 'Marten' },
    { path: 'b.html', title: 'Martin' },
  ]);
  const hits = search.runSearch(idx, 'martin', lunr);
  assert.strictEqual(hits[0].ref, 'b.html');
  assert.ok(hits.length === 2 && hits[0].score > hits[1].score);
});

test('runSearch: short terms are not fuzzed', () => {
  const { lunr, idx } = buildIdx([{ path: 'a.html', title: 'Cat' }, { path: 'b.html', title: 'Bat' }]);
  assert.deepStrictEqual(search.runSearch(idx, 'cat', lunr).map((h) => h.ref), ['a.html']);
  assert.strictEqual(search.MIN_FUZZY_LENGTH, 4);
});

test('runSearch: odd input never throws', () => {
  const { lunr, idx } = buildIdx([{ path: 'a.html', title: 'Alderic' }]);
  for (const q of ['foo:', '~', '*', ':', 'title:', '^^', '   ', '', 'a~b', '"', '(', 'x*y', '-', 'alderic~']) {
    assert.doesNotThrow(() => search.runSearch(idx, q, lunr), `query ${JSON.stringify(q)}`);
  }
  assert.strictEqual(search.runSearch(idx, 'alderic:', lunr)[0].ref, 'a.html');
});

test('buildSearchIndex: a term only after character 500 of the body is searchable', () => {
  const body = 'filler '.repeat(200) + 'Zephyrine met the party at dusk.';
  assert.ok(body.indexOf('Zephyrine') > 500);
  const { lunr, idx } = buildIdx([{ path: 'sessions/s1.html', title: 'Session One', type: 'session', body }]);
  assert.strictEqual(search.runSearch(idx, 'zephyrine', lunr)[0].ref, 'sessions/s1.html');
  assert.strictEqual(search.runSearch(idx, 'zephyrin', lunr)[0].ref, 'sessions/s1.html');
});
