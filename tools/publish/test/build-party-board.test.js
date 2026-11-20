const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { indexTemplate } = require('../lib/templates/index');
const { buildPartyManifest, partyDataScript } = require('../lib/party-manifest');
const { renderPartyBoard } = require('../lib/templates/gurps/party-board');
const { boardFor } = require('../lib/party-board-registry');
const { build } = require('../lib/build');
const { writeSiteConfig, mergeSettings } = require('./helpers/vault-files');

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

const PARTY = 'characters/pcs/index.html';
const OUT_OF_PLAY = new Set(['dead', 'retired']);
const pcPage = (name, slug, status) => ({ title: name, displayTitle: name, outputPath: `characters/pcs/${slug}.html`,
  outputDir: 'characters/pcs', frontmatter: { type: 'pc', status } });
const partyPage = (pages, party) => indexTemplate('characters/pcs', 'Player Characters', pages, () => '<nav></nav>',
  { siteTitle: 'Space Game' }, { system: 'gurps', statuses: { out_of_play: OUT_OF_PLAY } }, {}, { party });

test('the party page carries the board, island, and live scripts when it is given them (#729)', () => {
  const manifest = buildPartyManifest('space-game', [pcEntry('Six', 'six', 6.5, 14)]);
  const html = partyPage([pcPage('Six', 'six', 'alive')], {
    boardHtml: renderPartyBoard(manifest, PARTY),
    dataScript: partyDataScript(manifest),
    clientScripts: ['party-core.js', 'gurps-live.js', 'gurps-party.js'],
  });
  assert.match(html, /class="gl-party"/);
  assert.match(html, /id="gurps-party-data"/);
  assert.match(html, /js\/gurps-live\.js/);
  assert.match(html, /js\/gurps-party\.js/);
});

test('a PC on the board gets no card under it; one the board leaves out keeps its card (#804)', () => {
  const manifest = buildPartyManifest('space-game', [pcEntry('Six', 'six', 6.5, 14)]);
  const board = { boardHtml: renderPartyBoard(manifest, PARTY), dataScript: partyDataScript(manifest), onBoard: ['characters/pcs/six.html'] };
  const onlySix = partyPage([pcPage('Six', 'six', 'alive')], board);
  assert.match(onlySix, /class="gl-party"/);
  assert.match(onlySix, /id="gurps-party-data"/, 'the live data island stays');
  for (const gone of [/entity-card/, /card-grid/, /index-count/, /sort-control/, /pill-filter/, /name-filter/]) {
    assert.doesNotMatch(onlySix, gone);
  }
  const withRook = partyPage([pcPage('Six', 'six', 'alive'), pcPage('Rook', 'rook', 'alive')], board);
  assert.doesNotMatch(withRook, /class="entity-card" href="six\.html"/);
  assert.match(withRook, /class="entity-card" href="rook\.html"/);
  assert.match(withRook, /Showing 1 of 1/);
});

test('with no board drawn, the board\'s list hides no card', () => {
  const html = partyPage([pcPage('Six', 'six', 'alive')], { onBoard: ['characters/pcs/six.html'] });
  assert.match(html, /class="entity-card" href="six\.html"/);
});

test('the party page without a board renders no board or live scripts', () => {
  const html = partyPage([pcPage('Six', 'six', 'alive')], undefined);
  assert.doesNotMatch(html, /gl-party/);
  assert.doesNotMatch(html, /gurps-party-data/);
  assert.doesNotMatch(html, /js\/gurps-party\.js/);
  assert.match(html, /class="entity-card" href="six\.html"/);
});

test('the party page lists the PCs out of play plainly, apart from those in play', () => {
  const html = partyPage([pcPage('Six', 'six', 'alive'), pcPage('Otto', 'otto', 'Retired'), pcPage('Ann', 'ann', 'dead')]);
  assert.match(html, /<h2>Out of Play<\/h2>/);
  assert.match(html, /<li><a href="otto\.html">Otto<\/a> \(Retired\)<\/li>/);
  assert.match(html, /<li><a href="ann\.html">Ann<\/a> \(KIA\)<\/li>/);
  assert.doesNotMatch(html, /class="entity-card" href="otto\.html"/);
  assert.match(html, /Showing 1 of 1/);
  assert.doesNotMatch(partyPage([pcPage('Six', 'six', 'alive')]), /Out of Play/);
});

