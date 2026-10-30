const { describe, it, before } = require('node:test');
require('../helpers/quiet-legacy-warning.js');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { build } = require('../../lib/build');
const { detectEncoder } = require('../../lib/image-optimize');
const { makePng } = require('../helpers/make-png');

const hasCwebp = detectEncoder() !== null;

const scratchDirs = () => new Set(fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('gm-publish-img-')));
// Snapshot before any build in this file runs, so a scratch dir orphaned by some earlier
// crashed run can't masquerade as one this build leaked.
const preexistingScratch = scratchDirs();

// A portrait whose filename contains a space, because that is precisely the case an
// external postbuild gets wrong: the emitted src is URL-encoded ("Rock%20Lavey.jpg") and
// never string-matches the filesystem path it would need to rewrite.
const PORTRAIT = 'Rock Lavey.png';

function setupSite({ optimize, gitignore }) {
  const siteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-publish-images-'));
  if (gitignore !== undefined) fs.writeFileSync(path.join(siteDir, '.gitignore'), gitignore);
  const vaultPath = path.join(siteDir, 'vault');
  const outputDir = path.join(siteDir, 'docs');

  fs.mkdirSync(path.join(vaultPath, '_meta'), { recursive: true });
  fs.mkdirSync(path.join(vaultPath, '_attachments/characters'), { recursive: true });
  fs.mkdirSync(path.join(vaultPath, 'Characters/NPCs'), { recursive: true });

  fs.writeFileSync(path.join(vaultPath, '_meta/vault-config.md'), [
    '---',
    'publish:',
    '  images:',
    `    optimize: ${optimize}`,
    '    max_width: 400',
    '---',
    '',
  ].join('\n'));

  fs.writeFileSync(path.join(vaultPath, '_attachments/characters', PORTRAIT), makePng(1600, 900));

  fs.writeFileSync(path.join(vaultPath, 'Characters/NPCs/Rock Lavey.md'), [
    '---',
    'type: npc',
    'status: alive',
    `portrait: _attachments/characters/${PORTRAIT}`,
    '---',
    '',
    '# Rock Lavey',
    '',
    'A dockhand with opinions.',
    '',
  ].join('\n'));

  const configPath = path.join(siteDir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    vaultPath, outputDir,
    attachmentsDir: '_attachments',
    siteTitle: 'Image Site',
    siteUrl: 'https://example.github.io/image-site',
    excludeDirs: ['_meta'],
    folderMap: { 'Characters/NPCs': 'characters/npcs' },
  }, null, 2));

  build({ configPath });
  return { outputDir };
}

