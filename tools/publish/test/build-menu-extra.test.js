'use strict';
// player_site.menu_extra: extra entries in the site's menu, read link by link (resolveSiteLink), shown in the
// desktop menu and the phone menu, and read by the note audit like any text the site prints.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { build, resolveSiteLink, rememberHiddenNames } = require('../lib/build');
const { generateNav } = require('../lib/templates/nav');
const { writeNewConfig } = require('./helpers/settings-files');

const npc = (extra = '') => `---\ntype: npc\n${extra}---\n\nA person.\n`;
const place = '---\ntype: location\n---\n\nA place.\n';

// A small vault on the new settings file, built; `menu` is the menu_extra setting. Returns readers and what was
// printed as warnings and found by the note audit.
function site(menu, { files = {}, settings = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'menu-extra-'));
  const vault = path.join(root, 'vault');
  const all = {
    'Characters/Mara_Quill.md': npc(),
    'Locations/Harbour.md': place,
    'Hidden/Lord_Zorn.md': npc('publish: false\nwithheld: true\n'),
    'Hidden/Old_Tam.md': npc('publish: false\n'),
    ...files,
  };
  for (const [rel, text] of Object.entries(all)) {
    fs.mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true });
    fs.writeFileSync(path.join(vault, rel), text);
  }
  writeNewConfig(vault, {
    version: 1,
    player_site: {
      folder_map: { Characters: 'characters', Locations: 'locations', Hidden: 'hidden' },
      ...(menu === undefined ? {} : { menu_extra: menu }),
      ...settings,
    },
  });
  const configPath = path.join(root, 'vault.config.json');
  fs.writeFileSync(configPath, JSON.stringify({ vaultPath: './vault' }));
  const warnings = [];
  let findings = null;
  const saved = { log: console.log, warn: console.warn, error: console.error };
  console.log = () => {};
  console.warn = (...a) => { warnings.push(a.join(' ')); };
  console.error = () => {};
  try { build({ configPath, onNoteFaults: (f) => { findings = f; } }); } finally { Object.assign(console, saved); }
  const docs = path.join(root, 'docs');
  return {
    root,
    warnings,
    findings,
    read: (...p) => fs.readFileSync(path.join(docs, ...p), 'utf8').replace(/\r\n/g, '\n'),
    exists: (...p) => fs.existsSync(path.join(docs, ...p)),
  };
}

// The desktop menu and the phone menu of a built page.
function menus(html) {
  const desktop = html.slice(html.indexOf('<nav class="nav-groups">'), html.indexOf('</nav>'));
  const phone = html.slice(html.indexOf('<div id="mobile-nav"'), html.indexOf('</div>\n', html.indexOf('<div id="mobile-nav"')) + 6);
  return { desktop, phone };
}

// ---- resolveSiteLink ----

const pages = [{ title: 'Harbour', outputPath: 'locations/harbour.html' }];
const linkMap = Object.assign(Object.create(null), { Harbour: 'locations/harbour.html' });
rememberHiddenNames(linkMap, [
  { vaultPath: 'Hidden/Old_Tam', displayTitle: 'Old Tam', frontmatter: { aliases: ['Tam the Old'] } },
  { vaultPath: 'Locations/Harbour', displayTitle: 'Harbour', frontmatter: {} },
]);

test('a link starting http:// or https:// is an outside address, as written', () => {
  assert.deepEqual(resolveSiteLink('https://example.com/a?b=c', { linkMap, pages }), { kind: 'outside', href: 'https://example.com/a?b=c' });
  assert.equal(resolveSiteLink('HTTP://example.com', { linkMap, pages }).kind, 'outside');
});

test('a link naming a note with a page is that page, whether plain or in [[ ]]', () => {
  assert.deepEqual(resolveSiteLink('Harbour', { linkMap, pages }), { kind: 'page', href: 'locations/harbour.html' });
  assert.deepEqual(resolveSiteLink('[[Harbour|the docks]]', { linkMap, pages }), { kind: 'page', href: 'locations/harbour.html' });
});

test('a link naming a note with no page is dropped', () => {
  assert.deepEqual(resolveSiteLink('Old Tam', { linkMap, pages }), { kind: 'none', href: null });
  assert.deepEqual(resolveSiteLink('old tam', { linkMap, pages }), { kind: 'none', href: null });
  assert.equal(resolveSiteLink('[[Old Tam]]', { linkMap, pages }).kind, 'none');
});

