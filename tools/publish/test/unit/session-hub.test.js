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

// Review of #276: the pairing links resolve exactly as a `[[link]]` on the site does
// (buildLinkMap: title, vault path or alias; NFC; no case folding; `#heading` not stripped),
// and a link naming several same-titled pages takes the one nearest the hub.
describe('publishedWrapUpFor resolves links as the site does (#276 review)', () => {
  const at = (page, sourcePath, vaultPath) => Object.assign(page, { sourcePath, vaultPath });

  it('resolves documents.wrap_up by vault path and by alias', () => {
    const w = at(wrap('Session 01 Wrap-Up', { aliases: ['S1 Recap'] }), '/v/Sessions/Session 01 Wrap-Up.md', 'Sessions/Session 01 Wrap-Up');
    const byPath = hub('Session 01', { documents: { wrap_up: '[[Sessions/Session 01 Wrap-Up]]' } });
    const byAlias = hub('Session 01', { documents: { wrap_up: '[[S1 Recap|the recap]]' } });
    assert.strictEqual(publishedWrapUpFor(byPath, [w]), w);
    assert.strictEqual(publishedWrapUpFor(byAlias, [w]), w);
  });

  it('does not fold case or strip #heading — neither link resolves on the site', () => {
    const w = wrap('Session 01 Wrap-Up');
    for (const link of ['[[session 01 wrap-up]]', '[[Session 01 Wrap-Up#Narrative Recap]]']) {
      assert.strictEqual(publishedWrapUpFor(hub('Session 01', { documents: { wrap_up: link } }), [w]), null, link);
    }
    const s = hub('Session 01 - Arrival');
    assert.strictEqual(publishedWrapUpFor(s, [wrap('W', { session: '[[session 01 - arrival]]' })]), null);
  });

  it('a broken documents.wrap_up does not fall back to session_number', () => {
    const s = hub('Session 01', { session_number: 1, documents: { wrap_up: '[[No Such Wrap-Up]]' } });
    assert.strictEqual(suppressHubBody(s, [wrap('Session 01 Wrap-Up', { session_number: 1 })]), false);
  });

  it('pairs same-titled Wrap-Ups in two chapters with their own chapter hub', () => {
    const pages = [];
    for (const c of [1, 2]) {
      pages.push(at(hub(`Session 01 - Ch${c} Start`, { chapter: `[[Ch${c}]]`, documents: { wrap_up: '[[Session 01 Wrap-Up]]' } }),
        `/v/Chapters/Ch${c}/Session 01 - Ch${c} Start.md`, `Chapters/Ch${c}/Session 01 - Ch${c} Start`));
      pages.push(at(wrap('Session 01 Wrap-Up', { chapter: `[[Ch${c}]]`, marker: c }),
        `/v/Chapters/Ch${c}/Session 01 Wrap-Up.md`, `Chapters/Ch${c}/Session 01 Wrap-Up`));
    }
    assert.strictEqual(publishedWrapUpFor(pages[0], pages).frontmatter.marker, 1);
    assert.strictEqual(publishedWrapUpFor(pages[2], pages).frontmatter.marker, 2);
  });

  it('prefers the same chapter when same-titled Wrap-Ups share no folder with the hub', () => {
    const h = at(hub('S1', { chapter: '[[Ch2]]', documents: { wrap_up: '[[Wrap]]' } }), '/v/Sessions/S1.md', 'Sessions/S1');
    const w1 = at(wrap('Wrap', { chapter: '[[Ch1]]' }), '/v/Wraps/A/Wrap.md', 'Wraps/A/Wrap');
    const w2 = at(wrap('Wrap', { chapter: '[[Ch2]]' }), '/v/Wraps/B/Wrap.md', 'Wraps/B/Wrap');
    assert.strictEqual(publishedWrapUpFor(h, [h, w1, w2]), w2);
  });

  it('an ambiguous link with no nearer candidate pairs with nothing', () => {
    const h = at(hub('S1', { documents: { wrap_up: '[[Wrap]]' } }), '/v/Sessions/S1.md', 'Sessions/S1');
    const w1 = at(wrap('Wrap'), '/v/A/Wrap.md', 'A/Wrap');
    const w2 = at(wrap('Wrap'), '/v/B/Wrap.md', 'B/Wrap');
    assert.strictEqual(publishedWrapUpFor(h, [h, w1, w2]), null);
  });

  it("a Wrap-Up's session: link pairs only with the hub it resolves to from the Wrap-Up", () => {
    // Two hubs named "Session 01"; the Ch1 Wrap-Up's session: link is Ch1's, never Ch2's.
    const h1 = at(hub('Session 01'), '/v/Ch1/Session 01.md', 'Ch1/Session 01');
    const h2 = at(hub('Session 01'), '/v/Ch2/Session 01.md', 'Ch2/Session 01');
    const w1 = at(wrap('Ch1 Wrap', { session: '[[Session 01]]' }), '/v/Ch1/Ch1 Wrap.md', 'Ch1/Ch1 Wrap');
    const pages = [h1, h2, w1];
    assert.strictEqual(publishedWrapUpFor(h1, pages), w1);
    assert.strictEqual(publishedWrapUpFor(h2, pages), null);
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
