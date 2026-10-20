'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { relCli } = require('../helpers/relationships-cli');
const { readVault } = require('../../lib/relationships/read');
const { check, render } = require('../../lib/relationships/check');
const ontology = require('../../lib/ontology.json');

const BIN = path.join(__dirname, '..', '..', 'bin', 'gm-publish.js');

// A vault from { 'Folder/Note.md': text }.
function vault(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rel-check-'));
  for (const [rel, text] of Object.entries(files)) {
    const full = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
  }
  return dir;
}

// A note: its frontmatter lines (type first) and an optional body.
function note(type, lines = [], body = '') {
  return `---\ntype: ${type}\n${lines.join('\n')}${lines.length ? '\n' : ''}---\n${body}`;
}

// A list-form edge as frontmatter lines.
function edge(type, target, more = []) {
  return [`  - target: "[[${target}]]"`, `    type: ${type}`, ...more.map((m) => `    ${m}`)];
}
const rels = (...edges) => ['relationships:', ...edges.flat()];

const rowsOf = (dir, opts) => check(readVault(dir, opts), ontology, { vaultPath: dir }).map((f) => `${f.level}\t${f.rel}:${f.line}\t${f.message}`);
const ofKind = (dir, kind) => findings(dir).filter((f) => f.kind === kind).map((f) => `${f.level}\t${f.rel}:${f.line}\t${f.message}`);
const findings = (dir, opts) => check(readVault(dir, opts), ontology, { vaultPath: dir });
const target = (name, type = 'npc') => [`${name}.md`, note(type)];

// The tail added to a predicate row, as vault_check.py has always printed it.
const MAP = ' (map it via shared/relationship-normalization.md)';

test('a vault clean of every kind gives # count: 0', () => {
  const dir = vault({
    'A.md': note('npc', rels(edge('knows', 'B', ['bidirectional: true']), edge('employs', 'B', ['strength: 7', 'tone: warm']))),
    'B.md': note('npc'),
  });
  assert.strictEqual(render(findings(dir)), '# count: 0');
});

test('an inverse name is the old inverse row, byte for byte, and its fix is certain', () => {
  const dir = vault({ 'A.md': note('npc', rels(edge('employed_by', 'B'))), ...Object.fromEntries([target('B')]) });
  assert.deepStrictEqual(rowsOf(dir), [
    `ERROR\tA.md:5\toff-vocabulary relationship type 'employed_by' — inverse of 'employs'; storage is single-direction, so record 'employs' on the other endpoint${MAP}`,
  ]);
  const [f] = findings(dir);
  assert.deepStrictEqual([f.kind, f.fix, f.edgeIndex, f.form, f.mobrpg], ['off-vocabulary', { certain: true, choices: ['employs'], flip: true }, 0, 'list', false]);
});

test('visited_by stands as written: no finding, no flip (#368)', () => {
  for (const spelling of ['Visited_By', 'visited by', 'visited-by']) {
    const d = vault({ 'A.md': note('location', rels(edge(spelling, 'B'))), ...Object.fromEntries([target('B')]) });
    assert.deepStrictEqual(findings(d), [], spelling);
  }
  const dir = vault({ 'A.md': note('location', rels(edge('visited_by', 'B'))), ...Object.fromEntries([target('B')]) });
  assert.deepStrictEqual(findings(dir), []);
});

test('a verb with one meaning says what it means, and says when to store it on the other note', () => {
  const dir = vault({
    'A.md': note('npc', rels(edge('works_for', 'B'), edge('located_in', 'B'))),
    ...Object.fromEntries([target('B')]),
  });
  assert.deepStrictEqual(rowsOf(dir), [
    "ERROR\tA.md:5\toff-vocabulary relationship type 'works_for' — means 'employs'; store it on the other note",
    "ERROR\tA.md:7\toff-vocabulary relationship type 'located_in' — means 'located_at'",
  ]);
  const fixes = findings(dir).map((f) => f.fix);
  assert.deepStrictEqual(fixes, [{ certain: true, choices: ['employs'], flip: true }, { certain: true, choices: ['located_at'], flip: false }]);
});

