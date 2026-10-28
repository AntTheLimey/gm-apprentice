'use strict';
// #535: a host that embeds the settings move (GM-Scriptorium) always answers the pin question itself
// (deps.pinCheck), so loading the move must not load child_process; and the rule for which site-file keys the move
// takes out is exported, so the host does not keep a copy of it.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const MOVE = path.join(__dirname, '..', 'lib', 'settings', 'move.js');

test('requiring the settings move does not load child_process', () => {
  // A fresh process: watch every module load, then require the move.
  const probe = `
    const Module = require('node:module');
    const seen = [];
    const load = Module._load;
    Module._load = function (request, ...rest) { if (/(^|:)child_process$/.test(request)) seen.push(request); return load.call(this, request, ...rest); };
    const move = require(${JSON.stringify(MOVE)});
    if (typeof move.planMove !== 'function') throw new Error('no planMove');
    process.stdout.write(JSON.stringify(seen));
  `;
  const run = spawnSync(process.execPath, ['-e', probe], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), []);
});

test('stripSiteKeys and movedSiteKeys are exported and name the keys the move takes out', () => {
  const { stripSiteKeys, movedSiteKeys } = require('../lib/settings/move');
  assert.equal(typeof stripSiteKeys, 'function');
  const site = { siteTitle: 'The Lantern Coast', footer: 'Made at the table', vaultPath: '../Vault', somethingElse: 1 };
  const { siteAfter, siteOut, removedKeys } = stripSiteKeys(JSON.stringify(site, null, 2));
  assert.deepEqual(removedKeys.sort(), ['footer', 'siteTitle']);
  assert.equal(siteAfter.siteTitle, undefined);
  assert.equal(siteAfter.somethingElse, 1);
  assert.equal(typeof siteOut, 'string');
  // The small form: an object (or the file's text) in, the names out, the input untouched.
  assert.deepEqual(movedSiteKeys(site).sort(), ['footer', 'siteTitle']);
  assert.equal(site.siteTitle, 'The Lantern Coast');
  assert.deepEqual(movedSiteKeys(JSON.stringify(site)).sort(), ['footer', 'siteTitle']);
  assert.deepEqual(movedSiteKeys({ somethingElse: 1 }), []);
});
