'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { relCli } = require('../helpers/relationships-cli');
const { readVault } = require('../../lib/relationships/read');
const { check } = require('../../lib/relationships/check');
const { planFix, applyFix, renderPlan, removeLeftovers } = require('../../lib/relationships/fix');
const ontology = require('../../lib/ontology.json');


function vault(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rel-fix-'));
  for (const [rel, text] of Object.entries(files)) {
    const full = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
  }
  return dir;
}
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
const note = (type, lines = [], body = '') => `---\ntype: ${type}\n${lines.join('\n')}${lines.length ? '\n' : ''}---\n${body}`;
const edge = (type, target, more = []) => [`  - target: "[[${target}]]"`, `    type: ${type}`, ...more.map((m) => `    ${m}`)];
const rels = (...edges) => ['relationships:', ...edges.flat()];

function plan(dir, opts = {}) {
  const model = readVault(dir);
  const findings = check(model, ontology, { vaultPath: dir, publishes: () => true });
  return planFix(model, findings, { vaultPath: dir, ...opts });
}
const checkKinds = (dir) => check(readVault(dir), ontology, { vaultPath: dir, publishes: () => true }).map((f) => f.kind);

test('an inverse edge moves to the other note, carrying tone and description as written', () => {
  const dir = vault({
    'Kid.md': note('npc', rels(edge('child_of', 'Dad', ['tone: warm', 'description: "Loves him"']))),
    'Dad.md': note('npc', rels(edge('knows', 'Kid', ['bidirectional: true']))),
  });
  const p = plan(dir);
  assert.strictEqual(p.changes.length, 1);
  assert.deepStrictEqual(p.kept, []);
  assert.strictEqual(p.texts.get('Kid.md'), note('npc', ['relationships:']));
  assert.strictEqual(p.texts.get('Dad.md'), note('npc', rels(
    edge('knows', 'Kid', ['bidirectional: true']),
    edge('parent_of', 'Kid', ['tone: warm', 'description: "Loves him"']),
  )).replace('"[[Kid]]"\n    type: parent_of', '"[[Kid]]"\n    type: parent_of'));
});

test('a single-choice verb that flips is moved; one that does not is rewritten in place and made two-way when its new type is', () => {
  const dir = vault({
    'Boss.md': note('npc'),
    'Clerk.md': note('npc', rels(edge('works_for', 'Boss'))),
    'Hall.md': note('location', rels(edge('adjacent_to', 'Yard', ['# keep this']))),
    'Yard.md': note('location'),
  });
  const p = plan(dir);
  assert.strictEqual(p.texts.get('Boss.md'), note('npc', ['relationships:', '  - target: "[[Clerk]]"', '    type: employs']));
  assert.strictEqual(p.texts.get('Hall.md'), note('location', rels(edge('borders', 'Yard', ['# keep this']))).replace('# keep this', '# keep this').replace('type: borders\n    # keep this', 'type: borders\n    bidirectional: true\n    # keep this'));
});

test('a mirrored second copy is removed; one that carries a description the first lacks is kept with why', () => {
  const dir = vault({
    'A.md': note('npc', rels(edge('sibling_of', 'B', ['bidirectional: true']))),
    'B.md': note('npc', rels(edge('sibling_of', 'A', ['bidirectional: true']))),
    'C.md': note('npc', rels(edge('sibling_of', 'D', ['bidirectional: true']))),
    'D.md': note('npc', rels(edge('sibling_of', 'C', ['bidirectional: true', 'description: "twins"']))),
  });
  const p = plan(dir);
  assert.strictEqual(p.texts.get('B.md'), note('npc', ['relationships:']));
  assert.ok(!p.texts.has('A.md') && !p.texts.has('D.md'));
  assert.strictEqual(p.kept.length, 1);
  assert.match(p.kept[0].why, /the two copies differ: description/);
});

