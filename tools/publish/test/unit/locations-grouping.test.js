const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  renderLocationsPage, buildLocationTree, resolveLocationGrouping, partitionByPivot,
} = require('../../lib/templates/index-page');

function loc(title, parent, type, extra = {}) {
  return {
    title,
    displayTitle: title.replace(/_/g, ' '),
    outputPath: `locations/${title.toLowerCase().replace(/_/g, '-')}.html`,
    frontmatter: {
      type: 'location',
      ...(parent ? { parent_location: `[[${parent}]]` } : {}),
      ...(type ? { location_type: type } : {}),
      ...extra,
    },
    markdown: '',
  };
}

// The Dead End vault's shape: one political root, every system beneath it, plus a couple of
// locations that hang outside any system.
const VAULT = [
  loc('Federal_Republic_of_Worlds', null, 'polity'),
  loc('Sector_7G', 'Federal_Republic_of_Worlds', 'sector'),

  loc('Corwin_System', 'Sector_7G', 'system', { portrait: 'corwin.png' }),
  loc('Corwin_III', 'Corwin_System', 'planet'),
  loc('Corwin_III_A', 'Corwin_III', 'moon'),

  loc('Eris_System', 'Sector_7G', 'star system'),
  loc('Eris_III', 'Eris_System', 'planet'),
  loc('Aethel', 'Eris_III', 'city'),
  loc('Aethel_Starport', 'Aethel', 'starport'),
  loc('Bamboo_Lounge', 'Aethel_Starport', 'venue'),

  loc('Drift_Route', 'Sector_7G', 'route'),
  loc('Uncharted_Anomaly', null, 'anomaly'),
];

const IMAGE_MAP = { 'corwin.png': { sourcePath: '/x/corwin.png', relPath: 'corwin.png' } };
const SCIFI = { _genrePreset: 'scifi' };

const render = (pages = VAULT, publishConfig = SCIFI, imageMap = IMAGE_MAP) =>
  renderLocationsPage(pages, 'locations', imageMap, '_attachments', publishConfig);

const countOf = (html, needle) => html.split(needle).length - 1;

describe('resolveLocationGrouping', () => {
  it('is off with no config and no genre', () => {
    assert.strictEqual(resolveLocationGrouping(null), null);
    assert.strictEqual(resolveLocationGrouping({}), null);
  });

  it('defaults to the star-system pivot for a scifi genre', () => {
    assert.strictEqual(resolveLocationGrouping(SCIFI).pivot, 'system');
  });

  it('does not default a pivot on for other genres', () => {
    assert.strictEqual(resolveLocationGrouping({ _genrePreset: 'horror' }), null);
  });

  it('lets an explicit group_by override the genre default', () => {
    const cfg = { _genrePreset: 'scifi', locations: { group_by: 'Sector' } };
    assert.strictEqual(resolveLocationGrouping(cfg).pivot, 'sector');
  });

  it('lets an explicit falsy group_by turn a genre default back off', () => {
    for (const group_by of [false, null, '']) {
      assert.strictEqual(
        resolveLocationGrouping({ _genrePreset: 'scifi', locations: { group_by } }), null,
        `group_by: ${JSON.stringify(group_by)} should disable grouping`,
      );
    }
  });

  it('carries a custom ungrouped label, else the default', () => {
    assert.strictEqual(resolveLocationGrouping(SCIFI).ungroupedLabel, 'Deep Space & Routes');
    const cfg = { _genrePreset: 'scifi', locations: { ungrouped_label: 'The Void' } };
    assert.strictEqual(resolveLocationGrouping(cfg).ungroupedLabel, 'The Void');
  });
});

describe('partitionByPivot', () => {
  const partition = () => partitionByPivot(buildLocationTree(VAULT), 'system');

  it('finds each star system as a section, matching "system" inside "star system" too', () => {
    const titles = partition().sections.map(s => s.node.page.displayTitle).sort();
    assert.deepStrictEqual(titles, ['Corwin System', 'Eris System']);
  });

  it('records the political chain above each system as its ancestors', () => {
    const corwin = partition().sections.find(s => s.node.page.displayTitle === 'Corwin System');
    assert.deepStrictEqual(
      corwin.ancestors.map(a => a.page.displayTitle),
      ['Federal Republic of Worlds', 'Sector 7G'],
    );
  });

  it('captures a pivot-free subtree at its topmost node, and only there', () => {
    const leftovers = partition().leftoverRoots.map(n => n.page.displayTitle).sort();
    assert.deepStrictEqual(leftovers, ['Drift Route', 'Uncharted Anomaly']);
  });

  it('does not promote a system nested inside another system to its own section', () => {
    const nested = [
      loc('Alpha_System', null, 'system'),
      loc('Beta_System', 'Alpha_System', 'system'),
      loc('Gamma_System', null, 'system'),
    ];
    const { sections } = partitionByPivot(buildLocationTree(nested), 'system');
    assert.deepStrictEqual(sections.map(s => s.node.page.displayTitle).sort(), ['Alpha System', 'Gamma System']);
  });
});

