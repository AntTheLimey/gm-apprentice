const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { build } = require('../../lib/build');
const { buildLinkMap, scanVault } = require('../../lib/scanner');

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

  describe('empty fixture', () => {
    let outputDir;
    let configPath;

    before(() => {
      outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-publish-test-empty-'));
      configPath = path.join(outputDir, 'config.json');

      const config = {
        vaultPath: path.join(fixturesDir, 'empty'),
        outputDir: path.join(outputDir, 'docs'),
        attachmentsDir: '_attachments',
        siteTitle: 'Empty Test',
        excludeDirs: ['_meta', '_Templates'],
        excludeSections: [],
        folderMap: {},
      };

      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      build({ configPath });
    });

    after(() => {
      fs.rmSync(outputDir, { recursive: true, force: true });
    });

    it('build succeeds with no pages', () => {
      assert.ok(fs.existsSync(path.join(outputDir, 'docs')));
    });

    it('creates landing page even with no content', () => {
      const indexPath = path.join(outputDir, 'docs', 'index.html');
      assert.ok(fs.existsSync(indexPath));
    });

    it('creates CSS', () => {
      const cssPath = path.join(outputDir, 'docs', 'css', 'style.css');
      assert.ok(fs.existsSync(cssPath));
    });
  });

  describe('malformed fixture', () => {
    let outputDir;
    let configPath;

    before(() => {
      outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-publish-test-malformed-'));
      configPath = path.join(outputDir, 'config.json');

      const config = {
        vaultPath: path.join(fixturesDir, 'malformed'),
        outputDir: path.join(outputDir, 'docs'),
        attachmentsDir: '_attachments',
        siteTitle: 'Malformed Test',
        excludeDirs: ['_meta', '_Templates'],
        excludeSections: [],
        folderMap: {
          'Locations': 'locations',
        },
      };

      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      build({ configPath });
    });

    after(() => {
      fs.rmSync(outputDir, { recursive: true, force: true });
    });

    it('build completes despite malformed file', () => {
      assert.ok(fs.existsSync(path.join(outputDir, 'docs')));
    });

    it('renders Good File successfully', () => {
      const goodPath = path.join(outputDir, 'docs', 'locations', 'good-file.html');
      assert.ok(fs.existsSync(goodPath));
    });

    it('skips Bad YAML file (no output)', () => {
      const badPath = path.join(outputDir, 'docs', 'locations', 'bad-yaml.html');
      assert.ok(!fs.existsSync(badPath));
    });

    it('handles unresolved links gracefully', () => {
      const goodPath = path.join(outputDir, 'docs', 'locations', 'good-file.html');
      const html = fs.readFileSync(goodPath, 'utf-8');
      // Unresolved links should be rendered as text (not broken href)
      assert.ok(html.includes('Nonexistent'));
    });
  });

  describe('wiki-collisions fixture', () => {
    let outputDir;
    let configPath;
    let linkMap;

    before(() => {
      outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-publish-test-collisions-'));
      configPath = path.join(outputDir, 'config.json');

      const config = {
        vaultPath: path.join(fixturesDir, 'wiki-collisions'),
        outputDir: path.join(outputDir, 'docs'),
        attachmentsDir: '_attachments',
        siteTitle: 'Collisions Test',
        excludeDirs: ['_meta', '_Templates'],
        excludeSections: [],
        folderMap: {
          'Characters/NPCs': 'characters/npcs',
        },
      };

      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

      // Build link map to test resolution
      const pages = scanVault(config);
      linkMap = buildLinkMap(pages);

      build({ configPath });
    });

    after(() => {
      fs.rmSync(outputDir, { recursive: true, force: true });
    });

    it('creates both John and Jane pages', () => {
      assert.ok(fs.existsSync(path.join(outputDir, 'docs', 'characters', 'npcs', 'john.html')));
      assert.ok(fs.existsSync(path.join(outputDir, 'docs', 'characters', 'npcs', 'jane.html')));
    });

    it('canonical title wins over alias', () => {
      // Link to "John" should resolve to john.html, not jane.html
      assert.strictEqual(linkMap['John'], 'characters/npcs/john.html');
    });
  });

  describe('superseded-entities fixture', () => {
    let outputDir;
    let configPath;
    let linkMap;

    before(() => {
      outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-publish-test-superseded-'));
      configPath = path.join(outputDir, 'config.json');

      const config = {
        vaultPath: path.join(fixturesDir, 'superseded-entities'),
        outputDir: path.join(outputDir, 'docs'),
        attachmentsDir: '_attachments',
        siteTitle: 'Superseded Test',
        excludeDirs: ['_meta', '_Templates'],
        excludeSections: [],
        folderMap: {
          'Characters/NPCs': 'characters/npcs',
        },
      };

      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

      // Build link map to test redirect behavior
      const pages = scanVault(config);
      linkMap = buildLinkMap(pages);

      build({ configPath });
    });

    after(() => {
      fs.rmSync(outputDir, { recursive: true, force: true });
    });

    it('creates both pages', () => {
      assert.ok(fs.existsSync(path.join(outputDir, 'docs', 'characters', 'npcs', 'new-name.html')));
      assert.ok(fs.existsSync(path.join(outputDir, 'docs', 'characters', 'npcs', 'old-name.html')));
    });

    it('link map redirects Old Name to New Name', () => {
      // Old Name should redirect to new-name.html
      assert.strictEqual(linkMap['Old Name'], 'characters/npcs/new-name.html');
    });

    it('New Name resolves to itself', () => {
      assert.strictEqual(linkMap['New Name'], 'characters/npcs/new-name.html');
    });
  });

  describe('clean-schema fixture', () => {
    let outputDir;
    let configPath;

    before(() => {
      outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-publish-test-clean-'));
      configPath = path.join(outputDir, 'config.json');

      const config = {
        vaultPath: path.join(fixturesDir, 'clean-schema'),
        outputDir: path.join(outputDir, 'docs'),
        attachmentsDir: '_attachments',
        siteTitle: 'Clean Schema Test',
        excludeDirs: ['_meta', '_Templates'],
        excludeSections: [],
        folderMap: {
          '_Campaign': 'campaign',
          'Characters/PCs': 'characters/pcs',
          'Characters/NPCs': 'characters/npcs',
          'Locations': 'locations',
          'Factions & Organizations': 'factions',
          'Events': 'events',
          'Items & Artifacts': 'items',
        },
      };

      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      build({ configPath });
    });

    after(() => {
      fs.rmSync(outputDir, { recursive: true, force: true });
    });

    it('maps _Campaign correctly', () => {
      const campaignPath = path.join(outputDir, 'docs', 'campaign', 'campaign-overview.html');
      assert.ok(fs.existsSync(campaignPath));
    });

    it('maps Characters/PCs correctly', () => {
      const pcPath = path.join(outputDir, 'docs', 'characters', 'pcs', 'hero.html');
      assert.ok(fs.existsSync(pcPath));
    });

    it('maps Characters/NPCs correctly', () => {
      const npcPath = path.join(outputDir, 'docs', 'characters', 'npcs', 'villain.html');
      assert.ok(fs.existsSync(npcPath));
    });

    it('maps Locations correctly', () => {
      const locPath = path.join(outputDir, 'docs', 'locations', 'city.html');
      assert.ok(fs.existsSync(locPath));
    });

    it('maps Factions & Organizations correctly', () => {
      const factionPath = path.join(outputDir, 'docs', 'factions', 'guild.html');
      assert.ok(fs.existsSync(factionPath));
    });

    it('maps Events correctly', () => {
      const eventPath = path.join(outputDir, 'docs', 'events', 'battle.html');
      assert.ok(fs.existsSync(eventPath));
    });

    it('maps Items & Artifacts correctly', () => {
      const itemPath = path.join(outputDir, 'docs', 'items', 'sword.html');
      assert.ok(fs.existsSync(itemPath));
    });
  });

  describe('unusual-schema fixture', () => {
    let outputDir;
    let configPath;

    before(() => {
      outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-publish-test-unusual-'));
      configPath = path.join(outputDir, 'config.json');

      const config = {
        vaultPath: path.join(fixturesDir, 'unusual-schema'),
        outputDir: path.join(outputDir, 'docs'),
        attachmentsDir: '_attachments',
        siteTitle: 'Unusual Schema Test',
        excludeDirs: ['_meta', '_Templates'],
        excludeSections: [],
        folderMap: {
          'My NPCs': 'npcs',
          'Places': 'locations',
        },
      };

      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      build({ configPath });
    });

    after(() => {
      fs.rmSync(outputDir, { recursive: true, force: true });
    });

    it('skips files without frontmatter', () => {
      // Readme.md has no frontmatter, should not appear in output
      const readmePath = path.join(outputDir, 'docs', 'readme.html');
      assert.ok(!fs.existsSync(readmePath));
    });

    it('maps unusual folder names with custom folderMap', () => {
      const bobPath = path.join(outputDir, 'docs', 'npcs', 'bob.html');
      assert.ok(fs.existsSync(bobPath));
    });

    it('maps non-standard location folder', () => {
      const townPath = path.join(outputDir, 'docs', 'locations', 'town.html');
      assert.ok(fs.existsSync(townPath));
    });
  });
});
