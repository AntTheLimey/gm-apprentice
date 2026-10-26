const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { listStyles } = require('../../lib/props/styles');

// ttrpg-expert's making-a-prop reference ships without publish-site, so it lists the starter styles itself.
const REFERENCE = path.join(__dirname, '..', '..', '..', '..', 'skills', 'ttrpg-expert', 'making-a-prop.md');

test('making-a-prop.md names every starter style', () => {
  const text = fs.existsSync(REFERENCE) ? fs.readFileSync(REFERENCE, 'utf8') : '';
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'making-ref-'));
  let names;
  try {
    names = listStyles({ vaultPath: empty }).filter((s) => s.from === 'plugin').map((s) => s.name);
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
  assert.ok(names.length >= 9, `expected the nine starter styles, found ${names.join(', ')}`);
  for (const name of names) assert.ok(text.includes(`**${name}**`), `${name} is not named`);
});
