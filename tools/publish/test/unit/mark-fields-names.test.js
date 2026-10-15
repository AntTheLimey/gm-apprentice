'use strict';
// tools/publish/test/unit/mark-fields-names.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { hiddenFieldsOf, gmAliasRewriter } = require('../../lib/processor');
const { createMarks, markKinds } = require('../../lib/gm-marks');

const ALL = new Set(markKinds());
const OPEN = (n) => String.fromCharCode(0xE000) + n.toString(36) + String.fromCharCode(0xE001);
const CLOSE = String.fromCharCode(0xE002);
const setup = (show = ALL) => { const marks = createMarks(); return { marks, mark: { marks, show } }; };
const WORDS = { person: 'someone', place: 'somewhere', thing: 'something' };

const vesper = { title: 'Vesper', displayTitle: 'Vesper', sourcePath: 'NPCs/Vesper.md', frontmatter: { type: 'npc', withheld: true } };
const vane = { title: 'Lord Vane', displayTitle: 'Lord Vane', sourcePath: 'NPCs/Lord Vane.md', frontmatter: { type: 'npc', gm_aliases: ['Elias Crowe'] } };
const rewriter = (pages, published, mark) => gmAliasRewriter(pages, published, [], WORDS, mark);

test('1: hidden fields, GM-only edges and secret aliases are listed in the input\'s key order', () => {
  const edgeB = { target: '[[B]]', type: 'serves', gm_only: true };
  const fm = {
    secrets: 'x', occupation: 'Clerk',
    relationships: [{ target: '[[A]]', type: 'ally' }, edgeB],
    aliases: ['Vane', 'Elias Crowe'], gm_aliases: ['Elias Crowe'], withheld: true,
  };
  assert.deepEqual(hiddenFieldsOf(fm, ['secrets']), [
    { kind: 'fields', label: 'field: secrets', name: 'secrets', value: 'x' },
    { kind: 'relationships', label: 'GM-only relationship', name: 'relationships', value: edgeB },
    { kind: 'fields', label: 'field: gm_aliases', name: 'aliases', value: 'Elias Crowe' },
    { kind: 'fields', label: 'field: gm_aliases', name: 'gm_aliases', value: ['Elias Crowe'] },
  ]);
});

test('2: a per-file exclusion is listed; a field the include override re-admits is not', () => {
  const fm = { secrets: 'x', occupation: 'Clerk', publish_exclude_fields: ['occupation'] };
  assert.deepEqual(hiddenFieldsOf(fm, [], {}).map((h) => h.label), ['field: occupation']);
  assert.deepEqual(hiddenFieldsOf({ secrets: 'x', occupation: 'Clerk' }, ['secrets'], { include: ['secrets'] }), []);
});

test('2b: a note with nothing hidden lists nothing', () => {
  assert.deepEqual(hiddenFieldsOf({ title: 'T', publish: true }, []), []);
});

test('2b2: a hidden field with nothing in it is not listed', () => {
  const fm = { secrets: '', motives: '  ', fears: [], plans: {}, debts: null, notes: [''], occupation: 'Spy' };
  assert.deepEqual(hiddenFieldsOf(fm, ['secrets', 'motives', 'fears', 'plans', 'debts', 'notes', 'occupation']).map((h) => h.name), ['occupation']);
});

test('2c (G12): when every edge is GM-only each is listed as a relationship, not as a field', () => {
  const edge = { target: '[[Elias]]', type: 'serves', gm_only: true };
  assert.deepEqual(hiddenFieldsOf({ relationships: [edge] }, []), [
    { kind: 'relationships', label: 'GM-only relationship', name: 'relationships', value: edge },
  ]);
});

test('2d: relationships removed by a field rule is one fields entry', () => {
  const rels = [{ target: '[[A]]' }, { target: '[[B]]', gm_only: true }];
  const viaConfig = hiddenFieldsOf({ relationships: rels }, ['relationships']);
  assert.deepEqual(viaConfig, [{ kind: 'fields', label: 'field: relationships', name: 'relationships', value: rels }]);
  const viaFile = hiddenFieldsOf({ relationships: [{ target: '[[B]]', gm_only: true }], publish_exclude_fields: ['relationships'] }, []);
  assert.deepEqual(viaFile.map((h) => h.label), ['field: relationships']);
});

