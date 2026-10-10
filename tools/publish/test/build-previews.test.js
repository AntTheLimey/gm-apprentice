const { test } = require('node:test');
require('./helpers/quiet-legacy-warning.js');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { build } = require('../lib/build');
const { pageText, cardProblems } = require('./helpers/card-subset');
const { fixtureNames, prepareFixture } = require('./helpers/fixture-build');

function configFor(root, vault, outputDir) {
  const configPath = path.join(root, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({ vaultPath: vault, outputDir, attachmentsDir: '_attachments', siteTitle: 'T' }));
  return configPath;
}

function quietBuild(configPath) {
  const real = console.log; console.log = () => {};
  const warn = console.warn; console.warn = () => {};
  try { build({ configPath }); } finally { console.log = real; console.warn = warn; }
}

function buildVault(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'previews-build-'));
  const vault = path.join(root, 'vault');
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true });
    fs.writeFileSync(path.join(vault, rel), text);
  }
  quietBuild(configFor(root, vault, path.join(root, 'docs')));
  return { read: (...p) => fs.readFileSync(path.join(root, 'docs', ...p), 'utf8'), root };
}

const CONFIG = (extra) => `---\npublish:\n  mode: full\n${extra}  folder_map:\n    Characters/NPCs: characters/npcs\n    Locations: locations\n---\n`;
const FILES = (extra) => ({
  '_meta/vault-config.md': CONFIG(extra),
  'Characters/NPCs/Hallam.md': '---\ntype: npc\noccupation: Warden\nsecrets: "the killer"\n---\n# Hallam\n\nKeeper of the gate.\n\n## GM Notes\n\nHe did it.\n',
  'Locations/North Gate.md': '---\ntype: location\nlocation_type: Gate\n---\nHeld by [[Hallam]].\n',
  'Locations/Hidden.md': '---\ntype: location\npublish: false\n---\nNobody knows.\n',
});

test('the build writes one card per published page and marks every page', () => {
  const { read, root } = buildVault(FILES(''));
  const cards = JSON.parse(read('previews.json'));
  assert.deepStrictEqual(Object.keys(cards).sort(), ['characters/npcs/hallam.html', 'locations/north-gate.html']);
  assert.deepStrictEqual(cards['characters/npcs/hallam.html'], { t: 'Hallam', k: 'NPC', f: [['Role', 'Warden']], x: 'Keeper of the gate.' });
  const html = read('locations', 'north-gate.html');
  assert.match(html, /<main class="content"[^>]* data-previews="on">/);
  assert.match(html, /<script src="\.\.\/js\/previews\.js"><\/script>/);
  assert.ok(fs.existsSync(path.join(root, 'docs', 'js', 'previews.js')));
  fs.rmSync(root, { recursive: true, force: true });
});