test('anything else is an address on the site, as written', () => {
  assert.deepEqual(resolveSiteLink('gazetteer/index.html', { linkMap, pages }), { kind: 'site', href: 'gazetteer/index.html' });
  assert.deepEqual(resolveSiteLink('./map.html', { linkMap, pages }), { kind: 'site', href: 'map.html' });
});

test('a link called constructor is not an inherited function', () => {
  assert.equal(resolveSiteLink('constructor', { linkMap, pages }).kind, 'site');
});

// ---- The menu ----

test('rule 1: the three kinds of link in a built menu, made relative per page', () => {
  const s = site([
    { label: 'Docks', link: 'Harbour' },
    { label: 'Atlas', link: 'https://example.com/atlas' },
    { label: 'Gazetteer', link: 'gazetteer/index.html' },
  ]);
  const root = menus(s.read('index.html')).desktop;
  assert.match(root, /<a class="nav-group-toggle" href="locations\/harbour\.html">Docks<\/a>/);
  assert.match(root, /<a class="nav-group-toggle" href="https:\/\/example\.com\/atlas" rel="noopener">Atlas<\/a>/);
  assert.match(root, /<a class="nav-group-toggle" href="gazetteer\/index\.html">Gazetteer<\/a>/);
  const deep = menus(s.read('characters', 'mara-quill.html')).desktop;
  assert.match(deep, /href="\.\.\/locations\/harbour\.html">Docks</);
  assert.match(deep, /href="\.\.\/gazetteer\/index\.html">Gazetteer</);
  assert.match(deep, /href="https:\/\/example\.com\/atlas" rel="noopener"/);
});

test('rule 1: an entry linking a note with no page is left out, with a warning naming the label', () => {
  const s = site([{ label: 'Tam', link: 'Old Tam' }, { label: 'Map', link: 'map.html' }]);
  const html = s.read('index.html');
  assert.doesNotMatch(menus(html).desktop, />Tam</);
  assert.doesNotMatch(html, /Old[ _]Tam/);
  assert.match(menus(html).desktop, />Map</);
  assert.ok(s.warnings.some((w) => w.includes('"Tam"') && /menu_extra/.test(w)), s.warnings.join('\n'));
});

test('rule 2: a group naming an existing menu group goes after its own links, in any case', () => {
  const s = site([{ label: 'Gazetteer', link: 'gazetteer/index.html', group: 'world' }]);
  const { desktop } = menus(s.read('index.html'));
  const world = desktop.slice(desktop.indexOf('>World<'));
  assert.ok(world.indexOf('>Locations<') < world.indexOf('>Gazetteer<'), world);
  assert.equal((desktop.match(/>World</g) || []).length, 1);
});

test('rule 2: a new group name makes a group after the four, with its entries in order', () => {
  const s = site([
    { label: 'Atlas', link: 'atlas.html', group: 'Maps' },
    { label: 'Charts', link: 'charts.html', group: 'maps' },
  ]);
  const { desktop } = menus(s.read('index.html'));
  assert.ok(desktop.indexOf('>Characters<') < desktop.indexOf('>Maps<'));
  assert.equal((desktop.match(/>Maps</g) || []).length, 1);
  assert.ok(desktop.indexOf('>Atlas<') < desktop.indexOf('>Charts<'));
});

test('rule 2: an entry whose menu group has no other page still shows', () => {
  const s = site([{ label: 'Rules', link: 'rules.html', group: 'Reference' }]);
  const { desktop, phone } = menus(s.read('index.html'));
  assert.match(desktop, />Reference</);
  assert.match(desktop, />Rules</);
  assert.match(phone, /<h3>Reference<\/h3>/);
});

test('rule 3: the desktop menu and the phone menu both carry every extra entry', () => {
  const s = site([
    { label: 'Docks', link: 'Harbour', group: 'World' },
    { label: 'Atlas', link: 'https://example.com/atlas' },
    { label: 'Charts', link: 'charts.html', group: 'Maps' },
    { label: 'Loose', link: 'loose.html' },
  ]);
  for (const html of [s.read('index.html'), s.read('characters', 'mara-quill.html')]) {
    const { desktop, phone } = menus(html);
    for (const label of ['Docks', 'Atlas', 'Charts', 'Loose']) {
      assert.match(desktop, new RegExp(`>${label}<`), `desktop ${label}`);
      assert.match(phone, new RegExp(`>${label}<`), `phone ${label}`);
    }
  }
  assert.match(menus(s.read('index.html')).phone, /<li><a href="https:\/\/example\.com\/atlas" rel="noopener">Atlas<\/a><\/li>/);
});

