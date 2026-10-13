#!/usr/bin/env node
'use strict';
// Writes what lib/config.js resolves TODAY for every matrix case. Run once, before
// the settings package replaces the readers; the output is the equivalence test's truth.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { cases } = require('../test/helpers/settings-matrix');
const { loadPublishConfig } = require('../lib/config');
const { answer } = require('../lib/lines-cli');

const OUT = path.join(__dirname, '../test/fixtures/settings-golden.json');
const made = [];
process.on('exit', () => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

function snapshot(vaultPath, siteConfig) {
  const warnings = [];
  const realWarn = console.warn;
  // lib/config.js reports through its `warn` argument; anything that still reaches
  // console.warn is caught too, so nothing prints and nothing is missed.
  console.warn = (...a) => warnings.push(a.map(String).join(' '));
  let publishConfig = null;
  let threw = null;
  try {
    publishConfig = loadPublishConfig(vaultPath, siteConfig, (m) => warnings.push(String(m)));
  } catch (err) {
    threw = String(err.message);
  } finally {
    console.warn = realWarn;
  }
  // lines-cli's `site` operation reads the same file on its own; pin its answer too.
  let siteOp;
  try {
    siteOp = answer({ op: 'site', vault: vaultPath });
  } catch (err) {
    siteOp = { threw: String(err.message) };
  }
  // exclude_dirs entries are absolute-path sensitive; make them vault-relative text.
  return JSON.parse(JSON.stringify({ publishConfig, warnings, threw, siteOp }).split(vaultPath).join('<vault>'));
}

function vaultFor(c) {
  if (c.vaultPath) return c.vaultPath;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'golden-'));
  made.push(dir);
  fs.mkdirSync(path.join(dir, '_meta'), { recursive: true });
  if (c.rawFile !== undefined) {
    fs.writeFileSync(path.join(dir, '_meta', 'vault-config.md'), c.rawFile);
  } else if (c.publishYaml !== null) {
    const yaml = c.publishYaml.split('{{vault}}').join(dir);
    fs.writeFileSync(path.join(dir, '_meta', 'vault-config.md'), `---\ntype: meta\n${yaml}---\n`);
  }
  return dir;
}

if (require.main === module) {
  const golden = {};
  const all = cases();
  for (const c of all) golden[c.id] = snapshot(vaultFor(c), c.siteConfig || {});
  fs.writeFileSync(OUT, JSON.stringify(golden, null, 2) + '\n');
  console.log(`${all.length} cases written to ${OUT}`);
}
module.exports = { snapshot, vaultFor };
