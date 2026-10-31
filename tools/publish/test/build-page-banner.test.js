'use strict';
// #362: a note's `banner:` puts a picture at the top of its own page, and player_site.theme.page_banner is the
// picture every note's page shows when it names none. A section's banner stays on its list.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { build } = require('../lib/build');
const { writeNewConfig } = require('./helpers/settings-files');
const { makePng } = require('./helpers/make-png');
const { detectEncoder } = require('../lib/image-optimize');
const { attachmentName, renderBanner } = require('../lib/banners');

const encodes = detectEncoder() !== null;
const roots = [];
after(() => roots.forEach((r) => fs.rmSync(r, { recursive: true, force: true })));

// notes: { 'Folder/Note.md': text }; pictures: vault-relative paths written as small PNGs (SVG text for .svg).
function site({ notes, pictures = [], player = {}, sites = ['player'] }) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'page-banner-')));
  roots.push(root);
  const vault = path.join(root, 'vault');
  const map = {};
  for (const [rel, text] of Object.entries(notes)) {
    fs.mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true });
    fs.writeFileSync(path.join(vault, rel), text);
    map[path.posix.dirname(rel)] = path.posix.dirname(rel).toLowerCase();
  }
  for (const rel of pictures) {
    fs.mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true });
    fs.writeFileSync(path.join(vault, rel), rel.endsWith('.svg') ? '<svg viewBox="0 0 4 4"><circle cx="2" cy="2" r="1"/></svg>' : makePng(40, 20));
  }
  const siteDir = path.join(root, 'campaign');
  fs.mkdirSync(siteDir);
  writeNewConfig(vault, { version: 1, player_site: { folder: siteDir, folder_map: map, ...player }, gm_site: { publish: true, folder: path.join(root, 'campaign-gm') } });
  const configPath = path.join(siteDir, 'vault.config.json');
  fs.writeFileSync(configPath, JSON.stringify({ vaultPath: vault }));
  const saved = { log: console.log, warn: console.warn, error: console.error };
  const warnings = [];
  console.log = () => {}; console.warn = (m) => warnings.push(String(m)); console.error = () => {};
  try { for (const s of sites) build({ configPath, site: s }); } finally { Object.assign(console, saved); }
  const out = { player: path.join(siteDir, 'docs'), gm: path.join(root, 'campaign-gm') };
  return {
    warnings,
    read: (rel, s = 'player') => fs.readFileSync(path.join(out[s], rel), 'utf8'),
    exists: (rel, s = 'player') => fs.existsSync(path.join(out[s], rel)),
  };
}