test('bidirectional is set or removed in place', () => {
  const dir = vault({
    'A.md': note('npc', rels(edge('knows', 'B'), edge('parent_of', 'B', ['bidirectional: true']))),
    'B.md': note('npc'),
  });
  const p = plan(dir);
  assert.strictEqual(p.texts.get('A.md'), note('npc', rels(edge('knows', 'B', ['bidirectional: true']), edge('parent_of', 'B'))));
});

test('place fields: a part_of tie, an owns tie on the holder, and a parent_location after type', () => {
  const dir = vault({
    'Town.md': note('location'),
    'Street.md': note('location', ['parent_location: "[[Town]]"']),
    'Hamlet.md': note('location', rels(edge('part_of', 'Town'))),
    'Sword.md': note('item', ['current_holder: "[[Hero]]"']),
    'Hero.md': note('pc', rels(edge('knows', 'Town', ['bidirectional: true']))),
  });
  const p = plan(dir);
  assert.strictEqual(p.texts.get('Street.md'), note('location', ['parent_location: "[[Town]]"', 'relationships:', '  - target: "[[Town]]"', '    type: part_of']));
  assert.strictEqual(p.texts.get('Hamlet.md'), `---\ntype: location\nparent_location: "[[Town]]"\nrelationships:\n  - target: "[[Town]]"\n    type: part_of\n---\n`);
  assert.strictEqual(p.texts.get('Hero.md'), note('pc', rels(edge('knows', 'Town', ['bidirectional: true']), edge('owns', 'Sword'))));
});

test('a CRLF note stays CRLF and only the edited lines change; a comment in the block survives', () => {
  const crlf = (s) => s.replace(/\n/g, '\r\n');
  const kid = crlf(note('npc', ['relationships:', '  # about dad', ...edge('child_of', 'Dad'), '  # last word', ...edge('mentors', 'Dad')], 'Body\n'));
  const dad = crlf(note('npc', ['relationships: # ties', ...edge('knows', 'Kid', ['bidirectional: true']), '  # tail comment'], 'Dad body\n'));
  const dir = vault({ 'Kid.md': kid, 'Dad.md': dad });
  const p = plan(dir);
  assert.strictEqual(p.texts.get('Kid.md'), crlf(note('npc', ['relationships:', '  # about dad', '  # last word', ...edge('mentors', 'Dad')], 'Body\n')));
  assert.strictEqual(p.texts.get('Dad.md'), crlf(note('npc', ['relationships: # ties', ...edge('knows', 'Kid', ['bidirectional: true']), ...edge('parent_of', 'Kid'), '  # tail comment'], 'Dad body\n')));
});

test('a BOM and a missing final newline are kept', () => {
  const dir = vault({
    'Kid.md': `﻿${note('npc', rels(edge('child_of', 'Dad')))}tail`,
    'Dad.md': '﻿no front here',
  });
  const p = plan(dir);
  assert.strictEqual(p.texts.get('Kid.md'), `﻿${note('npc', ['relationships:'])}tail`);
  assert.strictEqual(p.texts.get('Dad.md'), '﻿---\nrelationships:\n  - target: "[[Kid]]"\n    type: parent_of\n---\nno front here');
});

test('the other note has no relationships key, an empty one, `[]`, no frontmatter, or an empty frontmatter', () => {
  const kid = (n) => [`Kid${n}.md`, note('npc', rels(edge('child_of', `Dad${n}`)))];
  const dir = vault({
    ...Object.fromEntries([1, 2, 3, 4, 5].map(kid)),
    'Dad1.md': note('npc', ['name: Dad']),
    'Dad2.md': note('npc', ['relationships:', 'after: 1']),
    'Dad3.md': note('npc', ['relationships: []', 'after: 1']),
    'Dad4.md': 'Just prose\n',
    'Dad5.md': '---\n---\nBody\n',
  });
  const p = plan(dir);
  const added = (n) => `  - target: "[[Kid${n}]]"\n    type: parent_of\n`;
  assert.strictEqual(p.texts.get('Dad1.md'), `---\ntype: npc\nname: Dad\nrelationships:\n${added(1)}---\n`);
  assert.strictEqual(p.texts.get('Dad2.md'), `---\ntype: npc\nrelationships:\n${added(2)}after: 1\n---\n`);
  assert.strictEqual(p.texts.get('Dad3.md'), `---\ntype: npc\nrelationships:\n${added(3)}after: 1\n---\n`);
  assert.strictEqual(p.texts.get('Dad4.md'), `---\nrelationships:\n${added(4)}---\nJust prose\n`);
  assert.strictEqual(p.texts.get('Dad5.md'), `---\nrelationships:\n${added(5)}---\nBody\n`);
  const out = p.texts.get('Dad3.md');
  assert.ok(readVault(vault({ 'Dad3.md': out, 'Kid3.md': note('npc') })).faults.length === 0);
});

