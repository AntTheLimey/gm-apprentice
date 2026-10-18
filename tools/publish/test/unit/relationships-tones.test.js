'use strict';
// `relationships list` and `relationships fix --kind tone`: the tones on a note's own
// relationships, read by the YAML reader and rewritten from its source tokens.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { readVault } = require('../../lib/relationships/read');
const { listTones, planTones, parseSets } = require('../../lib/relationships/tones');
const { applyFix, renderPlan } = require('../../lib/relationships/fix');

const BIN = path.join(__dirname, '..', '..', 'bin', 'gm-publish.js');

function vault(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rel-tones-'));
  for (const [rel, text] of Object.entries(files)) {
    const full = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
  }
  return dir;
}
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
const list = (dir, opts) => listTones(readVault(dir), opts);
const plan = (dir, pairs, opts = {}) => planTones(readVault(dir), { vaultPath: dir, sets: parseSets(pairs), ...opts });
const cli = (dir, ...args) => spawnSync(process.execPath, [BIN, 'relationships', ...args, '--vault', dir], { encoding: 'utf8' });

const NOTE = `---
type: npc
tone: grim
relationships:
  - target: "[[A]]"
    type: knows
    tone: "Cordial"  # per S3
    description: |
      tone: dread
      a line of prose
  - target: "[[B]]"
    type: serves
    tone: warm
  - target: "[[C]]"
    type: knows
    tone:
mobrpg:
  relationships:
    - predicate: knows
      tone: zealous
---
Body. tone: ominous
`;

test('list gives the tones of the note\'s own relationships, with their lines, as written', () => {
  const dir = vault({ 'NPCs/A.md': NOTE });
  assert.deepStrictEqual(list(dir), [
    { rel: 'NPCs/A.md', line: 7, tone: 'Cordial', target: '[[A]]', description: 'tone: dread\na line of prose\n', gmOnly: false, hidesRelationships: false, siteFamily: null },
    { rel: 'NPCs/A.md', line: 13, tone: 'warm', target: '[[B]]', description: '', gmOnly: false, hidesRelationships: false, siteFamily: 'warm' },
  ]);
});

test('list says when a note hides its relationships, and reads flow-style ties', () => {
  const dir = vault({
    'NPCs/H.md': '---\ntype: npc\npublish_exclude_fields:\n  - relationships  # secret\nrelationships: [{target: "[[A]]", type: knows, tone: cold}]\n---\n',
    'NPCs/S.md': '---\ntype: npc\npublish_exclude_fields: relationships\nrelationships:\n  - {target: "[[A]]", type: knows, tone: cold}\n---\n',
  });
  assert.deepStrictEqual(list(dir).map((r) => [r.rel, r.tone, r.hidesRelationships]), [['NPCs/H.md', 'cold', true], ['NPCs/S.md', 'cold', false]]);
});

test('list gives the same lines for a CRLF note, and reads past a byte order mark', () => {
  const dir = vault({ 'A.md': NOTE.replace(/\n/g, '\r\n'), 'B.md': `﻿${NOTE}` });
  assert.deepStrictEqual(list(dir).map((r) => [r.rel, r.line, r.tone]), [
    ['A.md', 7, 'Cordial'], ['A.md', 13, 'warm'], ['B.md', 7, 'Cordial'], ['B.md', 13, 'warm']]);
});

test('list: an empty frontmatter, null tones, a map-form block and a note that does not read give nothing', () => {
  const dir = vault({
    'Empty.md': '---\n---\nText\n\nrelationships:\n  - target: "[[X]]"\n    type: bogus\n    tone: wary\n\n---\n\nMore.\n',
    'Nulls.md': '---\ntype: npc\nrelationships:\n  - target: "[[A]]"\n    tone: null\n  - target: "[[B]]"\n    tone: ~\n  - target: "[[C]]"\n    tone:\n---\n',
    'Map.md': '---\ntype: npc\nrelationships:\n  ally:\n    - "[[A]]"\n---\n',
    'Broken.md': '---\ntype: npc\nrelationships:\n  - target: "[[A]]"\n    description: "never closed\n    tone: dread\n---\n',
  });
  assert.deepStrictEqual(list(dir), []);
});

test('list reads a quoted multi-line description as text, and the value the way YAML does', () => {
  const dir = vault({
    'A.md': '---\ntype: npc\nrelationships:\n  - target: "[[Ana]]"\n    description: "He spoke in a \\"flat\\"\n      tone: dread, mostly"  # s3\n    tone: dread\n  - target: \'[[Bo]]\'\n    tone: tragic\n    description: \'It\'\'s\n      tone: dread\'\n  - {target: "[[Cy]]", tone: Cordial}\n---\n',
  });
  assert.deepStrictEqual(list(dir).map((r) => [r.line, r.tone, r.target, r.description]), [
    [7, 'dread', '[[Ana]]', 'He spoke in a "flat" tone: dread, mostly'],
    [9, 'tragic', '[[Bo]]', "It's tone: dread"],
    [12, 'Cordial', '[[Cy]]', ''],
  ]);
});

