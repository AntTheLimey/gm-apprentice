'use strict';
// player_site.own_pages (#850): a page of the GM's own, put on the site by an after_build step (Dead End's star map),
// is shown under the site's menu bar. The build moves the page to `<name>.own.html` and writes a site page at its
// address that frames it; a rebuild that kept the framed page frames it again from the kept copy, never the frame.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { build } = require('../lib/build');
const { writeNewConfig } = require('./helpers/settings-files');

const OWN = path.join(__dirname, 'fixtures', 'steps', 'own-page.js');
const FIXTURE = path.join(__dirname, 'fixtures', 'with-dnd-pc');
const step = (address) => `node ${JSON.stringify(OWN)} ${address}`;

function scratch(settings, notes = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'own-pages-'));
  const vault = path.join(root, 'vault');
  const site = path.join(root, 'site');
  fs.cpSync(FIXTURE, vault, { recursive: true });
  for (const [rel, text] of Object.entries(notes)) fs.writeFileSync(path.join(vault, rel), text);
  fs.mkdirSync(site);
  const folderMap = { 'Characters/PCs': 'characters/pcs', Creatures: 'creatures', Items: 'items' };
  writeNewConfig(vault, { version: 1, vault: { system: 'dnd-5e-2024' }, player_site: { title: 'T', hide: { folders: ['_meta', '_Templates'] }, folder_map: folderMap, ...settings } });
  const configPath = path.join(site, 'vault.config.json');
  fs.writeFileSync(configPath, JSON.stringify({ vaultPath: '../vault' }, null, 2));
  const docs = (...p) => path.join(site, 'docs', ...p);
  return { root, site, configPath, docs, read: (...p) => fs.readFileSync(docs(...p), 'utf8'), cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
function buildIn(s) {
  const saved = { log: console.log, warn: console.warn };
  const warnings = [];
  console.log = () => {}; console.warn = (...a) => warnings.push(a.join(' '));
  try { build({ configPath: s.configPath, runSteps: true, site: 'player' }); } finally { Object.assign(console, saved); }
  return warnings;
}

test('a page an after_build step puts on the site is framed under the menu bar, its own copy kept beside it', () => {
  const s = scratch({ after_build: [step('map/index.html')], own_pages: ['map/index.html'], menu_extra: [{ label: 'Star Map', link: 'map/index.html', group: 'World' }] });
  try {
    const warnings = buildIn(s);
    assert.deepEqual(warnings.filter((w) => /own_pages/.test(w)), []);
    const frame = s.read('map', 'index.html');
    assert.match(frame, /<header class="top-nav"/, 'the site page has the menu bar');
    assert.match(frame, /<iframe class="own-page-frame" data-src="index\.own\.html" title="Star Map" allow="fullscreen" allowfullscreen>/);
    assert.match(frame, /<title>Star Map — T<\/title>/, 'titled from the page, the site title once');
    assert.match(frame, /<body class="own-page">/);
    assert.match(frame, /href="\.\.\/css\/style\.css"/, 'the stylesheets are linked from the map folder');
    assert.match(frame, /src="\.\.\/js\/search\.js"/, 'search comes with the bar');
    assert.match(frame, /href="index\.html">Star Map<\/a>/, 'the menu entry links to the page from its own folder');
    const own = s.read('map', 'index.own.html');
    assert.match(own, /<div id="app"><\/div>/, 'the GM\'s page is kept as written');
    assert.doesNotMatch(own, /top-nav/);
    assert.match(s.read('index.html'), /href="map\/index\.html">Star Map<\/a>/, 'other pages link to it through the menu');
  } finally { s.cleanup(); }
});

test('a framed page kept from the last build is framed again from its own copy, not framed twice', () => {
  const s = scratch({ keep: ['map'], own_pages: ['map/index.html'] });
  try {
    // The first build has the step; the second has none, so the kept folder holds last build's frame and own copy.
    fs.mkdirSync(path.join(s.site, 'docs'), { recursive: true });
    const first = scratch({ after_build: [step('map/index.html')], own_pages: ['map/index.html'] });
    try { buildIn(first); fs.cpSync(first.docs('map'), s.docs('map'), { recursive: true }); } finally { first.cleanup(); }
    buildIn(s);
    const frame = s.read('map', 'index.html');
    assert.equal(frame.match(/<iframe/g).length, 1);
    assert.match(frame, /data-src="index\.own\.html"/);
    assert.match(s.read('map', 'index.own.html'), /<div id="app"><\/div>/, 'the own copy is the GM\'s page, not a frame');
  } finally { s.cleanup(); }
});

test('an address with no page after the steps, or one that is not a page address, is reported and left alone', () => {
  const s = scratch({ own_pages: ['map/index.html', '../outside.html', 'notes.txt'] });
  try {
    const warnings = buildIn(s).filter((w) => /own_pages/.test(w));
    assert.ok(warnings.some((w) => w.includes('"map/index.html"') && /no page there/.test(w)), warnings.join('\n'));
    assert.ok(warnings.some((w) => w.includes('"../outside.html"') && /not an address on the site/.test(w)), warnings.join('\n'));
    assert.ok(warnings.some((w) => w.includes('"notes.txt"') && /not an address on the site/.test(w)), warnings.join('\n'));
    assert.equal(fs.existsSync(s.docs('map')), false);
  } finally { s.cleanup(); }
});

test('a page at the top of the site is framed too, its links relative to the top', () => {
  const s = scratch({ after_build: [step('atlas.html')], own_pages: ['atlas.html'] });
  try {
    buildIn(s);
    const frame = s.read('atlas.html');
    assert.match(frame, /data-src="atlas\.own\.html"/);
    assert.match(frame, /href="css\/style\.css"/);
    assert.ok(fs.existsSync(s.docs('atlas.own.html')));
  } finally { s.cleanup(); }
});

test('a menu entry to an own page links to it even when a note is named like its file (Dead End has an "index")', () => {
  const s = scratch({ after_build: [step('map/index.html')], own_pages: ['map/index.html'], menu_extra: [{ label: 'Star Map', link: 'map/index.html', group: 'World' }] },
    { 'Items/index.md': '---\ntype: item\n---\n\nAn item called index.\n' });
  try {
    buildIn(s);
    assert.ok(fs.existsSync(s.docs('items', 'index.html')) || /index/.test(fs.readdirSync(s.docs('items')).join(' ')), 'the note named index has a page');
    assert.match(s.read('index.html'), /href="map\/index\.html">Star Map<\/a>/);
    assert.doesNotMatch(s.read('index.html'), /href="items\/[^"]*">Star Map<\/a>/);
  } finally { s.cleanup(); }
});

test('a build that writes nothing (doctor, explain) leaves an own page as it is; a preview build says nothing of it', () => {
  const s = scratch({ after_build: [step('map/index.html')], own_pages: ['map/index.html'] });
  try {
    buildIn(s);
    // As a step left it, unframed, with no own copy: a dry build must not move or frame it.
    fs.rmSync(s.docs('map', 'index.own.html'));
    const bare = '<!DOCTYPE html><html><head><title>Bare</title></head><body>bare</body></html>';
    fs.writeFileSync(s.docs('map', 'index.html'), bare);
    const log = console.log; const warn = console.warn; console.log = () => {}; console.warn = () => {};
    try { build({ configPath: s.configPath, inMemory: true, site: 'player' }); } finally { console.log = log; console.warn = warn; }
    assert.equal(s.read('map', 'index.html'), bare);
    assert.equal(fs.existsSync(s.docs('map', 'index.own.html')), false);
    // A preview builds into a folder of its own and runs no step: no page to frame there, and no warning about it.
    const preview = fs.mkdtempSync(path.join(os.tmpdir(), 'own-pages-preview-'));
    const warnings = [];
    console.log = () => {}; console.warn = (...a) => warnings.push(a.join(' '));
    try { build({ configPath: s.configPath, runSteps: true, outputDirOverride: preview, site: 'player' }); } finally { console.log = log; console.warn = warn; fs.rmSync(preview, { recursive: true, force: true }); }
    assert.deepEqual(warnings.filter((w) => /own_pages/.test(w)), []);
  } finally { s.cleanup(); }
});

test('the GM site frames its own page too, its GM band in the site page above the frame', () => {
  const s = scratch({});
  const gmDir = path.join(s.root, 'site-gm');
  writeNewConfig(path.join(s.root, 'vault'), { version: 1, vault: { system: 'dnd-5e-2024' },
    player_site: { title: 'T', hide: { folders: ['_meta', '_Templates'] }, folder_map: { 'Characters/PCs': 'characters/pcs', Creatures: 'creatures', Items: 'items' } },
    gm_site: { publish: true, folder: gmDir, after_build: [`node ${JSON.stringify(OWN)} map/index.html ${JSON.stringify(gmDir)}`], own_pages: ['map/index.html'] } });
  try {
    const log = console.log; const warn = console.warn; console.log = () => {}; console.warn = () => {};
    try { build({ configPath: s.configPath, runSteps: true, site: 'gm' }); } finally { console.log = log; console.warn = warn; }
    const frame = fs.readFileSync(path.join(gmDir, 'map', 'index.html'), 'utf8');
    assert.match(frame, /<iframe class="own-page-frame" data-src="index\.own\.html"/);
    assert.ok(frame.indexOf('gm-band') > -1 && frame.indexOf('gm-band') < frame.indexOf('<iframe'), 'the band comes before the frame');
    assert.ok(fs.existsSync(path.join(gmDir, 'map', 'index.own.html')));
  } finally { s.cleanup(); }
});

test('atlas.htm and atlas.html each keep a copy of their own', () => {
  const s = scratch({ after_build: [step('atlas.htm'), step('atlas.html')], own_pages: ['atlas.htm', 'atlas.html'] });
  try {
    buildIn(s);
    assert.match(s.read('atlas.htm'), /data-src="atlas\.own\.htm"/);
    assert.match(s.read('atlas.html'), /data-src="atlas\.own\.html"/);
    assert.match(s.read('atlas.own.htm'), /<div id="app"><\/div>/);
    assert.match(s.read('atlas.own.html'), /<div id="app"><\/div>/);
  } finally { s.cleanup(); }
});

test('a page a step puts under a link in the site folder is not framed, and the build says it failed', (t) => {
  const s = scratch({ keep: ['map'], after_build: [step('map/index.html')], own_pages: ['map/index.html'] });
  try {
    const outside = path.join(s.root, 'outside');
    fs.mkdirSync(outside);
    fs.mkdirSync(s.docs(), { recursive: true });
    try { fs.symlinkSync(outside, s.docs('map'), 'dir'); } catch { t.skip('this system cannot make a link'); return; }
    let err;
    try { buildIn(s); } catch (e) { err = e; }
    assert.ok(err && err.errorCount >= 1, 'the build reports an error');
    assert.doesNotMatch(fs.readFileSync(path.join(outside, 'index.html'), 'utf8'), /own-page-frame/, 'the page behind the link is not framed');
    assert.equal(fs.existsSync(path.join(outside, 'index.own.html')), false);
  } finally { s.cleanup(); }
});
