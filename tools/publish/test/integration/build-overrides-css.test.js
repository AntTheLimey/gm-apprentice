const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { build } = require('../../lib/build');

const fixturesDir = path.join(__dirname, '..', 'fixtures');

function setupSite({ withOverrides }) {
  const siteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-publish-overrides-'));
  const configPath = path.join(siteDir, 'config.json');
  const outputDir = path.join(siteDir, 'docs');

  fs.writeFileSync(configPath, JSON.stringify({
    vaultPath: path.join(fixturesDir, 'minimal'),
    outputDir,
    attachmentsDir: '_attachments',
    siteTitle: 'Overrides Site',
    siteUrl: 'https://example.github.io/overrides-site',
    excludeDirs: ['_meta', '_Templates'],
    folderMap: {
      '_Campaign': 'campaign',
      'Characters/PCs': 'characters/pcs',
      'Characters/NPCs': 'characters/npcs',
      'Locations': 'locations',
    },
  }, null, 2));

  if (withOverrides) {
    fs.mkdirSync(path.join(siteDir, 'css'), { recursive: true });
    fs.writeFileSync(path.join(siteDir, 'css/overrides.css'), ':root { --accent: #8b0000; }\n');
  }

  build({ configPath });
  return { siteDir, outputDir };
}

describe('css/overrides.css is the site customization seam', () => {
  describe('when the site scaffolds one', () => {
    let outputDir;
    before(() => { ({ outputDir } = setupSite({ withOverrides: true })); });

    it('copies it into the output css/ directory verbatim', () => {
      const copied = path.join(outputDir, 'css/overrides.css');
      assert.ok(fs.existsSync(copied), 'expected docs/css/overrides.css');
      assert.match(fs.readFileSync(copied, 'utf8'), /--accent: #8b0000/);
    });

    it('links it from a nested entity page with the right relative depth', () => {
      const html = fs.readFileSync(path.join(outputDir, 'characters/npcs/test-npc.html'), 'utf8');
      assert.ok(html.includes('<link rel="stylesheet" href="../../css/overrides.css">'));
    });

    it('links it last so it wins the cascade over theme.css', () => {
      const html = fs.readFileSync(path.join(outputDir, 'index.html'), 'utf8');
      const head = html.slice(0, html.indexOf('</head>'));
      assert.ok(head.indexOf('css/overrides.css') > head.indexOf('css/theme.css'),
        'overrides.css must be linked after theme.css');
      assert.ok(head.indexOf('css/overrides.css') > head.indexOf('css/style.css'),
        'overrides.css must be linked after style.css');
    });

    it('links it from index pages and the 404 page too', () => {
      const indexPage = fs.readFileSync(path.join(outputDir, 'locations/index.html'), 'utf8');
      assert.ok(indexPage.includes('css/overrides.css'));
      const fourOhFour = fs.readFileSync(path.join(outputDir, '404.html'), 'utf8');
      assert.ok(fourOhFour.includes('css/overrides.css'));
    });
  });

  describe('when the site has none', () => {
    let outputDir;
    before(() => { ({ outputDir } = setupSite({ withOverrides: false })); });

    it('writes no overrides.css', () => {
      assert.ok(!fs.existsSync(path.join(outputDir, 'css/overrides.css')));
    });

    it('emits no link tag that would 404', () => {
      for (const page of ['index.html', '404.html', 'locations/index.html']) {
        const html = fs.readFileSync(path.join(outputDir, page), 'utf8');
        assert.ok(!html.includes('overrides.css'), `${page} should not link overrides.css`);
      }
    });
  });
});
