const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { build } = require('../../lib/build');
const { writeSiteConfig, mergeSettings } = require('../helpers/vault-files');

// #605: the live features (live stats, the change-request inbox) need Cloudflare Pages: a leftover wrangler.toml on a
// GitHub Pages site must not switch them on, and the warning names the host as the reason.
describe('live features and the host', () => {
  let dir;
  let warnings;
  let originalWarn;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-publish-host-live-'));
    warnings = [];
    originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
  });
  afterEach(() => {
    console.warn = originalWarn;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function roster({ host, toml }) {
    const vault = path.join(dir, 'vault');
    fs.cpSync(path.join(__dirname, '..', 'fixtures', 'with-party-roster'), vault, { recursive: true });
    mergeSettings(vault, { 'player_site.features.live_stats': true, 'player_site.features.inbox': true });
    if (toml) fs.writeFileSync(path.join(dir, 'wrangler.toml'), '[[kv_namespaces]]\nbinding = "INBOX"\nid = "abc123def456"\n');
    const configPath = path.join(dir, 'config.json');
    writeSiteConfig(configPath, {
      vaultPath: vault, outputDir: path.join(dir, 'docs'), attachmentsDir: '_attachments', siteTitle: 'Host Live',
      system: 'gurps-4e', excludeDirs: ['_meta', '_Templates'], excludeSections: [],
      folderMap: { 'Characters/PCs': 'characters/pcs' },
      ...(host ? { host } : {}),
    }, 2);
    build({ configPath });
    return fs.readFileSync(path.join(dir, 'docs', 'characters', 'pcs', 'player-characters.html'), 'utf-8');
  }

  it('a GitHub Pages site with a KV id left in wrangler.toml publishes no live features, and the warning names the host', () => {
    const html = roster({ host: 'github-pages', toml: true });
    assert.doesNotMatch(html, /id="gurps-party-data"/);
    const said = warnings.filter((w) => /live_stats|inbox/.test(w));
    assert.equal(said.length, 2, said.join('\n'));
    for (const w of said) {
      assert.match(w, /Cloudflare/);
      assert.match(w, /github-pages/);
      assert.match(w, /player_site\.host/);
      assert.match(w, /turn .* off|off/);
    }
  });

  it('a GitHub Pages site with no KV store gets the host as the reason too', () => {
    roster({ host: 'github-pages', toml: false });
    assert.ok(warnings.some((w) => /live_stats/.test(w) && /Cloudflare/.test(w)), warnings.join('\n'));
  });

  it('a Cloudflare Pages site with a KV id publishes them, with no warning', () => {
    const html = roster({ host: 'cloudflare-pages', toml: true });
    assert.match(html, /id="gurps-party-data"/);
    assert.ok(!warnings.some((w) => /live_stats|inbox/.test(w)), warnings.join('\n'));
  });

  it('a Cloudflare Pages site with no KV store keeps the KV warning', () => {
    roster({ host: 'cloudflare-pages', toml: false });
    assert.ok(warnings.some((w) => /live_stats/.test(w) && /no KV store wired/.test(w)), warnings.join('\n'));
  });

  it('a site that names no host is a Cloudflare Pages site', () => {
    const html = roster({ toml: true });
    assert.match(html, /id="gurps-party-data"/);
  });
});
