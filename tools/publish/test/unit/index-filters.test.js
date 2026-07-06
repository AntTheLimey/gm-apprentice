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

describe('indexTemplate — section titles', () => {
  const navFor = () => '<nav></nav>';
  const config = { siteTitle: 'Test' };
  const locPage = {
    title: 'Docking Ring', displayTitle: 'Docking Ring',
    outputPath: 'locations/docking-ring.html',
    frontmatter: { type: 'location' }, markdown: '',
  };

  it('uses neutral titles when no genre preset is set', () => {
    const html = indexTemplate('locations', 'Locations', [locPage], navFor, config, { theme: {} });
    assert.ok(html.includes('<h1 class="page-title">Locations</h1>'));
    assert.ok(!html.includes('Theater of Operations'));
  });

  it('keeps military flavor titles under the military preset', () => {
    const html = indexTemplate('locations', 'Locations', [locPage], navFor, config, { theme: {}, _genrePreset: 'military' });
    assert.ok(html.includes('Theater of Operations'));
  });

  it('neutral factions title without genre', () => {
    const html = indexTemplate('factions', 'Factions & Organizations', [], navFor, config, { theme: {} });
    assert.ok(html.includes('<h1 class="page-title">Factions &amp; Organizations</h1>'));
    assert.ok(!html.includes('Intelligence Briefing'));
  });

  it('honors explicit section_titles overrides above genre', () => {
    const html = indexTemplate('locations', 'Locations', [locPage], navFor, config,
      { theme: {}, _genrePreset: 'military', section_titles: { locations: 'Star Charts' } });
    assert.ok(html.includes('Star Charts'));
    assert.ok(!html.includes('Theater of Operations'));
  });
});

describe('indexTemplate — canon_status field on index pages', () => {
  const navFor = () => '<nav></nav>';
  const config = { siteTitle: 'Test Campaign' };
  const publishConfig = { theme: {} };

  it('marks items draft via canonical canon_status', () => {
    const pages = [
      { frontmatter: { type: 'item', canon_status: 'DRAFT' }, title: 'Mystery Blade', displayTitle: 'Mystery Blade', outputPath: 'items/mystery-blade.html' },
    ];
    const html = indexTemplate('items', 'Items', pages, navFor, config, publishConfig);
    assert.ok(html.includes('armory-item-draft'), 'canon_status DRAFT must mark the item as draft');
  });

  it('marks items draft via legacy source_confidence', () => {
    const pages = [
      { frontmatter: { type: 'item', source_confidence: 'DRAFT' }, title: 'Old Blade', displayTitle: 'Old Blade', outputPath: 'items/old-blade.html' },
    ];
    const html = indexTemplate('items', 'Items', pages, navFor, config, publishConfig);
    assert.ok(html.includes('armory-item-draft'), 'source_confidence DRAFT must mark the item as draft');
  });

  it('shows the canon_status value in the NPC table Canon Status column', () => {
    const pages = [
      { frontmatter: { type: 'npc', canon_status: 'DRAFT', status: 'alive' }, title: 'New NPC', displayTitle: 'New NPC', outputPath: 'characters/npcs/new-npc.html' },
    ];
    const html = indexTemplate('characters/npcs', 'NPCs', pages, navFor, config, publishConfig);
    assert.ok(html.includes('DRAFT'), 'canon_status value must appear in the Canon Status column');
  });
});

describe('indexTemplate — listing thumbnails', () => {
  const navFor = () => '<nav></nav>';
  const config = { siteTitle: 'Test', attachmentsDir: '_attachments' };
  const publishConfig = { theme: {} };
  const imageMap = { 'ring.png': { relPath: 'ring.png', sourcePath: '/x/ring.png' } };

  it('renders a location thumbnail when portrait resolves', () => {
    const page = {
      title: 'Docking Ring', displayTitle: 'Docking Ring',
      outputPath: 'locations/docking-ring.html',
      frontmatter: { type: 'location', portrait: '_attachments/ring.png' }, markdown: '',
    };
    const html = indexTemplate('locations', 'Locations', [page], navFor, config, publishConfig, imageMap);
    assert.ok(html.includes('loc-card-thumb'));
    assert.ok(html.includes('images/ring.png'));
  });

  it('falls back to text-only when the portrait is not in the imageMap', () => {
    const page = {
      title: 'Void Bar', displayTitle: 'Void Bar',
      outputPath: 'locations/void-bar.html',
      frontmatter: { type: 'location', portrait: '_attachments/missing.png' }, markdown: '',
    };
    const html = indexTemplate('locations', 'Locations', [page], navFor, config, publishConfig, imageMap);
    assert.ok(!html.includes('loc-card-thumb'));
  });

  it('renders a faction thumbnail when portrait resolves', () => {
    const page = {
      title: 'Redline Cartel', displayTitle: 'Redline Cartel',
      outputPath: 'factions/redline-cartel.html',
      frontmatter: { type: 'faction', portrait: '_attachments/ring.png' }, markdown: '',
    };
    const html = indexTemplate('factions', 'Factions & Organizations', [page], navFor, config, publishConfig, imageMap);
    assert.ok(html.includes('intel-card-thumb'));
    assert.ok(html.includes('images/ring.png'));
  });
});
