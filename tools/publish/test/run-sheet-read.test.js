'use strict';
const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readRunSheet, completeness } = require('../lib/run-sheet/read');
const { normalise } = require('../lib/run-sheet/keys');
const { writeSettings } = require('./helpers/vault-files');
const { haystack, missingLines, readText } = require('./helpers/run-sheet-lines');

// Every scratch dir is removed when the file's tests finish.
const made = [];
const mkTmp = (prefix) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); made.push(d); return d; };
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

const FIXTURE = path.join(__dirname, 'fixtures', 'run-sheet');
const PLAN = 'Chapters/Chapter 1/Sessions/Session 02/Session 02 - The Test - Plan.md';
const ADA = 'Characters/PCs/Ada Moss.md';
const BEN = 'Characters/PCs/Ben Hart.md';
const PARTY = [ADA, BEN];

function copy() {
  const dir = mkTmp('rs-');
  fs.cpSync(FIXTURE, dir, { recursive: true });
  writeSettings(dir, { 'vault.system': 'dnd5e' });
  return dir;
}

const write = (dir, rel, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
};
const LUCAN_NOTE = 'Characters/NPCs/Lucan Grey.md';
const bodyOf = (text) => text.replace(/^---\n[\s\S]*?\n---\n/, '');

// The reverse: each line a beat keeps in `extra` is a line its sources hold (the Plan, the scene
// notes), never words a reader made up, such as a `**Who:** or .` residue.
function strayLines(dir, planBody, model) {
  const notes = model.beats.map((b) => b.sceneNote).filter(Boolean).map((p) => readText(path.join(dir, p)));
  const src = normalise([planBody, ...notes].join('\n¶\n'));
  return model.beats.flatMap((b) => b.extra.split('\n')).filter((l) => l.trim() && !src.includes(normalise(l)));
}

