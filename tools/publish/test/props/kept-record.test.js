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
  assert.deepEqual(readKeptRecord(file).files, { 'gazetteer/a.html': 'aaa' });
});

test("a temporary file left by a write that never finished is cleared by the next one", (t) => {
  const file = tempSite(t);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.99999.tmp`, '{ half');
  writeKeptRecord(file, { 'gazetteer/a.html': 'aaa' });
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['kept-writes.json']);
  assert.deepEqual(readKeptRecord(file).files, { 'gazetteer/a.html': 'aaa' });
});

test("a record key with a '..', '.' or empty part, a leading '/' or a backslash is dropped as it is read", (t) => {
  const file = tempSite(t);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const bad = ['gazetteer/../x.html', 'gazetteer/./x.html', 'gazetteer//x.html', '/gazetteer/x.html', 'gazetteer/', '', 'gazetteer\\x.html', '..', '.'];
  fs.writeFileSync(file, JSON.stringify({ version: 1, files: Object.fromEntries([...bad, 'gazetteer/ok.html'].map((k) => [k, 'h'])) }));
  assert.deepEqual(readKeptRecord(file).files, { 'gazetteer/ok.html': 'h' });
});

// #560: which copies replaced a file of the GM's own is kept with the record; an old record without it reads as none.
test('the copies that replaced a file of the GM\'s are kept with the record, and read back', (t) => {
  const file = tempSite(t);
  writeKeptRecord(file, { 'gazetteer/a.html': 'aaa', 'gazetteer/b.html': 'bbb' }, ['gazetteer/b.html', 'gazetteer/gone.html']);
  const read = readKeptRecord(file);
  assert.deepEqual(read.files, { 'gazetteer/a.html': 'aaa', 'gazetteer/b.html': 'bbb' });
  assert.deepEqual([...read.replaced], ['gazetteer/b.html'], 'only a file the record names');
  writeKeptRecord(file, { 'gazetteer/a.html': 'aaa' });
  assert.deepEqual([...readKeptRecord(file).replaced], []);
  assert.ok(!('replaced' in JSON.parse(fs.readFileSync(file, 'utf8'))), 'none is not written');
});

test('an old record with no list of replaced copies reads as none replaced', (t) => {
  const file = tempSite(t);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ version: 1, files: { 'gazetteer/a.html': 'aaa' } }));
  assert.deepEqual(readKeptRecord(file), { files: { 'gazetteer/a.html': 'aaa' }, replaced: new Set(), problem: null });
  fs.writeFileSync(file, JSON.stringify({ version: 1, files: { 'gazetteer/a.html': 'aaa' }, replaced: 'gazetteer/a.html' }));
  assert.deepEqual(readKeptRecord(file).replaced, new Set(), 'a list that is not one is none');
});