test('3: an unlabelled link to a withheld note keeps the name inside a withheld_names mark', () => {
  const { marks, mark } = setup();
  const out = rewriter([vesper], [], mark).markdown('She met [[Vesper]].');
  assert.equal(out, `She met [[Vesper|${OPEN(0)}Vesper${CLOSE}]].`);
  assert.deepEqual(marks.get(0), { kind: 'withheld_names', label: 'players see: someone' });
});

test('3b: the name is the link\'s own text with underscores read as spaces', () => {
  const { mark } = setup();
  const out = rewriter([vesper], [], mark).markdown('[[Vesper#Scars]]');
  assert.equal(out, `[[Vesper#Scars|${OPEN(0)}Vesper${CLOSE}]]`);
});

test('3c: a bare name in a name field is marked the same way', () => {
  const { marks, mark } = setup();
  const fm = rewriter([vesper], [], mark).frontmatter({ location: 'Vesper' });
  assert.equal(fm.location, `[[Vesper|${OPEN(0)}Vesper${CLOSE}]]`);
  assert.equal(marks.get(0).kind, 'withheld_names');
});

test('4: a withheld note published on the GM site is still marked against the player site\'s list', () => {
  const { mark } = setup();
  const playerPublished = [vane];
  const out = rewriter([vesper, vane], playerPublished, mark).markdown('[[Vesper]]');
  assert.equal(out, `[[Vesper|${OPEN(0)}Vesper${CLOSE}]]`);
});

test('5: a labelled link to a withheld note is unchanged', () => {
  const { mark } = setup();
  assert.equal(rewriter([vesper], [], mark).markdown('[[Vesper|the stranger]]'), '[[Vesper|the stranger]]');
});

test('6: a secret alias keeps the alias inside a fields mark that names what players see', () => {
  const { marks, mark } = setup();
  const out = rewriter([vane], [vane], mark).markdown('[[Elias Crowe]]');
  assert.equal(out, `[[Lord Vane|${OPEN(0)}Elias Crowe${CLOSE}]]`);
  assert.deepEqual(marks.get(0), { kind: 'fields', label: 'gm_aliases; players see: Lord Vane' });
});

test('6b: a secret label on a public target is marked too', () => {
  const { marks, mark } = setup();
  const out = rewriter([vane], [vane], mark).markdown('[[Lord Vane|Elias Crowe]]');
  assert.equal(out, `[[Lord Vane|${OPEN(0)}Elias Crowe${CLOSE}]]`);
  assert.equal(marks.get(0).label, 'gm_aliases; players see: Lord Vane');
});

test('7: with the kinds off the output is today\'s', () => {
  const { marks, mark } = setup(new Set());
  const r = rewriter([vesper, vane], [vane], mark);
  assert.equal(r.markdown('[[Vesper]]'), '[[Vesper|someone]]');
  assert.equal(r.markdown('[[Elias Crowe]]'), '[[Lord Vane]]');
  assert.equal(r.markdown('[[Vesper|the stranger]]'), '[[Vesper|the stranger]]');
  assert.equal(marks.get(0), undefined);
  const plain = gmAliasRewriter([vesper, vane], [vane], [], WORDS);
  assert.equal(plain.markdown('[[Vesper]]'), '[[Vesper|someone]]');
  assert.equal(plain.markdown('[[Elias Crowe]]'), '[[Lord Vane]]');
});

test('7b: one kind on and the other off marks only the one that is on', () => {
  const { mark } = setup(new Set(['fields']));
  const r = rewriter([vesper, vane], [vane], mark);
  assert.equal(r.markdown('[[Vesper]]'), '[[Vesper|someone]]');
  assert.equal(r.markdown('[[Elias Crowe]]'), `[[Lord Vane|${OPEN(0)}Elias Crowe${CLOSE}]]`);
});