test('a party page with every PC out of play is just their list', () => {
  const html = partyPage([pcPage('Otto', 'otto', 'Retired'), pcPage('Ann', 'ann', 'dead')]);
  assert.match(html, /<h1 class="page-title">Player Characters<\/h1>/);
  assert.match(html, /<h2>Out of Play<\/h2>/);
  for (const gone of [/Showing 0 of 0/, /index-count/, /sort-control/, /pill-filter/, /name-filter/, /card-grid/]) {
    assert.doesNotMatch(html, gone);
  }
});

test('another section index gets no party board even when handed one', () => {
  const html = indexTemplate('characters/npcs', 'NPCs', [], () => '<nav></nav>', { siteTitle: 'X' },
    { statuses: { out_of_play: OUT_OF_PLAY }, _linkMap: {} }, {}, { party: { boardHtml: '<div class="gl-party"></div>' } });
  assert.doesNotMatch(html, /gl-party/);
});

// Build the with-party-roster fixture (two GURPS PCs, Otto retired; no roster note) and return the party page.
// Gate under test: build() only wires the live party board when live_stats
// is on — the board polls /api/loadout-list, a KV backend absent on a static site.
function buildParty(statusBar, edit, folderMap = {}) {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-publish-party-'));
  try {
    const configPath = path.join(outputDir, 'config.json');
    // The switch lives in the vault file, and a wired KV store is what lets it take effect.
    const vault = path.join(outputDir, 'vault');
    fs.cpSync(path.join(__dirname, 'fixtures', 'with-party-roster'), vault, { recursive: true });
    if (edit) edit(vault);
    if (statusBar) mergeSettings(vault, { 'player_site.features.live_stats': true });
    fs.writeFileSync(path.join(outputDir, 'wrangler.toml'), '[[kv_namespaces]]\nbinding = "INBOX"\nid = "abc123def456"\n');
    writeSiteConfig(configPath, {
      vaultPath: vault,
      outputDir: path.join(outputDir, 'docs'),
      attachmentsDir: '_attachments', siteTitle: 'Roster Test',
      system: 'gurps-4e',
      excludeDirs: ['_meta', '_Templates'], excludeSections: [],
      folderMap: { 'Characters/PCs': 'characters/pcs', ...folderMap },
    }, 2);
    build({ configPath });
    const docs = path.join(outputDir, 'docs');
    const read = (rel) => (fs.existsSync(path.join(docs, rel)) ? fs.readFileSync(path.join(docs, rel), 'utf-8') : null);
    return { party: read(PARTY), old: read('campaign/player-characters.html') };
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
}

test('build() renders the party page with a static board but no live layer when live_stats is off', () => {
  const { party: html } = buildParty(false);
  assert.ok(html, 'the party page is written with no roster note');
  // Static initiative table renders (baked authored values):
  assert.match(html, /class="gl-party"/);
  assert.match(html, /gl-party-table/);
  // No live layer:
  assert.doesNotMatch(html, /id="gurps-party-data"/);   // no JSON island
  assert.doesNotMatch(html, /js\/gurps-party\.js/);      // no client scripts
  assert.doesNotMatch(html, /gl-party-live/);            // no "live" indicator
});

test('build() wires the live party board on the party page when live_stats is on', () => {
  const marker = 'id="' + boardFor('gurps-4e').scriptId + '"'; // id="gurps-party-data"
  const { party: html } = buildParty(true);
  assert.ok(html.includes(marker), 'party-board island present when statusBar on');
  assert.match(html, /class="gl-party"/);
  assert.match(html, /js\/gurps-party\.js/);
});

test('build() leaves out-of-play PCs off the party board and lists them as out of play (#265)', () => {
  // Otto Weiss has a full sheet (so live vitals) but `status: Retired`.
  for (const statusBar of [false, true]) {
    const { party: html } = buildParty(statusBar);
    const board = html.slice(html.indexOf('<section class="gl-party"'), html.indexOf('</section>', html.indexOf('<section class="gl-party"')));
    assert.match(board, /karl-brenner/, 'active PC is on the board');
    assert.doesNotMatch(board, /otto-weiss/, 'retired PC is not on the board');
    if (statusBar) {
      const island = html.match(/<script type="application\/json" id="gurps-party-data">([\s\S]*?)<\/script>/);
      assert.ok(island, 'the data island is there');
      const data = JSON.stringify(JSON.parse(island[1]));
      assert.match(data, /karl-brenner/);
      assert.doesNotMatch(data, /otto-weiss/, 'retired PC is not in the data island');
    }
    assert.match(html, /<a href="otto-weiss\.html">Otto Weiss<\/a> \(Retired\)/);
    assert.doesNotMatch(html, /class="entity-card"/, 'the board lists Karl: no card repeats it (#804)');
  }
});

test('the roster note\'s old address sends the reader to the party page', () => {
  const { old } = buildParty(false);
  assert.match(old, /http-equiv="refresh" content="0;url=\.\.\/characters\/pcs\/index\.html"/);
});

test('a roster note kept at its old address is its own page there, and the party page keeps the board (#729)', () => {
  const { party, old } = buildParty(false, (vault) => {
    fs.mkdirSync(path.join(vault, '_Campaign'));
    fs.writeFileSync(path.join(vault, '_Campaign', 'Player Characters.md'),
      '---\ntype: pc_roster\n---\n\n# Player Characters\n\nThe Cold Fleet sails at dawn.\n');
  }, { _Campaign: 'campaign' });
  assert.match(old, /The Cold Fleet sails at dawn\./);
  assert.doesNotMatch(old, /http-equiv="refresh"/);
  assert.match(party, /class="gl-party"/);
});

test('a PCs index the GM wrote is the party page, and the old roster address still leads to it (#729)', () => {
  const { party, old } = buildParty(false, (vault) => fs.writeFileSync(path.join(vault, 'Characters', 'PCs', 'Index.md'),
    '---\ntype: lore\n---\n\n# The Crew\n\nWho sails with us.\n'));
  assert.match(party, /Who sails with us\./);
  assert.match(old, /http-equiv="refresh" content="0;url=\.\.\/characters\/pcs\/index\.html"/);
});

test('a party page with no PC card here still shows a board with PCs on it', () => {
  const html = partyPage([pcPage('Otto', 'otto', 'Retired')], { boardHtml: '<section class="gl-party">board</section>' });
  assert.match(html, /<section class="gl-party">board<\/section>/);
  assert.match(html, /<h2>Out of Play<\/h2>/);
});

test('a vault with no PCs gets no party page', () => {
  const { party, old } = buildParty(false, (vault) => {
    for (const f of ['Karl Brenner.md', 'Otto Weiss.md']) fs.rmSync(path.join(vault, 'Characters', 'PCs', f));
    fs.writeFileSync(path.join(vault, 'Characters', 'PCs', 'Note.txt'), 'not a note');
  });
  assert.strictEqual(party, null);
  assert.strictEqual(old, null);
});

test('a roster note left in a vault is an ordinary page and moves nothing (#729)', () => {
  const { party } = buildParty(false, (vault) => fs.writeFileSync(path.join(vault, 'Characters', 'PCs', 'Player Characters.md'),
    '---\ntype: pc_roster\n---\n\n# Player Characters\n\nThe Cold Fleet.\n'));
  assert.match(party, /class="gl-party"/, 'the board stays on the party page');
});

test('the CoC party page carries the coc board, coc-party-data island, and ordered scripts', () => {
  const board = boardFor('coc-7e');
  const entries = [{ name: 'Emma Wentworth', outputPath: 'characters/pcs/emma-wentworth.html', portrait: null, data: {
    pcSlug: 'emma-wentworth', dex: 70, player: 'Missy', hp: { cur: 10, max: 10 }, san: { cur: 35, max: 92 },
    mp: { cur: 12, max: 12 }, luck: { cur: 80 }, rep: { cur: 71 }, conditions: { indefiniteInsanity: true } } }];
  const manifest = board.buildManifest('canticle', entries);
  const html = partyPage([pcPage('Emma Wentworth', 'emma-wentworth', 'alive')], {
    boardHtml: board.renderBoard(manifest, PARTY),
    dataScript: partyDataScript(manifest, board.scriptId),
    clientScripts: board.clientScripts,
  });
  assert.match(html, /class="gl-party"/);
  assert.match(html, /id="coc-party-data"/);
  assert.match(html, /js\/party-core\.js/);
  assert.match(html, /js\/coc-party\.js/);
  assert.doesNotMatch(html, /js\/gurps-party\.js/);
});
