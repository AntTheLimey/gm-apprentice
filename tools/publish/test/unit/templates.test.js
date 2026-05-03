const { describe, it } = require('node:test');
const assert = require('node:assert');
const { confidenceBadge, getConfidence, metadataBadgesFor, cssPath, rootPath } = require('../../lib/templates/base');
const { parseParticipant } = require('../../lib/templates/event');

describe('getConfidence', () => {
  it('prefers source_confidence over canon_status', () => {
    assert.strictEqual(getConfidence({ source_confidence: 'DRAFT', canon_status: 'STUB' }), 'DRAFT');
  });

  it('falls back to canon_status', () => {
    assert.strictEqual(getConfidence({ canon_status: 'STUB' }), 'STUB');
  });

  it('returns null when neither present', () => {
    assert.strictEqual(getConfidence({}), null);
  });
});

describe('confidenceBadge', () => {
  it('returns badge for STUB via source_confidence', () => {
    const result = confidenceBadge({ source_confidence: 'STUB' });
    assert.ok(result.includes('badge-stub'));
    assert.ok(result.includes('Stub'));
  });

  it('returns badge for STUB via canon_status fallback', () => {
    const result = confidenceBadge({ canon_status: 'STUB' });
    assert.ok(result.includes('badge-stub'));
  });

  it('returns badge for DRAFT', () => {
    const result = confidenceBadge({ source_confidence: 'DRAFT' });
    assert.ok(result.includes('badge-draft'));
    assert.ok(result.includes('Draft'));
  });

  it('returns badge for SUPERSEDED', () => {
    const result = confidenceBadge({ source_confidence: 'SUPERSEDED' });
    assert.ok(result.includes('badge-superseded'));
    assert.ok(result.includes('Superseded'));
  });

  it('returns empty string for AUTHORITATIVE', () => {
    assert.strictEqual(confidenceBadge({ source_confidence: 'AUTHORITATIVE' }), '');
  });

  it('returns empty string when no confidence field', () => {
    assert.strictEqual(confidenceBadge({}), '');
  });
});

describe('metadataBadgesFor', () => {
  it('renders event badges', () => {
    const fm = { type: 'event', event_type: 'Combat', date: '1943-05-01' };
    const result = metadataBadgesFor(fm);
    assert.ok(result.includes('Combat'));
    assert.ok(result.includes('1943-05-01'));
  });

  it('strips wiki-link brackets', () => {
    const fm = { type: 'event', location: '[[Berlin]]' };
    const result = metadataBadgesFor(fm);
    assert.ok(result.includes('Berlin'));
    assert.ok(!result.includes('[['));
  });

  it('returns empty for unknown type', () => {
    const fm = { type: 'unknown' };
    assert.strictEqual(metadataBadgesFor(fm), '');
  });
});

describe('cssPath', () => {
  it('handles root level', () => {
    assert.strictEqual(cssPath('index.html'), 'css/style.css');
  });

  it('handles one level deep', () => {
    assert.strictEqual(cssPath('factions/index.html'), '../css/style.css');
  });

  it('handles two levels deep', () => {
    assert.strictEqual(cssPath('characters/pcs/john.html'), '../../css/style.css');
  });
});

describe('rootPath', () => {
  it('handles root level', () => {
    assert.strictEqual(rootPath('index.html'), './');
  });

  it('handles nested paths', () => {
    assert.strictEqual(rootPath('characters/pcs/john.html'), '../../');
  });
});

describe('parseParticipant', () => {
  it('parses [[Entity]] (annotation)', () => {
    const result = parseParticipant('[[Anna_Lindqvist]] (rescued)');
    assert.strictEqual(result.target, 'Anna_Lindqvist');
    assert.strictEqual(result.display, 'Anna_Lindqvist');
    assert.strictEqual(result.annotation, 'rescued');
    assert.strictEqual(result.isLink, true);
  });

  it('parses [[Entity|Display Name]] (annotation)', () => {
    const result = parseParticipant('[[Anna_Lindqvist|Anna Lindqvist]] (rescued from control)');
    assert.strictEqual(result.target, 'Anna_Lindqvist');
    assert.strictEqual(result.display, 'Anna Lindqvist');
    assert.strictEqual(result.annotation, 'rescued from control');
    assert.strictEqual(result.isLink, true);
  });

  it('parses [[Entity]] without annotation', () => {
    const result = parseParticipant('[[Emma_Wentworth]]');
    assert.strictEqual(result.target, 'Emma_Wentworth');
    assert.strictEqual(result.display, 'Emma_Wentworth');
    assert.strictEqual(result.annotation, '');
    assert.strictEqual(result.isLink, true);
  });

  it('parses plain text with annotation', () => {
    const result = parseParticipant('Every active PC (present)');
    assert.strictEqual(result.target, '');
    assert.strictEqual(result.display, 'Every active PC');
    assert.strictEqual(result.annotation, 'present');
    assert.strictEqual(result.isLink, false);
  });

  it('parses plain text without annotation', () => {
    const result = parseParticipant('Allied soldiers');
    assert.strictEqual(result.target, '');
    assert.strictEqual(result.display, 'Allied soldiers');
    assert.strictEqual(result.annotation, '');
    assert.strictEqual(result.isLink, false);
  });

  it('handles annotation with special characters', () => {
    const result = parseParticipant('[[Klaus_Bauer]] (attacker — escaped)');
    assert.strictEqual(result.target, 'Klaus_Bauer');
    assert.strictEqual(result.annotation, 'attacker — escaped');
    assert.strictEqual(result.isLink, true);
  });

  it('trims surrounding whitespace before parsing', () => {
    const result = parseParticipant('  [[Hero]] (led the assault)  ');
    assert.strictEqual(result.target, 'Hero');
    assert.strictEqual(result.display, 'Hero');
    assert.strictEqual(result.annotation, 'led the assault');
    assert.strictEqual(result.isLink, true);
  });
});