test('a target note that does not exist is listed, not created; the source is left alone', () => {
  const dir = vault({ 'Kid.md': note('npc', rels(edge('child_of', 'Nobody'))) });
  const p = plan(dir);
  assert.strictEqual(p.changes.length, 0);
  assert.strictEqual(p.texts.size, 0);
  assert.match(p.kept[0].why, /the other note does not exist/);
});

test('the map form and a flow list are KEEP, never half-written', () => {
  const dir = vault({
    'Kid.md': note('npc', ['relationships:', '  child_of: ["[[Dad]]"]']),
    'Aunt.md': note('npc', ['relationships: [{target: "[[Dad]]", type: child_of}]']),
    'Dad.md': note('npc'),
  });
  const p = plan(dir);
  assert.strictEqual(p.texts.size, 0);
  assert.strictEqual(p.kept.length, 2);
  for (const k of p.kept) assert.match(k.why, /written in a form the fix does not edit/);
});

test('a move onto a note whose own list is a map or flow list is KEEP and the source keeps its edge', () => {
  const dir = vault({
    'Kid.md': note('npc', rels(edge('child_of', 'Dad'), edge('child_of', 'Mum'))),
    'Dad.md': note('npc', ['relationships:', '  knows: ["[[Kid]]"]']),
    'Mum.md': note('npc', ['relationships: [{target: "[[Kid]]", type: knows}]']),
  });
  const p = plan(dir);
  assert.strictEqual(p.texts.size, 0);
  // Kid's two moves, and Mum's own flow-list tie (a two-way flag cannot be added inside braces).
  assert.deepStrictEqual(p.kept.map((k) => k.rel), ['Kid.md', 'Kid.md', 'Mum.md']);
});

test('a move that would duplicate is KEEP', () => {
  const dir = vault({
    'Kid.md': note('npc', rels(edge('child_of', 'Dad'))),
    'Dad.md': note('npc', rels(edge('parent_of', 'Kid'))),
    'Kid2.md': note('npc', rels(edge('child_of', 'Dad2'), edge('child_of', 'Dad2'))),
    'Dad2.md': note('npc'),
  });
  const p = plan(dir);
  assert.ok(p.kept.some((k) => k.rel === 'Kid.md' && /would duplicate/.test(k.why)));
  assert.ok(p.kept.some((k) => k.rel === 'Kid2.md' && /would duplicate/.test(k.why)));
  assert.strictEqual(p.changes.filter((c) => c.rel === 'Kid2.md').length, 1);
});

test('two fixes on one note land together in one text', () => {
  const dir = vault({
    'Dad.md': note('npc', rels(edge('knows', 'Pal'))),
    'Pal.md': note('npc'),
    'Kid.md': note('npc', rels(edge('child_of', 'Dad'))),
    'Kid2.md': note('npc', rels(edge('child_of', 'Dad'))),
  });
  const p = plan(dir);
  assert.strictEqual(p.changes.length, 3);
  assert.strictEqual(p.texts.get('Dad.md'), note('npc', rels(
    edge('knows', 'Pal', ['bidirectional: true']), edge('parent_of', 'Kid'), edge('parent_of', 'Kid2'))));
});

