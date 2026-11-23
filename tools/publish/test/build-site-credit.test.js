'use strict';
// player_site.credit (#849, #862): the player site's credit to GM-Apprentice, on unless the GM turns it off. Three parts:
// the raven in the header, the raven and a line at the end of the page under the GM's own footer, and a line at the foot
// of the phone menu. Never on the GM site, nor on a handout's own styled page.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { build } = require('../lib/build');
const { writeNewConfig } = require('./helpers/settings-files');

const { CREDIT_MARK, CREDIT_MENU, CREDIT_LINE } = require('./helpers/site-credit');

// What a build printed as warnings, with nothing on the console.
function quiet(run) {
  const warnings = [];
  const saved = { log: console.log, warn: console.warn, error: console.error };
  console.log = () => {};
  console.warn = (...a) => { warnings.push(a.join(' ')); };
  console.error = () => {};
  try { run(); } finally { Object.assign(console, saved); }
  return warnings;
}

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
  const warnings = quiet(() => build(gm ? { configPath, site: 'gm' } : { configPath }));
  const docs = gm ? path.join(gmRoot, 'site') : path.join(root, 'docs');
  const pages = fs.readdirSync(docs, { recursive: true }).filter((f) => String(f).endsWith('.html'))
    .map((f) => ({ name: String(f), html: fs.readFileSync(path.join(docs, String(f)), 'utf8') }));
  return { root, pages, warnings, page: (name) => pages.find((p) => p.name === name).html };
}

const times = (html, part) => html.split(part).length - 1;
// Every mention, whatever part it is in: a page without the credit has none.
const count = (html) => times(html, 'gmapprentice.com');
// A redirect page has no body of its own to credit.
const drawn = (pages) => pages.filter((p) => !p.html.includes('http-equiv="refresh"'));

test('every page the tool draws carries each part once; the 404 page, which has no menu, the last line only', () => {
  const { pages } = site();
  assert.ok(pages.some((p) => p.name === '404.html'));
  assert.ok(drawn(pages).length > 8, `only ${pages.length} pages`);
  for (const p of drawn(pages)) {
    const menu = p.name === '404.html' ? 0 : 1;
    assert.equal(times(p.html, CREDIT_LINE), 1, p.name);
    assert.equal(times(p.html, CREDIT_MARK), menu, p.name);
    assert.equal(times(p.html, CREDIT_MENU), menu, p.name);
    assert.equal(count(p.html), 1 + 2 * menu, p.name);
  }
});

test('the mark closes the header after the search and light/dark buttons, and the menu line closes the phone menu', () => {
  const html = site({ theme: { genre: 'noir' } }).page('index.html');
  const header = html.slice(html.indexOf('<header class="top-nav"'), html.indexOf('</header>'));
  assert.ok(header.indexOf('nav-search-btn') < header.indexOf('nav-color-mode-btn'), header);
  assert.ok(header.indexOf('nav-color-mode-btn') < header.indexOf(CREDIT_MARK), header);
  const phone = html.slice(html.indexOf('<div id="mobile-nav"'));
  assert.match(phone.slice(phone.indexOf(CREDIT_MENU) + CREDIT_MENU.length), /^\s*<\/div>/);
});

test('the raven is drawn by the site\'s own stylesheet, once, and nothing is fetched for it', () => {
  const { root, pages } = site();
  const css = fs.readFileSync(path.join(root, 'docs', 'css', 'style.css'), 'utf8');
  assert.equal(css.split('mask: url("data:image/svg+xml,').length - 1, 1);
  for (const p of pages) assert.ok(!p.html.includes('data:image/svg+xml'), p.name);
});

test('at the page\'s end the credit is its own line under the GM\'s footer, whose words are still escaped', () => {
  const html = site({ footer: 'Tim & <b>friends</b>' }).page('index.html');
  const footer = html.slice(html.indexOf('<footer'), html.indexOf('</footer>'));
  assert.match(footer, /Tim &amp; &lt;b&gt;friends&lt;\/b&gt;/);
  assert.ok(footer.indexOf('friends') < footer.indexOf(CREDIT_LINE), footer);
  assert.ok(!footer.includes('credit-only'), footer);
});

test('a sheets-only build beside a stylesheet from before the marks writes none; beside a newer one it writes them', () => {
  const { root } = site();
  const css = path.join(root, 'docs', 'css', 'style.css');
  const rebuilt = () => {
    quiet(() => build({ configPath: path.join(root, 'vault.config.json'), only: 'sheets' }));
    return fs.readFileSync(path.join(root, 'docs', 'characters', 'pcs', 'brill.html'), 'utf8');
  };
  assert.equal(count(rebuilt()), 3);
  fs.writeFileSync(css, fs.readFileSync(css, 'utf8').replaceAll('.credit-raven', '.older'));
  assert.equal(count(rebuilt()), 0);
});

test('switched off, no page has it, and a site with no footer has no footer element', () => {
  const { pages } = site({ credit: false });
  for (const p of pages) {
    assert.equal(count(p.html), 0, p.name);
    for (const word of ['site-credit', 'nav-credit', 'mobile-credit', 'credit-raven']) assert.ok(!p.html.includes(word), p.name);
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
  assert.equal(count(note.html), 3, note.name);
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