describe('run sheet reader', () => {
  it('reads the fixture plan end to end', () => {
    const dir = copy();
    const m = readRunSheet(dir, PLAN, { party: PARTY });
    // the settings' alias `dnd5e` reads as the tool's id for the system
    assert.strictEqual(m.system, 'dnd-5e-2024');
    assert.strictEqual(m.plan, PLAN);
    assert.deepStrictEqual(m.session, {
      index: 'Chapters/Chapter 1/Sessions/Session 02/Session 02 - The Test.md',
      title: 'Session 02 - The Test',
      chapter: 'Chapters/Chapter 1/Chapter 1.md',
      number: 2,
    });
    assert.match(m.brief.overview, /\[\[Brother Ash\]\] guards it/);
    assert.match(m.brief.world, /third of Frostfall/);
    assert.match(m.brief.stops, /The bell is rung/);
    assert.match(m.threads, /The tracks lead to the gate/);
    assert.strictEqual(m.beats.length, 6);
    assert.strictEqual(m.pcs.length, 2);
    assert.deepStrictEqual(m.people.map((p) => p.name), ['Brother Ash', 'Sister Fen', 'Lucan Grey']);
    // first seen: the Quick Reference names three before the scenes, the scene note adds the fourth
    assert.deepStrictEqual(m.places, [
      'Locations/The Gate.md', 'Locations/The Chapel Yard.md', 'Locations/The Gate House.md', 'Locations/The Bell Tower Room.md',
    ]);
    assert.strictEqual(new Set(m.places).size, m.places.length);
    assert.deepStrictEqual(m.maps, ['Documents/Map of the Gate.md']);
    assert.strictEqual(m.handouts.length, 1);
    const titles = m.prep.map((p) => p.title);
    assert.ok(titles.includes('Table Talk'));
    assert.deepStrictEqual(titles, [
      'Session Intent', 'GM Notes', 'Previously On...', 'World State', 'Planned Scenes', 'Contingency Scenes',
      'Open Questions', 'Gaps & Actions', 'Table Talk',
    ]);
    // foes are filled per beat: Ash, three wolves, Lucan as an ally
    const gate = m.beats[0];
    assert.deepStrictEqual(gate.foes.map((f) => f.name), ['Brother Ash', 'Frost Wolf 1', 'Frost Wolf 2', 'Frost Wolf 3', 'Lucan Grey']);
    assert.strictEqual(gate.foes[4].ally, true);
    // the beats carry their Type and any arrivals; every fight row has a prepNote (null where the beat can fight)
    assert.ok(m.beats.every((b) => typeof b.type === 'string' && Array.isArray(b.arrivals)));
    assert.ok(m.beats.flatMap((b) => b.foes).every((f) => 'prepNote' in f));
    // run long: the next Plan, the unplayed scenes, the Planning notes, the contingencies
    assert.strictEqual(m.runLong.nextPlan, 'Chapters/Chapter 1/Sessions/Session 03/Session 03 - Next - Plan.md');
    assert.deepStrictEqual(m.runLong.scenes, ['Chapters/Chapter 1/Scenes/The Bell Tower.md', 'Chapters/Chapter 1/Scenes/Unplayed.md']);
    assert.deepStrictEqual(m.runLong.planning, [{ note: 'Chapters/Chapter 1/Planning/Arc.md', kind: 'arc', heads: ['The Arc', 'Beats To Hit'] }]);
    assert.deepStrictEqual(m.runLong.contingencies, [m.beats[5].key]);
    // every path in the model has a Note; withheld is read
    assert.strictEqual(m.notes['Locations/The Gate House.md'].withheld, true);
    assert.strictEqual(m.notes['Documents/Map of the Gate.md'].docType, 'map');
    assert.deepStrictEqual(m.notes['Characters/NPCs/Lucan Grey.md'].aliases, ['Lucan']);
    assert.strictEqual(m.notes['Characters/NPCs/Lucan Grey.md'].unseenAs, '');
    for (const p of m.places) assert.ok(m.notes[p], p);
    // every Plan link is on the page; a link to nowhere warns once
    assert.deepStrictEqual(m.warnings.filter((w) => w.kind === 'not-on-page'), []);
    const missing = m.warnings.filter((w) => w.kind === 'missing-note').map((w) => w.text).sort();
    assert.deepStrictEqual(missing, [
      '[[Missing Person]] matches no note in the vault',
      '[[Nobody Here]] matches no note in the vault',
      '[[Nobody PC]] matches no note in the vault',
    ]);
    const keys = m.warnings.map((w) => JSON.stringify([w.kind, w.note, w.text]));
    assert.strictEqual(new Set(keys).size, keys.length);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(m)), m);
  });

  it('every plan line is kept somewhere', () => {
    const dir = copy();
    const m = readRunSheet(dir, PLAN, { party: PARTY });
    const body = bodyOf(readText(path.join(dir, PLAN)));
    assert.deepStrictEqual(missingLines(body, m), []);
    assert.deepStrictEqual(strayLines(dir, body, m), []);
    // the checks can fail: a field emptied shows up, and so does a made-up residue
    const stray = JSON.parse(JSON.stringify(m));
    stray.beats[1].extra += '\n\n**Who:** or .';
    assert.deepStrictEqual(strayLines(dir, body, stray), ['**Who:** or .']);
    const cut = JSON.parse(JSON.stringify(m));
    cut.beats[0].situation = '';
    assert.deepStrictEqual(missingLines(body, cut), ['**Situation:** The gate is shut and the bell', 'rope hangs cut; Brother Ash will not open it until it rings.']);
    // with no party, the PC lines are still kept
    const alone = readRunSheet(dir, PLAN);
    assert.deepStrictEqual(missingLines(body, alone), []);
    // a Who line joined by `or` is kept as written, not as a residue
    const p = path.join(dir, PLAN);
    fs.writeFileSync(p, readText(p).replace('**Who:** [[Sister Fen]], [[Ada Moss]] and the bell-ringer',
      '**Who:** [[Sister Fen]], [[Brother Venn]] or [[Abbot Rime]].'));
    const or = readRunSheet(dir, PLAN, { party: PARTY });
    const orBody = bodyOf(readText(p));
    assert.deepStrictEqual(missingLines(orBody, or), []);
    assert.deepStrictEqual(strayLines(dir, orBody, or), []);
  });

  it('every line of a real hub plan is kept somewhere', () => {
    const dir = copy();
    const rel = 'Chapters/Chapter 1/Sessions/Session 04/Session 04 - The Abbey - Plan.md';
    const hub = readText(path.join(__dirname, 'fixtures', 'run-sheet-hub-plan.md'));
    write(dir, rel, `---\ntype: session-plan\nsession: "[[Session 04 - The Abbey]]"\nchapter: "[[Chapter 1]]"\n---\n\n${hub}`);
    const m = readRunSheet(dir, rel, { party: PARTY });
    assert.strictEqual(m.beats.length, 2);
    assert.strictEqual(m.session.number, 4);
    assert.deepStrictEqual(missingLines(hub, m), []);
    assert.deepStrictEqual(strayLines(dir, hub, m), []);
    assert.deepStrictEqual(m.warnings.filter((w) => w.kind === 'not-on-page'), []);
  });

  it('every line of the plan skeleton is kept somewhere, and its places and spots are on the model', () => {
    const dir = mkTmp('rs-skel-');
    fs.cpSync(path.join(__dirname, 'fixtures', 'run-sheet-skeleton'), dir, { recursive: true });
    const skeleton = readText(path.join(__dirname, '..', '..', '..', 'tests', 'fixtures', 'plan-skeleton.md'));
    const rel = 'Plan.md';
    write(dir, rel, skeleton);
    const m = readRunSheet(dir, rel, { party: [] });
    const body = bodyOf(skeleton);
    assert.deepStrictEqual(missingLines(body, m), []);
    assert.deepStrictEqual(strayLines(dir, body, m), []);
    assert.deepStrictEqual(m.beats.map((b) => b.placeFrom), ['place', null, null, 'place', null]);
    assert.deepStrictEqual(m.beats[1].spots.map((x) => x.md).filter(Boolean).length, 2);
    // the place and the hub's location are on the page's places
    assert.deepStrictEqual(m.places, ['Locations/Location.md', 'Locations/The Vicarage.md']);
    assert.deepStrictEqual(m.warnings.filter((w) => w.kind === 'no-place'), []);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(m)), m);
  });

  it('completeness reports a link a field dropped', () => {
    const dir = copy();
    const m = readRunSheet(dir, PLAN, { party: PARTY });
    const body = bodyOf(readText(path.join(dir, PLAN)));
    assert.deepStrictEqual(completeness(body, m).filter((w) => w.kind === 'not-on-page'), []);
    const edited = JSON.parse(JSON.stringify(m));
    // a reader that took the Who line whole and lost Sister Fen from it
    for (const b of edited.beats) {
      b.who = b.who.filter((w) => w.name !== 'Sister Fen');
      // S6-D7: an untyped beat can fight, so Sister Fen's who entry also made a benched row; the lost reader lost that too
      b.foes = b.foes.filter((f) => f.name !== 'Sister Fen');
      b.extra = b.extra.replace(/^\*\*Who:\*\*.*$/m, '');
    }
    const rows = completeness(body, edited).filter((w) => w.kind === 'not-on-page');
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].note, PLAN);
    assert.match(rows[0].text, /Planned Scenes/);
    assert.match(rows[0].text, /\[\[Sister Fen\]\]/);
  });

  it('the links map resolves aliases', () => {
    const dir = copy();
    const p = path.join(dir, PLAN);
    fs.writeFileSync(p, readText(p).replace('The players like the wolves.', 'The players like the wolves and [[Lucan]].'));
    const m = readRunSheet(dir, PLAN, { party: PARTY });
    assert.strictEqual(m.links.Lucan, 'Characters/NPCs/Lucan Grey.md');
    assert.strictEqual(m.links['Brother Ash'], 'Characters/NPCs/Brother Ash.md');
    assert.strictEqual(m.links['Nobody Here'], null);
  });

  it('run long uses the chapter link, and stops at the vault root', () => {
    // a Plan outside its chapter folder still finds the chapter by its link
    const dir = copy();
    const moved = 'Elsewhere/Session 02 - The Test - Plan.md';
    write(dir, moved, readText(path.join(dir, PLAN)));
    fs.rmSync(path.join(dir, PLAN));
    const m = readRunSheet(dir, moved, { party: PARTY });
    assert.strictEqual(m.runLong.nextPlan, 'Chapters/Chapter 1/Sessions/Session 03/Session 03 - Next - Plan.md');
    assert.strictEqual(m.runLong.scenes.length, 2);

    // a flat Sessions folder at the vault root and no chapter link: nothing to fall back on
    const flat = copy();
    const rel = 'Sessions/Session 05 - Flat - Plan.md';
    write(flat, rel, '---\ntype: session-plan\n---\n\n## Session Overview\n\nFlat.\n');
    let f;
    assert.doesNotThrow(() => { f = readRunSheet(flat, rel); });
    assert.deepStrictEqual(f.runLong, { nextPlan: null, scenes: [], planning: [], contingencies: [] });
    assert.ok(f.warnings.some((w) => w.kind === 'no-chapter'));
    assert.strictEqual(f.session.number, 5);
    assert.strictEqual(f.session.title, 'Session 05 - Flat');
  });

  describe('map pairs', () => {
    const mapNote = (name, extra = '') => `---\nname: ${name}\ntype: document\ndoc_type: map\n${extra}---\n\nA map.\n`;
    const withPlanLine = (dir, line) => {
      const text = fs.readFileSync(path.join(dir, PLAN), 'utf8');
      fs.writeFileSync(path.join(dir, PLAN), `${text}\n${line}\n`);
    };

    it('maps pair by player_version', () => {
      const dir = copy();
      write(dir, 'Documents/Cellar Plan (GM).md', mapNote('Cellar Plan (GM)', 'player_version: "[[Cellar Sketch]]"\n'));
      write(dir, 'Documents/Cellar Sketch.md', mapNote('Cellar Sketch'));
      withPlanLine(dir, 'See [[Cellar Plan (GM)]].');
      const m = readRunSheet(dir, PLAN, { party: PARTY });
      assert.deepStrictEqual(m.mapPairs, [{ gm: 'Documents/Cellar Plan (GM).md', player: 'Documents/Cellar Sketch.md' }]);
    });

    it('maps pair by name when the field is absent', () => {
      const dir = copy();
      write(dir, 'Documents/Map of the Gate (GM).md', mapNote('Map of the Gate (GM)'));
      const m = readRunSheet(dir, PLAN, { party: PARTY });
      assert.deepStrictEqual(m.mapPairs, [{ gm: 'Documents/Map of the Gate (GM).md', player: 'Documents/Map of the Gate.md' }]);
    });

    it('an unlinked twin is paired', () => {
      const dir = copy();
      write(dir, 'Documents/Map of the Gate (GM).md', mapNote('Map of the Gate (GM)'));
      const m = readRunSheet(dir, PLAN, { party: PARTY });
      assert.ok(!m.maps.includes('Documents/Map of the Gate (GM).md'));
      assert.strictEqual(m.mapPairs.length, 1);
      // and the GM map links its player map while the Plan names only the GM map
      write(dir, 'Documents/Cellar Plan (GM).md', mapNote('Cellar Plan (GM)', 'player_version: "[[Cellar Sketch]]"\n'));
      write(dir, 'Documents/Cellar Sketch.md', mapNote('Cellar Sketch'));
      withPlanLine(dir, 'See [[Cellar Sketch]].');
      const m2 = readRunSheet(dir, PLAN, { party: PARTY });
      assert.deepStrictEqual(m2.mapPairs.map((p) => p.gm), ['Documents/Map of the Gate (GM).md', 'Documents/Cellar Plan (GM).md']);
    });

    it('a player_version that is not a map falls back to the name pair', () => {
      const dir = copy();
      write(dir, 'Documents/Foo (GM).md', mapNote('Foo (GM)', 'player_version: "[[Nowhere]]"\n'));
      write(dir, 'Documents/Foo.md', mapNote('Foo'));
      withPlanLine(dir, 'See [[Foo (GM)]].');
      const m = readRunSheet(dir, PLAN, { party: PARTY });
      assert.deepStrictEqual(m.mapPairs, [{ gm: 'Documents/Foo (GM).md', player: 'Documents/Foo.md' }]);
    });

    it('a player_version that names no note, or no map, warns on the GM map and falls back (I4)', () => {
      const dir = copy();
      write(dir, 'Documents/Lone (GM).md', mapNote('Lone (GM)', 'player_version: "[[Cellar Sketchh]]"\n'));
      withPlanLine(dir, 'See [[Lone (GM)]].');
      let m = readRunSheet(dir, PLAN, { party: PARTY });
      assert.deepStrictEqual(m.mapPairs, []);
      assert.ok(m.warnings.some((w) => w.kind === 'map-pair' && w.note === 'Documents/Lone (GM).md'
        && /player_version \[\[Cellar Sketchh\]\] matches no note in the vault/.test(w.text)), JSON.stringify(m.warnings));
      write(dir, 'Documents/Cellar Sketch.md', '---\ntype: document\n---\n\nNot a map.\n');
      write(dir, 'Documents/Lone (GM).md', mapNote('Lone (GM)', 'player_version: "[[Cellar Sketch]]"\n'));
      m = readRunSheet(dir, PLAN, { party: PARTY });
      assert.ok(m.warnings.some((w) => w.kind === 'map-pair' && w.note === 'Documents/Lone (GM).md'
        && /player_version \[\[Cellar Sketch\]\] is not a map \(no doc_type: map\)/.test(w.text)), JSON.stringify(m.warnings));
      // the name pair still stands in
      write(dir, 'Documents/Lone.md', mapNote('Lone'));
      m = readRunSheet(dir, PLAN, { party: PARTY });
      assert.deepStrictEqual(m.mapPairs, [{ gm: 'Documents/Lone (GM).md', player: 'Documents/Lone.md' }]);
      assert.ok(m.warnings.some((w) => w.kind === 'map-pair'));
    });

    it('a player_version naming the GM map itself warns and falls back to the name pair (PR #799 review)', () => {
      const dir = copy();
      write(dir, 'Documents/Foo (GM).md', mapNote('Foo (GM)', 'player_version: "[[Foo (GM)]]"\n'));
      write(dir, 'Documents/Foo.md', mapNote('Foo'));
      withPlanLine(dir, 'See [[Foo (GM)]].');
      const m = readRunSheet(dir, PLAN, { party: PARTY });
      assert.deepStrictEqual(m.mapPairs, [{ gm: 'Documents/Foo (GM).md', player: 'Documents/Foo.md' }]);
      assert.ok(m.warnings.some((w) => w.kind === 'map-pair' && w.note === 'Documents/Foo (GM).md' && /player_version \[\[Foo \(GM\)\]\] is this map itself/.test(w.text)), JSON.stringify(m.warnings));
    });

    it('maps keeps its strings, a lone map is not paired, a broken link does not throw', () => {
      const dir = copy();
      let m = readRunSheet(dir, PLAN, { party: PARTY });
      assert.deepStrictEqual(m.maps, ['Documents/Map of the Gate.md']);
      assert.deepStrictEqual(m.mapPairs, []);
      write(dir, 'Documents/Lone (GM).md', mapNote('Lone (GM)', 'player_version: "[[Nowhere At All]]"\n'));
      withPlanLine(dir, 'See [[Lone (GM)]].');
      m = readRunSheet(dir, PLAN, { party: PARTY });
      assert.deepStrictEqual(m.maps, ['Documents/Map of the Gate.md', 'Documents/Lone (GM).md']);
      assert.deepStrictEqual(m.mapPairs, []);
    });
  });

  describe('unmask', () => {
    const ASH = 'Characters/NPCs/Brother Ash.md';
    const LUCAN = 'Characters/NPCs/Lucan Grey.md';

    it('gm_aliases alone is not a disguise', () => {
      const m = readRunSheet(copy(), PLAN, { party: PARTY });
      assert.strictEqual(m.notes[LUCAN].unmask, null);
      assert.strictEqual(m.notes[ASH].unmask, null);
    });

    // The fixture as the test edits it: frontmatter lines added after `type: npc`, and Playing Them lines before
    // `- **Tell:**`. A Windows checkout gives the fixture CRLF line ends (no .gitattributes), so a match on
    // `type: npc\n` alone found nothing there and the note kept no unmasked_name.
    // So the added lines take the note's own line ends.
    const withAsh = (text, fmLines, beforeTell = '') => {
      const eol = text.includes('\r\n') ? '\r\n' : '\n';
      const own = (t) => t.replace(/\r?\n/g, eol);
      return text.replace(/type: npc\r?\n/, `type: npc${eol}${own(fmLines)}`).replace('- **Tell:**', `${own(beforeTell)}- **Tell:**`);
    };

    it('a CRLF note (a Windows checkout) gives the same unmask', () => {
      const dir = copy();
      const crlf = fs.readFileSync(path.join(FIXTURE, ASH), 'utf8').replace(/\r?\n/g, '\r\n');
      write(dir, ASH, withAsh(crlf, 'unmasked_name: The Ember Abbot\n', '- **Unmasked:** cold\n'));
      const m = readRunSheet(dir, PLAN, { party: PARTY });
      assert.deepStrictEqual(m.notes[ASH].unmask, { name: 'The Ember Abbot', portrait: null, playAs: 'cold rubs his thumb along the rope scar', since: null });
    });

    it('unmasked_name gives an unmask', () => {
      const dir = copy();
      const ash = withAsh(fs.readFileSync(path.join(dir, ASH), 'utf8'),
        'unmasked_name: " The Ember Abbot "\nunmasked_portrait: "_attachments/ember.png"\n', '- **Unmasked:** cold, never says "indeed"\n');
      write(dir, ASH, ash);
      write(dir, '_attachments/ember.png', 'x');
      const m = readRunSheet(dir, PLAN, { party: PARTY });
      assert.deepStrictEqual(m.notes[ASH].unmask, {
        name: 'The Ember Abbot',
        portrait: '_attachments/ember.png',
        playAs: 'cold, never says "indeed" rubs his thumb along the rope scar', since: null,
      });
      // the disguise's own name and play-as are unchanged
      assert.strictEqual(m.notes[ASH].name, 'Brother Ash');
      assert.match(m.people.find((p) => p.note === ASH).playAs, /^slow, fond of the word/);
    });

    it('an unmask with no face or Unmasked line has what the note gives, and a missing face warns', () => {
      const dir = copy();
      const ash = fs.readFileSync(path.join(dir, ASH), 'utf8');
      write(dir, ASH, withAsh(ash, 'unmasked_name: The Ember Abbot\nunmasked_portrait: ""\n'));
      let m = readRunSheet(dir, PLAN, { party: PARTY });
      // no Unmasked line: the true self speaks as the disguise does (Speech is kept by --unmask)
      assert.deepStrictEqual(m.notes[ASH].unmask, { name: 'The Ember Abbot', portrait: null, playAs: 'slow, fond of the word "indeed" rubs his thumb along the rope scar', since: null });
      write(dir, ASH, withAsh(ash, 'unmasked_name: The Ember Abbot\nunmasked_portrait: nowhere.png\n'));
      m = readRunSheet(dir, PLAN, { party: PARTY });
      assert.strictEqual(m.notes[ASH].unmask.portrait, null);
      assert.ok(m.warnings.some((w) => w.kind === 'no-portrait' && w.note === ASH && /unmasked_portrait nowhere\.png .*the Unmask has no face/.test(w.text)), JSON.stringify(m.warnings));
    });

    const withFm = (dir, lines) => {
      const ash = fs.readFileSync(path.join(FIXTURE, ASH), 'utf8');
      write(dir, ASH, withAsh(ash, lines));
      return readRunSheet(dir, PLAN, { party: PARTY });
    };
    const unmaskWarnings = (m) => m.warnings.filter((w) => w.kind === 'unmask' && w.note === ASH);

    it('a true name written as a link is the name it links (C1)', () => {
      for (const value of ['"[[The Ember Abbot]]"', '"[[The Ember Abbot|the abbot]]"', '[[The Ember Abbot]]', '"[[NPCs/The Ember Abbot]]"']) {
        const m = withFm(copy(), `unmasked_name: ${value}\n`);
        assert.strictEqual(m.notes[ASH].unmask && m.notes[ASH].unmask.name, 'The Ember Abbot', value);
        assert.deepStrictEqual(unmaskWarnings(m), [], value);
      }
    });

    it('an unmasked_name that names no one warns and gives no Unmask (C1)', () => {
      const m = withFm(copy(), 'unmasked_name: "[[]]"\n');
      assert.strictEqual(m.notes[ASH].unmask, null);
      assert.ok(unmaskWarnings(m).some((w) => /unmasked_name holds \[\[\]\], which names no one: no Unmask on the sheet/.test(w.text)), JSON.stringify(m.warnings));
    });

    it('a true face written as a link or a list of one is found (PR #799 review)', () => {
      for (const face of ['"[[ember.png]]"', '"![[_attachments/ember.png|200]]"', '[[ember.png]]', '\n  - "[[ember.png]]"']) {
        const dir = copy();
        write(dir, '_attachments/ember.png', 'x');
        const m = withFm(dir, `unmasked_name: The Ember Abbot\nunmasked_portrait: ${face}\n`);
        assert.strictEqual(m.notes[ASH].unmask && m.notes[ASH].unmask.portrait, '_attachments/ember.png', face);
        assert.ok(!m.warnings.some((w) => w.kind === 'no-portrait' && w.note === ASH), face);
      }
    });

    it('a face with no true name warns (M2)', () => {
      const dir = copy();
      write(dir, '_attachments/ember.png', 'x');
      const m = withFm(dir, 'unmasked_portrait: "_attachments/ember.png"\n');
      assert.strictEqual(m.notes[ASH].unmask, null);
      assert.ok(unmaskWarnings(m).some((w) => w.text === 'unmasked_portrait is set but unmasked_name is empty: no Unmask on the sheet'), JSON.stringify(m.warnings));
    });

    it('several true names warn and show none, as reveal refuses them (M3)', () => {
      const m = withFm(copy(), 'unmasked_name: [The Ember Abbot, Old Cinders]\n');
      assert.strictEqual(m.notes[ASH].unmask, null);
      assert.ok(unmaskWarnings(m).some((w) => w.text === 'unmasked_name is a list of 2 names; give it the one true name: no Unmask on the sheet'), JSON.stringify(m.warnings));
    });
  });

  it('plan with only a title reads to an empty model', () => {
    const dir = copy();
    write(dir, 'Lonely - Plan.md', '# Lonely\n');
    const m = readRunSheet(dir, 'Lonely - Plan.md');
    assert.deepStrictEqual(m.session, { index: null, title: 'Lonely', chapter: null, number: null });
    assert.deepStrictEqual(m.brief, { overview: '', world: '', stops: '' });
    for (const f of ['handouts', 'pcs', 'unmatchedPcLines', 'beats', 'people', 'places', 'maps', 'mapPairs']) assert.deepStrictEqual(m[f], [], f);
    assert.strictEqual(m.threads, '');
    assert.deepStrictEqual(m.runLong, { nextPlan: null, scenes: [], planning: [], contingencies: [] });
    // the title line is the lead text: kept, not dropped
    assert.deepStrictEqual(m.prep, [{ title: '', md: '# Lonely' }]);
    assert.deepStrictEqual(m.links, {});
    // only the Plan's own note: the index's warning about a broken note this sheet never touches is left out
    assert.deepStrictEqual(Object.keys(m.notes), ['Lonely - Plan.md']);
    assert.ok(!m.warnings.some((w) => w.note === 'Characters/NPCs/Broken.md'));
    // a vault-wide one (note null) stays
    assert.ok(m.warnings.some((w) => w.kind === 'ambiguous-name'));
    assert.ok(m.warnings.some((w) => w.kind === 'no-party'));
  });

  it('a Plan that cannot be read is the one error', () => {
    const dir = copy();
    assert.throws(() => readRunSheet(dir, 'No Such - Plan.md'), /No Such - Plan\.md/);
  });

  it('a Plan outside the vault is that same error', () => {
    const dir = copy();
    assert.throws(() => readRunSheet(dir, '../Elsewhere - Plan.md'), /the Plan \.\.\/Elsewhere - Plan\.md is not inside the vault/);
    const away = path.join(mkTmp('rs-'), 'Away - Plan.md');
    fs.writeFileSync(away, '## Session Overview\n\nAway.\n');
    assert.throws(() => readRunSheet(dir, away), (err) => err.message.includes(away) && /not inside the vault/.test(err.message));
  });

  it('odd settings and frontmatter read with warnings, never a throw', () => {
    const dir = copy();
    writeSettings(dir, ': : not yaml [');
    const p = path.join(dir, PLAN);
    fs.writeFileSync(p, readText(p).replace('canon_status: DRAFT', 'canon_status: [DRAFT'));
    const m = readRunSheet(dir, PLAN, { party: PARTY });
    assert.strictEqual(m.system, null);
    assert.strictEqual(m.beats.length, 6);
    assert.ok(m.warnings.some((w) => w.kind === 'unreadable-frontmatter' && w.note === PLAN));
  });

  it('reading writes nothing', () => {
    const dir = copy();
    const snap = () => {
      const out = [];
      const walk = (d) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const full = path.join(d, e.name);
          if (e.isDirectory()) walk(full);
          out.push(`${path.relative(dir, full)} ${fs.statSync(full).mtimeMs}`);
        }
      };
      walk(dir);
      return out.sort();
    };
    const before = snap();
    readRunSheet(dir, PLAN, { party: PARTY });
    assert.deepStrictEqual(snap(), before);
  });
  it('every key in the model is unique', () => {
    const dir = copy();
    const p = path.join(dir, PLAN);
    fs.writeFileSync(p, readText(p)
      .replace('- **[[Frost Wolf]] (3):** hunting', '- **[[Frost Wolf]] (3):** hunting\n- **[[Frost Wolf]] (2):** circling')
      .replace('| [[Lucan Grey]] | Ally scout |', '| [[Brother Ash]] | Bell keeper | Second row | [[The Gate]] |\n| [[Lucan Grey]] | Ally scout |'));
    const m = readRunSheet(dir, PLAN, { party: PARTY });
    const keys = [];
    const walk = (v) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (k === 'key') keys.push(x); else walk(x); }
    };
    walk(m);
    assert.ok(keys.length > 20);
    assert.deepStrictEqual(keys.filter((k, i) => keys.indexOf(k) !== i), []);
    assert.strictEqual(m.beats[0].foes.filter((f) => f.note === 'Creatures/Frost Wolf.md').length, 5);
    assert.strictEqual(m.people.filter((x) => x.note === 'Characters/NPCs/Brother Ash.md').length, 2);
  });

  it('a party PC whose frontmatter does not parse keeps both its warnings', () => {
    const dir = copy();
    write(dir, BEN, '---\ntype: pc\nname: [unclosed\n---\n\nHi.\n');
    const m = readRunSheet(dir, PLAN, { party: PARTY });
    const ben = m.warnings.filter((w) => w.note === BEN).map((w) => w.kind).sort();
    assert.deepStrictEqual(ben, ['unreadable-frontmatter', 'unreadable-pc']);
  });

  it('a PC portrait no picture matches is a warning in the model', () => {
    const m = readRunSheet(copy(), PLAN, { party: PARTY });
    assert.strictEqual(m.pcs.find((x) => x.note === ADA).portrait, null);
    assert.ok(m.warnings.some((w) => w.kind === 'no-portrait' && w.note === ADA));
  });

  it('a second scene section keeps its own preamble', () => {
    const dir = copy();
    const p = path.join(dir, PLAN);
    fs.writeFileSync(p, readText(p).replace('## Contingency Scenes', '## Planned scenes\n\nA late addition.\n\n### The Late Scene\n**Situation:** late.\n\n## Contingency Scenes'));
    const m = readRunSheet(dir, PLAN, { party: PARTY });
    assert.deepStrictEqual(m.prep.filter((x) => /^planned scenes$/i.test(x.title)).map((x) => [x.title, x.md]), [
      ['Planned Scenes', 'Checklists for improvisation, not prose to read.'],
      ['Planned scenes', 'A late addition.'],
    ]);
    assert.deepStrictEqual(missingLines(bodyOf(readText(p)), m), []);
  });

  it('a Windows checkout (CRLF) reads to the same model', () => {
    const lf = copy();
    const crlf = copy();
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name.endsWith('.md')) fs.writeFileSync(full, fs.readFileSync(full, 'utf8').replace(/\r?\n/g, '\r\n'));
      }
    };
    walk(crlf);
    assert.match(fs.readFileSync(path.join(crlf, PLAN), 'utf8'), /\r\n/);
    assert.doesNotMatch(readText(path.join(crlf, PLAN)), /\r/);
    // the campaign is the folder's name when no title is set, and the two folders are named apart
    const sameName = (m) => ({ ...m, campaign: '' });
    assert.deepStrictEqual(sameName(readRunSheet(crlf, PLAN, { party: PARTY })), sameName(readRunSheet(lf, PLAN, { party: PARTY })));
  });
});

