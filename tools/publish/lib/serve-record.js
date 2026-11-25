'use strict';
// A running `serve` keeps a record, so that `serve --status` can say it is up, `serve --background` can start one
// that belongs to no terminal or agent session, and `serve --stop` can end it on every OS (#883). One server per
// site folder: the record is named after the folder.
//
// The record lives in ~/.gm-apprentice/run (GM_APPRENTICE_RUN_DIR moves it, for tests). It holds the server's pid,
// port, addresses and a random id. The server answers its id on a path nobody can guess, so a record left behind
// by a restart, whose pid now belongs to some other program, is never taken for the server, and that program is
// never stopped.

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const ID_PREFIX = '/.gm-serve-id/';

function runDir(env = process.env) {
  return env.GM_APPRENTICE_RUN_DIR || path.join(os.homedir(), '.gm-apprentice', 'run');
}

// The record's files for a site folder. The key is the folder's real path, so a folder named through a link has
// the same record as the folder itself.
function recordFor(folder, env = process.env) {
  let real;
  try { real = fs.realpathSync(folder); } catch { real = path.resolve(folder); }
  const key = crypto.createHash('sha256').update(real).digest('hex').slice(0, 16);
  const dir = runDir(env);
  return { dir, stem: `serve-${key}`, file: path.join(dir, `serve-${key}.json`) };
}

// A stop request names the one server it is for, so a server started after it was written never acts on it.
const stopFile = (rec, id) => path.join(rec.dir, `${rec.stem}.${id}.stop`);

function readRecord(rec) {
  try {
    const r = JSON.parse(fs.readFileSync(rec.file, 'utf8'));
    return r && Number.isInteger(r.pid) && Number.isInteger(r.port) && typeof r.id === 'string' ? r : null;
  } catch { return null; }
}

// Written whole or not at all: a reader never sees half a record.
function writeRecord(rec, record) {
  fs.mkdirSync(rec.dir, { recursive: true });
  const tmp = `${rec.file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`);
  fs.renameSync(tmp, rec.file);
}

// Removes the record only while it is still this server's: a newer server's record is left alone. With `id`, also
// that server's stop request.
function clearRecord(rec, pid, id) {
  const r = readRecord(rec);
  if (!r || r.pid === pid) { try { fs.rmSync(rec.file, { force: true }); } catch { /* gone already */ } }
  if (id) { try { fs.rmSync(stopFile(rec, id), { force: true }); } catch { /* gone already */ } }
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; }
}

// Whether the server on `port` answers to `id`: 'yes'; 'no' (something answered, not with the id, or nothing
// listens there); 'slow' (no answer in time: a busy server is not taken for a gone one).
function answersTo(port, id, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: `${ID_PREFIX}${id}`, timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode === 204 ? 'yes' : 'no');
    });
    req.on('timeout', () => { req.destroy(); resolve('slow'); });
    req.on('error', () => resolve('no'));
  });
}

// The record of the server running for this folder, or null. A record whose server is gone is cleared. One whose
// process is there but did not answer in time comes back with `answering: false`: it may be the server, busy, so it
// is neither taken for gone nor signalled.
async function runningRecord(rec, deps = {}) {
  const r = readRecord(rec);
  if (!r) return null;
  const answer = (deps.pidAlive || pidAlive)(r.pid) ? await (deps.answersTo || answersTo)(r.port, r.id) : 'no';
  if (answer === 'yes') return { ...r, answering: true };
  if (answer === 'slow') return { ...r, answering: false };
  clearRecord(rec, r.pid, r.id);
  return null;
}

// A claim on the folder, taken before a server listens, so two starting at once cannot both run: the second finds
// the claim and stops. A claim left by a server that died before it listened is taken over.
function claim(rec, pid) {
  fs.mkdirSync(rec.dir, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(rec.file, `${JSON.stringify({ pid, claiming: true })}\n`, { flag: 'wx' });
      return true;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      let held = null;
      try { held = JSON.parse(fs.readFileSync(rec.file, 'utf8')); } catch { /* half written, or left half written */ }
      if (!held || !Number.isInteger(held.pid)) {
        // Someone may be writing it this moment; one still unreadable after 10 s was left by a start that died.
        let age = 0;
        try { age = Date.now() - fs.statSync(rec.file).mtimeMs; } catch { /* gone: try again */ }
        if (age < 10000) return false;
      } else if (pidAlive(held.pid)) return false;
      try { fs.rmSync(rec.file, { force: true }); } catch { /* taken by another */ }
    }
  }
  return false;
}

// Resolves true once nothing holds the port (on every address, as serve listens).
function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(port, '0.0.0.0', () => s.close(() => resolve(true)));
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(check, timeoutMs, everyMs = 100) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return true;
    if (Date.now() >= end) return false;
    await wait(everyMs);
  }
}

// Asks the running server to stop, and makes sure it did: first through the stop request it watches for (it
// closes every connection and exits), then, if it is still there after `graceMs`, by ending the process; but only
// a process that has just answered to the server's id is ever signalled. Resolves { stopped: false } when nothing
// was running, else { stopped, pid, port, portFree, answering }.
async function stopServer(rec, deps = {}) {
  const r = await runningRecord(rec, deps);
  if (!r) return { stopped: false };
  const alive = deps.pidAlive || pidAlive;
  const answers = deps.answersTo || answersTo;
  const free = deps.portFree || portFree;
  const kill = deps.kill || ((pid, sig) => process.kill(pid, sig));
  const graceMs = deps.graceMs ?? 5000;
  // Gone: the process has ended, or it no longer answers to its id and has let go of the port (an ended process
  // its parent has not yet reaped still looks alive).
  const gone = async () => !alive(r.pid) || ((await answers(r.port, r.id, 500)) === 'no' && await free(r.port));
  fs.mkdirSync(rec.dir, { recursive: true });
  fs.writeFileSync(stopFile(rec, r.id), `${Date.now()}\n`);
  let stopped = await waitFor(gone, graceMs, 200);
  // Signalled only while it answers to the server's id: a pid the system has since given to another program never is.
  for (const sig of ['SIGTERM', 'SIGKILL']) {
    if (stopped || (await answers(r.port, r.id, 1000)) !== 'yes') break;
    try { kill(r.pid, sig); } catch { /* gone in between */ }
    stopped = await waitFor(gone, 3000, 200);
  }
  if (stopped) clearRecord(rec, r.pid, r.id);
  const portIsFree = await waitFor(() => free(r.port), 3000, 200);
  return { stopped, pid: r.pid, port: r.port, portFree: portIsFree, answering: r.answering };
}

module.exports = {
  ID_PREFIX, runDir, recordFor, stopFile, readRecord, writeRecord, clearRecord, claim, pidAlive, answersTo, runningRecord, portFree,
  waitFor, stopServer,
};
