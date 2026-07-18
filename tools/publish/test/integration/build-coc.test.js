// tools/publish/test/integration/build-coc.test.js
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const path = require('path'); const os = require('os');
const { build } = require('../../lib/build');

describe('build integration — CoC PC', () => {
  const fixturesDir = path.join(__dirname, '..', 'fixtures');
  let outputDir, configPath, html;
  before(() => {
    outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-publish-coc-'));
    configPath = path.join(outputDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      vaultPath: path.join(fixturesDir, 'with-coc-pc'),
      outputDir: path.join(outputDir, 'docs'),
      attachmentsDir: '_attachments', siteTitle: 'CoC Test',
      system: 'regency-cthulhu',
      excludeDirs: ['_meta', '_Templates'], excludeSections: [],
      folderMap: { 'Characters/PCs': 'characters/pcs' },
    }, null, 2));
    build({ configPath });
    html = fs.readFileSync(path.join(outputDir, 'docs', 'characters', 'pcs', 'jane-ashford.html'), 'utf-8');
  });
  after(() => fs.rmSync(outputDir, { recursive: true, force: true }));

  it('renders the parchment sheet root', () => assert.ok(html.includes('coc-sheet-root')));
  it('mounts the live status bar', () => assert.ok(html.includes('class="statusbar"')));
  it('renders folio tabs incl the Record tab', () => {
    assert.ok(html.includes('foliotab'));
    assert.match(html, /Investigator's Record/);
  });
  it('renders the full skill list (untouched at base)', () => {
    assert.ok(html.includes('Spot Hidden'));   // present even though the PC didn't list it
    assert.ok(html.includes('class="exp"'));    // experience boxes rendered
  });
  it('marks the active condition from the Status checklist', () => {
    assert.match(html, /cond-chip on[^>]*>\s*Indefinite Insanity/i);
  });
  it('loads the CoC client script', () => assert.match(html, /js\/coc-sheet\.js/));
  it('does not duplicate the Skills section as a loose accordion', () => {
    // "Skills" should appear in the structured sheet, not as an accordion header button
    assert.ok(!html.includes('class="accordion-header">Skills'));
  });
});