test('a mobrpg edge and every finding that is not certain are not in the plan', () => {
  const dir = vault({
    'A.md': note('npc', [...rels(edge('affiliated_with', 'B')), 'mobrpg:', '  relationships:', '    - predicate: child_of', '      target: "[[B]]"']),
    'B.md': note('npc'),
  });
  const p = plan(dir);
  assert.strictEqual(p.changes.length, 0);
  assert.strictEqual(p.kept.length, 0);
});

test('--kind limits the plan', () => {
  const dir = vault({
    'A.md': note('npc', rels(edge('knows', 'B'), edge('child_of', 'B'))),
    'B.md': note('npc'),
  });
  assert.deepStrictEqual(plan(dir, { kinds: ['bidirectional'] }).changes.map((c) => c.kind), ['bidirectional']);
});

test('applyFix writes every note; a note changed since planning makes it refuse and write nothing', () => {
  const dir = vault({
    'Kid.md': note('npc', rels(edge('child_of', 'Dad'))),
    'Dad.md': note('npc'),
  });
  const p = plan(dir);
  fs.appendFileSync(path.join(dir, 'Dad.md'), 'edited meanwhile\n');
  assert.throws(() => applyFix(dir, p), /changed since/);
  assert.strictEqual(read(dir, 'Kid.md'), note('npc', rels(edge('child_of', 'Dad'))));
  fs.writeFileSync(path.join(dir, 'Dad.md'), note('npc'));
  applyFix(dir, p);
  assert.strictEqual(read(dir, 'Kid.md'), note('npc', ['relationships:']));
  assert.match(read(dir, 'Dad.md'), /parent_of/);
});

test('if a rename fails, the notes already renamed are put back and no temp file stays', () => {
  const files = {
    'A.md': note('npc', rels(edge('child_of', 'B'))),
    'B.md': note('npc'),
    'C.md': note('npc', rels(edge('child_of', 'D'))),
    'D.md': note('npc'),
  };
  const dir = vault(files);
  const p = plan(dir);
  let n = 0;
  const rename = (from, to) => { n++; if (n === 3) throw new Error('disk full'); fs.renameSync(from, to); };
  assert.throws(() => applyFix(dir, p, { rename }), /disk full.*nothing is changed/);
  for (const [rel, text] of Object.entries(files)) assert.strictEqual(read(dir, rel), text);
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['A.md', 'B.md', 'C.md', 'D.md']);
});

test('if a note cannot be put back after a failed rename, the message does not say nothing is changed', () => {
  const dir = vault({
    'A.md': note('npc', rels(edge('child_of', 'B'))),
    'B.md': note('npc'),
    'C.md': note('npc', rels(edge('child_of', 'D'))),
    'D.md': note('npc'),
  });
  const p = plan(dir);
  let n = 0;
  const rename = (from, to) => { n++; if (n === 3) throw new Error('disk full'); fs.renameSync(from, to); };
  const restore = () => { throw new Error('locked'); };
  assert.throws(() => applyFix(dir, p, { rename, restore }), (e) => /hold the new text/.test(e.message) && /locked/.test(e.message) && !/nothing is changed/.test(e.message));
});

test('running fix twice changes nothing the second time, and check shows none of the fixed kinds', () => {
  const dir = vault({
    'Kid.md': note('npc', rels(edge('child_of', 'Dad'), edge('works_for', 'Boss'), edge('sibling_of', 'Sis'))),
    'Dad.md': note('npc'),
    'Boss.md': note('npc'),
    'Sis.md': note('npc', rels(edge('sibling_of', 'Kid', ['bidirectional: true']))),
    'Hall.md': note('location', rels(edge('adjacent_to', 'Yard'))),
    'Yard.md': note('location'),
    'Town.md': note('location'),
    'Street.md': note('location', ['parent_location: "[[Town]]"']),
    'Sword.md': note('item', ['current_holder: "[[Boss]]"']),
  });
  applyFix(dir, plan(dir));
  const snapshot = fs.readdirSync(dir).map((f) => read(dir, f));
  const second = plan(dir);
  assert.strictEqual(second.changes.length, 0);
  assert.strictEqual(second.texts.size, 0);
  applyFix(dir, second);
  assert.deepStrictEqual(fs.readdirSync(dir).map((f) => read(dir, f)), snapshot);
  const left = checkKinds(dir).filter((k) => ['off-vocabulary', 'mirrored', 'bidirectional', 'place-missing-tie', 'place-missing-field'].includes(k));
  assert.deepStrictEqual(left, []);
});

