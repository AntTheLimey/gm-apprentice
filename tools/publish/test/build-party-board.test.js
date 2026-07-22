const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { wikiTemplate } = require('../lib/templates/index');
const { buildPartyManifest, partyDataScript } = require('../lib/party-manifest');
const { renderPartyBoard } = require('../lib/templates/gurps/party-board');
const { boardFor } = require('../lib/party-board-registry');
const { build } = require('../lib/build');

function pcEntry(name, slug, bs, dx) {
  return { name, outputPath: 'characters/pcs/' + slug + '.html', data: {
    pcSlug: slug, buildVersion: 'v1', basicSpeed: bs, dx, authoredLevel: 0,
    levels: [{ name: 'None', num: 0, maxWeight: 26, move: 6, dodge: 10 },
             { name: 'Light', num: 1, maxWeight: 52, move: 4, dodge: 9 },
             { name: 'Medium', num: 2, maxWeight: 78, move: 3, dodge: 8 },
             { name: 'Heavy', num: 3, maxWeight: 156, move: 2, dodge: 7 },
             { name: 'X', num: 4, maxWeight: 260, move: 1, dodge: 6 }],
    items: [{ key: 'Pack', weight: 10, defaultCarried: true, table: 'main' }],
    vitals: { hp: { cur: 13, max: 13 }, fp: { cur: 12, max: 12 }, st: 13 } } };
}

test('wikiTemplate injects the board, island, and live scripts when context carries them', () => {
  const manifest = buildPartyManifest('space-game', [pcEntry('Six', 'six', 6.5, 14)]);
  const page = { title: 'Player Characters', displayTitle: 'Player Characters',
    outputPath: 'characters/pcs/index.html', frontmatter: { type: 'pc_roster' } };
  const processed = { html: '<p>The Cold Fleet.</p>', metadata: {}, warnings: [] };
  const html = wikiTemplate(page, processed, () => '<nav></nav>', { siteTitle: 'Space Game' }, {}, {
    publishConfig: { system: 'gurps' }, linkMap: {}, pages: [],
    partyBoardHtml: renderPartyBoard(manifest, page.outputPath),
    partyDataScript: partyDataScript(manifest),
    partyClientScripts: ['party-core.js', 'gurps-live.js', 'gurps-party.js'],
  });
  assert.match(html, /class="gl-party"/);
  assert.match(html, /id="gurps-party-data"/);
  assert.match(html, /js\/gurps-live\.js/);
  assert.match(html, /js\/gurps-party\.js/);
  assert.match(html, /The Cold Fleet/);   // authored content preserved below the board
});

test('wikiTemplate without party context renders no board or live scripts', () => {
  const page = { title: 'A Wiki Page', displayTitle: 'A Wiki Page',
    outputPath: 'wiki/thing.html', frontmatter: { type: 'wiki' } };
  const processed = { html: '<p>hi</p>', metadata: {}, warnings: [] };
  const html = wikiTemplate(page, processed, () => '<nav></nav>', { siteTitle: 'X' }, {}, { publishConfig: {}, linkMap: {}, pages: [] });
  assert.doesNotMatch(html, /gurps-party-data/);
  assert.doesNotMatch(html, /js\/gurps-party\.js/);
});

// Build the with-party-roster fixture and return the rendered roster HTML.
// Gate under test: build() only wires the live party board when backend.statusBar
// is on — the board polls /api/loadout-list, a KV backend absent on a static site.
function buildRosterHtml(statusBar) {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-publish-roster-'));
  try {
    const configPath = path.join(outputDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      vaultPath: path.join(__dirname, 'fixtures', 'with-party-roster'),
      outputDir: path.join(outputDir, 'docs'),
      attachmentsDir: '_attachments', siteTitle: 'Roster Test',
      system: 'gurps-4e', backend: { statusBar },
      excludeDirs: ['_meta', '_Templates'], excludeSections: [],
      folderMap: { 'Characters/PCs': 'characters/pcs' },
    }, null, 2));
    build({ configPath });
    const rosterPath = path.join(outputDir, 'docs', 'characters', 'pcs', 'player-characters.html');
    assert.ok(fs.existsSync(rosterPath), 'roster page renders regardless of statusBar');
    return fs.readFileSync(rosterPath, 'utf-8');
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
}

test('build() omits the live party board on the roster when backend.statusBar is off', () => {
  const marker = 'id="' + boardFor('gurps-4e').scriptId + '"'; // id="gurps-party-data"
  const html = buildRosterHtml(false);
  assert.ok(!html.includes(marker), 'no party-board island when statusBar off');
  assert.doesNotMatch(html, /class="gl-party"/);
  assert.doesNotMatch(html, /js\/gurps-party\.js/);
});

test('build() wires the live party board on the roster when backend.statusBar is on', () => {
  const marker = 'id="' + boardFor('gurps-4e').scriptId + '"'; // id="gurps-party-data"
  const html = buildRosterHtml(true);
  assert.ok(html.includes(marker), 'party-board island present when statusBar on');
  assert.match(html, /class="gl-party"/);
  assert.match(html, /js\/gurps-party\.js/);
});

test('CoC roster injects the coc board, coc-party-data island, and ordered scripts', () => {
  const board = boardFor('coc-7e');
  const entries = [{ name: 'Emma Wentworth', outputPath: 'characters/pcs/emma-wentworth.html', portrait: null, data: {
    pcSlug: 'emma-wentworth', dex: 70, player: 'Missy', hp: { cur: 10, max: 10 }, san: { cur: 35, max: 92 },
    mp: { cur: 12, max: 12 }, luck: { cur: 80 }, rep: { cur: 71 }, conditions: { indefiniteInsanity: true } } }];
  const manifest = board.buildManifest('canticle', entries);
  const page = { title: 'Player Characters', displayTitle: 'Player Characters',
    outputPath: 'player-characters.html', frontmatter: { type: 'pc_roster' } };
  const processed = { html: '<p>Active investigators.</p>', metadata: {}, warnings: [] };
  const html = wikiTemplate(page, processed, () => '<nav></nav>', { siteTitle: 'Canticle' }, {}, {
    publishConfig: { system: 'coc-7e' }, linkMap: {}, pages: [],
    partyBoardHtml: board.renderBoard(manifest, page.outputPath),
    partyDataScript: require('../lib/party-manifest').partyDataScript(manifest, board.scriptId),
    partyClientScripts: board.clientScripts,
  });
  assert.match(html, /class="gl-party"/);
  assert.match(html, /id="coc-party-data"/);
  assert.match(html, /js\/party-core\.js/);
  assert.match(html, /js\/coc-party\.js/);
  assert.doesNotMatch(html, /js\/gurps-party\.js/);
  assert.match(html, /Active investigators/);
});
