const { test } = require('node:test');
require('./helpers/quiet-legacy-warning.js');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { build } = require('../lib/build');
const { pageText, cardProblems } = require('./helpers/card-subset');
const { fixtureNames, prepareFixture } = require('./helpers/fixture-build');
const { insideNoPreview } = require('./helpers/no-preview');
const { buildVault: buildSmallVault } = require('./helpers/build-vault');

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

test('off writes no file, no script tag and no attribute, and does not copy the script', () => {
  const { read, root } = buildVault(FILES('  link_previews: off\n'));
  assert.ok(!fs.existsSync(path.join(root, 'docs', 'previews.json')));
  assert.ok(!fs.existsSync(path.join(root, 'docs', 'js', 'previews.js')), 'js/previews.js is not copied');
  assert.ok(fs.existsSync(path.join(root, 'docs', 'js', 'nav.js')), 'the other scripts still are');
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
  assert.ok(!fs.existsSync(path.join(out, 'js', 'previews.js')), 'the stale script is cleared');
  assert.ok(!fs.readFileSync(path.join(out, 'locations', 'north-gate.html'), 'utf8').includes('previews'));
  assert.ok(!fs.readFileSync(path.join(out, '404.html'), 'utf8').includes('previews'));
  fs.rmSync(root, { recursive: true, force: true });
});

// The fixture vaults, each built as a full-mode site. A fixture that cannot build is listed
// here by name with a reason (none today: every one builds).
const UNBUILDABLE = {};

// The card is a subset of the page: every string on a card occurs in that page's own text.
test('every card string occurs in its own built page, on every fixture vault that builds', () => {
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
        // Every key names a file the build wrote.
        if (!fs.existsSync(path.join(root, 'docs', ...rel.split('/')))) failures.push(`${name}/${rel}: a card with no page`);
        const html = fs.readFileSync(path.join(root, 'docs', ...rel.split('/')), 'utf8');
        const { problems } = cardProblems(card, pageText(html));
        for (const pr of problems) failures.push(`${name}/${rel}: ${pr}`);
        checked++;
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
  assert.deepStrictEqual(failures, []);
  assert.ok(checked > 60, `checked ${checked} cards`);

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
      if (!on) for (const f of ['index.html', 'characters/index.html', 'locations/index.html']) assert.ok(!read(f).includes('data-no-preview'), f);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  };
  check({}, true);
  check({ link_previews: 'off' }, false);
});

// Running prose and the landing page's recap keep their cards; the listings below opt out.
test('the landing recap, its text and its links are not opted out; the story and character listings are', () => {
  const build = (name) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'previews-optout-'));
    quietBuild(prepareFixture(name, root));
    return { root, read: (...p) => fs.readFileSync(path.join(root, 'docs', ...p), 'utf8') };
  };
  let dash;
  let story;
  try {
    dash = build('with-dashboard');
    const landing = dash.read('index.html');
    const at = (needle) => { const i = landing.indexOf(needle); assert.ok(i !== -1, needle); return i; };
    assert.ok(landing.includes('class="recap-link"'));
    for (const needle of ['<div class="recap">', 'The team infiltrated the cave complex', '<a class="recap-link"']) {
      assert.strictEqual(insideNoPreview(landing, at(needle)), false, `${needle} is not opted out`);
    }
    assert.strictEqual(insideNoPreview(landing, at('<div class="pc-roster"')), true, 'the roster is opted out (the control)');

    const npcIndex = dash.read('characters', 'npcs', 'index.html');
    const wrap = npcIndex.indexOf('<div class="npc-table-wrap"');
    assert.ok(wrap !== -1);
    assert.strictEqual(insideNoPreview(npcIndex, npcIndex.indexOf('<a ', wrap)), true, 'npc-table-wrap links are opted out');

    story = build('story');
    const chapters = story.read('chapters', 'index.html');
    const prog = chapters.indexOf('<div class="story-progression"');
    assert.ok(prog !== -1);
    assert.strictEqual(insideNoPreview(chapters, chapters.indexOf('<a ', prog)), true, 'story-progression links are opted out');
    const landingPage = story.read('story.html');
    const branch = landingPage.indexOf('<section class="story-branch"');
    assert.ok(branch !== -1);
    assert.strictEqual(insideNoPreview(landingPage, landingPage.indexOf('<a ', branch)), true, 'story-branch links are opted out');
  } finally {
    for (const v of [dash, story]) if (v) fs.rmSync(v.root, { recursive: true, force: true });
  }
});

