const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { resolveConfig } = require('../../lib/config');

// What the build takes `publish.mode` to be, and what it says about it.
function modeOf(line) {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-mode-'));
  fs.mkdirSync(path.join(vault, '_meta'));
  fs.writeFileSync(path.join(vault, '_meta', 'vault-config.md'), `---\npublish:\n${line}  site_title: T\n---\n`);
  const said = [];
  const real = console.warn; console.warn = (m) => said.push(String(m));
  try {
    return { mode: resolveConfig({ vaultPath: vault }, vault).publishConfig.mode, said: said.filter((m) => m.includes('publish.mode')) };
  } finally { console.warn = real; fs.rmSync(vault, { recursive: true, force: true }); }
}

describe('publish.mode', () => {
  it('is player when left out, and says nothing', () => {
    assert.deepStrictEqual(modeOf(''), { mode: 'player', said: [] });
  });
  it('takes player and full as written, in any case, with spaces round them', () => {
    assert.deepStrictEqual(modeOf('  mode: player\n'), { mode: 'player', said: [] });
    assert.deepStrictEqual(modeOf('  mode: full\n'), { mode: 'full', said: [] });
    assert.deepStrictEqual(modeOf('  mode: Player\n'), { mode: 'player', said: [] });
    assert.deepStrictEqual(modeOf('  mode: " FULL "\n'), { mode: 'full', said: [] });
  });
  // Anything else used to pass through as written, and the build then treated it as
  // not-player: the publish list was ignored and more was published, silently.
  it('is player for any other value, and says so', () => {
    for (const line of ['  mode: players\n', '  mode: gm\n', '  mode: true\n', '  mode: [player]\n']) {
      const { mode, said } = modeOf(line);
      assert.strictEqual(mode, 'player', line);
      assert.strictEqual(said.length, 1, line);
      assert.match(said[0], /publish\.mode .* is not player or full; using player/);
    }
  });
});
