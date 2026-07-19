const { test } = require('node:test');
const assert = require('node:assert');
const { boardFor } = require('../lib/party-board-registry');
const { buildPartyManifest } = require('../lib/party-manifest');
const { buildCoCPartyManifest } = require('../lib/templates/coc/party-board');

test('boardFor maps GURPS aliases to the GURPS skin', () => {
  for (const s of ['gurps', 'gurps-4e', 'GURPS-4e']) {
    const b = boardFor(s);
    assert.equal(b.scriptId, 'gurps-party-data');
    assert.deepEqual(b.clientScripts, ['party-core.js', 'gurps-live.js', 'gurps-party.js']);
    assert.equal(b.buildManifest, buildPartyManifest);
  }
});

test('boardFor maps CoC / Regency aliases to the CoC skin', () => {
  for (const s of ['coc', 'coc-7e', 'regency-cthulhu']) {
    const b = boardFor(s);
    assert.equal(b.scriptId, 'coc-party-data');
    assert.deepEqual(b.clientScripts, ['party-core.js', 'coc-party.js']);
    assert.equal(b.buildManifest, buildCoCPartyManifest);
  }
});

test('boardFor returns null for unknown/absent systems', () => {
  assert.equal(boardFor('dnd-5e-2024'), null);
  assert.equal(boardFor(null), null);
  assert.equal(boardFor(undefined), null);
});
