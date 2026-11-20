'use strict';
// The run sheet's play state on disk: `_meta/table/<session id>.json` (spec §6.7). One state in memory,
// written at most once per `delayMs` through a temp file beside it and a rename, so only the whole old
// file or the whole new one is ever there. `rev`, `stateId` and `recordHash` belong to the store: a
// page's PUT never sets them (plan decision 16, re-check R2). Only an accepted PUT bumps `rev`;
// `setServer` (the server's `recordHash`) does not, but it still schedules a write.

const nodeFs = require('node:fs');
const path = require('node:path');

const SERVER_KEYS = ['recordHash'];

// A file-name-safe UTC stamp: 2026-11-20T21-05-03Z.
const stampOf = (d) => d.toISOString().replace(/\.\d+Z$/, 'Z').replace(/:/g, '-');

function createStore({
  file, stateId, delayMs = 1000, retryMs = [1000, 2000, 5000], fs = nodeFs,
  onSaved = () => {}, onFailed = () => {}, onWrite = () => {}, fresh = () => ({}), now = () => new Date(),
} = {}) {
  if (!file || !stateId) throw new Error('createStore needs a file and a stateId');
  const dir = path.dirname(file);
  const base = path.basename(file);
  const tmpFile = `${file}.tmp-${process.pid}`;

  let cur = null;
  let rev = 0;
  let dirty = false;
  let timer = null;
  let attempt = 0;
  let closed = false;

  const own = (state, r, recordHash) => ({ ...state, rev: r, stateId, recordHash: recordHash === undefined ? null : recordHash });
  const ensure = () => { if (!cur) cur = own(fresh() || {}, 0, null); };

  function clearTimer() { if (timer) { clearTimeout(timer); timer = null; } }
  function schedule(ms) {
    if (closed || timer) return;
    timer = setTimeout(() => { timer = null; writeNow(); }, ms);
    if (timer.unref) timer.unref();
  }

  // True when the newest state is on disk.
  function writeNow() {
    if (!dirty) return true;
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
      onFailed(snapshot.rev, err);
      schedule(wait);
      return false;
    }
    attempt = 0;
    dirty = cur !== snapshot;
    onSaved(snapshot.rev);
    onWrite(snapshot);
    if (dirty) schedule(delayMs);
    return !dirty;
  }

  function changed() {
    dirty = true;
    schedule(delayMs);
  }

  const self = {
    broken: null,
    // The saved state, or null for none (or one that did not parse, moved aside as
    // `<id>.broken-<stamp>.json`, its path in `store.broken`). Leftover temp files are removed.
    load() {
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
        cur = null;
        ensure();
        rev = 0;
        return null;
      }
      let parsed = null;
      try { parsed = JSON.parse(text); } catch { parsed = null; }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        const id = base.replace(/\.json$/i, '');
        let aside = path.join(dir, `${id}.broken-${stampOf(now())}.json`);
        for (let i = 2; fs.existsSync(aside); i++) aside = path.join(dir, `${id}.broken-${stampOf(now())}-${i}.json`);
        fs.renameSync(file, aside);
        self.broken = aside;
        cur = null;
        ensure();
        rev = 0;
        return null;
      }
      rev = Number.isInteger(parsed.rev) && parsed.rev >= 0 ? parsed.rev : 0;
      cur = own(parsed, rev, parsed.recordHash == null ? null : parsed.recordHash);
      return cur;
    },
    put({ stateId: theirs, base: theirBase, state } = {}) {
      ensure();
      if (theirs !== stateId) return { conflict: 'session', rev };
      if (theirBase !== rev) return { conflict: 'stale', rev };
      if (!state || typeof state !== 'object' || Array.isArray(state)) throw new TypeError('state must be an object');
      rev++;
      cur = own(state, rev, cur.recordHash);
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
    flushNow() { clearTimer(); writeNow(); },
    // A write's onWrite may change the state again (the server's recordHash): that lands too.
    close() {
      for (let i = 0; i < 3 && dirty; i++) {
        clearTimer();
        if (!writeNow()) break;
      }
      closed = true;
      clearTimer();
      return Promise.resolve();
    },
  };
  return self;
}

module.exports = { createStore, stampOf };