// The subset rule on notes shaped like the defects the proof found: a session with and
// without a Wrap-Up, an item for each holder shape, unquoted dates, a bare underscore name,
// a reference nested in running text.
test('a card is a subset of its page for the shapes that once differed', () => {
  const holders = ['[[Name]]', '[[Name|alias]]', 'Name (note)', 'Name / Other', '[[A]] (held for [[B]])',
    '[[Nathaniel]] (and / or [[Cleo]])', 'n/a — federal fleet vessel', 'Anna_Lindqvist'];
  const files = {
    'Sessions/Session 1.md': '---\ntype: session\nsession_number: 1\nin_game_date: "March 4th 1925"\nplay_date: 2026-07-02\n---\nPrep notes for the night.\n',
    'Sessions/Session 2.md': '---\ntype: session\nsession_number: 2\nin_game_date: "March 5th 1925"\nplay_date: 2026-07-09\n---\nPrep notes.\n',
    'Wrapups/Session 2 Wrap-Up.md': '---\ntype: session_wrap\nsession: "[[Session 2]]"\n---\n# Recap\n\nThey went in. They came out.\n',
    'Events/Fire.md': '---\ntype: event\nin_game_date: 1925-03-04\nlocation: Ex_under_score\noutcome: "Won by [[Left_Side|the left]] after a long fight that went on and on and on and on and on and on and on and on and on and on and on and on"\n---\nBody text.\n',
    'Locations/Quarter.md': '---\ntype: location\nlocation_type: government_quarter\nparent_location: "[[Big_Town]]"\n---\nThe quarter is old. Its walls are high.\n',
    'Notes/Dated.md': '---\ntype: note\ndate: 2026-07-02\n---\nBody.\n',
  };
  holders.forEach((h, i) => { files[`Items/Item ${i}.md`] = `---\ntype: item\nitem_type: plot_thread\ncurrent_holder: ${JSON.stringify(h)}\n---\n- A list marker here. Then more.\n`; });
  const v = buildSmallVault(files, { extraConfig: '  exclude_sections: []\n' });
  try {
    const cards = JSON.parse(v.read('previews.json'));
    assert.ok(Object.keys(cards).length >= 14, Object.keys(cards).join());
    const failures = [];
    for (const [rel, card] of Object.entries(cards)) failures.push(...cardProblems(card, pageText(v.read(...rel.split('/')))).problems.map((p) => `${rel}: ${p}`));
    assert.deepStrictEqual(failures, []);
    // The hub without a Wrap-Up prints no in-game date, and neither does its card.
    assert.ok(!(cards['sessions/session-1.html'].f || []).some(([l]) => l === 'In-game date'));
    assert.ok((cards['sessions/session-2.html'].f || []).some(([l]) => l === 'In-game date'));
    assert.ok(pageText(v.read('sessions', 'session-2.html')).includes('In-game: March 5th 1925'));
    assert.ok(!pageText(v.read('sessions', 'session-1.html')).includes('March 4th 1925'));
  } finally { v.cleanup(); }
});

// A note the build writes no page for has no card, and no card key is a file that was not built.
test('a world-flags note has no page and no card; every card key is a built file', () => {
  const { read, root } = buildVault({
    '_meta/vault-config.md': CONFIG(''),
    'Characters/NPCs/Hallam.md': '---\ntype: npc\noccupation: Warden\n---\nKeeper of the gate.\n',
    'Locations/_flags.md': '---\ntype: world_flags\n---\n## Canon\n\n- The mayor is secretly the cult leader. Zebrafish warning.\n',
  });
  try {
    assert.ok(!fs.existsSync(path.join(root, 'docs', 'locations', 'flags.html')), 'the page is not built');
    const text = read('previews.json');
    assert.ok(!text.includes('cult leader') && !text.includes('Zebrafish'), 'its words are not in the cards');
    for (const key of Object.keys(JSON.parse(text))) assert.ok(fs.existsSync(path.join(root, 'docs', ...key.split('/'))), key);
    assert.deepStrictEqual(Object.keys(JSON.parse(text)), ['characters/npcs/hallam.html']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('onlyBuiltPages drops a card whose page file does not exist, whatever skipped it', () => {
  const { onlyBuiltPages } = require('../lib/previews');
  const cards = { 'a/x.html': { t: 'X' }, 'a/y.html': { t: 'Y' } };
  assert.deepStrictEqual(onlyBuiltPages(cards, (k) => k === 'a/x.html'), { 'a/x.html': { t: 'X' } });
});

// On a Call of Cthulhu folio a PC card shows what the folio prints, not the header badges
// a custom display_meta would give another system's page.
test('a CoC folio PC card is a subset of its page when display_meta names a badge the folio lacks', () => {
  const files = {
    'Characters/Ada Quill.md': '---\ntype: pc\nplayer_name: Pat\noccupation: Antiquarian\ndisplay_meta: [allegiance, occupation]\nallegiance: Wyvern Lodge Xq\n---\n## Stat Sheet\n\nSTR 50\n',
  };
  const v = buildSmallVault(files, { extraConfig: '  system: coc-7e\n' });
  try {
    const cards = JSON.parse(v.read('previews.json'));
    const card = cards['characters/ada-quill.html'];
    assert.ok(card, Object.keys(cards).join());
    assert.ok(!JSON.stringify(card).includes('Wyvern'), JSON.stringify(card));
    assert.deepStrictEqual(cardProblems(card, pageText(v.read('characters', 'ada-quill.html'))).problems, []);
  } finally { v.cleanup(); }
});
