const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { build } = require('../lib/build');
const { sharedEntries, withSharedThreads } = require('../lib/shared-threads');
const { settingsText, NEW_FILE } = require('./helpers/vault-files');

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
