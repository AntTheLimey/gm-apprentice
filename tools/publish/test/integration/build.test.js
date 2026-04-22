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
      const themePath = path.join(outputDir, 'docs', 'css', 'theme.css');
      assert.ok(fs.existsSync(themePath));
      const css = fs.readFileSync(themePath, 'utf-8');
      assert.ok(css.includes('--theme-primary'));
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
      assert.ok(html.includes('class="hero"'));
    });

    it('landing page shows last played date', () => {
      const html = fs.readFileSync(path.join(outputDir, 'docs', 'index.html'), 'utf-8');
      assert.ok(html.includes('Last Played'));
      assert.ok(html.includes('hero-dates'));
    });

    it('landing page shows in-game date from setting_year', () => {
      const html = fs.readFileSync(path.join(outputDir, 'docs', 'index.html'), 'utf-8');
      assert.ok(html.includes('In-Game Date'));
      assert.ok(html.includes('2019'));
    });

    it('landing page shows Story So Far section with recap', () => {
      const html = fs.readFileSync(path.join(outputDir, 'docs', 'index.html'), 'utf-8');
      assert.ok(html.includes('Story So Far'));
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

    it('PC cards show status badges', () => {
      const html = fs.readFileSync(path.join(outputDir, 'docs', 'index.html'), 'utf-8');
      assert.ok(html.includes('status-badge'));
      assert.ok(html.includes('Active'));
    });

    it('PC cards show key traits', () => {
      const html = fs.readFileSync(path.join(outputDir, 'docs', 'index.html'), 'utf-8');
      assert.ok(html.includes('Hot-tempered'));
      assert.ok(html.includes('Resourceful'));
    });

    it('landing page shows Key NPCs section for important NPCs', () => {
      const html = fs.readFileSync(path.join(outputDir, 'docs', 'index.html'), 'utf-8');
      assert.ok(html.includes('Key NPCs'));
      assert.ok(html.includes('npc-grid'));
      assert.ok(html.includes('Adrian Voss'));
    });

    it('important NPC shows inferred role', () => {
      const html = fs.readFileSync(path.join(outputDir, 'docs', 'index.html'), 'utf-8');
      assert.ok(html.includes('Patron'));
      assert.ok(html.includes('CEO, Voss Dynamics'));
    });

    it('unimportant NPC is excluded from Key NPCs', () => {
      const html = fs.readFileSync(path.join(outputDir, 'docs', 'index.html'), 'utf-8');
      const npcGridMatch = html.match(/class="npc-grid">([\s\S]*?)<\/div>\s*<\/div>/);
      const npcGridHtml = npcGridMatch ? npcGridMatch[1] : '';
      assert.ok(!npcGridHtml.includes('Random Guard'));
    });

    it('landing page shows Explore section', () => {
      const html = fs.readFileSync(path.join(outputDir, 'docs', 'index.html'), 'utf-8');
      assert.ok(html.includes('Explore'));
      assert.ok(html.includes('explore-grid'));
      assert.ok(html.includes('Locations'));
    });

    it('explore grid excludes PC and NPC categories', () => {
      const html = fs.readFileSync(path.join(outputDir, 'docs', 'index.html'), 'utf-8');
      const exploreGridMatch = html.match(/class="explore-grid">([\s\S]*?)<\/div>\s*<\/div>/);
      const exploreGridHtml = exploreGridMatch ? exploreGridMatch[1] : '';
      assert.ok(!exploreGridHtml.includes('>Player Characters<'));
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
        },
      };

      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      build({ configPath });
    });

    after(() => {
      fs.rmSync(outputDir, { recursive: true, force: true });
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
});
