const { describe, it } = require('node:test');
const assert = require('node:assert');
const { foldPlan, applyFold, isFolded, foldLabel } = require('../../lib/story-fold');

const wrap = (title, outputPath = 'sessions/x.html') => ({ displayTitle: title, outputPath, outputDir: 'sessions', frontmatter: { type: 'session-wrap-up' } });
const unit = { kind: 'session', outputPath: 'story/ch-s1.html', title: 'Session 1', sourcePage: {} };

describe('story fold', () => {
  it('a session wrap-up folds into its session unit; the chapter does not take it', () => {
    const w = wrap('S1 Wrap');
    const s = { kind: 'session', outputPath: 'story/ch-s1.html', title: 'Session 1', wrapUpPage: w, sourcePage: {} };
    const c = { kind: 'chapter', outputPath: 'story/ch.html', title: 'Ch', wrapUpPage: w, sourcePage: {} };
    assert.equal(foldPlan([c, s]).get(w), s);
    assert.equal(foldPlan([s, c]).get(w), s);
  });

  it('a chapter claims a wrap-up no session wants', () => {
    const w = wrap('Ch Wrap');
    const c = { kind: 'chapter', outputPath: 'story/ch.html', title: 'Ch', wrapUpPage: w, sourcePage: {} };
    assert.equal(foldPlan([c]).get(w), c);
  });

  it('applyFold moves the page, patches every key and labels it', () => {
    const w = wrap('S1 Wrap', 'sessions/s1-wrap.html');
    const map = { 'S1 Wrap': 'sessions/s1-wrap.html', 's1 alias': 'sessions/s1-wrap.html', Other: 'npcs/x.html' };
    const labels = applyFold(new Map([[w, unit]]), map);
    assert.equal(w.outputPath, 'story/ch-s1.html');
    assert.equal(w.foldedFrom, 'sessions/s1-wrap.html');
    assert.equal(w.outputDir, 'story');
    assert.equal(w.displayTitle, 'Session 1');
    assert.equal(w.foldedInto, unit);
    assert.ok(isFolded(w));
    assert.ok(!isFolded(wrap('Other')));
    assert.deepEqual(map, { 'S1 Wrap': 'story/ch-s1.html', 's1 alias': 'story/ch-s1.html', Other: 'npcs/x.html' });
    assert.equal(foldLabel(map, 'S1 Wrap'), 'Session 1');
    assert.equal(foldLabel(map, 'Other'), undefined);
    assert.equal(labels.size, 2);
  });

  it('a folded key is found however its accents are typed (NFC or NFD)', () => {
    const { nfcLookupTable } = require('../../lib/unicode');
    const { eventTemplate } = require('../../lib/templates/event');
    const nfc = 'Sesión 1 Wrap'.normalize('NFC');
    const nfd = nfc.normalize('NFD');
    const w = wrap(nfc, 'sessions/s1-wrap.html');
    const map = nfcLookupTable({ [nfc]: 'sessions/s1-wrap.html' });
    applyFold(new Map([[w, unit]]), map);
    assert.equal(foldLabel(map, nfd), 'Session 1');
    const { labelFoldedHeadings } = require('../../lib/story-fold');
    assert.equal(labelFoldedHeadings(`## [[${nfd}]]`, map), `## [[${nfd}|Session 1]]`);
    const page = { title: 'E', displayTitle: 'E', outputPath: 'events/e.html', frontmatter: { type: 'event', participants: [`[[${nfd}]]`] } };
    const html = eventTemplate(page, { html: '' }, () => '<nav></nav>', { siteTitle: 'T', footer: '', attachmentsDir: '_attachments' }, {}, map);
    assert.match(html, /<a href="[^"]*ch-s1\.html">Session 1<\/a>/);
  });

  it('a unit with no wrap-up and a non-wrap-up page fold nothing', () => {
    const notWrap = { frontmatter: { type: 'npc' }, outputPath: 'npcs/a.html' };
    const bare = { kind: 'session', outputPath: 'story/a.html', title: 'A', sourcePage: {} };
    const odd = { kind: 'session', outputPath: 'story/b.html', title: 'B', wrapUpPage: notWrap, sourcePage: {} };
    assert.equal(foldPlan([bare]).size, 0);
    assert.equal(foldPlan([odd]).size, 0);
    assert.equal(foldLabel({}, 'x'), undefined);
  });
});

