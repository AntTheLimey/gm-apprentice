const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { resolveConfig } = require('../../lib/config');

// `publish.mode` is retired (Build 2 part C): the GM site is what `full` was. Whatever the old file
// holds, the build reads nothing from it and says so once; it never stops a build.
function read(line) {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-mode-'));
  fs.mkdirSync(path.join(vault, '_meta'));
  fs.writeFileSync(path.join(vault, '_meta', 'vault-config.md'), `---\npublish:\n${line}  site_title: T\n---\n`);
  const said = [];
  try {
    const { publishConfig } = resolveConfig({ vaultPath: vault }, vault, (m) => said.push(String(m)));
    return { publishConfig, said: said.filter((m) => m.includes('publish.mode')) };
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
}

describe('publish.mode (retired)', () => {
  it('is left out: nothing is said and the config holds no mode', () => {
    const { publishConfig, said } = read('');
    assert.deepStrictEqual(said, []);
    assert.strictEqual(Object.hasOwn(publishConfig, 'mode'), false);
  });
  it('is read by nothing, whatever it holds, and said once', () => {
    for (const line of ['  mode: player\n', '  mode: full\n', '  mode: Player\n', '  mode: " FULL "\n', '  mode: players\n', '  mode: true\n', '  mode: [player]\n']) {
      const { publishConfig, said } = read(line);
      assert.strictEqual(Object.hasOwn(publishConfig, 'mode'), false, line);
      assert.strictEqual(said.length, 1, line);
      assert.match(said[0], /publish\.mode is no longer used: the GM site is what `full` was/);
    }
  });
  it('left empty is not set: nothing is said', () => {
    assert.deepStrictEqual(read('  mode:\n').said, []);
  });
});
