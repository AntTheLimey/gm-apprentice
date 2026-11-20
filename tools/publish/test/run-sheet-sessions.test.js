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

  it('a session in progress beats an earlier open one', () => {
    const dir = copy();
    fs.rmSync(path.join(dir, LOG));
    fs.writeFileSync(path.join(dir, 'Chapters/Chapter 2/Sessions/Session 01/Snowmelt Log.md'),
      '---\ntype: session-table-log\nsession: "[[Session 01 - Snowmelt]]"\n---\n\n## Log\n');
    const r = pickSession(listSessions(dir));
    assert.strictEqual(r.session.index, IDX.c2s1);
    assert.deepStrictEqual(r.others, []);
  });

  it('two Wrap-Ups naming a session still wrap it up', () => {
    const dir = copy();
    const f = path.join(dir, IDX.c1s1);
    const text = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n'); // a Windows checkout has CRLF
    const next = text.replace(/documents:\n {2}wrap_up: .*\n/, '');
    assert.notStrictEqual(next, text, 'the wrap_up link was removed');
    fs.writeFileSync(f, next);
    fs.writeFileSync(path.join(dir, `${S}Session 01/Session 01 - The Start - Wrap-Up draft.md`),
      '---\ntype: session_wrap\nsession: "[[Session 01 - The Start]]"\nchapter: "[[Chapter 1]]"\n---\n\n## Recap\n\nA draft.\n');
    const l = listSessions(dir);
    assert.strictEqual(l[0].open, false);
    assert.ok(l[0].wrapUp);
    assert.strictEqual(pickSession(l).session.index, IDX.c1s2);
  });

  it('a played session with a Plan and no Wrap-Up stays open', () => {
    const dir = copy();
    const f = path.join(dir, IDX.c1s1);
    fs.rmSync(path.join(dir, `${S}Session 01/Session 01 - The Start - Wrap-Up.md`));
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/documents:\n {2}wrap_up: .*\n/, ''));
    fs.writeFileSync(path.join(dir, `${S}Session 01/Session 01 - The Start - Plan.md`), '---\ntype: session-plan\nsession: "[[Session 01 - The Start]]"\n---\n\n## Planned Scenes\n');
    const l = listSessions(dir);
    assert.strictEqual(l[0].played, true);
    assert.strictEqual(l[0].open, true);
  });

  it('--session takes a Windows path and an absolute path inside the vault', () => {
    assert.strictEqual(pickSession(list, IDX.c1s3.replace(/\//g, '\\'), FIXTURE).session.index, IDX.c1s3);
    assert.strictEqual(pickSession(list, path.join(FIXTURE, IDX.c1s3), FIXTURE).session.index, IDX.c1s3);
    assert.strictEqual(pickSession(list, path.join(FIXTURE, list[2].plan), FIXTURE).session.index, IDX.c1s3);
    assert.ok(pickSession(list, '/elsewhere/Session 03 - Next.md', FIXTURE).error);
  });

  it('two same-named sessions with no chapter note never share a state id', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-sessions-'));
    made.push(dir);
    for (const c of ['Alpha', 'Beta']) {
      const d = path.join(dir, 'Campaign', c, 'Session 01');
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'Session 01.md'), '---\ntype: session\nsession_number: 1\nstatus: planned\n---\n\n# Session 01\n');
    }
    const l = listSessions(dir);
    assert.strictEqual(l.length, 2);
    assert.notStrictEqual(stateIdOf(l[0]), stateIdOf(l[1]));
  });

  it('the chapter comes from the build rule, the chapter folder, when chapter: is missing', () => {
    const dir = copy();
    const f = path.join(dir, IDX.c2s1);
    const text = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
    const next = text.replace('chapter: "[[Chapter 2]]"\n', '');
    assert.notStrictEqual(next, text, 'the chapter link was removed');
    fs.writeFileSync(f, next);
    const l = listSessions(dir);
    assert.strictEqual(l.find((s) => s.index === IDX.c2s1).chapter, 'Chapters/Chapter 2/Chapter 2.md');
  });

  it('a wrapped-up session is refused verbatim', () => {
    assert.deepStrictEqual(pickSession(list, 'Session 01 - The Start'),
      { error: 'Session 1 is wrapped up; its record is the Wrap-Up.' });
    // the Table Log is named only when the session has one (2026-11-21, step 5a proof)
    const withLog = list.map((s) => (s.wrapUp ? { ...s, tableLog: `${s.index.replace(/\.md$/, '')} - Table Log.md` } : s));
    assert.deepStrictEqual(pickSession(withLog, 'Session 01 - The Start'),
      { error: 'Session 1 is wrapped up; its record is the Wrap-Up, with its Table Log.' });
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

  it("a table_log link to another session's log (an index copied from the last) is refused, and says which", () => {
    const dir = copy();
    const f = path.join(dir, IDX.c1s3);
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('status: planned', 'status: planned\ndocuments:\n  table_log: "[[Session 02 - The Test - Table Log]]"'));
    const r = tableLogOf(buildIndex(dir), IDX.c1s3);
    assert.strictEqual(r.log, null);
    assert.strictEqual(r.warning.kind, 'table-log');
    assert.match(r.warning.text, /Session 02 - The Test\.md/);
    // a log whose session: is left empty is taken as linked
    const l = path.join(dir, LOG);
    fs.writeFileSync(l, fs.readFileSync(l, 'utf8').replace(/^session: .*$/m, 'session:'));
    assert.deepStrictEqual(tableLogOf(buildIndex(dir), IDX.c1s3), { log: LOG, warning: null });
  });
});