test('the CLI: preview prints WOULD-CHANGE and KEEP rows and writes nothing; --write prints CHANGED', async () => {
  const dir = vault({
    'Kid.md': note('npc', rels(edge('child_of', 'Dad'), edge('child_of', 'Nobody'))),
    'Dad.md': note('npc'),
  });
  const before = read(dir, 'Kid.md');
  const run = (...args) => relCli(dir, 'fix', ...args);
  const preview = (await run());
  assert.strictEqual(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /WOULD-CHANGE\tKid\.md:\d+\t/);
  assert.match(preview.stdout, /KEEP\tKid\.md:\d+\tthe other note does not exist/);
  assert.strictEqual(read(dir, 'Kid.md'), before);
  const json = JSON.parse((await run('--json')).stdout);
  assert.strictEqual(json.changes.length, 1);
  assert.strictEqual(json.written, false);
  const done = (await run('--write'));
  assert.match(done.stdout, /CHANGED\tKid\.md:\d+\t/);
  assert.match(read(dir, 'Dad.md'), /parent_of/);
  assert.match(renderPlan(plan(dir), false), /KEEP/);
});

test('a note edited after it was read: the tie is not where the finding says, so it is KEEP and nothing is written', () => {
  const dir = vault({
    'Kid.md': note('npc', rels(edge('child_of', 'Dad'))),
    'Dad.md': note('npc'),
  });
  const model = readVault(dir);
  const findings = check(model, ontology, { vaultPath: dir, publishes: () => true });
  fs.writeFileSync(path.join(dir, 'Kid.md'), note('npc', rels(edge('knows', 'Dad', ['bidirectional: true']), edge('child_of', 'Mum'))));
  const p = planFix(model, findings, { vaultPath: dir });
  assert.strictEqual(p.texts.size, 0);
  assert.match(p.kept[0].why, /no longer where it was/);
});

test('a tie with a field the move would lose is KEEP', () => {
  const dir = vault({
    'Kid.md': note('npc', rels(edge('child_of', 'Dad', ['since: 1920']))),
    'Dad.md': note('npc'),
  });
  const p = plan(dir);
  assert.strictEqual(p.texts.size, 0);
  assert.match(p.kept[0].why, /carries a field the move does not carry: since/);
});

test('an unknown --kind is refused', async () => {
  const dir = vault({ 'A.md': note('npc') });
  const r = await relCli(dir, 'fix', '--kind', 'hub');
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, /no certain repair/);
});

test('a repair that would store a two-way tie on both notes is KEEP', () => {
  const dir = vault({
    'Hall.md': note('location', rels(edge('adjacent_to', 'Yard'))),
    'Yard.md': note('location', rels(edge('borders', 'Hall', ['bidirectional: true']))),
  });
  const p = plan(dir);
  assert.strictEqual(p.texts.size, 0);
  assert.match(p.kept[0].why, /two-way tie on both notes/);
});

test('an empty (0-byte) destination note gets a frontmatter made for it', () => {
  const dir = vault({ 'Kid.md': note('npc', rels(edge('child_of', 'Dad'))), 'Dad.md': '' });
  const p = plan(dir);
  assert.deepStrictEqual(p.kept, []);
  assert.strictEqual(p.texts.get('Dad.md'), '---\nrelationships:\n  - target: "[[Kid]]"\n    type: parent_of\n---\n');
});

