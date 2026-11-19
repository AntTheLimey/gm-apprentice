'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readRunSheet, completeness } = require('../lib/run-sheet/read');
const { normalise } = require('../lib/run-sheet/keys');
const { cleanText } = require('../lib/run-sheet/plan-text');
const { writeSettings } = require('./helpers/vault-files');

const FIXTURE = path.join(__dirname, 'fixtures', 'run-sheet');
const PLAN = 'Chapters/Chapter 1/Sessions/Session 02/Session 02 - The Test - Plan.md';
const ADA = 'Characters/PCs/Ada Moss.md';
const BEN = 'Characters/PCs/Ben Hart.md';
const PARTY = [ADA, BEN];

function copy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-'));
  fs.cpSync(FIXTURE, dir, { recursive: true });
  writeSettings(dir, { 'vault.system': 'dnd5e' });
  return dir;
}

const write = (dir, rel, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
};
const bodyOf = (text) => text.replace(/^---\n[\s\S]*?\n---\n/, '');

// Every primitive in the model, as one normalised string.
function haystack(model) {
  const out = [];
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    else if (v !== null && v !== undefined) out.push(String(v));
  };
  walk(model);
  return normalise(out.join('\n¶\n'));
}

// The sections a field takes: their heading lines are the field names, not text.
const TAKEN = /^##\s+(?:session overview|world state|session end objectives|handouts & props|active threads|npc quick reference|planned scenes|contingency scenes|spotlight forecast|touchpoint plan|pc roster & arcs)\s*$/i;
// Bare block heads a beat reads into its fields.
const BLOCK_HEAD = /^\*\*(?:npcs|points to land|if the players\.\.\.|treasure|then|complications)\*\*\s*$/i;
const isRow = (l) => /^\s*\|/.test(l);
const isSep = (l) => /^\s*\|?[\s:|-]*-[\s:|-]*$/.test(l) && isRow(l);

