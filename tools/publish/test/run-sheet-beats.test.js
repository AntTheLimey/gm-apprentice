'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildIndex } = require('../lib/run-sheet/notes');
const { readBeats } = require('../lib/run-sheet/beats');
const { playAsOf, wantsOf } = require('../lib/run-sheet/people-from-notes');

const FIXTURE = path.join(__dirname, 'fixtures', 'run-sheet');
const PLAN = 'Chapters/Chapter 1/Sessions/Session 02/Session 02 - The Test - Plan.md';

function copy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-'));
  fs.cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

function read(edit) {
  const dir = copy();
  if (edit) {
    const p = path.join(dir, PLAN);
    fs.writeFileSync(p, edit(fs.readFileSync(p, 'utf8')));
  }
  const index = buildIndex(dir);
  return { index, ...readBeats(index.read(PLAN).body, index) };
}

const byTitle = (beats, title, n = 0) => beats.filter((b) => b.title === title)[n];
const whoOf = (beat, name) => beat.who.find((w) => w.name === name);

describe('run sheet beats', () => {
  it('planned scenes then contingencies in Plan order', () => {
    const { beats, claimed, preamble } = read();
    assert.deepStrictEqual(beats.map((b) => b.title),
      ['The Gate', 'The Bell Tower', 'Dawn (hub)', 'The Gate', 'On the Road (routing)', 'The Wolves Return']);
    assert.deepStrictEqual(beats.map((b) => b.contingency), [false, false, false, false, false, true]);
    assert.notStrictEqual(beats[0].key, beats[3].key);
    assert.ok(beats[0].key.startsWith('b-'));
    assert.ok(beats[5].key.startsWith('c-'));
    assert.deepStrictEqual(claimed, { 'Planned Scenes': true, 'Contingency Scenes': true });
    // the sections' own lines before the first scene are handed back, not dropped
    assert.deepStrictEqual(preamble, {
      'Planned Scenes': 'Checklists for improvisation, not prose to read.',
      'Contingency Scenes': 'Scenes that fire on a player choice or a clock, not by default.',
    });
    for (const b of beats) assert.deepStrictEqual(b.foes, []);
    assert.doesNotThrow(() => JSON.stringify(beats));
  });

  it('scene note heading pulls the note and keeps both starts', () => {
    const { beats } = read();
    const b = byTitle(beats, 'The Bell Tower');
    assert.strictEqual(b.sceneNote, 'Chapters/Chapter 1/Scenes/The Bell Tower.md');
    assert.strictEqual(b.startsIt, "the note's start\n\ntonight's start");
    assert.strictEqual(b.situation, 'Sister Fen stands at the foot of the tower and will not climb.');
    assert.match(b.extra, /## Paused/);
    assert.match(b.extra, /The party left mid-climb\.\nFen is still waiting at the foot\./);
    assert.strictEqual(b.gmNotes, 'Fen cut the rope herself.');
    assert.doesNotMatch(b.extra, /Fen cut the rope/);
    assert.deepStrictEqual(b.entities, [
      'Locations/The Bell Tower Room.md',
      'Chapters/Chapter 1/Scenes/The Bell Tower.md',
      'Characters/NPCs/Brother Ash.md',
    ]);
    assert.strictEqual(b.place, 'Locations/The Bell Tower Room.md');
    assert.deepStrictEqual(b.spots.map((s) => [s.name, s.note]), [['The Bell Tower Room', 'Locations/The Bell Tower Room.md']]);
  });

  it('who reads counts and known-as', () => {
    const { beats } = read();
    const b = beats[0];
    assert.deepStrictEqual(b.who.map((w) => w.name), ['Brother Ash', 'Frost Wolf', 'Lucan Grey']);
    const wolf = whoOf(b, 'Frost Wolf');
    assert.strictEqual(wolf.count, 3);
    assert.strictEqual(wolf.knownAs, '');
    assert.strictEqual(wolf.wants, 'hunting');
    assert.strictEqual(wolf.note, 'Creatures/Frost Wolf.md');
    assert.strictEqual(wolf.playAs, 'Hunts in packs and flees when the alpha falls.');
    const lucan = whoOf(b, 'Lucan Grey');
    assert.strictEqual(lucan.knownAs, 'Lucan');
    assert.strictEqual(lucan.count, 1);
    assert.strictEqual(lucan.wants, 'helps');
    const ash = whoOf(b, 'Brother Ash');
    assert.strictEqual(ash.wants, 'wants the bell rung');
    assert.strictEqual(ash.playAs, 'slow, fond of the word "indeed" rubs his thumb along the rope scar');
    assert.strictEqual(new Set(b.who.map((w) => w.key)).size, 3);
    assert.ok(b.who.every((w) => w.key.startsWith(`${b.key}.who.`)));
  });

  it('who reads the form with the parenthesis outside the bold', () => {
    const { beats } = read((s) => s.replace('- **[[Brother Ash]]:** wants the bell rung',
      '- **[[Brother Ash]]** (the warden): wants the bell rung'));
    const ash = whoOf(beats[0], 'Brother Ash');
    assert.strictEqual(ash.knownAs, 'the warden');
    assert.strictEqual(ash.wants, 'wants the bell rung');
  });

  it('a Who line adds NPCs, skips PCs and keeps its words', () => {
    const { beats } = read();
    const b = byTitle(beats, 'The Bell Tower');
    assert.deepStrictEqual(b.who.map((w) => w.name), ['Sister Fen']);
    assert.strictEqual(b.who[0].note, 'Characters/NPCs/Sister Fen.md');
    // words no field holds keep the whole line, as written
    assert.match(b.extra, /\*\*Who:\*\* \[\[Sister Fen\]\], \[\[Ada Moss\]\] and the bell-ringer/);
  });

  it('a Who line with a connective keeps its line, not a residue', () => {
    const { beats } = read((t) => t.replace('**Who:** [[Sister Fen]], [[Ada Moss]] and the bell-ringer',
      '**Who:** [[Sister Fen]], [[Brother Venn]] or [[Abbot Rime]].'));
    const b = byTitle(beats, 'The Bell Tower');
    assert.deepStrictEqual(b.who.map((w) => w.name), ['Sister Fen', 'Brother Venn', 'Abbot Rime']);
    assert.match(b.extra, /\*\*Who:\*\* \[\[Sister Fen\]\], \[\[Brother Venn\]\] or \[\[Abbot Rime\]\]\./);
    assert.doesNotMatch(b.extra, /\*\*Who:\*\* or/);
  });

  it('a Who line of names and list separators is held whole', () => {
    const { beats } = read((t) => t.replace('**Who:** [[Sister Fen]], [[Ada Moss]] and the bell-ringer',
      '**Who:** [[Sister Fen]], [[Ada Moss]] and [[Brother Venn]].'));
    const b = byTitle(beats, 'The Bell Tower');
    assert.deepStrictEqual(b.who.map((w) => w.name), ['Sister Fen', 'Brother Venn']);
    assert.doesNotMatch(b.extra, /Who/);
  });

  it('placeholder play-as is left blank', () => {
    const { beats, index } = read();
    assert.strictEqual(whoOf(byTitle(beats, 'The Bell Tower'), 'Sister Fen').playAs, '');
    assert.strictEqual(playAsOf('Characters/NPCs/Sister Fen.md', index), '');
    assert.strictEqual(playAsOf(null, index), '');
    assert.strictEqual(wantsOf('Characters/NPCs/Sister Fen.md', index), 'The lamps lit.');
    assert.strictEqual(wantsOf(null, index), '');
  });

  it('hub spots hold places with and without notes', () => {
    const { beats } = read();
    const b = byTitle(beats, 'Dawn (hub)');
    assert.deepStrictEqual(b.spots.map((s) => [s.name, s.note]), [
      ['The Gate House', 'Locations/The Gate House.md'],
      ['The Chapel Yard', 'Locations/The Chapel Yard.md'],
      ['The orchard', null],
    ]);
    assert.ok(b.spots.every((s) => s.key.startsWith(`${b.key}.spot.`)));
    assert.deepStrictEqual(b.who.map((w) => [w.name, w.wants]),
      [['Lucan Grey', 'waiting with the map.'], ['Sister Fen', 'tends the lamps.']]);
    // the spots' own words stay on the sheet
    assert.match(b.extra, /the party can warm up here/);
    assert.match(b.extra, /Nobody is there\./);
    assert.doesNotMatch(b.extra, /waiting with the map/);
  });

  it('real hub: a spot group of bold-named bullets', () => {
    const index = buildIndex(copy());
    const plan = fs.readFileSync(path.join(__dirname, 'fixtures', 'run-sheet-hub-plan.md'), 'utf8');
    const { beats, warnings } = readBeats(plan, index);
    const b = beats[0];
    assert.deepStrictEqual(b.spots.map((s) => [s.name, s.note]), [
      ['The guest wing', null], ['The chapel', null], ['The walls', null],
      ['The Chapel Yard', 'Locations/The Chapel Yard.md'], ['The yard', null],
    ]);
    assert.deepStrictEqual(b.who.map((w) => [w.name, w.wants]), [
      ['Brother Ash', 'at the stair'], ['Lucan Grey', 'kept the fire.'],
      ['Sister Fen', 'caught with a knife.'], ['Frost Wolf', 'prowling.'],
    ]);
    // words no field holds stay, with their head; a PC is not a person here
    assert.strictEqual(b.extra, '**Open to the party**\n- **The walls:** the lamp carvings.\n- **The yard:** [[Ada Moss]] keeps watch.');
    assert.ok(!warnings.some((w) => w.kind === 'no-npcs-block'));
  });

  it('real hub: a spot group of plain bullets keeps its parenthesis', () => {
    const index = buildIndex(copy());
    const plan = fs.readFileSync(path.join(__dirname, 'fixtures', 'run-sheet-hub-plan.md'), 'utf8');
    const b = readBeats(plan, index).beats[1];
    assert.deepStrictEqual(b.spots.map((s) => [s.name, s.note]), [
      ['The guest register (Hollis)', null], ['Crane by the fire', null],
      ['The Gate House at dusk', 'Locations/The Gate House.md'],
    ]);
    assert.ok(!b.spots.some((s) => s.name === 'Open to the party'));
    assert.deepStrictEqual(b.who, []);
    assert.strictEqual(b.extra,
      '**Open to the party** (scenes 1–8, any order, any number)\n- The guest register (Hollis) — Scene 1\n- Crane by the fire — Scene 4');
  });

  it('a plain hub bullet is named by its first line', () => {
    const index = buildIndex(copy());
    const plan = fs.readFileSync(path.join(__dirname, 'fixtures', 'run-sheet-hub-plan.md'), 'utf8')
      .replace('- Crane by the fire — Scene 4\n', '- Crane by the fire\n  - he has the key\n')
      .replace('- [[The Gate House]] at dusk\n', '- [[The Gate House]] at dusk\n\n  The door sticks.\n');
    const b = readBeats(plan, index).beats[1];
    assert.deepStrictEqual(b.spots.map((s) => s.name), ['The guest register (Hollis)', 'Crane by the fire', 'The Gate House at dusk']);
    assert.match(b.extra, /- Crane by the fire\n  - he has the key/);
    assert.match(b.extra, /The door sticks\./);
  });

  it('scene note text after the GM fence is kept', () => {
    const dir = copy();
    const note = path.join(dir, 'Chapters/Chapter 1/Scenes/The Bell Tower.md');
    fs.appendFileSync(note, '\nAfter the fence.\n\n<!-- gm-only -->\nSecond secret.\n<!-- /gm-only -->\n');
    const index = buildIndex(dir);
    const b = byTitle(readBeats(index.read(PLAN).body, index).beats, 'The Bell Tower');
    assert.match(b.extra, /After the fence\./);
    assert.strictEqual(b.gmNotes, 'Fen cut the rope herself.\n\nSecond secret.');
    assert.doesNotMatch(b.extra, /secret/i);
  });

  it('an If table with its own header keeps the header in extra', () => {
    const { beats } = read((s) => s.replace('| Do | Then |', '| If | Then | Who |'));
    assert.match(beats[0].extra, /\| If \| Then \| Who \|/);
    assert.strictEqual(beats[0].ifs.length, 2);
  });

  it('a titled callout keeps its title in extra', () => {
    const { beats } = read((s) => s.replace('> Read-aloud: A black gate', '> [!quote] At the gate\n> Read-aloud: A black gate'));
    assert.strictEqual(beats[0].readAloud, 'Read-aloud: A black gate in a white wall, and a rope that ends in air.');
    assert.match(beats[0].extra, /> \[!quote\] At the gate/);
  });

  it('an NPCs block with no readable lines says so', () => {
    const { warnings } = read((s) => s.replace('**Starts it:** The bell has rung and the wolves are quiet.',
      '**Starts it:** The bell has rung and the wolves are quiet.\n**NPCs**\n- the night watch'));
    const w = warnings.find((x) => x.kind === 'no-npcs-block');
    assert.match(w.text, /has no NPC lines the sheet can read/);
  });

  it('a wrapped label keeps its second line', () => {
    const { beats } = read();
    assert.strictEqual(beats[0].situation,
      'The gate is shut and the bell rope hangs cut; Brother Ash will not open it until it rings.');
    assert.strictEqual(beats[0].startsIt, 'Ash calls down from the wall and asks who rings.');
  });

  it('checkbox points keep their text', () => {
    const { beats } = read();
    const b = beats[0];
    assert.deepStrictEqual(b.points.map((p) => ({ text: p.text, box: p.box })),
      [{ text: 'the tracks', box: true }, { text: 'the bell', box: false }, { text: 'the bell', box: false }]);
    assert.strictEqual(new Set(b.points.map((p) => p.key)).size, 3);
    assert.deepStrictEqual(b.treasure.map((t) => t.text), ['A silver bell clapper', 'Forty coins in the wall niche']);
    assert.ok(b.treasure[0].key.startsWith(`${b.key}.loot.`));
    assert.deepStrictEqual(b.ifs.map((r) => [r.do, r.then]),
      [['the tracks', 'the wolves close in'], ['Nobody engages by midnight', 'Ash rings it himself']]);
    assert.ok(b.ifs[0].key.startsWith(`${b.key}.if.`));
    assert.deepStrictEqual(b.handouts, ["Chapters/Chapter 1/Props/Ash's Note.md"]);
    assert.strictEqual(b.readAloud, 'Read-aloud: A black gate in a white wall, and a rope that ends in air.');
    assert.strictEqual(b.place, 'Locations/The Gate.md');
    assert.deepStrictEqual(b.entities, ['Characters/NPCs/Brother Ash.md', 'Locations/The Gate.md', 'Creatures/Frost Wolf.md']);
  });

  it('unlabelled text and unknown labels land in extra', () => {
    const { beats } = read();
    assert.strictEqual(beats[0].extra, '**Weather:** sleet, going to snow\n\nThe wolves are close enough to hear.');
    assert.strictEqual(byTitle(beats, 'On the Road (routing)').extra, 'Wherever the party goes next.');
  });

  it('text a field cannot fully take stays in extra', () => {
    const { beats } = read((s) => s
      .replace("**Handouts:** [[Ash's Note]]", "**Handouts:** [[Ash's Note]], passed down the wall")
      .replace('- **[[Lucan Grey]] (Lucan):** helps', '- **[[Lucan Grey]] (Lucan):** helps\n- a loose line under NPCs')
      .replace('**Points to land**', '**Complications**\n- The rope snaps.\n**Points to land**'));
    const b = beats[0];
    assert.deepStrictEqual(b.handouts, ["Chapters/Chapter 1/Props/Ash's Note.md"]);
    assert.match(b.extra, /passed down the wall/);
    assert.match(b.extra, /\*\*NPCs\*\*\n- a loose line under NPCs/);
    assert.strictEqual(b.complications, '- The rope snaps.');
    assert.doesNotMatch(b.extra, /rope snaps/);
  });

  it('contingency reads trigger, then and its NPCs', () => {
    const { beats } = read();
    const c = byTitle(beats, 'The Wolves Return');
    assert.strictEqual(c.contingency, true);
    assert.strictEqual(c.trigger, 'The bell rings twice.');
    assert.strictEqual(c.then, '- The pack comes down from the ridge.');
    const wolf = whoOf(c, 'Frost Wolf');
    assert.strictEqual(wolf.count, 2);
    assert.strictEqual(wolf.wants, 'hunting the bell-ringer');
    const missing = whoOf(c, 'Missing Person');
    assert.strictEqual(missing.note, null);
    assert.strictEqual(missing.playAs, '');
    assert.strictEqual(c.extra, '');
  });

  it('routing beat gives no warning; a beat without NPCs does', () => {
    const { warnings, beats } = read();
    const npc = warnings.filter((w) => w.kind === 'no-npcs-block');
    assert.strictEqual(npc.length, 1);
    assert.match(npc[0].text, /The Gate/);
    assert.strictEqual(byTitle(beats, 'The Gate', 1).who.length, 0);
  });

  it('a transition or Scene 0 beat gives no NPCs warning', () => {
    const { warnings } = read((s) => s
      .replace('**Situation:** The same gate, the next evening.', '**Type:** transition\n**Situation:** The same gate, the next evening.')
      .replace('### Scene 5: On the Road (routing)', '### Scene 0: Before'));
    assert.strictEqual(warnings.filter((w) => w.kind === 'no-npcs-block').length, 0);
  });

  it('missing-note warns once per name', () => {
    const { warnings, beats } = read();
    const miss = warnings.filter((w) => w.kind === 'missing-note');
    assert.strictEqual(miss.length, 1);
    assert.match(miss[0].text, /Missing Person/);
    const b = byTitle(beats, 'The Gate', 1);
    assert.deepStrictEqual(b.entities, ['Locations/The Gate.md']);
    // a line with a link the vault lacks stays whole in extra
    assert.match(b.extra, /\[\[Missing Person\]\]/);
  });

  it('an unresolved scene note heading still reads', () => {
    const { beats, warnings } = read((s) => s.replace('### [[The Bell Tower]]', '### [[No Such Scene]]'));
    const b = byTitle(beats, 'No Such Scene');
    assert.strictEqual(b.sceneNote, null);
    assert.strictEqual(b.startsIt, "tonight's start");
    assert.strictEqual(b.gmNotes, '');
    assert.ok(warnings.some((w) => w.kind === 'missing-note' && /No Such Scene/.test(w.text)));
  });

  it('a Plan with no scene sections reads as no beats', () => {
    const dir = copy();
    const index = buildIndex(dir);
    const out = readBeats('## Session Intent\n\nNothing planned.\n', index);
    assert.deepStrictEqual(out.beats, []);
    assert.deepStrictEqual(out.claimed, {});
    assert.deepStrictEqual(readBeats('', index).beats, []);
    assert.deepStrictEqual(readBeats(null, index).beats, []);
  });
});