// The previous session's Table Log: the session indexes and logs a test needs, written beside the fixture.
const CH1 = 'Chapters/Chapter 1';
const CH2 = 'Chapters/Chapter 2';
const LUCAN = 'Characters/NPCs/Lucan Grey.md';
const ASH = 'Characters/NPCs/Brother Ash.md';
const sessionIndex = (dir, rel, { number, chapter, log, status = 'played' }) => write(dir, rel, [
  '---', 'type: session', `session_number: ${number}`, `chapter: "[[${chapter}]]"`, `status: ${status}`,
  'documents:', `  table_log: ${log ? `"[[${log}]]"` : 'null'}`, '---', '', `# ${path.posix.basename(rel, '.md')}`, '',
].join('\n'));
const tableLog = (dir, rel, session, rows) => write(dir, rel, [
  '---', 'type: session-table-log', `session: "[[${session}]]"`, 'canon_status: AUTHORITATIVE', 'created_by: manual',
  'publish: false', '---', '', '## Where everyone ended', '', '- [[Ada Moss]] at [[The Gate]]', '',
  '## Vitals at the end', '', '| Who | HP | Conditions |', '|-----|----|------------|', ...rows, '',
].join('\n'));
const S1 = `${CH1}/Sessions/Session 01/Session 01 - The Road.md`;
const S1_LOG = `${CH1}/Sessions/Session 01/Session 01 - The Road - Table Log.md`;
function withS1(rows = ['| [[Lucan Grey]] | 9/27 | winded |', '| [[Ada Moss]] | 4/11 | |']) {
  const dir = copy();
  sessionIndex(dir, S1, { number: 1, chapter: 'Chapter 1', log: 'Session 01 - The Road - Table Log' });
  tableLog(dir, S1_LOG, 'Session 01 - The Road', rows);
  return dir;
}
const allyRows = (m) => m.beats.flatMap((b) => b.foes).filter((f) => f.ally);
const tableLogWarnings = (m) => m.warnings.filter((w) => /table[ _-]log/i.test(`${w.kind} ${w.note} ${w.text}`));

