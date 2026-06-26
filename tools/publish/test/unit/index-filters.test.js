const { describe, it } = require('node:test');
const assert = require('node:assert');
const { indexTemplate, buildPillFilters, buildLocationTree } = require('../../lib/templates/index-page');

describe('buildPillFilters', () => {
  it('returns pills for unique sub-types', () => {
    const pages = [
      { frontmatter: { type: 'pc' } },
      { frontmatter: { type: 'npc' } },
      { frontmatter: { type: 'npc' } },
      { frontmatter: { type: 'creature' } },
    ];
    const pills = buildPillFilters(pages, 'characters');
    assert.ok(pills.includes('All'));
    assert.ok(pills.includes('pc'));
    assert.ok(pills.includes('npc'));
    assert.ok(pills.includes('creature'));
  });

  it('returns location_type pills for locations dir', () => {
    const pages = [
      { frontmatter: { type: 'location', location_type: 'city' } },
      { frontmatter: { type: 'location', location_type: 'building' } },
      { frontmatter: { type: 'location', location_type: 'city' } },
    ];
    const pills = buildPillFilters(pages, 'locations');
    assert.ok(pills.includes('city'));
    assert.ok(pills.includes('building'));
  });
});

describe('buildLocationTree', () => {
  it('nests children under parents', () => {
    const pages = [
      { title: 'Vienna', displayTitle: 'Vienna', outputPath: 'locations/vienna.html', frontmatter: { type: 'location' } },
      { title: 'Hotel_Imperial', displayTitle: 'Hotel Imperial', outputPath: 'locations/hotel-imperial.html', frontmatter: { type: 'location', parent_location: '[[Vienna]]' } },
    ];
    const tree = buildLocationTree(pages);
    assert.strictEqual(tree.length, 1);
    assert.strictEqual(tree[0].page.title, 'Vienna');
    assert.strictEqual(tree[0].children.length, 1);
    assert.strictEqual(tree[0].children[0].page.title, 'Hotel_Imperial');
  });

  it('puts orphans at root level', () => {
    const pages = [
      { title: 'Standalone', displayTitle: 'Standalone', outputPath: 'locations/standalone.html', frontmatter: { type: 'location' } },
    ];
    const tree = buildLocationTree(pages);
    assert.strictEqual(tree.length, 1);
  });
});

describe('indexTemplate — campaign index', () => {
  const navFor = () => '<nav></nav>';
  const config = { siteTitle: 'GURPS Special Forces' };
  const publishConfig = { theme: {} };

  it('renders the overview deep-dive when the overview is published', () => {
    const overview = {
      frontmatter: { type: 'campaign_overview', campaign: 'GURPS Special Forces' },
      title: 'Campaign Overview',
      outputPath: 'campaign/index.html',
      markdown: '# GURPS Special Forces\n\nThe premise.',
    };
    const html = indexTemplate('campaign', 'Campaign', [overview], navFor, config, publishConfig);
    assert.ok(!html.includes('No campaign overview found'), 'must not show the error string');
    assert.ok(html.includes('campaign-deep-dive'), 'renders the deep-dive when the overview is published');
  });

  it('falls back to a card index of published _Campaign pages when the overview is excluded (no spoiler leak, no error string)', () => {
    const pages = [
      { frontmatter: { type: 'timeline' }, title: 'Timeline', displayTitle: 'Timeline', outputPath: 'campaign/timeline.html' },
      { frontmatter: { type: 'reference' }, title: 'Glossary', displayTitle: 'Glossary', outputPath: 'campaign/glossary.html' },
    ];
    const html = indexTemplate('campaign', 'Campaign', pages, navFor, config, publishConfig);
    assert.ok(!html.includes('No campaign overview found'), 'must not show the error string');
    assert.ok(!html.includes('campaign-deep-dive'), 'must not render the (spoiler) deep-dive');
    assert.ok(html.includes('card-grid'), 'renders the published _Campaign pages as a card index');
    assert.ok(html.includes('Timeline'), 'includes the published _Campaign content');
    assert.ok(html.includes('GURPS Special Forces'), 'header still shows the campaign name (site-title fallback)');
  });
});