describe('PC template display_meta', () => {
  const { pcTemplate } = require('../../lib/templates/pc');

  const mockNavFor = () => '';
  const mockConfig = { siteTitle: 'Test', attachmentsDir: '_attachments' };

  it('renders display_meta fields when set', () => {
    const page = {
      title: 'Test_Hero',
      displayTitle: 'Test Hero',
      outputPath: 'characters/pcs/test-hero.html',
      frontmatter: {
        type: 'pc',
        player_name: 'Alice',
        status: 'active',
        point_total: 200,
        age: 34,
        TL: 8,
        display_meta: ['point_total', 'age', 'TL'],
      },
    };
    const processed = { html: '', relationships: '' };
    const html = pcTemplate(page, processed, [], mockNavFor, mockConfig, {});
    assert.ok(html.includes('Point Total'), 'Should render point_total label as title case');
    assert.ok(html.includes('200'), 'Should render point_total value');
    assert.ok(html.includes('Age'), 'Should render age label');
    assert.ok(html.includes('34'), 'Should render age value');
    assert.ok(html.includes('TL'), 'Should render TL label');
    assert.ok(html.includes('8'), 'Should render TL value');
  });

  it('falls back to occupation/age/nationality when display_meta not set', () => {
    const page = {
      title: 'Fallback Hero',
      displayTitle: 'Fallback Hero',
      outputPath: 'characters/pcs/fallback-hero.html',
      frontmatter: {
        type: 'pc',
        player_name: 'Bob',
        status: 'active',
        occupation: 'Detective',
        age: 42,
        nationality: 'British',
      },
    };
    const processed = { html: '', relationships: '' };
    const html = pcTemplate(page, processed, [], mockNavFor, mockConfig, {});
    assert.ok(html.includes('Occupation'), 'Should show occupation label');
    assert.ok(html.includes('Detective'), 'Should show occupation value');
    assert.ok(html.includes('Age'), 'Should show age label');
    assert.ok(html.includes('42'), 'Should show age value');
    assert.ok(html.includes('Nationality'), 'Should show nationality label');
    assert.ok(html.includes('British'), 'Should show nationality value');
  });

  it('skips missing fields silently', () => {
    const page = {
      title: 'Sparse Hero',
      displayTitle: 'Sparse Hero',
      outputPath: 'characters/pcs/sparse-hero.html',
      frontmatter: {
        type: 'pc',
        player_name: 'Carol',
        status: 'active',
        display_meta: ['occupation', 'age', 'missing_field'],
        occupation: 'Spy',
      },
    };
    const processed = { html: '', relationships: '' };
    const html = pcTemplate(page, processed, [], mockNavFor, mockConfig, {});
    assert.ok(html.includes('Occupation'), 'Should show occupation');
    assert.ok(html.includes('Spy'), 'Should show occupation value');
    assert.ok(!html.includes('Missing Field'), 'Should not show missing_field label');
  });

  it('uses displayTitle in h1 and page title', () => {
    const page = {
      title: 'Captain_Hero',
      displayTitle: 'Captain Hero',
      outputPath: 'characters/pcs/captain-hero.html',
      frontmatter: { type: 'pc', player_name: 'Dan', status: 'active' },
    };
    const processed = { html: '', relationships: '' };
    const html = pcTemplate(page, processed, [], mockNavFor, mockConfig, {});
    assert.ok(html.includes('<h1>Captain Hero</h1>'), 'Should use displayTitle in h1');
  });
});