test('a verb with several meanings lists them and asks; a log reference is dropped on a yes', () => {
  const dir = vault({
    'A.md': note('npc', rels(edge('carries', 'B'), edge('affiliated_with', 'B'), edge('questioned', 'B'))),
    ...Object.fromEntries([target('B')]),
  });
  assert.deepStrictEqual(rowsOf(dir), [
    "ERROR\tA.md:5\toff-vocabulary relationship type 'carries' — one of: owns, wields",
    "ERROR\tA.md:7\toff-vocabulary relationship type 'affiliated_with' — one of: member_of, allied_with",
    "ERROR\tA.md:9\toff-vocabulary relationship type 'questioned' — a log reference, not a graph edge; drop it",
  ]);
  assert.deepStrictEqual(findings(dir).map((f) => f.fix), [
    { certain: false, choices: ['owns', 'wields'] },
    { certain: false, choices: ['member_of', 'allied_with'] },
    { certain: false, choices: [] },
  ]);
});

// The near names are difflib.get_close_matches(word, sorted(vocabulary), n=3) of Python, same order and cut-off.
test('an unlisted name gets the old suggestions, in the old order (tests/test_relationship_predicates.py)', () => {
  const cases = [
    ['commands_at', 'did you mean commands?'],
    ['frobnicate', 'no close match'],
    ['Member_Of', 'did you mean member_of?'],
    ['leader_of', 'did you mean member_of, part_of, uploaded_to?'],
    ['hatess', 'did you mean haunts?'],
    ['protects_from', 'did you mean defected_from?'],
  ];
  const dir = vault({
    'A.md': note('npc', rels(...cases.map(([type]) => edge(type, 'B')))),
    ...Object.fromEntries([target('B')]),
  });
  const got = rowsOf(dir);
  cases.forEach(([type, tail], i) => {
    assert.strictEqual(got[i], `ERROR\tA.md:${5 + i * 2}\toff-vocabulary relationship type '${type}' — ${tail}${MAP}`);
  });
  assert.deepStrictEqual(findings(dir)[3].fix, { certain: false, choices: ['member_of', 'part_of', 'uploaded_to'] });
});

test('a blank type is named as blank, and the mobrpg node says predicate', () => {
  const dir = vault({
    'A.md': note('npc', [...rels(edge('""', 'B')), 'mobrpg:', '  relationships:', '    - predicate: imprisoned_by', '      target: "[[B]]"']),
    ...Object.fromEntries([target('B')]),
  });
  assert.deepStrictEqual(rowsOf(dir), [
    `ERROR\tA.md:5\tblank relationship type — every edge needs a sanctioned predicate${MAP}`,
    `ERROR\tA.md:8\toff-vocabulary relationship predicate 'imprisoned_by' — inverse of 'imprisons'; storage is single-direction, so record 'imprisons' on the other endpoint${MAP}`,
  ]);
  assert.strictEqual(findings(dir)[1].fix, null, 'a machine-managed edge is never fixed');
  assert.strictEqual(findings(dir)[1].mobrpg, true);
});

