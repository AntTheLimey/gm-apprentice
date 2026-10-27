'use strict';
// The leak gate and a container's state file: a file the tool makes, read as the data it holds, with no other note's
// hidden text excused on it. A sealed item's title is allowed there, as on its listings, and nothing else of that item.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { leakSite, leakInto } = require('../helpers/leak-site');
const { runLeakGate } = require('../../lib/leak-gate');
const { FILES, SETTINGS, SEALED_TITLE, SEALED_LINE } = require('../helpers/prop-state-vault');

const gate = (s) => runLeakGate({ configPath: s.configPath, outputDir: s.outputDir });
const pick = (f) => ({ code: f.code, page: f.page, note: f.note });
const within = (fn, ...args) => { const s = leakSite(...args); try { return fn(s); } finally { s.cleanup(); } };
const SEALED_NOTE = `Library/${SEALED_TITLE}.md`;
// The state file with one more field on its first item, as a broken build might have written it.
function plant(s, value) {
  const file = path.join(s.outputDir, 'props', 'state.js');
  const text = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, text.replace('"sealed": false,', `"sealed": false,\n    "extra": ${JSON.stringify(value)},`));
}

describe('leak gate: a container state file', () => {
  it('the state file as built is no finding', () => within((s) => {
    assert.match(fs.readFileSync(path.join(s.outputDir, 'props', 'state.js'), 'utf8'), new RegExp(SEALED_TITLE));
    assert.deepEqual(gate(s).findings, []);
  }, FILES(), SETTINGS));

  it("a held item's line planted in the state file is a finding", () => within((s) => {
    plant(s, `${SEALED_LINE}.`);
    assert.deepEqual(gate(s).findings.map(pick), [{ code: 'HIDDEN_TEXT', page: 'props/state.js', note: SEALED_NOTE }]);
  }, FILES(), SETTINGS));

  it('a hidden field of a shown item planted in the state file is a finding', () => within((s) => {
    plant(s, 'Stamped inside by the smuggler Corwin Hale');
    assert.deepEqual(gate(s).findings.map(pick), [{ code: 'HIDDEN_TEXT', page: 'props/state.js', note: 'Library/Atlas of the Coast.md' }]);
  }, FILES(), SETTINGS));

  it("another note's hidden text planted in the state file is a finding, escapes and all", () => within((s) => {
    plant(s, 'The harbourmaster\nburied the gold under the chapel');
    assert.deepEqual(gate(s).findings.map(pick), [{ code: 'HIDDEN_TEXT', page: 'props/state.js', note: 'Prep/Session 2.md' }]);
  }, { ...FILES(), 'Prep/Session 2.md': '---\ntype: session-prep\n---\nThe harbourmaster buried the gold under the chapel.\n' }, SETTINGS));

  it('a sealed title in the state file is not', () => within((s) => {
    assert.deepEqual(gate(s).findings, []);
    // The same title elsewhere is hidden text.
    leakInto(s.outputDir, 'library/atlas-of-the-coast.html', SEALED_TITLE);
    assert.deepEqual(gate(s).findings.map(pick), [{ code: 'HIDDEN_TEXT', page: 'library/atlas-of-the-coast.html', note: SEALED_NOTE }]);
  }, FILES(), SETTINGS));

  it("an item picture is the container's file: no finding", () => within((s) => {
    assert.ok(fs.existsSync(path.join(s.outputDir, 'props', 'covers', 'atlas.png')));
    assert.deepEqual(gate(s).findings, []);
  }, FILES(), SETTINGS));
});
