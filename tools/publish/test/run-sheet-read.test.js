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
    // run long: the next Plan, the unplayed scenes, the Planning notes, the contingencies
    assert.strictEqual(m.runLong.nextPlan, 'Chapters/Chapter 1/Sessions/Session 03/Session 03 - Next - Plan.md');
    assert.deepStrictEqual(m.runLong.scenes, ['Chapters/Chapter 1/Scenes/The Bell Tower.md', 'Chapters/Chapter 1/Scenes/Unplayed.md']);
    assert.deepStrictEqual(m.runLong.planning, [{ note: 'Chapters/Chapter 1/Planning/Arc.md', kind: 'arc', heads: ['The Arc', 'Beats To Hit'] }]);
    assert.deepStrictEqual(m.runLong.contingencies, [m.beats[5].key]);
    // every path in the model has a Note; withheld is read
    assert.strictEqual(m.notes['Locations/The Gate House.md'].withheld, true);
    assert.strictEqual(m.notes['Documents/Map of the Gate.md'].docType, 'map');
    assert.deepStrictEqual(m.notes['Characters/NPCs/Lucan Grey.md'].aliases, ['Lucan']);
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

    it('unmasked_name gives an unmask', () => {
      const dir = copy();
      const ash = fs.readFileSync(path.join(dir, ASH), 'utf8')
        .replace('type: npc\n', 'type: npc\nunmasked_name: " The Ember Abbot "\nunmasked_portrait: "_attachments/ember.png"\n')
        .replace('- **Tell:**', '- **Unmasked:** cold, never says "indeed"\n- **Tell:**');
      write(dir, ASH, ash);
      write(dir, '_attachments/ember.png', 'x');
      const m = readRunSheet(dir, PLAN, { party: PARTY });
      assert.deepStrictEqual(m.notes[ASH].unmask, {
        name: 'The Ember Abbot',
        portrait: '_attachments/ember.png',
        playAs: 'cold, never says "indeed" rubs his thumb along the rope scar',
      });
      // the disguise's own name and play-as are unchanged
      assert.strictEqual(m.notes[ASH].name, 'Brother Ash');
      assert.match(m.people.find((p) => p.note === ASH).playAs, /^slow, fond of the word/);
    });

    it('an unmask with no face or Unmasked line has what the note gives, and a missing face warns', () => {
      const dir = copy();
      const ash = fs.readFileSync(path.join(dir, ASH), 'utf8');
      write(dir, ASH, ash.replace('type: npc\n', 'type: npc\nunmasked_name: The Ember Abbot\nunmasked_portrait: ""\n'));
      let m = readRunSheet(dir, PLAN, { party: PARTY });
      // no Unmasked line: the true self speaks as the disguise does (Speech is kept by --unmask)
      assert.deepStrictEqual(m.notes[ASH].unmask, { name: 'The Ember Abbot', portrait: null, playAs: 'slow, fond of the word "indeed" rubs his thumb along the rope scar' });
      write(dir, ASH, ash.replace('type: npc\n', 'type: npc\nunmasked_name: The Ember Abbot\nunmasked_portrait: nowhere.png\n'));
      m = readRunSheet(dir, PLAN, { party: PARTY });
      assert.strictEqual(m.notes[ASH].unmask.portrait, null);
      assert.ok(m.warnings.some((w) => w.kind === 'no-portrait' && w.note === ASH && /unmasked_portrait nowhere\.png .*the Unmask has no face/.test(w.text)), JSON.stringify(m.warnings));
    });

    const withFm = (dir, lines) => {
      const ash = fs.readFileSync(path.join(FIXTURE, ASH), 'utf8');
      write(dir, ASH, ash.replace('type: npc\n', `type: npc\n${lines}`));
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
    assert.deepStrictEqual(readRunSheet(crlf, PLAN, { party: PARTY }), readRunSheet(lf, PLAN, { party: PARTY }));
  });
});
