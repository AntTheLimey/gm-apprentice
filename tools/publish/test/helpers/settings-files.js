'use strict';
// Writes a vault's settings file for a test, in either layout, through the yaml library.
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const { NEW_FILE, OLD_FILE, at } = require('../../lib/settings/layout');

function put(vaultPath, rel, text) {
  const file = at(vaultPath, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}

// The new file: `settings` is an object (written as YAML) or the file's text as it should be written.
function writeNewConfig(vaultPath, settings) {
  return put(vaultPath, NEW_FILE, typeof settings === 'string' ? settings : YAML.stringify(settings));
}

// The old file: `publishObject` goes under `publish:`, `top` is written beside it.
function writeOldConfig(vaultPath, publishObject, top = {}) {
  const data = { type: 'meta', ...top, publish: publishObject };
  return put(vaultPath, OLD_FILE, `---\n${YAML.stringify(data)}---\n`);
}

module.exports = { writeNewConfig, writeOldConfig };
