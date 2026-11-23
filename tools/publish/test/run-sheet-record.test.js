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
    // 18 since the Task 13 proof added Places the party went (Ant's ruling: a place the players go to is published); 17 since Task 5 added Sides set
    assert.strictEqual(R.TABLE_LOG_SECTIONS.length, 18);
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
    // the same shape, built from record_text's loop, has the header-only table (since step 6b Task 20 the header is
    // the vault's system's, `table_log_vitals_head(system)`: D&D's is still TABLE_LOG_VITALS_HEAD, pinned above)
    assert.match(PY, /head = table_log_vitals_head\(system\)\n\s+text \+= "".join\(f"\\n## \{name\}\\n" \+ \(head if name == "Vitals at the end" else ""\)/);
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
    // 18 since the Task 13 proof added Places the party went (Ant's ruling: a place the players go to is published); 17 since Task 5 added Sides set
    assert.deepStrictEqual([...r.sections.keys()].length, 18);
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
    // 18 since the Task 13 proof added Places the party went (Ant's ruling: a place the players go to is published); 17 since Task 5 added Sides set
    assert.strictEqual([...r.sections.keys()].length, 18);
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
    const text = fs.readFileSync(log, 'utf8').replace(/\r\n/g, '\n'); // Windows checks the fixture out CRLF
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
    // review I2: a known place a PC was moved to is linked under Improvised beats too
    assert.strictEqual(sec.get('Improvised beats'), '- New place: The Docks\n- [[The Chapel Yard]]');
    assert.match(sec.get('Log'), /Ada moves to The Docks \(a new place\)\./);
    assert.match(sec.get('Log'), /Ben moves to The Chapel Yard\./);
  });

  it('Fight here moves nobody: Where everyone ended names the PCs\' beat', () => {
    const key = model.placeKeys[YARD];
    let s = run([{ type: 'move', pc: ADA, to: to(GATE) }, { type: 'improvise', key, title: 'The Chapel Yard', place: YARD }]);
    // changed on purpose by Ant's ruling (Task 7 fix round 1, review I2 widened): the players fought there, so the
    // place is linked under Improvised beats, for reveal_scan to offer it for publishing
    const idle = sectionsOf(R.tableLogBody(model, s, opts));
    assert.strictEqual(idle.get('Improvised beats'), '- The Chapel Yard', 'no fight yet, nobody went: plain words');
    s = run([{ id: 'fx', type: 'fightStart', beat: key, title: 'The Chapel Yard', groups: [GATE.key], rows: [], thresholds: [], backdrop: { group: GATE.key, place: YARD } }], s);
    assert.strictEqual(sectionsOf(R.tableLogBody(model, s, opts)).get('Improvised beats'), '- [[The Chapel Yard]]', 'linked while the fight runs');
    s = run([{ type: 'fightEnd', fight: 'fx' }], s);
    const sec = sectionsOf(R.tableLogBody(model, s, opts));
    assert.match(sec.get('Where everyone ended'), /^- \[\[Ada Moss\]\]: \[\[The Gate\]\]$/m);
    assert.strictEqual(sec.get('Improvised beats'), '- [[The Chapel Yard]]', 'Fight here at a place: linked');
  });
});

// final review follow-up: a folder note's place is titled by its folder, in the Table Log too
describe('a folder note\'s place in the record', () => {
  const NORTH = 'Locations/North/index.md';
  const opts = { linkFor: R.linkFor({ resolve: (t) => NOTES.get(t) || null }), timeOf };

  it('Locations/North/index.md with no name is North: its title, its Log line and its link', () => {
    assert.strictEqual(model.placeNotes[NORTH].title, 'North');
    const key = model.placeKeys[NORTH];
    // as the page sends it: the title is the place's (gm.js nameOf reads it)
    const s = run([{ type: 'move', pc: ADA, to: to(GATE) },
      { type: 'moveGroup', pcs: [ADA], place: NORTH, key, title: model.placeNotes[NORTH].title, names: ['Ada'] }]);
    assert.strictEqual(RS.derive(model, s).beats.find((b) => b.key === key).title, 'North');
    const sec = sectionsOf(R.tableLogBody(model, s, opts));
    assert.match(sec.get('Log'), /Ada moves to North\./);
    assert.strictEqual(sec.get('Improvised beats'), '- [[Locations/North/index|North]]');
    assert.match(sec.get('Where everyone ended'), /^- \[\[Ada Moss\]\]: \[\[Locations\/North\/index\|North\]\]$/m);
  });
});

