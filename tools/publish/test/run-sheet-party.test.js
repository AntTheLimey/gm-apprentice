'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildIndex } = require('../lib/run-sheet/notes');
const { readHandouts } = require('../lib/run-sheet/handouts');
const { readPcs } = require('../lib/run-sheet/party');
const { readPeople } = require('../lib/run-sheet/people');
const { writeSettings } = require('./helpers/vault-files');
const { makePng } = require('./helpers/make-png');

const FIXTURE = path.join(__dirname, 'fixtures', 'run-sheet');
const PLAN = 'Chapters/Chapter 1/Sessions/Session 02/Session 02 - The Test - Plan.md';
const ADA = 'Characters/PCs/Ada Moss.md';
const BEN = 'Characters/PCs/Ben Hart.md';

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-'));
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
    const h = readHandouts(body, index);
    assert.strictEqual(h.length, 1);
    assert.strictEqual(h[0].note, "Chapters/Chapter 1/Props/Ash's Note.md");
    assert.strictEqual(h[0].scene, 'Scene 1');
    assert.strictEqual(h[0].status, 'to build');
    assert.strictEqual(h[0].text, 'What Ash passes down the wall');
    assert.match(h[0].key, /^handouts\.ho\./);
  });

  it('handouts read as bullets', () => {
    const { index } = setup();
    const h = readHandouts('## Handouts & Props\n\n- A torn map of [[The Gate]]\n- A coin\n', index);
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
    fs.writeFileSync(path.join(dir, BEN), fs.readFileSync(path.join(dir, BEN), 'utf8').replace('**Open threads:** —', '**Open threads:** the sealed letter'));
    const i2 = buildIndex(dir);
    assert.strictEqual(readPcs(body, i2, [BEN]).pcs[0].thread, 'the sealed letter');
  });

  it('a line for no party pc is kept as unmatched', () => {
    const { index, body } = setup();
    const r = readPcs(body, index, [ADA, BEN]);
    assert.strictEqual(r.unmatched.length, 1);
    assert.strictEqual(r.unmatched[0].section, 'Spotlight Forecast');
    assert.match(r.unmatched[0].text, /Nobody PC/);
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
    assert.deepStrictEqual(r.warnings.map((w) => w.kind), ['not-a-pc', 'not-a-pc']);
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
});
