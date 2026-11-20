'use strict';
// The run sheet's play state on disk: `_meta/table/<session id>.json` (spec §6.7). One state in memory,
// written at most once per `delayMs` through a temp file beside it and a rename, so only the whole old
// file or the whole new one is ever there. `rev`, `stateId` and `recordHash` belong to the store: a
// page's PUT never sets them (plan decision 16, re-check R2). Only an accepted PUT bumps `rev`;
// `setServer` (the server's `recordHash`) does not, but it still schedules a write.
//
// A lock file beside the state (`<id>.lock`, `{ pid, port }`) keeps one server per session: a live
// holder refuses the load (code LOCKED); a holder whose process is gone is taken over. A clean close
// removes the lock, so a lock found at load means the last run did not end cleanly: rev then starts
// 1000 higher, so a rev a lost write had handed out is never handed out again (third review L3).
const nodeFs = require('node:fs');
const path = require('node:path');

const SERVER_KEYS = ['recordHash'];
const REV_GAP = 1000;

// True while a process with that pid runs. EPERM means it runs as someone else.
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; }
}

const lockFileOf = (file) => `${file.replace(/\.json$/i, '')}.lock`;

// The lock's `{ pid, port }` when a live process holds it, else null.
function lockHolder(file, { fs = nodeFs, alive = pidAlive } = {}) {
  let held;
  try { held = JSON.parse(fs.readFileSync(lockFileOf(file), 'utf8')); } catch { return null; }
  if (!held || !alive(held.pid)) return null;
  return { pid: held.pid, port: Number.isInteger(held.port) ? held.port : null };
}

// A file-name-safe UTC stamp: 2026-11-20T21-05-03Z.
const stampOf = (d) => d.toISOString().replace(/\.\d+Z$/, 'Z').replace(/:/g, '-');