const banner = (html) => (html.match(/<figure class="section-banner[^"]*page-banner">[\s\S]*?<\/figure>/) || [null])[0];
const npc = (fields = '') => `---\ntype: npc\n${fields}---\n\nA ferry pilot.\n`;

test('a page whose note names no banner, on a site with no default, is as it was: no banner', () => {
  const s = site({ notes: { 'NPCs/Mara.md': npc() }, pictures: ['_attachments/Harbour.png'] });
  const html = s.read('npcs/mara.html');
  assert.equal(banner(html), null);
  assert.doesNotMatch(html, /section-banner|page-banner/);
  assert.equal(s.exists('images/Harbour.png'), false, 'an attachment nothing names is not copied');
});

for (const [written, label] of [
  ['_attachments/Harbour.png', 'a path'],
  ['Harbour.png', 'a bare name'],
  ['"[[Harbour.png]]"', 'a quoted wikilink'],
  ['[[Harbour.png]]', 'an unquoted wikilink'],
  ['"![[Harbour.png|600]]"', 'an embed'],
]) {
  test(`banner: as ${label} puts the attachment at the top of the note's page`, () => {
    const s = site({ notes: { 'NPCs/Mara.md': npc(`banner: ${written}\n`) }, pictures: ['_attachments/Harbour.png'] });
    const html = s.read('npcs/mara.html');
    assert.equal(banner(html), '<figure class="section-banner page-banner"><img src="../images/Harbour.png" alt="Harbour" class="section-banner-img"></figure>');
    assert.ok(html.indexOf('page-banner') < html.indexOf('<h1'), 'above the title, at the top of the page body');
    assert.equal(s.exists('images/Harbour.png'), true);
    assert.deepEqual(s.warnings.filter((w) => /banner/.test(w)), []);
  });
}

test('the object form takes alt text and a link to a larger picture', () => {
  const s = site({
    notes: { 'NPCs/Mara.md': npc('banner:\n  image: Harbour.png\n  alt: The north channel\n  link: Harbour Full.png\n') },
    pictures: ['_attachments/Harbour.png', '_attachments/Harbour Full.png'],
  });
  assert.equal(banner(s.read('npcs/mara.html')),
    '<figure class="section-banner page-banner"><a class="section-banner-link" href="../images/Harbour%20Full.png"><img src="../images/Harbour.png" alt="The north channel" class="section-banner-img"></a></figure>');
  assert.equal(s.exists('images/Harbour Full.png'), true);
});

test('the site default is on every note page that names none, and not on section lists or the landing page', () => {
  const s = site({
    notes: { 'NPCs/Mara.md': npc(), 'Locations/Harbour.md': '---\ntype: location\n---\n\nCold.\n' },
    pictures: ['Art/Default Header.png'],
    player: { theme: { page_banner: 'Art/Default Header.png' } },
  });
  for (const page of ['npcs/mara.html', 'locations/harbour.html']) {
    assert.equal(banner(s.read(page)),
      '<figure class="section-banner page-banner"><img src="../images/banners/page/Default%20Header.png" alt="Default Header" class="section-banner-img"></figure>', page);
  }
  assert.doesNotMatch(s.read('locations/index.html'), /page-banner/);
  assert.doesNotMatch(s.read('index.html'), /page-banner/);
  assert.equal(s.exists('images/banners/page/Default Header.png'), true);
});

test("a note's banner wins over the site default, and banner: false leaves its page without one", () => {
  const s = site({
    notes: { 'NPCs/Mara.md': npc('banner: Harbour.png\n'), 'NPCs/Ned.md': npc('banner: false\n'), 'NPCs/Ora.md': npc() },
    pictures: ['_attachments/Harbour.png', 'Art/Default.png'],
    player: { theme: { page_banner: 'Art/Default.png' } },
  });
  assert.match(banner(s.read('npcs/mara.html')), /src="\.\.\/images\/Harbour\.png"/);
  assert.equal(banner(s.read('npcs/ned.html')), null);
  assert.match(banner(s.read('npcs/ora.html')), /src="\.\.\/images\/banners\/page\/Default\.png"/);
});

test('ordinary pages do not take their section banner', () => {
  const s = site({
    notes: { 'Locations/Harbour.md': '---\ntype: location\n---\n\nCold.\n' },
    pictures: ['_attachments/Crowd.png'],
    player: { lists: { banners: { locations: '_attachments/Crowd.png' } } },
  });
  assert.match(s.read('locations/index.html'), /class="section-banner"/);
  assert.doesNotMatch(s.read('locations/harbour.html'), /section-banner/);
});

test("an unpublished note's banner picture is not copied to the player site; the GM site has it", () => {
  const s = site({
    notes: { 'NPCs/Mara.md': npc(), 'NPCs/Secret.md': npc('publish: false\nbanner: Secret Lair.png\n') },
    pictures: ['_attachments/Secret Lair.png'],
    sites: ['player', 'gm'],
  });
  assert.equal(s.exists('npcs/secret.html'), false);
  assert.equal(s.exists('images/Secret Lair.png'), false);
  assert.ok(s.exists('npcs/secret.html', 'gm'));
  assert.match(banner(s.read('npcs/secret.html', 'gm')), /Secret%20Lair\.png/);
  assert.equal(s.exists('images/Secret Lair.png', 'gm'), true);
});

test('a banner in a hidden attachments folder is not found, and the page shows none', () => {
  const s = site({
    notes: { 'NPCs/Mara.md': npc('banner: Lair.png\n') },
    pictures: ['_attachments/gm/Lair.png'],
    player: { hide: { folders: ['_attachments/gm'] } },
  });
  assert.equal(banner(s.read('npcs/mara.html')), null);
  assert.equal(s.exists('images/gm/Lair.png'), false);
});

test('a banner picture that is not there is a warning, not a failed build, and the default stands in', () => {
  const s = site({
    notes: { 'NPCs/Mara.md': npc('banner: Nowhere.png\n') },
    pictures: ['Art/Default.png'],
    player: { theme: { page_banner: 'Art/Default.png' } },
  });
  assert.match(banner(s.read('npcs/mara.html')), /banners\/page\/Default\.png/);
  assert.ok(s.warnings.some((w) => /npcs\/mara\.html: banner "Nowhere\.png" is not a picture in the attachments folder/.test(w)), s.warnings.join('\n'));
});

test('a default page banner that is not in the vault is reported as a section banner is, and no page shows one', () => {
  const s = site({ notes: { 'NPCs/Mara.md': npc() }, player: { theme: { page_banner: 'Art/Gone.png' } } });
  assert.equal(banner(s.read('npcs/mara.html')), null);
  assert.ok(s.warnings.some((w) => /WARNING: player_site\.theme\.page_banner "Art\/Gone\.png" not found in the vault — skipping/.test(w)), s.warnings.join('\n'));
});

test('an SVG banner with no link is inlined, as a section banner is', () => {
  const s = site({ notes: { 'NPCs/Mara.md': npc('banner: Map.svg\n') }, pictures: ['_attachments/Map.svg'] });
  assert.equal(banner(s.read('npcs/mara.html')),
    '<figure class="section-banner section-banner-inline page-banner"><svg viewBox="0 0 4 4"><circle cx="2" cy="2" r="1"/></svg></figure>');
  assert.equal(s.exists('images/Map.svg'), false, 'an inlined picture needs no file');
});

test('with the theme hooks on, the banner sits inside the main column before the title block', () => {
  const s = site({ notes: { 'NPCs/Mara.md': npc('banner: Harbour.png\n') }, pictures: ['_attachments/Harbour.png'], player: { theme: { hooks: true } } });
  const html = s.read('npcs/mara.html');
  assert.ok(html.indexOf('page-banner') < html.indexOf('data-title-block'));
});

test('a PC page carries the banner too', () => {
  const s = site({ notes: { 'PCs/Ash.md': '---\ntype: pc\nplayer_name: Pat\nstatus: alive\nbanner: Harbour.png\n---\n\nA climber.\n' }, pictures: ['_attachments/Harbour.png'] });
  assert.match(banner(s.read('pcs/ash.html')), /src="\.\.\/images\/Harbour\.png"/);
});

test('optimising: the note banner and the default are the encoded files, and never take an attachment\'s name', { skip: !encodes && 'no WebP encoder here' }, () => {
  // Art/Harbour.png (the default) and _attachments/Harbour.png (a note's) share a name: each keeps its own address.
  const s = site({
    notes: { 'NPCs/Mara.md': npc('banner: Harbour.png\n'), 'NPCs/Ora.md': npc() },
    pictures: ['_attachments/Harbour.png', 'Art/Harbour.png'],
    player: { images: { optimize: true }, theme: { page_banner: 'Art/Harbour.png' } },
  });
  assert.match(banner(s.read('npcs/mara.html')), /src="\.\.\/images\/Harbour\.webp"/);
  assert.match(banner(s.read('npcs/ora.html')), /src="\.\.\/images\/banners\/page\/Harbour\.webp"/);
  assert.ok(s.exists('images/Harbour.webp'));
  assert.ok(s.exists('images/banners/page/Harbour.webp'));
  assert.equal(s.exists('images/Harbour.png'), false);
});

test('attachmentName reads every form a GM writes for a picture', () => {
  assert.equal(attachmentName('_attachments/maps/Harbour.png'), 'Harbour.png');
  assert.equal(attachmentName('[[Harbour.png]]'), 'Harbour.png');
  assert.equal(attachmentName('![[maps/Harbour.png|600]]'), 'Harbour.png');
  assert.equal(attachmentName(' '), null);
  assert.equal(attachmentName('[[]]'), null);
});

test('renderBanner marks a page banner, and a section banner is as it was', () => {
  assert.equal(renderBanner({ imageHref: 'a.png', alt: 'A' }), '<figure class="section-banner"><img src="a.png" alt="A" class="section-banner-img"></figure>');
  assert.equal(renderBanner({ imageHref: 'a.png', alt: 'A' }, { page: true }), '<figure class="section-banner page-banner"><img src="a.png" alt="A" class="section-banner-img"></figure>');
});