test('tone rows are the old tone rows, byte for byte (tests/test_tones.py), with no fix here', () => {
  const dir = vault({
    'NPCs/A.md': note('npc', rels(
      edge('knows', 'B', ['bidirectional: true', 'tone: dread']),
      edge('knows', 'C', ['bidirectional: true', 'tone: central']),
      edge('knows', 'D', ['bidirectional: true', 'tone: warm']),
      edge('knows', 'E', ['bidirectional: true', 'tone: "Friendly "']),
    )),
    ...Object.fromEntries(['B', 'C', 'D', 'E'].map((n) => target(n))),
  });
  assert.deepStrictEqual(rowsOf(dir), [
    "WARNING\tNPCs/A.md:7\ttone 'dread' is off the list; use 'ominous'",
    "WARNING\tNPCs/A.md:11\ttone 'central' is off the list; pick a listed tone (shared/entity-schema.md, Tones)",
    "WARNING\tNPCs/A.md:19\ttone 'Friendly ' is off the list; use 'friendly'",
  ]);
  assert.deepStrictEqual(findings(dir).map((f) => [f.kind, f.fix, f.edgeIndex]), [['tone', null, 0], ['tone', null, 1], ['tone', null, 3]]);
});

test('a symmetric tie on both notes is reported on the second note by rel order', () => {
  const dir = vault({
    'A.md': note('npc', rels(edge('knows', 'B', ['bidirectional: true']))),
    'B.md': note('npc', rels(edge('knows', 'A', ['bidirectional: true']))),
  });
  assert.deepStrictEqual(rowsOf(dir), ["WARNING\tB.md:4\t'knows' with A is stored on both notes; keep one"]);
  const [f] = findings(dir);
  assert.deepStrictEqual([f.kind, f.fix, f.edgeIndex, f.form, f.mobrpg], ['mirrored', { certain: true }, 0, 'list', false]);
});

test('a one-way tie written on both notes is a question, not a fix; a tie and its inverse, or two different ties, are not', () => {
  const dir = vault({
    'A.md': note('faction', rels(edge('member_of', 'B'))),
    'B.md': note('faction', rels(edge('member_of', 'A'))),
  });
  assert.deepStrictEqual(rowsOf(dir), ["WARNING\tB.md:4\t'member_of' with A is written on both notes, each saying the other way round: which one is right?"]);
  const [f] = findings(dir);
  assert.deepStrictEqual([f.kind, f.fix], ['opposed', { certain: false }]);
  const fine = vault({
    'C.md': note('npc', rels(edge('member_of', 'D'))),
    'D.md': note('faction', rels(edge('has_member', 'C'))),
    'E.md': note('npc', rels(edge('member_of', 'F'))),
    'F.md': note('faction', rels(edge('allied_with', 'E', ['bidirectional: true']))),
  });
  assert.deepStrictEqual(ofKind(fine, 'opposed'), []);
});

test('a mirrored edge whose other half is outside the folder is still found and reported on the in-scope note', () => {
  const files = {
    'NPCs/A.md': note('npc', rels(edge('knows', 'B', ['bidirectional: true']))),
    'Places/B.md': note('npc', rels(edge('knows', 'A', ['bidirectional: true']))),
  };
  // The second note by rel order (Places/B.md) is out of scope: the in-scope first note carries the row.
  assert.deepStrictEqual(rowsOf(vault(files), { folder: 'NPCs' }), ["WARNING\tNPCs/A.md:4\t'knows' with B is stored on both notes; keep one"]);
  assert.deepStrictEqual(rowsOf(vault(files), { folder: 'Places' }), ["WARNING\tPlaces/B.md:4\t'knows' with A is stored on both notes; keep one"]);
});

test('--folder reports only in-scope notes; --file and --newer-than scope the same way', () => {
  const files = {
    'NPCs/A.md': note('npc', rels(edge('works_foo', 'B'))),
    'Places/C.md': note('location', rels(edge('works_foo', 'B'))),
    ...Object.fromEntries([target('B')]),
  };
  const dir = vault(files);
  assert.deepStrictEqual(rowsOf(dir, { folder: 'Places' }).map((r) => r.split('\t')[1]), ['Places/C.md:5']);
  assert.deepStrictEqual(rowsOf(dir, { files: ['./NPCs/A.md'] }).map((r) => r.split('\t')[1]), ['NPCs/A.md:5']);
  assert.deepStrictEqual(rowsOf(dir, { newerThan: Date.now() / 1000 + 100 }), []);
});

