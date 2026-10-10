const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { resolveConfig } = require('../../lib/config');

function valueOf(line) {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-lp-'));
  fs.mkdirSync(path.join(vault, '_meta'));
  fs.writeFileSync(path.join(vault, '_meta', 'vault-config.md'), `---\npublish:\n${line}  site_title: T\n---\n`);
  const said = [];
  const real = console.warn; console.warn = (m) => said.push(String(m));
  try {
    return { value: resolveConfig({ vaultPath: vault }, vault).publishConfig.link_previews,
      said: said.filter((m) => m.includes('publish.link_previews')) };
  } finally { console.warn = real; fs.rmSync(vault, { recursive: true, force: true }); }
}

describe('publish.link_previews', () => {
  it('is on when left out, and says nothing', () => {
    assert.deepStrictEqual(valueOf(''), { value: 'on', said: [] });
  });
  it('takes on, desktop and off in any case, and true and false', () => {
    for (const [line, want] of [['on', 'on'], ['"on"', 'on'], ['Desktop', 'desktop'], ['" OFF "', 'off'],
      ['true', 'on'], ['false', 'off'], ['off', 'off']]) {
      assert.deepStrictEqual(valueOf(`  link_previews: ${line}\n`), { value: want, said: [] }, line);
    }
  });
  it('is on for anything else, and says so once, naming the three values', () => {
    for (const line of ['mobile', '3', '[on]', '', '""']) {
      const { value, said } = valueOf(`  link_previews: ${line}\n`);
      assert.strictEqual(value, 'on', line);
      assert.strictEqual(said.length, 1, line);
      assert.match(said[0], /publish\.link_previews .* is not on, desktop or off; using on/);
    }
  });
});
