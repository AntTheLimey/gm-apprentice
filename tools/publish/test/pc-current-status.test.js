// Every system's PC page shows the note's Current Status: its lede, its lines, the PC's own open threads and the
// shared threads the build adds from the Campaign Overview (#782). A GURPS sheet once took the section and showed
// none of it. Each case's sheet must render, or the section would show only because nothing took it.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { build } = require('../lib/build');
const { writeNewConfig } = require('./helpers/settings-files');

const FIXTURES = path.join(__dirname, 'fixtures');
const TEMPLATES = path.join(__dirname, '..', '..', '..', 'skills', 'shared', 'templates');
const lf = (text) => text.replace(/\r\n/g, '\n');
const fixture = (rel) => lf(fs.readFileSync(path.join(FIXTURES, rel), 'utf8'));
const template = (name) => lf(fs.readFileSync(path.join(TEMPLATES, name), 'utf8'));

const STATUS = `## Current Status

Standing watch at the ford, with a lantern nobody else will carry.

**Location:** Harrow Ford
**Condition:** Bruised ribs from the bridge fight.
**Open threads:**
- Owes the ferrywoman two silver, due at the next full moon.
**Knows (exclusive):** The toll keeper cannot read.

`;

// The note's own Current Status, swapped for the one above (up to the next section or the end).
function withStatus(note) {
  const at = note.search(/^## Current Status\s*$/m);
  assert.ok(at >= 0, 'the note has a Current Status');
  const next = note.slice(at + 3).search(/^## /m);
  return note.slice(0, at) + STATUS + (next >= 0 ? note.slice(at + 3 + next) : '');
}

const CASES = [
  { system: 'gurps-4e', note: () => fixture('with-gurps-pc/Characters/PCs/Karl Brenner.md'), sheet: 'class="gurps-sheet"' },
  { system: 'coc-7e', note: () => fixture('with-coc-pc/Characters/PCs/Jane_Ashford.md'), sheet: 'class="coc-charsheet"' },
  { system: 'dnd-5e-2024', note: () => fixture('with-dnd-pc/Characters/PCs/Brannoch_Vale.md'), sheet: 'class="dnd5e-blk' },
  { system: 'pf2e', note: () => template('pc-pf2e.md'), sheet: 'class="dnd-ability-scores"' },
  { system: 'fitd', note: () => template('pc-fitd.md'), sheet: 'class="fitd-sheet"' },
];

const OVERVIEW = `---
type: campaign_overview
---

# The Lantern Road

## Open Threads

- **The missing ledger** — the toll keeper wants it back — since Session 2; involves [[Wren]]
`;

for (const { system, note, sheet } of CASES) {
  test(`a ${system} PC page shows its Current Status, own threads and shared threads (#782)`, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-current-status-'));
    const vault = path.join(root, 'vault');
    const files = { 'PCs/Wren.md': withStatus(note()), 'Campaign Overview.md': OVERVIEW };
    for (const [rel, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true });
      fs.writeFileSync(path.join(vault, rel), text);
    }
    const siteDir = path.join(root, 'campaign');
    fs.mkdirSync(siteDir);
    writeNewConfig(vault, { version: 1, vault: { system }, player_site: { folder: siteDir, folder_map: { PCs: 'pcs' } } });
    const configPath = path.join(siteDir, 'vault.config.json');
    fs.writeFileSync(configPath, JSON.stringify({ vaultPath: vault }));
    const real = console.log; const warn = console.warn; console.log = () => {}; console.warn = () => {};
    try { build({ configPath }); } finally { console.log = real; console.warn = warn; }
    const html = fs.readFileSync(path.join(siteDir, 'docs', 'pcs', 'wren.html'), 'utf8');
    assert.ok(html.includes(sheet), `the ${system} sheet renders`);
    for (const text of ['with a lantern nobody else will carry', 'Bruised ribs from the bridge fight',
      'Owes the ferrywoman two silver', 'The toll keeper cannot read', 'Shared threads', 'the toll keeper wants it back']) {
      assert.ok(html.includes(text), `${system}: the page shows "${text}"`);
    }
  });
}