test('the same fact from both ends: serves here and employs on the other note', () => {
  const dir = vault({
    'A.md': note('npc', rels(edge('serves', 'B'))),
    'B.md': note('npc', rels(edge('employs', 'A'))),
  });
  assert.deepStrictEqual(rowsOf(dir), ["WARNING\tA.md:4\t'serves' B here and 'employs' this note on B state one fact; keep one"]);
  assert.deepStrictEqual(findings(dir)[0].fix, { certain: false });
  // Only the 'employs' note in scope: the row moves to it, worded from its side.
  assert.deepStrictEqual(rowsOf(dir, { files: ['B.md'] }), ["WARNING\tB.md:4\t'employs' A here and 'serves' this note on A state one fact; keep one"]);
});

test('bidirectional: two-way set, one-way remove, both certain', () => {
  const dir = vault({
    'A.md': note('npc', rels(edge('knows', 'B'), edge('employs', 'B', ['bidirectional: true']), edge('knows', 'B', ['bidirectional: false']))),
    ...Object.fromEntries([target('B')]),
  });
  assert.deepStrictEqual(rowsOf(dir), [
    "WARNING\tA.md:4\t'knows' is two-way: set bidirectional: true",
    "WARNING\tA.md:6\t'employs' is one-way: remove bidirectional: true",
    "WARNING\tA.md:9\t'knows' is two-way: set bidirectional: true",
  ]);
  assert.deepStrictEqual(findings(dir).map((f) => f.fix), [{ certain: true }, { certain: true }, { certain: true }]);
});

test('strength must be a whole number from 1 to 10', () => {
  const dir = vault({
    'A.md': note('npc', rels(
      edge('employs', 'B', ['strength: 11']),
      edge('employs', 'B', ['strength: 0']),
      edge('employs', 'B', ['strength: 3.5']),
      edge('employs', 'B', ['strength: strong']),
      edge('employs', 'B', ['strength: 1']),
      edge('employs', 'B', ['strength: 10']),
    )),
    ...Object.fromEntries([target('B')]),
  });
  assert.deepStrictEqual(rowsOf(dir), [
    "WARNING\tA.md:6\tstrength '11' is not a whole number from 1 to 10",
    "WARNING\tA.md:9\tstrength '0' is not a whole number from 1 to 10",
    "WARNING\tA.md:12\tstrength '3.5' is not a whole number from 1 to 10",
    "WARNING\tA.md:15\tstrength 'strong' is not a whole number from 1 to 10",
  ]);
  assert.deepStrictEqual(findings(dir)[0].fix, { certain: false });
});

test('parent_location without the part_of tie, and the tie without the field (locations only)', () => {
  const dir = vault({
    'Places/Room.md': note('location', ['parent_location: "[[Hall]]"']),
    'Places/Hall.md': note('location'),
    'Places/Cellar.md': note('location', rels(edge('part_of', 'Hall'))),
    'Orgs/Cell.md': note('faction', rels(edge('part_of', 'Hall'))),
  });
  assert.deepStrictEqual(rowsOf(dir), [
    'WARNING\tPlaces/Cellar.md:4\tpart_of [[Hall]] but no parent_location',
    'WARNING\tPlaces/Room.md:3\tparent_location names [[Hall]] but there is no part_of tie to it',
  ]);
  const byKind = Object.fromEntries(findings(dir).map((f) => [f.kind, f]));
  assert.deepStrictEqual(byKind['place-missing-field'].fix, { certain: true, choices: ['Hall'] });
  assert.deepStrictEqual(byKind['place-missing-tie'].fix, { certain: true, choices: ['Hall'] });
  assert.strictEqual(byKind['place-missing-field'].edgeIndex, 0);
  assert.strictEqual(byKind['place-missing-tie'].edgeIndex, null);
});

