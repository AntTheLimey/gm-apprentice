'use strict';
// The kept-folder record (#506) is written whole or not at all: to a temporary file beside it, renamed over it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readKeptRecord, writeKeptRecord } = require('../../lib/props/kept-record');

const tempSite = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kept-record-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, '.gm-apprentice', 'kept-writes.json');
};

test('a rename that fails leaves the old record whole and no temporary file', (t) => {
  const file = tempSite(t);
  writeKeptRecord(file, { 'gazetteer/a.html': 'aaa' });
  const before = fs.readFileSync(file, 'utf8');
  t.mock.method(fs, 'renameSync', () => { throw Object.assign(new Error('EIO: i/o error'), { code: 'EIO' }); });
  assert.throws(() => writeKeptRecord(file, { 'gazetteer/b.html': 'bbb' }), /EIO/);
  t.mock.restoreAll();
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['kept-writes.json']);
  assert.deepEqual(readKeptRecord(file), { files: { 'gazetteer/a.html': 'aaa' }, problem: null });
});

test("a temporary file left by a write that never finished is cleared by the next one", (t) => {
  const file = tempSite(t);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.99999.tmp`, '{ half');
  writeKeptRecord(file, { 'gazetteer/a.html': 'aaa' });
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['kept-writes.json']);
  assert.deepEqual(readKeptRecord(file).files, { 'gazetteer/a.html': 'aaa' });
});
