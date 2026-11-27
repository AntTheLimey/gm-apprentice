'use strict';
// The run sheet's play state on disk: `_meta/table/<session id>.json` (spec §6.7). One state in memory,
// written at most once per `delayMs` through a temp file beside it and a rename, so only the whole old
// file or the whole new one is ever there. `rev`, `stateId`, `recordHash` and `filed` belong to the store: a
// page's PUT never sets them (plan decision 16, re-check R2). Only an accepted PUT bumps `rev`;
// `setServer` (the server's `recordHash`) does not, but it still schedules a write.
//
// A lock file beside the state (`<id>.lock`, `{ pid, port }`) keeps one server per session. A lock is
// held only while its server answers: its port answers `/api/hello` as the run sheet with the lock's
// pid (`lockHolder`, which the CLI asks before it starts), or, before the port is known, while the
// lock is under a minute old. Any other lock is taken over: a pid can be alive again as another
// program after a reboot, a wrap or on Windows (PR review M2). A clean close removes the lock, so a
// lock found at load means the last run did not end cleanly: rev then starts 1000 higher, so a rev a
// lost write had handed out is never handed out again (third review L3).
//
// A state file iCloud has taken off this computer (its `.<name>.icloud` placeholder, or a dataless
// file on macOS) refuses the load, code IN_CLOUD: the sheet never starts empty over a saved state.
const nodeFs = require('node:fs');
const path = require('node:path');
const { runCommand } = require('../run-command');

// `filed` ({ index, at }) is set by the server once it has filed a no-Plan session (Task 7): a page's PUT never changes
// it, and once it is set the PUT never changes the session's `title` either (renaming a filed note is wrap-up's).
const SERVER_KEYS = ['recordHash', 'filed'];
const REV_GAP = 1000;
const LOCK_FRESH_MS = 60 * 1000;
const SF_DATALESS = 0x40000000;

const lockFileOf = (file) => `${file.replace(/\.json$/i, '')}.lock`;

// The lock beside `file`: null for none, `{ broken: true }` for one that does not read, else
// `{ pid, port, ageMs }` (port null before the server listens).
function readLock(file, { fs = nodeFs, nowMs = Date.now } = {}) {
  const lf = lockFileOf(file);
  let text;
  try { text = fs.readFileSync(lf, 'utf8'); } catch (err) { return err.code === 'ENOENT' ? null : { broken: true }; }
  let held = null;
  try { held = JSON.parse(text); } catch { held = null; }
  if (!held || typeof held !== 'object' || Array.isArray(held)) return { broken: true };
  let ageMs = Infinity;
  try { ageMs = nowMs() - fs.statSync(lf).mtimeMs; } catch { /* no age: an old lock */ }
  return { pid: Number.isInteger(held.pid) ? held.pid : null, port: Number.isInteger(held.port) ? held.port : null, ageMs };
}

// The rule without the network: a lock with no port is held while under a minute old (its server is
// between load and listen). A lock with a port is held only when the port answers, which `lockHolder`
// asks; the store alone takes it over.
const portlessAndFresh = (lock) => lock.port === null && lock.ageMs < LOCK_FRESH_MS;

// The lock's `{ pid, port }` when its server still holds it, else null. `hello(port)` answers the
// run sheet's `/api/hello` body, or null.
async function lockHolder(file, { fs = nodeFs, nowMs = Date.now, hello } = {}) {
  const lock = readLock(file, { fs, nowMs });
  if (!lock || lock.broken) return null;
  if (lock.port === null) return portlessAndFresh(lock) ? { pid: lock.pid, port: null } : null;
  let h = null;
  try { h = hello ? await hello(lock.port) : null; } catch { h = null; }
  return h && h.app === 'run-sheet' && h.pid === lock.pid ? { pid: lock.pid, port: lock.port } : null;
}

// macOS file flags (`stat -f %f`), or null when they cannot be read.
function statFlags(file) {
  const r = runCommand('/usr/bin/stat', ['-f', '%f', file], { timeoutMs: 3000 });
  const n = r.code === 0 ? Number(String(r.stdout).trim()) : NaN;
  return Number.isInteger(n) ? n : null;
}

// True when the file is in iCloud and not on this computer: its `.<name>.icloud` placeholder stands in
// for it, or (macOS) it is dataless. A dataless file has no blocks, so only then are its flags read.
function inCloudOnly(file, { fs = nodeFs, platform = process.platform, flagsOf = statFlags } = {}) {
  let st;
  try { st = fs.statSync(file); } catch (err) {
    if (err.code !== 'ENOENT') return false;
    return fs.existsSync(path.join(path.dirname(file), `.${path.basename(file)}.icloud`));
  }
  if (platform !== 'darwin' || !st.isFile() || st.blocks !== 0 || st.size === 0) return false;
  const flags = flagsOf(file);
  return flags === null ? true : (flags & SF_DATALESS) !== 0;
}

// A file-name-safe UTC stamp: 2026-11-20T21-05-03Z.
const stampOf = (d) => d.toISOString().replace(/\.\d+Z$/, 'Z').replace(/:/g, '-');