describe('displayTitle usage', () => {
  const { npcTemplate } = require('../../lib/templates/npc');
  const { wikiTemplate } = require('../../lib/templates/wiki');

  const mockNavFor = () => '';
  const mockConfig = { siteTitle: 'Test', attachmentsDir: '_attachments' };

  it('npc template uses displayTitle in heading', () => {
    const page = {
      title: 'Captain_James',
      displayTitle: 'Captain James',
      outputPath: 'characters/npcs/captain-james.html',
      frontmatter: { type: 'npc' },
    };
    const processed = { html: '<p>Content</p>', relationships: '' };
    const html = npcTemplate(page, processed, mockNavFor, mockConfig, {});
    assert.ok(html.includes('<h1>Captain James'), 'Should use displayTitle in h1');
    assert.ok(!html.includes('<h1>Captain_James'), 'Should not use raw title in h1');
  });

  it('wiki template uses displayTitle in heading', () => {
    const page = {
      title: 'Old_Fortress',
      displayTitle: 'Old Fortress',
      outputPath: 'locations/old-fortress.html',
      frontmatter: { type: 'document' },
    };
    const processed = { html: '<p>Content</p>', relationships: '' };
    const html = wikiTemplate(page, processed, mockNavFor, mockConfig, {});
    assert.ok(html.includes('Old Fortress'), 'Should use displayTitle');
    assert.ok(!html.includes('Old_Fortress'), 'Should not use raw title');
  });
});

describe('PC template tabbed layout', () => {
  const { pcTemplate } = require('../../lib/templates/pc');

  const mockNavFor = () => '';
  const mockConfig = { siteTitle: 'Test', attachmentsDir: '_attachments' };

  it('renders tab bar when storyHtml is provided', () => {
    const page = {
      title: 'Hero',
      displayTitle: 'Hero',
      outputPath: 'characters/pcs/hero.html',
      frontmatter: { type: 'pc', player_name: 'Alice', status: 'active' },
    };
    const processed = { html: '', relationships: '' };
    const sections = [{ id: 'stat-sheet', title: 'Stat Sheet', html: '<p>Stats</p>' }];
    const storyHtml = '<h3>Session 1 — The Start</h3><p>Adventure begins.</p>';
    const html = pcTemplate(page, processed, sections, mockNavFor, mockConfig, {}, storyHtml);
    assert.ok(html.includes('tab-bar'), 'Should have tab bar');
    assert.ok(html.includes('Character Sheet'), 'Should have Sheet tab');
    assert.ok(html.includes('Story'), 'Should have Story tab');
    assert.ok(html.includes('tab-sheet'), 'Should have sheet tab panel');
    assert.ok(html.includes('tab-story'), 'Should have story tab panel');
    assert.ok(html.includes('Adventure begins'), 'Should contain story content');
  });

  it('omits tab bar when no storyHtml is provided', () => {
    const page = {
      title: 'Solo',
      displayTitle: 'Solo',
      outputPath: 'characters/pcs/solo.html',
      frontmatter: { type: 'pc', player_name: 'Bob', status: 'active' },
    };
    const processed = { html: '', relationships: '' };
    const sections = [{ id: 'stat-sheet', title: 'Stat Sheet', html: '<p>Stats</p>' }];
    const html = pcTemplate(page, processed, sections, mockNavFor, mockConfig, {});
    assert.ok(!html.includes('tab-bar'), 'Should not have tab bar');
    assert.ok(!html.includes('tab-story'), 'Should not have story panel');
    assert.ok(html.includes('accordion'), 'Should still have accordion sections');
  });

  it('includes hash-based tab routing script', () => {
    const page = {
      title: 'Hero',
      displayTitle: 'Hero',
      outputPath: 'characters/pcs/hero.html',
      frontmatter: { type: 'pc', player_name: 'Alice', status: 'active' },
    };
    const processed = { html: '', relationships: '' };
    const storyHtml = '<p>Story content</p>';
    const html = pcTemplate(page, processed, [], mockNavFor, mockConfig, {}, storyHtml);
    assert.ok(html.includes('location.hash'), 'Should have hash routing');
    assert.ok(html.includes('#story'), 'Should reference #story hash');
  });

  it('renders story as prose flow', () => {
    const page = {
      title: 'Hero',
      displayTitle: 'Hero',
      outputPath: 'characters/pcs/hero.html',
      frontmatter: { type: 'pc', player_name: 'Alice', status: 'active' },
    };
    const processed = { html: '', relationships: '' };
    const storyHtml = '<h3>Session 1 — The Start</h3><p>Adventure begins.</p>';
    const html = pcTemplate(page, processed, [], mockNavFor, mockConfig, {}, storyHtml);
    assert.ok(html.includes('story-prose'), 'Should have prose flow container');
  });
});

describe('PC renderer registry', () => {
  const { getRenderer } = require('../../lib/templates/pc-registry');

  it('returns null for unknown system', () => {
    assert.strictEqual(getRenderer('unknown-system'), null);
  });

  it('returns null for null system', () => {
    assert.strictEqual(getRenderer(null), null);
  });

  it('returns null for undefined system', () => {
    assert.strictEqual(getRenderer(undefined), null);
  });
});
