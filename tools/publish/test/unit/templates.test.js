const { describe, it } = require('node:test');
const assert = require('node:assert');
const { stubBadge, metadataBadgesFor, cssPath, rootPath } = require('../../lib/templates/base');
const { parseParticipant } = require('../../lib/templates/event');

describe('stubBadge', () => {
  it('returns badge for STUB status', () => {
    const result = stubBadge({ canon_status: 'STUB' });
    assert.ok(result.includes('stub-badge'));
    assert.ok(result.includes('Stub'));
  });

  it('returns empty string for non-stub', () => {
    assert.strictEqual(stubBadge({ canon_status: 'ACTIVE' }), '');
    assert.strictEqual(stubBadge({}), '');
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
