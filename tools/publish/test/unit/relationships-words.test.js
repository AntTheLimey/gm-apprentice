'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { words, wordsData } = require('../../lib/relationships/words');
const ontology = require('../../lib/ontology.json');

const BIN = path.join(__dirname, '..', '..', 'bin', 'gm-publish.js');

function vaultWith(text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rel-words-'));
  if (text !== null) {
    fs.mkdirSync(path.join(dir, '_meta'));
    fs.writeFileSync(path.join(dir, '_meta', 'relationship-types.md'), text);
  }
  return dir;
}

test('the full list is short and names every predicate', () => {
  const out = words();
  assert.ok(Buffer.byteLength(out) < 3000, `${Buffer.byteLength(out)} bytes`);
  assert.match(out, /^Relationship types \(77\)\./);
  for (const p of ontology.predicates) {
    assert.ok(new RegExp(`(^|[ ,:])${p.type}[>=]`, 'm').test(out), p.type);
  }
});

test('a symmetric kind ends in =, an asymmetric one shows its reverse', () => {
  const out = words();
  assert.match(out, /sibling_of=/);
  assert.match(out, /employs>employed_by/);
  assert.match(out, /parent_of>child_of/);
});

test('tones and strength close the printout', () => {
  const out = words();
  assert.match(out, /Tones: positive: positive, friendly/);
  assert.match(out, /\| negative: negative, hostile/);
  assert.match(out, /\| neutral: neutral, unknown/);
  assert.match(out, /Strength 1-10: 1-2 weak, 3-4 moderate, 5-6 significant, 7-8 strong, 9-10 defining \(5 when unknown\)/);
});

test('a vault that names fewer types gets only those, and unknown names are flagged', () => {
  const dir = vaultWith('# Relationship Types\n\n| Category | Types | Genre |\n|---|---|---|\n| Social | knows, frobs | universal |\n| Power | employs | universal |\n\n- `child_of` is the reverse of `parent_of`\n');
  const out = words({ vaultPath: dir });
  assert.match(out, /^Relationship types this vault uses \(3 of 77\)\./);
  assert.match(out, /^Not in the vocabulary: frobs$/m);
  assert.match(out, /employs>employed_by/);
  assert.match(out, /knows=/);
  assert.doesNotMatch(out, /sibling_of/);
  assert.doesNotMatch(out, /Not in the vocabulary.*(child_of|universal)/);
});

test('a file of prose is not read as a type list, and code spans in prose are ignored', () => {
  const prose = vaultWith('We mostly use located_at and knows; avoid working_for, use employs. Generic types like `associated_with` add nothing.\n');
  const out = words({ vaultPath: prose });
  assert.match(out, /^Relationship types \(77\)\./);
  assert.doesNotMatch(out, /Not in the vocabulary/);
  const mixed = vaultWith('Avoid `related_to` in prose.\n\n| Category | Types |\n|---|---|\n| Social | knows |\n');
  const m = words({ vaultPath: mixed });
  assert.match(m, /^Relationship types this vault uses \(1 of 77\)\./);
  assert.doesNotMatch(m, /Not in the vocabulary/);
});

test('a vault with no file, an empty folder, or every name gets the full list', () => {
  assert.match(words({ vaultPath: vaultWith(null) }), /^Relationship types \(77\)\./);
  assert.match(words({ vaultPath: path.join(os.tmpdir(), 'no-such-vault-xyz') }), /^Relationship types \(77\)\./);
  const all = vaultWith(ontology.predicates.map((p) => p.type).join(', ') + '\n');
  assert.match(words({ vaultPath: all }), /^Relationship types \(77\)\./);
});

test('a file naming every type and one stray still lists the stray', () => {
  const dir = vaultWith(ontology.predicates.map((p) => p.type).join(', ') + '\n\n- `frobs`\n');
  const out = words({ vaultPath: dir });
  assert.match(out, /^Relationship types \(77\)\./);
  assert.match(out, /^Not in the vocabulary: frobs$/m);
});

test('a file that is a directory is unreadable and gives the full list', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rel-words-'));
  fs.mkdirSync(path.join(dir, '_meta', 'relationship-types.md'), { recursive: true });
  assert.match(words({ vaultPath: dir }), /^Relationship types \(77\)\./);
});

test('--json gives 77 predicates, tones, strength and the names not in the vocabulary', () => {
  const r = spawnSync(process.execPath, [BIN, 'relationships', 'words', '--json'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  const data = JSON.parse(r.stdout);
  assert.strictEqual(data.subset, false);
  assert.strictEqual(data.predicates.length, 77);
  assert.deepStrictEqual(Object.keys(data.predicates[0]).sort(), ['category', 'inverse', 'symmetric', 'type']);
  assert.deepStrictEqual(Object.keys(data.tones), ['positive', 'negative', 'neutral']);
  assert.strictEqual(data.strength['9-10'], 'defining');
  assert.deepStrictEqual(data.notInVocabulary, []);
  assert.deepStrictEqual(wordsData().predicates.length, 77);
});

test('the command prints the text with --vault, and refuses an unknown verb', () => {
  const dir = vaultWith('knows, employs\n');
  const r = spawnSync(process.execPath, [BIN, 'relationships', 'words', '--vault', dir], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /this vault uses \(2 of 77\)/);
  const bad = spawnSync(process.execPath, [BIN, 'relationships', 'nope'], { encoding: 'utf8' });
  assert.strictEqual(bad.status, 1);
  assert.match(bad.stderr, /Unknown relationships command: nope/);
});

test('a bullet written as "- name: what it is" counts as named (#411 item 1)', () => {
  const dir = vaultWith('# Types\n\n- located_at: where it is\n- employs: pays someone\n- knows: has met\n');
  const out = words({ vaultPath: dir });
  assert.match(out, /^Relationship types this vault uses \(3 of 77\)\./);
  assert.match(out, /located_at>/);
  assert.doesNotMatch(out, /sibling_of/);
});

test('a one-column table lists its stray names (#411 item 2)', () => {
  const dir = vaultWith('| Type |\n|---|\n| knows |\n| employs |\n| frobs |\n');
  const data = wordsData({ vaultPath: dir });
  assert.deepStrictEqual(data.notInVocabulary, ['frobs']);
  assert.strictEqual(data.predicates.length, 2);
});

test('a lower-case header of a one-column table is not a stray type', () => {
  const dir = vaultWith('| types |\n|---|\n| knows |\n| employs |\n');
  assert.deepStrictEqual(wordsData({ vaultPath: dir }).notInVocabulary, []);
});
