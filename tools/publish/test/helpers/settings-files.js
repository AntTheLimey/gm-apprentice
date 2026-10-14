'use strict';
// Writes a vault's settings file for a test, in either layout, through the yaml library.
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const { NEW_FILE, OLD_FILE, at, layoutOf } = require('../../lib/settings/layout');
const { applyChanges } = require('../../lib/settings/write');
const { entry } = require('../../lib/settings');

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

// Sets settings by their names in a vault that is on the old file (made empty when the vault has none).
function setOldSettings(vaultPath, byName) {
  if (layoutOf(vaultPath) === 'none') writeOldConfig(vaultPath, {});
  return applyChanges(vaultPath, Object.entries(byName).map(([name, value]) => ({ op: 'set', name, value })));
}

// The values a build hands down when a vault sets nothing, read from the list (never restated here), for a test that
// calls a function directly: those functions are always given the value, they keep no default of their own.
const defaultWithheldWords = () => ({ person: entry('player_site.withheld_words.person').default, place: entry('player_site.withheld_words.place').default, thing: entry('player_site.withheld_words.thing').default });
const defaultRecapChars = () => entry('player_site.limits.recap_chars').default;

const defaultHeaderFacts = () => [...entry('player_site.sheets.header_facts').default];

// `pcTemplate` given the site's header facts as a build gives them (the page keeps no default of its own and
// throws without them). A test that wants other facts passes `publishConfig.header_facts` itself.
const pcTemplateWithSettings = (page, processed, sections, navFor, config, imageMap, storyHtml, context) => {
  const { pcTemplate } = require('../../lib/templates/pc');
  const given = context || {};
  return pcTemplate(page, processed, sections, navFor, config, imageMap, storyHtml,
    { ...given, publishConfig: { header_facts: defaultHeaderFacts(), ...(given.publishConfig || {}) } });
};

module.exports = { writeNewConfig, writeOldConfig, setOldSettings, defaultWithheldWords, defaultRecapChars, defaultHeaderFacts, pcTemplateWithSettings };
