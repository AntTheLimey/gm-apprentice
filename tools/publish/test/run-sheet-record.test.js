'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { readRunSheet } = require('../lib/run-sheet/read');
const { readTableLog } = require('../lib/run-sheet/table-log');
const RS = require('../lib/run-sheet/web/state');
const R = require('../lib/run-sheet/record');

const FIXTURE = path.join(__dirname, 'fixtures', 'run-sheet-app');
const PLAN = 'Chapters/Chapter 1/Sessions/Session 02/Session 02 - The Test - Plan.md';
const ADA = 'Characters/PCs/Ada Moss.md';
const BEN = 'Characters/PCs/Ben Hart.md';
const model = readRunSheet(FIXTURE, PLAN, { party: [ADA, BEN] });
const GATE = model.beats[0];
const TOWER = model.beats[1];
const HUB = model.beats[2];
const CONT = model.beats.find((b) => b.contingency);
const T0 = '2026-11-20T19:00:00.000Z';
const at = (n) => new Date(Date.parse(T0) + n * 60000).toISOString();
// time injected: minutes after 21:00
const timeOf = (iso) => { const m = Math.round((Date.parse(iso) - Date.parse(T0)) / 60000); return `${String(21 + Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

const NOTES = new Map([['Ada Moss', ADA], ['Ben Hart', BEN], ['The Gate', 'Locations/The Gate.md'], ['Guard', 'Characters/NPCs/Guard.md']]);
const index = { resolve: (t) => NOTES.get(t) || null };
const linkFor = R.linkFor(index);
const OPTS = { linkFor, timeOf };

let n = 0;
const fresh = () => RS.emptyState({ stateId: 'chapter-1--session-02', session: model.session.index, plan: PLAN });
const run = (actions, start) => actions.reduce((s, a, i) => RS.reduce(s, { id: `r-${++n}`, ...a }, at(i)), start || fresh());
const to = (b, spot) => ({ beat: b.key, spot: spot || null, title: b.title });
const body = (s, m = model) => R.tableLogBody(m, s, OPTS);
const sectionsOf = (text) => readTableLog(text).sections;

// the exact text table-log-new files, as vault_write.record_text builds it
const PY = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'skills', 'shared', 'scripts', 'vault_write.py'), 'utf8');
const pySections = () => {
  const tuple = /TABLE_LOG_SECTIONS: tuple\[str, \.\.\.\] = \(([\s\S]*?)\n\)/.exec(PY)[1];
  return [...tuple.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
};
const HEAD = '\n| Who | HP | Conditions |\n| --- | --- | --- |\n';
const FM = ['---', 'type: session-table-log', 'session: "[[Session 02 - The Test]]"', 'session_number: 2', 'chapter: "[[Chapter 1]]"',
  'campaign: ""', 'canon_status: AUTHORITATIVE', 'created_by: run-sheet', 'publish: false', 'tags: []', '---', '', '# Session 02 - The Test - Table Log', ''].join('\n');
const skeleton = () => FM + R.TABLE_LOG_SECTIONS.map((s) => `\n## ${s}\n${s === 'Vitals at the end' ? HEAD : ''}`).join('');

describe('the Table Log writer', () => {
  it("the sections are vault_write's", () => {
    assert.deepStrictEqual(R.TABLE_LOG_SECTIONS, pySections());
    // 17 since plan 6a Task 5 (review P-S2) added Sides set
    assert.strictEqual(R.TABLE_LOG_SECTIONS.length, 17);
    assert.match(PY, /TABLE_LOG_VITALS_HEAD = "\\n\| Who \| HP \| Conditions \|\\n\| --- \| --- \| --- \|\\n"/);
  });

  it('a renamed beat shows its title, and vitals for someone gone are kept, in Changed since play started (proof defect 2, PR review L2)', () => {
    const s = run([
      { type: 'bring', beat: 'b-gone', note: 'Characters/NPCs/Guard.md', name: 'Guard', title: 'The Old Hoard' },
      { type: 'endSet', vitals: { 'Characters/NPCs/Garrick Fell.md': { hp: 4, conditions: 'Exhaustion 1' }, 'Characters/NPCs/Guard.md#2': { hp: 3 } } },
    ]);
    s.end.vitals['Characters/NPCs/Guard.md#2'].max = 11;
    const lines = sectionsOf(body(s)).get('Changed since play started').trim().split('\n');
    assert.deepStrictEqual(lines, [
      '- Beat "The Old Hoard": brought; no longer in the Plan',
      '- Vitals for [[Characters/NPCs/Garrick Fell]]: HP 4, Exhaustion 1; no longer in the Plan',
      '- Vitals for [[Guard]] 2: HP 3/11; no longer in the Plan',
    ]);
    assert.ok(!lines.some((l) => l.includes('b-gone')), 'never the key');
  });

  it('an untouched session writes 16 bare headings', () => {
    const b = body(fresh());
    assert.deepStrictEqual([...b.matchAll(/^## (.+)$/gm)].map((m) => m[1]), R.TABLE_LOG_SECTIONS);
    assert.doesNotMatch(b, /^-|^\|/m);
    assert.ok(R.isEmptySkeleton(b));
  });

  it('a GM-set vitals value writes only that row', () => {
    const s = run([{ type: 'endSet', vitals: { [ADA]: { hp: 9 } } }]);
    const t = sectionsOf(body(s));
    const v = readTableLog(body(s)).vitals;
    assert.deepStrictEqual(v.map((x) => [x.who, x.hpNow, x.hpMax]), [['Ada Moss', 9, 30]]);
    assert.ok(t.get('Vitals at the end').includes('| [[Ada Moss]] | 9/30 |'));
  });

  it('a row set for conditions only goes out with a blank HP cell', () => {
    const s = run([{ type: 'endSet', vitals: { [BEN]: { conditions: 'Poisoned' } } }]);
    const b = body(s);
    assert.ok(b.includes('| [[Ben Hart]] |  | Poisoned |'));
    const r = readTableLog(b);
    assert.deepStrictEqual(r.vitals, [{ who: 'Ben Hart', copy: null, hpNow: null, hpMax: null, conditions: 'Poisoned' }]);
    assert.deepStrictEqual(r.unread, []);
  });

  it('the skeleton table-log-new files is empty', () => {
    const text = skeleton();
    assert.ok(R.isEmptySkeleton(R.recordBodyOf(text)));
    assert.strictEqual(R.needsBackup(text, null), false);
    assert.strictEqual(R.needsBackup(text, 'abc'), false);
    // the same shape, built from record_text's loop, has the header-only table
    assert.match(PY, /text \+= "".join\(f"\\n## \{name\}\\n" \+ \(TABLE_LOG_VITALS_HEAD if name == "Vitals at the end" else ""\)/);
    const bullet = text.replace('## Log\n', '## Log\n\n- 21:00 hi\n');
    assert.strictEqual(R.isEmptySkeleton(R.recordBodyOf(bullet)), false);
    assert.strictEqual(R.needsBackup(bullet, null), true);
    const row = text.replace('| --- | --- | --- |\n', '| --- | --- | --- |\n| [[Ada Moss]] | 9 | |\n');
    assert.strictEqual(R.isEmptySkeleton(R.recordBodyOf(row)), false);
    const words = text.replace('## Advancement\n', '## Advancement\n\nSome words.\n');
    assert.strictEqual(R.isEmptySkeleton(R.recordBodyOf(words)), false);
  });

  it('not reached is one bullet per beat, the title', () => {
    const s = run([{ type: 'move', pc: ADA, to: to(GATE) }]);
    const nr = sectionsOf(body(s)).get('Not reached').trim().split('\n');
    assert.deepStrictEqual(nr, RS.derive(model, s).notReached.map((x) => `- ${x.title}`));
  });

  it('advancement: each typed line a bullet; a typed ## stays text', () => {
    const s = run([{ type: 'endSet', advancement: 'Ada gets a level\n\n## Not a section\n  Ben: new spell  ' }]);
    const b = body(s);
    assert.deepStrictEqual([...b.matchAll(/^## (.+)$/gm)].map((m) => m[1]), R.TABLE_LOG_SECTIONS);
    assert.strictEqual(sectionsOf(b).get('Advancement').trim(), '- Ada gets a level\n- ## Not a section\n- Ben: new spell');
  });

  it("every section's shape", () => {
    const point = GATE.points[0];
    const point2 = GATE.points[1];
    const point3 = GATE.points[2];
    const [clap, coins] = GATE.treasure;
    const h = model.handouts[0];
    const s = run([
      { type: 'move', pc: ADA, to: to(GATE) },
      { type: 'move', pc: BEN, to: { beat: HUB.key, spot: HUB.spots[2].key, title: HUB.title } },
      { type: 'mark', point: point.key, mark: 'landed', beat: GATE.key, beatTitle: GATE.title, text: point.text },
      { type: 'mark', point: point2.key, mark: 'missed', beat: GATE.key, beatTitle: GATE.title, text: point2.text },
      { type: 'mark', point: point3.key, mark: 'overtaken', beat: GATE.key, beatTitle: GATE.title, text: point3.text },
      { type: 'mark', point: 'gone.pt.1', mark: 'landed', beat: 'gone', beatTitle: 'The Old Beat', text: 'a lost point' },
      { type: 'stop', beat: HUB.key, title: HUB.title },
      { type: 'fire', beat: CONT.key, on: true, title: CONT.title },
      { type: 'improvise', title: 'The cellar chase' },
      { type: 'unmask', note: 'Characters/NPCs/Brother Ash.md', on: true, name: 'Ashur', was: 'Brother Ash', beat: GATE.key, title: GATE.title },
      { type: 'handOver', handout: h.key, on: true, text: h.text, note: h.note },
      { type: 'loot', item: clap.key, to: ADA, text: clap.text, note: null, beat: GATE.key, beatTitle: GATE.title },
      { type: 'loot', item: coins.key, to: 'party', text: coins.text, note: null, beat: GATE.key, beatTitle: GATE.title },
      { type: 'jot', beat: GATE.key, title: GATE.title, text: 'Ash lied about the key' },
      { type: 'endSet', vitals: { [ADA]: { hp: 9, conditions: 'Winded' } }, where: { [BEN]: 'in the chapel' }, advancement: 'Ada levels' },
    ]);
    const t = sectionsOf(body(s));
    const lines = (name) => t.get(name).trim().split('\n');
    assert.deepStrictEqual(lines('Where everyone ended'), ['- [[Ada Moss]]: [[The Gate]]', '- [[Ben Hart]]: in the chapel']);
    assert.deepStrictEqual(lines('Stopped in'), [`- ${HUB.title}`]);
    assert.deepStrictEqual(lines('Points landed'), [`- ${GATE.title}: ${point.text}`]);
    assert.deepStrictEqual(lines('Tried and missed'), [`- ${GATE.title}: ${point2.text}`]);
    assert.deepStrictEqual(lines('Overtaken'), [`- ${GATE.title}: ${point3.text}`]);
    assert.ok(lines('Not reached').includes(`- ${TOWER.title}`));
    assert.deepStrictEqual(lines('Changed since play started'), ['- Point "a lost point" (The Old Beat): landed; no longer in the Plan']);
    assert.deepStrictEqual(lines('Contingencies that fired'), [`- ${CONT.title}`]);
    assert.deepStrictEqual(lines('Improvised beats'), ['- The cellar chase']);
    assert.deepStrictEqual(lines('Unmasked this session'), ['- [[Characters/NPCs/Brother Ash]] as Ashur']);
    assert.deepStrictEqual(lines('Handouts handed over'), ["- [[Chapters/Chapter 1/Props/Ash's Note]]"]);
    assert.deepStrictEqual(lines('Loot'), [`- ${clap.text} to [[Ada Moss]]`, `- ${coins.text} to the party`]);
    assert.ok(lines('Log').some((l) => /^- 2\d:\d\d The Gate: Ash lied about the key$/.test(l)));
    assert.deepStrictEqual(lines('Vitals at the end').slice(2), ['| [[Ada Moss]] | 9/30 | Winded |']);
    assert.deepStrictEqual(lines('Advancement'), ['- Ada levels']);
  });

  it('a reached beat with a point not taken lists it under reached but not landed', () => {
    const s = run([{ type: 'move', pc: ADA, to: to(GATE) }, { type: 'mark', point: GATE.points[0].key, mark: 'landed', beat: GATE.key, beatTitle: GATE.title, text: GATE.points[0].text }]);
    assert.deepStrictEqual(sectionsOf(body(s)).get('Reached but not landed').trim().split('\n'), GATE.points.slice(1).map((p) => `- ${GATE.title}: ${p.text}`));
  });

  it('a spot with no note names the hub place and the spot words; a beat with no place gives its title', () => {
    const s = run([
      { type: 'move', pc: ADA, to: { beat: HUB.key, spot: HUB.spots[2].key, title: HUB.title } },
      { type: 'move', pc: BEN, to: { beat: HUB.key, spot: HUB.spots[0].key, title: HUB.title } },
    ]);
    const w = sectionsOf(body(s)).get('Where everyone ended').trim().split('\n');
    assert.ok(w[0].startsWith('- [[Ada Moss]]: ') && w[0].includes(HUB.spots[2].name));
    assert.ok(w[1].startsWith('- [[Ben Hart]]: '));
    const s2 = run([{ type: 'move', pc: ADA, to: 'off' }, { type: 'move', pc: BEN, to: to(model.beats.find((b) => b.title.startsWith('On the Road'))) }]);
    assert.deepStrictEqual(sectionsOf(body(s2)).get('Where everyone ended').trim().split('\n'), ['- [[Ada Moss]]: off-screen', '- [[Ben Hart]]: On the Road (routing)']);
  });

  it('a PC left unplaced is written as not placed once others are placed', () => {
    const s = run([{ type: 'move', pc: ADA, to: to(GATE) }]);
    assert.deepStrictEqual(sectionsOf(body(s)).get('Where everyone ended').trim().split('\n'), ['- [[Ada Moss]]: [[The Gate]]', '- [[Ben Hart]]: not placed']);
  });

  it('log lines in time order with the beat', () => {
    const s = run([
      { type: 'jot', beat: null, text: 'Table talk' },
      { type: 'jot', beat: GATE.key, title: GATE.title, text: 'Ash lied about the key' },
      { type: 'stop', beat: GATE.key, title: GATE.title },
    ]);
    assert.deepStrictEqual(sectionsOf(body(s)).get('Log').trim().split('\n'), [
      '- 21:00 Table talk', '- 21:01 The Gate: Ash lied about the key', '- 21:02 The Gate: Stopped here.']);
  });

  it('the log wording of each event', () => {
    const s = run([
      { type: 'fire', beat: CONT.key, on: true, title: CONT.title },
      { type: 'improvise', title: 'The cellar chase' },
      { type: 'bring', beat: GATE.key, note: 'Characters/NPCs/Lucan Grey.md', name: 'Lucan Grey', title: GATE.title },
      { type: 'unmask', note: 'Characters/NPCs/Brother Ash.md', on: true, name: 'Ashur', was: 'Brother Ash', beat: GATE.key, title: GATE.title },
      { type: 'unmask', note: 'Characters/NPCs/Brother Ash.md', on: false, name: 'Ashur', was: 'Brother Ash', beat: GATE.key, title: GATE.title },
      { type: 'handOver', handout: 'h', on: true, text: 'Ash\'s note.', note: null },
    ]);
    assert.deepStrictEqual(sectionsOf(body(s)).get('Log').trim().split('\n').map((l) => l.slice(8)), [
      `${CONT.title}: Contingency fired.`,
      'The cellar chase: Improvised beat.',
      'The Gate: Lucan Grey brought in.',
      'The Gate: Brother Ash unmasked as Ashur.',
      'The Gate: Brother Ash masked again.',
      "Handed over: Ash's note.",
    ]);
  });

  it('round trip: all 16 sections, vitals as the state holds them', () => {
    const m = JSON.parse(JSON.stringify(model));
    const foe = (name, key) => ({ key, note: 'Characters/NPCs/Guard.md', name, ally: true, ac: 12, hp: 11, hpNow: null });
    m.beats[0].foes = [foe('Guard 1', 'k.foe.g'), foe('Guard 2', 'k.foe.g~2')];
    const s = run([{ type: 'endSet', vitals: { [ADA]: { hp: 9, conditions: 'Winded' }, 'Characters/NPCs/Guard.md': { hp: 4 }, 'Characters/NPCs/Guard.md#2': { hp: 7 } } }]);
    const b = R.tableLogBody(m, s, OPTS);
    const r = readTableLog(b);
    // 17 since plan 6a Task 5 (review P-S2) added Sides set
    assert.deepStrictEqual([...r.sections.keys()].length, 17);
    assert.deepStrictEqual(r.vitals.map((v) => [v.who, v.hpNow, v.hpMax, v.conditions]), [
      ['Ada Moss', 9, 30, 'Winded'], ['Guard', 4, 11, ''], ['Guard', 7, 11, '']]);
    assert.deepStrictEqual(r.vitals.map((v) => v.copy), [null, null, 2]);
    assert.deepStrictEqual(r.unread, []);
    assert.strictEqual(r.unnamed, 0);
    assert.ok(b.includes('| [[Guard]] 2 | 7/11 |  |'));
  });

  it('a blank HP cell gives hpNow null and is not unread', () => {
    const r = readTableLog('## Vitals at the end\n\n| Who | HP | Conditions |\n| --- | --- | --- |\n| [[Guard]] 2 |  | Poisoned |\n');
    assert.deepStrictEqual(r.vitals, [{ who: 'Guard', copy: 2, hpNow: null, hpMax: null, conditions: 'Poisoned' }]);
    assert.deepStrictEqual(r.unread, []);
  });

  it('a pipe in conditions becomes a slash', () => {
    const s = run([{ type: 'endSet', vitals: { [ADA]: { hp: 5, conditions: 'blind | deaf\nprone' } } }]);
    assert.ok(body(s).includes('| [[Ada Moss]] | 5/30 | blind / deaf prone |'));
  });

  it('a pipe or a line break typed in an HP or max box keeps the row whole (third review L2)', () => {
    const s = run([{ type: 'endSet', vitals: { [ADA]: { hp: '5|3', max: '30\n', conditions: 'Winded' }, [BEN]: { hp: '7\n|x' } } }]);
    const b = body(s);
    const rows = b.split('\n').filter((l) => l.startsWith('| [['));
    assert.deepStrictEqual(rows, ['| [[Ada Moss]] | 5/3/30 | Winded |', '| [[Ben Hart]] | 7 /x/20 |  |']);
    const r = readTableLog(b);
    assert.deepStrictEqual(r.vitals.map((v) => [v.who, v.conditions]), [['Ada Moss', 'Winded'], ['Ben Hart', '']]);
    // 17 since plan 6a Task 5 (review P-S2) added Sides set
    assert.strictEqual([...r.sections.keys()].length, 17);
  });

  it('an ambiguous stem is linked by path', () => {
    const amb = R.linkFor({ resolve: () => null });
    assert.strictEqual(amb('Characters/PCs/Ada Moss.md'), '[[Characters/PCs/Ada Moss]]');
    assert.strictEqual(linkFor(ADA), '[[Ada Moss]]');
  });

  it('rewrite keeps frontmatter, the H1, text above the first section and the GM sections', () => {
    const file = skeleton().replace('# Session 02 - The Test - Table Log\n', '# Session 02 - The Test - Table Log\n\nMy own intro.\n') + '\n## My notes\n\nKeep me.\n\n## More\n\nAnd me.\n';
    const s = run([{ type: 'jot', beat: null, text: 'hello' }]);
    const out = R.rewriteTableLog(file, body(s));
    assert.ok(out.startsWith(FM.trimEnd()));
    assert.ok(out.includes('My own intro.'));
    assert.ok(out.includes('- 21:00 hello'));
    assert.ok(out.indexOf('## My notes') > out.indexOf('## Advancement'));
    assert.ok(out.indexOf('## More') > out.indexOf('## My notes'));
    assert.ok(out.includes('Keep me.') && out.includes('And me.'));
    assert.strictEqual(R.rewriteTableLog(out, body(s)), out);
    assert.strictEqual(R.recordBodyOf(out), R.recordBodyOf(R.rewriteTableLog(file, body(s))));
    assert.strictEqual(R.recordBodyOf(out), body(s).replace(/\r\n?/g, '\n').trim());
  });

  it("rewrite keeps a GM section's fenced headings and its first line's indent", () => {
    const own = '\n## My notes\n\n    an indented code line\n\n```\n## Log\nan example, not a section\n```\n\nAfter the fence.\n';
    const s = run([{ type: 'jot', beat: null, text: 'hello' }]);
    const out = R.rewriteTableLog(skeleton() + own, body(s));
    assert.ok(out.includes('## My notes\n\n    an indented code line\n'), out);
    assert.ok(out.includes('```\n## Log\nan example, not a section\n```\n\nAfter the fence.'), out);
    assert.strictEqual((out.match(/^## Log$/gm) || []).length, 2, 'the real Log section and the fenced example');
    assert.strictEqual(R.rewriteTableLog(out, body(s)), out);
    // an indent changed by hand on a section's first line is a change: it is kept aside first
    const file = R.rewriteTableLog(skeleton(), body(s));
    assert.strictEqual(R.needsBackup(file.replace('- 21:00 hello', '  - 21:00 hello'), R.bodyHash(body(s))), true);
  });

  it('rewrite keeps CRLF', () => {
    const file = skeleton().replace(/\n/g, '\r\n');
    const out = R.rewriteTableLog(file, body(run([{ type: 'jot', beat: null, text: 'hello' }])));
    assert.ok(/\r\n/.test(out));
    assert.ok(!/[^\r]\n/.test(out));
    assert.ok(out.includes('- 21:00 hello'));
  });

  it('rewrite refuses another type', () => {
    assert.throws(() => R.rewriteTableLog(skeleton().replace('session-table-log', 'session-wrap'), body(fresh())), (e) => e.code === 'NOT_A_TABLE_LOG');
    assert.throws(() => R.rewriteTableLog('# no frontmatter\n', body(fresh())), (e) => e.code === 'NOT_A_TABLE_LOG');
  });

  it('needsBackup: the hash, the skeleton, hand text and an older state', () => {
    const b1 = body(run([{ type: 'jot', beat: null, text: 'one' }]));
    const b2 = body(run([{ type: 'jot', beat: null, text: 'one' }, { type: 'jot', beat: null, text: 'two' }]));
    const file = R.rewriteTableLog(skeleton(), b1);
    const h1 = R.bodyHash(R.recordBodyOf(file));
    assert.strictEqual(h1, R.bodyHash(b1));
    assert.strictEqual(R.needsBackup(file, h1), false);
    assert.strictEqual(R.needsBackup(skeleton(), h1), false);
    assert.strictEqual(R.needsBackup(file.replace('- 21:00 one', '- 21:00 one, edited by hand'), h1), true);
    // a log an older state wrote: its hash is not this state's
    assert.strictEqual(R.needsBackup(R.rewriteTableLog(skeleton(), b2), h1), true);
    assert.strictEqual(R.needsBackup(file, null), true);
    assert.strictEqual(R.needsBackup(file.replace(/\n/g, '\r\n'), h1), false);
  });

  it('a copy number round-trips', () => {
    const r = readTableLog('## Vitals at the end\n\n| Who | HP | Conditions |\n| --- | --- | --- |\n| [[Guard]] | 9/11 | |\n| [[Guard]] 2 | 5/11 | |\n| [[Ada Moss]] | 3 | |\n');
    assert.deepStrictEqual(r.vitals.map((v) => [v.who, v.copy, v.hpNow]), [['Guard', null, 9], ['Guard', 2, 5], ['Ada Moss', null, 3]]);
  });
});

// A writer-made Table Log read back by the reader, in a copy of the run-sheet fixture.
describe('the reader carries what the writer wrote', () => {
  const os = require('node:os');
  const { writeSettings } = require('./helpers/vault-files');
  const { after } = require('node:test');
  const made = [];
  after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
  const P = 'Chapters/Chapter 1/Sessions/Session 02/Session 02 - The Test - Plan.md';
  const CH1 = 'Chapters/Chapter 1';
  const LUCAN = 'Characters/NPCs/Lucan Grey.md';
  const S1_LOG = `${CH1}/Sessions/Session 01/Session 01 - The Road - Table Log.md`;
  const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
  const sessionIndex = (dir, rel, number, log, status) => write(dir, rel, [
    '---', 'type: session', `session_number: ${number}`, `chapter: "[[Chapter 1]]"`, `status: ${status}`,
    'documents:', `  table_log: ${log ? `"[[${log}]]"` : 'null'}`, '---', '', '# s', ''].join('\n'));
  const logFile = (rows) => ['---', 'type: session-table-log', 'session: "[[Session 01 - The Road]]"', 'publish: false', '---', '', '# t', '',
    '## Vitals at the end', '', '| Who | HP | Conditions |', '| --- | --- | --- |', ...rows, ''].join('\n');
  const vault = (log) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-rec-'));
    made.push(dir);
    fs.cpSync(path.join(__dirname, 'fixtures', 'run-sheet'), dir, { recursive: true });
    writeSettings(dir, { 'vault.system': 'dnd5e' });
    sessionIndex(dir, `${CH1}/Sessions/Session 01/Session 01 - The Road.md`, 1, 'Session 01 - The Road - Table Log', 'played');
    write(dir, S1_LOG, log);
    return dir;
  };
  const party = [ADA, BEN];
  const lucans = (m) => m.beats.flatMap((b) => b.foes).filter((f) => f.ally);

  it('a writer-made log with blank ally rows: the walk goes on to the older figure', () => {
    const dir = vault(logFile(['| [[Lucan Grey]] | 9/27 | winded |']));
    const m0 = readRunSheet(dir, P, { party });
    const state = RS.reduce(RS.emptyState({ stateId: 's2', plan: P }),
      { id: 'a1', type: 'endSet', vitals: { [LUCAN]: { conditions: 'winded' } } }, T0);
    const b = R.tableLogBody(m0, state, { linkFor: (p) => `[[${path.posix.basename(p, '.md')}]]`, timeOf });
    assert.match(b, /\| \[\[Lucan Grey\]\] \|  \| winded \|/);
    write(dir, `${CH1}/Sessions/Session 02/Session 02 - The Test.md`, ['---', 'type: session', 'session_number: 2', 'chapter: "[[Chapter 1]]"', 'status: played',
      'documents:', '  table_log: "[[Session 02 - The Test - Table Log]]"', '---', '', '# s2', ''].join('\n'));
    write(dir, `${CH1}/Sessions/Session 02/Session 02 - The Test - Table Log.md`,
      R.rewriteTableLog(['---', 'type: session-table-log', 'session: "[[Session 02 - The Test]]"', 'publish: false', '---', '', '# Session 02 - Table Log', ''].join('\n'), b));
    sessionIndex(dir, `${CH1}/Sessions/Session 03/Session 03 - Next.md`, 3, null, 'planned');
    const p3 = `${CH1}/Sessions/Session 03/Session 03 - Next - Plan.md`;
    write(dir, p3, ['---', 'type: session-plan', 'session: "[[Session 03 - Next]]"', 'chapter: "[[Chapter 1]]"', '---', '',
      '## Planned Scenes', '', '### Scene 1: Again', '**Situation:** Lucan again.', '**NPCs**', '- **[[Lucan Grey]]:** helps', ''].join('\n'));
    const rows = lucans(readRunSheet(dir, p3, { party }));
    assert.ok(rows.length >= 1);
    for (const f of rows) assert.deepStrictEqual([f.hpNow, f.carriedFrom], [9, S1_LOG]);
  });

  it("copy 2 carries copy 2's figure next session, and falls back to the copy-less row", () => {
    const two = (dir) => {
      const p = path.join(dir, P);
      fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('- **[[Lucan Grey]] (Lucan):** helps', '- **[[Lucan Grey]] (2):** helps'));
      return dir;
    };
    const numbered = (m) => lucans(m).filter((f) => /^Lucan Grey \d$/.test(f.name)).map((f) => [f.name, f.hpNow]);
    const m = readRunSheet(two(vault(logFile(['| [[Lucan Grey]] | 9/27 | |', '| [[Lucan Grey]] 2 | 5/27 | |']))), P, { party });
    assert.deepStrictEqual(numbered(m), [['Lucan Grey 1', 9], ['Lucan Grey 2', 5]]);
    const m2 = readRunSheet(two(vault(logFile(['| [[Lucan Grey]] | 9/27 | |']))), P, { party });
    assert.deepStrictEqual(numbered(m2), [['Lucan Grey 1', 9], ['Lucan Grey 2', 9]]);
  });

  it("an unreadable copy-1 cell stops only copy 1; a blank copy-2 row walks on to copy 2's older figure", () => {
    const dir = vault(logFile(['| [[Lucan Grey]] | 9/27 | |', '| [[Lucan Grey]] 2 | 5/27 | |']));
    write(dir, `${CH1}/Sessions/Session 02/Session 02 - The Test.md`, ['---', 'type: session', 'session_number: 2', 'chapter: "[[Chapter 1]]"', 'status: played',
      'documents:', '  table_log: "[[Session 02 - The Test - Table Log]]"', '---', '', '# s2', ''].join('\n'));
    write(dir, `${CH1}/Sessions/Session 02/Session 02 - The Test - Table Log.md`, logFile(['| [[Lucan Grey]] | fine | |', '| [[Lucan Grey]] 2 |  | |'])
      .replace('Session 01 - The Road]]', 'Session 02 - The Test]]'));
    sessionIndex(dir, `${CH1}/Sessions/Session 03/Session 03 - Next.md`, 3, null, 'planned');
    const p3 = `${CH1}/Sessions/Session 03/Session 03 - Next - Plan.md`;
    write(dir, p3, ['---', 'type: session-plan', 'session: "[[Session 03 - Next]]"', 'chapter: "[[Chapter 1]]"', '---', '',
      '## Planned Scenes', '', '### Scene 1: Again', '**Situation:** Lucan again.', '**NPCs**', '- **[[Lucan Grey]] (2):** helps', ''].join('\n'));
    const rows = lucans(readRunSheet(dir, p3, { party })).filter((f) => /^Lucan Grey \d$/.test(f.name)).map((f) => [f.name, f.hpNow, f.carriedFrom]);
    assert.deepStrictEqual(rows, [['Lucan Grey 1', null, null], ['Lucan Grey 2', 5, S1_LOG]]);
  });
});

describe('the Table Log writer: fights (plan 5b decision 17)', () => {
  const M = require('../lib/run-sheet/web/fight-math');
  const LUCAN = 'Characters/NPCs/Lucan Grey.md';
  const WOLF = 'Creatures/Frost Wolf.md';
  // each action a minute after the last, from 21:00 (timeOf)
  const play = (steps) => {
    let s = RS.emptyState({ stateId: 'f', session: model.session.index, plan: PLAN });
    let i = 0;
    for (const step of steps) {
      i += 1;
      const a = typeof step === 'function' ? step(s) : step;
      s = RS.reduce(s, { id: `f-${i}`, ...(s.fight && a.type !== 'fightStart' && !a.fight ? { fight: s.fight.id } : {}), ...a }, at(i));
    }
    return s;
  };
  const start = (s) => {
    const b = M.rowsForFight({ model, derived: RS.derive(model, s), state: s, beatKey: GATE.key, idBase: `f-${s.applied.length + 1}` });
    return { type: 'fightStart', beat: GATE.key, title: GATE.title, groups: b.groups, rows: b.rows, thresholds: b.thresholds };
  };
  const rowId = (s, note) => s.fight.rows.find((r) => r.note === note).id;
  const hp = (note, entry) => (s) => ({ type: 'hp', row: rowId(s, note), entry });
  const vitalsLines = (s) => sectionsOf(body(s)).get('Vitals at the end').split('\n').filter((l) => l.startsWith('| [['));

  it('fight lines are in the Log in time order', () => {
    const s = play([
      { type: 'move', pc: ADA, to: to(GATE) },
      { type: 'jot', beat: GATE.key, spot: null, text: 'they knock', title: GATE.title },
      start,
      hp(WOLF, '-20'),
      { type: 'jot', beat: null, spot: null, text: 'after the wolf' },
      (s) => ({ type: 'fightEnd' }),
    ]);
    const log = sectionsOf(body(s)).get('Log').split('\n');
    assert.deepStrictEqual(log.slice(0, 4), [
      '- 21:02 The Gate: they knock',
      '- 21:03 The Gate: Fight starts at The Gate.',
      '- 21:04 The Gate: Frost Wolf 1 drops.',
      '- 21:05 after the wolf',
    ]);
    assert.strictEqual(log.length, 5);
    assert.strictEqual(log[4], '- 21:06 The Gate: Fight ends before the first turn: Ada Moss 22/30, Brother Ash 9/9, Frost Wolf 1 0/15 (Out), Frost Wolf 2 15/15, Frost Wolf 3 15/15, Lucan Grey 16/16.');
  });

  it('an add that was taken back leaves no trace in any section (plan 6a F7)', () => {
    const addBouncers = (s) => {
      const id = 'j-1';
      const j = M.joinRows({ model, derived: RS.derive(model, s), state: s, fight: s.fight, add: { name: 'Bouncer', count: 13 }, idBase: id });
      return { type: 'fightJoin', id, rows: j.rows, tick: j.tick, groups: j.groups, thresholds: j.thresholds, label: 'Bouncer ×13' };
    };
    const s = play([
      { type: 'move', pc: ADA, to: to(GATE) },
      start,
      addBouncers,
      { type: 'undoAdd', join: 'j-1' },
      { type: 'fightEnd' },
    ]);
    assert.ok(s.events.some((e) => /Took back: Bouncer ×13\./.test(e.text)), 'the page keeps its line');
    assert.ok(s.fight === null && s.fights.at(-1).rows.every((r) => !/Bouncer/.test(r.name)));
    assert.doesNotMatch(body(s), /Bouncer|Took back/, 'the Table Log names no Bouncer');
    assert.ok(RS.derive(model, s).log.some((l) => l.tookBack), 'derive marks the line, so the record can leave it out');
  });

  it('vitals from a fight are written as hp/max (after the fight, HH:MM); kept statuses in Conditions, cleared ones not', () => {
    let fid;
    const s = play([
      { type: 'move', pc: ADA, to: to(GATE) },
      start,
      (x) => { fid = x.fight.id; return hp(ADA, '-10')(x); },
      (x) => ({ type: 'status', row: rowId(x, ADA), add: 'Prone' }),
      (x) => ({ type: 'status', row: rowId(x, ADA), add: 'Poisoned' }),
      (x) => ({ type: 'concentrating', row: rowId(x, ADA), on: true }),
      (x) => ({ type: 'exhaustion', row: rowId(x, ADA), level: 1 }),
      hp(LUCAN, '-4'),
      { type: 'fightEnd' },
      (x) => ({ type: 'afterClear', fight: fid, row: x.fights[0].rows.find((r) => r.note === ADA).id, status: 'Poisoned' }),
      (x) => ({ type: 'afterClear', fight: fid, row: x.fights[0].rows.find((r) => r.note === ADA).id, status: 'Concentrating' }),
    ]);
    const lines = vitalsLines(s);
    // the HP's own time, when the hit landed: clearing a status after the fight does not move it (Review H1)
    assert.ok(lines.includes('| [[Ada Moss]] | 12/30 (after the fight, 21:03) | Prone, Exhaustion 1 |'), lines.join('\n'));
    assert.ok(lines.some((l) => /^\| \[\[Characters\/NPCs\/Lucan Grey\]\] \| 12\/16 \(after the fight, 21:08\) \|  \|$/.test(l)), lines.join('\n'));
    assert.ok(!lines.some((l) => l.includes('Ben Hart')), 'an unchanged PC is not written');
    assert.ok(!lines.some((l) => l.includes('Wolf')), 'no foe');
  });

  it('an end-panel figure is written bare, and the bracketed figure reads back', () => {
    const s = play([
      { type: 'move', pc: ADA, to: to(GATE) },
      start,
      hp(ADA, '-10'),
      { type: 'fightEnd' },
      { type: 'endSet', vitals: { [BEN]: { hp: 7 } } },
    ]);
    const lines = vitalsLines(s);
    assert.ok(lines.includes('| [[Ada Moss]] | 12/30 (after the fight, 21:03) |  |'), lines.join('\n'));
    assert.ok(lines.includes('| [[Ben Hart]] | 7/20 |  |'));
    const r = readTableLog(body(s));
    assert.deepStrictEqual(r.unread, []);
    assert.deepStrictEqual(r.vitals.map((v) => [v.who, v.hpNow, v.hpMax]), [['Ada Moss', 12, 30], ['Ben Hart', 7, 20]]);
    // a later end-panel edit takes it back to bare
    const s2 = RS.reduce(s, { id: 'late', type: 'endSet', vitals: { [ADA]: { hp: 14 } } }, at(9));
    assert.ok(vitalsLines(s2).includes('| [[Ada Moss]] | 14/30 |  |'));
  });

  it('round trip through readTableLog', () => {
    const s = play([
      { type: 'move', pc: ADA, to: to(GATE) },
      start,
      hp(ADA, '-10'),
      (x) => ({ type: 'status', row: rowId(x, ADA), add: 'Prone' }),
      hp(LUCAN, '-3'),
    ]);
    const text = R.rewriteTableLog(skeleton(), body(s));
    const r = readTableLog(text);
    assert.deepStrictEqual(r.vitals.map((v) => [v.who, v.copy, v.hpNow, v.hpMax, v.conditions]), [
      ['Ada Moss', null, 12, 30, 'Prone'],
      ['Characters/NPCs/Lucan Grey', null, 13, 16, ''],
    ]);
    assert.ok(r.sections.get('Log').includes('Fight starts at The Gate.'));
    assert.strictEqual(R.recordBodyOf(text), R.recordBodyOf(R.rewriteTableLog(text, body(s))), 'stable');
  });
});

// plan 6a Task 5 (review P-S2): a side the GM set lasts past the session, through the Table Log
describe('the sides the GM set', () => {
  const M = require('../lib/run-sheet/web/fight-math');
  const os = require('node:os');
  const { writeSettings } = require('./helpers/vault-files');
  const { after } = require('node:test');
  const made = [];
  after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
  const ASH = 'Characters/NPCs/Brother Ash.md';
  const LUCAN = 'Characters/NPCs/Lucan Grey.md';
  const CH1 = 'Chapters/Chapter 1';
  const fought = (sides) => {
    let s = RS.reduce(fresh(), { id: 'sd-1', type: 'move', pc: ADA, to: to(GATE) }, at(1));
    const b = M.rowsForFight({ model, derived: RS.derive(model, s), state: s, beatKey: GATE.key, idBase: 'sd-2' });
    s = RS.reduce(s, { id: 'sd-2', type: 'fightStart', beat: GATE.key, title: GATE.title, groups: b.groups, rows: b.rows, thresholds: b.thresholds }, at(2));
    sides.forEach(([note, side], i) => {
      const r = s.fight.rows.find((x) => x.note === note);
      s = RS.reduce(s, { id: `sd-${3 + i}`, type: 'setSide', fight: s.fight.id, row: r.id, side }, at(3 + i));
    });
    return s;
  };

  it('the Table Log writes one line per note the GM set, under Sides set', () => {
    assert.ok(R.TABLE_LOG_SECTIONS.includes(R.SIDES_SET));
    const s = fought([[ASH, 'ally'], [LUCAN, 'neutral'], [ASH, 'foe']]);
    const lines = sectionsOf(body(s)).get(R.SIDES_SET).trim().split('\n');
    assert.deepStrictEqual(lines, ['- [[Characters/NPCs/Brother Ash]]: foe', '- [[Characters/NPCs/Lucan Grey]]: neutral']);
    assert.strictEqual(sectionsOf(body(fresh())).get(R.SIDES_SET), '', 'nothing set: a bare heading');
  });

  it('a side set is carried to the next session through the Table Log', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-sides-'));
    made.push(dir);
    fs.cpSync(FIXTURE, dir, { recursive: true });
    writeSettings(dir, { 'vault.system': 'dnd5e' });
    const write = (rel, text) => fs.writeFileSync(path.join(dir, rel), text);
    const S2 = `${CH1}/Sessions/Session 02/Session 02 - The Test.md`;
    const S2_LOG = `${CH1}/Sessions/Session 02/Session 02 - The Test - Table Log.md`;
    const P3 = `${CH1}/Sessions/Session 03/Session 03 - Next - Plan.md`;
    write(S2, fs.readFileSync(path.join(dir, S2), 'utf8').replace('status: planned', 'status: played'));
    const realLink = (p) => `[[${path.posix.basename(p, '.md')}]]`;
    const s = fought([[ASH, 'ally'], [LUCAN, 'neutral']]);
    write(S2_LOG, R.rewriteTableLog(fs.readFileSync(path.join(dir, S2_LOG), 'utf8'), R.tableLogBody(model, s, { linkFor: realLink, timeOf })));
    let m = readRunSheet(dir, P3, { party: [ADA, BEN] });
    assert.deepStrictEqual(m.sidesCarried, { [ASH]: 'ally', [LUCAN]: 'neutral' });
    // a later session's line wins; a line naming no side or no note warns and is passed over
    const log = path.join(dir, S2_LOG);
    const text = fs.readFileSync(log, 'utf8');
    fs.writeFileSync(log, text.replace(/## Sides set\n\n[\s\S]*?\n\n/, '## Sides set\n\n- [[Brother Ash]]: ally\n- [[Brother Ash]]: foe\n- [[Lucan Grey]]: friendly\n- [[Nobody At All]]: ally\n\n'));
    m = readRunSheet(dir, P3, { party: [ADA, BEN] });
    assert.deepStrictEqual(m.sidesCarried, { [ASH]: 'foe' }, 'the last line for a note wins');
    const warned = m.warnings.filter((w) => w.kind === 'table-log' && /Sides set/.test(w.text)).map((w) => w.text);
    assert.strictEqual(warned.length, 2, warned.join('\n'));
    assert.ok(warned.some((w) => w.includes('friendly')));
    assert.ok(warned.some((w) => w.includes('Nobody At All')));
  });

  it('a later Table Log wins over an earlier one; a session not played is not read', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-sides-'));
    made.push(dir);
    fs.cpSync(FIXTURE, dir, { recursive: true });
    writeSettings(dir, { 'vault.system': 'dnd5e' });
    const S1 = `${CH1}/Sessions/Session 01/Session 01 - The Start.md`;
    const S1_LOG = `${CH1}/Sessions/Session 01/Session 01 - The Start - Table Log.md`;
    const S2 = `${CH1}/Sessions/Session 02/Session 02 - The Test.md`;
    const S2_LOG = `${CH1}/Sessions/Session 02/Session 02 - The Test - Table Log.md`;
    const P3 = `${CH1}/Sessions/Session 03/Session 03 - Next - Plan.md`;
    const logOf = (session, lines) => ['---', 'type: session-table-log', `session: "[[${session}]]"`, 'publish: false', '---', '', '# t', '',
      `## ${R.SIDES_SET}`, '', ...lines, ''].join('\n');
    const s1 = fs.readFileSync(path.join(dir, S1), 'utf8');
    if (!/status: played/.test(s1)) fs.writeFileSync(path.join(dir, S1), s1.replace(/^type: session$/m, 'type: session\nstatus: played'));
    fs.writeFileSync(path.join(dir, S1_LOG), logOf('Session 01 - The Start', ['- [[Brother Ash]]: ally', '- [[Lucan Grey]]: foe']));
    fs.writeFileSync(path.join(dir, S2_LOG), logOf('Session 02 - The Test', ['- [[Brother Ash]]: neutral']));
    // Session 02 is planned, not played: its log is not read
    let m = readRunSheet(dir, P3, { party: [ADA, BEN] });
    assert.deepStrictEqual(m.sidesCarried, { [ASH]: 'ally', [LUCAN]: 'foe' });
    fs.writeFileSync(path.join(dir, S2), fs.readFileSync(path.join(dir, S2), 'utf8').replace('status: planned', 'status: played'));
    m = readRunSheet(dir, P3, { party: [ADA, BEN] });
    assert.deepStrictEqual(m.sidesCarried, { [ASH]: 'neutral', [LUCAN]: 'foe' });
  });
});

// plan 6a Task 7: Move them to a known or a new place
describe('places in the record', () => {
  const YARD = 'Locations/The Chapel Yard.md';
  const NOTES2 = new Map([...NOTES, ['The Chapel Yard', YARD]]);
  const opts = { linkFor: R.linkFor({ resolve: (t) => NOTES2.get(t) || null }), timeOf };

  it('the record writes a new place', () => {
    const key = model.placeKeys[YARD];
    const s = run([{ type: 'move', pc: ADA, to: to(GATE) }, { type: 'move', pc: BEN, to: to(GATE) },
      { id: 'np1', type: 'moveGroup', pcs: [ADA], name: 'The Docks', names: ['Ada'] },
      { type: 'moveGroup', pcs: [BEN], place: YARD, key, title: 'The Chapel Yard', names: ['Ben'] }]);
    const sec = sectionsOf(R.tableLogBody(model, s, opts));
    assert.strictEqual(sec.get('Where everyone ended'), '- [[Ada Moss]]: The Docks\n- [[Ben Hart]]: [[The Chapel Yard]]');
    // the known place is linked where a PC stood, never under Improvised beats (reveal_scan reads links there as seen)
    assert.strictEqual(sec.get('Improvised beats'), '- New place: The Docks\n- The Chapel Yard');
    assert.match(sec.get('Log'), /Ada moves to The Docks \(a new place\)\./);
    assert.match(sec.get('Log'), /Ben moves to The Chapel Yard\./);
  });

  it('Fight here moves nobody: Where everyone ended names the PCs\' beat', () => {
    const key = model.placeKeys[YARD];
    let s = run([{ type: 'move', pc: ADA, to: to(GATE) }, { type: 'improvise', key, title: 'The Chapel Yard', place: YARD }]);
    s = run([{ id: 'fx', type: 'fightStart', beat: key, title: 'The Chapel Yard', groups: [GATE.key], rows: [], thresholds: [], backdrop: { group: GATE.key, place: YARD } }, { type: 'fightEnd', fight: 'fx' }], s);
    const sec = sectionsOf(R.tableLogBody(model, s, opts));
    assert.match(sec.get('Where everyone ended'), /^- \[\[Ada Moss\]\]: \[\[The Gate\]\]$/m);
    assert.strictEqual(sec.get('Improvised beats'), '- The Chapel Yard', 'nobody stood there: no link');
  });
});
