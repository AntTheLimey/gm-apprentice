const { describe, it, before } = require('node:test');
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

function setupSite({ optimize }) {
  const siteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-publish-images-'));
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
  });
});
