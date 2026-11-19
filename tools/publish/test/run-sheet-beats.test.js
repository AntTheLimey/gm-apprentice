'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { readText } = require('./helpers/run-sheet-lines');
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
    fs.writeFileSync(p, edit(readText(p)));
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
    const plan = readText(path.join(__dirname, 'fixtures', 'run-sheet-hub-plan.md'));
    const { beats, warnings } = readBeats(plan, index);
    const b = beats[0];
    assert.deepStrictEqual(b.spots.map((s) => [s.name, s.note]), [
      ['The guest wing', null], ['The chapel', null], ['The walls', null],
      ['The Chapel Yard', 'Locations/The Chapel Yard.md'], ['The yard', null],
    ]);
    // the people a bullet links are in who, and the bullet's words stay on its spot, never in their wants
    assert.deepStrictEqual(b.who.map((w) => [w.name, w.wants]), [
      ['Brother Ash', ''], ['Lucan Grey', ''], ['Sister Fen', ''], ['Frost Wolf', ''],
    ]);
    assert.deepStrictEqual(b.spots.map((x) => x.md), [
      '[[Brother Ash]] at the stair; [[Lucan Grey]] kept the fire.', '[[Sister Fen]], caught with a knife.',
      'the lamp carvings.', '[[Frost Wolf]] prowling.', '[[Ada Moss]] keeps watch.',
    ]);
    // every word is on a spot, so nothing is left over; a PC is not a person here
    assert.strictEqual(b.extra, '');
    assert.ok(!warnings.some((w) => w.kind === 'no-npcs-block'));
  });

  it('real hub: pointer bullets are no spots, a bare location link is', () => {
    const index = buildIndex(copy());
    const plan = readText(path.join(__dirname, 'fixtures', 'run-sheet-hub-plan.md'));
    const b = readBeats(plan, index).beats[1];
    // the two `— Scene N` bullets lead to other scenes; the bare link to a location leads a place, as in #781
    assert.deepStrictEqual(b.spots.map((s) => [s.name, s.note]), [['The Gate House at dusk', 'Locations/The Gate House.md']]);
    assert.deepStrictEqual(b.who, []);
    assert.strictEqual(b.extra,
      '**Open to the party** (scenes 1–8, any order, any number)\n- The guest register (Hollis) — Scene 1\n- Crane by the fire — Scene 4');
  });

  it('a plain hub bullet is named by its first line', () => {
    const index = buildIndex(copy());
    const plan = readText(path.join(__dirname, 'fixtures', 'run-sheet-hub-plan.md'))
      .replace('- Crane by the fire — Scene 4\n', '- Crane by the fire\n  - he has the key\n')
      .replace('- [[The Gate House]] at dusk\n', '- [[The Gate House]] at dusk\n\n  The door sticks.\n');
    const b = readBeats(plan, index).beats[1];
    assert.deepStrictEqual(b.spots.map((s) => [s.name, s.md]), [['Crane by the fire', '- he has the key'], ['The Gate House at dusk', 'The door sticks.']]);
    assert.doesNotMatch(b.extra, /he has the key|The door sticks/);
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

  it('fenced code in a Plan is no field, quote or hub group, and stays in extra', () => {
    const fence = '```\n**Situation:** fake\n> example\n**Open to the party**\n- **The moat:** deep.\n**The orchard**: trees\n```';
    const { beats } = read((s) => s.replace('### [[The Bell Tower]]', `### [[The Bell Tower]] (hub)\n\n${fence}\n\n### Spare [[The Bell Tower]]`));
    const b = byTitle(beats, 'The Bell Tower (hub)');
    assert.notStrictEqual(b.situation, 'fake');
    assert.ok(!b.readAloud.includes('example'));
    assert.ok(!b.spots.some((x) => /moat|orchard/.test(x.name)));
    assert.ok(b.extra.includes(fence));
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
  it('a numbered or hub heading that is one link still reads its scene note', () => {
    for (const [heading, title] of [['### Scene 2: [[The Bell Tower]]', 'The Bell Tower'], ['### [[The Bell Tower]] (hub)', 'The Bell Tower (hub)']]) {
      const { beats, warnings } = read((s) => s.replace('### [[The Bell Tower]]', heading));
      const b = byTitle(beats, title);
      assert.ok(b, heading);
      assert.strictEqual(b.sceneNote, 'Chapters/Chapter 1/Scenes/The Bell Tower.md', heading);
      assert.strictEqual(b.gmNotes, 'Fen cut the rope herself.');
      assert.ok(!warnings.some((w) => w.kind === 'scene-note-not-read'), heading);
    }
    // the hub flag is kept: a hub beat gives no NPCs warning and reads spots
    const hub = read((s) => s.replace('### [[The Bell Tower]]', '### [[The Bell Tower]] (hub)'));
    assert.ok(!hub.warnings.some((w) => w.kind === 'no-npcs-block' && /Bell Tower/.test(w.text)));
  });

  it('a heading holding a link and other words warns that no scene note is read', () => {
    const { beats, warnings } = read((s) => s.replace('### [[The Bell Tower]]', '### Up [[The Bell Tower]] at night'));
    const b = byTitle(beats, 'Up [[The Bell Tower]] at night');
    assert.strictEqual(b.sceneNote, null);
    const w = warnings.filter((x) => x.kind === 'scene-note-not-read');
    assert.strictEqual(w.length, 1);
    assert.match(w[0].text, /Up \[\[The Bell Tower\]\] at night/);
  });

  it('one person on two NPC lines: written counts add up, otherwise the second line stays in extra', () => {
    const { beats } = read((s) => s.replace('- **[[Frost Wolf]] (3):** hunting', '- **[[Frost Wolf]] (3):** hunting\n- **[[Frost Wolf]] (2):** circling')
      .replace('- **[[Brother Ash]]:** wants the bell rung', '- **[[Brother Ash]]:** wants the bell rung\n- **[[Brother Ash]]:** again, at the gate'));
    const b = beats[0];
    assert.deepStrictEqual(b.who.map((w) => w.name), ['Brother Ash', 'Frost Wolf', 'Lucan Grey']);
    assert.strictEqual(whoOf(b, 'Frost Wolf').count, 5);
    assert.strictEqual(whoOf(b, 'Brother Ash').wants, 'wants the bell rung');
    assert.doesNotMatch(b.extra, /circling/);
    // the merged line's words are kept on the entry, not lost
    assert.strictEqual(whoOf(b, 'Frost Wolf').wants, 'hunting; circling');
    const same = read((s) => s.replace('- **[[Frost Wolf]] (3):** hunting', '- **[[Frost Wolf]] (3):** hunting\n- **[[Frost Wolf]] (2):** Hunting'));
    assert.strictEqual(whoOf(same.beats[0], 'Frost Wolf').wants, 'hunting');
    assert.strictEqual(whoOf(same.beats[0], 'Frost Wolf').count, 5);
    assert.match(b.extra, /\*\*\[\[Brother Ash\]\]:\*\* again, at the gate/);
    assert.strictEqual(new Set(b.who.map((w) => w.key)).size, b.who.length);
  });

  it('GM fences are read however they are typed', () => {
    const dir = copy();
    const note = path.join(dir, 'Chapters/Chapter 1/Scenes/The Bell Tower.md');
    fs.writeFileSync(note, readText(note).replace('<!-- gm-only -->', '<!--gm-only-->').replace('<!-- /gm-only -->', '<!-- / GM-ONLY -->')
      + '\nAfter.\n\n<!-- GM-ONLY -->\nSecond secret.\n<!--/gm-only-->\n');
    const index = buildIndex(dir);
    const b = byTitle(readBeats(index.read(PLAN).body, index).beats, 'The Bell Tower');
    assert.strictEqual(b.gmNotes, 'Fen cut the rope herself.\n\nSecond secret.');
    assert.doesNotMatch(b.extra, /secret|rope herself/i);
    assert.match(b.extra, /After\./);
  });

  it('a link list with a full stop or a middle dot is held whole', () => {
    const { beats } = read((s) => s.replace("**Handouts:** [[Ash's Note]]", "**Handouts:** [[Ash's Note]].")
      .replace('**Who:** [[Sister Fen]], [[Ada Moss]] and the bell-ringer', '**Who:** [[Sister Fen]] · [[Brother Venn]]'));
    assert.doesNotMatch(beats[0].extra, /Handouts/);
    assert.deepStrictEqual(beats[0].handouts, ["Chapters/Chapter 1/Props/Ash's Note.md"]);
    const tower = byTitle(beats, 'The Bell Tower');
    assert.deepStrictEqual(tower.who.map((w) => w.name), ['Sister Fen', 'Brother Venn']);
    assert.doesNotMatch(tower.extra, /Who/);
  });

  it('a link to several notes or to a skipped folder says so, not "matches no note"', () => {
    const dir = copy();
    fs.mkdirSync(path.join(dir, '_archive'), { recursive: true });
    fs.writeFileSync(path.join(dir, '_archive', 'Old Ruin.md'), '---\ntype: location\n---\n');
    const p = path.join(dir, PLAN);
    fs.writeFileSync(p, readText(p).replace('**Entities:** [[The Gate]], [[Missing Person]]', '**Entities:** [[The Gate]], [[index]], [[Old Ruin]]'));
    const index = buildIndex(dir);
    const { warnings } = readBeats(index.read(PLAN).body, index);
    assert.ok(warnings.some((w) => w.kind === 'ambiguous-link' && /\[\[index\]\] names several notes/.test(w.text)));
    assert.ok(warnings.some((w) => w.kind === 'excluded-note' && /\[\[Old Ruin\]\]/.test(w.text)));
    assert.ok(!warnings.some((w) => w.kind === 'missing-note' && /index|Old Ruin/.test(w.text)));
  });
});

// The Plan shape (Place line, hub block, NPCs, If table, Treasure), read from the fixture that
// plan-check's own tests hold to the template: tests/fixtures/plan-skeleton.md.
const REPO = path.join(__dirname, '..', '..', '..');
const SKELETON = path.join(REPO, 'tests', 'fixtures', 'plan-skeleton.md');
const SKELETON_VAULT = path.join(__dirname, 'fixtures', 'run-sheet-skeleton');
const PLAN_CHECK = path.join(REPO, 'skills', 'shared', 'scripts', 'plan_check.py');
const bodyOnly = (t) => t.replace(/^---\n[\s\S]*?\n---\n/, '');

// A scratch vault: the skeleton's linked notes, a `_meta` folder (plan-check finds its vault by it).
function skeletonVault() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-skel-'));
  fs.cpSync(SKELETON_VAULT, dir, { recursive: true });
  fs.mkdirSync(path.join(dir, '_meta'));
  return dir;
}

const planOf = (planned) => `---\ntype: session-plan\nsession: "[[S1]]"\nchapter: "[[C1]]"\n---\n\n## Planned Scenes\n\n${planned}\n`;

// One Plan through both programs: plan-check's finding ids, and the reader's beats.
function bothSides(planned) {
  const dir = skeletonVault();
  const file = path.join(dir, 'Plan.md');
  fs.writeFileSync(file, planOf(planned));
  const run = spawnSync('python3', [PLAN_CHECK, file, '--json'], { encoding: 'utf8' });
  const ids = JSON.parse(run.stdout).findings.map((f) => f.id);
  const index = buildIndex(dir);
  return { ids, ...readBeats(bodyOnly(readText(file)), index), index };
}

describe('run sheet beats: the Plan shape', () => {
  const read2 = (edit) => {
    const dir = skeletonVault();
    const text = edit ? edit(bodyOnly(readText(SKELETON))) : bodyOnly(readText(SKELETON));
    const index = buildIndex(dir);
    return readBeats(text, index);
  };

  it('the plan skeleton gives every feed', () => {
    const { beats, warnings } = read2();
    const [s1, hub, harbour, supper] = beats;
    assert.deepStrictEqual(beats.map((b) => b.title), ['[Title]', '[Title] (hub)', 'The Harbour Office', 'The Quiet Supper', '[Contingency Title]']);
    assert.deepStrictEqual([s1.place, s1.placeFrom, s1.placeText], ['Locations/Location.md', 'place', '']);
    assert.deepStrictEqual(s1.who.map((w) => [w.name, w.wants]), [['Name', 'wants X. Does Y if left alone.']]);
    assert.deepStrictEqual(s1.ifs.map((x) => x.do), ['A choice the table may make', 'Nobody engages by [time]']);
    assert.deepStrictEqual(s1.treasure.map((x) => x.text), ['An item the scene holds, one per bullet.']);
    assert.deepStrictEqual(s1.points.map((x) => x.text), ['A fact you must convey however the improv goes.']);
    // the hub: a Where they can go block makes it one; two spots with their words, and no pointer is a spot
    assert.deepStrictEqual(hub.spots.map((x) => [x.name, x.note, x.md]), [
      ['Location', 'Locations/Location.md', 'what is there, who is there ([[NPC]]), what changes when they arrive.'],
      ['Plain name', null, 'the same, when no location note fits.'],
    ]);
    assert.deepStrictEqual(hub.spots.map((x) => x.people), [['Characters/NPCs/NPC.md'], []]);
    assert.deepStrictEqual(hub.who.map((w) => [w.name, w.wants]), [['NPC', '']]);
    assert.deepStrictEqual(s1.spots.map((x) => x.people), [[]]);
    assert.match(hub.extra, /- A lead in words — Scene 3/);
    assert.match(hub.extra, /- \[\[Scene note\]\] — a lead to a scene/);
    // a place in plain words, then a place that is one link
    assert.deepStrictEqual([harbour.place, harbour.placeFrom, harbour.placeText], [null, null, 'The harbour office, up the stairs from the quay.']);
    assert.deepStrictEqual([supper.place, supper.placeFrom, supper.placeText], ['Locations/The Vicarage.md', 'place', '']);
    assert.deepStrictEqual(supper.spots.map((x) => x.note), ['Locations/The Vicarage.md']);
    assert.deepStrictEqual(supper.who.map((w) => w.name), ['The Vicar']);
    // a scene with a Place line owes no warning; a hub and a contingency owe none either
    assert.deepStrictEqual(warnings.filter((w) => w.kind === 'no-place'), []);
  });

  it('the where they can go block makes a hub without a title mark', () => {
    for (const head of ['**Where they can go**', '**Open to the party**']) {
      const { beats, warnings } = read2(() => `## Planned Scenes\n\n### Scene 4: The yard\n${head}\n- **[[Location]]:** apples, with [[NPC]] about\n- **The orchard:** hens\n`);
      assert.deepStrictEqual(beats[0].spots.map((x) => [x.name, x.md]), [['Location', 'apples, with [[NPC]] about'], ['The orchard', 'hens']], head);
      assert.deepStrictEqual(beats[0].who.map((w) => w.name), ['NPC']);
      assert.deepStrictEqual(warnings.filter((w) => w.kind === 'no-place' || w.kind === 'no-npcs-block'), [], head);
    }
  });

  it('pointer bullets are not spots', () => {
    const { beats } = read2(() => `## Planned Scenes\n\n### Scene 4: The yard\n**Where they can go**\n- the cellar door — Scene 3\n- **Cellar door** — Scene 3\n- **[[Name]]** — Scene 3 (locked)\n- **[[Scene note]]:** what follows\n- **The orchard:** hens\n`);
    assert.deepStrictEqual(beats[0].spots.map((x) => x.name), ['The orchard']);
    // a pointer's words are not dropped: they stay in extra, and name no person
    assert.match(beats[0].extra, /the cellar door — Scene 3/);
    assert.match(beats[0].extra, /\*\*\[\[Name\]\]\*\* — Scene 3 \(locked\)/);
    assert.deepStrictEqual(beats[0].who, []);
  });

  it('a place line with words keeps them and gives no place', () => {
    const { beats } = read2(() => '## Planned Scenes\n\n### Scene 4: The yard\n**Situation:** s\n**Place:** [[Location]] after dark\n**Entities:** [[Location]]\n**NPCs**\n- **[[Name]]:** x\n');
    assert.strictEqual(beats[0].place, null);
    assert.strictEqual(beats[0].placeFrom, null);
    assert.strictEqual(beats[0].placeText, '[[Location]] after dark');
    assert.deepStrictEqual(beats[0].spots, []);
    assert.doesNotMatch(beats[0].extra, /Place/);
  });

  it("the plan's place wins over the scene note's", () => {
    const dir = skeletonVault();
    fs.writeFileSync(path.join(dir, 'Scenes', 'Scene note.md'), '---\nname: Scene note\ntype: scene\nlocations: ["[[Location]]"]\n---\n\n**Situation:** s\n');
    const plan = (place) => `## Planned Scenes\n\n### [[Scene note]]\n${place}**NPCs**\n- **[[Name]]:** x\n`;
    const noLine = readBeats(plan(''), buildIndex(dir)).beats[0];
    assert.deepStrictEqual([noLine.place, noLine.placeFrom], ['Locations/Location.md', 'scene-note']);
    const withLine = readBeats(plan('**Place:** [[The Vicarage]]\n'), buildIndex(dir)).beats[0];
    assert.deepStrictEqual([withLine.place, withLine.placeFrom], ['Locations/The Vicarage.md', 'place']);
    const entities = readBeats('## Planned Scenes\n\n### Scene 4: Y\n**Entities:** [[Location]]\n**NPCs**\n- **[[Name]]:** x\n', buildIndex(dir)).beats[0];
    assert.deepStrictEqual([entities.place, entities.placeFrom], ['Locations/Location.md', 'entities']);
    const over = readBeats('## Planned Scenes\n\n### Scene 4: Y\n**Entities:** [[Location]]\n**Place:** [[The Vicarage]]\n**NPCs**\n- **[[Name]]:** x\n', buildIndex(dir)).beats[0];
    assert.deepStrictEqual([over.place, over.placeFrom], ['Locations/The Vicarage.md', 'place']);
  });

  it('a bulleted place line reads like a plain one', () => {
    const { beats } = read2(() => '## Planned Scenes\n\n### Scene 4: Y\n- **Place:** [[The Vicarage]]\n');
    assert.deepStrictEqual([beats[0].place, beats[0].placeFrom], ['Locations/The Vicarage.md', 'place']);
  });

  it('a plan without the new lines reads as before', () => {
    const { beats, warnings } = read();
    // #781's fixture: every beat's new fields are empty, and a spot's md is ''; no no-place warning
    for (const b of beats) {
      assert.strictEqual(b.placeText, '');
      assert.strictEqual(b.placeFrom, { null: null, 'The Bell Tower': 'scene-note' }[b.place === null ? 'null' : b.title] || (b.place ? 'entities' : null));
      for (const x of b.spots) assert.strictEqual(x.md, '');
    }
    assert.deepStrictEqual(warnings.filter((w) => w.kind === 'no-place'), []);
    // its hub Plan (`**Open to the party**`): the two `— Scene N` bullets are pointers, so their
    // spots are gone and their lines stay in extra; the S1 group's people lose their wants to the
    // spot's md. Nothing else differs.
    const hubPlan = readText(path.join(__dirname, 'fixtures', 'run-sheet-hub-plan.md'));
    const hub = readBeats(hubPlan, buildIndex(copy())).beats;
    assert.deepStrictEqual(hub[1].spots.map((x) => x.name), ['The Gate House at dusk']);
    assert.strictEqual(hub[0].spots.length, 5);
  });

  describe('both sides agree', () => {
    const SCENE = (rest, place = '**Place:** The orchard\n') => `### Scene 1: Supper\n**Situation:** s\n${place}**Starts it:** t\n${rest}`;

    it('no place line: plan-check no-place, reader place null', () => {
      const r = bothSides(SCENE('', ''));
      assert.ok(r.ids.includes('no-place'));
      assert.deepStrictEqual([r.beats[0].place, r.beats[0].placeText], [null, '']);
      assert.ok(r.warnings.some((w) => w.kind === 'no-place'));
      // and with one, neither complains
      const ok = bothSides(SCENE(''));
      assert.ok(!ok.ids.includes('no-place'));
      assert.ok(!ok.warnings.some((w) => w.kind === 'no-place'));
      assert.strictEqual(ok.beats[0].placeText, 'The orchard');
    });

    it('people in Entities with no block: plan-check no-npcs-block, reader who 0', () => {
      const r = bothSides(SCENE('**Entities:** [[Name]]\n'));
      assert.ok(r.ids.includes('no-npcs-block'));
      assert.deepStrictEqual(r.beats[0].who, []);
      assert.ok(r.warnings.some((w) => w.kind === 'no-npcs-block'));
    });

    it('a hub with no places and no leads: plan-check hub-no-places, reader spots 0', () => {
      const r = bothSides('### Scene 0: Out (hub)\n**Where they can go**\nJust words, no bullets.\n');
      assert.ok(r.ids.includes('hub-no-places'));
      assert.deepStrictEqual(r.beats[0].spots, []);
    });

    it('a hub place that is no location: plan-check hub-place-not-location, reader gives no place there', () => {
      const r = bothSides('### Scene 0: Out (hub)\n**Where they can go**\n- **[[Name]]:** the clerk\n');
      assert.ok(r.ids.includes('hub-place-not-location'));
      const note = r.beats[0].spots[0].note;
      assert.strictEqual(r.index.read(note).fm.type, 'npc'); // the spot's note is no location
    });

    it('npcs in parentheses: plan-check label-form, reader who 0', () => {
      const r = bothSides(SCENE('**NPCs (in the room)**\n- **[[Name]]:** x\n'));
      assert.ok(r.ids.includes('label-form'));
      assert.deepStrictEqual(r.beats[0].who, []);
    });

    it('an unlabelled table: plan-check if-table-unlabelled, reader ifs 0', () => {
      const r = bothSides(SCENE('| Do | Then |\n|---|---|\n| a | b |\n'));
      assert.ok(r.ids.includes('if-table-unlabelled'));
      assert.deepStrictEqual(r.beats[0].ifs, []);
      const ok = bothSides(SCENE('**If the players...**\n| Do | Then |\n|---|---|\n| a | b |\n'));
      assert.ok(!ok.ids.includes('if-table-unlabelled'));
      assert.strictEqual(ok.beats[0].ifs.length, 1);
    });

    it('a bare link first: a pointer only when it links a scene note, in both', () => {
      const lead = (link) => `### Scene 0: Out (hub)\n**Where they can go**\n- ${link} at dusk\n`;
      for (const [link, pointer] of [['[[Location]]', false], ['[[Scene note]]', true], ['[[No Such Note]]', false]]) {
        const r = bothSides(lead(link));
        // plan-check: a lead is a pointer, a link is a place; either way the hub is not empty
        assert.ok(!r.ids.includes('hub-no-places'), link);
        assert.strictEqual(r.beats[0].spots.length, pointer ? 0 : 1, link);
      }
    });

    it('a pointer with trailing words is a pointer in both', () => {
      for (const bullet of ['- **[[Name]]** — Scene 3 (locked)', '- **[[Name]]** — Scene 3, locked tight', '- **[[Name]]** — Scene 3']) {
        const r = bothSides(`### Scene 0: Out (hub)\n**Where they can go**\n${bullet}\n`);
        // plan-check: a pointer, so not a place (no hub-place-not-location) and the hub holds a lead
        assert.deepStrictEqual(r.ids.filter((id) => id.startsWith('hub-')), [], bullet);
        // reader: the same bullet is no spot
        assert.deepStrictEqual(r.beats[0].spots, [], bullet);
      }
    });
  });
});