const { describe, it } = require('node:test');
const assert = require('node:assert');
const { suppressHubBody, publishedWrapUpFor } = require('../../lib/session-hub');
const { sessionBodyHtml } = require('../../lib/templates/session');

const hub = (title, fm = {}) => ({ title, frontmatter: { type: 'session', ...fm } });
const wrap = (title, fm = {}) => ({ title, frontmatter: { type: 'session_wrap', ...fm } });

describe('suppressHubBody (#276)', () => {
  it('withholds a hub body once a published Wrap-Up names the hub in `session:`', () => {
    const s = hub('Session 01');
    const pages = [s, wrap('Chapter_01_Session_01_Wrap_Up', { session: '[[Session 01]]' })];
    assert.strictEqual(suppressHubBody(s, pages), true);
  });

  it('withholds it when the hub links the Wrap-Up in documents.wrap_up', () => {
    const s = hub('Session 01', { documents: { wrap_up: '[[Chapter_01_Session_01_Wrap_Up]]' } });
    const w = wrap('Chapter_01_Session_01_Wrap_Up');
    assert.strictEqual(publishedWrapUpFor(s, [s, w]), w);
  });

  it('publishes the body when no Wrap-Up publishes — the hub is the only record', () => {
    const s = hub('Session 01', { documents: { wrap_up: '[[Chapter_01_Session_01_Wrap_Up]]' } });
    assert.strictEqual(suppressHubBody(s, [s]), false);
  });

  it('never pairs by session_number or folder alone', () => {
    const s = hub('Session 01', { session_number: 1 });
    s.sourcePath = '/v/S1/Session 01.md';
    const w = wrap('Loose Wrap', { session_number: 1 });
    w.sourcePath = '/v/S1/Loose Wrap.md';
    assert.strictEqual(suppressHubBody(s, [s, w]), false);
  });

  it('leaves every other page type alone', () => {
    for (const type of ['session_wrap', 'session-plan', 'chapter', 'npc']) {
      assert.strictEqual(suppressHubBody({ title: 'x', frontmatter: { type } }, []), false, type);
    }
    assert.strictEqual(suppressHubBody(null, []), false);
  });
});

describe('sessionBodyHtml (#276)', () => {
  const session = { outputPath: 'sessions/s1.html', frontmatter: { type: 'session', chapter: '[[Ch 1]]' } };
  const wrapUp = { outputPath: 'sessions/s1-wrap.html', publishedMarkdown: '## Narrative Recap\n\nThey arrived.\n' };
  const chapter = { outputPath: 'chapters/ch-1.html', displayTitle: 'Ch 1', title: 'Ch 1' };

  it('quotes the Wrap-Up recap opening and links to the full Wrap-Up', () => {
    const html = sessionBodyHtml(session, { wrapUp, chapter });
    assert.match(html, /<p>They arrived\.<\/p>/);
    assert.match(html, /href="s1-wrap\.html">Read the full session/);
    assert.match(html, /href="\.\.\/chapters\/ch-1\.html">Ch 1<\/a>/);
  });

  it('shows no chapter when the chapter page does not publish', () => {
    assert.ok(!sessionBodyHtml(session, { wrapUp }).includes('Chapter:'));
  });

  it('respects an excluded field: no in_game_date in frontmatter, none on the page', () => {
    assert.ok(!sessionBodyHtml(session, { wrapUp }).includes('In-game'));
    const dated = { ...session, frontmatter: { in_game_date: 'Autumn 1813' } };
    assert.match(sessionBodyHtml(dated, { wrapUp }), /In-game: Autumn 1813/);
  });
});
