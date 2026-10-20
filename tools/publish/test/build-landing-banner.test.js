'use strict';
// player_site.landing.banner.*: a banner between the hero and "Latest Session" on the landing page. Its link is
// read by resolveSiteLink (as a menu entry's is), its picture by the banners' own helpers, and its words by the
// note audit like any text the site prints.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { build } = require('../lib/build');
const { writeNewConfig } = require('./helpers/settings-files');

const npc = (extra = '') => `---\ntype: npc\n${extra}---\n\nA person.\n`;
const place = '---\ntype: location\n---\n\nA place.\n';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

// A small vault on the new settings file, built; `banner` is player_site.landing.banner.
function site(banner, { files = {}, binary = {}, hide = null, dirs = [] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'landing-banner-'));
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
  for (const [rel, data] of Object.entries(binary)) {
    fs.mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true });
    fs.writeFileSync(path.join(vault, rel), data);
  }
  for (const rel of dirs) fs.mkdirSync(path.join(vault, rel), { recursive: true });
  writeNewConfig(vault, {
    version: 1,
    player_site: {
      ...(hide ? { hide: { folders: hide } } : {}),
      folder_map: { Characters: 'characters', Locations: 'locations', Hidden: 'hidden' },
      ...(banner === undefined ? {} : { landing: { banner } }),
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

const bannerOf = (html) => {
  const at = html.indexOf('<div class="landing-banner"');
  const atA = html.indexOf('<a class="landing-banner"');
  const start = at >= 0 ? at : atA;
  if (start < 0) return null;
  const end = html.indexOf('<div class="dashboard-section">', start);
  return html.slice(start, end < 0 ? html.indexOf('</main>', start) : end);
};

test('rule 1: nothing set, no banner, and the page has none of its markup', () => {
  const s = site(undefined);
  assert.doesNotMatch(s.read('index.html'), /landing-banner/);
  assert.deepEqual(s.warnings.filter((w) => /banner/.test(w)), []);
});

test('rule 1: a title and text show between the hero and the rest, escaped', () => {
  const s = site({ title: 'Wanted <b>&</b>', text: 'A reward of "ten" crowns' });
  const html = s.read('index.html');
  const b = bannerOf(html);
  assert.ok(b, 'a banner');
  assert.match(b, /Wanted &lt;b&gt;&amp;&lt;\/b&gt;/);
  assert.match(b, /A reward of (&quot;|")ten(&quot;|") crowns/);
  assert.doesNotMatch(b, /<b>/);
  assert.ok(html.indexOf('landing-hero') < html.indexOf('landing-banner'));
  const rest = html.indexOf('dashboard-section');
  if (rest >= 0) assert.ok(html.indexOf('landing-banner') < rest);
});

test('rule 1: a link alone shows nothing and warns', () => {
  const s = site({ link: 'https://example.com' });
  assert.doesNotMatch(s.read('index.html'), /landing-banner/);
  assert.ok(s.warnings.some((w) => /banner/.test(w) && /link/.test(w)), s.warnings.join('\n'));
});

test('rule 2: a picture in the vault is copied to images/banners/landing and shown', () => {
  const s = site({ image: 'Art/crest.png', title: 'Hello' }, { binary: { 'Art/crest.png': PNG } });
  assert.ok(s.exists('images', 'banners', 'landing', 'crest.png'));
  assert.match(bannerOf(s.read('index.html')), /<img [^>]*src="images\/banners\/landing\/crest\.png"/);
});

test('rule 2: a picture alone is a banner', () => {
  const s = site({ image: 'Art/crest.png' }, { binary: { 'Art/crest.png': PNG } });
  assert.match(bannerOf(s.read('index.html')), /landing-banner-img/);
});

test('rule 2: a picture missing from the vault or outside it is a warning, and the banner shows without it', () => {
  const s = site({ image: 'Art/none.png', title: 'Hello' });
  const b = bannerOf(s.read('index.html'));
  assert.match(b, /Hello/);
  assert.doesNotMatch(b, /<img/);
  assert.ok(s.warnings.some((w) => /none\.png/.test(w)), s.warnings.join('\n'));
  const out = site({ image: '../outside.png', title: 'Hello' });
  assert.doesNotMatch(bannerOf(out.read('index.html')), /<img/);
  assert.ok(out.warnings.some((w) => /outside/.test(w)), out.warnings.join('\n'));
});

test('fix round 1: an image naming a folder is a warning and the banner shows without a picture, not a crash', () => {
  const s = site({ image: 'Art', title: 'Hello' }, { dirs: ['Art'] });
  const b = bannerOf(s.read('index.html'));
  assert.match(b, /Hello/);
  assert.doesNotMatch(b, /<img/);
  assert.ok(s.warnings.some((w) => /Art/.test(w) && /not a file/.test(w)), s.warnings.join('\n'));
});

test('fix round 1: a section banner file that is a folder is a warning, not a crash', () => {
  const s = site(undefined, { dirs: ['Locations/_banner.png'] });
  assert.ok(s.exists('locations', 'index.html'));
  assert.ok(s.warnings.some((w) => /_banner\.png/.test(w) && /not a file/.test(w)), s.warnings.join('\n'));
});

test('rule 2: a web address picture is used as written', () => {
  const s = site({ image: 'https://example.com/a b.png', title: 'Hello' });
  assert.match(bannerOf(s.read('index.html')), /<img [^>]*src="https:\/\/example\.com\/a%20b\.png"/);
});

test('rule 3: with a link the whole banner is the link, read as a menu entry\'s is', () => {
  const page = site({ title: 'Docks', link: 'Harbour' });
  assert.match(page.read('index.html'), /<a class="landing-banner" href="locations\/harbour\.html"/);
  const out = site({ title: 'Atlas', link: 'https://example.com/atlas' });
  assert.match(out.read('index.html'), /<a class="landing-banner" href="https:\/\/example\.com\/atlas" rel="noopener"/);
  const own = site({ title: 'Map', link: 'gazetteer/index.html' });
  assert.match(own.read('index.html'), /<a class="landing-banner" href="gazetteer\/index\.html"/);
});

test('rule 3: a link to a note with no page is dropped, with a warning; the banner stays', () => {
  const s = site({ title: 'Tam', link: 'Old Tam' });
  const html = s.read('index.html');
  assert.match(html, /landing-banner/);
  assert.doesNotMatch(html, /<a class="landing-banner"/);
  assert.doesNotMatch(html, /Old[ _]Tam/);
  assert.ok(s.warnings.some((w) => /banner/.test(w) && /Old Tam/.test(w)), s.warnings.join('\n'));
});

// A link that names a hidden note, in any spelling, is no link: the banner stays, the note's name is nowhere on the
// page, and the build warns. Each group has its own hidden notes and the words that must not appear.
const HIDDEN_LINK_GROUPS = [
  { what: 'by name, alias, withheld name or excluded folder',
    files: { 'Hidden/Old_Tam.md': npc('publish: false\naliases:\n  - The Pale King\n'), 'Gm_Only/Secret_Person.md': npc() },
    hide: ['_meta', 'Gm_Only'], title: 'T',
    links: ['Old Tam', 'The Pale King', 'Lord Zorn', 'Secret Person'],
    leaks: /Pale(%20| )King|Old(%20| |_)Tam|Zorn|Secret(%20| |_)Person/ },
  { what: 'in any spelling (heading, path, .md, brackets, case)',
    files: { 'Hidden/Lord_Vex.md': npc('publish: false\ngm_aliases:\n  - Traitor Bob\n'), 'Hidden/Lady_Wren.md': npc('publish: false\nwithheld: true\n') },
    title: 'Read this',
    links: ['Lady Wren#Secrets', 'Hidden/Lady Wren', '[[Hidden/Lord Vex]]', 'Lady Wren.md', 'Traitor Bob#Plans', 'LADY WREN.md', 'hidden/lady-wren.html', '[[Lady Wren#S|x]]'],
    leaks: /Lady(%20| |_|-)Wren|Lord(%20| |_|-)Vex|Traitor(%20| )Bob/i },
  { what: 'however it is spelled (slashes, percent-encoding, dot segments, the page name, the title)',
    files: { 'Hidden/Lord_Hush.md': npc('publish: false\ntitle: The Whispering Man\n'), 'Gm_Only/Secret_Person.md': npc() },
    hide: ['_meta', 'Gm_Only'], title: 'T',
    links: ['Lord Hush/', 'Lord%20Hush', 'hidden/lord-hush.html/', 'hidden//lord-hush.html', 'foo/../hidden/lord-hush.html',
      'lord-hush.html', 'hidden/lord-hush', 'hidden/lord-hush.htm', 'secret-person.html', 'The Whispering Man', 'Lord%2'],
    leaks: /Hush|hush|Whisper|whisper|secret-person|Secret(%20| )Person/ },
];

test('a banner link to a hidden note is no link, in every spelling: the banner stays, the name is nowhere, the build warns', () => {
  for (const g of HIDDEN_LINK_GROUPS) {
    for (const link of g.links) {
      const s = site({ title: g.title, link }, g.hide ? { files: g.files, hide: g.hide } : { files: g.files });
      const html = s.read('index.html');
      const label = `${g.what}: ${link}`;
      assert.match(html, /landing-banner/, label);
      assert.doesNotMatch(html, /<a class="landing-banner"/, label);
      assert.doesNotMatch(html, g.leaks, label);
      assert.ok(s.warnings.some((w) => /banner/.test(w) && w.includes(link)), `${label}: ${s.warnings.join('\n')}`);
    }
  }
});

test('ordinary and published banner links stand beside hidden ones', () => {
  const g = HIDDEN_LINK_GROUPS[2];
  const opts = { files: g.files, hide: g.hide };
  for (const link of ['gazetteer/index.html', 'maps/north.html#key', 'map.html?layer=2']) {
    assert.ok(site({ title: 'T', link }, opts).read('index.html').includes(`<a class="landing-banner" href="${link.replace('&', '&amp;')}"`), link);
  }
  for (const link of ['Harbour/', 'Harbour%20', 'Harbour.html', 'locations/harbour.html']) {
    assert.match(site({ title: 'T', link }, opts).read('index.html'), /<a class="landing-banner" href="locations\/harbour\.html"/, link);
  }
});

test('fix round 1: a link differing in case from a note with a page is that page; a fragment and a query survive', () => {
  assert.match(site({ title: 'T', link: 'harbour' }).read('index.html'), /<a class="landing-banner" href="locations\/harbour\.html"/);
  assert.match(site({ title: 'T', link: 'gazetteer/index.html#north' }).read('index.html'), /<a class="landing-banner" href="gazetteer\/index\.html#north"/);
  assert.match(site({ title: 'T', link: 'map.html?layer=2' }).read('index.html'), /<a class="landing-banner" href="map\.html\?layer=2"/);
});

test('final wave: a banner link with a heading to a note with a page is that page', () => {
  assert.match(site({ title: 'T', link: 'Harbour#Gear' }).read('index.html'), /<a class="landing-banner" href="locations\/harbour\.html"/);
  assert.match(site({ title: 'T', link: '[[Locations/Harbour|x]]' }).read('index.html'), /<a class="landing-banner" href="locations\/harbour\.html"/);
});

test('rule 4: a title or text naming a withheld note is a finding on the landing page', () => {
  for (const banner of [{ title: 'Lord Zorn rides' }, { text: 'Beware Lord Zorn' }]) {
    const s = site(banner);
    const hits = s.findings.filter((f) => f.code === 'WITHHELD_IN_PROSE');
    assert.ok(hits.some((f) => f.path === 'index.html' && f.name === 'Lord Zorn'), JSON.stringify(s.findings.map((f) => [f.code, f.path])));
  }
});

test('rule 4: words naming nothing secret are no finding', () => {
  const s = site({ title: 'Welcome', text: 'Sit down' });
  assert.deepEqual(s.findings.filter((f) => f.code === 'WITHHELD_IN_PROSE'), []);
});

test('housekeeping: a banner link ending index.html stands with _meta/index.md and a template in the vault', () => {
  const files = { '_meta/index.md': '---\ntype: meta\n---\n', '_Templates/NPC_Template.md': '---\ntype: template\n---\n' };
  for (const link of ['gazetteer/index.html', 'maps/index.html#north', 'forms/NPC_Template.html']) {
    const s = site({ title: 'T', link }, { files });
    assert.match(s.read('index.html'), /<a class="landing-banner" href="/, link);
    assert.deepEqual(s.warnings.filter((w) => /banner/.test(w)), [], link);
  }
});

test('housekeeping: a campaign note moved into _meta still drops a banner link to it', () => {
  const files = { '_meta/index.md': '---\ntype: meta\n---\n', '_meta/Dr Black.md': npc() };
  const s = site({ title: 'T', link: 'Dr Black' }, { files });
  assert.doesNotMatch(s.read('index.html'), /<a class="landing-banner"/);
  assert.ok(s.warnings.some((w) => /banner/.test(w)));
});

test('housekeeping: a hidden campaign note called Index still drops a banner link ending index.html', () => {
  const files = { '_meta/index.md': '---\ntype: meta\n---\n', 'Hidden/Index.md': npc('publish: false\n') };
  const s = site({ title: 'T', link: 'gazetteer/index.html' }, { files });
  assert.doesNotMatch(s.read('index.html'), /<a class="landing-banner"/);
  assert.ok(s.warnings.some((w) => /banner/.test(w)));
});

test('a [[wikilink]] in the title or text prints as its name, as page text does (#388)', () => {
  const html = site({ title: 'The [[Harbour]] burns', text: 'See [[Mara Quill|Mara]] at the [[Harbour]].' }).read('index.html');
  assert.match(html, /<h2 class="landing-banner-title">The Harbour burns<\/h2>/);
  assert.match(html, /<p class="landing-banner-text">See Mara at the Harbour\.<\/p>/);
  assert.doesNotMatch(html, /\[\[/);
});