function createStore({
  file, stateId, delayMs = 1000, retryMs = [1000, 2000, 5000], fs = nodeFs,
  onSaved = () => {}, onFailed = () => {}, onWrite = () => {}, fresh = () => ({}), now = () => new Date(),
  upgrade = (state) => state, pid = process.pid, held = portlessAndFresh, nowMs = Date.now, inCloud = inCloudOnly,
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

  const lockText = (port) => `${JSON.stringify({ pid, port: port == null ? null : port })}\n`;
  const lockedError = (lock) => {
    const e = new Error(`the run sheet for this session is already running (pid ${lock.pid}${lock.port ? `, port ${lock.port}` : ''})`);
    e.code = 'LOCKED';
    e.pid = lock.pid;
    e.port = lock.port;
    return e;
  };
  // The lock is still this store's: a later start that took it over owns it now.
  const ownLock = () => { const l = readLock(file, { fs, nowMs }); return !!l && !l.broken && l.pid === pid; };

  // Takes the lock; true when a lock was found that its server had left behind (an unclean end). The
  // lock is created exclusively, so of two starts at once only one gets it. A lock that cannot be
  // written stops the start: another start would have no owner to check.
  function takeLock() {
    const lock = readLock(file, { fs, nowMs });
    if (lock && !lock.broken && held(lock)) throw lockedError(lock);
    fs.mkdirSync(dir, { recursive: true });
    if (lock) fs.rmSync(lockFile, { force: true });
    try {
      fs.writeFileSync(lockFile, lockText(null), { encoding: 'utf8', flag: 'wx' });
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      throw lockedError(readLock(file, { fs, nowMs }) || { pid: null, port: null });
    }
    locked = true;
    return lock !== null;
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
      if (inCloud(file, { fs })) {
        const e = new Error(`the saved state is in iCloud, not on this computer: ${file}`);
        e.code = 'IN_CLOUD';
        e.file = file;
        throw e;
      }
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
      // a page from before a key existed (a 5a tab open across the upgrade) sends none: the stored one stands
      const sent = { ...state };
      for (const k of Object.keys(cur || {})) if (!Object.prototype.hasOwnProperty.call(sent, k)) sent[k] = cur[k];
      const whole = upgrade(sent); // throws, code BAD_STATE, for a key of the wrong kind
      const prev = cur;
      rev++;
      cur = own(whole, rev, prev.recordHash);
      if (Object.prototype.hasOwnProperty.call(prev, 'filed')) cur.filed = prev.filed; else delete cur.filed;
      if (prev.filed && Object.prototype.hasOwnProperty.call(prev, 'title')) cur.title = prev.title;
      changed();
      return { rev };
    },
    // Reduces each action on its own, on the newest state, stamping `at` (the action's own valid time not
    // in the future, else `now`). One that throws is skipped and named in `rejected`. `rev` bumps once
    // when anything changed. `base` is not asked for: actions land on whatever the store holds, and an
    // action id already applied changes nothing (5b decision 25).
    apply({ stateId: theirs, actions, reduce, upgrade: up = upgrade, fresh: fr = fresh, now: clock = now } = {}) {
      ensure();
      if (theirs !== stateId) return { conflict: 'session', rev };
      if (!Array.isArray(actions)) throw new TypeError('actions must be an array');
      if (typeof reduce !== 'function') throw new TypeError('apply needs a reduce');
      const start = up(cur, fr());
      let s = start;
      const rejected = [];
      for (const action of actions) {
        const own = action && typeof action === 'object' ? action.at : null;
        const ms = typeof own === 'string' && /^\d{4}-\d\d-\d\dT/.test(own) ? Date.parse(own) : NaN;
        const t = clock();
        const at = Number.isFinite(ms) && ms <= t.getTime() ? new Date(ms).toISOString() : t.toISOString();
        try { s = reduce(s, action, at); } catch (err) {
          rejected.push({ id: action && action.id != null ? action.id : null, type: action && action.type != null ? action.type : null, error: String((err && err.message) || err).split('\n')[0] });
        }
      }
      if (s === start) return { rev, state: cur, rejected };
      rev++;
      cur = own(s, rev, cur.recordHash);
      changed();
      return { rev, state: cur, rejected };
    },
    // Server-owned keys only (`recordHash`, `filed`); no rev bump, but a write is scheduled so a kill before the
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
    // Written whole through a temp file and a rename, so a start that reads it never sees half a lock.
    lockPort(port) {
      if (!locked || closed || !ownLock()) return;
      const tmp = `${lockFile}.tmp-${process.pid}`;
      try {
        fs.writeFileSync(tmp, lockText(port), 'utf8');
        fs.renameSync(tmp, lockFile);
      } catch { try { fs.rmSync(tmp, { force: true }); } catch { /* nothing to tidy */ } }
    },
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
      // Only this store's own lock: one a later start took over is that start's.
      if (locked && ownLock()) { try { fs.rmSync(lockFile, { force: true }); } catch { /* the next start takes over a lock whose process is gone */ } }
      return Promise.resolve();
    },
  };
  return self;
}

module.exports = { createStore, stampOf, lockHolder, readLock, lockFileOf, inCloudOnly, portlessAndFresh, REV_GAP, LOCK_FRESH_MS, SF_DATALESS };
