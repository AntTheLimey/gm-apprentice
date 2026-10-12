'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { connectionsFrom } = require('../../lib/config');

const quiet = () => { throw new Error('should not warn'); };

test('left out is tree, with nothing said', () => {
  assert.strictEqual(connectionsFrom(undefined, quiet), 'tree');
});

test('the four values, case and spaces forgiven', () => {
  for (const v of ['tree', 'web', 'cards', 'off']) {
    assert.strictEqual(connectionsFrom(v, quiet), v);
    assert.strictEqual(connectionsFrom(`  ${v.toUpperCase()} `, quiet), v);
  }
});

test("YAML's booleans and yes/no", () => {
  assert.strictEqual(connectionsFrom(false, quiet), 'off');
  assert.strictEqual(connectionsFrom('no', quiet), 'off');
  assert.strictEqual(connectionsFrom(true, quiet), 'tree');
  assert.strictEqual(connectionsFrom('yes', quiet), 'tree');
  assert.strictEqual(connectionsFrom('on', quiet), 'tree');
});

test('anything else is tree, and said once', () => {
  for (const bad of ['graph', '', null, 3, ['web'], { a: 1 }]) {
    const said = [];
    assert.strictEqual(connectionsFrom(bad, (m) => said.push(m)), 'tree');
    assert.strictEqual(said.length, 1);
    assert.match(said[0], /publish\.connections .* is not tree, web, cards or off; using tree/);
  }
});