describe('image optimization', { skip: !hasCwebp }, () => {
  describe('when publish.images.optimize is true', () => {
    let outputDir;
    before(() => { ({ outputDir } = setupSite({ optimize: true })); });

    it('writes the converted WebP and not the original PNG', () => {
      assert.ok(fs.existsSync(path.join(outputDir, 'images/characters/Rock Lavey.webp')));
      assert.ok(!fs.existsSync(path.join(outputDir, 'images/characters/Rock Lavey.png')));
    });

    it('emits the .webp reference, URL-encoded, at src-emission time', () => {
      const html = fs.readFileSync(path.join(outputDir, 'characters/npcs/rock-lavey.html'), 'utf8');
      assert.ok(html.includes('images/characters/Rock%20Lavey.webp'),
        'portrait src should point at the encoded .webp path');
      assert.ok(!html.includes('Rock%20Lavey.png'), 'no reference should survive to the deleted PNG');
    });

    it('actually shrinks the file', () => {
      const converted = fs.statSync(path.join(outputDir, 'images/characters/Rock Lavey.webp')).size;
      assert.ok(converted > 0);
      assert.ok(converted < 200 * 1024, `expected a small webp, got ${converted} bytes`);
    });

    it('leaves no scratch directory behind', () => {
      const leaked = [...scratchDirs()].filter(n => !preexistingScratch.has(n));
      assert.deepStrictEqual(leaked, []);
    });
  });

  describe('the image cache, across two builds', () => {
    let siteDir, outputDir, first, logs;
    const filesOf = (dir) => fs.readdirSync(dir, { recursive: true })
      .filter((rel) => fs.statSync(path.join(dir, rel)).isFile())
      .map((rel) => rel.split(path.sep).join('/')).sort()
      .map((rel) => [rel, fs.readFileSync(path.join(dir, rel)).toString('base64')]);
    const logged = (fn) => {
      const lines = [];
      const was = console.log;
      console.log = (...a) => lines.push(a.join(' '));
      try { fn(); } finally { console.log = was; }
      return lines.join('\n');
    };
    before(() => {
      logs = [];
      logs.push(logged(() => ({ outputDir } = setupSite({ optimize: true, gitignore: 'node_modules/\n' }))));
      siteDir = path.dirname(outputDir);
      first = filesOf(outputDir);
      logs.push(logged(() => build({ configPath: path.join(siteDir, 'config.json') })));
    });

    it('builds the same site twice', () => {
      assert.deepStrictEqual(filesOf(outputDir), first);
    });

    it('encodes on the first build and nothing on the second', () => {
      assert.match(logs[0], /Optimized 1 image\(s\) via cwebp.*1 encoded now/);
      assert.match(logs[1], /Optimized 1 image\(s\) via cwebp.*0 encoded now/);
    });

    it('keeps the cache in the site folder, outside the output folder, and out of git', () => {
      const cache = path.join(siteDir, '.gm-apprentice', 'image-cache');
      assert.strictEqual(fs.readdirSync(cache).filter((n) => n.endsWith('.webp') && !n.startsWith('.')).length, 1);
      assert.strictEqual(fs.readFileSync(path.join(siteDir, '.gitignore'), 'utf8'), 'node_modules/\n.gm-apprentice/\n');
    });
  });

  // #532: the pictures a setting names are copied by their own steps, and were shipped full size.
  describe('the campaign image and a section banner', () => {
    let outputDir;
    before(() => {
      const siteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-publish-images-'));
      const vaultPath = path.join(siteDir, 'vault');
      outputDir = path.join(siteDir, 'docs');
      fs.mkdirSync(path.join(vaultPath, '_meta'), { recursive: true });
      fs.mkdirSync(path.join(vaultPath, '_attachments'), { recursive: true });
      fs.mkdirSync(path.join(vaultPath, 'Characters/NPCs'), { recursive: true });
      fs.writeFileSync(path.join(vaultPath, '_meta/vault-config.md'), [
        '---', 'publish:', '  images:', '    optimize: true', '  theme:', '    campaign_image: _attachments/Hero Shot.png',
        '  banners:', '    characters/npcs:', '      image: _attachments/band.png', '      link: _attachments/full.png', '---', '',
      ].join('\n'));
      for (const name of ['Hero Shot.png', 'band.png', 'full.png']) fs.writeFileSync(path.join(vaultPath, '_attachments', name), makePng(1200, 600));
      fs.writeFileSync(path.join(vaultPath, 'Characters/NPCs/Rock Lavey.md'), '---\ntype: npc\n---\n\n# Rock Lavey\n');
      const configPath = path.join(siteDir, 'config.json');
      fs.writeFileSync(configPath, JSON.stringify({
        vaultPath, outputDir, attachmentsDir: '_attachments', siteTitle: 'Image Site',
        siteUrl: 'https://example.github.io/image-site', excludeDirs: ['_meta'], folderMap: { 'Characters/NPCs': 'characters/npcs' },
      }));
      const saved = console.log;
      console.log = () => {};
      try { build({ configPath }); } finally { console.log = saved; }
    });

    it('encodes the campaign image, and the landing page and page-not-found page print the encoded file', () => {
      assert.ok(fs.existsSync(path.join(outputDir, 'images/Hero Shot.webp')));
      assert.ok(!fs.existsSync(path.join(outputDir, 'images/Hero Shot.png')));
      assert.match(fs.readFileSync(path.join(outputDir, 'index.html'), 'utf8'), /<img class="landing-hero-img" src="images\/Hero%20Shot\.webp"/);
      assert.match(fs.readFileSync(path.join(outputDir, '404.html'), 'utf8'), /Hero%20Shot\.webp/);
    });

    it('encodes a section banner\'s picture and copies the file its link opens as it is', () => {
      const dir = path.join(outputDir, 'images/banners/characters-npcs');
      assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['band.webp', 'full.png']);
      const html = fs.readFileSync(path.join(outputDir, 'characters/npcs/index.html'), 'utf8');
      assert.ok(html.includes('images/banners/characters-npcs/band.webp'));
      assert.ok(html.includes('images/banners/characters-npcs/full.png'));
    });

    it('leaves no scratch directory behind', () => {
      const leaked = [...scratchDirs()].filter(n => !preexistingScratch.has(n));
      assert.deepStrictEqual(leaked, []);
    });
  });

  // With the site's cache folder a link into the vault the cache cannot be used, so every encode goes to the scratch
  // folder, where an attachment's encoded file waits until the attachments are copied.
  function noCacheSite({ clash }) {
    const siteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-publish-images-'));
    const vaultPath = path.join(siteDir, 'vault');
    const outputDir = path.join(siteDir, 'docs');
    for (const dir of ['_meta/cache', '_attachments/characters', 'Art', 'Characters/NPCs']) fs.mkdirSync(path.join(vaultPath, dir), { recursive: true });
    fs.symlinkSync(path.join(vaultPath, '_meta/cache'), path.join(siteDir, '.gm-apprentice'), 'dir');
    fs.writeFileSync(path.join(vaultPath, '_meta/vault-config.md'), [
      '---', 'publish:', '  images:', '    optimize: true', '  theme:', '    campaign_image: Art/Hero Shot.png', '---', '',
    ].join('\n'));
    fs.writeFileSync(path.join(vaultPath, 'Art/Hero Shot.png'), makePng(1200, 600));
    fs.writeFileSync(path.join(vaultPath, '_attachments/characters/Rock Lavey.png'), makePng(900, 900));
    // Another picture whose encoded name is the campaign image's.
    if (clash) fs.writeFileSync(path.join(vaultPath, '_attachments/Hero Shot.jpg'), makePng(700, 300));
    fs.writeFileSync(path.join(vaultPath, 'Characters/NPCs/Rock Lavey.md'),
      `---\ntype: npc\nportrait: _attachments/characters/Rock Lavey.png\n---\n\n# Rock Lavey\n${clash ? '\n![[Hero Shot.jpg]]\n' : ''}`);
    const configPath = path.join(siteDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      vaultPath, outputDir, attachmentsDir: '_attachments', siteTitle: 'Image Site',
      siteUrl: 'https://example.github.io/image-site', excludeDirs: ['_meta', 'Art'], folderMap: { 'Characters/NPCs': 'characters/npcs' },
    }));
    const warnings = [];
    const saved = { log: console.log, warn: console.warn };
    console.log = () => {};
    console.warn = (...a) => warnings.push(a.join(' '));
    try { build({ configPath }); } finally { Object.assign(console, saved); }
    return { outputDir, warnings, cache: path.join(vaultPath, '_meta/cache') };
  }

  // A WebP's width, from its first chunk: lossy (VP8 ), lossless (VP8L) or extended (VP8X).
  const webpWidth = (file) => {
    const b = fs.readFileSync(file);
    const chunk = b.toString('ascii', 12, 16);
    if (chunk === 'VP8 ') return b.readUInt16LE(26) & 0x3fff;
    if (chunk === 'VP8L') return (b.readUInt16LE(21) & 0x3fff) + 1;
    if (chunk === 'VP8X') return b.readUIntLE(24, 3) + 1;
    return null;
  };

  describe('the campaign image beside a portrait, without the image cache', () => {
    let site;
    before(() => { site = noCacheSite({ clash: false }); });

    it('makes no image cache', () => {
      assert.deepStrictEqual(fs.readdirSync(site.cache), []);
    });

    it('ships the portrait\'s own picture and the campaign image\'s own, each encoded', () => {
      assert.strictEqual(webpWidth(path.join(site.outputDir, 'images/characters/Rock Lavey.webp')), 900);
      assert.strictEqual(webpWidth(path.join(site.outputDir, 'images/Hero Shot.webp')), 1200);
    });

    it('leaves no scratch directory behind', () => {
      const leaked = [...scratchDirs()].filter(n => !preexistingScratch.has(n));
      assert.deepStrictEqual(leaked, []);
    });
  });

  describe('a campaign image whose encoded name is an attachment\'s', () => {
    let site;
    before(() => { site = noCacheSite({ clash: true }); });

    it('keeps its own name, leaves the attachment its picture, and says so', () => {
      assert.strictEqual(webpWidth(path.join(site.outputDir, 'images/Hero Shot.webp')), 700);
      assert.ok(fs.existsSync(path.join(site.outputDir, 'images/Hero Shot.png')));
      assert.match(fs.readFileSync(path.join(site.outputDir, 'index.html'), 'utf8'), /<img class="landing-hero-img" src="images\/Hero%20Shot\.png"/);
      assert.ok(site.warnings.some((w) => /Hero Shot\.png.*already taken/.test(w)), site.warnings.join('\n'));
    });
  });

  describe('when optimization is off (the default)', () => {
    let outputDir;
    before(() => { ({ outputDir } = setupSite({ optimize: false })); });

    it('copies the original bytes untouched', () => {
      assert.ok(fs.existsSync(path.join(outputDir, 'images/characters/Rock Lavey.png')));
      assert.ok(!fs.existsSync(path.join(outputDir, 'images/characters/Rock Lavey.webp')));
    });

    it('still references the .png', () => {
      const html = fs.readFileSync(path.join(outputDir, 'characters/npcs/rock-lavey.html'), 'utf8');
      assert.ok(html.includes('images/characters/Rock%20Lavey.png'));
    });

    it('makes no image cache', () => {
      assert.ok(!fs.existsSync(path.join(path.dirname(outputDir), '.gm-apprentice', 'image-cache')));
    });
  });
});