// Task 13 proof (Ant's ruling: a place the players go to becomes visible and published)
describe('Places the party went', () => {
  const os = require('node:os');
  const LIGHT = 'Locations/Gannet Head Light.md';
  const YARD = 'Locations/The Chapel Yard.md';
  const NORTH = 'Locations/North/index.md';

  it('Hollow Quay-shaped: the party at Gannet Head Light, then moved on: every place a PC stood at is linked, by first arrival', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-went-'));
    try {
      fs.cpSync(FIXTURE, dir, { recursive: true });
      fs.writeFileSync(path.join(dir, LIGHT), '---\nname: Gannet Head Light\ntype: location\npublish: false\n---\n\nThe lighthouse on the head.\n');
      const m = readRunSheet(dir, PLAN, { party: [ADA, BEN] });
      const notes = new Map([...NOTES, ['Gannet Head Light', LIGHT], ['The Chapel Yard', YARD], ['The Bell Tower Room', 'Locations/The Bell Tower Room.md']]);
      const opts = { linkFor: R.linkFor({ resolve: (t) => notes.get(t) || null }), timeOf };
      const hub = m.beats[2];
      const yard = hub.spots.find((x) => x.note === YARD);
      const st = RS.emptyState({ stateId: 'x', session: m.session.index, plan: PLAN });
      const s = [
        { type: 'moveGroup', pcs: [ADA, BEN], place: LIGHT, key: m.placeKeys[LIGHT], title: 'Gannet Head Light', names: ['Ada', 'Ben'] },
        { type: 'move', pc: ADA, to: to(m.beats[0]) },
        { type: 'move', pc: BEN, to: to(hub, yard.key) },
        { type: 'moveGroup', pcs: [ADA], place: NORTH, key: m.placeKeys[NORTH], title: 'North', names: ['Ada'] },
        { type: 'moveGroup', pcs: [ADA, BEN], name: 'The Docks', names: ['Ada', 'Ben'] },
        { type: 'move', pc: BEN, to: to(m.beats[0]) },
      ].reduce((acc, a, i) => RS.reduce(acc, { id: `w-${i}`, ...a }, at(i)), st);
      const sec = sectionsOf(R.tableLogBody(m, s, opts));
      assert.strictEqual(sec.get(R.PLACES_WENT), '- [[Gannet Head Light]]\n- [[The Gate]]\n- [[The Chapel Yard]]\n- [[Locations/North/index|North]]',
        'the light (moved on from), the Plan\'s Gate, a hub spot, a folder note by its title; once each; never a typed place');
      assert.match(sec.get('Improvised beats'), /New place: The Docks/);
      assert.ok(!/Gannet Head Light/.test(sec.get('Where everyone ended')), 'nobody ended there');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  // scoped check: a hub spot whose note is a map (or a GM map half) is no place, so nothing links it for reveal_scan
  it('The Chapel Yard as a map, Ben moved to its spot: neither section links it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-went-map-'));
    try {
      fs.cpSync(FIXTURE, dir, { recursive: true });
      const f = path.join(dir, YARD);
      fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n').replace('type: location\n', 'type: location\ndoc_type: map\n'));
      const m = readRunSheet(dir, PLAN, { party: [ADA, BEN] });
      const hub = m.beats[2];
      const yard = hub.spots.find((x) => x.name === 'The Chapel Yard');
      assert.ok(yard, 'the spot keeps its words');
      assert.strictEqual(yard.note, null, 'and carries no note');
      const notes = new Map([...NOTES, ['The Chapel Yard', YARD]]);
      const opts = { linkFor: R.linkFor({ resolve: (t) => notes.get(t) || null }), timeOf };
      const st = RS.emptyState({ stateId: 'x', session: m.session.index, plan: PLAN });
      const s = [{ type: 'move', pc: ADA, to: to(m.beats[0]) }, { type: 'move', pc: BEN, to: to(hub, yard.key) }]
        .reduce((acc, a, i) => RS.reduce(acc, { id: `wm-${i}`, ...a }, at(i)), st);
      const sec = sectionsOf(R.tableLogBody(m, s, opts));
      for (const name of [R.PLACES_WENT, 'Where everyone ended']) {
        assert.ok(!/Chapel Yard\]\]|Chapel Yard\|/.test(sec.get(name) || ''), `${name}: ${sec.get(name)}`);
      }
      assert.match(sec.get('Where everyone ended'), /Ben Hart\]\]: .*The Chapel Yard/, 'its words stay');
      assert.strictEqual(sec.get(R.PLACES_WENT), '- [[The Gate]]');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  // the Undo rewrite of a roster line takes the empty form too. Undo needs a running fight and rows nobody touched,
  // so a real night cannot undo every row a roster line names; the line is set here to pin the shared rewrite.
  it('Undo of the only rows a roster line names leaves "Fight ends before the first turn."', () => {
    const FM2 = require('../lib/run-sheet/web/fight-math');
    let s = RS.reduce(fresh(), { id: 'u-1', type: 'move', pc: ADA, to: to(GATE) }, at(1));
    const b = FM2.rowsForFight({ model, derived: RS.derive(model, s), state: s, beatKey: GATE.key, idBase: 'uf' });
    s = RS.reduce(s, { id: 'uf', type: 'fightStart', beat: GATE.key, title: GATE.title, groups: b.groups, rows: b.rows, thresholds: b.thresholds }, at(2));
    for (const r of s.fight.rows) if (r.in && r.kind !== 'lair') s = RS.reduce(s, { id: `ut-${r.id}`, type: 'fightTick', fight: 'uf', row: r.id, in: false }, at(3));
    const j = FM2.joinRows({ model, derived: RS.derive(model, s), state: s, fight: s.fight, add: { name: 'Bouncer', count: 2 }, idBase: 'uj' });
    s = RS.reduce(s, { id: 'uj', type: 'fightJoin', fight: 'uf', rows: j.rows, tick: j.tick, groups: j.groups, thresholds: j.thresholds, label: 'Bouncer ×2' }, at(4));
    const added = s.fight.rows.filter((r) => /^Bouncer/.test(r.name)).map((r) => ({ id: r.id, text: r.name }));
    s = JSON.parse(JSON.stringify(s));
    s.events.push({ at: at(5), beat: GATE.key, fight: 'uf', text: 'Fight ends before the first turn: Bouncer 1, Bouncer 2.',
      roster: { head: 'Fight ends before the first turn: ', tail: '.', items: added } });
    s = RS.reduce(s, { id: 'uu', type: 'undoAdd', fight: 'uf', join: 'uj' }, at(6));
    assert.strictEqual(s.events.filter((e) => /^Fight ends/.test(e.text || '')).at(-1).text, 'Fight ends before the first turn.');
  });

  it('a session where nobody moved has an empty section', () => {
    assert.strictEqual(sectionsOf(R.tableLogBody(model, fresh(), OPTS)).get(R.PLACES_WENT) || '', '');
  });
});

