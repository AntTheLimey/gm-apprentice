'use strict';
// vault.statuses.out_of_play, .fallen and .gone: the status words that were fixed in pc-status.js, story-spine.js
// and recency.js. With nothing set each gives the list the code held (checked below); each can be set, and the
// build reads the setting, not a list of its own.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { build } = require('../lib/build');
const { loadPublishConfig } = require('../lib/config');
const { entry } = require('../lib/settings');
const { writeNewConfig } = require('./helpers/settings-files');

const made = [];
process.on('exit', () => { for (const dir of made) fs.rmSync(dir, { recursive: true, force: true }); });
const tmp = (name) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), name)); made.push(d); return d; };

// What each list held before it was a setting.
const OLD = {
  out_of_play: ['dead', 'deceased', 'kia', 'retired', 'departed', 'missing', 'unknown', 'inactive', 'npc'],
  fallen: ['dead', 'deceased', 'kia', 'missing', 'unknown'],
  gone: ['dead', 'deceased', 'destroyed', 'kia', 'dissolved'],
};

// A vault on the new settings file; `statuses` is what goes under `vault: statuses:`.
function config(statuses) {
  const dir = tmp('statuses-config-');
  writeNewConfig(dir, { version: 1, vault: { statuses } });
  const warnings = [];
  const publishConfig = loadPublishConfig(dir, { vaultPath: dir }, (m) => warnings.push(m));
  return { publishConfig, warnings };
}
const words = (set) => [...set].sort();

test('nothing set: the lists are the old ones, plus destroyed and dissolved as out of play (the one intended difference)', () => {
  const { publishConfig, warnings } = config(undefined);
  assert.deepEqual(words(publishConfig.statuses.out_of_play), [...OLD.out_of_play, 'destroyed', 'dissolved'].sort());
  assert.deepEqual(words(publishConfig.statuses.fallen), [...OLD.fallen].sort());
  assert.deepEqual(words(publishConfig.statuses.gone), [...OLD.gone].sort());
  assert.deepEqual(warnings, []);
});

test('the registry holds the lists, and the "gone" list is the old recency list word for word', () => {
  assert.deepEqual(entry('vault.statuses.gone').default, OLD.gone);
  assert.deepEqual(entry('vault.statuses.fallen').default, OLD.fallen);
  for (const name of ['out_of_play', 'fallen', 'gone']) assert.equal(entry(`vault.statuses.${name}`).type, 'list');
});

test('a word is trimmed and lower-cased once; an empty list is allowed and means no status counts', () => {
  const { publishConfig, warnings } = config({ out_of_play: [' Dead ', 'KIA'], fallen: [' DEAD'], gone: [] });
  assert.deepEqual(words(publishConfig.statuses.out_of_play), ['dead', 'kia']);
  assert.deepEqual(words(publishConfig.statuses.fallen), ['dead']);
  assert.equal(publishConfig.statuses.gone.size, 0);
  assert.deepEqual(warnings, []);
  assert.equal(config({ out_of_play: [], fallen: [] }).warnings.length, 0);
});

test('a fallen word that is not out of play is one warning naming it, and does not count as fallen', () => {
  const { publishConfig, warnings } = config({ out_of_play: ['dead'], fallen: ['dead', 'Missing'] });
  assert.deepEqual(words(publishConfig.statuses.fallen), ['dead']);
  assert.equal(warnings.length, 1, warnings.join('\n'));
  assert.match(warnings[0], /vault\.statuses\.fallen/);
  assert.match(warnings[0], /missing/);
});

test('the lists are not listed with the settings, so the equivalence goldens stay as they were', () => {
  const { publishConfig } = config(undefined);
  assert.ok(!Object.keys(publishConfig).includes('statuses'));
});

// --- Pages ---

const note = (type, fm = '', body = 'Text.') => `---\ntype: ${type}\n${fm}---\n\n${body}\n`;

function build_(vault, settings) {
  const root = path.dirname(vault);
  fs.rmSync(path.join(vault, '_meta'), { recursive: true, force: true });
  writeNewConfig(vault, {
    version: 1,
    player_site: { hide: { mode: 'full' }, folder_map: { Characters: 'characters', 'Characters/PCs': 'characters/pcs', Sessions: 'sessions' } },
    ...settings,
  });
  const configPath = path.join(root, 'vault.config.json');
  fs.writeFileSync(configPath, JSON.stringify({ vaultPath: './vault' }));
  const warnings = [];
  const saved = { log: console.log, warn: console.warn };
  console.log = () => {};
  console.warn = (...a) => { warnings.push(a.join(' ')); };
  try { build({ configPath }); } finally { Object.assign(console, saved); }
  return { warnings, read: (...p) => fs.readFileSync(path.join(root, 'docs', ...p), 'utf8').replace(/\r\n/g, '\n') };
}

