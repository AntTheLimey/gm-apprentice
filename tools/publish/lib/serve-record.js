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

// The record's files for a site folder: the record, the stop request and the background server's output.
function recordFor(folder, env = process.env) {
  const key = crypto.createHash('sha256').update(path.resolve(folder)).digest('hex').slice(0, 16);
  const dir = runDir(env);
  return {
    dir,
    file: path.join(dir, `serve-${key}.json`),
    stop: path.join(dir, `serve-${key}.stop`),
    log: path.join(dir, `serve-${key}.log`),
  };
}

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

// Removes the record only while it is still this server's: a newer server's record is left alone.
function clearRecord(rec, pid) {
  const r = readRecord(rec);
  if (!r || r.pid === pid) { try { fs.rmSync(rec.file, { force: true }); } catch { /* gone already */ } }
  try { fs.rmSync(rec.stop, { force: true }); } catch { /* gone already */ }
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

// The record of the server running for this folder, or null. A record whose server is gone is cleared; one whose
// server is only slow to answer is kept (and null returned), so a later --stop still finds it.
async function runningRecord(rec, deps = {}) {
  const r = readRecord(rec);
  if (!r) return null;
  const answer = (deps.pidAlive || pidAlive)(r.pid) ? await (deps.answersTo || answersTo)(r.port, r.id) : 'no';
  if (answer === 'yes') return r;
  if (answer === 'no') clearRecord(rec, r.pid);
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
      try { held = JSON.parse(fs.readFileSync(rec.file, 'utf8')); } catch { /* half written: someone is claiming */ }
      if (!held || !Number.isInteger(held.pid) || pidAlive(held.pid)) return false;
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
// closes every connection and exits), then, if it is still there after `graceMs`, by ending the process. Resolves
// { stopped: false } when nothing was running, else { stopped: true, pid, port, portFree }.
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
  fs.writeFileSync(rec.stop, `${Date.now()}\n`);
  // The pid answered to the record's id a moment ago and has not gone away since, so it is still the server.
  let stopped = await waitFor(gone, graceMs, 200);
  if (!stopped) {
    try { kill(r.pid, 'SIGTERM'); } catch { /* gone in between */ }
    stopped = await waitFor(gone, 3000, 200);
  }
  if (!stopped && alive(r.pid)) {
    try { kill(r.pid, 'SIGKILL'); } catch { /* gone in between */ }
    stopped = await waitFor(gone, 3000, 200);
  }
  if (stopped) clearRecord(rec, r.pid);
  const portIsFree = await waitFor(() => free(r.port), 3000, 200);
  return { stopped, pid: r.pid, port: r.port, portFree: portIsFree };
}

module.exports = {
  ID_PREFIX, runDir, recordFor, readRecord, writeRecord, clearRecord, claim, pidAlive, answersTo, runningRecord, portFree,
  waitFor, stopServer,
};
