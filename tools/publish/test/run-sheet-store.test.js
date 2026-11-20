'use strict';
const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore } = require('../lib/run-sheet/store');

const made = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-store-'));
  made.push(d);
  return d;
};
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

const wait = (ms) => new Promise((r) => { setTimeout(r, ms); });
const ID = 'chapter-1--session-02-the-test';
const fileIn = (dir) => path.join(dir, '_meta', 'table', `${ID}.json`);
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const S = (extra = {}) => ({ points: {}, jots: [], ...extra });

// A store on a temp file with short waits; closed by the caller.
function mk(dir, opts = {}) {
  const store = createStore({ file: fileIn(dir), stateId: ID, delayMs: 40, retryMs: [20, 20], ...opts });
  store.load();
  return store;
}

describe('run sheet state store', () => {
  it('writes once per second however many puts', async () => {
    const dir = tmp();
    let writes = 0;
    const realFs = fs;
    const spy = { ...realFs, renameSync: (a, b) => { writes++; return realFs.renameSync(a, b); } };
    const store = mk(dir, { fs: spy, delayMs: 60 });
    let rev = 0;
    for (let i = 0; i < 5; i++) rev = store.put({ stateId: ID, base: rev, state: S({ n: i }) }).rev;
    assert.strictEqual(rev, 5);
    assert.strictEqual(writes, 0, 'nothing written inside the wait');
    await wait(120);
    assert.strictEqual(writes, 1);
    assert.strictEqual(readJson(fileIn(dir)).n, 4);
    await store.close();
  });

  it('rev and stateId survive a restart', async () => {
    const dir = tmp();
    const a = mk(dir);
    a.put({ stateId: ID, base: 0, state: S() });
    a.put({ stateId: ID, base: 1, state: S({ x: 1 }) });
    await a.close();
    const b = createStore({ file: fileIn(dir), stateId: ID, delayMs: 40 });
    const loaded = b.load();
    assert.strictEqual(loaded.rev, 2);
    assert.strictEqual(loaded.stateId, ID);
    assert.strictEqual(b.get().rev, 2);
    assert.deepStrictEqual(b.put({ stateId: ID, base: 2, state: S() }), { rev: 3 });
    await b.close();
  });

  it("a put with another stateId conflicts 'session'; a stale base conflicts 'stale'; neither writes", async () => {
    const dir = tmp();
    const store = mk(dir);
    store.put({ stateId: ID, base: 0, state: S({ ok: 1 }) });
    await store.close();
    const before = fs.readFileSync(fileIn(dir), 'utf8');
    const s2 = mk(dir);
    assert.deepStrictEqual(s2.put({ stateId: 'other--session', base: 1, state: S({ bad: 1 }) }), { conflict: 'session', rev: 1 });
    assert.deepStrictEqual(s2.put({ stateId: ID, base: 0, state: S({ bad: 2 }) }), { conflict: 'stale', rev: 1 });
    assert.strictEqual(s2.get().state.bad, undefined);
    await wait(80);
    await s2.close();
    assert.strictEqual(fs.readFileSync(fileIn(dir), 'utf8'), before);
  });

  it('a PUT cannot change recordHash', async () => {
    const dir = tmp();
    const store = mk(dir);
    store.setServer({ recordHash: 'abc' });
    const r = store.put({ stateId: ID, base: 0, state: S({ recordHash: 'evil', rev: 99, stateId: 'nope' }) });
    assert.deepStrictEqual(r, { rev: 1 });
    const { state, rev } = store.get();
    assert.strictEqual(rev, 1);
    assert.strictEqual(state.recordHash, 'abc');
    assert.strictEqual(state.rev, 1);
    assert.strictEqual(state.stateId, ID);
    await store.close();
    const disk = readJson(fileIn(dir));
    assert.strictEqual(disk.recordHash, 'abc');
    assert.strictEqual(disk.rev, 1);
    assert.strictEqual(disk.stateId, ID);
  });

  it('setServer schedules a write without a rev bump', async () => {
    const dir = tmp();
    const store = mk(dir);
    store.put({ stateId: ID, base: 0, state: S() });
    await wait(80);
    store.setServer({ recordHash: 'h1', rev: 50 });
    assert.strictEqual(store.get().rev, 1, 'no rev bump, and rev is not the server patch\'s either');
    await wait(80);
    const disk = readJson(fileIn(dir));
    assert.strictEqual(disk.recordHash, 'h1');
    assert.strictEqual(disk.rev, 1);
    // A store that is killed now (no close) has the new recordHash on disk for the next start.
    const again = createStore({ file: fileIn(dir), stateId: ID });
    assert.strictEqual(again.load().recordHash, 'h1');
    await again.close();
    await store.close();
  });

  it('leftover temp files are removed at load', async () => {
    const dir = tmp();
    const f = fileIn(dir);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify({ stateId: ID, rev: 3 }));
    fs.writeFileSync(`${f}.tmp-123`, '{"half');
    fs.writeFileSync(`${f}.tmp-9`, '');
    const keep = path.join(path.dirname(f), 'other.json.tmp-5');
    fs.writeFileSync(keep, 'not ours');
    const store = createStore({ file: f, stateId: ID });
    assert.strictEqual(store.load().rev, 3);
    assert.ok(!fs.existsSync(`${f}.tmp-123`));
    assert.ok(!fs.existsSync(`${f}.tmp-9`));
    assert.ok(fs.existsSync(keep), 'another file\'s temp is left alone');
    await store.close();
  });

  it('get returns the newest state inside the debounce', async () => {
    const dir = tmp();
    const store = mk(dir, { delayMs: 500 });
    store.put({ stateId: ID, base: 0, state: S({ v: 'new' }) });
    assert.ok(!fs.existsSync(fileIn(dir)));
    assert.strictEqual(store.get().state.v, 'new');
    assert.strictEqual(store.get().rev, 1);
    await store.close();
  });

  it('a write is temp file then rename', async () => {
    const dir = tmp();
    const calls = [];
    const spy = {
      ...fs,
      writeFileSync: (p, ...rest) => { calls.push(['write', p]); return fs.writeFileSync(p, ...rest); },
      renameSync: (a, b) => { calls.push(['rename', a, b]); return fs.renameSync(a, b); },
    };
    const store = mk(dir, { fs: spy });
    store.put({ stateId: ID, base: 0, state: S() });
    store.flushNow();
    const f = fileIn(dir);
    assert.ok(calls.length >= 2);
    assert.ok(calls.every((c) => c[0] !== 'write' || c[1] !== f), 'never written to the target directly');
    const w = calls.find((c) => c[0] === 'write');
    assert.strictEqual(w[1], `${f}.tmp-${process.pid}`);
    assert.deepStrictEqual(calls.find((c) => c[0] === 'rename').slice(1), [`${f}.tmp-${process.pid}`, f]);
    await store.close();
  });

  it('a crash before rename leaves the old file whole', async () => {
    const dir = tmp();
    const a = mk(dir);
    a.put({ stateId: ID, base: 0, state: S({ v: 'old' }) });
    await a.close();
    const before = fs.readFileSync(fileIn(dir), 'utf8');
    const crash = { ...fs, renameSync: () => { const e = new Error('killed'); e.code = 'EKILLED'; throw e; } };
    const b = mk(dir, { fs: crash, retryMs: [10000] });
    b.put({ stateId: ID, base: 1, state: S({ v: 'new' }) });
    b.flushNow();
    assert.strictEqual(fs.readFileSync(fileIn(dir), 'utf8'), before);
    await b.close();
  });

  it('EPERM on rename retries and reports failed, then saved', async () => {
    const dir = tmp();
    const seen = [];
    let fails = 2;
    const flaky = {
      ...fs,
      renameSync: (a, b) => {
        if (fails > 0) { fails--; const e = new Error('busy'); e.code = 'EPERM'; throw e; }
        return fs.renameSync(a, b);
      },
    };
    const store = mk(dir, {
      fs: flaky,
      onSaved: (rev) => seen.push(['saved', rev]),
      onFailed: (rev, err) => seen.push(['failed', rev, err.code]),
    });
    store.put({ stateId: ID, base: 0, state: S() });
    await wait(200);
    assert.deepStrictEqual(seen, [['failed', 1, 'EPERM'], ['failed', 1, 'EPERM'], ['saved', 1]]);
    assert.strictEqual(readJson(fileIn(dir)).rev, 1);
    await store.close();
  });

  it('an unparseable file is moved aside, not deleted', async () => {
    const dir = tmp();
    const f = fileIn(dir);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, '{"rev": 4, "broken');
    const store = createStore({ file: f, stateId: ID, now: () => new Date('2026-11-20T21:05:03Z') });
    assert.strictEqual(store.load(), null);
    assert.ok(!fs.existsSync(f));
    const aside = path.join(path.dirname(f), `${ID}.broken-2026-11-20T21-05-03Z.json`);
    assert.strictEqual(store.broken, aside);
    assert.strictEqual(fs.readFileSync(aside, 'utf8'), '{"rev": 4, "broken');
    assert.strictEqual(store.get().rev, 0);
    await store.close();
  });

  it('close flushes', async () => {
    const dir = tmp();
    const store = mk(dir, { delayMs: 10000 });
    store.put({ stateId: ID, base: 0, state: S({ v: 'last' }) });
    await store.close();
    assert.strictEqual(readJson(fileIn(dir)).v, 'last');
  });

  it('onWrite runs after each successful write with the state written', async () => {
    const dir = tmp();
    const wrote = [];
    const store = mk(dir, { onWrite: (s) => wrote.push(s.v) });
    store.put({ stateId: ID, base: 0, state: S({ v: 1 }) });
    await wait(80);
    store.put({ stateId: ID, base: 1, state: S({ v: 2 }) });
    await store.close();
    assert.deepStrictEqual(wrote, [1, 2]);
  });

  it('a fresh store starts from the given empty state', async () => {
    const dir = tmp();
    const store = createStore({ file: fileIn(dir), stateId: ID, fresh: () => ({ points: {}, rev: 7, stateId: 'x' }) });
    assert.strictEqual(store.load(), null);
    assert.deepStrictEqual(store.get(), { state: { points: {}, rev: 0, stateId: ID, recordHash: null }, rev: 0 });
    await store.close();
    assert.ok(!fs.existsSync(fileIn(dir)), 'nothing written until something changes');
  });
});
