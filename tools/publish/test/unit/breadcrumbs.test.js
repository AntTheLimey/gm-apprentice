const { describe, it } = require('node:test');
const assert = require('node:assert');
const { generateBreadcrumbs } = require('../../lib/breadcrumbs');

describe('generateBreadcrumbs', () => {
  it('returns Home only for root pages', () => {
    const result = generateBreadcrumbs('index.html', {});
    assert.deepStrictEqual(result, [{ label: 'Home', href: 'index.html' }]);
  });

  it('returns Home > Category for first-level index', () => {
    const result = generateBreadcrumbs('locations/index.html', {});
    assert.deepStrictEqual(result, [
      { label: 'Home', href: '../index.html' },
      { label: 'Locations', href: null },
    ]);
  });

  it('returns Home > Category > Entity for entity pages', () => {
    const result = generateBreadcrumbs('locations/vienna.html', {});
    assert.deepStrictEqual(result, [
      { label: 'Home', href: '../index.html' },
      { label: 'Locations', href: 'index.html' },
      { label: 'Vienna', href: null },
    ]);
  });

  it('does not dead-link a directory segment that has no generated index (B-batch2)', () => {
    // Chapter subfolders (chapters/Chapter 1 - London/) get overview/wrap-up pages but
    // no index.html, so the breadcrumb for that segment must NOT link to index.html.
    const result = generateBreadcrumbs('chapters/Chapter 1 - London/chapter-1-overview.html', {});
    assert.strictEqual(
      result.filter(c => c.href === 'index.html').length, 0,
      'no breadcrumb should point at a non-existent chapter index.html',
    );
    const lastDir = result[result.length - 2];
    assert.strictEqual(lastDir.href, null, 'chapter subfolder segment must be non-linking');
  });

  it('does not link a top-level dir that gets no generated index (e.g. sessions/)', () => {
    // 'sessions' is a friendly label but is NOT in the authoritative index-bearing set,
    // so build.js writes no sessions/index.html — the crumb must not link to it.
    const result = generateBreadcrumbs('sessions/session-1.html', {});
    assert.strictEqual(result.filter(c => c.href === 'index.html').length, 0);
  });

  it('still links index-bearing dirs by their full path (characters/npcs)', () => {
    const result = generateBreadcrumbs('characters/npcs/herr-gruber.html', {});
    const npcsCrumb = result.find(c => c.label === 'NPCs');
    assert.ok(npcsCrumb, 'NPCs segment present');
    assert.strictEqual(npcsCrumb.href, 'index.html', 'characters/npcs IS index-bearing');
  });

  it('handles nested entity paths like characters/npcs', () => {
    const result = generateBreadcrumbs('characters/npcs/herr-gruber.html', {});
    assert.deepStrictEqual(result, [
      { label: 'Home', href: '../../index.html' },
      { label: 'Characters', href: null },
      { label: 'NPCs', href: 'index.html' },
      { label: 'Herr Gruber', href: null },
    ]);
  });

  it('includes parent location for location entities', () => {
    const page = { frontmatter: { parent_location: '[[Vienna]]' } };
    const result = generateBreadcrumbs('locations/hotel-imperial.html', {
      parentLocation: 'Vienna',
      parentLocationHref: 'vienna.html',
    });
    assert.deepStrictEqual(result, [
      { label: 'Home', href: '../index.html' },
      { label: 'Locations', href: 'index.html' },
      { label: 'Vienna', href: 'vienna.html' },
      { label: 'Hotel Imperial', href: null },
    ]);
  });
});
