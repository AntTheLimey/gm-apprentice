const { test } = require('node:test');
const assert = require('node:assert');
const lm = require('../lib/templates/live-mount');

test('clientFor maps GURPS and CoC system ids to their clients', () => {
  assert.deepEqual(lm.clientFor('gurps-4e'), { script: 'gurps-live.js', domId: 'gurps-live-data' });
  assert.deepEqual(lm.clientFor('gurps'), { script: 'gurps-live.js', domId: 'gurps-live-data' });
  assert.deepEqual(lm.clientFor('coc-7e'), { script: 'coc-live.js', domId: 'coc-live-data' });
  assert.deepEqual(lm.clientFor('regency-cthulhu'), { script: 'coc-live.js', domId: 'coc-live-data' });
});

test('clientFor is case-insensitive and null for unknown systems', () => {
  assert.deepEqual(lm.clientFor('CoC-7e'), { script: 'coc-live.js', domId: 'coc-live-data' });
  assert.equal(lm.clientFor('dnd-5e'), null);
  assert.equal(lm.clientFor(null), null);
});

test('liveScriptHrefs orders live-state before the system client', () => {
  assert.deepEqual(lm.liveScriptHrefs('../', 'coc-7e'), ['../js/live-state.js', '../js/coc-live.js']);
});

test('liveScriptHrefs is empty for a system without a live client', () => {
  assert.deepEqual(lm.liveScriptHrefs('../', 'dnd-5e'), []);
});