function createStore({
  file, stateId, delayMs = 1000, retryMs = [1000, 2000, 5000], fs = nodeFs,
  onSaved = () => {}, onFailed = () => {}, onWrite = () => {}, fresh = () => ({}), now = () => new Date(),
  upgrade = (state) => state, pid = process.pid, alive = pidAlive,
} = {}) {
  if (!file || !stateId) throw new Error('createStore needs a file and a stateId');
  const dir = path.dirname(file);
  const base = path.basename(file);
  const tmpFile = `${file}.tmp-${process.pid}`;
  const lockFile = lockFileOf(file);

  let cur = null;
  let rev = 0;
  let dirty = false;
  let timer = null;
  let attempt = 0;
  let closed = false;
  let locked = false;
  let lastError = null;

  const own = (state, r, recordHash) => ({ ...state, rev: r, stateId, recordHash: recordHash === undefined ? null : recordHash });
  const ensure = () => { if (!cur) cur = own(fresh() || {}, 0, null); };

  function clearTimer() { if (timer) { clearTimeout(timer); timer = null; } }
  function schedule(ms) {
    if (closed || timer) return;
    timer = setTimeout(() => { timer = null; writeNow(); }, ms);
    if (timer.unref) timer.unref();
  }

  // 'clean' when the newest state is on disk, 'dirty' when a write landed but onWrite changed the
  // state again (the server's recordHash), 'failed' when the write did not land (a retry is scheduled).
  function writeNow() {
    if (!dirty) return 'clean';
    const snapshot = cur;
    const text = `${JSON.stringify(snapshot, null, 1)}\n`;
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(tmpFile, text, 'utf8');
      fs.renameSync(tmpFile, file);
    } catch (err) {
      // Windows: a rename another process blocks (EPERM, EBUSY) lands on a later try. The page shows
      // "Not saving" until it does.
      const wait = retryMs[Math.min(attempt, retryMs.length - 1)];
      attempt++;
      lastError = err;
      onFailed(snapshot.rev, err);
      schedule(wait);
      return 'failed';
    }
    attempt = 0;
    lastError = null;
    dirty = cur !== snapshot;
    onSaved(snapshot.rev);
    onWrite(snapshot);
    if (dirty) schedule(delayMs);
    return dirty ? 'dirty' : 'clean';
  }

  function writeLock(port) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(lockFile, `${JSON.stringify({ pid, port: port == null ? null : port })}\n`, 'utf8');
      locked = true;
    } catch { /* no lock: the state writes say what is wrong */ }
  }

  // Takes the lock; true when a lock was found that its process had left behind (an unclean end).
  function takeLock() {
    let held = null;
    let found = false;
    try { held = JSON.parse(fs.readFileSync(lockFile, 'utf8')); found = true; } catch (err) { found = err.code !== 'ENOENT'; }
    if (held && alive(held.pid)) {
      const port = Number.isInteger(held.port) ? held.port : null;
      const e = new Error(`the run sheet for this session is already running (pid ${held.pid}${port ? `, port ${port}` : ''})`);
      e.code = 'LOCKED';
      e.pid = held.pid;
      e.port = port;
      throw e;
    }
    writeLock(null);
    return found;
  }

  function changed() {
    dirty = true;
    schedule(delayMs);
  }

  const self = {
    broken: null,
    unclean: false,
    // The saved state, or null for none (or one that did not parse, moved aside as
    // `<id>.broken-<stamp>.json`, its path in `store.broken`). Leftover temp files are removed.
    load() {
      const unclean = takeLock();
      self.unclean = unclean;
      const startFresh = () => { rev = unclean ? REV_GAP : 0; cur = own(fresh() || {}, rev, null); };
      let names = [];
      try { names = fs.readdirSync(dir); } catch { /* no folder yet */ }
      for (const n of names) {
        if (n.startsWith(`${base}.tmp-`)) {
          try { fs.rmSync(path.join(dir, n), { force: true }); } catch { /* the next write overwrites ours */ }
        }
      }
      let text;
      try { text = fs.readFileSync(file, 'utf8'); } catch (err) {
        if (err.code !== 'ENOENT') throw err;
        startFresh();
        return null;
      }
      let parsed = null;
      try { parsed = JSON.parse(text); } catch { parsed = null; }
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        try { parsed = upgrade(parsed); } catch { parsed = null; }
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        const id = base.replace(/\.json$/i, '');
        let aside = path.join(dir, `${id}.broken-${stampOf(now())}.json`);
        for (let i = 2; fs.existsSync(aside); i++) aside = path.join(dir, `${id}.broken-${stampOf(now())}-${i}.json`);
        fs.renameSync(file, aside);
        self.broken = aside;
        startFresh();
        return null;
      }
      rev = Number.isInteger(parsed.rev) && parsed.rev >= 0 ? parsed.rev : 0;
      if (unclean) rev += REV_GAP;
      cur = own(parsed, rev, parsed.recordHash == null ? null : parsed.recordHash);
      return cur;
    },
    put({ stateId: theirs, base: theirBase, state } = {}) {
      ensure();
      if (theirs !== stateId) return { conflict: 'session', rev };
      if (theirBase !== rev) return { conflict: 'stale', rev };
      if (!state || typeof state !== 'object' || Array.isArray(state)) throw new TypeError('state must be an object');
      const whole = upgrade(state); // throws, code BAD_STATE, for a key of the wrong kind
      rev++;
      cur = own(whole, rev, cur.recordHash);
      changed();
      return { rev };
    },
    // Server-owned keys only (`recordHash`); no rev bump, but a write is scheduled so a kill before the
    // next click cannot leave a stale recordHash on disk.
    setServer(patch = {}) {
      ensure();
      const next = { ...cur };
      for (const k of SERVER_KEYS) if (Object.prototype.hasOwnProperty.call(patch, k)) next[k] = patch[k];
      cur = next;
      changed();
    },
    // The newest state, written or not. Callers must not change it.
    get() { ensure(); return { state: cur, rev }; },
    flushNow() { clearTimer(); return writeNow(); },
    // The port the server listens on, for the lock's refusal message.
    lockPort(port) { if (locked && !closed) writeLock(port); },
    // A write's onWrite may change the state again (the server's recordHash): that lands too. Rejects
    // when the newest state could not be written; the lock is then left, so the next start knows.
    close() {
      if (closed) return Promise.resolve();
      let result = 'clean';
      for (let i = 0; i < 5; i++) {
        clearTimer();
        result = writeNow();
        if (result !== 'dirty') break;
      }
      closed = true;
      clearTimer();
      if (result !== 'clean') {
        const why = lastError ? String(lastError.message || lastError).split('\n')[0] : 'the state kept changing';
        const e = new Error(why);
        e.code = lastError && lastError.code;
        return Promise.reject(e);
      }
      if (locked) { try { fs.rmSync(lockFile, { force: true }); } catch { /* the next start takes over a lock whose process is gone */ } }
      return Promise.resolve();
    },
  };
  return self;
}

module.exports = { createStore, stampOf, lockHolder, lockFileOf, pidAlive, REV_GAP };