test('rule 4: a label is escaped', () => {
  const s = site([{ label: 'A <b>&</b> "B"', link: 'x.html' }]);
  const html = s.read('index.html');
  assert.match(html, /A &lt;b&gt;&amp;&lt;\/b&gt; &quot;B&quot;|A &lt;b&gt;&amp;&lt;\/b&gt; "B"/);
  assert.doesNotMatch(menus(html).desktop, /<b>/);
});

test('rule 4: a label naming a withheld note is a finding (the menu is on every page, so each page reports it)', () => {
  const s = site([{ label: 'Lord Zorn', link: 'gazetteer/index.html' }]);
  const hits = s.findings.filter((f) => f.code === 'WITHHELD_IN_PROSE');
  assert.ok(hits.length > 0, JSON.stringify(s.findings.map((f) => [f.code, f.path])));
  assert.ok(hits.every((f) => f.name === 'Lord Zorn'));
  assert.ok(hits.some((f) => f.path === 'index.html'));
});

test('rule 4: a label that names nothing secret is no finding', () => {
  const s = site([{ label: 'Gazetteer', link: 'gazetteer/index.html' }]);
  assert.deepEqual(s.findings.filter((f) => f.code === 'WITHHELD_IN_PROSE'), []);
});

test('rule 5: a second entry with the same label and group is a warning and is left out', () => {
  const s = site([
    { label: 'Map', link: 'one.html', group: 'World' },
    { label: 'Map', link: 'two.html', group: 'world' },
    { label: 'Map', link: 'three.html' },
  ]);
  const html = menus(s.read('index.html')).desktop;
  assert.match(html, /one\.html/);
  assert.doesNotMatch(html, /two\.html/);
  assert.match(html, /three\.html/);
  assert.ok(s.warnings.some((w) => /menu_extra/.test(w) && /twice/.test(w)), s.warnings.join('\n'));
});

test('rule 5: an entry with a blank label is a warning and shows nothing', () => {
  const s = site([{ label: '  ', link: 'one.html' }]);
  assert.doesNotMatch(menus(s.read('index.html')).desktop, /one\.html/);
  assert.ok(s.warnings.some((w) => /menu_extra/.test(w)), s.warnings.join('\n'));
});

test('rule 6: no extra entries builds every page as it was, with or without the setting', () => {
  const bare = site(undefined);
  const empty = site([]);
  for (const rel of [['index.html'], ['characters', 'mara-quill.html'], ['locations', 'harbour.html']]) {
    assert.equal(bare.read(...rel), empty.read(...rel), rel.join('/'));
  }
});

// ---- Fix round 1 ----

const HIDDEN = {
  'Hidden/Old_Tam.md': npc('publish: false\naliases:\n  - The Pale King\n'),
  'Gm_Only/Secret_Person.md': npc(),
};

test('a link to a note with no page is dropped, by name, by alias, by underscore name', () => {
  const s = site([
    { label: 'ByName', link: 'Old Tam' },
    { label: 'ByAlias', link: 'The Pale King' },
    { label: 'ByWithheld', link: 'Lord Zorn' },
    { label: 'ByUnderscore', link: 'Old_Tam' },
    { label: 'Fine', link: 'Harbour' },
  ], { files: HIDDEN, settings: { hide: { folders: ['_meta', 'Gm_Only'] } } });
  const { desktop } = menus(s.read('index.html'));
  for (const label of ['ByName', 'ByAlias', 'ByWithheld', 'ByUnderscore']) assert.doesNotMatch(desktop, new RegExp(`>${label}<`), label);
  assert.match(desktop, />Fine</);
  assert.doesNotMatch(s.read('index.html'), /Pale(%20| )King/);
  for (const label of ['ByName', 'ByAlias', 'ByWithheld', 'ByUnderscore']) {
    assert.ok(s.warnings.some((w) => w.includes(`"${label}"`)), label);
  }
});