describe('grouped locations page', () => {
  it('renders one section per star system', () => {
    const html = render();
    assert.strictEqual(countOf(html, 'class="loc-system-title"'), 3, 'two systems + ungrouped');
    assert.ok(html.includes('>Corwin System</a>'));
    assert.ok(html.includes('>Eris System</a>'));
  });

  it('lists every location exactly once', () => {
    const html = render();
    for (const p of VAULT) {
      // Scaffolding appears as caption text, not as a link; everything else appears as one link.
      const isScaffold = ['Federal Republic of Worlds', 'Sector 7G'].includes(p.displayTitle);
      const links = countOf(html, `>${p.displayTitle}</a>`);
      assert.strictEqual(links, isScaffold ? 0 : 1, `${p.displayTitle}: ${links} link(s)`);
    }
  });

  it('demotes the political scaffolding to a single page-level context caption', () => {
    const html = render();
    assert.strictEqual(countOf(html, 'class="loc-context"'), 1,
      'a chain shared by every system should be stated once, not per section');
    assert.ok(html.includes('Federal Republic of Worlds &rsaquo; Sector 7G'));
    assert.ok(!html.includes('loc-node-name" href="federal-republic-of-worlds.html"'),
      'scaffolding must not render as a tree row');
  });

  it('keeps every in-system location a first-class row rather than a breadcrumb', () => {
    const html = render();
    // Aethel is an only child of Eris III and would have been swallowed by chain collapsing.
    for (const name of ['Eris III', 'Aethel', 'Aethel Starport', 'Bamboo Lounge']) {
      assert.ok(html.includes(`class="loc-node-name" href="${name.toLowerCase().replace(/ /g, '-')}.html">${name}</a>`),
        `${name} should be its own row`);
    }
    assert.ok(!html.includes('&rsaquo; Aethel'), 'no breadcrumb chain inside a system');
  });

  it('nests children beneath their parent, single children included', () => {
    const html = render();
    assert.ok(html.includes('loc-node-children'));
    const eris = html.indexOf('>Eris III</a>');
    const aethel = html.indexOf('>Aethel</a>');
    const lounge = html.indexOf('>Bamboo Lounge</a>');
    assert.ok(eris < aethel && aethel < lounge, 'children follow their parent');
  });

  it('uses badge pills for types, never the plain sidebar badge', () => {
    const html = render();
    assert.ok(html.includes('<span class="loc-type-badge">planet</span>'));
    assert.ok(html.includes('<span class="loc-type-badge">venue</span>'));
    assert.ok(!html.includes('sidebar-badge'));
  });

  it('puts a thumbnail on a section header that has a portrait', () => {
    const html = render();
    assert.ok(html.includes('class="loc-system-thumb"'));
    assert.ok(html.includes('images/corwin.png'));
  });

  it('reserves an invisible spacer on rows with no portrait', () => {
    const html = render();
    assert.ok(html.includes('loc-node-thumb loc-node-thumb-empty'));
    assert.ok(!html.includes('placeholder'), 'no visible placeholder box');
  });

  it('collects locations with no system ancestor into the ungrouped section', () => {
    const html = render();
    assert.ok(html.includes('loc-system-ungrouped'));
    assert.ok(html.includes('Deep Space &amp; Routes'));
    const ungrouped = html.slice(html.indexOf('loc-system-ungrouped'));
    assert.ok(ungrouped.includes('>Drift Route</a>'));
    assert.ok(ungrouped.includes('>Uncharted Anomaly</a>'));
  });

  it('counts a system as itself plus its descendants', () => {
    const html = render();
    assert.ok(html.includes('<span class="loc-system-count">3 locations</span>'), 'Corwin System');
    assert.ok(html.includes('<span class="loc-system-count">5 locations</span>'), 'Eris System');
  });

  it('captions each section separately when the systems do not share one chain', () => {
    const split = [
      loc('Republic', null, 'polity'),
      loc('Corwin_System', 'Republic', 'system'),
      loc('Coalition', null, 'polity'),
      loc('Eris_System', 'Coalition', 'system'),
    ];
    const html = render(split);
    assert.strictEqual(countOf(html, 'class="loc-context"'), 2);
  });

  it('omits the ungrouped section entirely when nothing falls outside a system', () => {
    const tidy = VAULT.filter(p => !['Drift_Route', 'Uncharted_Anomaly'].includes(p.title));
    const html = render(tidy);
    assert.ok(!html.includes('loc-system-ungrouped'));
  });

  it('escapes titles and types', () => {
    const nasty = [
      loc('A_System', null, 'system'),
      loc('B_System', null, 'system'),
      { ...loc('Evil', 'A_System', '<script>'), displayTitle: '<img onerror=1>' },
    ];
    const html = render(nasty);
    assert.ok(!html.includes('<script>'));
    assert.ok(!html.includes('<img onerror=1>'));
    assert.ok(html.includes('&lt;script&gt;'));
  });
});

describe('grouped locations page — falling back', () => {
  it('keeps the flat region view when no publishConfig is passed at all', () => {
    const html = renderLocationsPage(VAULT, 'locations');
    assert.ok(html.includes('loc-region'));
    assert.ok(!html.includes('loc-system-grid'));
  });

  it('keeps the flat region view when the genre has no pivot', () => {
    const html = render(VAULT, { _genrePreset: 'horror' });
    assert.ok(html.includes('loc-region'));
  });

  it('keeps the flat region view when only one system exists', () => {
    const single = VAULT.filter(p => !p.title.startsWith('Eris') && p.title !== 'Aethel'
      && p.title !== 'Aethel_Starport' && p.title !== 'Bamboo_Lounge');
    const html = render(single);
    assert.ok(html.includes('loc-region'), 'one pivot is not a grouping');
    assert.ok(!html.includes('loc-system-grid'));
  });

  it('keeps the flat region view when no location matches the pivot', () => {
    const html = render(VAULT, { _genrePreset: 'scifi', locations: { group_by: 'nebula' } });
    assert.ok(html.includes('loc-region'));
  });
});
