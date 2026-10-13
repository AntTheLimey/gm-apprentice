const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { resolveConfig } = require('../../lib/config');

function valueOf(line) {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-cn-'));
  fs.mkdirSync(path.join(vault, '_meta'));
  fs.writeFileSync(path.join(vault, '_meta', 'vault-config.md'), `---\npublish:\n${line}  site_title: T\n---\n`);
  const said = [];
  try {
    return { value: resolveConfig({ vaultPath: vault }, vault, (m) => said.push(String(m))).publishConfig.connections,
      said: said.filter((m) => m.includes('publish.connections')) };
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
}

describe('publish.connections', () => {
  it('is tree when left out, and says nothing', () => {
    assert.deepStrictEqual(valueOf(''), { value: 'tree', said: [] });
  });
  it('takes the four values, case and spaces forgiven', () => {
    for (const v of ['tree', 'web', 'cards', 'off']) {
      assert.deepStrictEqual(valueOf(`  connections: ${v}\n`), { value: v, said: [] }, v);
      assert.deepStrictEqual(valueOf(`  connections: "  ${v.toUpperCase()} "\n`), { value: v, said: [] }, v);
    }
  });
  it("reads YAML's booleans and yes/no, and the quoted words, saying nothing", () => {
    for (const [line, want] of [['false', 'off'], ['no', 'off'], ['true', 'tree'], ['yes', 'tree'], ['on', 'tree'],
      ['"false"', 'off'], ['" True "', 'tree']]) {
      assert.deepStrictEqual(valueOf(`  connections: ${line}\n`), { value: want, said: [] }, line);
    }
  });
  it('is tree for anything else, and says so once, naming every value it takes', () => {
    for (const line of ['graph', '""', '3', '[web]', '{ a: 1 }']) {
      const { value, said } = valueOf(`  connections: ${line}\n`);
      assert.strictEqual(value, 'tree', line);
      assert.strictEqual(said.length, 1, line);
      assert.match(said[0], /publish\.connections .*; it takes tree, web, cards or off\./);
    }
  });
});
