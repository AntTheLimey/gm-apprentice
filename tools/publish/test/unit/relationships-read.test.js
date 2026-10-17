'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readVault } = require('../../lib/relationships/read');

function vault(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rel-read-'));
  for (const [rel, text] of Object.entries(files)) {
    const full = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
  }
  return dir;
}
const noteOf = (result, rel) => result.notes.find((n) => n.rel === rel);

const ALICE = [
  '---',
  'type: npc',
  'aliases: [Al]',
  'relationships:',
  '  - type: friend_of',
  '    target: "[[Bob]]"',
  '    bidirectional: true',
  '    strength: 3',
  '    tone: warm',
  '  - type: knows',
  '    target: "[[Bob|Bobby]]"',
  '---',
  'Body links [[Bob]] and [[Nobody#Part|x]] and ![[pic.png]].',
  '',
].join('\n');

test('a list-form edge gives its type, target and the lines of the file', () => {
  const dir = vault({ 'NPCs/Alice.md': ALICE, 'NPCs/Bob.md': '---\ntype: npc\n---\n' });
  const { notes, faults } = readVault(dir);
  assert.deepStrictEqual(faults, []);
  const alice = noteOf({ notes }, 'NPCs/Alice.md');
  assert.strictEqual(alice.name, 'Alice');
  assert.strictEqual(alice.type, 'npc');
  assert.deepStrictEqual(alice.aliases, ['Al']);
  assert.strictEqual(alice.edges.length, 2);
  const [first, second] = alice.edges;
  assert.deepStrictEqual(
    { index: first.index, line: first.line, typeLine: first.typeLine, type: first.type, target: first.target, targetRel: first.targetRel },
    { index: 0, line: 5, typeLine: 5, type: 'friend_of', target: 'Bob', targetRel: 'NPCs/Bob.md' },
  );
  assert.strictEqual(first.bidirectional, true);
  assert.strictEqual(first.strength, 3);
  assert.strictEqual(first.tone, 'warm');
  assert.strictEqual(first.mobrpg, false);
  assert.strictEqual(first.form, 'list');
  assert.strictEqual(second.index, 1);
  assert.strictEqual(second.typeLine, 10);
  assert.strictEqual(second.bidirectional, null);
  assert.strictEqual(second.tone, null);
  // the line the text says
  const lines = ALICE.split('\n');
  assert.match(lines[first.typeLine - 1], /type: friend_of/);
  assert.match(lines[second.typeLine - 1], /type: knows/);
});

test('body links are kept by name, embeds are not links', () => {
  const dir = vault({ 'Alice.md': ALICE });
  const alice = noteOf(readVault(dir), 'Alice.md');
  assert.deepStrictEqual(alice.links, ['Bob', 'Nobody']);
});

test('[[Name|Label]] and "[[Name]]" resolve to the same note, an alias too', () => {
  const dir = vault({
    'A.md': '---\ntype: npc\nrelationships:\n  - type: knows\n    target: "[[Bob|Bobby]]"\n  - type: knows\n    target: "[[Bob]]"\n  - type: knows\n    target: "[[Rob]]"\n  - type: knows\n    target: "[[Ghost]]"\n---\n',
    'Bob.md': '---\ntype: npc\naliases: [Rob]\n---\n',
  });
  const edges = noteOf(readVault(dir), 'A.md').edges;
  assert.deepStrictEqual(edges.map((e) => e.targetRel), ['Bob.md', 'Bob.md', 'Bob.md', null]);
  assert.deepStrictEqual(edges.map((e) => e.target), ['Bob', 'Bob', 'Rob', 'Ghost']);
});

test('a target is read as the site reads it: one link with words names it, two link names none', () => {
  const dir = vault({
    'A.md': '---\ntype: npc\nrelationships:\n  - type: knows\n    target: "[[B]] (briefly)"\n  - type: knows\n    target: "[[B]] and [[C]]"\n  - type: knows\n    target: Plain words\n  - type: knows\n---\n',
    'B.md': '---\ntype: npc\n---\n',
    'C.md': '---\ntype: npc\n---\n',
  });
  const [one, two, plain, none] = noteOf(readVault(dir), 'A.md').edges;
  assert.deepStrictEqual([one.target, one.targetRel, one.rawTarget], ['B', 'B.md', '[[B]] (briefly)']);
  assert.deepStrictEqual([two.target, two.targetRel, two.rawTarget], ['', null, '[[B]] and [[C]]']);
  assert.deepStrictEqual([plain.target, plain.targetRel], ['Plain words', null]);
  assert.deepStrictEqual([none.target, none.targetRel, none.rawTarget], ['', null, '']);
  // the same values through connections.js's own rule
  const { targetRef } = require('../../lib/connections');
  assert.strictEqual(targetRef(one.rawTarget).name, one.target);
  assert.strictEqual(targetRef(two.rawTarget).links, 2);
});