describe('run sheet reader: allies start from the last Table Log', () => {
  it('ally starts from previous Table Log', () => {
    const m = readRunSheet(withS1(), PLAN, { party: PARTY });
    const lucan = allyRows(m);
    assert.ok(lucan.length >= 1);
    for (const f of lucan) {
      assert.strictEqual(f.note, LUCAN);
      assert.strictEqual(f.hpNow, 9);
      assert.strictEqual(f.carriedFrom, S1_LOG);
      // the note's stated HP stays the note's
      assert.strictEqual(f.hp, 16);
    }
    // non-ally rows carry nothing
    for (const f of m.beats.flatMap((b) => b.foes).filter((x) => !x.ally)) {
      assert.strictEqual(f.hpNow, null, f.name);
      assert.strictEqual(f.carriedFrom, null, f.name);
    }
    assert.deepStrictEqual(tableLogWarnings(m), []);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(m)), m);
  });

  it('ally absent from vitals starts from note', () => {
    const m = readRunSheet(withS1(['| [[Ada Moss]] | 4/11 | |']), PLAN, { party: PARTY });
    for (const f of allyRows(m)) assert.deepStrictEqual([f.hp, f.hpNow, f.carriedFrom], [16, null, null]);
    assert.deepStrictEqual(tableLogWarnings(m), []);
  });

  it('an ally whose HP cell holds no number starts from note, and the row warns once', () => {
    const m = readRunSheet(withS1(['| [[Lucan Grey]] | fine | |', '| [[Lucan Grey]] | fine | |']), PLAN, { party: PARTY });
    for (const f of allyRows(m)) assert.deepStrictEqual([f.hpNow, f.carriedFrom], [null, null]);
    const w = tableLogWarnings(m);
    assert.strictEqual(w.length, 1, JSON.stringify(w));
    assert.strictEqual(w[0].kind, 'table-log');
    assert.strictEqual(w[0].note, S1_LOG);
    assert.match(w[0].text, /Lucan Grey/);
    assert.match(w[0].text, /"fine"/);
  });

  it('an empty HP cell in a newer Table Log is silent and the walk goes on past it', () => {
    const dir = withS1();
    const s2 = `${CH1}/Sessions/Session 02/Session 02 - The Test.md`;
    const s2Log = `${CH1}/Sessions/Session 02/Session 02 - The Test - Table Log.md`;
    const s3 = `${CH1}/Sessions/Session 03/Session 03 - Next.md`;
    const p3 = `${CH1}/Sessions/Session 03/Session 03 - Next - Plan.md`;
    sessionIndex(dir, s2, { number: 2, chapter: 'Chapter 1', log: 'Session 02 - The Test - Table Log' });
    tableLog(dir, s2Log, 'Session 02 - The Test', ['| [[Lucan Grey]] | | winded |']);
    sessionIndex(dir, s3, { number: 3, chapter: 'Chapter 1', log: null, status: 'planned' });
    write(dir, p3, ['---', 'type: session-plan', 'session: "[[Session 03 - Next]]"', 'chapter: "[[Chapter 1]]"', '---', '',
      '## Planned Scenes', '', '### Scene 1: Again', '**Situation:** Lucan again.', '**NPCs**', '- **[[Lucan Grey]]:** helps', ''].join('\n'));
    const m = readRunSheet(dir, p3, { party: PARTY });
    const rows = allyRows(m);
    assert.ok(rows.length >= 1);
    for (const f of rows) assert.deepStrictEqual([f.hpNow, f.carriedFrom], [9, S1_LOG]);
    assert.deepStrictEqual(tableLogWarnings(m), []);
  });

  it('a header row naming no column warns once naming the Table Log, and the table is not read', () => {
    const dir = withS1();
    tableLog(dir, S1_LOG, 'Session 01 - The Road', []);
    const abs = path.join(dir, S1_LOG);
    fs.writeFileSync(abs, fs.readFileSync(abs, 'utf8').replace('| Who | HP | Conditions |\n|-----|----|------------|',
      '| Name | Max | Now |\n|---|---|---|\n| [[Lucan Grey]] | 27 | 9 |'));
    const m = readRunSheet(dir, PLAN, { party: PARTY });
    for (const f of allyRows(m)) assert.deepStrictEqual([f.hpNow, f.carriedFrom], [null, null]);
    const w = tableLogWarnings(m);
    assert.strictEqual(w.length, 1, JSON.stringify(w));
    assert.strictEqual(w[0].kind, 'table-log');
    assert.strictEqual(w[0].note, S1_LOG);
    // step 6b Task 20: the sheet reads more columns than Who, HP and Conditions, so the warning names none of them
    assert.match(w[0].text, /names no column the sheet reads/);
  });

  it('a header row puts the HP column where it says', () => {
    const dir = withS1();
    tableLog(dir, S1_LOG, 'Session 01 - The Road', []);
    const abs = path.join(dir, S1_LOG);
    fs.writeFileSync(abs, fs.readFileSync(abs, 'utf8').replace('| Who | HP | Conditions |\n|-----|----|------------|',
      '| Who | Max | HP |\n|---|---|---|\n| [[Lucan Grey]] | 27 | 9 hp |'));
    const m = readRunSheet(dir, PLAN, { party: PARTY });
    for (const f of allyRows(m)) assert.deepStrictEqual([f.hpNow, f.carriedFrom], [9, S1_LOG]);
    assert.deepStrictEqual(tableLogWarnings(m), []);
  });

  it('a pipe alias in the Who cell still finds the ally', () => {
    const m = readRunSheet(withS1(['| [[Lucan Grey|Lucan]] | 11/16 | |']), PLAN, { party: PARTY });
    for (const f of allyRows(m)) assert.deepStrictEqual([f.hpNow, f.carriedFrom], [11, S1_LOG]);
  });

  it('no previous Table Log', () => {
    // no session before this one
    const bare = readRunSheet(copy(), PLAN, { party: PARTY });
    // a session before it with no Table Log
    const dir = copy();
    sessionIndex(dir, S1, { number: 1, chapter: 'Chapter 1', log: null });
    const none = readRunSheet(dir, PLAN, { party: PARTY });
    for (const m of [bare, none]) {
      const foes = m.beats.flatMap((b) => b.foes);
      assert.ok(foes.length > 0);
      for (const f of foes) assert.deepStrictEqual([f.hpNow, f.carriedFrom], [null, null], f.name);
      assert.deepStrictEqual(tableLogWarnings(m), []);
    }
  });

  it('a hand-made Table Log with no vitals, or empty, is no error', () => {
    for (const text of ['---\ntype: session-table-log\n---\n\n## where EVERYONE ended\n\n- [[Ada Moss]]\n', '', '---\ntype: session-table-log\n---\n\n## Vitals at the end\n']) {
      const dir = withS1();
      write(dir, S1_LOG, text);
      const m = readRunSheet(dir, PLAN, { party: PARTY });
      for (const f of allyRows(m)) assert.deepStrictEqual([f.hpNow, f.carriedFrom], [null, null]);
      // an empty file has no `type: session-table-log`, so it is not read, and says so
      assert.deepStrictEqual(tableLogWarnings(m).map((w) => /not type: session-table-log/.test(w.text)), text ? [] : [true]);
    }
  });

  it('unresolved Who link warns once naming the Table Log', () => {
    const dir = withS1(['| [[Lucan Gray]] | 9/27 | |', '| [[Lucan Gray]] | 8/27 | |', '| [[Lucan Grey]] | 7/16 | |']);
    const m = readRunSheet(dir, PLAN, { party: PARTY });
    const w = tableLogWarnings(m);
    assert.strictEqual(w.length, 1, JSON.stringify(w));
    assert.strictEqual(w[0].note, S1_LOG);
    assert.match(w[0].text, /\[\[Lucan Gray\]\]/);
    assert.match(w[0].text, /Vitals at the end/);
    // the row that resolves still carries
    for (const f of allyRows(m)) assert.deepStrictEqual([f.hpNow, f.carriedFrom], [7, S1_LOG]);
  });

  it('a documents.table_log that links nowhere warns once naming it, and allies start from their notes', () => {
    const dir = copy();
    sessionIndex(dir, S1, { number: 1, chapter: 'Chapter 1', log: 'Session 01 - Lost Log' });
    const m = readRunSheet(dir, PLAN, { party: PARTY });
    const w = tableLogWarnings(m);
    assert.strictEqual(w.length, 1, JSON.stringify(w));
    assert.strictEqual(w[0].note, S1);
    assert.match(w[0].text, /\[\[Session 01 - Lost Log\]\]/);
    for (const f of allyRows(m)) assert.deepStrictEqual([f.hpNow, f.carriedFrom], [null, null]);
  });

  it('chapters with repeating numbers pick the right previous session', () => {
    const dir = withS1();
    // Chapter 1's Session 02 (the fixture Plan's) has a log too, and Chapter 2 starts again at Session 01.
    const S2 = `${CH1}/Sessions/Session 02/Session 02 - The Test.md`;
    const S2_LOG = `${CH1}/Sessions/Session 02/Session 02 - The Test - Table Log.md`;
    sessionIndex(dir, S2, { number: 2, chapter: 'Chapter 1', log: 'Session 02 - The Test - Table Log' });
    tableLog(dir, S2_LOG, 'Session 02 - The Test', ['| [[Lucan Grey]] | 5/16 | |']);
    write(dir, `${CH2}/Chapter 2.md`, '---\ntype: chapter\nstatus: active\nsort_order: 2\n---\n\n# Chapter 2\n');
    write(dir, `${CH1}/Chapter 1.md`, '---\ntype: chapter\nstatus: active\nsort_order: 1\n---\n\n# Chapter 1\n\nThe frost comes early.\n');
    const C2S1 = `${CH2}/Sessions/Session 01/Session 01 - The Thaw.md`;
    const C2S1_LOG = `${CH2}/Sessions/Session 01/Session 01 - The Thaw - Table Log.md`;
    const C2S2 = `${CH2}/Sessions/Session 02/Session 02 - Second Road.md`;
    sessionIndex(dir, C2S1, { number: 1, chapter: 'Chapter 2', log: 'Session 01 - The Thaw - Table Log' });
    tableLog(dir, C2S1_LOG, 'Session 01 - The Thaw', ['| [[Lucan Grey]] | 2/16 | |']);
    sessionIndex(dir, C2S2, { number: 2, chapter: 'Chapter 2', log: null });
    const plan = (rel, session) => {
      write(dir, rel, ['---', 'type: session-plan', `session: "[[${session}]]"`, 'chapter: "[[Chapter 2]]"', '---', '',
        '## Planned Scenes', '', '### Scene 1: Again', '**Situation:** Lucan again.', '**NPCs**', '- **[[Lucan Grey]]:** helps', ''].join('\n'));
      return rel;
    };
    const P1 = plan(`${CH2}/Sessions/Session 01/Session 01 - The Thaw - Plan.md`, 'Session 01 - The Thaw');
    const P2 = plan(`${CH2}/Sessions/Session 02/Session 02 - Second Road - Plan.md`, 'Session 02 - Second Road');
    const hpOf = (plan) => {
      const rows = allyRows(readRunSheet(dir, plan, { party: PARTY }));
      assert.ok(rows.length >= 1, plan);
      return [...new Set(rows.map((f) => `${f.hpNow} ${f.carriedFrom}`))];
    };
    // Chapter 1 Session 02 follows Chapter 1 Session 01, not Chapter 2's
    assert.deepStrictEqual(hpOf(PLAN), [`9 ${S1_LOG}`]);
    // Chapter 2 Session 01 follows the last session of Chapter 1, not a Session 00
    assert.deepStrictEqual(hpOf(P1), [`5 ${S2_LOG}`]);
    // Chapter 2 Session 02 follows Chapter 2 Session 01, not Chapter 1's Session 01
    assert.deepStrictEqual(hpOf(P2), [`2 ${C2S1_LOG}`]);
  });

  // S1 has a log naming Lucan; S2 (the fixture's) and S3 are made as each test needs; the Plan is S3's.
  const S2 = `${CH1}/Sessions/Session 02/Session 02 - The Test.md`;
  const S2_LOG = `${CH1}/Sessions/Session 02/Session 02 - The Test - Table Log.md`;
  const S3 = `${CH1}/Sessions/Session 03/Session 03 - Next.md`;
  const P3 = `${CH1}/Sessions/Session 03/Session 03 - Next - Plan.md`;
  const withS3 = (dir) => {
    sessionIndex(dir, S3, { number: 3, chapter: 'Chapter 1', log: null, status: 'planned' });
    write(dir, P3, ['---', 'type: session-plan', 'session: "[[Session 03 - Next]]"', 'chapter: "[[Chapter 1]]"', '---', '',
      '## Planned Scenes', '', '### Scene 1: Again', '**Situation:** Lucan again.', '**NPCs**', '- **[[Lucan Grey]]:** helps', ''].join('\n'));
    const m = readRunSheet(dir, P3, { party: PARTY });
    const rows = allyRows(m);
    assert.ok(rows.length >= 1);
    return { m, got: [...new Set(rows.map((f) => `${f.hpNow} ${f.carriedFrom}`))] };
  };

  it('walks back past a played session with no Table Log', () => {
    const dir = withS1();
    sessionIndex(dir, S2, { number: 2, chapter: 'Chapter 1', log: null });
    const { m, got } = withS3(dir);
    assert.deepStrictEqual(got, [`9 ${S1_LOG}`]);
    assert.deepStrictEqual(tableLogWarnings(m), []);
  });

  it('skips an unplayed session index between', () => {
    // the fixture's S2 is planned, with no records
    const { got } = withS3(withS1());
    assert.deepStrictEqual(got, [`9 ${S1_LOG}`]);
  });

  it('an unplayed index does not count even with a log beside it unlinked', () => {
    const dir = withS1();
    tableLog(dir, S2_LOG, 'Session 02 - The Test', ['| [[Lucan Grey]] | 2/27 | |']);
    const { got } = withS3(dir);
    assert.deepStrictEqual(got, [`9 ${S1_LOG}`]);
  });

  it('a later Table Log that does not name the ally does not stop the walk', () => {
    const dir = withS1();
    sessionIndex(dir, S2, { number: 2, chapter: 'Chapter 1', log: 'Session 02 - The Test - Table Log' });
    tableLog(dir, S2_LOG, 'Session 02 - The Test', ['| [[Ada Moss]] | 3/11 | |']);
    const { got } = withS3(dir);
    assert.deepStrictEqual(got, [`9 ${S1_LOG}`]);
  });

  it('the latest Table Log naming the ally wins', () => {
    const dir = withS1();
    sessionIndex(dir, S2, { number: 2, chapter: 'Chapter 1', log: 'Session 02 - The Test - Table Log' });
    tableLog(dir, S2_LOG, 'Session 02 - The Test', ['| [[Lucan Grey]] | 14/27 | |']);
    const { got } = withS3(dir);
    assert.deepStrictEqual(got, [`14 ${S2_LOG}`]);
  });

  it('a session played by its Play Notes alone counts, its unlinked Table Log found by session:', () => {
    const dir = withS1();
    write(dir, S2, ['---', 'type: session', 'session_number: 2', 'chapter: "[[Chapter 1]]"', 'status: planned',
      'documents:', '  play_notes: "[[Session 02 - The Test - Play Notes]]"', '---', ''].join('\n'));
    write(dir, `${CH1}/Sessions/Session 02/Session 02 - The Test - Play Notes.md`, '---\ntype: session-play-notes\n---\n\nPlayed.\n');
    tableLog(dir, S2_LOG, 'Session 02 - The Test', ['| [[Lucan Grey]] | 14/27 | |']);
    const { got } = withS3(dir);
    assert.deepStrictEqual(got, [`14 ${S2_LOG}`]);
  });

  it('a chapter matched by its title: field orders as the site orders it', () => {
    // Sessions in one flat folder name their chapter by the chapter's title, not its file name: only the
    // title (the scanner's displayTitle) ties them to a chapter. Number alone would put B's S1 before C's S2.
    const dir = copy();
    write(dir, 'Book/Ch1.md', '---\ntype: chapter\nstatus: active\nsort_order: 1\ntitle: The Frost\n---\n\n# The Frost\n');
    write(dir, 'Book/Ch2.md', '---\ntype: chapter\nstatus: active\nsort_order: 2\ntitle: The Thaw\n---\n\n# The Thaw\n');
    const idx = (rel, number, chapter, log) => write(dir, rel, ['---', 'type: session', `session_number: ${number}`,
      `chapter: "${chapter}"`, 'documents:', `  table_log: ${log ? `"[[${log}]]"` : 'null'}`, '---', ''].join('\n'));
    idx('Book/Sessions/A - First.md', 1, 'Book - The Frost', 'A - First - Table Log');
    tableLog(dir, 'Book/Sessions/A - First - Table Log.md', 'A - First', ['| [[Lucan Grey]] | 6/16 | |']);
    idx('Book/Sessions/B - Thaw One.md', 1, 'Book - The Thaw', 'B - Thaw One - Table Log');
    tableLog(dir, 'Book/Sessions/B - Thaw One - Table Log.md', 'B - Thaw One', ['| [[Lucan Grey]] | 1/16 | |']);
    idx('Book/Sessions/C - Second.md', 2, 'Book - The Frost', null);
    const P = 'Book/Sessions/C - Second - Plan.md';
    write(dir, P, ['---', 'type: session-plan', 'session: "[[C - Second]]"', '---', '',
      '## Planned Scenes', '', '### Scene 1: Again', '**Situation:** Lucan again.', '**NPCs**', '- **[[Lucan Grey]]:** helps', ''].join('\n'));
    const rows = allyRows(readRunSheet(dir, P, { party: PARTY }));
    assert.ok(rows.length >= 1);
    for (const f of rows) assert.deepStrictEqual([f.hpNow, f.carriedFrom], [6, 'Book/Sessions/A - First - Table Log.md']);
  });

  it('a dying ally carries negative hit points', () => {
    const m = readRunSheet(withS1(['| [[Lucan Grey]] | -3/12 | dying |']), PLAN, { party: PARTY });
    for (const f of allyRows(m)) assert.deepStrictEqual([f.hpNow, f.carriedFrom], [-3, S1_LOG]);
  });

  it('foes are never carried', () => {
    const m = readRunSheet(withS1(['| [[Brother Ash]] | 3/20 | bloodied |', '| [[Frost Wolf]] | 1/15 | |', '| [[Lucan Grey]] | 9/27 | |']), PLAN, { party: PARTY });
    const foes = m.beats.flatMap((b) => b.foes).filter((f) => !f.ally);
    assert.ok(foes.some((f) => f.note === ASH));
    for (const f of foes) assert.deepStrictEqual([f.hpNow, f.carriedFrom], [null, null], f.name);
    for (const f of allyRows(m)) assert.strictEqual(f.hpNow, 9);
  });

  it('an unlinked Table Log whose session: names the index is read', () => {
    const dir = withS1();
    sessionIndex(dir, S1, { number: 1, chapter: 'Chapter 1', log: null });
    const m = readRunSheet(dir, PLAN, { party: PARTY });
    for (const f of allyRows(m)) assert.deepStrictEqual([f.hpNow, f.carriedFrom], [9, S1_LOG]);
    assert.deepStrictEqual(tableLogWarnings(m), []);
  });

  it('a documents.table_log that links a note of another type warns once and is not read', () => {
    const dir = withS1();
    const NOTES = `${CH1}/Sessions/Session 01/Session 01 - The Road - Play Notes.md`;
    write(dir, NOTES, ['---', 'type: session-play-notes', '---', '', '| Who | HP |', '|---|---|', '| [[Lucan Grey]] | 3 |', ''].join('\n'));
    sessionIndex(dir, S1, { number: 1, chapter: 'Chapter 1', log: 'Session 01 - The Road - Play Notes' });
    fs.rmSync(path.join(dir, S1_LOG));
    const m = readRunSheet(dir, PLAN, { party: PARTY });
    for (const f of allyRows(m)) assert.deepStrictEqual([f.hpNow, f.carriedFrom], [null, null]);
    const w = tableLogWarnings(m);
    assert.strictEqual(w.length, 1, JSON.stringify(w));
    assert.strictEqual(w[0].note, S1);
    assert.match(w[0].text, /session-table-log/);
  });

  it('a session note in a workspace or templates folder, in any case, is never the previous session', () => {
    for (const folder of ['_inbox', '_Inbox', '_templates', '_QA']) {
      const dir = withS1();
      const rel = `${folder}/Session 01 - Draft.md`;
      sessionIndex(dir, rel, { number: 1, chapter: 'Chapter 1', log: 'Session 01 - Draft - Table Log' });
      tableLog(dir, `${folder}/Session 01 - Draft - Table Log.md`, 'Session 01 - Draft', ['| [[Lucan Grey]] | 2/27 | |']);
      const m = readRunSheet(dir, PLAN, { party: PARTY });
      for (const f of allyRows(m)) assert.deepStrictEqual([f.hpNow, f.carriedFrom], [9, S1_LOG], folder);
    }
  });

  it('a Windows checkout (CRLF) Table Log carries the same', () => {
    const dir = withS1();
    const abs = path.join(dir, S1_LOG);
    fs.writeFileSync(abs, fs.readFileSync(abs, 'utf8').replace(/\r?\n/g, '\r\n'));
    for (const f of allyRows(readRunSheet(dir, PLAN, { party: PARTY }))) assert.deepStrictEqual([f.hpNow, f.carriedFrom], [9, S1_LOG]);
  });
});