test('a link to a note in an excluded folder is dropped', () => {
  const s = site([{ label: 'Sec', link: 'Secret Person' }], { files: HIDDEN, settings: { hide: { folders: ['_meta', 'Gm_Only'] } } });
  assert.doesNotMatch(menus(s.read('index.html')).desktop, />Sec</);
  assert.ok(s.warnings.some((w) => w.includes('"Sec"')));
});

test('a link whose case differs from a note that has a page is that page', () => {
  const s = site([{ label: 'Docks', link: 'harbour' }, { label: 'Her', link: 'mara quill' }]);
  const { desktop } = menus(s.read('index.html'));
  assert.match(desktop, /href="locations\/harbour\.html">Docks</);
  assert.match(desktop, /href="characters\/mara-quill\.html">Her</);
  assert.ok(!s.warnings.some((w) => /menu_extra/.test(w)), s.warnings.join('\n'));
});

test('a fragment and a query in a site address survive', () => {
  const s = site([{ label: 'North', link: 'gazetteer/index.html#north' }, { label: 'Layer', link: 'map.html?layer=2&x=1' }]);
  const root = menus(s.read('index.html')).desktop;
  assert.match(root, /href="gazetteer\/index\.html#north"/);
  assert.match(root, /href="map\.html\?layer=2&amp;x=1"/);
  const deep = menus(s.read('characters', 'mara-quill.html')).phone;
  assert.match(deep, /href="\.\.\/gazetteer\/index\.html#north"/);
  assert.match(deep, /href="\.\.\/map\.html\?layer=2&amp;x=1"/);
});

test('one bad entry is left out alone, with a warning naming it; the rest show', () => {
  const s = site([
    { label: 'Good', link: 'good.html' },
    { label: '  ', link: 'blank.html' },
    { label: 'NoLink' },
    { label: 'Odd', link: 'odd.html', colour: 'red' },
    { label: 'Also', link: 'also.html' },
  ]);
  const { desktop, phone } = menus(s.read('index.html'));
  for (const html of [desktop, phone]) {
    assert.match(html, />Good</);
    assert.match(html, />Also</);
    assert.doesNotMatch(html, /blank\.html|NoLink|odd\.html/);
  }
  const said = s.warnings.filter((w) => /menu_extra/.test(w));
  assert.ok(said.some((w) => /NoLink/.test(w)), said.join('\n'));
  assert.ok(said.some((w) => /Odd/.test(w)), said.join('\n'));
  assert.ok(said.some((w) => /entry 2/.test(w)), said.join('\n'));
});

// ---- Final fix wave: the link is read the way a wiki-link target is ----

const SECRETS = {
  'Hidden/Lord_Vex.md': npc('publish: false\ngm_aliases:\n  - Traitor Bob\n'),
  'Hidden/Lady_Wren.md': npc('publish: false\nwithheld: true\n'),
};
const LEAKY = [
  'Traitor Bob#Plans', 'Hidden/Lady Wren', 'Lady Wren#Secrets', '[[Hidden/Lord Vex]]', 'Lady Wren.md',
  'Hidden/Lady_Wren.md', '[[Lady Wren#Secrets|the plans]]', 'LADY WREN.MD', 'Hidden/Lord Vex#Plans',
  '[[Lord Vex^block]]', 'hidden\\Lady Wren', 'Old Tam#Notes', '[[Old Tam.md]]',
  'hidden/lady-wren.html', './hidden/lady-wren.html#top', 'hidden/old-tam.html',
];