test('parent_location and part_of naming different places is asked, not fixed', () => {
  const dir = vault({
    'Room.md': note('location', ['parent_location: "[[Hall]]"', ...rels(edge('part_of', 'Tower'))]),
    'Hall.md': note('location'),
    'Tower.md': note('location'),
  });
  assert.deepStrictEqual(rowsOf(dir), ['WARNING\tRoom.md:3\tparent_location names [[Hall]] but part_of names [[Tower]]']);
  assert.deepStrictEqual(findings(dir)[0].fix, { certain: false });
});

test('a field that is not exactly one link is never paired; territory is never paired', () => {
  const dir = vault({
    'Room.md': note('location', ['parent_location: "[[Hall]] and [[Tower]]"']),
    'Fort.md': note('faction', ['territory: "[[Hall]]"']),
    'Hall.md': note('location'),
    'Tower.md': note('location'),
  });
  assert.deepStrictEqual(rowsOf(dir), []);
});

test('current_holder wants an owns tie on the holder, which names this note', () => {
  const dir = vault({
    'Sword.md': note('item', ['current_holder: "[[Ann]]"']),
    'Ann.md': note('npc'),
    'Axe.md': note('item', ['current_holder: "[[Bob]]"']),
    'Bob.md': note('npc', rels(edge('owns', 'Axe'))),
    'Bow.md': note('item', ['current_holder: "[[Cy]]"']),
    'Cy.md': note('npc', rels(edge('owns', 'Axe'))),
  });
  assert.deepStrictEqual(rowsOf(dir), [
    'WARNING\tBow.md:3\tcurrent_holder names [[Cy]] but [[Cy]] has no owns tie to this note',
    'WARNING\tSword.md:3\tcurrent_holder names [[Ann]] but [[Ann]] has no owns tie to this note',
  ]);
  assert.deepStrictEqual(findings(dir)[0].fix, { certain: true, choices: ['Cy'] });
});

test('a tie from an owner with no current_holder is not inferred', () => {
  const dir = vault({ 'Bob.md': note('npc', rels(edge('owns', 'Axe'))), 'Axe.md': note('item') });
  assert.deepStrictEqual(rowsOf(dir), []);
});

test('a tie to a session note is a log reference', () => {
  const dir = vault({
    'A.md': note('npc', rels(edge('participated_in', 'Session 3'), edge('participated_in', 'Plan 4'))),
    'Session 3.md': note('session'),
    'Plan 4.md': note('session-plan'),
  });
  assert.deepStrictEqual(rowsOf(dir), [
    "WARNING\tA.md:4\ttie to [[Session 3]], a session note: a log reference, not a graph edge",
    "WARNING\tA.md:6\ttie to [[Plan 4]], a session note: a log reference, not a graph edge",
  ]);
  assert.deepStrictEqual(findings(dir)[0].fix, { certain: false });
});

test('a vault that lists only some types notes the others as INFO; a full list is silent', () => {
  const files = { 'A.md': note('npc', rels(edge('knows', 'B', ['bidirectional: true']), edge('employs', 'B'))), 'B.md': note('npc') };
  const subset = vault({ ...files, '_meta/relationship-types.md': '| Category | Types |\n|---|---|\n| Social | knows |\n| Power | employs |\n| Place | located_at |\n' });
  assert.deepStrictEqual(rowsOf(subset), []);
  const narrower = vault({ ...files, '_meta/relationship-types.md': '- knows\n- located_at\n' });
  const rows = rowsOf(narrower);
  assert.deepStrictEqual(rows, ["INFO\tA.md:8\t'employs' is in the vocabulary but not in this vault's _meta/relationship-types.md"]);
  assert.strictEqual(findings(narrower)[0].fix, null);
  assert.deepStrictEqual(rowsOf(vault({ ...files })), []);
});

