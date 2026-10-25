const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { listStyles, PLUGIN_STYLES_DIR } = require('../../lib/props/styles');

// publish-site's prop-styles reference lists the starter styles by hand; this keeps it in step.
const REFERENCE = path.join(__dirname, '..', '..', '..', '..', 'skills', 'publish-site', 'references', 'prop-styles.md');

test('the reference names every starter style and every field it reads', () => {
  const text = fs.readFileSync(REFERENCE, 'utf8');
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'styles-ref-'));
  let names;
  try {
    names = listStyles({ vaultPath: empty }).filter((s) => s.from === 'plugin').map((s) => s.name);
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
  assert.ok(names.length >= 9, `expected the nine starter styles, found ${names.join(', ')}`);
  for (const name of names) {
    const json = JSON.parse(fs.readFileSync(path.join(PLUGIN_STYLES_DIR, name, 'style.json'), 'utf8'));
    assert.ok(text.includes(`- **${name}**`), `${name} is not named`);
    // The style's bullet, with its wrapped lines.
    const line = text.split(`- **${name}**`)[1].split(/\n(?=- |\n)/)[0];
    for (const field of Object.keys(json.fields || {})) {
      assert.ok(line.includes(`\`${field}\``), `${name}'s line does not name ${field}`);
    }
  }
});