// Task 7 fix round 1
describe('places in the record (fix round 1)', () => {
  const YARD = 'Locations/The Chapel Yard.md';
  const GATE_NOTE = 'Locations/The Gate.md';
  const NOTES2 = new Map([...NOTES, ['The Chapel Yard', YARD]]);
  const opts = { linkFor: R.linkFor({ resolve: (t) => NOTES2.get(t) || null }), timeOf };

  it('review I2: a known place moved to and then left is still linked under Improvised beats', () => {
    const key = model.placeKeys[YARD];
    const s = run([{ type: 'move', pc: ADA, to: to(GATE) },
      { type: 'moveGroup', pcs: [ADA], place: YARD, key, title: 'The Chapel Yard', names: ['Ada'] },
      { type: 'move', pc: ADA, to: to(TOWER) }]);
    const sec = sectionsOf(R.tableLogBody(model, s, opts));
    assert.strictEqual(sec.get('Improvised beats'), '- [[The Chapel Yard]]');
  });

  it('review I1: Move them to The Gate goes to the Plan\'s Gate beats, never a place beat of its own', () => {
    const target = (s) => RS.planTarget(model, s, GATE_NOTE);
    let s = fresh();
    const t1 = target(s);
    assert.deepStrictEqual([t1.beat, t1.spot], [GATE.key, null], 'the first Gate beat');
    s = run([{ type: 'moveGroup', pcs: [ADA, BEN], place: GATE_NOTE, title: 'The Gate', to: t1, names: ['Ada', 'Ben'] }], s);
    assert.deepStrictEqual([s.positions[ADA], s.positions[BEN]], [{ beat: GATE.key, spot: null }, { beat: GATE.key, spot: null }]);
    assert.ok(!s.improvised.some((i) => i.key.startsWith('pl-')), 'no pl- beat');
    assert.ok(RS.derive(model, s).log.some((l) => l.text === 'Ada, Ben move to The Gate (the Plan\'s beat: The Gate).'));
    // away, then The Gate again: the Gate beat not yet visited (Scene 4)
    s = run([{ type: 'move', pc: ADA, to: to(TOWER) }, { type: 'move', pc: BEN, to: to(TOWER) }], s);
    const t2 = target(s);
    const scene4 = model.beats.filter((b) => b.place === GATE_NOTE)[1];
    assert.strictEqual(t2.beat, scene4.key);
    s = run([{ type: 'moveGroup', pcs: [ADA, BEN], place: GATE_NOTE, title: 'The Gate', to: t2, names: ['Ada', 'Ben'] }], s);
    // both visited, so the first again
    assert.strictEqual(target(s).beat, GATE.key);
    const sec = sectionsOf(R.tableLogBody(model, s, opts));
    assert.ok(!/The Gate/.test(sec.get('Not reached')), `no Gate beat is Not reached: ${sec.get('Not reached')}`);
    assert.strictEqual(sec.get('Improvised beats'), '', 'none is Improvised');
  });

  it('review I1: a hub spot\'s place is that spot', () => {
    const t = RS.planTarget(model, fresh(), YARD);
    assert.deepStrictEqual([t.beat, t.spot], [HUB.key, HUB.spots.find((x) => x.note === YARD).key]);
    assert.strictEqual(t.label, `${HUB.title} · The Chapel Yard`);
    const s = run([{ type: 'moveGroup', pcs: [ADA], place: YARD, title: 'The Chapel Yard', to: t, names: ['Ada'] }]);
    assert.deepStrictEqual(s.positions[ADA], { beat: HUB.key, spot: t.spot });
    assert.strictEqual(RS.derive(model, s).whereEnded[0].status, 'spot');
    // a place the Plan has no beat for has no target: it gets its pl- beat
    assert.strictEqual(RS.planTarget(model, fresh(), 'Locations/North/index.md'), null);
  });
});

