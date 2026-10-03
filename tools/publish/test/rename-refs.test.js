const { describe, it } = require('node:test');
require('./helpers/quiet-legacy-warning.js');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const { pcLiveKey, slugify } = require('../lib/scanner');
const { build } = require('../lib/build');
const { setPublishKeys } = require('../lib/vault-config-edit');

const BIN = path.join(__dirname, '..', 'bin', 'gm-publish.js');
const FROM = 'Characters/PCs/Emma_Wentworth.md';
const TO = 'Characters/PCs/Emma_Wentworth_Hale.md';

function vaultWith(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rename-refs-'));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

function rename(vault, from = FROM, to = TO) {
  const out = execFileSync('node', [BIN, 'manifest', 'rename', '--vault', vault, '--from', from, '--to', to, '--json'], { encoding: 'utf8' });
  return JSON.parse(out);
}

const MANIFEST = (eol = '\n') => [
  '---', 'generated: 2026-10-03', '---', '',
  '## Publishing (2 files)', '',
  `- [x] ${FROM}`,
  `- [x] Characters/PCs/Emma_Wentworth_Story.md`,
  '',
  '## Excluded (1 files)', '',
  `- [x] ${FROM} — kept off while testing`,
  '',
  '## Needs Decision (1 files)', '',
  `- [ ] ${FROM}`,
  '',
].join(eol);

describe('manifest rename', () => {
  it('rewrites the path in all three sections and leaves a longer name alone', () => {
    const vault = vaultWith({ '_meta/publish-manifest.md': MANIFEST() });
    const got = rename(vault);
    const text = got.files['_meta/publish-manifest.md'];
    assert.strictEqual(text, MANIFEST().split(FROM).join(TO));
    assert.match(text, /Emma_Wentworth_Story\.md/);
    assert.strictEqual(got.pin, undefined);
    assert.strictEqual(fs.readFileSync(path.join(vault, '_meta/publish-manifest.md'), 'utf8'), MANIFEST(), 'writes nothing');
  });

  it('keeps CRLF endings', () => {
    const vault = vaultWith({ '_meta/publish-manifest.md': MANIFEST('\r\n') });
    const text = rename(vault).files['_meta/publish-manifest.md'];
    assert.strictEqual(text, MANIFEST('\r\n').split(FROM).join(TO));
  });

  it('matches an NFD manifest entry against an NFC path', () => {
    const nfc = 'Characters/PCs/Renée.md';
    const vault = vaultWith({ '_meta/publish-manifest.md': `## Publishing (1 files)\n\n- [x] ${nfc.normalize('NFD')}\n` });
    const got = rename(vault, nfc, 'Characters/PCs/Renee.md');
    assert.strictEqual(got.files['_meta/publish-manifest.md'], '## Publishing (1 files)\n\n- [x] Characters/PCs/Renee.md\n');
  });

  it('prints {"files": {}} when nothing names the note', () => {
    const vault = vaultWith({ '_meta/publish-manifest.md': '## Publishing (1 files)\n\n- [x] Locations/Elsewhere.md\n' });
    assert.deepStrictEqual(rename(vault), { files: {} });
    assert.deepStrictEqual(rename(vaultWith({ 'a.md': 'x' })), { files: {} });
  });

  it('rewrites a vault-config override path and featured names, byte for byte', () => {
    const cfg = [
      '---', 'publish:', '  mode: player', '  overrides:', '    fields:',
      `      "${FROM}":`, '        include: [secrets]',
      '  landing:', '    featured_npcs: ["Emma_Wentworth", Other]', '    quick_links:', '      - Emma_Wentworth', '---', '', '# Config', ''].join('\n');
    const vault = vaultWith({ '_meta/vault-config.md': cfg, [FROM]: '---\ntype: npc\n---\n' });
    const text = rename(vault).files['_meta/vault-config.md'];
    assert.strictEqual(text, cfg.replace(FROM, TO).replace('"Emma_Wentworth"', '"Emma_Wentworth_Hale"').replace('- Emma_Wentworth', '- Emma_Wentworth_Hale'));
  });

  it('leaves a featured name alone when two notes share the old name', () => {
    const cfg = '---\npublish:\n  landing:\n    featured_npcs: [Emma_Wentworth]\n---\n';
    const vault = vaultWith({ '_meta/vault-config.md': cfg, [FROM]: '---\ntype: npc\n---\n', 'Elsewhere/Emma_Wentworth.md': '---\ntype: npc\n---\n' });
    assert.deepStrictEqual(rename(vault), { files: {} });
  });

  it('exits non-zero with one stderr line on bad arguments', () => {
    const r = spawnSync('node', [BIN, 'manifest', 'rename', '--vault', os.tmpdir(), '--from', FROM], { encoding: 'utf8' });
    assert.notStrictEqual(r.status, 0);
    assert.strictEqual(r.stderr.trim().split('\n').length, 1);
    assert.match(r.stderr, /--to/);
    const bad = spawnSync('node', [BIN, 'manifest', 'rename', '--vault', '/no/such/dir', '--from', FROM, '--to', TO], { encoding: 'utf8' });
    assert.notStrictEqual(bad.status, 0);
    assert.strictEqual(bad.stderr.trim().split('\n').length, 1);
  });
});

describe('manifest rename: the live key', () => {
  it('says what a PC page is keyed by now', () => {
    const vault = vaultWith({ [FROM]: '---\ntype: pc\n---\n' });
    assert.deepStrictEqual(rename(vault), { files: {}, pin: { live_key: 'emma-wentworth' } });
  });

  it('has no pin when the rename leaves the key as it is', () => {
    const pinned = vaultWith({ [FROM]: '---\ntype: pc\nlive_key: Old Key\n---\n' });
    assert.strictEqual(rename(pinned).pin, undefined);
    const vault = vaultWith({ [FROM]: '---\ntype: pc\n---\n' });
    assert.strictEqual(rename(vault, FROM, 'Characters/Retired/Emma_Wentworth.md').pin, undefined);
    assert.strictEqual(rename(vault, FROM, 'Characters/PCs/emma wentworth.md').pin, undefined);
  });

  it('has no pin for a note that holds no live state', () => {
    const vault = vaultWith({ [FROM]: '---\ntype: npc\n---\n' });
    assert.strictEqual(rename(vault).pin, undefined);
  });
});

describe('pcLiveKey', () => {
  it('is the slug of the title when live_key is absent, as before', () => {
    for (const title of ['Emma_Wentworth', 'Renée González', "O'Neil & Sons"]) {
      assert.strictEqual(pcLiveKey({ type: 'pc' }, title), slugify(title));
      assert.strictEqual(pcLiveKey(null, title), slugify(title));
      assert.strictEqual(pcLiveKey({ live_key: '  ' }, title), slugify(title));
      assert.strictEqual(pcLiveKey({ live_key: 7 }, title), slugify(title));
    }
  });

  it('uses the pinned value, as a slug', () => {
    assert.strictEqual(pcLiveKey({ live_key: 'emma-wentworth' }, 'Emma_Wentworth_Hale'), 'emma-wentworth');
    assert.strictEqual(pcLiveKey({ live_key: 'Emma: Wentworth' }, 'X'), 'emma-wentworth');
  });
});

describe('a pinned key reaches the build', () => {
  function buildRoster(pinned) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live-key-'));
    const vault = path.join(root, 'vault');
    fs.cpSync(path.join(__dirname, 'fixtures', 'with-party-roster'), vault, { recursive: true });
    setPublishKeys(vault, { live_stats: true });
    const pcs = path.join(vault, 'Characters', 'PCs');
    if (pinned) {
      const src = fs.readFileSync(path.join(pcs, 'Karl Brenner.md'), 'utf8');
      fs.rmSync(path.join(pcs, 'Karl Brenner.md'));
      fs.writeFileSync(path.join(pcs, 'Karl_Hale.md'), src.replace('type: pc\n', 'type: pc\nlive_key: karl-brenner\n'));
    }
    fs.writeFileSync(path.join(root, 'wrangler.toml'), '[[kv_namespaces]]\nbinding = "INBOX"\nid = "abc123def456"\n');
    const configPath = path.join(root, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      vaultPath: vault, outputDir: path.join(root, 'docs'), attachmentsDir: '_attachments',
      siteTitle: 'Roster Test', system: 'gurps-4e', excludeDirs: ['_meta', '_Templates'], excludeSections: [],
      folderMap: { 'Characters/PCs': 'characters/pcs' },
    }));
    build({ configPath });
    const read = (...p) => fs.readFileSync(path.join(root, 'docs', ...p), 'utf8');
    return { read, root };
  }

  it('without live_key the slug is the filename slug, as today', () => {
    const { read, root } = buildRoster(false);
    assert.match(read('characters', 'pcs', 'player-characters.html'), /"pcSlug":"karl-brenner"/);
    assert.match(read('characters', 'pcs', 'karl-brenner.html'), /"pcSlug":"karl-brenner"/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('with live_key the pinned slug is in the page data and the party manifest, at the new URL', () => {
    const { read, root } = buildRoster(true);
    assert.match(read('characters', 'pcs', 'player-characters.html'), /"pcSlug":"karl-brenner"/);
    const page = read('characters', 'pcs', 'karl-hale.html');
    assert.match(page, /"pcSlug":"karl-brenner"/);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe('two PCs on one live key', () => {
  it('the build warns, naming both notes', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live-key-dup-'));
    const vault = path.join(root, 'vault');
    fs.cpSync(path.join(__dirname, 'fixtures', 'with-party-roster'), vault, { recursive: true });
    const pcs = path.join(vault, 'Characters', 'PCs');
    const src = fs.readFileSync(path.join(pcs, 'Karl Brenner.md'), 'utf8');
    fs.writeFileSync(path.join(pcs, 'Karl_Hale.md'), src.replace('type: pc\n', 'type: pc\nlive_key: karl-brenner\n'));
    const configPath = path.join(root, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      vaultPath: vault, outputDir: path.join(root, 'docs'), attachmentsDir: '_attachments',
      siteTitle: 'Roster Test', system: 'gurps-4e', excludeDirs: ['_meta'], excludeSections: [],
      folderMap: { 'Characters/PCs': 'characters/pcs' },
    }));
    const warned = [];
    const real = console.warn;
    console.warn = (...a) => warned.push(a.join(' '));
    try { build({ configPath }); } finally { console.warn = real; }
    const w = warned.find((m) => /live key/i.test(m));
    assert.ok(w, warned.join('\n'));
    assert.match(w, /Characters\/PCs\/Karl Brenner\.md/);
    assert.match(w, /Characters\/PCs\/Karl_Hale\.md/);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