test('list: gm_only is read the way the site reads it', () => {
  const yes = ['true', 'True', 'TRUE', '"true"', "'true'", '" true "', 'yes', 'Yes # why', '"YES"', 'on', '1', '"1"', '1.0'];
  const no = ['false', 'no', 'off', '0', '2', '', '"maybe"'];
  const one = (v) => vault({ 'A.md': `---\ntype: npc\nrelationships:\n  - target: "[[A]]"\n    tone: cold\n    gm_only: ${v}\n---\n` });
  for (const v of yes) assert.strictEqual(list(one(v))[0].gmOnly, true, v);
  for (const v of no) assert.strictEqual(list(one(v))[0].gmOnly, false, v);
});

test('list leaves out the folders it is told to skip, and those only at the top', () => {
  const edge = '---\ntype: npc\nrelationships:\n  - target: "[[A]]"\n    tone: dread\n---\n';
  const dir = vault({ '_QA/X.md': edge, '_archive/Y.md': edge, 'NPCs/_QA/Z.md': edge, '_inbox/I.md': edge, '_Templates/T.md': edge, 'NPCs/N.md': edge });
  assert.deepStrictEqual(list(dir).map((r) => r.rel), ['NPCs/N.md', 'NPCs/_QA/Z.md', '_QA/X.md', '_archive/Y.md']);
  assert.deepStrictEqual(list(dir, { skip: ['_QA', '_archive'] }).map((r) => r.rel), ['NPCs/N.md', 'NPCs/_QA/Z.md']);
});

