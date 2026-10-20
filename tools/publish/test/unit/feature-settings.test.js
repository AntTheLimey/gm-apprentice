'use strict';
// How the to-hit calculator, Connections and link previews settings read.
// Each block below was a test file of its own; the blocks keep their own imports and helpers.

// ---- tohit-setting.test.js -------------------------------------------------------------------------------
{
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { resolveConfig } = require('../../lib/config');

function valueOf(line) {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-th-'));
  fs.mkdirSync(path.join(vault, '_meta'));
  fs.writeFileSync(path.join(vault, '_meta', 'vault-config.md'), `---\npublish:\n${line}  site_title: T\n---\n`);
  const said = [];
  try {
    return { value: resolveConfig({ vaultPath: vault }, vault, (m) => said.push(String(m))).publishConfig.tohit_calculator,
      said: said.filter((m) => m.includes('publish.tohit_calculator')) };
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
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
    assert.match(said[0], /publish.tohit_calculator .*; it takes on or off/);
  });
});
}

// ---- connections-setting.test.js -------------------------------------------------------------------------
{
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
}

// ---- link-previews-setting.test.js -----------------------------------------------------------------------
{
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { resolveConfig } = require('../../lib/config');

function valueOf(line) {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-lp-'));
  fs.mkdirSync(path.join(vault, '_meta'));
  fs.writeFileSync(path.join(vault, '_meta', 'vault-config.md'), `---\npublish:\n${line}  site_title: T\n---\n`);
  const said = [];
  try {
    return { value: resolveConfig({ vaultPath: vault }, vault, (m) => said.push(String(m))).publishConfig.link_previews,
      said: said.filter((m) => m.includes('publish.link_previews')) };
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
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
  it('reads yes and no (any case, trimmed) as on and off, saying nothing', () => {
    for (const [line, want] of [['yes', 'on'], ['no', 'off'], ['"No"', 'off'], ['" YES "', 'on'], ['"no"', 'off']]) {
      assert.deepStrictEqual(valueOf(`  link_previews: ${line}\n`), { value: want, said: [] }, line);
    }
  });
  it('is on for anything else, and says so once, naming every value it takes', () => {
    for (const line of ['maybe', 'none', 'mobile', '3', '[on]', '""']) {
      const { value, said } = valueOf(`  link_previews: ${line}\n`);
      assert.strictEqual(value, 'on', line);
      assert.strictEqual(said.length, 1, line);
      assert.match(said[0], /publish.link_previews .*; it takes on, desktop or off/);
    }
  });
});
}
