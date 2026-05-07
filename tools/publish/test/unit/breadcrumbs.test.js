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
