'use strict';
// A hostile tie the GM reviewed and left (#367): a record in the publish list's `accepted` list, tied to its note and to
// the tie's tone, target and description. `relationships list` marks such a tie `accepted`; `relationships accept`
// records them; the leak gate leaves the records alone.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const YAML = require('yaml');

const BIN = path.join(__dirname, '..', '..', 'bin', 'gm-publish.js');
const NOTE = `---
type: npc
relationships:
  - target: "[[Hallam]]"
    type: rival_of
    tone: hostile
    description: Wants his chair.
  - target: "[[Mara]]"
    type: knows
    tone: warm
---
Body.
`;

function vault(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acc-ties-'));
  for (const [rel, text] of Object.entries(files)) {
    const full = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
  }
  return dir;
}
const cli = (dir, ...args) => spawnSync(process.execPath, [BIN, 'relationships', ...args, '--vault', dir], { encoding: 'utf8' });
const listing = (dir) => JSON.parse(cli(dir, 'list', '--json').stdout).tones;
const listFile = (dir) => path.join(dir, '_meta', 'publish-list.yaml');

test('a tie nobody accepted lists as not accepted', () => {
  const dir = vault({ 'NPCs/E.md': NOTE });
  assert.deepStrictEqual(listing(dir).map((r) => r.accepted), [false, false]);
});

test('accept without --write previews and writes nothing', () => {
  const dir = vault({ 'NPCs/E.md': NOTE });
  const out = JSON.parse(cli(dir, 'accept', '--at', 'NPCs/E.md:6', '--json').stdout);
  assert.deepStrictEqual([out.written, out.recorded, out.already], [false, 1, 0]);
  assert.strictEqual(fs.existsSync(listFile(dir)), false);
});

test('accept --write records the tie and list then marks it accepted', () => {
  const dir = vault({ 'NPCs/E.md': NOTE });
  const out = JSON.parse(cli(dir, 'accept', '--at', 'NPCs/E.md:6', '--write', '--json').stdout);
  assert.deepStrictEqual([out.written, out.recorded], [true, 1]);
  const doc = YAML.parse(fs.readFileSync(listFile(dir), 'utf8'));
  assert.strictEqual(doc.accepted.length, 1);
  assert.strictEqual(doc.accepted[0].page, 'NPCs/E.md');
  assert.strictEqual(doc.accepted[0].note, 'tone.tie');
  assert.deepStrictEqual(listing(dir).map((r) => r.accepted), [true, false]);
  // Again: nothing new is written.
  const again = JSON.parse(cli(dir, 'accept', '--at', 'NPCs/E.md:6', '--write', '--json').stdout);
  assert.deepStrictEqual([again.recorded, again.already], [0, 1]);
  assert.strictEqual(YAML.parse(fs.readFileSync(listFile(dir), 'utf8')).accepted.length, 1);
});

test('the record follows the tie, not its line, and stops counting when the tie changes', () => {
  const dir = vault({ 'NPCs/E.md': NOTE });
  cli(dir, 'accept', '--at', 'NPCs/E.md:6', '--write');
  // The line moves: still accepted.
  fs.writeFileSync(path.join(dir, 'NPCs/E.md'), NOTE.replace('type: npc\n', 'type: npc\naliases: [Em]\n'));
  assert.deepStrictEqual(listing(dir).map((r) => [r.line, r.accepted]), [[7, true], [11, false]]);
  // The description changes: raised again.
  fs.writeFileSync(path.join(dir, 'NPCs/E.md'), NOTE.replace('Wants his chair.', 'Wants his chair and his name.'));
  assert.strictEqual(listing(dir)[0].accepted, false);
  // The tone changes: raised again.
  fs.writeFileSync(path.join(dir, 'NPCs/E.md'), NOTE.replace('tone: hostile', 'tone: cold'));
  assert.strictEqual(listing(dir)[0].accepted, false);
  // The target changes: raised again.
  fs.writeFileSync(path.join(dir, 'NPCs/E.md'), NOTE.replace('[[Hallam]]', '[[Tom]]'));
  assert.strictEqual(listing(dir)[0].accepted, false);
  // Whitespace and quoting in the description are not a change.
  fs.writeFileSync(path.join(dir, 'NPCs/E.md'), NOTE.replace('description: Wants his chair.', 'description: "Wants   his\n      chair."'));
  assert.strictEqual(listing(dir)[0].accepted, true);
});

