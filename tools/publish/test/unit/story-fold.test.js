const { describe, it } = require('node:test');
const assert = require('node:assert');
const { foldPlan, applyFold, isFolded, foldLabel } = require('../../lib/story-fold');

const wrap = (title, outputPath = 'sessions/x.html') => ({ displayTitle: title, outputPath, outputDir: 'sessions', frontmatter: { type: 'session-wrap-up' } });
const unit = { kind: 'session', outputPath: 'story/ch-s1.html', title: 'Session 1', sourcePage: {} };

describe('story fold', () => {
  it('a session wrap-up folds into its session unit; the chapter does not take it', () => {
    const w = wrap('S1 Wrap');
    const s = { kind: 'session', outputPath: 'story/ch-s1.html', title: 'Session 1', wrapUpPage: w, sourcePage: {} };
    const c = { kind: 'chapter-intro', outputPath: 'story/ch-intro.html', title: 'Ch', wrapUpPage: w, sourcePage: {} };
    assert.equal(foldPlan([c, s]).get(w), s);
    assert.equal(foldPlan([s, c]).get(w), s);
  });

  it('a chapter claims a wrap-up no session wants', () => {
    const w = wrap('Ch Wrap');
    const c = { kind: 'chapter-intro', outputPath: 'story/ch-intro.html', title: 'Ch', wrapUpPage: w, sourcePage: {} };
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

  it('returns text with no links, or a map with no fold, unchanged', () => {
    assert.equal(labelFoldedHeadings('## Plain', {}), '## Plain');
    assert.equal(labelFoldedHeadings('## [[S1 Wrap]]', { 'S1 Wrap': 'sessions/s1-wrap.html' }), '## [[S1 Wrap]]');
    assert.equal(labelFoldedHeadings(undefined, {}), '');
  });
});