// Step 6b Task 20: the vitals table has the vault's system's columns (the ontology's `run_sheet.vitals`).
describe("each system's vitals columns (Task 20)", () => {
  const os = require('node:os');
  const { writeSettings } = require('./helpers/vault-files');
  const { after } = require('node:test');
  const made = [];
  after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
  const COC_FX = path.join(__dirname, 'fixtures', 'run-sheet-coc');
  const GURPS_FX = path.join(__dirname, 'fixtures', 'run-sheet-gurps');
  const COC_PLAN = 'Chapters/Chapter 1/Sessions/Session 01/Session 01 - Fog Bound - Plan.md';
  const GURPS_PLAN = 'Chapters/Chapter 1/Sessions/Session 01/Session 01 - Crates - Plan.md';
  const IRIS = 'Characters/PCs/Iris Calder.md';
  const ORRIN = 'Characters/PCs/Orrin Tate.md';
  const EDDA = 'Characters/NPCs/Edda Voss.md';
  const RAFE = 'Characters/NPCs/Rafe Kell.md';
  const stemLink = (p) => `[[${path.posix.basename(p, '.md')}]]`;
  const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
  const lf = (s) => s.replace(/\r\n/g, '\n');
  // a copy of a fixture vault, with an ally made of one of its who lines (the Plan's own words)
  const copy = (fx, plan, who, words) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-t20-'));
    made.push(dir);
    fs.cpSync(fx, dir, { recursive: true });
    if (who) {
      const p = path.join(dir, plan);
      const text = lf(fs.readFileSync(p, 'utf8'));
      assert.ok(text.includes(who), who);
      fs.writeFileSync(p, text.replace(who, `${who} ${words}`));
    }
    return dir;
  };
  const vitalsOf = (b) => readTableLog(b).sections.get('Vitals at the end');
  const s0 = (plan) => RS.emptyState({ stateId: 's', plan });

  it('record writes CoC rows HP 9/11 | MP 10/12 | SAN 48 | Luck 50', () => {
    const m0 = readRunSheet(COC_FX, COC_PLAN, {});
    const m = { ...m0, pcs: m0.pcs.map((p) => (p.note === IRIS ? { ...p, mpMax: 12, mpNow: 12 } : p)) };
    const s = RS.reduce(s0(COC_PLAN), { id: 'a', type: 'endSet', vitals: { [IRIS]: { hp: 9, mp: 10, san: 48, luck: 50, conditions: 'Major wound' } } }, T0);
    assert.strictEqual(vitalsOf(R.tableLogBody(m, s, { linkFor: stemLink, timeOf })), [
      '| Who | HP | MP | SAN | Luck | Conditions |',
      '| --- | --- | --- | --- | --- | --- |',
      '| [[Iris Calder]] | 9/11 | 10/12 | 48 | 50 | Major wound |',
    ].join('\n'));
  });

  it('a Regency vault writes the CoC columns, never a Reputation one', () => {
    const dir = copy(COC_FX, COC_PLAN);
    writeSettings(dir, { 'vault.system': 'coc-7e-regency' });
    const m = readRunSheet(dir, COC_PLAN, {});
    const s = RS.reduce(s0(COC_PLAN), { id: 'a', type: 'endSet', vitals: { [IRIS]: { san: 40 } } }, T0);
    assert.match(vitalsOf(R.tableLogBody(m, s, { linkFor: stemLink, timeOf })), /^\| Who \| HP \| MP \| SAN \| Luck \| Conditions \|\n.*\n\| \[\[Iris Calder\]\] \|  \|  \| 40 \|  \|  \|$/);
  });

  it('GURPS rows with HP -3/12 and FP 6/12, written with an ASCII minus', () => {
    const m0 = readRunSheet(GURPS_FX, GURPS_PLAN, {});
    const m = { ...m0, pcs: m0.pcs.map((p) => (p.note === ORRIN ? { ...p, fpMax: 12, fpNow: 12 } : p)) };
    // the page sends a number; a typed minus sign that reached the state as text is written as a hyphen-minus too
    for (const hp of [-3, '−3']) {
      const s = RS.reduce(s0(GURPS_PLAN), { id: 'a', type: 'endSet', vitals: { [ORRIN]: { hp, fp: 6 } } }, T0);
      const v = vitalsOf(R.tableLogBody(m, s, { linkFor: stemLink, timeOf }));
      assert.strictEqual(v, ['| Who | HP | FP | Conditions |', '| --- | --- | --- | --- |', '| [[Orrin Tate]] | -3/12 | 6/12 |  |'].join('\n'));
      assert.doesNotMatch(v, /−/);
      // and -3/12 reads back as -3
      assert.deepStrictEqual(readTableLog(`## Vitals at the end\n\n${v}\n`).vitals.map((x) => [x.hpNow, x.hpMax, x.fpNow, x.fpMax]), [[-3, 12, 6, 12]]);
    }
  });

  it('D&D keeps its three columns', () => {
    const s = run([{ type: 'endSet', vitals: { [ADA]: { hp: 9 } } }]);
    assert.match(sectionsOf(body(s)).get('Vitals at the end'), /^\| Who \| HP \| Conditions \|\n\| --- \| --- \| --- \|\n/);
  });

  it("the skeleton for a CoC or GURPS vault is empty, and the writer's header is vault_write's", () => {
    const { execFileSync } = require('node:child_process');
    const py = execFileSync('python3', ['-c', [
      'import sys; sys.path.insert(0, "skills/shared/scripts"); import vault_write as vw',
      'for s in ("coc-7e", "coc-7e-regency", "gurps-4e", "dnd-5e-2024", None): print(repr(vw.table_log_vitals_head(s)))',
    ].join('\n')], { cwd: path.join(__dirname, '..', '..', '..'), encoding: 'utf8' }).trim().split('\n');
    const { systemFor } = require('../lib/run-sheet/systems');
    ['coc-7e', 'coc-7e-regency', 'gurps-4e', 'dnd-5e-2024', null].forEach((sys, i) => {
      const m = { ...model, rules: systemFor(sys).describe() };
      const s = RS.reduce(fresh(), { id: 'a', type: 'endSet', vitals: { [ADA]: { conditions: 'x' } } }, T0);
      const head = vitalsOf(R.tableLogBody(m, s, OPTS)).split('\n').slice(0, 2).join('\n');
      assert.strictEqual(`'\\n${head.replace(/\n/g, '\\n')}\\n'`, py[i], String(sys));
      const sk = FM + R.TABLE_LOG_SECTIONS.map((x) => `\n## ${x}\n${x === 'Vitals at the end' ? `\n${head}\n` : ''}`).join('');
      assert.ok(R.isEmptySkeleton(R.recordBodyOf(sk)), String(sys));
    });
  });

  it('Luck is never written for an ally', () => {
    const dir = copy(COC_FX, COC_PLAN, '**[[Edda Voss]]:** keeps the stove hot', 'with the party');
    const m = readRunSheet(dir, COC_PLAN, {});
    assert.ok(m.beats.some((b) => (b.foes || []).some((f) => f.note === EDDA && f.ally)), 'Edda is an ally');
    const s = RS.reduce(s0(COC_PLAN), { id: 'a', type: 'endSet', vitals: { [EDDA]: { hp: 7, mp: 4, luck: 40 }, [IRIS]: { luck: 30 } } }, T0);
    const v = vitalsOf(R.tableLogBody(m, s, { linkFor: stemLink, timeOf }));
    assert.match(v, /\| \[\[Edda Voss\]\] \| 7\/10 \| 4\/10 \|  \|  \|  \|/);
    assert.match(v, /\| \[\[Iris Calder\]\] \|  \|  \|  \| 30 \|  \|/);
  });

  describe('an ally carries MP, SAN and FP into the next session', () => {
    // a played session 0 before the fixture's session 1, its Table Log `logBody`; session 1's Plan is the fixture's own
    const playedBefore = (dir, ch, logBody, number) => {
      const s1 = `${ch}/Sessions/Session 00/Session 00 - Before.md`;
      write(dir, s1, ['---', 'type: session', `session_number: ${number}`, 'chapter: "[[Chapter 1]]"', 'status: played',
        'documents:', '  table_log: "[[Session 00 - Before - Table Log]]"', '---', '', '# s0', ''].join('\n'));
      write(dir, `${ch}/Sessions/Session 00/Session 00 - Before - Table Log.md`,
        R.rewriteTableLog(['---', 'type: session-table-log', 'session: "[[Session 00 - Before]]"', 'publish: false', '---', '', '# t', ''].join('\n'), logBody));
      return `${ch}/Sessions/Session 00/Session 00 - Before - Table Log.md`;
    };

    it('CoC: MP and SAN, with HP; the old HP-only log still reads', () => {
      const dir = copy(COC_FX, COC_PLAN, '**[[Edda Voss]]:** keeps the stove hot', 'with the party');
      const m0 = readRunSheet(dir, COC_PLAN, {});
      const s = RS.reduce(s0(COC_PLAN), { id: 'a', type: 'endSet', vitals: { [EDDA]: { hp: 7, mp: 4, san: 44 } } }, T0);
      const log = playedBefore(dir, 'Chapters/Chapter 1', R.tableLogBody(m0, s, { linkFor: stemLink, timeOf }), 0);
      const edda = readRunSheet(dir, COC_PLAN, {}).beats.flatMap((b) => b.foes).find((f) => f.note === EDDA);
      assert.deepStrictEqual([edda.hpNow, edda.mpNow, edda.sanNow, edda.carriedFrom], [7, 4, 44, log]);
      // the night's vitals start from them, and so does a fight
      const m1 = readRunSheet(dir, COC_PLAN, {});
      const d1 = RS.derive(m1, s0(COC_PLAN));
      const row = d1.vitals.find((v) => v.rowId === EDDA);
      assert.deepStrictEqual([row.hp, row.mp, row.mpMax, row.san], [7, 4, 10, 44]);
      // her fight row starts from them: through the night's vitals, and from the reader's carried figures alone
      const FM = require('../lib/run-sheet/web/fight-math');
      const beat = m1.beats.find((b) => b.foes.some((f) => f.note === EDDA && f.ally));
      const fightRow = (derived) => FM.rowsForFight({ model: m1, derived, state: s0(COC_PLAN), beatKey: beat.key, idBase: 'f' }).rows.find((r) => r.note === EDDA);
      const withVitals = fightRow(d1);
      assert.deepStrictEqual([withVitals.kind, withVitals.hp, withVitals.mp, withVitals.mpMax, withVitals.san], ['ally', 7, 4, 10, 44]);
      const noVitals = fightRow({ ...d1, vitals: d1.vitals.filter((v) => v.rowId !== EDDA) });
      assert.deepStrictEqual([noVitals.hp, noVitals.mp, noVitals.mpMax, noVitals.san], [7, 4, 10, 44]);

      // an old log with only HP: HP carries, the pools start from the note
      const dir2 = copy(COC_FX, COC_PLAN, '**[[Edda Voss]]:** keeps the stove hot', 'with the party');
      playedBefore(dir2, 'Chapters/Chapter 1', '## Vitals at the end\n\n| Who | HP | Conditions |\n| --- | --- | --- |\n| [[Edda Voss]] | 6/10 | |\n', 0);
      const m2 = readRunSheet(dir2, COC_PLAN, {});
      const e2 = m2.beats.flatMap((b) => b.foes).find((f) => f.note === EDDA);
      assert.deepStrictEqual([e2.hpNow, e2.mpNow, e2.sanNow], [6, undefined, undefined]);
      const r2 = RS.derive(m2, s0(COC_PLAN)).vitals.find((v) => v.rowId === EDDA);
      assert.deepStrictEqual([r2.hp, r2.mp, r2.san], [6, 10, 50]);
      assert.deepStrictEqual(m2.warnings.filter((w) => w.kind === 'table-log'), []);
    });

    it('GURPS: FP below 0 too', () => {
      const dir = copy(GURPS_FX, GURPS_PLAN);
      const p = path.join(dir, GURPS_PLAN);
      const text = lf(fs.readFileSync(p, 'utf8'));
      const line = text.split('\n').find((l) => l.includes('[[Rafe Kell]]') && /^\s*-/.test(l));
      assert.ok(line, 'a who line for Rafe');
      fs.writeFileSync(p, text.replace(line, `${line} (with the party)`));
      const m0 = readRunSheet(dir, GURPS_PLAN, {});
      assert.ok(m0.beats.some((b) => b.foes.some((f) => f.note === RAFE && f.ally)), 'Rafe is an ally');
      const s = RS.reduce(s0(GURPS_PLAN), { id: 'a', type: 'endSet', vitals: { [RAFE]: { hp: -2, fp: -1 } } }, T0);
      playedBefore(dir, 'Chapters/Chapter 1', R.tableLogBody(m0, s, { linkFor: stemLink, timeOf }), 0);
      // the beat whose who line says so has him as an ally; a foe never carries
      const rafe = readRunSheet(dir, GURPS_PLAN, {}).beats.flatMap((b) => b.foes).filter((f) => f.note === RAFE && f.ally);
      assert.ok(rafe.length);
      for (const f of rafe) assert.deepStrictEqual([f.hpNow, f.fpNow], [-2, -1]);
    });

    it("Energy Reserve is held through the night with no column: fight 2 starts at max-4, the log has no ER, next session starts from the block", () => {
      const BRAM = 'Characters/NPCs/Bram Holt.md';
      const FM = require('../lib/run-sheet/web/fight-math');
      const dir = copy(GURPS_FX, GURPS_PLAN, '**[[Bram Holt]]:** carries the lamp', 'with the party');
      const m = readRunSheet(dir, GURPS_PLAN, {});
      const beat = m.beats.find((b) => b.foes.some((f) => f.note === BRAM && f.ally));
      assert.ok(beat, 'Bram is an ally');
      const bramOf = (state, id) => FM.rowsForFight({ model: m, derived: RS.derive(m, state), state, beatKey: beat.key, idBase: id }).rows.find((r) => r.note === BRAM);
      let s = s0(GURPS_PLAN);
      const first = bramOf(s, 'f1');
      assert.deepStrictEqual([first.er, first.erMax], [4, 4]);
      const built = FM.rowsForFight({ model: m, derived: RS.derive(m, s), state: s, beatKey: beat.key, idBase: 'f1' });
      s = RS.reduce(s, { id: 'f1', type: 'fightStart', beat: beat.key, title: 'T', rules: m.rules.fight, groups: built.groups, rows: built.rows, thresholds: [] }, at(1));
      const row = s.fight.rows.find((r) => r.note === BRAM);
      s = RS.reduce(s, { id: 'e1', type: 'hp', fight: 'f1', row: row.id, entry: 'e-4' }, at(2));
      assert.strictEqual(s.fight.rows.find((r) => r.note === BRAM).er, 0);
      s = RS.reduce(s, { id: 'e2', type: 'fightEnd', fight: 'f1' }, at(3));
      // fight 2 the same night starts at max - 4
      const second = bramOf(s, 'f2');
      assert.deepStrictEqual([second.er, second.erMax], [0, 4]);
      // the Table Log has no ER column, and no ER in any row
      const v = vitalsOf(R.tableLogBody(m, s, { linkFor: stemLink, timeOf }));
      assert.match(v, /^\| Who \| HP \| FP \| Conditions \|/);
      assert.doesNotMatch(v, /\bER\b|Energy/);
      assert.strictEqual(RS.derive(m, s).vitalsRecorded.find((x) => x.rowId === BRAM).er, undefined);
      // the next session starts from the block
      playedBefore(dir, 'Chapters/Chapter 1', R.tableLogBody(m, s, { linkFor: stemLink, timeOf }), 0);
      const next = readRunSheet(dir, GURPS_PLAN, {});
      const bram = next.beats.flatMap((b) => b.foes).find((f) => f.note === BRAM && f.ally);
      assert.strictEqual(bram.erNow, undefined);
      const fresh2 = FM.rowsForFight({ model: next, derived: RS.derive(next, s0(GURPS_PLAN)), state: s0(GURPS_PLAN), beatKey: beat.key, idBase: 'f9' }).rows.find((r) => r.note === BRAM);
      assert.strictEqual(fresh2.er, 4);
    });

    it('a pool cell that holds no number warns, naming its column, and stops that pool only', () => {
      const dir = copy(COC_FX, COC_PLAN, '**[[Edda Voss]]:** keeps the stove hot', 'with the party');
      playedBefore(dir, 'Chapters/Chapter 1', '## Vitals at the end\n\n| Who | HP | MP | SAN | Luck | Conditions |\n| --- | --- | --- | --- | --- | --- |\n| [[Edda Voss]] | 6/10 | lots | 41 |  | |\n', 0);
      const m = readRunSheet(dir, COC_PLAN, {});
      const e = m.beats.flatMap((b) => b.foes).find((f) => f.note === EDDA);
      assert.deepStrictEqual([e.hpNow, e.mpNow, e.sanNow], [6, undefined, 41]);
      assert.ok(m.warnings.some((w) => w.kind === 'table-log' && /the MP cell "lots" for \[\[Edda Voss\]\]/.test(w.text)), JSON.stringify(m.warnings));
    });
  });
});
