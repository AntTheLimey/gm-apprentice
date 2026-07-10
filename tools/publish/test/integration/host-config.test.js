const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { build } = require('../../lib/build');

const fixturesDir = path.join(__dirname, '..', 'fixtures');

function baseConfig(outputDir, overrides) {
  return {
    vaultPath: path.join(fixturesDir, 'minimal'),
    outputDir: path.join(outputDir, 'docs'),
    attachmentsDir: '_attachments',
    siteTitle: 'Host Test',
    excludeDirs: ['_meta', '_Templates'],
    excludeSections: [],
    folderMap: { 'Characters/PCs': 'characters/pcs', 'Locations': 'locations' },
    ...overrides,
  };
}

describe('host config warning', () => {
  let outputDir;
  let configPath;
  let warnings;
  let originalWarn;

  beforeEach(() => {
    outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-publish-host-'));
    configPath = path.join(outputDir, 'config.json');
    warnings = [];
    originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
  });

  afterEach(() => {
    console.warn = originalWarn;
    fs.rmSync(outputDir, { recursive: true, force: true });
  });

  function runBuild(overrides) {
    fs.writeFileSync(configPath, JSON.stringify(baseConfig(outputDir, overrides), null, 2));
    build({ configPath });
  }

  it('warns when host is cloudflare-pages but siteUrl is a github.io URL', () => {
    runBuild({ host: 'cloudflare-pages', siteUrl: 'https://example.github.io/my-campaign/' });
    assert.ok(
      warnings.some((w) => w.includes('cloudflare-pages') && w.includes('github.io')),
      'expected a host/siteUrl mismatch warning'
    );
  });

  it('does not warn when host is cloudflare-pages and siteUrl is a pages.dev URL', () => {
    runBuild({ host: 'cloudflare-pages', siteUrl: 'https://my-campaign.pages.dev' });
    assert.ok(
      !warnings.some((w) => w.includes('siteUrl looks like a GitHub Pages URL')),
      'did not expect a host/siteUrl mismatch warning'
    );
  });

  it('does not warn for the default github-pages host with a github.io URL', () => {
    runBuild({ siteUrl: 'https://example.github.io/my-campaign/' });
    assert.ok(
      !warnings.some((w) => w.includes('siteUrl looks like a GitHub Pages URL')),
      'default host should never trigger the Cloudflare mismatch warning'
    );
  });
});
