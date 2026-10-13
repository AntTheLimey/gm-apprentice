'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { NEW_FILE, OLD_FILE, STATE_FILE, layoutOf, at } = require('../../lib/settings/layout');
const { writeNewConfig, writeOldConfig } = require('../helpers/settings-files');

const vault = () => fs.mkdtempSync(path.join(os.tmpdir(), 'layout-'));

test('the three file names', () => {
  assert.equal(NEW_FILE, '_meta/vault-config.yaml');
  assert.equal(OLD_FILE, '_meta/vault-config.md');
  assert.equal(STATE_FILE, '_meta/vault-state.json');
});

test('a vault with neither file is on no layout', () => {
  assert.equal(layoutOf(vault()), 'none');
});

test('a vault with only the old file is on the old layout', () => {
  const v = vault();
  writeOldConfig(v, { mode: 'player' });
  assert.equal(layoutOf(v), 'legacy');
});

test('a vault with the new file is on the new layout', () => {
  const v = vault();
  writeNewConfig(v, { version: 1 });
  assert.equal(layoutOf(v), 'new');
});

test('with both files the new one wins', () => {
  const v = vault();
  writeOldConfig(v, { mode: 'player' });
  writeNewConfig(v, { version: 1 });
  assert.equal(layoutOf(v), 'new');
});

test('an empty new file still counts', () => {
  const v = vault();
  writeNewConfig(v, '');
  assert.equal(layoutOf(v), 'new');
});

test('a path is built from the vault with the platform separator', () => {
  const v = vault();
  assert.equal(at(v, NEW_FILE), path.join(v, '_meta', 'vault-config.yaml'));
});