// The Plan lines the model holds nowhere. A line is found whole, or with its markup taken off, or
// (a line a field split up, such as an NPC line) as each of its parts.
function missingLines(planBody, model) {
  const hay = haystack(model);
  const has = (s) => s === '' || hay.includes(s);
  const strip = (l) => l
    .replace(/^#{1,6}\s+/, '')
    .replace(/^scene\s+\d+\s*:\s*/i, '')
    .replace(/^\s*>\s?/, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s*)?/, '')
    .replace(/^\*\*(?:situation|starts it|trigger|entities|handouts|who):\*\*\s*/i, '');
  // Each link's target and each run of words between them and the punctuation fields split on.
  const parts = (l) => normalise(l.replace(/\[\[([^\]|#]+)[^\]]*\]\]/g, ';$1;'))
    .split(/[(),:;|—–]|\band\b/).map((x) => x.trim()).filter(Boolean);
  const lines = cleanText(planBody).split('\n');
  const out = [];
  lines.forEach((line, i) => {
    if (line.trim() === '' || TAKEN.test(line) || BLOCK_HEAD.test(line) || isSep(line)) return;
    if (isRow(line)) {
      if (i + 1 < lines.length && isSep(lines[i + 1])) return; // a table header names columns
      const cells = line.split('|').map((c) => normalise(c)).filter(Boolean);
      if (!cells.every(has)) out.push(line);
      return;
    }
    if (has(normalise(line))) return;
    const core = strip(line);
    if (has(normalise(core)) || parts(core).every(has)) return;
    out.push(line);
  });
  return out;
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
    assert.deepStrictEqual([...m.places].sort(), [
      'Locations/The Bell Tower Room.md', 'Locations/The Chapel Yard.md', 'Locations/The Gate House.md', 'Locations/The Gate.md',
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
    const body = bodyOf(fs.readFileSync(path.join(dir, PLAN), 'utf8'));
    assert.deepStrictEqual(missingLines(body, m), []);
    // the check can fail: a field emptied shows up
    const cut = JSON.parse(JSON.stringify(m));
    cut.beats[0].situation = '';
    assert.deepStrictEqual(missingLines(body, cut), ['**Situation:** The gate is shut and the bell', 'rope hangs cut; Brother Ash will not open it until it rings.']);
    // with no party, the PC lines are still kept
    const alone = readRunSheet(dir, PLAN);
    assert.deepStrictEqual(missingLines(body, alone), []);
  });

  it('every line of a real hub plan is kept somewhere', () => {
    const dir = copy();
    const rel = 'Chapters/Chapter 1/Sessions/Session 04/Session 04 - The Abbey - Plan.md';
    const hub = fs.readFileSync(path.join(__dirname, 'fixtures', 'run-sheet-hub-plan.md'), 'utf8');
    write(dir, rel, `---\ntype: session-plan\nsession: "[[Session 04 - The Abbey]]"\nchapter: "[[Chapter 1]]"\n---\n\n${hub}`);
    const m = readRunSheet(dir, rel, { party: PARTY });
    assert.strictEqual(m.beats.length, 2);
    assert.strictEqual(m.session.number, 4);
    assert.deepStrictEqual(missingLines(hub, m), []);
    assert.deepStrictEqual(m.warnings.filter((w) => w.kind === 'not-on-page'), []);
  });

  it('completeness reports a link a field dropped', () => {
    const dir = copy();
    const m = readRunSheet(dir, PLAN, { party: PARTY });
    const body = bodyOf(fs.readFileSync(path.join(dir, PLAN), 'utf8'));
    assert.deepStrictEqual(completeness(body, m).filter((w) => w.kind === 'not-on-page'), []);
    const edited = JSON.parse(JSON.stringify(m));
    for (const b of edited.beats) b.who = b.who.filter((w) => w.name !== 'Sister Fen');
    const rows = completeness(body, edited).filter((w) => w.kind === 'not-on-page');
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].note, PLAN);
    assert.match(rows[0].text, /Planned Scenes/);
    assert.match(rows[0].text, /\[\[Sister Fen\]\]/);
  });

  it('the links map resolves aliases', () => {
    const dir = copy();
    const p = path.join(dir, PLAN);
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('The players like the wolves.', 'The players like the wolves and [[Lucan]].'));
    const m = readRunSheet(dir, PLAN, { party: PARTY });
    assert.strictEqual(m.links.Lucan, 'Characters/NPCs/Lucan Grey.md');
    assert.strictEqual(m.links['Brother Ash'], 'Characters/NPCs/Brother Ash.md');
    assert.strictEqual(m.links['Nobody Here'], null);
  });

  it('run long uses the chapter link, and stops at the vault root', () => {
    // a Plan outside its chapter folder still finds the chapter by its link
    const dir = copy();
    const moved = 'Elsewhere/Session 02 - The Test - Plan.md';
    write(dir, moved, fs.readFileSync(path.join(dir, PLAN), 'utf8'));
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

  it('plan with only a title reads to an empty model', () => {
    const dir = copy();
    write(dir, 'Lonely - Plan.md', '# Lonely\n');
    const m = readRunSheet(dir, 'Lonely - Plan.md');
    assert.deepStrictEqual(m.session, { index: null, title: 'Lonely', chapter: null, number: null });
    assert.deepStrictEqual(m.brief, { overview: '', world: '', stops: '' });
    for (const f of ['handouts', 'pcs', 'unmatchedPcLines', 'beats', 'people', 'places', 'maps']) assert.deepStrictEqual(m[f], [], f);
    assert.strictEqual(m.threads, '');
    assert.deepStrictEqual(m.runLong, { nextPlan: null, scenes: [], planning: [], contingencies: [] });
    // the title line is the lead text: kept, not dropped
    assert.deepStrictEqual(m.prep, [{ title: '', md: '# Lonely' }]);
    assert.deepStrictEqual(m.links, {});
    // the Plan's own note, and the notes the warnings name (the fixture's broken note)
    assert.deepStrictEqual(Object.keys(m.notes).sort(), ['Characters/NPCs/Broken.md', 'Lonely - Plan.md']);
    assert.ok(m.warnings.some((w) => w.note === 'Characters/NPCs/Broken.md'));
    assert.ok(m.warnings.some((w) => w.kind === 'no-party'));
  });

  it('a Plan that cannot be read is the one error', () => {
    const dir = copy();
    assert.throws(() => readRunSheet(dir, 'No Such - Plan.md'), /No Such - Plan\.md/);
  });

  it('odd settings and frontmatter read with warnings, never a throw', () => {
    const dir = copy();
    writeSettings(dir, ': : not yaml [');
    const p = path.join(dir, PLAN);
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('canon_status: DRAFT', 'canon_status: [DRAFT'));
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
});