test('a destination whose frontmatter does not parse is not called missing', () => {
  const dir = vault({ 'Kid.md': note('npc', rels(edge('child_of', 'Dad'))), 'Dad.md': '---\ntype: npc\nno end\n' });
  const p = plan(dir);
  assert.strictEqual(p.texts.size, 0);
  assert.strictEqual(p.kept[0].why, "the other note's frontmatter does not parse");
});

test('a tie holding a comment is KEEP, since removing it would lose the comment', () => {
  const dir = vault({
    'Kid.md': note('npc', ['relationships:', '  - target: "[[Dad]]"', '    type: child_of # why', '    tone: warm']),
    'Dad.md': note('npc'),
  });
  const p = plan(dir);
  assert.strictEqual(p.texts.size, 0);
  assert.match(p.kept[0].why, /comment that removing it would lose/);
});

test('temp files are visible, and the next --write removes only its own leftovers', () => {
  const dir = vault({
    'Kid.md': note('npc', rels(edge('child_of', 'Dad'))),
    'Dad.md': note('npc'),
    'Old.md.fix-tmp-4242': 'left by a killed run',
    'Mine.txt': 'not a leftover',
    'Other.tmp': 'not a leftover',
  });
  let seen = [];
  const p = plan(dir);
  applyFix(dir, p, { rename: (a, b) => { seen.push(path.basename(a)); fs.renameSync(a, b); } });
  assert.ok(seen.every((n) => /^[^.].*\.md\.fix-tmp-\d+$/.test(n)), seen.join());
  assert.deepStrictEqual(removeLeftovers(dir), ['Old.md.fix-tmp-4242']);
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['Dad.md', 'Kid.md', 'Mine.txt', 'Other.tmp']);
});

test('a change row that rides on a removal goes when the removing unit is dropped', () => {
  const dir = vault({
    'A.md': note('npc', rels(edge('sibling_of', 'B', ['bidirectional: true']))),
    'B.md': note('npc', rels(edge('sibling_of', 'A'))),
  });
  const whole = plan(dir);
  assert.deepStrictEqual(whole.changes.map((c) => c.after), ['removed (kept on A)', 'removed with the copy on the other note']);
  const model = readVault(dir);
  const p = planFix(model, check(model, ontology, { vaultPath: dir }), { vaultPath: dir, readBack: (t, rel) => (rel === 'B.md' ? { why: 'forced' } : { kind: 'none' }) });
  assert.deepStrictEqual(p.changes, []);
  assert.strictEqual(p.kept.length, 2);
  assert.strictEqual(p.texts.size, 0);
});

// ---- a hand-written visit an event already supplies (#474) ----
const visitVault = (extra = {}) => vault({
  'Dinner.md': note('event', ['location: "[[Hall]]"', 'participants:', '  - "[[Ada]] (hosted)"', '  - "[[Bea]]"', '  - "[[Cy]]"']),
  'Ada.md': note('npc'),
  'Bea.md': note('npc'),
  'Cy.md': note('npc'),
  'Hall.md': note('location', rels(
    edge('visited_by', 'Ada', ['tone: neutral', 'strength: 5', 'description: "Visited Hall for the dinner"']),
    edge('visited_by', 'Bea', ['description: "Hid the ledger under the stairs"']),
    edge('visited_by', 'Cy', ['gm_only: true']),
  )),
  ...extra,
});

test('a visited_by the event already supplies is removed; one that says more is left alone with no row', () => {
  const dir = visitVault();
  const f = check(readVault(dir), ontology, { vaultPath: dir, publishes: () => true }).filter((x) => x.kind === 'visit-duplicate');
  assert.deepStrictEqual(f.map((x) => [x.level, x.fix.certain]), [['WARNING', true], ['INFO', false]]);
  assert.ok(f.every((x) => !/Hid the ledger|says more/.test(x.message)), f.map((x) => x.message).join('\n'));
  const p = plan(dir);
  assert.deepStrictEqual(p.changes.map((c) => c.before), ['visited_by [[Ada]]']);
  assert.deepStrictEqual(p.kept.map((k) => k.why), ['is hidden from players on purpose']);
  assert.strictEqual(p.texts.get('Hall.md'), note('location', rels(
    edge('visited_by', 'Bea', ['description: "Hid the ledger under the stairs"']),
    edge('visited_by', 'Cy', ['gm_only: true']),
  )));
});