test('the 404 page carries the attribute and the script like every other page', () => {
  const { read, root } = buildVault(FILES(''));
  const html = read('404.html');
  assert.match(html, /<main class="content" data-previews="on">/);
  assert.match(html, /<script src="\/js\/previews\.js"><\/script>/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('nothing hidden reaches the cards', () => {
  const { read, root } = buildVault(FILES(''));
  const text = read('previews.json');
  for (const hidden of ['killer', 'He did it', 'Nobody knows', 'Hidden']) assert.ok(!text.includes(hidden), hidden);
  fs.rmSync(root, { recursive: true, force: true });
});

test('desktop marks the pages desktop', () => {
  const { read, root } = buildVault(FILES('  link_previews: desktop\n'));
  assert.match(read('locations', 'north-gate.html'), /data-previews="desktop"/);
  assert.match(read('404.html'), /data-previews="desktop"/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('off writes no file, no script tag and no attribute', () => {
  const { read, root } = buildVault(FILES('  link_previews: off\n'));
  assert.ok(!fs.existsSync(path.join(root, 'docs', 'previews.json')));
  for (const page of [['locations', 'north-gate.html'], ['404.html']]) {
    assert.ok(!read(...page).includes('previews'), `${page.join('/')} does not mention previews`);
  }
  fs.rmSync(root, { recursive: true, force: true });
});

test('a build with previews off after one with them on keeps nothing from the first', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'previews-twice-'));
  const vault = path.join(root, 'vault');
  const out = path.join(root, 'docs');
  const write = (extra) => {
    for (const [rel, text] of Object.entries(FILES(extra))) {
      fs.mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true });
      fs.writeFileSync(path.join(vault, rel), text);
    }
  };
  const configPath = configFor(root, vault, out);
  write('');
  quietBuild(configPath);
  assert.ok(fs.existsSync(path.join(out, 'previews.json')));
  write('  link_previews: off\n');
  quietBuild(configPath);
  assert.ok(!fs.existsSync(path.join(out, 'previews.json')), 'the stale file is cleared');
  assert.ok(!fs.readFileSync(path.join(out, 'locations', 'north-gate.html'), 'utf8').includes('previews'));
  assert.ok(!fs.readFileSync(path.join(out, '404.html'), 'utf8').includes('previews'));
  fs.rmSync(root, { recursive: true, force: true });
});

// The fixture vaults, each built as a full-mode site. A fixture that cannot build is listed
// here by name with a reason (none today: every one builds).
const UNBUILDABLE = {};

// The card is a subset of the page: every string on a card occurs in that page's own text.
test('every card string occurs in its own built page, on every fixture vault that builds', () => {
  const looseSeen = [];
  const failures = [];
  let checked = 0;
  for (const name of fixtureNames()) {
    if (UNBUILDABLE[name]) continue;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'previews-fixture-'));
    try {
      try { quietBuild(prepareFixture(name, root)); } catch (e) {
        assert.fail(`fixture ${name} no longer builds (${e.message}); list it in UNBUILDABLE with a reason`);
      }
      const cards = JSON.parse(fs.readFileSync(path.join(root, 'docs', 'previews.json'), 'utf8'));
      for (const [rel, card] of Object.entries(cards)) {
        const html = fs.readFileSync(path.join(root, 'docs', ...rel.split('/')), 'utf8');
        const { problems, loose } = cardProblems(card, pageText(html));
        for (const pr of problems) failures.push(`${name}/${rel}: ${pr}`);
        for (const l of loose) looseSeen.push({ page: `${name}/${rel}`, label: l.label, value: l.value });
        checked++;
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
  assert.deepStrictEqual(failures, []);
  assert.ok(checked > 60, `checked ${checked} cards`);

  // The known looser passes. A new one is a card drifting from its page: it fails here,
  // naming the page and the card string. Nothing but an excerpt may pass loosely.
  const excerpts = looseSeen.filter((l) => l.label === 'excerpt');
  assert.deepStrictEqual(looseSeen.filter((l) => l.label !== 'excerpt'), [], 'a card fact passed loosely');
  // Excerpts whose two sentences both occur on the page but not next to each other (the page
  // shows the first as a pull-quote or lede, the second further down). Pinned by page name.
  const KNOWN_EXCERPT_PAGES = [
    'clean-schema/campaign/campaign-overview.html',
    'clean-schema/events/battle.html',
    'html-comment-leak/chapters/chapter 1 - test/session-1.html',
    'minimal/locations/test-location.html',
    'redesign-full/sessions/session-1.html',
    'with-creature/creatures/test-creature.html',
    'with-dashboard/sessions/session-1.html',
    'with-dashboard/sessions/session-2.html',
    'with-gm-only-markers/locations/catacombs.html',
    'with-item/items & artifacts/test-sword.html',
  ];
  assert.deepStrictEqual(excerpts.map((l) => l.page).sort(), KNOWN_EXCERPT_PAGES,
    `excerpts needing the non-adjacent rule changed:\n${excerpts.map((l) => `${l.page}: ${JSON.stringify(l.value)}`).join('\n')}`);
});

// Listing containers (each row already a summary) opt out of cards; running prose does not.
test('listing containers carry data-no-preview, and only when previews are on', () => {
  const LANDING = ['pc-roster', 'npc-grid', 'location-grid', 'explore-grid'];
  const INDEX = [['characters', 'card-grid'], ['locations', 'locations-page'], ['factions', 'intel-briefing']];
  const check = (keys, on) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'previews-listing-'));
    try {
      quietBuild(prepareFixture('redesign-full', root, { keys }));
      const read = (...p) => fs.readFileSync(path.join(root, 'docs', ...p), 'utf8');
      const marked = (html, cls) => new RegExp(`<div class="${cls}"( data-no-preview)?>`).exec(html);
      const landing = read('index.html');
      for (const cls of LANDING) { const m = marked(landing, cls); assert.ok(m, `${cls} on the landing page`); assert.strictEqual(Boolean(m[1]), on, `${cls} on=${on}`); }
      for (const [dir, cls] of INDEX) { const m = marked(read(dir, 'index.html'), cls); assert.ok(m, `${cls} in ${dir}`); assert.strictEqual(Boolean(m[1]), on, `${dir} ${cls} on=${on}`); }
      assert.ok(!/class="recap[^"]*"[^>]*data-no-preview/.test(landing), 'recap prose is not opted out');
      if (!on) for (const f of ['index.html', 'characters/index.html', 'locations/index.html']) assert.ok(!read(f).includes('data-no-preview'), f);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  };
  check({}, true);
  check({ link_previews: 'off' }, false);
});
