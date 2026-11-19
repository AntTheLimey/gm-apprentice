'use strict';
const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readText } = require('./helpers/run-sheet-lines');
const { buildIndex } = require('../lib/run-sheet/notes');
const { readHandouts } = require('../lib/run-sheet/handouts');
const { readPcs } = require('../lib/run-sheet/party');
const { readPeople } = require('../lib/run-sheet/people');
const { writeSettings } = require('./helpers/vault-files');
const { makePng } = require('./helpers/make-png');

// Every scratch dir is removed when the file's tests finish.
const made = [];
const mkTmp = (prefix) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); made.push(d); return d; };
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

const FIXTURE = path.join(__dirname, 'fixtures', 'run-sheet');
const PLAN = 'Chapters/Chapter 1/Sessions/Session 02/Session 02 - The Test - Plan.md';
const ADA = 'Characters/PCs/Ada Moss.md';
const BEN = 'Characters/PCs/Ben Hart.md';

function setup() {
  const dir = mkTmp('rs-');
  fs.cpSync(FIXTURE, dir, { recursive: true });
  writeSettings(dir, { 'vault.system': 'dnd5e' });
  fs.mkdirSync(path.join(dir, '_attachments'), { recursive: true });
  fs.writeFileSync(path.join(dir, '_attachments', 'ada.png'), makePng(8, 8));
  const index = buildIndex(dir);
  return { dir, index, body: index.read(PLAN).body };
}