test('list --json is one row per tone, and a scoped run lists only that note', () => {
  const dir = vault({ 'A.md': NOTE, 'B.md': NOTE });
  const all = JSON.parse(cli(dir, 'list', '--json').stdout);
  assert.deepStrictEqual(Object.keys(all), ['tones', 'unread']);
  assert.strictEqual(all.tones.length, 4);
  assert.deepStrictEqual(all.unread, []);
  assert.deepStrictEqual(Object.keys(all.tones[0]), ['rel', 'line', 'tone', 'target', 'description', 'gmOnly', 'hidesRelationships', 'siteFamily']);
  assert.deepStrictEqual(JSON.parse(cli(dir, 'list', '--json', '--file', 'B.md').stdout).tones.map((r) => r.rel), ['B.md', 'B.md']);
  assert.match(cli(dir, 'list').stdout, /^# tones: 4\nA\.md:7\tCordial\t\[\[A\]\]\ttone: dread a line of prose\n/);
});

test('the tone rewrite keeps quotes, the comment, spacing and every other line', () => {
  const text = [
    '---', 'type: npc', 'tone: dread', 'relationships:',
    '  - target: "[[A]]"', '    tone: "Cordial"  # per S3',
    "  - target: '[[B]]'", "    tone: 'dread'",
    '  - target: "[[C]]"', '    tone:   Warm   ', '  - target: "[[D]]"', '    tone: central',
    'mobrpg:', '  relationships:', '    - predicate: knows', '      tone: dread', '---', 'tone: dread', ''].join('\n');
  const dir = vault({ 'A.md': text });
  const p = plan(dir, ['Cordial=friendly', 'dread=ominous', 'Warm=warm']);
  assert.deepStrictEqual(p.changes.map((c) => [c.line, c.before, c.after]), [
    [6, 'Cordial', 'friendly'], [8, 'dread', 'ominous'], [10, 'Warm', 'warm']]);
  assert.deepStrictEqual(p.kept, []);
  assert.strictEqual(p.texts.get('A.md'), text
    .replace('"Cordial"  # per S3', '"friendly"  # per S3').replace("'dread'", "'ominous'").replace('tone:   Warm   ', 'tone:   warm   '));
  assert.strictEqual(read(dir, 'A.md'), text, 'a plan writes nothing');
});

test('a CRLF note changes only the word; the write is all notes or none', () => {
  const crlf = NOTE.replace(/\n/g, '\r\n');
  const dir = vault({ 'A.md': crlf, 'B.md': NOTE });
  const p = plan(dir, ['Cordial=friendly']);
  applyFix(dir, p);
  assert.strictEqual(read(dir, 'A.md'), crlf.replace('"Cordial"', '"friendly"'));
  assert.strictEqual(read(dir, 'B.md'), NOTE.replace('"Cordial"', '"friendly"'));
});

test('a tone it cannot edit in place is a KEEP row and the rest still changes', () => {
  const dir = vault({ 'A.md': '---\ntype: npc\nrelationships:\n  - target: "[[A]]"\n    tone: >-\n      dread\n  - target: "[[B]]"\n    tone: dread\n---\n' });
  const p = plan(dir, ['dread=ominous']);
  assert.deepStrictEqual(p.changes.map((c) => c.line), [8]);
  assert.deepStrictEqual(p.kept, [{ rel: 'A.md', line: 5, tone: 'dread', why: 'not a plain tone line' }]);
  assert.match(renderPlan(p, false), /^# changes: 1, kept: 1, notes: 1\nWOULD-CHANGE\tA\.md:8\tdread -> ominous\nKEEP\tA\.md:5\tnot a plain tone line$/);
});

test('a note that is not UTF-8 stops the run before anything is written', () => {
  const dir = vault({ 'A.md': NOTE });
  fs.writeFileSync(path.join(dir, 'B.md'), Buffer.concat([Buffer.from(NOTE), Buffer.from([0xff, 0xfe])]));
  assert.throws(() => plan(dir, ['Cordial=friendly']), /B\.md is not UTF-8 text; fix the file, then run it again/);
  const run = cli(dir, 'fix', '--kind', 'tone', '--set', 'Cordial=friendly', '--write');
  assert.strictEqual(run.status, 1);
  assert.match(run.stderr, /B\.md is not UTF-8 text/);
  assert.strictEqual(read(dir, 'A.md'), NOTE);
});

test('the skipped folders are never rewritten', () => {
  const edge = '---\ntype: npc\nrelationships:\n  - target: "[[A]]"\n    tone: dread\n---\n';
  const dir = vault({ '_QA/X.md': edge, 'N.md': edge });
  const p = plan(dir, ['dread=ominous'], { skip: ['_QA'] });
  assert.deepStrictEqual([...p.texts.keys()], ['N.md']);
});

test('--set: the split is at the last =, a listed word is needed, and one word may not become two', () => {
  assert.deepStrictEqual([...parseSets(['a=b=tense', 'x= Cold '])], [['a=b', 'tense'], ['x', 'cold']]);
  assert.throws(() => parseSets(['dread=nope']), /nope is not a listed tone/);
  assert.throws(() => parseSets(['dread']), /--set takes OLD=NEW/);
  assert.throws(() => parseSets(['=tense']), /--set takes OLD=NEW/);
  assert.throws(() => parseSets(['dread=tense', 'dread=cold']), /dread is set to both tense and cold/);
  assert.deepStrictEqual([...parseSets(['dread=tense', 'dread=tense'])], [['dread', 'tense']]);
});

test('the command line: preview, write, a word that starts with a dash, and the refusals', () => {
  const edge = (t) => `---\ntype: npc\nrelationships:\n  - target: "[[A]]"\n    tone: ${t}\n---\n`;
  const dir = vault({ 'A.md': edge('dread'), 'B.md': edge('"-x"') });
  const preview = cli(dir, 'fix', '--kind', 'tone', '--set', 'dread=ominous', '--set', '-x=tense');
  assert.strictEqual(preview.status, 0, preview.stderr);
  assert.strictEqual(preview.stdout, '# changes: 2, kept: 0, notes: 2\nWOULD-CHANGE\tA.md:5\tdread -> ominous\nWOULD-CHANGE\tB.md:5\t-x -> tense\n');
  assert.strictEqual(read(dir, 'A.md'), edge('dread'));
  const written = JSON.parse(cli(dir, 'fix', '--kind', 'tone', '--set', 'dread=ominous', '--set', '-x=tense', '--write', '--json').stdout);
  assert.deepStrictEqual([written.written, written.notes], [true, ['A.md', 'B.md']]);
  assert.strictEqual(read(dir, 'A.md'), edge('ominous'));
  assert.strictEqual(read(dir, 'B.md'), edge('"tense"'));

  const bare = cli(dir, 'fix', '--kind', 'tone');
  assert.strictEqual(bare.status, 1);
  assert.match(bare.stderr, /--kind tone needs --set OLD=NEW/);
  const mixed = cli(dir, 'fix', '--kind', 'tone', '--kind', 'mirrored', '--set', 'a=tense');
  assert.match(mixed.stderr, /cannot be mixed with other kinds/);
  const wrong = cli(dir, 'check', '--set', 'a=tense');
  assert.strictEqual(wrong.status, 1);
  assert.match(wrong.stderr, /relationships check does not take --set/);
  const stray = cli(dir, 'fix', '--set', 'a=tense');
  assert.match(stray.stderr, /--set goes with fix --kind tone/);
});

test('list names the notes whose frontmatter does not read, except in a skipped folder', () => {
  const broken = '---\ntype: npc\nrelationships: [unclosed\n---\n';
  const dir = vault({ 'A.md': NOTE, 'B.md': broken, '_QA/C.md': broken });
  const all = JSON.parse(cli(dir, 'list', '--json', '--skip', '_QA').stdout);
  assert.deepStrictEqual(all.unread.map((u) => u.rel), ['B.md']);
  assert.match(cli(dir, 'list', '--skip', '_QA').stdout, /^# tones: 2  not read: 1\n/);
});

test('fix --skip without --kind tone is refused', () => {
  const dir = vault({ 'A.md': NOTE });
  const r = cli(dir, 'fix', '--skip', '_QA');
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, /--skip goes with list and fix --kind tone/);
});