test('a container that links would-be children which are part_of its parent or unplaced', () => {
  const dir = vault({
    'Station.md': note('location'),
    'District.md': note('location', [...rels(edge('part_of', 'Station')), 'points_of_interest:', '  - "[[Bar]]"', '  - "[[Club]] (open late)"', '  - "[[Ann]]"', '  - "[[Station]]"', '  - "[[Done]]"', '  - "[[Elsewhere]]"'], 'Next to [[Tower]] and [[Plaza]].'),
    'Plaza.md': note('location'),
    'Bar.md': note('location', rels(edge('part_of', 'Station'))),
    'Club.md': note('location'),
    'Ann.md': note('npc'),
    'Done.md': note('location', rels(edge('part_of', 'District'))),
    'Elsewhere.md': note('location', rels(edge('part_of', 'Tower'))),
    'Tower.md': note('location'),
  });
  assert.deepStrictEqual(ofKind(dir, 'childless-container'), ['INFO\tDistrict.md:4\tDistrict is part_of Station and lists Bar, Club as points of interest, which are part_of Station or unplaced: should they be part_of District?']);
  assert.deepStrictEqual(findings(dir).find((f) => f.kind === 'childless-container').fix, { certain: false, choices: ['Bar', 'Club'] });
});

test('a container beside nothing is quiet, and a link to a grandparent is not a child', () => {
  const dir = vault({
    'Planet.md': note('location'),
    'Station.md': note('location', rels(edge('part_of', 'Planet'))),
    'District.md': note('location', [...rels(edge('part_of', 'Station')), 'points_of_interest:', '  - "[[Planet]]"']),
  });
  assert.deepStrictEqual(ofKind(dir, 'childless-container'), []);
});

test('a hub is a note with more than mean + 2 SD ties for its type, from five notes up', () => {
  const files = { 'Hub.md': note('npc', rels(...Array.from({ length: 12 }, (_, i) => edge('knows', `N${i}`, ['bidirectional: true'])))) };
  for (let i = 0; i < 12; i++) files[`N${i}.md`] = note('place');
  for (let i = 0; i < 5; i++) files[`P${i}.md`] = note('npc');
  const dir = vault(files);
  const rows = rowsOf(dir);
  assert.strictEqual(rows.length, 1);
  assert.match(rows[0], /^INFO\tHub\.md:1\t12 ties; notes of type npc average 2\.\d$/);
  assert.strictEqual(findings(dir)[0].fix, null);
  // Fewer than five notes of the type: no mean to speak of.
  const few = vault({ 'Hub.md': files['Hub.md'], 'P0.md': note('npc'), ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`N${i}.md`, note('place')])) });
  assert.deepStrictEqual(rowsOf(few), []);
});

test('mobrpg edges are checked for vocabulary only', () => {
  const dir = vault({
    'A.md': note('npc', ['mobrpg:', '  relationships:', '    - predicate: knows', '      target: "[[B]]"', '    - predicate: part_of', '      target: "[[Session 1]]"']),
    'B.md': note('npc', ['mobrpg:', '  relationships:', '    - predicate: knows', '      target: "[[A]]"']),
    'Session 1.md': note('session'),
  });
  assert.deepStrictEqual(rowsOf(dir), []);
});

test('a note the YAML cannot read gives one row of its own and the others are still checked', () => {
  const dir = vault({ 'Broken.md': '---\ntype: [oops\n---\n', 'A.md': note('npc', rels(edge('works_foo', 'B'))) });
  assert.strictEqual(rowsOf(dir).length, 2);
});

test('rows are sorted by rel then line, and each finding carries the edge it is about', () => {
  const dir = vault({
    'B.md': note('npc', rels(edge('zzzzzz', 'A'))),
    'A.md': note('npc', rels(edge('knows', 'B', ['tone: dread']), edge('yyyyyy', 'B'))),
  });
  const got = rowsOf(dir).map((r) => r.split('\t')[1]);
  assert.deepStrictEqual(got, ['A.md:4', 'A.md:6', 'A.md:8', 'B.md:5']);
  const f = findings(dir).find((x) => x.rel === 'A.md' && x.kind === 'off-vocabulary');
  assert.deepStrictEqual([f.edgeIndex, f.form, f.mobrpg], [1, 'list', false]);
  const empty = vault({ 'Hub.md': note('npc') });
  assert.strictEqual(render(findings(empty)), '# count: 0');
});