// Task 3 of the live app: what the page needs from the reader.
describe('run sheet reader: loot items, Plan-line HP, carried unmaskings', () => {
  const FROST = 'Items/Frost Brand.md';
  const item = (name, type = 'item', aliases = '') => `---\nname: ${name}\ntype: ${type}\n${aliases}---\n\n# ${name}\n`;
  const withTreasure = (lines) => {
    const dir = copy();
    write(dir, FROST, item('Frost Brand', 'item', 'aliases: [The Cold Blade]\n'));
    write(dir, 'Items/Ash Note.md', item('Ash Note', 'prop'));
    const abs = path.join(dir, PLAN);
    const text = fs.readFileSync(abs, 'utf8').replace(/\r\n?/g, '\n');
    fs.writeFileSync(abs, text.replace('- A silver bell clapper\n', `${lines.join('\n')}\n- A silver bell clapper\n`));
    return readRunSheet(dir, PLAN, { party: PARTY });
  };
  const lootOf = (m) => m.beats.flatMap((b) => b.treasure).map((t) => [t.text, t.item]);

  it('a loot row names its item note by link and by plain name', () => {
    const m = withTreasure(['- [[Frost Brand]] (longsword, +1)', '- Frost Brand (longsword, +2)', '- The Cold Blade, wrapped in oilcloth', '- [[Ash Note]]']);
    const got = Object.fromEntries(lootOf(m));
    assert.strictEqual(got['[[Frost Brand]] (longsword, +1)'], FROST);
    assert.strictEqual(got['Frost Brand (longsword, +2)'], FROST);
    assert.strictEqual(got['The Cold Blade, wrapped in oilcloth'], FROST);
    assert.strictEqual(got['[[Ash Note]]'], 'Items/Ash Note.md');
  });

  it('a loot row with no item note', () => {
    const m = withTreasure(['- Frost Brandy (a flask)', '- [[Lucan Grey]] owes the party a favour']);
    const got = Object.fromEntries(lootOf(m));
    assert.strictEqual(got['A silver bell clapper'], null);
    assert.strictEqual(got['Frost Brandy (a flask)'], null);
    assert.strictEqual(got['[[Lucan Grey]] owes the party a favour'], null, 'an npc is no item');
  });

  describe('an ally on the Plan line', () => {
    const LUCAN = 'Characters/NPCs/Lucan Grey.md';
    const P3 = `${CH1}/Sessions/Session 03/Session 03 - Next - Plan.md`;
    const run = (dir, scenes, extra = (d) => d) => {
      sessionIndex(dir, `${CH1}/Sessions/Session 03/Session 03 - Next.md`, { number: 3, chapter: 'Chapter 1', log: null, status: 'planned' });
      write(dir, P3, ['---', 'type: session-plan', 'session: "[[Session 03 - Next]]"', 'chapter: "[[Chapter 1]]"', '---', '', '## Planned Scenes', '', scenes, ''].join('\n'));
      return readRunSheet(extra(dir), P3, { party: PARTY });
    };
    it("an ally's Plan-line HP wins", () => {
      const m = run(withS1(), '### Scene 1: Again\n**Situation:** x\n**NPCs**\n- **[[Lucan Grey]]:** 32 of 38 HP, helps');
      const f = allyRows(m);
      assert.ok(f.length >= 1);
      for (const r of f) assert.deepStrictEqual([r.note, r.hpNow, r.carriedFrom, r.hp], [LUCAN, 32, P3, 16]);
    });
    it('an ally in two beats takes the first Plan-line figure for both', () => {
      const m = run(withS1(), [
        '### Scene 1: One\n**Situation:** x\n**NPCs**\n- **[[Lucan Grey]]:** helps',
        '### Scene 2: Two\n**Situation:** x\n**NPCs**\n- **[[Lucan Grey]]:** 5/38 HP, hurt',
        '### Scene 3: Three\n**Situation:** x\n**NPCs**\n- **[[Lucan Grey]]:** 30 of 38 HP',
      ].join('\n\n'));
      const f = allyRows(m);
      assert.strictEqual(m.beats.filter((b) => b.foes.some((x) => x.ally)).length, 3);
      for (const r of f) assert.deepStrictEqual([r.hpNow, r.carriedFrom, r.hp], [5, P3, 16]);
    });
    it('without a figure the Table Log still carries', () => {
      const m = run(withS1(), '### Scene 1: Again\n**Situation:** x\n**NPCs**\n- **[[Lucan Grey]]:** helps');
      const rows = allyRows(m);
      assert.ok(rows.some((r) => r.note === LUCAN), "Lucan's row is there");
      for (const r of rows) assert.deepStrictEqual([r.hpNow, r.carriedFrom], [9, S1_LOG]);
    });
  });

  describe('unmaskings carried from earlier Table Logs', () => {
    const ASHP = 'Characters/NPCs/Brother Ash.md';
    const addUnmask = (dir) => {
      const t = fs.readFileSync(path.join(dir, ASHP), 'utf8').replace(/\r?\n/g, '\n');
      write(dir, ASHP, t.replace('type: npc\n', 'type: npc\nunmasked_name: The Ember Abbot\n'));
    };
    const logWith = (dir, rel, session, unmasked) => {
      tableLog(dir, rel, session, ['| [[Ada Moss]] | 4/11 | |']);
      const abs = path.join(dir, rel);
      fs.writeFileSync(abs, `${fs.readFileSync(abs, 'utf8')}\n## Unmasked this session\n\n${unmasked.join('\n')}\n`);
    };
    const S2I = `${CH1}/Sessions/Session 02/Session 02 - The Test.md`;
    const S2L = `${CH1}/Sessions/Session 02/Session 02 - The Test - Table Log.md`;
    const earlier = (s1) => {
      const dir = copy();
      addUnmask(dir);
      sessionIndex(dir, S1, { number: 1, chapter: 'Chapter 1', log: 'Session 01 - The Road - Table Log' });
      logWith(dir, S1_LOG, 'Session 01 - The Road', s1);
      return dir;
    };
    it("an earlier Table Log's unmasking starts the note unmasked", () => {
      const m = readRunSheet(earlier(['- [[Brother Ash]] as The Ember Abbot']), PLAN, { party: PARTY });
      assert.strictEqual(m.notes[ASHP].unmask.since, S1_LOG);
      assert.strictEqual(m.notes[ASHP].unmask.name, 'The Ember Abbot');
    });
    it('a note nobody unmasked has since null', () => {
      const m = readRunSheet(earlier(['- [[Lucan Grey]] as Someone']), PLAN, { party: PARTY });
      assert.strictEqual(m.notes[ASHP].unmask.since, null);
    });
    it('an unmasking for a note with no Unmask is ignored', () => {
      const dir = earlier(['- [[Brother Venn]] as Someone Else']);
      // Brother Venn is in tonight's Plan, so the model has his note to check
      const plan = path.join(dir, PLAN);
      fs.writeFileSync(plan, fs.readFileSync(plan, 'utf8').replace(/\r\n?/g, '\n').replace('- **[[Brother Ash]]:** wants the bell rung', '- **[[Brother Ash]]:** wants the bell rung\n- **[[Brother Venn]]:** watches'));
      const m = readRunSheet(dir, PLAN, { party: PARTY });
      const venn = m.notes['Characters/NPCs/Brother Venn.md'];
      assert.ok(venn, 'Brother Venn is in the model');
      assert.strictEqual(venn.unmask, null);
      assert.deepStrictEqual(tableLogWarnings(m), []);
    });
    it('masked again in a later log cancels it', () => {
      const dir = earlier(['- [[Brother Ash]] as The Ember Abbot']);
      // a played Session 02 earlier than a Session 03 Plan: Session 03 reads both logs
      sessionIndex(dir, S2I, { number: 2, chapter: 'Chapter 1', log: 'Session 02 - The Test - Table Log' });
      logWith(dir, S2L, 'Session 02 - The Test', ['- [[Brother Ash]] masked again']);
      sessionIndex(dir, `${CH1}/Sessions/Session 03/Session 03 - Next.md`, { number: 3, chapter: 'Chapter 1', log: null, status: 'planned' });
      const p3 = `${CH1}/Sessions/Session 03/Session 03 - Next - Plan.md`;
      write(dir, p3, ['---', 'type: session-plan', 'session: "[[Session 03 - Next]]"', 'chapter: "[[Chapter 1]]"', '---', '',
        '## Planned Scenes', '', '### Scene 1: Again', '**Situation:** x', '**NPCs**', '- **[[Brother Ash]]:** rings'].join('\n'));
      assert.strictEqual(readRunSheet(dir, p3, { party: PARTY }).notes[ASHP].unmask.since, null);
      // and unmasked once more after being masked: the later unmasking counts
      logWith(dir, S2L, 'Session 02 - The Test', ['- [[Brother Ash]] masked again', '- [[Brother Ash]] as The Ember Abbot']);
      assert.strictEqual(readRunSheet(dir, p3, { party: PARTY }).notes[ASHP].unmask.since, S2L);
      // masked in S1, unmasked in S2 only: since is S2's log; unmasked in both with no cancel: the earlier one
      logWith(dir, S2L, 'Session 02 - The Test', ['- [[Brother Ash]] as The Ember Abbot']);
      assert.strictEqual(readRunSheet(dir, p3, { party: PARTY }).notes[ASHP].unmask.since, S1_LOG);
    });
  });

  it('a note carries unseen_as, trimmed', () => {
    const dir = copy();
    const lp = path.join(dir, LUCAN_NOTE);
    fs.writeFileSync(lp, fs.readFileSync(lp, 'utf8').replace(/\r?\ntype: npc/, '\ntype: npc\nunseen_as: " a courier "'));
    const m = readRunSheet(dir, PLAN, { party: PARTY });
    assert.strictEqual(m.notes[LUCAN_NOTE].unseenAs, 'a courier');
  });

  describe('showable maps (5b)', () => {
    const mapNote = (name, extra = '') => `---\nname: ${name}\ntype: document\ndoc_type: map\n${extra}---\n\nA map.\n`;
    const GM = 'Documents/Map of the Gate (GM).md';
    const GATE = 'Documents/Map of the Gate.md';

    it('a GM map is never showable; its player twin is', () => {
      const dir = copy();
      write(dir, GM, mapNote('Map of the Gate (GM)'));
      const m = readRunSheet(dir, PLAN, { party: PARTY });
      assert.deepStrictEqual(m.showableMaps, [GATE]);
      // a GM map named by player_version, with no (GM) in its name, is no more showable
      write(dir, 'Documents/Cellar.md', mapNote('Cellar', 'player_version: "[[Cellar Sketch]]"\n'));
      write(dir, 'Documents/Cellar Sketch.md', mapNote('Cellar Sketch'));
      assert.deepStrictEqual(readRunSheet(dir, PLAN, { party: PARTY }).showableMaps, ['Documents/Cellar Sketch.md', GATE]);
    });

    it('a withheld map is not showable', () => {
      const dir = copy();
      write(dir, 'Documents/Hidden Vault.md', mapNote('Hidden Vault', 'withheld: true\n'));
      assert.deepStrictEqual(readRunSheet(dir, PLAN, { party: PARTY }).showableMaps, [GATE]);
    });

    it('a map the publish list excludes is not showable', () => {
      const dir = copy();
      write(dir, 'Documents/Other.md', mapNote('Other'));
      write(dir, '_meta/publish-list.yaml', `publishing:\n  - ${GATE}\n  - Documents/Other.md\nexcluded:\n  - Documents/Other.md\n`);
      assert.deepStrictEqual(readRunSheet(dir, PLAN, { party: PARTY }).showableMaps, [GATE, 'Documents/Other.md'], 'publishing wins a double listing');
      write(dir, '_meta/publish-list.yaml', `publishing:\n  - ${GATE}\nexcluded:\n  - Documents/Other.md\n`);
      assert.deepStrictEqual(readRunSheet(dir, PLAN, { party: PARTY }).showableMaps, [GATE]);
      write(dir, '_meta/publish-list.yaml', `publishing:\n  - Documents/Other.md\nexcluded:\n  - ${GATE}\n`);
      assert.deepStrictEqual(readRunSheet(dir, PLAN, { party: PARTY }).showableMaps, ['Documents/Other.md']);
    });

    it('a map in a folder player_site.folder_map leaves out is not showable', () => {
      const dir = copy();
      write(dir, 'GM Maps/Back Stair.md', mapNote('Back Stair'));
      // no map set (no site set up): each map's own rule
      assert.deepStrictEqual(readRunSheet(dir, PLAN, { party: PARTY }).showableMaps, [GATE, 'GM Maps/Back Stair.md']);
      write(dir, '_meta/vault-config.yaml', 'vault:\n  system: dnd-5e-2024\nplayer_site:\n  title: The Test Campaign\n  folder_map:\n    Documents: documents\n');
      assert.deepStrictEqual(readRunSheet(dir, PLAN, { party: PARTY }).showableMaps, [GATE]);
    });

    it('no publish list: an ordinary map is showable', () => {
      const dir = copy();
      const m = readRunSheet(dir, PLAN, { party: PARTY });
      assert.deepStrictEqual(m.showableMaps, [GATE]);
      assert.ok(!m.warnings.some((w) => w.kind === 'map-list'));
    });

    it('a publish list that does not read leaves the list empty and warns', () => {
      const dir = copy();
      write(dir, '_meta/publish-list.yaml', 'publishing: [unclosed\n  - x: : :\n');
      const m = readRunSheet(dir, PLAN, { party: PARTY });
      assert.deepStrictEqual(m.showableMaps, []);
      const w = m.warnings.filter((x) => x.kind === 'map-list');
      assert.deepStrictEqual(w.map((x) => x.text), ['the publish list could not be read: no map can be Shown']);
    });
  });
});

