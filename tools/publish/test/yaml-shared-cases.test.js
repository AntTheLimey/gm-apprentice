'use strict';
// Text values the settings writer writes read back the same in every YAML reader, including one that follows YAML 1.1
// (`12:30` is the number 750 there). The cases are shared with tests/test_yaml_shared_cases.py, which reads the same
// written text with the Python frontmatter reader.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const YAML = require('yaml');
const { applyChanges } = require('../lib/settings/write');

const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'tests', 'shared-cases', 'yaml-scalars.json'), 'utf8'));

for (const { value, written } of DATA.cases) {
  test(`a setting set to ${JSON.stringify(value)} is written as ${written} and reads back the same in YAML 1.2 and 1.1`, () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'yaml-shared-'));
    const file = path.join(vault, '_meta', 'vault-config.yaml');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'version: 1\nplayer_site:\n  footer: x\n');
    try {
      applyChanges(vault, [{ op: 'set', name: 'player_site.title', value }]);
      const text = fs.readFileSync(file, 'utf8');
      assert.ok(text.split('\n').includes(`  title: ${written}`), text);
      for (const version of ['1.2', '1.1']) assert.equal(YAML.parse(text, { version }).player_site.title, value, `YAML ${version}`);
    } finally {
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });
}
