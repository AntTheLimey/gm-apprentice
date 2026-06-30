const { describe, it } = require('node:test');
const assert = require('node:assert');
const { storyPage } = require('../../lib/templates/story');

const cfg = { siteTitle: 'Test Campaign' };
const pub = {};

describe('storyPage', () => {
  const unit = {
    kind: 'session', outputPath: 'story/s1.html', title: 'Session 1', chapterTitle: 'Chapter 1',
    recapHtml: '<p>The party arrived.</p>', prevHref: null, nextHref: 'story/s2.html', refsHtml: '',
  };
  it('leads with the recap prose and the unit title', () => {
    const html = storyPage(unit, cfg, pub, () => '');
    assert.match(html, /The party arrived\./);
    assert.match(html, /Session 1/);
  });
  it('renders a next link (relative) and no prev link at the start', () => {
    const html = storyPage(unit, cfg, pub, () => '');
    assert.match(html, /href="s2\.html"/);
    assert.ok(!/&larr;/.test(html), 'no prev arrow at the start');
  });
});