test('the map form is read, in its flattened order, with form map', () => {
  const dir = vault({
    'A.md': '---\ntype: npc\nrelationships:\n  ally: ["[[B]]", "[[C]]"]\n  enemy_of:\n    - "[[D]]"\n---\n',
    'B.md': '---\ntype: npc\n---\n',
  });
  const edges = noteOf(readVault(dir), 'A.md').edges;
  assert.deepStrictEqual(edges.map((e) => [e.index, e.type, e.target, e.form, e.line, e.typeLine]), [
    [0, 'ally', 'B', 'map', 4, 4],
    [1, 'ally', 'C', 'map', 4, 4],
    [2, 'enemy_of', 'D', 'map', 6, 5],
  ]);
  assert.strictEqual(edges[0].targetRel, 'B.md');
});

test('a CRLF note gives the same lines', () => {
  const dir = vault({ 'A.md': ALICE.replace(/\n/g, '\r\n'), 'B.md': ALICE });
  const crlf = noteOf(readVault(dir), 'A.md').edges.map((e) => [e.line, e.typeLine]);
  const lf = noteOf(readVault(dir), 'B.md').edges.map((e) => [e.line, e.typeLine]);
  assert.deepStrictEqual(crlf, lf);
  assert.deepStrictEqual(lf, [[5, 5], [10, 10]]);
});

test('comments in the block do not move the lines', () => {
  const dir = vault({ 'A.md': '---\ntype: npc\nrelationships:\n  # first\n  - type: knows # why\n    target: "[[B]]"\n---\n' });
  const e = noteOf(readVault(dir), 'A.md').edges[0];
  assert.strictEqual(e.typeLine, 5);
  assert.strictEqual(e.type, 'knows');
});

test('a mobrpg node predicate is read with mobrpg true, by its own index', () => {
  const dir = vault({
    'A.md': [
      '---', 'type: npc', 'relationships:', '  - type: knows', '    target: "[[B]]"',
      'mobrpg:', '  world_id: "w"', '  relationships:', '    - predicate: "friend_of"', '      target: "[[B]]"',
      '    - predicate: made_up', '      target: "[[B]]"', '---', '',
    ].join('\n'),
    'B.md': '---\ntype: npc\n---\n',
  });
  const edges = noteOf(readVault(dir), 'A.md').edges;
  assert.strictEqual(edges.length, 3);
  const mob = edges.filter((e) => e.mobrpg);
  assert.deepStrictEqual(mob.map((e) => [e.index, e.type, e.typeLine, e.targetRel]), [
    [0, 'friend_of', 9, 'B.md'],
    [1, 'made_up', 11, 'B.md'],
  ]);
  assert.strictEqual(edges[0].mobrpg, false);
});

test('a note whose frontmatter breaks is one fault, and the others are still read', () => {
  const dir = vault({
    'Broken.md': '---\ntype: npc\nname: "unterminated\nrelationships: [\n---\nbody\n',
    'Fine.md': ALICE,
    'Bob.md': '---\ntype: npc\n---\n',
  });
  const result = readVault(dir);
  assert.strictEqual(result.faults.length, 1);
  assert.strictEqual(result.faults[0].rel, 'Broken.md');
  assert.ok(result.faults[0].message.length > 0);
  assert.strictEqual(noteOf(result, 'Broken.md'), undefined);
  assert.strictEqual(noteOf(result, 'Fine.md').edges.length, 2);
  assert.strictEqual(noteOf(result, 'Fine.md').edges[0].targetRel, 'Bob.md');
});

