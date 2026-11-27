'use strict';
const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { listSessions, pickSession, stateIdOf, tableLogOf, isPlayed, stateFileFor } = require('../lib/run-sheet/sessions');
const { buildIndex } = require('../lib/run-sheet/notes');
const { copyRecordFixture } = require('./helpers/record-fixture');
const { removeFixture } = require('./helpers/systems-fixture');

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

  // Changed on purpose (Ant, 2026-11-27): every Plan wrapped up opens the next session from the record, no error.
  it('every Plan wrapped up opens the next session from the record', () => {
    const closed = list.slice(0, 3).map((s) => ({ ...s, open: false, wrapUp: s.wrapUp || 'x.md' }));
    const r = pickSession(closed);
    assert.strictEqual(r.session.fromRecord, true);
    assert.strictEqual(r.session.number, 4);
    assert.strictEqual(r.session.after, IDX.c1s3);
    assert.strictEqual(r.session.planVault, true);
    assert.strictEqual(r.session.index, null);
    assert.strictEqual(r.session.plan, null);
    assert.strictEqual(r.session.label, 'Session 4');
    assert.strictEqual(r.session.chapter, 'Chapters/Chapter 1/Chapter 1.md');
    assert.deepStrictEqual(r.others, []);
  });

  it('a Plan with no Wrap-Up still wins over a record session', () => {
    const r = pickSession(list);
    assert.strictEqual(r.session.index, IDX.c1s2);
    assert.notStrictEqual(r.session.fromRecord, true);
  });

  it("the next session's index made by prep --upcoming is used", () => {
    const l = list.slice(0, 3).map((s) => ({ ...s, open: false, wrapUp: s.index === IDX.c1s3 ? null : (s.wrapUp || 'x.md'), plan: s.index === IDX.c1s3 ? null : s.plan }));
    const r = pickSession(l);
    assert.strictEqual(r.session.fromRecord, true);
    assert.strictEqual(r.session.index, IDX.c1s3);
    assert.strictEqual(r.session.number, 3);
    assert.strictEqual(r.session.after, IDX.c1s2);
  });

  // Changed on purpose (Ant, 2026-11-27): a session with no Plan opens from the record, no "prep it first".
  it('--session naming an index with no Plan opens it from the record', () => {
    const noPlan = list.map((s) => (s.index === IDX.c1s3 ? { ...s, plan: null, open: false } : s));
    const r = pickSession(noPlan, IDX.c1s3);
    assert.strictEqual(r.session.fromRecord, true);
    assert.strictEqual(r.session.index, IDX.c1s3);
    assert.strictEqual(r.session.plan, null);
    assert.strictEqual(r.session.label, 'Session 3');
  });

  it('a wrapped-up session asked by name is still refused', () => {
    assert.ok(pickSession(list, IDX.c1s1).error.includes('is wrapped up'));
  });

  it('a vault with nothing played opens Session 1', () => {
    const r = pickSession([]);
    assert.strictEqual(r.session.number, 1);
    assert.strictEqual(r.session.after, null);
    assert.strictEqual(r.session.index, null);
    assert.strictEqual(r.session.planVault, false);
    const first = { index: IDX.c1s1, title: 'Session 01 - The Start', number: 1, chapter: null, plan: null, wrapUp: null, tableLog: null, played: false, open: false, label: 'Session 1' };
    const r2 = pickSession([first]);
    assert.strictEqual(r2.session.index, IDX.c1s1);
    assert.strictEqual(r2.session.after, null);
  });

  it('a night played but not wrapped up reopens, with its played date', () => {
    const l = [{ index: 'a/Session 01.md', title: 'S1', number: 1, chapter: null, plan: null, wrapUp: 'w.md', tableLog: null, played: true, open: false, label: 'Session 1' },
      { index: 'a/Session 02.md', title: 'S2', number: 2, chapter: null, plan: null, wrapUp: null, tableLog: 'a/log.md', played: true, playDate: '2026-11-22', open: false, label: 'Session 2' }];
    const r = pickSession(l).session;
    assert.strictEqual(r.index, 'a/Session 02.md');
    assert.strictEqual(r.played, true);
    assert.strictEqual(r.playDate, '2026-11-22');
    assert.strictEqual(r.tableLog, 'a/log.md');
  });

  it('a last session with no number gives the next by count', () => {
    const l = [1, 2, 3].map((n) => ({ index: `a/S${n}.md`, title: `S${n}`, number: n === 3 ? null : n, chapter: null, plan: null, wrapUp: 'w.md', tableLog: null, played: true, open: false, label: `S${n}` }));
    assert.strictEqual(pickSession(l).session.number, 4);
  });

  it('stateIdOf names a no-Plan session by its number, before filing and after', () => {
    const base = { chapter: 'Ch1/Ch1.md', plan: null, fromRecord: true, number: 15 };
    assert.strictEqual(stateIdOf({ ...base, index: null }), 'ch1--session-15');
    assert.strictEqual(stateIdOf({ ...base, index: 'Ch1/Sessions/Session 15 - 29 Nov 2026.md' }), 'ch1--session-15');
    // [B3] filed in its own folder: the same id
    assert.strictEqual(stateIdOf({ ...base, index: 'Ch1/Sessions/Session 15/Session 15 - 29 Nov 2026.md' }), 'ch1--session-15');
    assert.strictEqual(stateIdOf({ ...base, chapter: null, index: null }), 'vault--session-15');
  });

  it('stateFileFor adopts the number-named state when a Plan appears, and returns its id', () => {
    const planned = { index: IDX.c1s3, plan: 'p.md', number: 3, chapter: 'Chapters/Chapter 1/Chapter 1.md' };
    const own = path.join('/v', '_meta', 'table', 'chapter-1--session-03-next.json');
    const num = path.join('/v', '_meta', 'table', 'chapter-1--session-3.json');
    assert.deepStrictEqual(stateFileFor('/v', planned, { exists: () => false }), { file: own, stateId: 'chapter-1--session-03-next' });
    assert.deepStrictEqual(stateFileFor('/v', planned, { exists: (f) => f === num }), { file: num, stateId: 'chapter-1--session-3' });
    assert.deepStrictEqual(stateFileFor('/v', planned, { exists: () => true }), { file: own, stateId: 'chapter-1--session-03-next' });
    const rec = { index: null, plan: null, fromRecord: true, number: 3, chapter: 'Chapters/Chapter 1/Chapter 1.md' };
    assert.deepStrictEqual(stateFileFor('/v', rec), { file: num, stateId: 'chapter-1--session-3' });
  });

  it('stateFileFor adopts the state whose filed.index is the Plan session, even filed in another chapter', () => {
    const dir = copy();
    const tdir = path.join(dir, '_meta', 'table');
    fs.mkdirSync(tdir, { recursive: true });
    // prep filed Session 3 into Chapter 2, while the record session counted it in Chapter 1
    const planned = { index: IDX.c2s1, plan: 'p.md', number: 3, chapter: 'Chapters/Chapter 1/Chapter 1.md' };
    fs.writeFileSync(path.join(tdir, 'chapter-1--session-3.json'), JSON.stringify({ filed: { index: 'Elsewhere/Other.md' } }));
    fs.writeFileSync(path.join(tdir, 'chapter-2--session-3.json'), JSON.stringify({ filed: { index: IDX.c2s1 } }));
    fs.writeFileSync(path.join(tdir, 'broken--session-3.json'), '{ not json');
    assert.deepStrictEqual(stateFileFor(dir, planned), { file: path.join(tdir, 'chapter-2--session-3.json'), stateId: 'chapter-2--session-3' });
    // a state under the session's own name wins over the scan
    fs.writeFileSync(path.join(tdir, 'chapter-1--session-01-snowmelt.json'), '{}');
    assert.strictEqual(stateFileFor(dir, planned).stateId, 'chapter-1--session-01-snowmelt');
    fs.rmSync(path.join(tdir, 'chapter-1--session-01-snowmelt.json'));
    // no filed.index match: the number name still adopts, else the session's own name
    const other = { index: IDX.c1s3, plan: 'p.md', number: 3, chapter: 'Chapters/Chapter 1/Chapter 1.md' };
    assert.strictEqual(stateFileFor(dir, other).stateId, 'chapter-1--session-3');
    fs.rmSync(path.join(tdir, 'chapter-1--session-3.json'));
    assert.strictEqual(stateFileFor(dir, other).stateId, 'chapter-1--session-03-next');
  });

  it("an orphan Table Log is no unfiled session's log [B2]", () => {
    const dir = copy();
    for (const [name, sess] of [['empty', ''], ['dead', '"[[Nowhere At All]]"']]) {
      fs.writeFileSync(path.join(dir, `${S}orphan-${name}.md`), `---\ntype: session-table-log\nsession: ${sess}\n---\n\n## Log\n`);
    }
    assert.deepStrictEqual(tableLogOf(buildIndex(dir), null), { log: null, warning: null });
  });

  it('the record fixture copies: Sessions 13 and 14 are wrapped up with no Plan, and a missing drop throws', () => {
    const dir = copyRecordFixture();
    try {
      const l = listSessions(dir);
      assert.deepStrictEqual(l.map((s) => s.number), [13, 14]);
      assert.ok(l.every((s) => s.plan === null && s.wrapUp));
      const r = pickSession(l).session;
      assert.strictEqual(r.fromRecord, true);
      assert.strictEqual(r.number, 15);
      assert.strictEqual(r.after, l[1].index);
      assert.strictEqual(r.planVault, false);
      assert.strictEqual(stateIdOf(r), 'chapter-3--session-15');
    } finally { removeFixture(dir); }
    assert.throws(() => copyRecordFixture({ drop: ['Nope/Missing.md'] }), /no Nope\/Missing\.md/);
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

  it('played (#855): a record counts only with something in it; an empty Table Log a look filed does not', () => {
    const dir = copy();
    const f = path.join(dir, IDX.c1s3);
    const stem = path.basename(IDX.c1s3, '.md');
    const logRel = `${path.dirname(IDX.c1s3)}/${stem} - Table Log.md`;
    const notesRel = `${path.dirname(IDX.c1s3)}/${stem} - Play Notes.md`;
    const heads = ['Where everyone ended', 'Log', 'Vitals at the end'].map((h) => `## ${h}\n${h === 'Vitals at the end' ? '| Who | HP | Conditions |\n| --- | --- | --- |\n' : ''}`).join('\n');
    const note = (type, body) => `---\ntype: ${type}\nsession: "[[${stem}]]"\n---\n\n# ${stem}\n\n${body}`;
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('status: planned', `status: planned\ndocuments:\n  table_log: "[[${stem} - Table Log]]"\n  play_notes: "[[${stem} - Play Notes]]"`));
    fs.writeFileSync(path.join(dir, logRel), note('session-table-log', heads));
    fs.writeFileSync(path.join(dir, notesRel), note('session-play-notes', ''));
    assert.strictEqual(isPlayed(buildIndex(dir), IDX.c1s3), false, 'an empty log and empty notes are no play');
    fs.writeFileSync(path.join(dir, notesRel), note('session-play-notes', 'Ada climbed the wall.\n'));
    assert.strictEqual(isPlayed(buildIndex(dir), IDX.c1s3), true, 'written Play Notes are play');
    fs.writeFileSync(path.join(dir, notesRel), note('session-play-notes', ''));
    fs.writeFileSync(path.join(dir, logRel), note('session-table-log', heads.replace('## Log\n', '## Log\n- 20:14 the wall climbed\n')));
    assert.strictEqual(isPlayed(buildIndex(dir), IDX.c1s3), true, 'a Table Log with a line is play');
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
