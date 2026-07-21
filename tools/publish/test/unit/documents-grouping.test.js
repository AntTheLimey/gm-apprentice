const { describe, it } = require('node:test');
const assert = require('node:assert');
const { renderDocuments, indexTemplate } = require('../../lib/templates/index-page');

function doc(title, fm = {}) {
  return {
    title,
    displayTitle: title,
    outputPath: `documents/${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.html`,
    frontmatter: { type: 'reference', ...fm },
    markdown: '',
  };
}

// The Dead End vault shape from the issue: every handout is a per-character prop, keyed on
// `about` (narrative) or `practitioner` (mechanical/reference).
const VAULT = [
  doc('The Last Chart', { about: '[[Rock Lavey]]' }),
  doc('Field Trauma Card', { practitioner: '[[Rock Lavey]]' }),
  doc('Four-Arm Gunwork', { practitioner: '[[Ronin Sanchez]]' }),
  doc('The Anomaly Log', { about: '[[Shackleton Magellan]]' }),
  doc('Kumari\'s Note', { about: '[[Six]]' }),
  doc('A Loose End', {}),
];

const render = (pages = VAULT, indexDir = 'documents') => renderDocuments(pages, indexDir);
const idxOf = (html, needle) => html.indexOf(needle);

describe('renderDocuments', () => {
  it('shows an empty-state message when there are no documents', () => {
    const html = render([]);
    assert.ok(html.includes('No documents or handouts yet.'));
  });

  it('groups documents under a heading per character', () => {
    const html = render();
    for (const name of ['Rock Lavey', 'Ronin Sanchez', 'Shackleton Magellan', 'Six']) {
      assert.ok(html.includes(`intel-section-title">${name}</h2>`), `heading for ${name}`);
    }
  });

  it('pivots on practitioner when about is absent', () => {
    const html = render([doc('Field Trauma Card', { practitioner: '[[Rock Lavey]]' })]);
    assert.ok(html.includes('intel-section-title">Rock Lavey</h2>'));
    assert.ok(html.includes('>Field Trauma Card</h4>'));
  });

  it('prefers about over practitioner when both are set', () => {
    const html = render([doc('Dual', { about: '[[Six]]', practitioner: '[[Rock Lavey]]' })]);
    assert.ok(html.includes('intel-section-title">Six</h2>'));
    assert.ok(!html.includes('intel-section-title">Rock Lavey</h2>'));
  });

  it('resolves a [[Name|Display]] wiki-link to the display half', () => {
    const html = render([doc('Aliased', { about: '[[rock-lavey|Rock Lavey]]' })]);
    assert.ok(html.includes('intel-section-title">Rock Lavey</h2>'));
    assert.ok(!html.includes('rock-lavey'));
  });

  it('sorts character groups alphabetically', () => {
    const html = render();
    assert.ok(idxOf(html, '>Rock Lavey<') < idxOf(html, '>Ronin Sanchez<'));
    assert.ok(idxOf(html, '>Ronin Sanchez<') < idxOf(html, '>Shackleton Magellan<'));
    assert.ok(idxOf(html, '>Shackleton Magellan<') < idxOf(html, '>Six<'));
  });

  it('collects documents with neither key under a trailing Other Documents group', () => {
    const html = render();
    assert.ok(html.includes('intel-section-title">Other Documents</h2>'));
    // "Other Documents" always sorts last, after every named character.
    assert.ok(idxOf(html, '>Other Documents<') > idxOf(html, '>Six<'));
  });

  it('files a list-valued about under its first subject, not a garbled combined group', () => {
    const html = render([doc('Shared Order', { about: ['[[Six]]', '[[Rock Lavey]]'] })]);
    assert.ok(html.includes('intel-section-title">Six</h2>'));
    assert.ok(!html.includes('Six,'));
    assert.ok(!html.includes('intel-section-title">Rock Lavey</h2>'));
  });

  it('treats a blank about/practitioner as Other, not an empty heading', () => {
    const html = render([doc('Blank', { about: '   ' })]);
    assert.ok(html.includes('intel-section-title">Other Documents</h2>'));
    assert.ok(!html.includes('intel-section-title"></h2>'));
  });

  it('sorts cards alphabetically within a group', () => {
    const html = render([
      doc('Zulu File', { about: '[[Six]]' }),
      doc('Alpha File', { about: '[[Six]]' }),
    ]);
    assert.ok(idxOf(html, '>Alpha File<') < idxOf(html, '>Zulu File<'));
  });

  it('renders a subtitle from doc_kind', () => {
    const html = render([doc('Spec Sheet', { about: '[[Six]]', doc_kind: 'blueprint' })]);
    assert.ok(html.includes('card-subtitle">blueprint</div>'));
  });

  it('reuses the already-styled section and card classes (no new CSS)', () => {
    const html = render();
    assert.ok(html.includes('class="documents-page"'));
    assert.ok(html.includes('class="intel-section"'));
    assert.ok(html.includes('class="card-grid"'));
    assert.ok(html.includes('class="entity-card"'));
  });
});

describe('indexTemplate — documents index wiring', () => {
  const navFor = () => '<nav></nav>';
  const config = { siteTitle: 'Test' };

  it('routes the documents dir to the grouped renderer', () => {
    const html = indexTemplate('documents', 'Documents', VAULT, navFor, config, { theme: {} });
    assert.ok(html.includes('class="documents-page"'));
    assert.ok(html.includes('intel-section-title">Six</h2>'));
  });

  it('keeps the name filter but drops pills and the sort control', () => {
    const html = indexTemplate('documents', 'Documents', VAULT, navFor, config, { theme: {} });
    assert.ok(html.includes('class="name-filter"'), 'name filter kept');
    assert.ok(!html.includes('class="pill-filters"'), 'no pill filters');
    assert.ok(!html.includes('class="sort-control"'), 'no sort control');
  });

  it('shows a document count in the header', () => {
    const html = indexTemplate('documents', 'Documents', VAULT, navFor, config, { theme: {} });
    assert.ok(html.includes(`${VAULT.length} documents`));
  });

  it('singularizes the count for one document', () => {
    const html = indexTemplate('documents', 'Documents', [VAULT[0]], navFor, config, { theme: {} });
    assert.ok(html.includes('>1 document<'));
  });

  it('uses the neutral section title with no genre preset', () => {
    const html = indexTemplate('documents', 'Documents', VAULT, navFor, config, { theme: {} });
    assert.ok(html.includes('<h1 class="page-title">Documents</h1>'));
  });

  it('flavors the section title under the scifi preset', () => {
    const html = indexTemplate('documents', 'Documents', VAULT, navFor, config, { theme: {}, _genrePreset: 'scifi' });
    assert.ok(html.includes('Files &amp; Dossiers'));
  });

  it('honors an explicit section_titles override above the genre', () => {
    const html = indexTemplate('documents', 'Documents', VAULT, navFor, config,
      { theme: {}, _genrePreset: 'scifi', section_titles: { documents: 'The Archive' } });
    assert.ok(html.includes('The Archive'));
    assert.ok(!html.includes('Files &amp; Dossiers'));
  });
});
