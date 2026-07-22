const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

describe('scaffold vault.config.json', () => {
  it('ships explicit Tier-1 backend flags', () => {
    const tmpl = fs.readFileSync(
      path.join(__dirname, '..', '..', 'templates-scaffold', 'vault.config.json.tmpl'),
      'utf8',
    );
    // Placeholders {{...}} aren't valid JSON; assert on the parsed backend block
    // by stripping them to empty strings first.
    const parsed = JSON.parse(tmpl.replace(/\{\{[^}]+\}\}/g, ''));
    assert.deepStrictEqual(parsed.backend, { statusBar: false, inbox: false });
  });
});
