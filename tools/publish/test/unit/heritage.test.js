const { describe, it } = require('node:test');
const assert = require('node:assert');
const { heritageTemplate } = require('../../lib/templates/heritage');
const { worldDomainTemplate } = require('../../lib/templates/world-domain');

const stubNav = () => '<nav></nav>';
const baseConfig = { siteTitle: 'Test', footer: '', attachmentsDir: '_attachments' };

describe('heritageTemplate', () => {
  const basePage = {
    title: 'Elves',
    displayTitle: 'Elves',
    outputPath: 'heritages/elves.html',
    frontmatter: { type: 'heritage' },
  };
  const baseContent = { html: '<p>Graceful folk.</p>', relationships: '' };

  it('renders stat card with lifespan range', () => {
    const page = { ...basePage, frontmatter: { ...basePage.frontmatter, lifespan_range: [100, 750] } };
    const html = heritageTemplate(page, baseContent, stubNav, baseConfig, {}, {});
    assert.ok(html.includes('100–750 years'), 'should render lifespan range');
    assert.ok(html.includes('Lifespan'), 'should have Lifespan label');
  });

  it('renders maturity age', () => {
    const page = { ...basePage, frontmatter: { ...basePage.frontmatter, maturity_age: 25 } };
    const html = heritageTemplate(page, baseContent, stubNav, baseConfig, {}, {});
    assert.ok(html.includes('25 years'), 'should render maturity age');
    assert.ok(html.includes('Maturity'), 'should have Maturity label');
  });

  it('renders average height', () => {
    const page = { ...basePage, frontmatter: { ...basePage.frontmatter, average_height: '5\'6"–6\'2"' } };
    const html = heritageTemplate(page, baseContent, stubNav, baseConfig, {}, {});
    assert.ok(html.includes('Height'), 'should have Height label');
  });

  it('renders notable traits as badges', () => {
    const page = { ...basePage, frontmatter: { ...basePage.frontmatter, notable_traits: ['Low_Light_Vision', 'Trance'] } };
    const html = heritageTemplate(page, baseContent, stubNav, baseConfig, {}, {});
    assert.ok(html.includes('Low Light Vision'), 'should render trait with underscores replaced');
    assert.ok(html.includes('Trance'), 'should render second trait');
    assert.ok(html.includes('metadata-badge'), 'should use badge class');
  });

  it('renders without optional fields', () => {
    const html = heritageTemplate(basePage, baseContent, stubNav, baseConfig, {}, {});
    assert.ok(html.includes('Elves'), 'should render title');
    assert.ok(html.includes('Graceful folk'), 'should render body content');
    assert.ok(!html.includes('heritage-stats'), 'should not render stat card when no stats');
  });

  it('renders relationship graph when provided', () => {
    const context = { publishConfig: { _entityGraphs: { 'Elves': '<svg>graph</svg>' }, _backlinks: {} } };
    const html = heritageTemplate(basePage, baseContent, stubNav, baseConfig, {}, context);
    assert.ok(html.includes('Connections'), 'should render graph heading');
    assert.ok(html.includes('<svg>graph</svg>'), 'should include graph SVG');
  });

  it('renders context sidebar with backlinks', () => {
    const context = { publishConfig: { _backlinks: { 'Elves': [{ title: 'Legolas', outputPath: 'characters/npcs/legolas.html' }] } } };
    const html = heritageTemplate(basePage, baseContent, stubNav, baseConfig, {}, context);
    assert.ok(html.includes('content-with-sidebar'), 'should use sidebar layout');
  });
});

describe('worldDomainTemplate', () => {
  const basePage = {
    title: 'Geography',
    displayTitle: 'Geography',
    outputPath: 'world/geography.html',
    frontmatter: { type: 'world_domain' },
  };
  const baseContent = { html: '<p>Mountains and rivers.</p>' };

  it('renders rules sidebar when rules present', () => {
    const page = { ...basePage, frontmatter: { ...basePage.frontmatter, rules: [{ rule: 'No flying mounts' }, { rule: 'Rivers flow south' }] } };
    const html = worldDomainTemplate(page, baseContent, stubNav, baseConfig, {}, {});
    assert.ok(html.includes('World Rules'), 'should have rules sidebar heading');
    assert.ok(html.includes('No flying mounts'), 'should render first rule');
    assert.ok(html.includes('Rivers flow south'), 'should render second rule');
  });

  it('suppresses rules sidebar when publish_rules is false', () => {
    const page = { ...basePage, frontmatter: { ...basePage.frontmatter, publish_rules: false, rules: [{ rule: 'Hidden rule' }] } };
    const html = worldDomainTemplate(page, baseContent, stubNav, baseConfig, {}, {});
    assert.ok(!html.includes('World Rules'), 'should not render rules sidebar');
    assert.ok(!html.includes('Hidden rule'), 'should not render rule content');
  });

  it('renders summary subtitle', () => {
    const page = { ...basePage, frontmatter: { ...basePage.frontmatter, summary: 'The lay of the land' } };
    const html = worldDomainTemplate(page, baseContent, stubNav, baseConfig, {}, {});
    assert.ok(html.includes('The lay of the land'), 'should render summary');
    assert.ok(html.includes('world-domain-summary'), 'should use summary class');
  });

  it('renders without optional fields', () => {
    const html = worldDomainTemplate(basePage, baseContent, stubNav, baseConfig, {}, {});
    assert.ok(html.includes('Geography'), 'should render title');
    assert.ok(html.includes('Mountains and rivers'), 'should render body content');
    assert.ok(!html.includes('world-rules-sidebar'), 'should not render rules sidebar');
  });

  it('falls back to rule id when rule field is absent', () => {
    const page = { ...basePage, frontmatter: { ...basePage.frontmatter, rules: [{ id: 'MAX_ALTITUDE_5000' }] } };
    const html = worldDomainTemplate(page, baseContent, stubNav, baseConfig, {}, {});
    assert.ok(html.includes('MAX_ALTITUDE_5000'), 'should fall back to id field');
  });
});
