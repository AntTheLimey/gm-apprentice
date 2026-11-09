const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { build } = require('../lib/build');
const { sharedEntries, withSharedThreads } = require('../lib/shared-threads');
const { settingsText, NEW_FILE } = require('./helpers/vault-files');
const { writeNewConfig } = require('./helpers/settings-files');

const FIXTURE = path.join(__dirname, '..', '..', '..', 'tests', 'fixtures', 'shared-threads');
const overview = () => fs.readFileSync(path.join(FIXTURE, 'Campaign Overview.md'), 'utf8');
const pc = (name) => fs.readFileSync(path.join(FIXTURE, 'PCs', `${name}.md`), 'utf8');

function buildVault(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-threads-build-'));
  const vault = path.join(root, 'vault');
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true });
    fs.writeFileSync(path.join(vault, rel), text);
  }
  const configPath = path.join(root, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({ vaultPath: vault }));
  const real = console.log; console.log = () => {};
  try { build({ configPath }); } finally { console.log = real; }
  return { read: (...p) => fs.readFileSync(path.join(root, 'docs', ...p), 'utf8') };
}

const CONFIG = settingsText({ 'player_site.title': 'T', 'player_site.folder_map': { PCs: 'pcs' } });

test('shared threads: reads the entries the Python writer writes', () => {
  const entries = sharedEntries(overview());
  assert.strictEqual(entries.length, 2, 'the plain bullet under GM Notes is not read');
  assert.deepStrictEqual(entries[0], { markdown: "- **The missing ledger** — Harrow Ford's toll keeper wants it back — since Session 2", involves: [], party: true });
  assert.deepStrictEqual(entries[1].involves, ['Ines_Marlowe', 'Corwin_Hale']);
  assert.strictEqual(entries[1].party, false);
  const noSince = sharedEntries('## Open Threads\n\n- A thing — involves [[Tobin]]\n- Hand-written, no tail\n');
  assert.deepStrictEqual(noSince, [{ markdown: '- A thing', involves: ['Tobin'], party: false }]);
});

test('shared threads: names the PC through an alias link', () => {
  const entry = sharedEntries(overview())[1];
  assert.ok(entry.involves.includes('Corwin_Hale'), 'the alias label is dropped, the target kept');
  const page = withSharedThreads(pc('Corwin_Hale'), [entry]);
  assert.match(page, /\*\*Shared threads:\*\*\n- \*\*Corwin's debt to the ferrywoman\*\* — owed for the night crossing — since Session 3\n\n## Notes/);
  assert.doesNotMatch(page, /involves/);
});

test('shared threads: party threads go on every PC page', () => {
  const party = sharedEntries(overview()).filter((e) => e.party);
  for (const name of ['Corwin_Hale', 'Ines_Marlowe']) {
    assert.match(withSharedThreads(pc(name), party), /\*\*Shared threads:\*\*\n- \*\*The missing ledger\*\*/);
  }
});

test('shared threads: a gm-only shared thread stays off the player PC page', () => {
  const secret = 'Nobody must know about the sunken bell';
  const files = {
    [NEW_FILE]: CONFIG,
    'Campaign Overview.md': overview().replace('## Key Factions',
      `<!-- gm-only -->\n- ${secret} — since Session 1; involves the party\n- ${secret} again — involves [[Corwin_Hale]]\n<!-- /gm-only -->\n\n## Key Factions`),
    'PCs/Corwin_Hale.md': pc('Corwin_Hale'),
    'PCs/Ines_Marlowe.md': pc('Ines_Marlowe'),
  };
  const { read } = buildVault(files);
  const corwin = read('pcs', 'corwin-hale.html');
  assert.doesNotMatch(corwin, /sunken bell/);
  assert.match(corwin, /Shared threads/);
  assert.match(corwin, /The missing ledger/);
  assert.match(corwin, /Corwin.s debt to the ferrywoman/, 'the alias-linked thread reaches Corwin');
  const ines = read('pcs', 'ines-marlowe.html');
  assert.doesNotMatch(ines, /sunken bell/);
  assert.match(ines, /Corwin.s debt/, 'the thread names Ines too');
});

test('shared threads: a PC with no Current Status is unchanged', () => {
  const bare = '---\ntype: pc\n---\n\n# Tobin\n\n## Notes\n\nx\n';
  assert.strictEqual(withSharedThreads(bare, sharedEntries(overview())), bare);
});

test('shared threads: no Open Threads section changes nothing', () => {
  assert.deepStrictEqual(sharedEntries('# Overview\n\n## Premise\n\nx\n'), []);
  const page = pc('Ines_Marlowe');
  assert.strictEqual(withSharedThreads(page, []), page);
});

test('shared threads: the tail is split at the last valid one, as Python does', () => {
  const md = [
    '## Open Threads', '',
    '- **Smuggling ring** — involves the harbourmaster — since Session 4; involves the party',
    '- **Debt** — involves the ferrywoman — since Session 5; involves [[Corwin_Hale|Corwin]]',
    '',
  ].join('\n');
  const [ring, debt] = sharedEntries(md);
  assert.deepStrictEqual(ring, { markdown: '- **Smuggling ring** — involves the harbourmaster — since Session 4', involves: [], party: true });
  assert.deepStrictEqual(debt.involves, ['Corwin_Hale']);
  assert.strictEqual(debt.markdown, '- **Debt** — involves the ferrywoman — since Session 5');
});

test('shared threads: a PC whose Current Status players do not see gets none, on either site', () => {
  const notes = {
    'Campaign Overview.md': overview(),
    'PCs/Corwin_Hale.md': pc('Corwin_Hale'),
  };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-threads-gm-'));
  const vault = path.join(root, 'vault');
  for (const [rel, text] of Object.entries(notes)) {
    fs.mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true });
    fs.writeFileSync(path.join(vault, rel), text);
  }
  const siteDir = path.join(root, 'campaign');
  fs.mkdirSync(siteDir);
  writeNewConfig(vault, { version: 1, player_site: { folder: siteDir, folder_map: { PCs: 'pcs' }, hide: { sections: ['Current Status'] } },
    gm_site: { publish: true, folder: path.join(root, 'campaign-gm') } });
  const configPath = path.join(siteDir, 'vault.config.json');
  fs.writeFileSync(configPath, JSON.stringify({ vaultPath: vault }));
  const real = console.log; const warn = console.warn; console.log = () => {}; console.warn = () => {};
  try { for (const s of ['player', 'gm']) build({ configPath, site: s }); } finally { console.log = real; console.warn = warn; }
  const player = fs.readFileSync(path.join(siteDir, 'docs', 'pcs', 'corwin-hale.html'), 'utf8');
  const gm = fs.readFileSync(path.join(root, 'campaign-gm', 'pcs', 'corwin-hale.html'), 'utf8');
  assert.doesNotMatch(player, /Shared threads|The missing ledger/);
  assert.doesNotMatch(gm, /Shared threads|The missing ledger/, 'the GM page never shows an unmarked copy');
});
