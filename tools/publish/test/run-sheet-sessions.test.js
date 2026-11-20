'use strict';
const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { listSessions, pickSession, stateIdOf, tableLogOf, isPlayed } = require('../lib/run-sheet/sessions');
const { buildIndex } = require('../lib/run-sheet/notes');

const FIXTURE = path.join(__dirname, 'fixtures', 'run-sheet-app');
const made = [];
const copy = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-sessions-'));
  made.push(d);
  fs.cpSync(FIXTURE, d, { recursive: true });
  return d;
};
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

const S = 'Chapters/Chapter 1/Sessions/';
const IDX = {
  c1s1: `${S}Session 01/Session 01 - The Start.md`,
  c1s2: `${S}Session 02/Session 02 - The Test.md`,
  c1s3: `${S}Session 03/Session 03 - Next.md`,
  c2s1: 'Chapters/Chapter 2/Sessions/Session 01/Session 01 - Snowmelt.md',
};
const LOG = `${S}Session 02/Session 02 - The Test - Table Log.md`;

describe('run sheet sessions', () => {
  const list = listSessions(FIXTURE);

  it('lists sessions in chapter then number order', () => {
    assert.deepStrictEqual(list.map((s) => s.index), [IDX.c1s1, IDX.c1s2, IDX.c1s3, IDX.c2s1]);
    assert.strictEqual(list[1].label, 'Session 2');
    assert.strictEqual(list[1].plan, `${S}Session 02/Session 02 - The Test - Plan.md`);
    assert.strictEqual(list[0].wrapUp, `${S}Session 01/Session 01 - The Start - Wrap-Up.md`);
    assert.strictEqual(list[1].tableLog, LOG);
    assert.strictEqual(list[1].open, true);
    assert.strictEqual(list[0].open, false);
    assert.strictEqual(list[3].chapter, 'Chapters/Chapter 2/Chapter 2.md');
  });

  it('the in-progress session comes first', () => {
    const r = pickSession(list);
    assert.strictEqual(r.session.index, IDX.c1s2);
    assert.deepStrictEqual(r.others, []);
  });

  it('with none in progress the earliest open session', () => {
    const dir = copy();
    fs.rmSync(path.join(dir, LOG));
    const r = pickSession(listSessions(dir));
    assert.strictEqual(r.session.index, IDX.c1s2);
  });

  it('several in progress: the earliest, the others named', () => {
    const dir = copy();
    fs.writeFileSync(path.join(dir, 'Chapters/Chapter 2/Sessions/Session 01/Snowmelt Log.md'),
      '---\ntype: session-table-log\nsession: "[[Session 01 - Snowmelt]]"\n---\n\n## Log\n');
    const r = pickSession(listSessions(dir));
    assert.strictEqual(r.session.index, IDX.c1s2);
    assert.deepStrictEqual(r.others.map((s) => s.index), [IDX.c2s1]);
  });

  it('a wrapped-up session is refused verbatim', () => {
    assert.deepStrictEqual(pickSession(list, 'Session 01 - The Start'),
      { error: 'Session 1 is wrapped up; its record is the Table Log note.' });
  });

  it('a name two sessions answer to is refused with both paths', () => {
    const r = pickSession(list, 'Session 01');
    assert.ok(r.error);
    assert.ok(r.error.includes(IDX.c1s1) && r.error.includes(IDX.c2s1), r.error);
  });

  it('--session takes an index stem, an index path and a Plan path', () => {
    assert.strictEqual(pickSession(list, 'Session 02 - The Test').session.index, IDX.c1s2);
    assert.strictEqual(pickSession(list, IDX.c1s3).session.index, IDX.c1s3);
    assert.strictEqual(pickSession(list, list[1].plan).session.index, IDX.c1s2);
  });

  it('no session open', () => {
    const closed = list.map((s) => ({ ...s, open: false, wrapUp: s.wrapUp || 'x.md' }));
    assert.deepStrictEqual(pickSession(closed),
      { error: 'No session is open for play: every session with a Plan has a Wrap-Up. Prep the next one first.' });
  });

  it('a session with no Plan', () => {
    const noPlan = list.map((s) => (s.index === IDX.c1s3 ? { ...s, plan: null, open: false } : s));
    assert.deepStrictEqual(pickSession(noPlan, IDX.c1s3), { error: 'Session 3 has no Plan yet: prep it first.' });
  });

  it('an unknown name is refused', () => {
    assert.ok(pickSession(list, 'Nonesuch').error);
  });

  it('state ids differ across chapters', () => {
    const index = buildIndex(FIXTURE);
    assert.strictEqual(stateIdOf(list[0], index), 'chapter-1--session-01-the-start');
    assert.strictEqual(stateIdOf(list[3], index), 'chapter-2--session-01-snowmelt');
  });

  it('records: the table log and played, from the index', () => {
    const index = buildIndex(FIXTURE);
    assert.deepStrictEqual(tableLogOf(index, IDX.c1s2), { log: LOG, warning: null });
    assert.strictEqual(tableLogOf(index, IDX.c1s3).log, null);
    assert.strictEqual(isPlayed(index, IDX.c1s1), true);
    assert.strictEqual(isPlayed(index, IDX.c1s3), false);
  });

  it('a table_log link that matches nothing warns', () => {
    const dir = copy();
    const f = path.join(dir, IDX.c1s3);
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('status: planned', 'status: planned\ndocuments:\n  table_log: "[[Nowhere]]"'));
    const r = tableLogOf(buildIndex(dir), IDX.c1s3);
    assert.strictEqual(r.log, null);
    assert.strictEqual(r.warning.kind, 'table-log');
  });
});