describe('labelFoldedHeadings', () => {
  const { labelFoldedHeadings } = require('../../lib/story-fold');
  const folded = () => {
    const w = wrap('S1 Wrap', 'sessions/s1-wrap.html');
    const map = { 'S1 Wrap': 'sessions/s1-wrap.html', Other: 'npcs/x.html' };
    applyFold(new Map([[w, unit]]), map);
    return map;
  };

  it('labels an unaliased heading link to a folded wrap-up with the Story page title, and nothing else', () => {
    const map = folded();
    const text = '## Seen in [[S1 Wrap]]\nBody [[S1 Wrap]].\n### [[S1 Wrap#Loot]] and [[Other]]\n## [[S1 Wrap|mine]] ![[S1 Wrap]]';
    assert.equal(labelFoldedHeadings(text, map),
      '## Seen in [[S1 Wrap|Session 1]]\nBody [[S1 Wrap]].\n### [[S1 Wrap#Loot|Session 1]] and [[Other]]\n## [[S1 Wrap|mine]] ![[S1 Wrap]]');
  });

  it('leaves a heading inside a code fence as written', () => {
    const map = folded();
    const text = '```\n## [[S1 Wrap]]\n```\n## [[S1 Wrap]]';
    assert.equal(labelFoldedHeadings(text, map), '```\n## [[S1 Wrap]]\n```\n## [[S1 Wrap|Session 1]]');
  });

  it('a fence closes as CommonMark closes it: same character, at least as long, nothing after', () => {
    const map = folded();
    const text = '````\n```\n## [[S1 Wrap]]\n```js\n## [[S1 Wrap]]\n````\n## [[S1 Wrap]]';
    assert.equal(labelFoldedHeadings(text, map), '````\n```\n## [[S1 Wrap]]\n```js\n## [[S1 Wrap]]\n````\n## [[S1 Wrap|Session 1]]');
    assert.equal(labelFoldedHeadings('```\r\n## [[S1 Wrap]]\r\n```\r\n## [[S1 Wrap]]', map), '```\r\n## [[S1 Wrap]]\r\n```\r\n## [[S1 Wrap|Session 1]]');
  });

  it('returns text with no links, or a map with no fold, unchanged', () => {
    assert.equal(labelFoldedHeadings('## Plain', {}), '## Plain');
    assert.equal(labelFoldedHeadings('## [[S1 Wrap]]', { 'S1 Wrap': 'sessions/s1-wrap.html' }), '## [[S1 Wrap]]');
    assert.equal(labelFoldedHeadings(undefined, {}), '');
  });
});

// Chapter pages (PR C): on the player site a chapter note folds into its chapter page.
describe('story fold: chapter notes', () => {
  const note = { title: 'Ch', displayTitle: 'Ch', outputPath: 'chapters/ch.html', outputDir: 'chapters', frontmatter: { type: 'chapter' } };
  const c = { kind: 'chapter', outputPath: 'story/ch.html', title: 'Ch', sourcePage: note };
  const s = { kind: 'session', outputPath: 'story/ch-s1.html', title: 'S1', sourcePage: { frontmatter: { type: 'session' } } };

  it('folds with { chapters: true } only; a session unit\'s own note never folds', () => {
    assert.equal(foldPlan([c, s]).has(note), false);
    const plan = foldPlan([c, s], { chapters: true });
    assert.equal(plan.get(note), c);
    assert.equal(plan.has(s.sourcePage), false);
  });

  it('a chapter wrap-up and the chapter note both fold into the chapter page', () => {
    const w = wrap('Ch Wrap', 'chapters/ch-wrap.html');
    const plan = foldPlan([{ ...c, wrapUpPage: w }], { chapters: true });
    assert.equal(plan.get(w).outputPath, 'story/ch.html');
    assert.equal(plan.get(note).outputPath, 'story/ch.html');
  });
});