// The party-roster fixture: Karl Brenner (active) and Otto Weiss (retired), each with a GURPS sheet.
function rosterSite(statuses) {
  const root = tmp('statuses-site-');
  const vault = path.join(root, 'vault');
  fs.cpSync(path.join(__dirname, 'fixtures', 'with-party-roster'), vault, { recursive: true });
  return build_(vault, { vault: { system: 'gurps-4e', ...(statuses ? { statuses } : {}) } });
}
const teamZone = (html) => { const at = html.indexOf('<h2>The Team</h2>'); return at < 0 ? '' : html.slice(at, html.indexOf('</div>\n</div>', at)); };

test('nothing set: a retired PC is off the team and the party board', () => {
  const site = rosterSite(null);
  assert.match(teamZone(site.read('index.html')), /karl-brenner/);
  assert.doesNotMatch(teamZone(site.read('index.html')), /otto-weiss/);
  assert.doesNotMatch(site.read('characters', 'pcs', 'player-characters.html'), /otto-weiss/);
});

test('out_of_play set to [dead]: a retired PC is on the team and the party board', () => {
  const site = rosterSite({ out_of_play: ['dead'], fallen: [] });
  assert.match(teamZone(site.read('index.html')), /otto-weiss/);
  assert.match(site.read('characters', 'pcs', 'player-characters.html'), /otto-weiss/);
  assert.doesNotMatch(site.read('index.html'), /In Memoriam/);
});

test('a PC whose status is destroyed or dissolved is out of play with nothing set', () => {
  for (const status of ['destroyed', 'Dissolved']) {
    const root = tmp('statuses-pc-');
    const vault = path.join(root, 'vault');
    fs.cpSync(path.join(__dirname, 'fixtures', 'with-party-roster'), vault, { recursive: true });
    const file = path.join(vault, 'Characters', 'PCs', 'Karl Brenner.md');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^status:.*$/m, `status: ${status}`));
    const site = build_(vault, { vault: { system: 'gurps-4e' } });
    assert.doesNotMatch(teamZone(site.read('index.html')), /karl-brenner/, status);
    assert.match(site.read('index.html'), /In Memoriam[\s\S]*karl-brenner/, status);
    assert.doesNotMatch(site.read('index.html'), /Karl Brenner \(Active\)/, status);
  }
});

function npcSite(statuses) {
  const root = tmp('statuses-npc-');
  const vault = path.join(root, 'vault');
  const files = {
    'Characters/Hallam.md': note('npc', 'status: dead\n', '# Hallam'),
    'Characters/Brook.md': note('npc', 'status: alive\n', '# Brook'),
    'Sessions/Session 1.md': note('session', 'status: reviewed\nsession_number: 1\nplay_date: 2026-05-01\n', 'Long ago [[Hallam]] fell.'),
    'Sessions/Session 2.md': note('session', 'status: reviewed\nsession_number: 2\nplay_date: 2026-06-01\n', 'Now [[Brook]] arrives.'),
  };
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true });
    fs.writeFileSync(path.join(vault, rel), text);
  }
  return build_(vault, statuses ? { vault: { statuses } } : {});
}
const npcsInPlay = (html) => { const at = html.indexOf('<h2>NPCs in Play</h2>'); return at < 0 ? '' : html.slice(at); };

test('nothing set: a dead NPC last mentioned before the latest session is not in "NPCs in Play"', () => {
  const html = npcSite(null).read('index.html');
  assert.match(npcsInPlay(html), /Brook/);
  assert.doesNotMatch(npcsInPlay(html), /Hallam/);
});

test('gone set to []: a dead NPC stays in "NPCs in Play"', () => {
  const html = npcSite({ gone: [] }).read('index.html');
  assert.match(npcsInPlay(html), /Hallam/);
  assert.match(npcsInPlay(html), /Brook/);
});

test('fallen set to [retired]: no warning (retired is out of play), and the PC is still listed under Retired', () => {
  const root = tmp('statuses-story-');
  const vault = path.join(root, 'vault');
  const files = {
    'Characters/PCs/Quill.md': note('pc', 'status: Retired\n', '# Quill'),
    'Characters/PCs/Quill_Story.md': note('character-story', '', "Quill's tale."),
  };
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true });
    fs.writeFileSync(path.join(vault, rel), text);
  }
  const site = build_(vault, { vault: { statuses: { fallen: ['retired'] } } });
  assert.ok(!site.warnings.some((w) => /vault\.statuses/.test(w)), site.warnings.join('\n'));
  const story = site.read('story.html');
  assert.match(story, /<h3>Retired<\/h3><ul><li><a [^>]*>[^<]*Quill/);
  assert.doesNotMatch(story, /<h3>Fallen<\/h3>/);
});
