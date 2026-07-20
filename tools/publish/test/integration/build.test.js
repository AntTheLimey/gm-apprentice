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
        siteUrl: 'https://example.github.io/test-site',
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

    it('PC page renders display_meta fields', () => {
      const pcPath = path.join(outputDir, 'docs', 'characters', 'pcs', 'meta-pc.html');
      assert.ok(fs.existsSync(pcPath));
      const html = fs.readFileSync(pcPath, 'utf-8');
      assert.ok(html.includes('Point Total'), 'Should render point_total label');
      assert.ok(html.includes('150'), 'Should render point_total value');
      assert.ok(html.includes('Meta PC'), 'Should render displayTitle without underscores');
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

    it('renders event with header card', () => {
      const eventPath = path.join(outputDir, 'docs', 'events', 'battle.html');
      const html = fs.readFileSync(eventPath, 'utf-8');
      assert.ok(html.includes('char-header'));
      assert.ok(html.includes('Battle'));
    });

    it('renders event type badge', () => {
      const eventPath = path.join(outputDir, 'docs', 'events', 'battle.html');
      const html = fs.readFileSync(eventPath, 'utf-8');
      assert.ok(html.includes('metadata-badge'));
      assert.ok(html.includes('battle'));
    });

    it('renders event date in meta row', () => {
      const eventPath = path.join(outputDir, 'docs', 'events', 'battle.html');
      const html = fs.readFileSync(eventPath, 'utf-8');
      assert.ok(html.includes('June 15, 1943'));
    });

    it('renders event location as link', () => {
      const eventPath = path.join(outputDir, 'docs', 'events', 'battle.html');
      const html = fs.readFileSync(eventPath, 'utf-8');
      assert.ok(html.includes('City'));
      assert.ok(html.includes('href='));
    });

    it('renders outcome callout', () => {
      const eventPath = path.join(outputDir, 'docs', 'events', 'battle.html');
      const html = fs.readFileSync(eventPath, 'utf-8');
      assert.ok(html.includes('event-outcome'));
      assert.ok(html.includes('liberated'));
    });

    it('renders participants list with links and annotations', () => {
      const eventPath = path.join(outputDir, 'docs', 'events', 'battle.html');
      const html = fs.readFileSync(eventPath, 'utf-8');
      assert.ok(html.includes('event-participants'));
      assert.ok(html.includes('Hero'));
      assert.ok(html.includes('led the assault'));
      assert.ok(html.includes('Allied soldiers'));
    });

    it('renders linked participant as anchor tag', () => {
      const eventPath = path.join(outputDir, 'docs', 'events', 'battle.html');
      const html = fs.readFileSync(eventPath, 'utf-8');
      const heroLinkPattern = /href="[^"]*hero\.html"/;
      assert.ok(heroLinkPattern.test(html), 'Hero participant should be a link');
    });

    it('renders plain-text participant without link', () => {
      const eventPath = path.join(outputDir, 'docs', 'events', 'battle.html');
      const html = fs.readFileSync(eventPath, 'utf-8');
      assert.ok(html.includes('Allied soldiers'));
      assert.ok(!html.includes('>Allied soldiers</a>'));
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

  describe('with-creature fixture', () => {
    let outputDir;
    let configPath;

    before(() => {
      outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-publish-creature-'));
      configPath = path.join(outputDir, 'config.json');

      const config = {
        vaultPath: path.join(fixturesDir, 'with-creature'),
        outputDir: path.join(outputDir, 'docs'),
        attachmentsDir: '_attachments',
        siteTitle: 'Creature Test',
        excludeDirs: ['_meta'],
        excludeSections: [],
        folderMap: {
          'Creatures': 'creatures',
        },
      };

      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      build({ configPath });
    });

    after(() => {
      fs.rmSync(outputDir, { recursive: true, force: true });
    });

    it('creates creature page with stat block', () => {
      const creaturePath = path.join(outputDir, 'docs', 'creatures', 'test-creature.html');
      assert.ok(fs.existsSync(creaturePath));
      const html = fs.readFileSync(creaturePath, 'utf-8');
      assert.ok(html.includes('stat-block'));
      assert.ok(html.includes('HP'));
      assert.ok(html.includes('15'));
    });

    it('renders abilities list', () => {
      const creaturePath = path.join(outputDir, 'docs', 'creatures', 'test-creature.html');
      const html = fs.readFileSync(creaturePath, 'utf-8');
      assert.ok(html.includes('Night Vision'));
    });

    it('renders weaknesses list', () => {
      const creaturePath = path.join(outputDir, 'docs', 'creatures', 'test-creature.html');
      const html = fs.readFileSync(creaturePath, 'utf-8');
      assert.ok(html.includes('Vulnerable to fire'));
    });

    it('renders creature type badge', () => {
      const creaturePath = path.join(outputDir, 'docs', 'creatures', 'test-creature.html');
      const html = fs.readFileSync(creaturePath, 'utf-8');
      assert.ok(html.includes('Undead'));
    });

    it('renders threat level badge', () => {
      const creaturePath = path.join(outputDir, 'docs', 'creatures', 'test-creature.html');
      const html = fs.readFileSync(creaturePath, 'utf-8');
      assert.ok(html.includes('Threat: High'));
    });
  });

  describe('with-item fixture', () => {
    let outputDir;
    let configPath;

    before(() => {
      outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-publish-item-'));
      configPath = path.join(outputDir, 'config.json');

      const config = {
        vaultPath: path.join(fixturesDir, 'with-item'),
        outputDir: path.join(outputDir, 'docs'),
        attachmentsDir: '_attachments',
        siteTitle: 'Item Test',
        excludeDirs: ['_meta'],
        excludeSections: [],
        folderMap: {
          'Items & Artifacts': 'items',
          'Characters/NPCs': 'characters/npcs',
        },
      };

      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      build({ configPath });
    });

    after(() => {
      fs.rmSync(outputDir, { recursive: true, force: true });
    });

    it('creates item page with stat block', () => {
      const itemPath = path.join(outputDir, 'docs', 'items', 'test-sword.html');
      assert.ok(fs.existsSync(itemPath));
      const html = fs.readFileSync(itemPath, 'utf-8');
      assert.ok(html.includes('stat-block'));
      assert.ok(html.includes('Damage'));
      assert.ok(html.includes('2d+1 cut'));
    });

    it('renders item type badge', () => {
      const itemPath = path.join(outputDir, 'docs', 'items', 'test-sword.html');
      const html = fs.readFileSync(itemPath, 'utf-8');
      assert.ok(html.includes('Weapon'));
    });

    it('renders rarity badge', () => {
      const itemPath = path.join(outputDir, 'docs', 'items', 'test-sword.html');
      const html = fs.readFileSync(itemPath, 'utf-8');
      assert.ok(html.includes('Rare'));
    });

    it('renders holder link', () => {
      const itemPath = path.join(outputDir, 'docs', 'items', 'test-sword.html');
      const html = fs.readFileSync(itemPath, 'utf-8');
      assert.ok(html.includes('Current Holder'));
      assert.ok(html.includes('Test Hero'));
      // Should be a link to the holder page
      assert.ok(html.includes('href='));
    });

    it('creates holder NPC page', () => {
      const heroPath = path.join(outputDir, 'docs', 'characters', 'npcs', 'test-hero.html');
      assert.ok(fs.existsSync(heroPath));
    });
  });

  describe('with-faction fixture', () => {
    let outputDir;
    let configPath;

    before(() => {
      outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-publish-faction-'));
      configPath = path.join(outputDir, 'config.json');

      const config = {
        vaultPath: path.join(fixturesDir, 'with-faction'),
        outputDir: path.join(outputDir, 'docs'),
        attachmentsDir: '_attachments',
        siteTitle: 'Faction Test',
        excludeDirs: ['_meta'],
        excludeSections: [],
        folderMap: {
          'Factions & Organizations': 'factions',
          'Characters/NPCs': 'characters/npcs',
        },
      };

      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      build({ configPath });
    });

    after(() => {
      fs.rmSync(outputDir, { recursive: true, force: true });
    });

    it('creates faction page', () => {
      const factionPath = path.join(outputDir, 'docs', 'factions', 'test-guild.html');
      assert.ok(fs.existsSync(factionPath));
    });

    it('renders faction type badge', () => {
      const factionPath = path.join(outputDir, 'docs', 'factions', 'test-guild.html');
      const html = fs.readFileSync(factionPath, 'utf-8');
      assert.ok(html.includes('Guild'));
    });

    it('renders goals list', () => {
      const factionPath = path.join(outputDir, 'docs', 'factions', 'test-guild.html');
      const html = fs.readFileSync(factionPath, 'utf-8');
      assert.ok(html.includes('Goals'));
      assert.ok(html.includes('Control the trade routes'));
      assert.ok(html.includes('Expand influence'));
    });

    it('renders leadership link', () => {
      const factionPath = path.join(outputDir, 'docs', 'factions', 'test-guild.html');
      const html = fs.readFileSync(factionPath, 'utf-8');
      assert.ok(html.includes('Leadership'));
      assert.ok(html.includes('Guild Master'));
    });

    it('renders member rollup with both Guild Master and Guild Member', () => {
      const factionPath = path.join(outputDir, 'docs', 'factions', 'test-guild.html');
      const html = fs.readFileSync(factionPath, 'utf-8');
      assert.ok(html.includes('Members'));
      assert.ok(html.includes('Guild Master'));
      assert.ok(html.includes('Guild Member'));
    });

    it('creates member NPC pages', () => {
      const masterPath = path.join(outputDir, 'docs', 'characters', 'npcs', 'guild-master.html');
      const memberPath = path.join(outputDir, 'docs', 'characters', 'npcs', 'guild-member.html');
      assert.ok(fs.existsSync(masterPath));
      assert.ok(fs.existsSync(memberPath));
    });
  });

  describe('minimal fixture — regressions', () => {
    let outputDir;
    let configPath;

    before(() => {
      outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-publish-test-regress-'));
      configPath = path.join(outputDir, 'config.json');
      fs.writeFileSync(configPath, JSON.stringify({
        vaultPath: path.join(fixturesDir, 'minimal'),
        outputDir: path.join(outputDir, 'docs'),
        attachmentsDir: '_attachments',
        siteTitle: 'Regression Test',
        siteUrl: 'https://example.github.io/t',
        excludeDirs: ['_meta'],
        excludeSections: [],
        folderMap: {
          '_Campaign': 'campaign',
          'Characters/PCs': 'characters/pcs',
          'Characters/NPCs': 'characters/npcs',
          'Locations': 'locations',
        },
      }, null, 2));
      build({ configPath });
    });

    after(() => {
      fs.rmSync(outputDir, { recursive: true, force: true });
    });

    it('generates the aggregate characters index the homepage card links to (issue #84)', () => {
      const indexPath = path.join(outputDir, 'docs', 'characters', 'index.html');
      assert.ok(fs.existsSync(indexPath), 'characters/index.html must exist');
      const html = fs.readFileSync(indexPath, 'utf-8');
      assert.ok(html.includes('Test PC'), 'aggregate index lists PCs');
      assert.ok(html.includes('Test NPC'), 'aggregate index lists NPCs');

      const landing = fs.readFileSync(path.join(outputDir, 'docs', 'index.html'), 'utf-8');
      if (landing.includes('href="characters/index.html"')) {
        assert.ok(fs.existsSync(indexPath), 'homepage Characters card must not dangle');
      }
    });

    it('strips HTML comments instead of printing them (issue #85)', () => {
      const html = fs.readFileSync(path.join(outputDir, 'docs', 'locations', 'test-location.html'), 'utf-8');
      assert.ok(!html.includes('UNVERIFIED'), 'private authoring note must not reach the page');
      assert.ok(!html.includes('&lt;!--'));
      assert.ok(html.includes('A test location.'));
    });

    it('renders Obsidian callouts as callouts (issue #86a)', () => {
      const html = fs.readFileSync(path.join(outputDir, 'docs', 'locations', 'test-location.html'), 'utf-8');
      assert.ok(html.includes('class="callout callout-info"'));
      assert.ok(html.includes('<div class="callout-title">Reconstruction Note</div>'));
      assert.ok(!html.includes('[!info]'));
    });
  });

  describe('manifest publishing backstop (issue #80)', () => {
    it('warns when a Publishing entry matches no scanned page', () => {
      const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-publish-test-warn-'));
      const configPath = path.join(outputDir, 'config.json');
      fs.writeFileSync(configPath, JSON.stringify({
        vaultPath: path.join(fixturesDir, 'with-manifest'),
        outputDir: path.join(outputDir, 'docs'),
        attachmentsDir: '_attachments',
        siteTitle: 'Manifest Warn',
        siteUrl: 'https://example.github.io/t',
        excludeDirs: ['_meta'],
        excludeSections: [],
        folderMap: { 'Characters/NPCs': 'characters/npcs', Locations: 'locations', Sessions: 'sessions' },
      }, null, 2));

      const warnings = [];
      const realWarn = console.warn;
      console.warn = (...args) => warnings.push(args.join(' '));
      try {
        build({ configPath });
      } finally {
        console.warn = realWarn;
        fs.rmSync(outputDir, { recursive: true, force: true });
      }

      assert.ok(warnings.some(w => w.includes('Locations/Typo In This Path.md') && w.includes('no such page was scanned')),
        `expected an unmatched-entry warning, got: ${JSON.stringify(warnings)}`);
      assert.ok(!warnings.some(w => w.includes('Locations/Tavern.md')),
        'an annotated but valid entry must not warn');
    });

    it('warns when a played session is in the vault but absent from the manifest (#101)', () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-publish-test-unreg-'));
      const vault = path.join(tmp, 'vault');
      fs.cpSync(path.join(fixturesDir, 'with-manifest'), vault, { recursive: true });
      // A played session written by wrap-up but never registered (neither Publishing nor Excluded).
      fs.writeFileSync(path.join(vault, 'Sessions', 'Unregistered Session.md'),
        '---\ntype: session_wrap\nsession_number: 6\ncanon_status: AUTHORITATIVE\naliases: []\ntags: []\n---\n\n## Recap\n\nThe job went sideways.\n');

      const configPath = path.join(tmp, 'config.json');
      fs.writeFileSync(configPath, JSON.stringify({
        vaultPath: vault,
        outputDir: path.join(tmp, 'docs'),
        attachmentsDir: '_attachments',
        siteTitle: 'Unreg',
        siteUrl: 'https://example.github.io/t',
        excludeDirs: ['_meta', '_Templates'],
        excludeSections: ['GM Notes'],
        folderMap: { 'Characters/NPCs': 'characters/npcs', Locations: 'locations', Sessions: 'sessions' },
      }, null, 2));

      const warnings = [];
      const realWarn = console.warn;
      console.warn = (...args) => warnings.push(args.join(' '));
      try {
        build({ configPath });
      } finally {
        console.warn = realWarn;
        fs.rmSync(tmp, { recursive: true, force: true });
      }

      assert.ok(warnings.some(w => w.includes('Sessions/Unregistered Session.md') && w.includes('not in the publish manifest')),
        `expected an unregistered-session warning, got: ${JSON.stringify(warnings)}`);
      // The deliberately-excluded prep session (Reason: prep) is a decision, not an oversight — no warning.
      assert.ok(!warnings.some(w => w.includes('Planned Session.md') && w.includes('not in the publish manifest')),
        'a deliberately excluded session must not warn');
    });

    it('does NOT warn about an unregistered session in full/GM mode (manifest not enforced)', () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-publish-test-full-'));
      const vault = path.join(tmp, 'vault');
      fs.cpSync(path.join(fixturesDir, 'with-manifest'), vault, { recursive: true });
      // Flip the vault to full mode, where the manifest is loaded but NOT enforced as an allowlist,
      // so an unregistered session still publishes — the "will NOT publish" warning would lie.
      const vcPath = path.join(vault, '_meta', 'vault-config.md');
      fs.writeFileSync(vcPath, fs.readFileSync(vcPath, 'utf-8').replace('mode: player', 'mode: full'));
      fs.writeFileSync(path.join(vault, 'Sessions', 'Unregistered Session.md'),
        '---\ntype: session_wrap\nsession_number: 6\ncanon_status: AUTHORITATIVE\naliases: []\ntags: []\n---\n\n## Recap\n\nStill played.\n');

      const configPath = path.join(tmp, 'config.json');
      fs.writeFileSync(configPath, JSON.stringify({
        vaultPath: vault,
        outputDir: path.join(tmp, 'docs'),
        attachmentsDir: '_attachments',
        siteTitle: 'Full',
        siteUrl: 'https://example.github.io/t',
        excludeDirs: ['_meta', '_Templates'],
        excludeSections: ['GM Notes'],
        folderMap: { 'Characters/NPCs': 'characters/npcs', Locations: 'locations', Sessions: 'sessions' },
      }, null, 2));

      const warnings = [];
      const realWarn = console.warn;
      console.warn = (...args) => warnings.push(args.join(' '));
      try {
        build({ configPath });
      } finally {
        console.warn = realWarn;
        fs.rmSync(tmp, { recursive: true, force: true });
      }

      assert.ok(!warnings.some(w => w.includes('not in the publish manifest')),
        `full mode must not emit the unregistered-session warning, got: ${JSON.stringify(warnings)}`);
    });
  });

  describe('with-manifest fixture', () => {
    let outputDir;
    let configPath;

    before(() => {
      outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-publish-test-manifest-'));
      configPath = path.join(outputDir, 'config.json');

      const config = {
        vaultPath: path.join(fixturesDir, 'with-manifest'),
        outputDir: path.join(outputDir, 'docs'),
        attachmentsDir: '_attachments',
        siteTitle: 'Manifest Test',
        siteUrl: 'https://example.github.io/test-campaign',
        excludeDirs: ['_meta', '_Templates'],
        excludeSections: ['GM Notes'],
        folderMap: {
          'Characters/NPCs': 'characters/npcs',
          'Locations': 'locations',
          'Sessions': 'sessions',
        },
      };

      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      build({ configPath });
    });

    after(() => {
      fs.rmSync(outputDir, { recursive: true, force: true });
    });

    it('publishes files listed in manifest', () => {
      assert.ok(fs.existsSync(path.join(outputDir, 'docs', 'characters', 'npcs', 'public-npc.html')));
      assert.ok(fs.existsSync(path.join(outputDir, 'docs', 'locations', 'tavern.html')));
    });

    it('excludes files not in manifest publishing list', () => {
      assert.ok(!fs.existsSync(path.join(outputDir, 'docs', 'characters', 'npcs', 'secret-villain.html')));
      assert.ok(!fs.existsSync(path.join(outputDir, 'docs', 'sessions', 'planned-session.html')));
    });

    it('strips GM Notes sections from published pages', () => {
      const html = fs.readFileSync(path.join(outputDir, 'docs', 'characters', 'npcs', 'public-npc.html'), 'utf-8');
      assert.ok(!html.includes('Crimson Court'));
      assert.ok(html.includes('friendly face'));
    });

    it('strips gm-only inline markers from published pages', () => {
      const html = fs.readFileSync(path.join(outputDir, 'docs', 'locations', 'tavern.html'), 'utf-8');
      assert.ok(!html.includes('smuggler tunnels'));
      assert.ok(!html.includes('gm-only'));
      assert.ok(html.includes('notice board'));
    });

    it('strips excluded frontmatter fields', () => {
      const html = fs.readFileSync(path.join(outputDir, 'docs', 'characters', 'npcs', 'public-npc.html'), 'utf-8');
      assert.ok(!html.includes('Actually a spy'));
    });

    it('generates 404.html', () => {
      const fourOhFour = path.join(outputDir, 'docs', '404.html');
      assert.ok(fs.existsSync(fourOhFour));
      const html = fs.readFileSync(fourOhFour, 'utf-8');
      assert.ok(html.includes('The stars are not yet right'));
    });

    it('generates theme.css', () => {
      // This fixture's vault-config sets theme.genre: horror with no explicit
      // fonts, so the preset CSS owns colors and fonts — theme.css should
      // carry no overrides rather than clobbering the preset with defaults.
      const themePath = path.join(outputDir, 'docs', 'css', 'theme.css');
      assert.ok(fs.existsSync(themePath));
      const css = fs.readFileSync(themePath, 'utf-8');
      assert.strictEqual(css, '/* Genre preset active — no overrides */\n');
    });
  });

  describe('with-dashboard fixture', () => {
    let outputDir;
    let configPath;

    before(() => {
      outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-publish-test-dashboard-'));
      configPath = path.join(outputDir, 'config.json');

      const config = {
        vaultPath: path.join(fixturesDir, 'with-dashboard'),
        outputDir: path.join(outputDir, 'docs'),
        attachmentsDir: '_attachments',
        siteTitle: 'Dashboard Test',
        excludeDirs: ['_meta', '_Templates'],
        excludeSections: [],
        folderMap: {
          'Characters/PCs': 'characters/pcs',
          'Characters/NPCs': 'characters/npcs',
          'Sessions': 'sessions',
          'Locations': 'locations',
        },
      };

      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      build({ configPath });
    });

    after(() => {
      fs.rmSync(outputDir, { recursive: true, force: true });
    });

    it('landing page contains hero with site title', () => {
      const html = fs.readFileSync(path.join(outputDir, 'docs', 'index.html'), 'utf-8');
      assert.ok(html.includes('Dashboard Test'));
      assert.ok(html.includes('landing-hero'));
    });

    it('landing page shows session count in hero', () => {
      const html = fs.readFileSync(path.join(outputDir, 'docs', 'index.html'), 'utf-8');
      assert.ok(html.includes('Sessions'));
      assert.ok(html.includes('hero-dates'));
    });

    it('landing page shows in-game year from setting_year', () => {
      const html = fs.readFileSync(path.join(outputDir, 'docs', 'index.html'), 'utf-8');
      assert.ok(html.includes('In-Game'));
      assert.ok(html.includes('2019'));
    });

    it('landing page shows Latest Session section with recap', () => {
      const html = fs.readFileSync(path.join(outputDir, 'docs', 'index.html'), 'utf-8');
      assert.ok(html.includes('Latest Session'));
      assert.ok(html.includes('class="recap"'));
      assert.ok(html.includes('infiltrated the cave complex'));
    });

    it('recap links to latest session page', () => {
      const html = fs.readFileSync(path.join(outputDir, 'docs', 'index.html'), 'utf-8');
      assert.ok(html.includes('recap-link'));
      assert.ok(html.includes('sessions/session-2.html'));
    });

    it('landing page shows The Team section with PC cards', () => {
      const html = fs.readFileSync(path.join(outputDir, 'docs', 'index.html'), 'utf-8');
      assert.ok(html.includes('The Team'));
      assert.ok(html.includes('pc-roster'));
      assert.ok(html.includes('Guy LeFleur'));
      assert.ok(html.includes('Ronnie Vint'));
    });

    it('PC cards show key traits', () => {
      const html = fs.readFileSync(path.join(outputDir, 'docs', 'index.html'), 'utf-8');
      assert.ok(html.includes('Hot-tempered'));
      assert.ok(html.includes('Resourceful'));
    });

    it('landing page shows Explore the World section', () => {
      const html = fs.readFileSync(path.join(outputDir, 'docs', 'index.html'), 'utf-8');
      assert.ok(html.includes('Explore the World'));
      assert.ok(html.includes('explore-grid'));
      assert.ok(html.includes('Locations'));
    });

    it('explore grid excludes PC and NPC categories', () => {
      const html = fs.readFileSync(path.join(outputDir, 'docs', 'index.html'), 'utf-8');
      const exploreGridMatch = html.match(/class="explore-grid">([\s\S]*?)<\/div>\s*<\/div>/);
      const exploreGridHtml = exploreGridMatch ? exploreGridMatch[1] : '';
      assert.ok(!exploreGridHtml.includes('>Player Characters<'));
    });

    it('landing page shows In Memoriam section for dead PCs', () => {
      const html = fs.readFileSync(path.join(outputDir, 'docs', 'index.html'), 'utf-8');
      assert.ok(html.includes('In Memoriam'));
    });

    it('in memoriam section contains dead PC with displayTitle (no underscores)', () => {
      const html = fs.readFileSync(path.join(outputDir, 'docs', 'index.html'), 'utf-8');
      assert.ok(html.includes('Dead PC'), 'Should show displayTitle without underscores');
      assert.ok(!html.includes('>Dead_PC<'), 'Should not show raw filename with underscores');
    });

    it('in memoriam shows status label for dead PC', () => {
      const html = fs.readFileSync(path.join(outputDir, 'docs', 'index.html'), 'utf-8');
      assert.ok(html.includes('KIA') || html.includes('MIA') || html.includes('Retired'), 'Should include a status label');
    });

    it('active PCs appear in The Team, not In Memoriam', () => {
      const html = fs.readFileSync(path.join(outputDir, 'docs', 'index.html'), 'utf-8');
      const memoriamIdx = html.indexOf('In Memoriam');
      assert.ok(memoriamIdx !== -1, 'In Memoriam section should exist');
      const memoriamHtml = html.slice(memoriamIdx);
      assert.ok(!memoriamHtml.includes('Guy LeFleur'), 'Active PC should not be in In Memoriam');
      assert.ok(html.includes('Guy LeFleur'), 'Active PC should appear on the page');
    });
  });

  describe('auto-exclude fixture', () => {
    let outputDir;
    let configPath;

    before(() => {
      outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-publish-test-autoexclude-'));
      configPath = path.join(outputDir, 'config.json');

      const config = {
        vaultPath: path.join(fixturesDir, 'auto-exclude'),
        outputDir: path.join(outputDir, 'docs'),
        attachmentsDir: '_attachments',
        siteTitle: 'Auto-Exclude Test',
        siteUrl: 'https://example.github.io/auto-exclude-test',
        excludeDirs: ['_meta', '_Templates'],
        excludeSections: [],
        folderMap: {
          'Sessions': 'sessions',
          'Characters/NPCs': 'characters/npcs',
        },
      };

      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      build({ configPath });
    });

    after(() => {
      fs.rmSync(outputDir, { recursive: true, force: true });
    });

    it('excludes files with status: planned', () => {
      const planned = path.join(outputDir, 'docs', 'sessions', 'planned-session.html');
      assert.ok(!fs.existsSync(planned));
    });

    it('includes files with status: played', () => {
      const played = path.join(outputDir, 'docs', 'sessions', 'played-session.html');
      assert.ok(fs.existsSync(played));
    });

    it('excludes files with stage: draft', () => {
      const draft = path.join(outputDir, 'docs', 'characters', 'npcs', 'draft-npc.html');
      assert.ok(!fs.existsSync(draft));
    });

    it('includes files with no auto-exclude markers', () => {
      const published = path.join(outputDir, 'docs', 'characters', 'npcs', 'published-npc.html');
      assert.ok(fs.existsSync(published));
    });

    it('excludes files with source: prep', () => {
      const prep = path.join(outputDir, 'docs', 'characters', 'npcs', 'prep-source.html');
      assert.ok(!fs.existsSync(prep));
    });
  });

  describe('auto-exclude in full mode', () => {
    let outputDir;
    let configPath;

    before(() => {
      outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-publish-test-autoexclude-full-'));
      configPath = path.join(outputDir, 'config.json');

      const vaultDir = path.join(fixturesDir, 'auto-exclude');
      const metaDir = path.join(vaultDir, '_meta');
      fs.mkdirSync(metaDir, { recursive: true });
      fs.writeFileSync(path.join(metaDir, 'vault-config.md'), '---\npublish:\n  mode: full\n---\n');

      const config = {
        vaultPath: vaultDir,
        outputDir: path.join(outputDir, 'docs'),
        attachmentsDir: '_attachments',
        siteTitle: 'Auto-Exclude Full Mode Test',
        siteUrl: 'https://example.github.io/auto-exclude-full-test',
        excludeDirs: ['_meta', '_Templates'],
        excludeSections: [],
        folderMap: {
          'Sessions': 'sessions',
          'Characters/NPCs': 'characters/npcs',
        },
      };

      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      build({ configPath });
    });

    after(() => {
      const vaultDir = path.join(fixturesDir, 'auto-exclude');
      const metaDir = path.join(vaultDir, '_meta');
      fs.rmSync(metaDir, { recursive: true, force: true });
      fs.rmSync(outputDir, { recursive: true, force: true });
    });

    it('includes planned files in full mode', () => {
      const planned = path.join(outputDir, 'docs', 'sessions', 'planned-session.html');
      assert.ok(fs.existsSync(planned));
    });

    it('includes draft files in full mode', () => {
      const draft = path.join(outputDir, 'docs', 'characters', 'npcs', 'draft-npc.html');
      assert.ok(fs.existsSync(draft));
    });

    it('includes prep source files in full mode', () => {
      const prep = path.join(outputDir, 'docs', 'characters', 'npcs', 'prep-source.html');
      assert.ok(fs.existsSync(prep));
    });
  });

  describe('with-gm-only-markers fixture', () => {
    let outputDir;
    let configPath;

    before(() => {
      outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-publish-test-gmonly-'));
      configPath = path.join(outputDir, 'config.json');

      const config = {
        vaultPath: path.join(fixturesDir, 'with-gm-only-markers'),
        outputDir: path.join(outputDir, 'docs'),
        attachmentsDir: '_attachments',
        siteTitle: 'GM Only Test',
        siteUrl: 'https://example.github.io/test-gmonly',
        excludeDirs: ['_meta'],
        excludeSections: [],
        folderMap: {
          'Locations': 'locations',
          'Characters/PCs': 'characters/pcs',
        },
      };

      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      build({ configPath });
    });

    after(() => {
      fs.rmSync(outputDir, { recursive: true, force: true });
    });

    it('strips spoiler blocks from market page', () => {
      const html = fs.readFileSync(path.join(outputDir, 'docs', 'locations', 'market.html'), 'utf-8');
      assert.ok(!html.includes('Carcosa'));
    });

    it('strips gm-only and spoiler blocks from PC page', () => {
      const html = fs.readFileSync(path.join(outputDir, 'docs', 'characters', 'pcs', 'test-pc.html'), 'utf-8');
      assert.ok(!html.includes('Zalgorath'));
      assert.ok(!html.includes('Ithaqua'));
    });

    it('excludes spoiler and gm-only content from search-index.json', () => {
      // lunr lowercases and stems indexed tokens, so check case-insensitively for
      // the raw distinctive words rather than exact phrases.
      const indexJson = fs.readFileSync(path.join(outputDir, 'docs', 'search-index.json'), 'utf-8').toLowerCase();
      assert.ok(!indexJson.includes('carcosa'));
      assert.ok(!indexJson.includes('zalgorath'));
      assert.ok(!indexJson.includes('ithaqua'));
    });

    it('strips gm-only blocks from market page', () => {
      const html = fs.readFileSync(path.join(outputDir, 'docs', 'locations', 'market.html'), 'utf-8');
      assert.ok(!html.includes('pickpocket'));
      assert.ok(!html.includes('Fingers McGee'));
      assert.ok(!html.includes('fence for stolen goods'));
      assert.ok(html.includes('Fresh produce'));
      assert.ok(html.includes('herbs and tonics'));
    });

    it('handles multiple gm-only blocks in one file', () => {
      const html = fs.readFileSync(path.join(outputDir, 'docs', 'locations', 'market.html'), 'utf-8');
      assert.ok(html.includes('blacksmith offers'));
      assert.ok(html.includes('apothecary'));
    });

    it('handles unclosed marker by stripping to end of file', () => {
      const html = fs.readFileSync(path.join(outputDir, 'docs', 'locations', 'dungeon.html'), 'utf-8');
      assert.ok(html.includes('dark, winding passage'));
      assert.ok(!html.includes('unclosed marker'));
      assert.ok(!html.includes('Secret Chamber'));
      assert.ok(!html.includes('treasure'));
    });
  });

  describe('with-story fixture', () => {
    let outputDir;
    let configPath;

    before(() => {
      outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-publish-test-story-'));
      configPath = path.join(outputDir, 'config.json');

      const config = {
        vaultPath: path.join(fixturesDir, 'with-story'),
        outputDir: path.join(outputDir, 'docs'),
        attachmentsDir: '_attachments',
        siteTitle: 'Story Test',
        excludeDirs: ['_meta', '_Templates'],
        excludeSections: ['GM Notes'],
        folderMap: {
          'Characters/PCs': 'characters/pcs',
        },
      };

      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      build({ configPath });
    });

    after(() => {
      fs.rmSync(outputDir, { recursive: true, force: true });
    });

    it('creates PC page with tab bar when story exists', () => {
      const pcPath = path.join(outputDir, 'docs', 'characters', 'pcs', 'lord-blackwood.html');
      assert.ok(fs.existsSync(pcPath));
      const html = fs.readFileSync(pcPath, 'utf-8');
      assert.ok(html.includes('tab-bar'), 'Should have tab bar');
      assert.ok(html.includes('Character Sheet'), 'Should have Sheet tab');
      assert.ok(html.includes('Story'), 'Should have Story tab');
    });

    it('Story tab links to dedicated story page when one exists', () => {
      const pcPath = path.join(outputDir, 'docs', 'characters', 'pcs', 'lord-blackwood.html');
      const pcHtml = fs.readFileSync(pcPath, 'utf-8');
      assert.ok(pcHtml.includes('story-read-link'), 'Should have a link to the dedicated story page');
      assert.ok(pcHtml.includes('story/characters/lord-blackwood.html'), 'Should reference the story page path');
      assert.ok(pcHtml.includes('story-prose'), 'Should still have prose container');
      const storyPath = path.join(outputDir, 'docs', 'story', 'characters', 'lord-blackwood.html');
      assert.ok(fs.existsSync(storyPath), 'Dedicated story page should exist');
      const storyHtml = fs.readFileSync(storyPath, 'utf-8');
      assert.ok(storyHtml.includes('The Whitby Letter'), 'Dedicated story page should contain session 1 title');
      assert.ok(storyHtml.includes('The Hastings Séance'), 'Dedicated story page should contain session 2 title');
    });

    it('strips GM Notes from story content', () => {
      const pcPath = path.join(outputDir, 'docs', 'characters', 'pcs', 'lord-blackwood.html');
      const html = fs.readFileSync(pcPath, 'utf-8');
      assert.ok(!html.includes('cult connection'), 'Story GM Notes should be stripped');
    });

    it('strips GM Notes from sheet content', () => {
      const pcPath = path.join(outputDir, 'docs', 'characters', 'pcs', 'lord-blackwood.html');
      const html = fs.readFileSync(pcPath, 'utf-8');
      assert.ok(!html.includes('knows about the cult'), 'Sheet GM Notes should be stripped');
    });

    it('does not create standalone page for story file', () => {
      const storyPath = path.join(outputDir, 'docs', 'characters', 'pcs', 'lord-blackwood-story.html');
      assert.ok(!fs.existsSync(storyPath), 'Story should not have its own page');
    });

    it('creates PC page with 4-tab layout even when no story exists', () => {
      const pcPath = path.join(outputDir, 'docs', 'characters', 'pcs', 'no-story-pc.html');
      assert.ok(fs.existsSync(pcPath));
      const html = fs.readFileSync(pcPath, 'utf-8');
      assert.ok(html.includes('tab-bar'), 'Should have tab bar');
      assert.ok(html.includes('tab-story'), 'Should have story panel');
      assert.ok(html.includes('tab-equipment'), 'Should have equipment panel');
      assert.ok(html.includes('tab-journey'), 'Should have journey panel');
    });
  });

  describe('with-genre fixture', () => {
    let outputDir;
    let configPath;

    before(() => {
      outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-publish-test-genre-'));
      configPath = path.join(outputDir, 'config.json');

      const config = {
        vaultPath: path.join(fixturesDir, 'with-genre'),
        outputDir: path.join(outputDir, 'docs'),
        attachmentsDir: '_attachments',
        siteTitle: 'Genre Test',
        excludeDirs: ['_meta'],
        excludeSections: [],
        folderMap: { 'Locations': 'locations' },
      };

      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      build({ configPath });
    });

    after(() => {
      fs.rmSync(outputDir, { recursive: true, force: true });
    });

    it('copies genre preset CSS file', () => {
      const horrorCss = path.join(outputDir, 'docs', 'css', 'themes', 'horror.css');
      assert.ok(fs.existsSync(horrorCss));
      const css = fs.readFileSync(horrorCss, 'utf-8');
      assert.ok(css.includes('#1a1410'));
    });

    it('links genre CSS in HTML pages', () => {
      const html = fs.readFileSync(path.join(outputDir, 'docs', 'index.html'), 'utf-8');
      assert.ok(html.includes('themes/horror.css'));
    });

    it('generates theme.css with palette overrides', () => {
      const themeCss = fs.readFileSync(path.join(outputDir, 'docs', 'css', 'theme.css'), 'utf-8');
      assert.ok(themeCss.includes('#ff6600'));
    });

    it('genre alias resolves correctly', () => {
      const { resolveGenrePreset } = require('../../lib/theme');
      assert.strictEqual(resolveGenrePreset('cthulhu'), 'horror');
      assert.strictEqual(resolveGenrePreset('gothic'), 'horror');
    });
  });

  describe('redesign-full fixture', () => {
    let outputDir;
    let configPath;

    before(() => {
      outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-publish-redesign-'));
      configPath = path.join(outputDir, 'config.json');

      const config = {
        vaultPath: path.join(fixturesDir, 'redesign-full'),
        outputDir: path.join(outputDir, 'docs'),
        attachmentsDir: '_attachments',
        siteTitle: 'Redesign Test',
        siteUrl: 'https://example.github.io/redesign-test',
        searchEnabled: true,
        excludeDirs: ['_meta', '_Templates'],
        excludeSections: [],
        folderMap: {
          'Characters/PCs': 'characters/pcs',
          'Characters/NPCs': 'characters/npcs',
          'Locations': 'locations',
          'Events': 'events',
          'Sessions': 'sessions',
          'Factions': 'factions',
        },
      };

      fs.writeFileSync(configPath, JSON.stringify(config));
      build({ configPath });
    });

    after(() => {
      fs.rmSync(outputDir, { recursive: true, force: true });
    });

    it('generates landing page with hero and recap zones', () => {
      const html = fs.readFileSync(path.join(outputDir, 'docs', 'index.html'), 'utf-8');
      assert.ok(html.includes('landing-hero'));
      assert.ok(html.includes('Redesign Test'));
      assert.ok(html.includes('Into the dark we go'));
      assert.ok(html.includes('Latest Session'));
    });

    it('applies genre CSS preset', () => {
      const html = fs.readFileSync(path.join(outputDir, 'docs', 'index.html'), 'utf-8');
      assert.ok(html.includes('horror.css'));
    });

    it('generates search index', () => {
      assert.ok(fs.existsSync(path.join(outputDir, 'docs', 'search-index.json')));
    });

    it('generates top nav with semantic groups', () => {
      const html = fs.readFileSync(path.join(outputDir, 'docs', 'index.html'), 'utf-8');
      assert.ok(html.includes('nav-group'));
    });

    it('generates breadcrumbs on entity pages', () => {
      const npcHtml = fs.readFileSync(path.join(outputDir, 'docs', 'characters', 'npcs', 'dr-armitage.html'), 'utf-8');
      assert.ok(npcHtml.includes('breadcrumbs'));
    });

    it('generates context sidebar with backlinks on NPC page', () => {
      const npcHtml = fs.readFileSync(path.join(outputDir, 'docs', 'characters', 'npcs', 'dr-armitage.html'), 'utf-8');
      assert.ok(npcHtml.includes('context-sidebar'));
    });

    it('generates relationship graph SVG on entity pages', () => {
      const npcHtml = fs.readFileSync(path.join(outputDir, 'docs', 'characters', 'npcs', 'dr-armitage.html'), 'utf-8');
      assert.ok(npcHtml.includes('<svg'));
    });

    it('generates locations index with region layout', () => {
      const indexHtml = fs.readFileSync(path.join(outputDir, 'docs', 'locations', 'index.html'), 'utf-8');
      assert.ok(indexHtml.includes('locations-page') || indexHtml.includes('loc-region'));
    });

    it('generates PC page with 4-tab layout', () => {
      const pcHtml = fs.readFileSync(path.join(outputDir, 'docs', 'characters', 'pcs', 'john-marsh.html'), 'utf-8');
      assert.ok(pcHtml.includes('tab-sheet'));
      assert.ok(pcHtml.includes('tab-equipment'));
      assert.ok(pcHtml.includes('tab-story'));
      assert.ok(pcHtml.includes('tab-journey'));
    });

    it('generates location page with hero banner', () => {
      const locHtml = fs.readFileSync(path.join(outputDir, 'docs', 'locations', 'miskatonic-library.html'), 'utf-8');
      assert.ok(locHtml.includes('hero-banner'));
    });

    it('loads client-side scripts', () => {
      const html = fs.readFileSync(path.join(outputDir, 'docs', 'index.html'), 'utf-8');
      assert.ok(html.includes('js/lightbox.js'));
      assert.ok(html.includes('js/search.js'));
    });
  });

  describe('authored-index fixture', () => {
    let outputDir;
    let configPath;

    before(() => {
      outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-publish-test-authored-index-'));
      configPath = path.join(outputDir, 'config.json');

      const config = {
        vaultPath: path.join(fixturesDir, 'authored-index'),
        outputDir: path.join(outputDir, 'docs'),
        attachmentsDir: '_attachments',
        siteTitle: 'Authored Index Test',
        excludeDirs: ['_meta', '_Templates'],
        excludeSections: [],
        folderMap: {
          '_World': 'world',
          'Locations': 'locations',
        },
      };

      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      build({ configPath });
    });

    after(() => {
      fs.rmSync(outputDir, { recursive: true, force: true });
    });

    it('keeps the authored World index instead of the generated section index', () => {
      const indexPath = path.join(outputDir, 'docs', 'world', 'index.html');
      assert.ok(fs.existsSync(indexPath));
      const html = fs.readFileSync(indexPath, 'utf-8');
      assert.ok(html.includes('AUTHORED_WORLD_INDEX_MARKER_9f3c'));
      assert.ok(!html.includes('class="card-grid"'));
    });
  });
  describe('timeline target (issue #83)', () => {
    function buildFixture(fixture, folderMap) {
      const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-publish-test-timeline-'));
      const configPath = path.join(outputDir, 'config.json');
      fs.writeFileSync(configPath, JSON.stringify({
        vaultPath: path.join(fixturesDir, fixture),
        outputDir: path.join(outputDir, 'docs'),
        attachmentsDir: '_attachments',
        siteTitle: 'Timeline Test',
        siteUrl: 'https://example.github.io/t',
        excludeDirs: ['_meta'],
        excludeSections: [],
        folderMap,
      }, null, 2));
      build({ configPath });
      return path.join(outputDir, 'docs');
    }

    it('aims nav and the events redirect at an authored timeline, not a root one that is never written', () => {
      const docs = buildFixture('authored-timeline', { Events: 'events', _Campaign: 'campaign' });
      try {
        assert.ok(!fs.existsSync(path.join(docs, 'timeline.html')),
          'no dated events, so no root timeline should be generated');
        assert.ok(fs.existsSync(path.join(docs, 'campaign', 'timeline.html')));

        const eventPage = fs.readFileSync(path.join(docs, 'events', 'undated-event.html'), 'utf-8');
        assert.ok(eventPage.includes('href="../campaign/timeline.html"'));
        assert.ok(!eventPage.includes('href="../timeline.html"'));

        const redirect = fs.readFileSync(path.join(docs, 'events', 'index.html'), 'utf-8');
        assert.ok(redirect.includes('url=../campaign/timeline.html'));
      } finally {
        fs.rmSync(path.dirname(docs), { recursive: true, force: true });
      }
    });

    it('gives events a real index when there is no timeline at all', () => {
      const docs = buildFixture('no-timeline', { Events: 'events' });
      try {
        assert.ok(!fs.existsSync(path.join(docs, 'timeline.html')));
        const index = fs.readFileSync(path.join(docs, 'events', 'index.html'), 'utf-8');
        assert.ok(!index.includes('http-equiv="refresh"'), 'should not redirect to a missing timeline');
        assert.ok(index.includes('Undated Event'));

        const eventPage = fs.readFileSync(path.join(docs, 'events', 'undated-event.html'), 'utf-8');
        assert.ok(eventPage.includes('href="index.html"'), 'nav Events should point at the events index');
        assert.ok(!eventPage.includes('timeline.html'));
      } finally {
        fs.rmSync(path.dirname(docs), { recursive: true, force: true });
      }
    });
  });
});
