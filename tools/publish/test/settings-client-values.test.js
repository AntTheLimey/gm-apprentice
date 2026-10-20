'use strict';
// The page scripts in js/ are served as they are and cannot import the settings list, so
// the words a choice takes are written there too (#374). This ties them to the list: a value
// the list adds or drops, and the script does not follow, fails here.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { entry } = require('../lib/settings');

const script = (name) => fs.readFileSync(path.join(__dirname, '..', 'js', name), 'utf8');
// The words a script compares `variables` against (`mode === 'web'`, `how !== 'cards'`).
const comparedWith = (src, variables) => new Set(
  [...src.matchAll(new RegExp(`\\b(?:${variables.join('|')})\\s*[!=]==\\s*'([a-z_]+)'`, 'g'))].map((m) => m[1]),
);
// Every value a choice takes except the one that means the script is not on the page at all.
const drawn = (name) => entry(name).values.filter((v) => v !== 'off');

test('connections.js draws exactly the modes the list names', () => {
  const src = script('connections.js');
  const compared = comparedWith(src, ['mode', 'how', 'entry\\.how']);
  assert.ok(compared.size >= 2, 'the scan found no comparisons; it has stopped working');
  for (const word of compared) assert.ok(entry('player_site.features.connections').values.includes(word), `connections.js compares with '${word}', which is not a mode`);
  for (const word of drawn('player_site.features.connections')) assert.ok(src.includes(`'${word}'`), `connections.js never draws '${word}'`);
});

test('previews.js runs for exactly the modes the list names', () => {
  const src = script('previews.js');
  const compared = comparedWith(src, ['mode']);
  assert.deepEqual([...compared].sort(), drawn('player_site.features.link_previews').sort());
});
