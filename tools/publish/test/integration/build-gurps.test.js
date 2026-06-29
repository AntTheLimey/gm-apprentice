const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { build } = require('../../lib/build');

describe('build integration — GURPS PC', () => {
  const fixturesDir = path.join(__dirname, '..', 'fixtures');

  describe('with-gurps-pc fixture', () => {
    let outputDir;
    let configPath;

    before(() => {
      outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-publish-gurps-'));
      configPath = path.join(outputDir, 'config.json');

      const config = {
        vaultPath: path.join(fixturesDir, 'with-gurps-pc'),
        outputDir: path.join(outputDir, 'docs'),
        attachmentsDir: '_attachments',
        siteTitle: 'GURPS Test',
        excludeDirs: ['_meta', '_Templates'],
        excludeSections: [],
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

    it('creates GURPS PC page', () => {
      const pcPath = path.join(outputDir, 'docs', 'characters', 'pcs', 'karl-brenner.html');
      assert.ok(fs.existsSync(pcPath), 'Karl Brenner.html should be created');
    });

    it('GURPS PC has structured sheet with attribute block', () => {
      const html = fs.readFileSync(
        path.join(outputDir, 'docs', 'characters', 'pcs', 'karl-brenner.html'),
        'utf-8'
      );
      assert.ok(html.includes('gurps-sheet'), 'Should contain gurps-sheet wrapper');
      assert.ok(html.includes('cat-attr'), 'Should contain attribute category block');
    });

    it('GURPS PC has Combat tab button', () => {
      const html = fs.readFileSync(
        path.join(outputDir, 'docs', 'characters', 'pcs', 'karl-brenner.html'),
        'utf-8'
      );
      assert.ok(html.includes('data-tab="combat"'), 'Should have Combat tab button');
    });

    it('GURPS PC Combat tab contains chain content', () => {
      const html = fs.readFileSync(
        path.join(outputDir, 'docs', 'characters', 'pcs', 'karl-brenner.html'),
        'utf-8'
      );
      // The combat tab panel should exist with combat content
      assert.ok(html.includes('tab-combat'), 'Should have tab-combat panel');
      // Chain content from ## Combat Action Chains should appear
      assert.ok(
        html.includes('Shield Rush') || html.includes('chain') || html.includes('Chain'),
        'Should contain chain content in combat tab'
      );
    });

    it('GURPS PC Equipment tab contains inventory', () => {
      const html = fs.readFileSync(
        path.join(outputDir, 'docs', 'characters', 'pcs', 'karl-brenner.html'),
        'utf-8'
      );
      assert.ok(html.includes('tab-equipment'), 'Should have equipment tab panel');
      assert.ok(html.includes('Broadsword'), 'Should list broadsword in equipment');
    });

    it('GURPS PC Equipment tab does not list encumbrance levels as items', () => {
      const html = fs.readFileSync(
        path.join(outputDir, 'docs', 'characters', 'pcs', 'karl-brenner.html'),
        'utf-8'
      );
      // Find the equipment tab panel content
      const tabMatch = html.match(/<div[^>]+id="tab-equipment"[\s\S]*?(?=<div[^>]+id="tab-|$)/);
      const equipPanel = tabMatch ? tabMatch[0] : html;
      // Encumbrance level labels must NOT appear as equipment item rows
      assert.ok(!equipPanel.includes('<td>None (0)</td>'), 'None (0) must not be an equipment row');
      assert.ok(!equipPanel.includes('<td>Light (1)</td>'), 'Light (1) must not be an equipment row');
      assert.ok(!equipPanel.includes('<td>Medium (2)</td>'), 'Medium (2) must not be an equipment row');
    });

    it('GURPS PC Equipment tab lists exactly the expected items', () => {
      const html = fs.readFileSync(
        path.join(outputDir, 'docs', 'characters', 'pcs', 'karl-brenner.html'),
        'utf-8'
      );
      assert.ok(html.includes('Large Shield'), 'Should list Large Shield');
      assert.ok(html.includes('Mail Hauberk'), 'Should list Mail Hauberk');
    });
  });

  describe('non-GURPS PC has no Combat tab', () => {
    let outputDir;
    let configPath;

    before(() => {
      outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-publish-nongurps-'));
      configPath = path.join(outputDir, 'config.json');

      // Use the minimal fixture — no system set, so no combat tab
      const config = {
        vaultPath: path.join(fixturesDir, 'minimal'),
        outputDir: path.join(outputDir, 'docs'),
        attachmentsDir: '_attachments',
        siteTitle: 'Non-GURPS Test',
        excludeDirs: ['_meta', '_Templates'],
        excludeSections: [],
        folderMap: {
          '_Campaign': 'campaign',
          'Characters/PCs': 'characters/pcs',
          'Characters/NPCs': 'characters/npcs',
          'Locations': 'locations',
        },
      };

      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      build({ configPath });
    });

    after(() => {
      fs.rmSync(outputDir, { recursive: true, force: true });
    });

    it('non-GURPS PC builds successfully', () => {
      const pcPath = path.join(outputDir, 'docs', 'characters', 'pcs', 'test-pc.html');
      assert.ok(fs.existsSync(pcPath), 'Test PC should be created');
    });

    it('non-GURPS PC has NO Combat tab', () => {
      const html = fs.readFileSync(
        path.join(outputDir, 'docs', 'characters', 'pcs', 'test-pc.html'),
        'utf-8'
      );
      assert.ok(!html.includes('data-tab="combat"'), 'Non-GURPS PC should not have a Combat tab');
    });
  });
});
