const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { build } = require('../../lib/build');

describe('build integration', () => {
  const fixturesDir = path.join(__dirname, '..', 'fixtures');

  describe('minimal fixture', () => {
    let outputDir;
    let configPath;

    before(() => {
      outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-publish-test-'));
      configPath = path.join(outputDir, 'config.json');

      const config = {
        vaultPath: path.join(fixturesDir, 'minimal'),
        outputDir: path.join(outputDir, 'docs'),
        attachmentsDir: '_attachments',
        siteTitle: 'Test Site',
        excludeDirs: ['_meta', '_Templates'],
        excludeSections: ['Player Notes'],
        folderMap: {
          '_Campaign': 'campaign',
          'Characters/PCs': 'characters/pcs',
          'Characters/NPCs': 'characters/npcs',
          'Locations': 'locations',
        },
      };

      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

      // Run build once for all tests
      build({ configPath });
    });

    after(() => {
      fs.rmSync(outputDir, { recursive: true, force: true });
    });

    it('creates output directory', () => {
      assert.ok(fs.existsSync(path.join(outputDir, 'docs')));
    });

    it('creates landing page', () => {
      const indexPath = path.join(outputDir, 'docs', 'index.html');
      assert.ok(fs.existsSync(indexPath));
      const html = fs.readFileSync(indexPath, 'utf-8');
      assert.ok(html.includes('Test Site'));
    });

    it('creates PC page', () => {
      const pcPath = path.join(outputDir, 'docs', 'characters', 'pcs', 'test-pc.html');
      assert.ok(fs.existsSync(pcPath));
      const html = fs.readFileSync(pcPath, 'utf-8');
      assert.ok(html.includes('Test PC'));
      assert.ok(html.includes('Test Player'));
    });

    it('creates NPC page', () => {
      const npcPath = path.join(outputDir, 'docs', 'characters', 'npcs', 'test-npc.html');
      assert.ok(fs.existsSync(npcPath));
    });

    it('creates Location page', () => {
      const locPath = path.join(outputDir, 'docs', 'locations', 'test-location.html');
      assert.ok(fs.existsSync(locPath));
    });

    it('copies CSS', () => {
      const cssPath = path.join(outputDir, 'docs', 'css', 'style.css');
      assert.ok(fs.existsSync(cssPath));
    });

    it('creates .nojekyll', () => {
      const nojekyllPath = path.join(outputDir, 'docs', '.nojekyll');
      assert.ok(fs.existsSync(nojekyllPath));
    });
  });
});