// plan 6a Task 7: Fight here at any place, and Move them
describe('places the party can go', () => {
  // final review O5
  it('a map typed location, GM half or not, is no place to go', () => {
    const dir = copy();
    write(dir, 'Documents/Gate Map (GM).md', '---\nname: Gate Map (GM)\ntype: location\ndoc_type: map\n---\n\nThe secret door.\n');
    write(dir, 'Documents/Gate Map.md', '---\nname: Gate Map\ntype: location\ndoc_type: map\n---\n\nThe gate.\n');
    write(dir, 'Locations/The Club.md', '---\nname: The Club\ntype: location\n---\n\nA club.\n');
    const m = readRunSheet(dir, PLAN, { party: PARTY });
    for (const p of ['Documents/Gate Map (GM).md', 'Documents/Gate Map.md']) {
      assert.ok(!(p in m.placeKeys), `${p}: no place key`);
      assert.ok(!(p in m.placeNotes), `${p}: no place note`);
    }
    assert.ok('Locations/The Club.md' in m.placeKeys, 'a plain location still is one');
  });

  it('placePeople reads location links', () => {
    const dir = copy();
    write(dir, 'Locations/The Club.md', '---\nname: The Club\ntype: location\n---\n\nA club.\n');
    write(dir, "Locations/St. Mary's.md", "---\nname: St. Mary's\ntype: location\n---\n\nA church.\n");
    write(dir, 'Creatures/Club Rat.md', '---\nname: Club Rat\ntype: creature\nlocation: "[[The Club]]"\n---\n\n## GM Notes\n\n### Stats\n\nAC 10\nHP 3\n');
    write(dir, 'Characters/NPCs/Doorman.md', '---\nname: Doorman\ntype: npc\nlocation: "[[The Club]]"\n---\n\nNo stats.\n');
    write(dir, 'Characters/NPCs/Verger.md', "---\nname: Verger\ntype: npc\nlocation: \"[[St. Mary's]]\"\n---\n\nNo stats.\n");
    write(dir, 'Characters/NPCs/Nowhere Man.md', '---\nname: Nowhere Man\ntype: npc\nlocation: "[[No Such Place]]"\n---\n');
    write(dir, 'Characters/NPCs/Plain.md', '---\nname: Plain\ntype: npc\nlocation: The Club\n---\n');
    const m = readRunSheet(dir, PLAN, { party: PARTY });
    assert.deepStrictEqual(m.placePeople['Locations/The Club.md'], ['Characters/NPCs/Doorman.md', 'Characters/NPCs/Plain.md', 'Creatures/Club Rat.md']);
    assert.deepStrictEqual(m.placePeople["Locations/St. Mary's.md"], ['Characters/NPCs/Verger.md']);
    assert.ok(!Object.values(m.placePeople).flat().includes('Characters/NPCs/Nowhere Man.md'), 'a link to no place places nobody');
    // every location in the vault is a place to go: keyed, with its own entry for its name and picture
    for (const p of ['Locations/The Club.md', "Locations/St. Mary's.md"]) {
      assert.match(m.placeKeys[p], /^pl-[0-9a-f]{8}$/, p);
      assert.strictEqual(m.placeNotes[p].name, p === 'Locations/The Club.md' ? 'The Club' : "St. Mary's");
      assert.strictEqual(m.placeNotes[p].type, 'location');
      assert.ok(!(p in m.notes), 'notes stays the notes the sheet touches');
    }
    assert.ok(!Object.values(m.placeKeys).some((k) => k.includes('.')), 'no key holds a dot');
    assert.ok(!('Creatures/Club Rat.md' in m.placeKeys), 'only locations');
    // a vault with no such notes reads as before
    const plain = readRunSheet(copy(), PLAN, { party: PARTY });
    assert.ok(plain.placeKeys && typeof plain.placePeople === 'object');
  });
});