test('final wave: a link to a hidden note is dropped in every spelling (heading, path, .md, brackets, case)', () => {
  const menu = LEAKY.map((link, i) => ({ label: `Leak${i}`, link }));
  const s = site(menu, { files: SECRETS });
  const html = s.read('index.html');
  assert.doesNotMatch(html, /Lady(%20| |_|-)Wren|Lord(%20| |_|-)Vex|Traitor(%20| )Bob|Old(%20| |_|-)Tam|\.md"/i);
  LEAKY.forEach((link, i) => {
    assert.doesNotMatch(menus(html).desktop, new RegExp(`>Leak${i}<`), link);
    assert.ok(s.warnings.some((w) => w.includes(`"Leak${i}"`)), `${link}: ${s.warnings.join('\n')}`);
  });
});

const RESIDUAL_FILES = {
  'Hidden/Lord_Hush.md': npc('publish: false\ntitle: The Whispering Man\n'),
  'Gm_Only/Secret_Person.md': npc(),
};
const RESIDUAL_SETTINGS = { hide: { folders: ['_meta', 'Gm_Only'] } };
const RESIDUAL_LEAKY = [
  'Lord Hush/', 'Lord%20Hush', '[[Lord%20Hush]]', 'Lord%20Hush#x', 'hidden/lord-hush.html/', 'hidden//lord-hush.html',
  'hidden/./lord-hush.html', 'foo/../hidden/lord-hush.html', 'lord-hush.html', 'hidden/lord-hush', 'hidden/lord-hush.htm',
  'secret-person.html', 'gm-only/secret-person.html', 'The Whispering Man', 'the-whispering-man', 'The%20Whispering%20Man/', 'Lord%2',
];

test('residual: a link to a hidden note is dropped however it is spelled (slash, escapes, dots, partial path, slug, title)', () => {
  const s = site(RESIDUAL_LEAKY.map((link, i) => ({ label: `Res${i}`, link })), { files: RESIDUAL_FILES, settings: RESIDUAL_SETTINGS });
  const html = s.read('index.html');
  assert.doesNotMatch(html, /Hush|hush|Whisper|whisper|Secret(%20| |_|-)Person|secret-person|%2/i);
  RESIDUAL_LEAKY.forEach((link, i) => {
    assert.doesNotMatch(menus(html).desktop, new RegExp(`>Res${i}<`), link);
    assert.ok(s.warnings.some((w) => w.includes(`"Res${i}"`)), `${link}: ${s.warnings.join('\n')}`);
  });
});

test('residual: ordinary site paths print unchanged and a published note links to its page in any spelling', () => {
  const s = site([
    { label: 'G', link: 'gazetteer/index.html' }, { label: 'N', link: 'maps/north.html#key' }, { label: 'M', link: 'map.html?layer=2' },
    { label: 'P1', link: 'Harbour/' }, { label: 'P2', link: 'Harbour%20' }, { label: 'P3', link: 'Harbour.html' },
    { label: 'P4', link: 'locations/harbour.html' }, { label: 'P5', link: 'Mara%20Quill' }, { label: 'P6', link: '[[Locations/Harbour#Gear]]' },
  ], { files: RESIDUAL_FILES, settings: RESIDUAL_SETTINGS });
  const { desktop } = menus(s.read('index.html'));
  assert.match(desktop, /href="gazetteer\/index\.html">G</);
  assert.match(desktop, /href="maps\/north\.html#key">N</);
  assert.match(desktop, /href="map\.html\?layer=2">M</);
  for (const label of ['P1', 'P2', 'P3', 'P4', 'P6']) assert.match(desktop, new RegExp(`href="locations/harbour\\.html">${label}<`), label);
  assert.match(desktop, /href="characters\/mara-quill\.html">P5</);
});

test('final wave: a note with a page is that page whatever the spelling; the heading is dropped', () => {
  const s = site([
    { label: 'A', link: 'Harbour#Gear' }, { label: 'B', link: 'Locations/Harbour' }, { label: 'C', link: '[[Locations/Harbour#Gear|docks]]' },
    { label: 'D', link: 'harbour.md' },
  ]);
  const { desktop } = menus(s.read('index.html'));
  for (const label of ['A', 'B', 'C', 'D']) assert.match(desktop, new RegExp(`href="locations/harbour\\.html">${label}<`), label);
});

test('final wave: a bracketed link that names nothing is dropped; a plain site address still stands', () => {
  assert.equal(resolveSiteLink('[[Nowhere Special]]', { linkMap, pages }).kind, 'none');
  assert.equal(resolveSiteLink('gazetteer/index.html#top', { linkMap, pages }).kind, 'site');
});

test('final wave: mailto and tel stand as written, escaped; any other scheme is dropped with a warning', () => {
  const s = site([
    { label: 'Mail', link: 'mailto:gm@example.com' }, { label: 'Call', link: 'tel:+4412345' },
    { label: 'Bad', link: 'javascript:alert(1)' }, { label: 'Data', link: 'data:text/html,hi' }, { label: 'Caps', link: ' JavaScript:alert(1)' },
  ]);
  const html = s.read('index.html');
  assert.match(menus(html).desktop, /href="mailto:gm@example\.com"[^>]*>Mail</);
  assert.match(menus(html).desktop, /href="tel:\+4412345"[^>]*>Call</);
  assert.doesNotMatch(html, /javascript:|data:text/i);
  for (const label of ['Bad', 'Data', 'Caps']) assert.ok(s.warnings.some((w) => w.includes(`"${label}"`)), label);
});

test('rule 6: the menu with no extra entries is the same text as with extra undefined', () => {
  const nav = (options) => generateNav([{ outputDir: 'world', outputPath: 'world/a.html', title: 'A', frontmatter: {} }], options)('index.html', { siteTitle: 'T' });
  assert.equal(nav({ extra: [] }), nav({}));
  assert.equal(nav({ extra: undefined }), nav({}));
});

// ---- The plugin's own housekeeping notes are no hidden names ----

const HOUSEKEEPING = {
  '_meta/index.md': '---\ntype: meta\n---\n\nThe index.\n',
  '_meta/relationship-types.md': '---\ntype: meta\n---\n\nThe types.\n',
  '_Templates/NPC_Template.md': '---\ntype: template\n---\n\nA template.\n',
};

test('housekeeping: a menu address ending index.html stands when _meta/index.md, a template and the plugin\'s own _meta notes exist', () => {
  const s = site([
    { label: 'Gazetteer', link: 'gazetteer/index.html' },
    { label: 'North', link: 'maps/index.html#north' },
    { label: 'Onto', link: 'relationship-types/list.html' },
    { label: 'Tmpl', link: 'forms/NPC_Template.html' },
  ], { files: HOUSEKEEPING });
  const { desktop, phone } = menus(s.read('index.html'));
  for (const [label, href] of [['Gazetteer', 'gazetteer/index.html'], ['North', 'maps/index.html#north'],
    ['Onto', 'relationship-types/list.html'], ['Tmpl', 'forms/NPC_Template.html']]) {
    assert.match(desktop, new RegExp(`href="${href.replace(/[.#/]/g, '\\$&')}">${label}<`), `desktop ${label}`);
    assert.match(phone, new RegExp(`href="${href.replace(/[.#/]/g, '\\$&')}">${label}<`), `phone ${label}`);
  }
  assert.deepEqual(s.warnings.filter((w) => /menu_extra/.test(w)), []);
});

test('housekeeping: a hidden campaign note called Index or Map still drops such a link', () => {
  const s = site([
    { label: 'Gazetteer', link: 'gazetteer/index.html' },
    { label: 'Atlas', link: 'maps/map.html' },
  ], { files: { ...HOUSEKEEPING, 'Hidden/Index.md': npc('publish: false\n'), 'Hidden/Map.md': npc('publish: false\n') } });
  const { desktop } = menus(s.read('index.html'));
  assert.doesNotMatch(desktop, />Gazetteer</);
  assert.doesNotMatch(desktop, />Atlas</);
  assert.ok(s.warnings.some((w) => w.includes('"Gazetteer"')));
  assert.ok(s.warnings.some((w) => w.includes('"Atlas"')));
});

test('housekeeping: a campaign note moved into _meta, or typed meta by mistake, is still a hidden name', () => {
  const s = site([
    { label: 'Black', link: 'Dr Black' },
    { label: 'BlackPath', link: '_meta/Dr Black' },
    { label: 'Sinister', link: 'mr-sinister/index.html' },
    { label: 'Gazetteer', link: 'gazetteer/index.html' },
  ], { files: {
    ...HOUSEKEEPING,
    '_meta/Dr Black.md': npc(),
    'Characters/Mr Sinister.md': '---\ntype: meta\n---\n\nSecret.\n',
  } });
  const { desktop, phone } = menus(s.read('index.html'));
  for (const menu of [desktop, phone]) {
    assert.doesNotMatch(menu, />Black</);
    assert.doesNotMatch(menu, />BlackPath</);
    assert.doesNotMatch(menu, />Sinister</);
    assert.match(menu, /href="gazetteer\/index\.html">Gazetteer</);
  }
  assert.ok(s.warnings.some((w) => w.includes('"Black"')));
  assert.ok(s.warnings.some((w) => w.includes('"Sinister"')));
});

test('housekeeping: the tool\'s own example link builds with _meta/index.md and no warning', () => {
  const s = site([{ label: 'Gazetteer', link: 'gazetteer/index.html', group: 'World' }], { files: { '_meta/index.md': '---\ntype: meta\n---\n' } });
  assert.match(s.read('index.html'), /href="gazetteer\/index\.html"/);
  assert.deepEqual(s.warnings.filter((w) => /menu_extra/.test(w)), []);
});

test('housekeeping: a note with a withheld name or one in the personal folder is still a hidden name', () => {
  const s = site([
    { label: 'Z', link: 'zed/index.html' },
    { label: 'P', link: 'refs/Core_Rules.html' },
  ], { files: { ...HOUSEKEEPING, '_meta/Zed.md': '---\ntype: meta\nwithheld: true\n---\n', 'personal/Core_Rules.md': '---\ntype: reference\n---\n' } });
  const { desktop } = menus(s.read('index.html'));
  assert.doesNotMatch(desktop, />P</);
  assert.doesNotMatch(desktop, />Z</);
});

test('housekeeping: _meta/index.md written over by a campaign note is a hidden name again', () => {
  const s = site([{ label: 'Gazetteer', link: 'gazetteer/index.html' }],
    { files: { '_meta/index.md': '---\ntype: npc\n---\n\nA secret NPC.\n' } });
  assert.doesNotMatch(menus(s.read('index.html')).desktop, />Gazetteer</);
  assert.ok(s.warnings.some((w) => w.includes('"Gazetteer"')));
});

test('housekeeping: an empty gm_aliases list does not make _meta/index.md a hidden name', () => {
  const s = site([{ label: 'Gazetteer', link: 'gazetteer/index.html' }],
    { files: { '_meta/index.md': '---\ntype: meta\ngm_aliases: []\n---\n' } });
  assert.match(menus(s.read('index.html')).desktop, /href="gazetteer\/index\.html">Gazetteer</);
  assert.deepEqual(s.warnings.filter((w) => /menu_extra/.test(w)), []);
});

test('housekeeping: a templates folder inside another folder holds the plugin\'s own notes too', () => {
  const s = site([{ label: 'Gazetteer', link: 'gazetteer/index.html' }],
    { files: { 'Characters/_Templates/Index.md': '---\ntype: template\n---\n' } });
  assert.match(menus(s.read('index.html')).desktop, /href="gazetteer\/index\.html">Gazetteer</);
});

test('a [[wikilink]] in a label prints as its name, as page text does (#388)', () => {
  const s = site([{ label: 'The [[Harbour|Docks]]', link: 'Harbour' }]);
  const root = menus(s.read('index.html')).desktop;
  assert.match(root, /<a class="nav-group-toggle" href="locations\/harbour\.html">The Docks<\/a>/);
  assert.doesNotMatch(root, /\[\[/);
});

test('rule 6: the menu with no extra entries is the text a build made before there were extra entries (frozen from main, re-frozen for the aria-expanded and data-nav markup, #439)', () => {
  const out = generateNav([{ outputDir: 'world', outputPath: 'world/a.html', title: 'A', frontmatter: {} }], {})('index.html', { siteTitle: 'T' });
  assert.equal(require('node:crypto').createHash('sha256').update(out).digest('hex'), '0ef48ab93aae1b22c8ccd09aaa8dd07e7e224e900f145700a29b061940e87bdb');
});

test('Ruling 40: an address the site serves stands before any note name, a folder link as its index.html', () => {
  const map = Object.assign(Object.create(null), { Harbour: 'locations/harbour.html', index: 'documents/index-note.html' });
  rememberHiddenNames(map, [{ vaultPath: '_midwife/index', displayTitle: 'index', frontmatter: {} },
    { vaultPath: 'Hidden/Old_Tam', displayTitle: 'Old Tam', frontmatter: {} }]);
  const served = { linkMap: map, pages, addresses: ['gazetteer/index.html', 'gazetteer/maps.svg'], kept: ['archive'] };
  for (const link of ['gazetteer/index.html', 'gazetteer/', './gazetteer/index.html#top', 'Gazetteer/Index.html', 'archive/old-tam.html']) {
    assert.deepEqual(resolveSiteLink(link, served), { kind: 'site', href: link.replace(/^\.\//, '') }, link);
  }
  // Not a site address: the note named index is not taken for it, and a hidden name still drops it.
  assert.equal(resolveSiteLink('elsewhere/old-tam.html', served).kind, 'none');
  assert.equal(resolveSiteLink('archived/old-tam.html', served).kind, 'none');
  // A note's name with its folder is still that note's page.
  assert.deepEqual(resolveSiteLink('Locations/Harbour', served), { kind: 'page', href: 'locations/harbour.html' });
});