test('a visit is not removed while another tie between the two would hide the event\'s', () => {
  const dir = vault({
    'Dinner.md': note('event', ['location: "[[Hall]]"', 'participants:', '  - "[[Ada]]"']),
    'Ada.md': note('npc', rels(edge('located_at', 'Hall'))),
    'Hall.md': note('location', rels(edge('visited_by', 'Ada'))),
  });
  const p = plan(dir);
  assert.deepStrictEqual(p.changes, []);
  assert.match(p.kept[0].why, /located_at tie between the two would hide/);
});

test('a visited on the person is a copy too, a non-neutral tone is kept, and --write then leaves nothing to find', async () => {
  const dir = vault({
    'Dinner.md': note('event', ['location: "[[Hall]]"', 'participants:', '  - "[[Ada]]"', '  - "[[Bea]]"']),
    'Ada.md': note('npc', rels(edge('visited', 'Hall'))),
    'Bea.md': note('npc', rels(edge('visited', 'Hall', ['tone: tense']))),
    'Hall.md': note('location'),
  });
  const r = await relCli(dir, 'fix', '--kind', 'visit-duplicate', '--write');
  assert.strictEqual(r.status, 0);
  assert.strictEqual(read(dir, 'Ada.md'), note('npc', ['relationships:']));
  assert.match(read(dir, 'Bea.md'), /tone: tense/);
  assert.deepStrictEqual(checkKinds(dir).filter((k) => k === 'visit-duplicate'), ['visit-duplicate']);
});

test('an event, person or place with no page supplies no visit, by the build\'s own verdict', async () => {
  const visits = (event, extra = {}) => vault({
    ...event,
    'People/Ada.md': note('npc', rels(edge('visited', 'Hall'))),
    'Places/Hall.md': note('location'),
    '_meta/vault-config.md': '---\npublish:\n  exclude_dirs:\n    - Drafts\n  folder_map:\n    Events: events\n    People: people\n    Places: places\n    Drafts: drafts\n---\n',
    ...extra,
  });
  const dinner = (more = []) => note('event', ['location: "[[Hall]]"', 'participants:', '  - "[[Ada]]"', ...more]);
  const kinds = async (dir) => JSON.parse((await relCli(dir, 'check', '--json')).stdout).map((f) => f.kind);
  // The vault as the build reads it: the event publishes, so the hand-written visit is a copy.
  assert.deepStrictEqual(await kinds(visits({ 'Events/Dinner.md': dinner() })), ['visit-duplicate']);
  assert.deepStrictEqual(await kinds(visits({ 'Events/Dinner.md': dinner(['publish: false']) })), []);
  assert.deepStrictEqual(await kinds(visits({ 'Drafts/Dinner.md': dinner() })), []);
  assert.deepStrictEqual(await kinds(visits({ 'Events/Dinner.md': dinner() }, { 'Places/Hall.md': note('location', ['publish: false']) })), []);
  // Without a verdict, nothing counts.
  const dir = visits({ 'Events/Dinner.md': dinner() });
  assert.deepStrictEqual(check(readVault(dir), ontology, { vaultPath: dir }).map((f) => f.kind), []);
});

test('no event, or a place that is not one link, means no visit to repeat', () => {
  const dir = vault({
    'Dinner.md': note('event', ['location: "somewhere grand"', 'participants:', '  - "[[Ada]]"']),
    'Ada.md': note('npc'),
    'Hall.md': note('location', rels(edge('visited_by', 'Ada'))),
  });
  assert.deepStrictEqual(checkKinds(dir), []);
});
