'use strict';
// The tools' own bookkeeping: `_meta/vault-state.json` (name in layout.js). It holds the plugin
// version the vault was last updated to and the publish set-up note. Python writes the version
// here too, so a write reads what is there, changes only the keys given, and keeps the rest.
const fs = require('node:fs');
const path = require('node:path');
const { STATE_FILE, at } = require('./layout');

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// { gm_apprentice_version?, setup?, ...whatever else is there }; {} when there is no file.
function readState(vaultPath) {
  const file = at(vaultPath, STATE_FILE);
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw e;
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`${STATE_FILE} is not valid JSON: ${e.message}`);
  }
  if (!isObject(data)) throw new Error(`${STATE_FILE} is not valid JSON: expected an object`);
  return data;
}

// The file's text for a state object: the one way it is written.
const stateText = (state) => `${JSON.stringify(state, null, 2)}\n`;

// Shallow-merges `patch` into the file (a key set to null is removed) and writes it whole,
// atomically. Keys it does not know, and their order, stay; new keys go at the end.
function writeState(vaultPath, patch) {
  let stat = null;
  try { stat = fs.statSync(vaultPath); } catch { /* reported below */ }
  if (!stat || !stat.isDirectory()) throw new Error(`${vaultPath} is not a folder.`);
  const merged = { ...readState(vaultPath) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete merged[key];
    else merged[key] = value;
  }
  const file = at(vaultPath, STATE_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  try {
    fs.writeFileSync(tmp, stateText(merged));
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
  return merged;
}

module.exports = { readState, writeState, stateText };