test('parent_location and current_holder: one link gives a target, vague text does not', () => {
  const dir = vault({
    'Thides Station.md': '---\ntype: location\n---\n',
    'Deck.md': '---\ntype: location\nparent_location: "[[Thides Station|the station]]"\n---\n',
    'Vague.md': '---\ntype: location\nparent_location: "Somewhere vague"\n---\n',
    'Two.md': '---\ntype: location\nparent_location: "[[Thides Station]] and [[Deck]]"\n---\n',
    'Gone.md': '---\ntype: location\nparent_location: "[[Nowhere]]"\n---\n',
    'Item.md': '---\ntype: item\ncurrent_holder: "[[Deck]]"\n---\n',
    'None.md': '---\ntype: location\n---\n',
  });
  const r = readVault(dir);
  assert.deepStrictEqual(noteOf(r, 'Deck.md').fields.parent_location, { raw: '[[Thides Station|the station]]', target: 'Thides Station.md', line: 3 });
  assert.strictEqual(noteOf(r, 'Vague.md').fields.parent_location.target, null);
  assert.strictEqual(noteOf(r, 'Vague.md').fields.parent_location.raw, 'Somewhere vague');
  assert.strictEqual(noteOf(r, 'Two.md').fields.parent_location.target, null);
  assert.strictEqual(noteOf(r, 'Gone.md').fields.parent_location.target, null);
  assert.strictEqual(noteOf(r, 'Item.md').fields.current_holder.target, 'Deck.md');
  assert.deepStrictEqual(noteOf(r, 'None.md').fields, {});
});

test('--folder, --file and --newer-than select what is in scope; every note is still read', () => {
  const dir = vault({ 'NPCs/A.md': '---\ntype: npc\n---\n', 'Places/B.md': '---\ntype: location\n---\n', 'C.md': '---\ntype: npc\n---\n' });
  const scope = (opts) => readVault(dir, opts).notes.filter((n) => n.inScope).map((n) => n.rel).sort();
  assert.strictEqual(readVault(dir).notes.length, 3);
  assert.deepStrictEqual(scope({}), ['C.md', 'NPCs/A.md', 'Places/B.md']);
  assert.deepStrictEqual(scope({ folder: 'NPCs' }), ['NPCs/A.md']);
  assert.deepStrictEqual(scope({ folder: '/NPCs/' }), ['NPCs/A.md']);
  assert.deepStrictEqual(scope({ files: ['./Places/B.md', 'C.md'] }), ['C.md', 'Places/B.md']);
  assert.deepStrictEqual(scope({ files: ['Places\\B.md'], folder: 'NPCs' }), []);
  const old = new Date('2020-01-01T00:00:00Z');
  fs.utimesSync(path.join(dir, 'C.md'), old, old);
  const cutoff = Date.now() / 1000 - 3600;
  assert.deepStrictEqual(scope({ newerThan: cutoff }), ['NPCs/A.md', 'Places/B.md']);
  assert.deepStrictEqual(scope({ newerThan: cutoff, folder: 'NPCs' }), ['NPCs/A.md']);
});

test('hidden folders, templates, the inbox and non-markdown files are not notes', () => {
  const note = '---\ntype: npc\nrelationships:\n  - type: knows\n    target: "[[X]]"\n---\n';
  const dir = vault({
    'Real.md': note, '.obsidian/H.md': note, '_Templates/T.md': note, '_templates/T2.md': note,
    '_inbox/I.md': note, 'NPCs/_Templates/Deep.md': note, 'notes.txt': note, 'Upper.MD': note,
  });
  const rels = readVault(dir).notes.map((n) => n.rel).sort();
  assert.deepStrictEqual(rels, ['NPCs/_Templates/Deep.md', 'Real.md']);
});

test('a note with no frontmatter, or none that is a map, is read with no edges', () => {
  const dir = vault({ 'Plain.md': 'just text [[Real]]\n', 'List.md': '---\n- a\n- b\n---\n', 'Real.md': '---\ntype: npc\n---\n' });
  const r = readVault(dir);
  assert.deepStrictEqual(r.faults, []);
  assert.deepStrictEqual(noteOf(r, 'Plain.md').edges, []);
  assert.deepStrictEqual(noteOf(r, 'Plain.md').links, ['Real']);
  assert.strictEqual(noteOf(r, 'Plain.md').type, '');
  assert.deepStrictEqual(noteOf(r, 'List.md').edges, []);
});

test('points_of_interest links are the note\'s links', () => {
  const dir = vault({ 'L.md': '---\ntype: location\npoints_of_interest:\n  - "[[Well]]"\n  - Tavern\n---\nSee [[Road]].\n' });
  assert.deepStrictEqual(noteOf(readVault(dir), 'L.md').links.sort(), ['Road', 'Well']);
});