test('the command prints the TSV under a count header, and --json carries edgeIndex, form and mobrpg', async () => {
  const dir = vault({ 'A.md': note('npc', rels(edge('employed_by', 'B'))), 'B.md': note('npc') });
  const r = spawnSync(process.execPath, [BIN, 'relationships', 'check', '--vault', dir], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  const lines = r.stdout.replace(/\r\n/g, '\n').trimEnd().split('\n');
  assert.strictEqual(lines[0], '# count: 1');
  assert.match(lines[1], /^ERROR\tA\.md:5\toff-vocabulary relationship type 'employed_by'/);
  const j = await relCli(dir, 'check', '--json', '--file', 'A.md');
  const data = JSON.parse(j.stdout);
  assert.deepStrictEqual(Object.keys(data[0]).sort(), ['edgeIndex', 'fix', 'form', 'kind', 'level', 'line', 'message', 'mobrpg', 'rel']);
  assert.strictEqual(data[0].edgeIndex, 0);
  const none = await relCli(dir, 'check', '--folder', 'Nowhere');
  assert.strictEqual(none.stdout.trim(), '# count: 0');
});

test('a note whose frontmatter does not read is one ERROR row, in text and --json, and the others are still checked', async () => {
  const dir = vault({
    'Broken.md': '---\ntype: npc\nrelationships:\n  - target: "[[X]]\n    type: employed_by\n---\n',
    'A.md': note('npc', rels(edge('employed_by', 'B'))),
    'B.md': note('npc'),
  });
  const rows = rowsOf(dir);
  assert.strictEqual(rows.filter((r) => r.includes('Broken.md')).length, 1);
  assert.match(rows.find((r) => r.includes('Broken.md')), /^ERROR\tBroken\.md:1\tits frontmatter does not read \(.+\); its relationships were not checked$/);
  assert.ok(rows.some((r) => r.startsWith('ERROR\tA.md:5\toff-vocabulary')));
  const text = await relCli(dir, 'check');
  assert.match(text.stdout, /# count: 2/);
  const j = JSON.parse((await relCli(dir, 'check', '--json')).stdout);
  assert.deepStrictEqual(j.filter((f) => f.kind === 'unreadable').map((f) => f.rel), ['Broken.md']);
  // scope: reported when in scope, silent when not
  assert.strictEqual(rowsOf(dir, { files: ['Broken.md'] }).length, 1);
  assert.strictEqual(rowsOf(dir, { files: ['A.md'] }).filter((r) => r.includes('Broken.md')).length, 0);
  assert.strictEqual(rowsOf(dir, { folder: 'Nowhere' }).length, 0);
});

test('a flag the verb does not take is refused with the verb\'s flags; fix takes the scoping flags', () => {
  const dir = vault({ 'A.md': note('npc') });
  const run = (...a) => spawnSync(process.execPath, [BIN, 'relationships', ...a, '--vault', dir], { encoding: 'utf8' });
  for (const [args, flag] of [[['check', '--write'], '--write'], [['check', '--kind', 'hub'], '--kind'], [['words', '--folder', 'x'], '--folder']]) {
    const r = run(...args);
    assert.strictEqual(r.status, 1, args.join(' '));
    assert.ok(r.stderr.includes(`does not take ${flag}`), r.stderr);
    assert.ok(r.stderr.includes('its flags are --vault'), r.stderr);
  }
  const ok = run('fix', '--folder', 'Nowhere', '--file', 'A.md');
  assert.strictEqual(ok.status, 0, ok.stderr);
});
