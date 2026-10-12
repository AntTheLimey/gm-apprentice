const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { resolveConfig } = require('../../lib/config');

function valueOf(line) {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-th-'));
  fs.mkdirSync(path.join(vault, '_meta'));
  fs.writeFileSync(path.join(vault, '_meta', 'vault-config.md'), `---\npublish:\n${line}  site_title: T\n---\n`);
  const said = [];
  const real = console.warn; console.warn = (m) => said.push(String(m));
  try {
    return { value: resolveConfig({ vaultPath: vault }, vault).publishConfig.tohit_calculator,
      said: said.filter((m) => m.includes('publish.tohit_calculator')) };
  } finally { console.warn = real; fs.rmSync(vault, { recursive: true, force: true }); }
}

describe('publish.tohit_calculator', () => {
  it('is on when left out, and says nothing', () => {
    assert.deepStrictEqual(valueOf(''), { value: 'on', said: [] });
  });
  it('reads on, true and yes as on, saying nothing', () => {
    for (const line of ['on', 'true', 'yes', '"on"']) {
      assert.deepStrictEqual(valueOf(`  tohit_calculator: ${line}\n`), { value: 'on', said: [] }, line);
    }
  });
  it('reads off, false and no as off, saying nothing', () => {
    for (const line of ['off', 'false', 'no', '"off"']) {
      assert.deepStrictEqual(valueOf(`  tohit_calculator: ${line}\n`), { value: 'off', said: [] }, line);
    }
  });
  it('reads the quoted strings "true" and "false" as on and off, saying nothing', () => {
    assert.deepStrictEqual(valueOf('  tohit_calculator: "true"\n'), { value: 'on', said: [] });
    assert.deepStrictEqual(valueOf('  tohit_calculator: "false"\n'), { value: 'off', said: [] });
    assert.deepStrictEqual(valueOf('  tohit_calculator: " False "\n'), { value: 'off', said: [] });
  });
  it('trims and ignores case', () => {
    assert.deepStrictEqual(valueOf('  tohit_calculator: " OFF "\n'), { value: 'off', said: [] });
  });
  it('is on for anything else, and says so once', () => {
    const { value, said } = valueOf('  tohit_calculator: maybe\n');
    assert.strictEqual(value, 'on');
    assert.strictEqual(said.length, 1);
    assert.match(said[0], /publish\.tohit_calculator .* is not on, off, yes, no, true or false; using on/);
  });
});
