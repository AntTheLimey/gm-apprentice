'use strict';
// #385: the landing page prints player_site.theme.campaign_image, and a name holding a space or a bracket must reach
// the page encoded, as every other picture address on the site is. Built with and without the image-optimising step.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { build } = require('../lib/build');
const { writeNewConfig } = require('./helpers/settings-files');
const { makePng } = require('./helpers/make-png');

const NAME = 'Rock [Lavey] Crest.png';

function heroSrc(optimize, image = `Art/${NAME}`, binary = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'landing-image-'));
  const vault = path.join(root, 'vault');
  fs.mkdirSync(path.join(vault, 'Characters'), { recursive: true });
  fs.writeFileSync(path.join(vault, 'Characters/Mara_Quill.md'), '---\ntype: npc\n---\n\nA person.\n');
  if (binary) {
    fs.mkdirSync(path.join(vault, 'Art'), { recursive: true });
    fs.writeFileSync(path.join(vault, 'Art', NAME), makePng(40, 20));
  }
  writeNewConfig(vault, {
    version: 1,
    player_site: {
      folder_map: { Characters: 'characters' },
      theme: { campaign_image: image },
      ...(optimize ? { images: { optimize: true } } : {}),
    },
  });
  const configPath = path.join(root, 'vault.config.json');
  fs.writeFileSync(configPath, JSON.stringify({ vaultPath: './vault' }));
  const saved = { log: console.log, warn: console.warn, error: console.error };
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  try { build({ configPath }); } finally { Object.assign(console, saved); }
  const html = fs.readFileSync(path.join(root, 'docs', 'index.html'), 'utf8');
  const m = html.match(/<img class="landing-hero-img" src="([^"]*)"/);
  return { src: m && m[1], root };
}

for (const optimize of [false, true]) {
  test(`the hero picture address is encoded when the name holds a space and a bracket (optimising ${optimize ? 'on' : 'off'})`, () => {
    const { src } = heroSrc(optimize);
    assert.equal(src, 'images/Rock%20%5BLavey%5D%20Crest.png');
  });
}

test('a web address for the hero picture is printed as written, spaces aside', () => {
  const { src } = heroSrc(false, 'https://example.com/a b/crest.png', false);
  assert.equal(src, 'https://example.com/a%20b/crest.png');
});
