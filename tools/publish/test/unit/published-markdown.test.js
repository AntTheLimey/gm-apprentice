const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { build } = require('../../lib/build');

const walk = d => fs.readdirSync(d, { withFileTypes: true })
  .flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);

// Regression coverage for issue #149: the publishedMarkdown chain in build.js
// (stripGmOnly -> stripSpoiler -> stripCallouts -> filterSections) never called
// stripHtmlComments, so a bare HTML comment written before real prose in a session's
// Narrative Recap section survived into two surfaces that read page.publishedMarkdown
// directly: the homepage "Latest Session" teaser (landing-data.js extractRecap) and
// every story-spine page body (story-spine.js publishedOf). processContent (the
// entity/wrap-up page path) already stripped comments, which is why only these two
// surfaces leaked (#85 -> #87 -> #149).
describe('publishedMarkdown strips HTML comments (issue #149)', () => {
  let out, docs;
  const fixtures = path.join(__dirname, '..', 'fixtures', 'html-comment-leak');

  before(() => {
    out = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-publish-html-comment-'));
    const configPath = path.join(out, 'config.json');
    docs = path.join(out, 'docs');
    fs.writeFileSync(configPath, JSON.stringify({
      vaultPath: fixtures,
      outputDir: docs,
      attachmentsDir: '_attachments',
      siteTitle: 'Comment Leak Test',
      siteUrl: 'https://example.github.io/comment-leak',
      excludeDirs: ['_meta'],
      excludeSections: [],
      folderMap: { Chapters: 'chapters' },
    }));
    build({ configPath });
  });

  after(() => fs.rmSync(out, { recursive: true, force: true }));

  it('strips the comment from the homepage "Latest Session" teaser', () => {
    const html = fs.readFileSync(path.join(docs, 'index.html'), 'utf8');
    assert.ok(html.includes('hidden passage'), 'expected recap prose to render on the homepage');
    assert.ok(!html.includes('<!--') && !html.includes('&lt;!--'), 'index.html leaked an HTML comment');
    assert.ok(!html.includes('authoring note'), 'index.html leaked the comment text');
  });

  it('strips the comment from the story-spine chronicle page', () => {
    const storyHtml = fs.readFileSync(path.join(docs, 'story', 'chapter-1-test-session-1.html'), 'utf8');
    assert.ok(storyHtml.includes('hidden passage'), 'expected recap prose to render on the story page');
    assert.ok(!storyHtml.includes('<!--') && !storyHtml.includes('&lt;!--'), 'story page leaked an HTML comment');
    assert.ok(!storyHtml.includes('authoring note'), 'story page leaked the comment text');
  });

  it('regression: no generated HTML file contains a raw or escaped HTML comment (#85 -> #87 -> #149)', () => {
    const files = walk(docs).filter(f => f.endsWith('.html'));
    assert.ok(files.length > 0, 'expected the build to produce html files');
    for (const f of files) {
      const html = fs.readFileSync(f, 'utf8');
      assert.ok(!html.includes('<!--'), `${f} contains a raw HTML comment`);
      assert.ok(!html.includes('&lt;!--'), `${f} contains an escaped HTML comment`);
    }
  });
});
