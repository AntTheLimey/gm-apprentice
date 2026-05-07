const { describe, it } = require('node:test');
const assert = require('node:assert');
const { renderContextSidebar } = require('../../lib/templates/context-sidebar');

describe('renderContextSidebar', () => {
  it('renders backlinks section', () => {
    const html = renderContextSidebar({
      backlinks: [
        { displayTitle: 'Session 9', outputPath: 'sessions/session-9.html', type: 'session' },
      ],
      currentOutputPath: 'characters/npcs/herr-gruber.html',
    });
    assert.ok(html.includes('Mentioned In'));
    assert.ok(html.includes('Session 9'));
    assert.ok(html.includes('href='));
  });

  it('renders relationships section', () => {
    const html = renderContextSidebar({
      relationships: [
        { type: 'member_of', target: 'The Guild', targetPath: 'factions/the-guild.html' },
      ],
      currentOutputPath: 'characters/npcs/herr-gruber.html',
    });
    assert.ok(html.includes('Relationships'));
    assert.ok(html.includes('The Guild'));
  });

  it('returns empty string when no data', () => {
    const html = renderContextSidebar({
      backlinks: [],
      relationships: [],
      currentOutputPath: 'test.html',
    });
    assert.strictEqual(html.trim(), '');
  });
});