test('the same tie on another note is not accepted by the first note\'s record', () => {
  const dir = vault({ 'NPCs/E.md': NOTE, 'NPCs/F.md': NOTE });
  cli(dir, 'accept', '--at', 'NPCs/E.md:6', '--write');
  assert.deepStrictEqual(listing(dir).map((r) => [r.rel, r.accepted]), [['NPCs/E.md', true], ['NPCs/E.md', false], ['NPCs/F.md', false], ['NPCs/F.md', false]]);
});

test('accept keeps the publish list\'s other lists and the leak gate\'s own records', () => {
  const dir = vault({ 'NPCs/E.md': NOTE, '_meta/publish-list.yaml': 'publishing:\n  - NPCs/E.md\nexcluded: []\nneeds_decision: []\naccepted:\n  - page: index.html\n    text: some sentence\n    note: Secret\n' });
  cli(dir, 'accept', '--at', 'NPCs/E.md:6', '--write');
  const doc = YAML.parse(fs.readFileSync(listFile(dir), 'utf8'));
  assert.deepStrictEqual(doc.publishing, ['NPCs/E.md']);
  assert.deepStrictEqual(doc.accepted.map((a) => a.note).sort(), ['Secret', 'tone.tie']);
});

test('accept refuses a place that is not a tie, and writes nothing', () => {
  const dir = vault({ 'NPCs/E.md': NOTE });
  const run = cli(dir, 'accept', '--at', 'NPCs/E.md:6', '--at', 'NPCs/E.md:99', '--write');
  assert.strictEqual(run.status, 1);
  assert.match(run.stderr, /NPCs\/E\.md:99/);
  assert.strictEqual(fs.existsSync(listFile(dir)), false);
  assert.strictEqual(cli(dir, 'accept', '--write').status, 1);
});

test('only a record marked tone.tie is a tie record', () => {
  const { isAcceptedTie } = require('../../lib/accepted-ties');
  assert.strictEqual(isAcceptedTie({ page: 'A.md', text: 'x', note: 'tone.tie' }), true);
  assert.strictEqual(isAcceptedTie({ page: 'A.md', text: 'x', note: 'gm-leak.heading' }), false);
  assert.strictEqual(isAcceptedTie({ page: 'A.md', text: 'x', note: '' }), false);
});

test('a tie with no description is accepted too (the list reader trims a record)', () => {
  const dir = vault({ 'NPCs/E.md': NOTE.replace('tone: warm', 'tone: cold') });
  cli(dir, 'accept', '--at', 'NPCs/E.md:10', '--write');
  assert.deepStrictEqual(listing(dir).map((r) => r.accepted), [false, true]);
});

test('accept --write refuses a site whose tool is older than the one that reads the record, and writes nothing', () => {
  const dir = vault({ 'NPCs/E.md': NOTE });
  const site = vault({ 'vault.config.json': '{}', 'node_modules/gm-apprentice-publish/package.json': '{"version":"1.42.0"}' });
  const r = cli(dir, 'accept', '--at', 'NPCs/E.md:6', '--write', '--config', path.join(site, 'vault.config.json'));
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, /1\.42\.0.*needs 1\.43\.0/);
  assert.strictEqual(fs.existsSync(listFile(dir)), false);
  fs.writeFileSync(path.join(site, 'node_modules', 'gm-apprentice-publish', 'package.json'), '{"version":"1.43.0"}');
  const ok = cli(dir, 'accept', '--at', 'NPCs/E.md:6', '--write', '--config', path.join(site, 'vault.config.json'));
  assert.strictEqual(ok.status, 0, ok.stderr);
  assert.strictEqual(fs.existsSync(listFile(dir)), true);
});
