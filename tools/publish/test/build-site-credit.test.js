'use strict';
// player_site.credit (#849): the "Powered by GM-Apprentice" line at the foot of every page of the player site, on
// unless the GM turns it off. It is its own line under the GM's footer, and never on the GM site.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { build } = require('../lib/build');
const { writeNewConfig } = require('./helpers/settings-files');

const LINK = '<a href="https://gmapprentice.com" rel="noopener">Powered by GM-Apprentice</a>';

function site(settings = {}, { gm = false, files = {} } = {}) {
  const gmRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'site-credit-gm-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'site-credit-'));
  const vault = path.join(root, 'vault');
  const all = {
    'Characters/Mara_Quill.md': '---\ntype: npc\n---\n\nA person.\n',
    'Characters/PCs/Brill.md': '---\ntype: pc\nplayer: Sam\n---\n\nA hero.\n',
    'Locations/Harbour.md': '---\ntype: location\n---\n\nA place.\n',
    'Factions/Guild.md': '---\ntype: faction\n---\n\nA guild.\n',
    '_World/The_Sea.md': '---\ntype: world\n---\n\nWet.\n',
    ...files,
  };
  for (const [rel, text] of Object.entries(all)) {
    fs.mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true });
    fs.writeFileSync(path.join(vault, rel), text);
  }
  writeNewConfig(vault, {
    version: 1,
    player_site: {
      folder_map: { 'Characters/PCs': 'characters/pcs', Characters: 'characters/npcs', Locations: 'locations', Factions: 'factions', _World: 'world', Documents: 'documents' },
      ...settings,
    },
    ...(gm ? { gm_site: { publish: true, folder: path.join(gmRoot, 'site') } } : {}),
  });
  const configPath = path.join(root, 'vault.config.json');
  fs.writeFileSync(configPath, JSON.stringify({ vaultPath: './vault' }));
  const warnings = [];
  const saved = { log: console.log, warn: console.warn, error: console.error };
  console.log = () => {};
  console.warn = (...a) => { warnings.push(a.join(' ')); };
  console.error = () => {};
  try { build(gm ? { configPath, site: 'gm' } : { configPath }); } finally { Object.assign(console, saved); }
  const docs = gm ? path.join(gmRoot, 'site') : path.join(root, 'docs');
  const pages = fs.readdirSync(docs, { recursive: true }).filter((f) => String(f).endsWith('.html'))
    .map((f) => ({ name: String(f), html: fs.readFileSync(path.join(docs, String(f)), 'utf8') }));
  return { pages, warnings, page: (name) => pages.find((p) => p.name === name).html };
}

const count = (html) => html.split(LINK).length - 1;
// A redirect page has no body of its own to credit.
const drawn = (pages) => pages.filter((p) => !p.html.includes('http-equiv="refresh"'));

test('every page the tool draws carries the credit once, the 404 page included', () => {
  const { pages } = site();
  assert.ok(pages.some((p) => p.name === '404.html'));
  assert.ok(drawn(pages).length > 8, `only ${pages.length} pages`);
  for (const p of drawn(pages)) assert.equal(count(p.html), 1, p.name);
});

test('the credit is its own line under the GM\'s footer, whose words are still escaped', () => {
  const html = site({ footer: 'Tim & <b>friends</b>' }).page('index.html');
  const footer = html.slice(html.indexOf('<footer'), html.indexOf('</footer>'));
  assert.match(footer, /Tim &amp; &lt;b&gt;friends&lt;\/b&gt;/);
  assert.ok(footer.indexOf('friends') < footer.indexOf(LINK), footer);
});

test('switched off, no page has it, and a site with no footer has no footer element', () => {
  const { pages } = site({ credit: false });
  for (const p of pages) {
    assert.equal(count(p.html), 0, p.name);
    assert.ok(!p.html.includes('site-credit'), p.name);
    assert.ok(!p.html.includes('<footer'), p.name);
  }
});

test('switched off, the GM\'s own footer stays', () => {
  const html = site({ credit: false, footer: 'Ours' }).page('index.html');
  assert.match(html, /<footer class="site-footer">Ours<\/footer>/);
});

test('a value that is not a switch word leaves it off and is reported', () => {
  const { pages, warnings } = site({ credit: 'nope' });
  for (const p of pages) assert.equal(count(p.html), 0, p.name);
  assert.ok(warnings.some((w) => w.includes('player_site.credit')), warnings.join('\n'));
});

test('a line with nothing after the colon counts as off and is reported', () => {
  const { pages, warnings } = site({ credit: null });
  for (const p of pages) assert.equal(count(p.html), 0, p.name);
  assert.ok(warnings.some((w) => w.includes('player_site.credit')), warnings.join('\n'));
});

test('a handout\'s own styled page, an object of the game, does not carry it; its note\'s page does', () => {
  const { pages } = site({}, { files: {
    '_meta/prop-styles/t/layout.html': '<h1>{{title}}</h1>{{{body}}}',
    '_meta/prop-styles/t/style.css': 'h1 { color: red; }\n',
    'Documents/Letter.md': '---\ntype: prop\nprop_style: t\n---\nA letter.\n\n## The Text\n\nDear Sir.\n',
  } });
  const styled = pages.filter((p) => p.html.includes('prop-style-t'));
  assert.equal(styled.length, 1, pages.map((p) => p.name).join(' '));
  assert.equal(count(styled[0].html), 0);
  const note = pages.find((p) => p !== styled[0] && /letter\.html$/.test(p.name));
  assert.equal(count(note.html), 1, note.name);
});

test('the GM site never carries it', () => {
  const { pages } = site({}, { gm: true });
  assert.ok(pages.length > 5);
  for (const p of pages) assert.equal(count(p.html), 0, p.name);
});

test('a build with it off after one with it on writes none', () => {
  site();
  assert.equal(count(site({ credit: false }).page('index.html')), 0);
});
