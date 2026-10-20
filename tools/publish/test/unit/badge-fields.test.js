const { describe, it } = require('node:test');
const assert = require('node:assert');
const { eventTemplate } = require('../../lib/templates/event');
const { factionTemplate } = require('../../lib/templates/faction');
const { locationTemplate } = require('../../lib/templates/location');
const { creatureTemplate } = require('../../lib/templates/creature');
const { itemTemplate } = require('../../lib/templates/item');
const { heritageTemplate } = require('../../lib/templates/heritage');

// #427: every page header badge names its field, whichever template prints it, so a missing
// field never leaves CSS or a script guessing which badge is which.
const stubNav = () => '<nav></nav>';
const config = { siteTitle: 'Test', footer: '', attachmentsDir: '_attachments' };
const content = { html: '<p>Body.</p>' };
const page = (type, dir, fm) => ({ title: 'T', displayTitle: 'T', outputPath: `${dir}/t.html`, frontmatter: { type, ...fm } });

describe('page header badges name their field (#427)', () => {
  it('event', () => {
    const html = eventTemplate(page('event', 'events', { event_type: 'Combat' }), content, stubNav, config, {}, {});
    assert.ok(html.includes('<span class="metadata-badge" data-field="event_type">Combat</span>'));
  });

  it('faction', () => {
    const html = factionTemplate(page('faction', 'factions', { faction_type: 'Guild', alignment: 'Neutral' }), content, stubNav, config, {}, {}, []);
    assert.ok(html.includes('data-field="faction_type">Guild<'));
    assert.ok(html.includes('data-field="alignment">Neutral<'));
  });

  it('location', () => {
    const html = locationTemplate(page('location', 'locations', { location_type: 'City', atmosphere: 'Damp' }), content, stubNav, config, {});
    assert.ok(html.includes('data-field="location_type">City<'));
    assert.ok(html.includes('data-field="atmosphere">Damp<'));
  });

  it('creature, with the threat badge keeping its label', () => {
    const html = creatureTemplate(page('creature', 'creatures', { creature_type: 'Beast', threat_level: 'High' }), content, stubNav, config, {});
    assert.ok(html.includes('data-field="creature_type">Beast<'));
    assert.ok(html.includes('data-field="threat_level">Threat: High<'));
  });

  it('item', () => {
    const html = itemTemplate(page('item', 'items', { item_type: 'Relic', rarity: 'Rare' }), content, stubNav, config, {}, {});
    assert.ok(html.includes('data-field="item_type">Relic<'));
    assert.ok(html.includes('data-field="rarity">Rare<'));
  });

  it('heritage', () => {
    const html = heritageTemplate(page('heritage', 'heritages', { notable_traits: ['Trance'] }), content, stubNav, config, {}, {});
    assert.ok(html.includes('data-field="notable_traits">Trance<'));
  });
});