// plan 6a Task 8: the side colours are a vault setting
describe('side colours', () => {
  it('the model carries sideColours', () => {
    const m = readRunSheet(copy(), PLAN, { party: PARTY });
    assert.deepStrictEqual(m.sideColours, { preset: 'pens', own: { pc: '#2c7739', ally: '#7a3fb0', foe: '#b3261e', neutral: '#646870' } });
    const dir = copy();
    writeSettings(dir, { 'vault.system': 'dnd5e', 'vault.run_sheet.side_colours': 'own', 'vault.run_sheet.own_colours.foe': '#112233' });
    const own = readRunSheet(dir, PLAN, { party: PARTY });
    assert.strictEqual(own.sideColours.preset, 'own');
    assert.strictEqual(own.sideColours.own.foe, '#112233');
    assert.strictEqual(own.sideColours.own.pc, '#2c7739');
  });
  it('an unknown preset reads as pens, with a prep note', () => {
    const dir = copy();
    writeSettings(dir, { 'vault.system': 'dnd5e', 'vault.run_sheet.side_colours': 'neon' });
    const m = readRunSheet(dir, PLAN, { party: PARTY });
    assert.strictEqual(m.sideColours.preset, 'pens');
    assert.strictEqual(m.warnings.filter((w) => w.kind === 'side-colours').length, 1);
  });
  it('a bad own colour falls back, with a prep note', () => {
    const dir = copy();
    writeSettings(dir, { 'vault.system': 'dnd5e', 'vault.run_sheet.side_colours': 'own', 'vault.run_sheet.own_colours.foe': 'red', 'vault.run_sheet.own_colours.pc': '#abc' });
    const m = readRunSheet(dir, PLAN, { party: PARTY });
    assert.strictEqual(m.sideColours.own.foe, '#b3261e');
    assert.strictEqual(m.sideColours.own.pc, '#2c7739');
    const notes = m.warnings.filter((w) => w.kind === 'side-colours');
    assert.strictEqual(notes.length, 2);
    assert.match(notes[0].text, /#rrggbb/);
  });

  it('a contingency with no NPCs block skips a Then-linked person a planned beat lists, matched by note path', () => {
    const dir = copy();
    const p = path.join(dir, PLAN);
    fs.writeFileSync(p, readText(p).replace(/(### The Wolves Return\n\*\*Trigger:\*\* The bell rings twice\.\n)\*\*Then\*\*\n- The pack comes down from the ridge\.\n\*\*NPCs\*\*\n- .*\n- .*\n/,
      '$1**Then**\n- [[Brother Ash]] and [[Ice Mephit]] come down from the ridge.\n'));
    const m = readRunSheet(dir, PLAN, { party: PARTY });
    const c = m.beats.find((x) => x.contingency && x.title === 'The Wolves Return');
    assert.deepStrictEqual(c.foes.map((f) => [f.name, !f.benched]), [['Ice Mephit', true]]);
    assert.ok(m.warnings.some((w) => w.kind === 'who-from-then'));
  });

});