describe('run sheet handouts, party and people', () => {
  it('handouts read as rows', () => {
    const { index, body } = setup();
    const { handouts: h, leftover } = readHandouts(body, index);
    assert.strictEqual(leftover, '');
    assert.strictEqual(h.length, 1);
    assert.strictEqual(h[0].note, "Chapters/Chapter 1/Props/Ash's Note.md");
    assert.strictEqual(h[0].scene, 'Scene 1');
    assert.strictEqual(h[0].status, 'to build');
    assert.strictEqual(h[0].text, 'What Ash passes down the wall');
    assert.match(h[0].key, /^handouts\.ho\./);
  });

  it('handouts read as bullets', () => {
    const { index } = setup();
    const h = readHandouts('## Handouts & Props\n\n- A torn map of [[The Gate]]\n- A coin\n', index).handouts;
    assert.strictEqual(h.length, 2);
    assert.strictEqual(h[0].note, 'Locations/The Gate.md');
    assert.strictEqual(h[1].note, null);
    assert.strictEqual(h[1].text, 'A coin');
  });

  it('pcs come from the party, not the Plan', () => {
    const { index, body } = setup();
    const r = readPcs(body, index, [BEN, ADA]);
    assert.deepStrictEqual(r.pcs.map((p) => p.name), ['Ada Moss', 'Ben Hart']);
    const [ada, ben] = r.pcs;
    assert.strictEqual(ada.player, 'Pat');
    assert.strictEqual(ada.portrait, '_attachments/ada.png');
    assert.strictEqual(ben.portrait, null);
    assert.strictEqual(ada.role, 'Scout');
    assert.strictEqual(ada.moment, 'sees the tracks');
    assert.match(ben.touch, /the letter/);
    assert.strictEqual(ada.arc, 'Testing. Next beat: the tracks.');
    assert.strictEqual(ben.arc, 'Secretive. Next beat: the letter.');
    assert.strictEqual(r.warnings.length, 0);
  });

  it('a typeset minus reads in a signed row', () => {
    const { dir, index: i0, body } = setup();
    const f = path.join(dir, ADA);
    fs.writeFileSync(f, readText(f).replace('| Initiative | +2 |', '| Initiative | \u22121 |'));
    const ada = readPcs(body, buildIndex(dir), [ADA]).pcs[0];
    assert.strictEqual(ada.init, -1);
  });

  it('pc numbers: first numeric row wins', () => {
    const { index, body } = setup();
    const ada = readPcs(body, index, [ADA]).pcs[0];
    assert.strictEqual(ada.init, 2);
    assert.strictEqual(ada.ac, 14);
    assert.strictEqual(ada.hpMax, 30);
    assert.strictEqual(ada.hpNow, 22);
  });

  it('inline open threads read, a dash reads empty', () => {
    const { index, body } = setup();
    const [ada, ben] = readPcs(body, index, [ADA, BEN]).pcs;
    assert.strictEqual(ada.thread, 'The tracks at the gate');
    assert.strictEqual(ben.thread, '');
    const { dir } = setup();
    fs.writeFileSync(path.join(dir, BEN), readText(path.join(dir, BEN)).replace('**Open threads:** —', '**Open threads:** the sealed letter'));
    const i2 = buildIndex(dir);
    assert.strictEqual(readPcs(body, i2, [BEN]).pcs[0].thread, 'the sealed letter');
  });

  it('a line for no party pc is kept as unmatched', () => {
    const { index, body } = setup();
    const r = readPcs(body, index, [ADA, BEN]);
    assert.strictEqual(r.unmatched.length, 2);
    assert.deepStrictEqual(r.unmatched[0], { section: 'PC Roster & Arcs', text: "Current state: each PC's `## Current Status`." });
    assert.strictEqual(r.unmatched[1].section, 'Spotlight Forecast');
    assert.match(r.unmatched[1].text, /Nobody PC/);
  });

  it('no party warns', () => {
    const { index, body } = setup();
    const r = readPcs(body, index, []);
    assert.deepStrictEqual(r.pcs, []);
    assert.strictEqual(r.warnings.length, 1);
    assert.strictEqual(r.warnings[0].kind, 'no-party');
    assert.strictEqual(r.warnings[0].text, 'no party was given: the sheet shows no PCs');
    // with no party every Plan line has nowhere to go and is kept
    assert.ok(r.unmatched.length >= 4);
  });

  it('a non-pc path warns and is skipped', () => {
    const { index, body } = setup();
    const r = readPcs(body, index, [ADA, 'Characters/NPCs/Brother Ash.md', 'Nowhere/Nobody.md']);
    assert.deepStrictEqual(r.pcs.map((p) => p.name), ['Ada Moss']);
    assert.deepStrictEqual(r.warnings.map((w) => w.kind), ['not-a-pc', 'missing-pc']);
    assert.match(r.warnings[1].text, /in the party but not in the vault/);
  });

  it('people read four columns', () => {
    const { index, body } = setup();
    const r = readPeople(body, index);
    assert.deepStrictEqual(r.people.map((p) => p.name), ['Brother Ash', 'Sister Fen', 'Lucan Grey']);
    const ash = r.people[0];
    assert.strictEqual(ash.note, 'Characters/NPCs/Brother Ash.md');
    assert.strictEqual(ash.now, 'Gate warden — Wants the bell rung');
    assert.strictEqual(ash.where, '[[The Gate]]');
    assert.strictEqual(ash.cells.length, 4);
    assert.match(ash.key, /^p-/);
  });

  it('a creature person plays as its Behaviour', () => {
    const { index } = setup();
    const r = readPeople('## NPC Quick Reference\n\n| NPC | Role | Detail | Location |\n|---|---|---|---|\n| [[Frost Wolf]] | Pack | hunts | [[The Gate]] |\n| [[Ghost Of Nobody]] | x | y | z |\n', index);
    assert.strictEqual(r.people.length, 2);
    assert.strictEqual(r.people[0].playAs, 'Hunts in packs and flees when the alpha falls.');
    assert.strictEqual(r.people[1].note, null);
    assert.strictEqual(r.people[1].playAs, '');
    assert.ok(r.warnings.some((w) => w.kind === 'no-note'));
  });

  it('prose lines in handouts and people are kept as leftover', () => {
    const { index } = setup();
    assert.deepStrictEqual(readHandouts('## Handouts & Props\n\nNo handouts or props.\n', index), { handouts: [], leftover: 'No handouts or props.' });
    const r = readPeople('## NPC Quick Reference\n\nAsh is in the gate house.\n\n| NPC | Role | Detail | Location |\n|---|---|---|---|\n| [[Brother Ash]] | a | b | c |\n', index);
    assert.strictEqual(r.leftover, 'Ash is in the gate house.');
    assert.strictEqual(r.people.length, 1);
  });

  it('prose lines in roster, touchpoint and spotlight go to unmatched', () => {
    const { index } = setup();
    const plan = '## PC Roster & Arcs\n\n- **[[Ada Moss]]:** stage: call.\n\nCurrent state: each PC\'s `## Current Status`.\n\n## Touchpoint Plan\n\nNone this week.\n';
    const r = readPcs(plan, index, [ADA]);
    assert.deepStrictEqual(r.unmatched, [
      { section: 'PC Roster & Arcs', text: "Current state: each PC's `## Current Status`." },
      { section: 'Touchpoint Plan', text: 'None this week.' },
    ]);
    assert.strictEqual(r.pcs[0].arc, 'stage: call.');
  });

  it('a bullet spotlight line is the moment', () => {
    const { index } = setup();
    const r = readPcs('## Spotlight Forecast\n\n- **Ada:** three shards in her coat\n', index, [ADA]);
    assert.strictEqual(r.pcs[0].moment, 'three shards in her coat');
    assert.strictEqual(r.pcs[0].role, '');
  });

  it('a shared first name is not guessed', () => {
    const { dir } = setup();
    fs.writeFileSync(path.join(dir, 'Characters/PCs/Ada Quill.md'), '---\ntype: pc\nplayer_name: Lee\n---\n\nHi.\n');
    const index = buildIndex(dir);
    const plan = '## Spotlight Forecast\n\n- **Ada:** shared\n- **Ada Moss:** exact\n';
    const r = readPcs(plan, index, [ADA, 'Characters/PCs/Ada Quill.md']);
    assert.deepStrictEqual(r.unmatched, [{ section: 'Spotlight Forecast', text: '**Ada:** shared' }]);
    assert.strictEqual(r.pcs.find((p) => p.name === 'Ada Moss').moment, 'exact');
    assert.ok(r.warnings.some((w) => w.kind === 'ambiguous-pc' && w.text.includes('Ada')));
  });

  it('a row with no name is kept, not skipped', () => {
    const { index } = setup();
    const h = readHandouts('## Handouts & Props\n\n| Doc | Scene | Status | Notes |\n|---|---|---|---|\n| | 2 | to build | a torn page |\n', index);
    assert.deepStrictEqual(h.handouts, []);
    assert.strictEqual(h.leftover, ' | 2 | to build | a torn page'.trim());
    const r = readPeople('## NPC Quick Reference\n\n| NPC | Role | Detail | Location |\n|---|---|---|---|\n| | a | b | c |\n', index);
    assert.deepStrictEqual(r.people, []);
    assert.strictEqual(r.leftover, '| a | b | c');
    const p = readPcs('## Spotlight Forecast\n\n| PC | Role | Moment |\n|---|---|---|\n| | Scout | sees it |\n', index, [ADA]);
    assert.deepStrictEqual(p.unmatched, [{ section: 'Spotlight Forecast', text: '| Scout | sees it' }]);
  });
  it('a touchpoint row keeps every cell', () => {
    const { index } = setup();
    const plan = '## Touchpoint Plan\n\n| PC | When | What | Who | Why |\n|---|---|---|---|---|\n| [[Ben Hart]] | scene 2 | the letter | Ash | it is his | \n';
    const r = readPcs(plan, index, [BEN]);
    assert.strictEqual(r.pcs[0].touch, 'scene 2 · the letter · Ash · it is his');
  });

  it('a bullet\'s parenthesis is kept unless it names the player', () => {
    const { index } = setup();
    const plan = '## PC Roster & Arcs\n\n- **[[Ben Hart]]** (whisper, scene 2): the letter\n- **[[Ada Moss]]** (Pat): the tracks\n';
    const r = readPcs(plan, index, [ADA, BEN]);
    assert.strictEqual(r.pcs.find((p) => p.name === 'Ben Hart').arc, '(whisper, scene 2) the letter');
    assert.strictEqual(r.pcs.find((p) => p.name === 'Ada Moss').arc, 'the tracks');
  });

  it('a party PC whose frontmatter does not parse warns unreadable-pc', () => {
    const { dir } = setup();
    fs.writeFileSync(path.join(dir, BEN), '---\ntype: pc\nname: [unclosed\n---\n\nHi.\n');
    const index = buildIndex(dir);
    const r = readPcs('', index, [ADA, BEN]);
    assert.deepStrictEqual(r.pcs.map((p) => p.name), ['Ada Moss']);
    assert.deepStrictEqual(r.warnings.map((w) => [w.kind, w.note]), [['unreadable-pc', BEN]]);
    assert.match(r.warnings[0].text, /frontmatter does not parse, so it cannot be read as a PC/);
  });

  it('a handout keeps its first cell as its name', () => {
    const { index } = setup();
    const h = readHandouts('## Handouts & Props\n\n| Handout | Scene | Status | Notes |\n|---|---|---|---|\n'
      + '| A bloodied glove | Scene 1 | ready | |\n| [[Lost Letter]] | Scene 2 | to build | |\n'
      + "| [[Ash's Note]] (water-stained) | Scene 1 | ready | soaked |\n\n- A coin\n", index).handouts;
    assert.deepStrictEqual(h.map((x) => [x.name, x.note]), [
      ['A bloodied glove', null],
      ['[[Lost Letter]]', null],
      ["[[Ash's Note]] (water-stained)", "Chapters/Chapter 1/Props/Ash's Note.md"],
      ['A coin', null],
    ]);
    assert.deepStrictEqual(Object.keys(h[0]), ['key', 'note', 'name', 'scene', 'status', 'text']);
  });

  it('one NPC on two Quick Reference rows gets two keys', () => {
    const { index } = setup();
    const r = readPeople('## NPC Quick Reference\n\n| NPC | Role | Detail | Location |\n|---|---|---|---|\n'
      + '| [[Brother Ash]] | warden | a | b |\n| [[Brother Ash]] | later | c | d |\n', index);
    assert.strictEqual(r.people.length, 2);
    assert.strictEqual(r.people[1].key, `${r.people[0].key}~2`);
  });

  it('a Quick Reference link to several notes says so', () => {
    const { index } = setup();
    const r = readPeople('## NPC Quick Reference\n\n| NPC | Role | Detail | Location |\n|---|---|---|---|\n| [[index]] | a | b | c |\n', index);
    assert.deepStrictEqual(r.warnings.map((w) => w.kind), ['ambiguous-link']);
    assert.match(r.warnings[0].text, /\[\[index\]\] names several notes/);
  });
});
