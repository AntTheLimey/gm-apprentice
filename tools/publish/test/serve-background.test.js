'use strict';
// tools/publish/test/serve-background.test.js — #883: a served site keeps running until asked to stop, whatever
// happens to the terminal or session that started it, and a stop really stops it.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { runServe } = require('../lib/serve');
const records = require('../lib/serve-record');
const { buildBoth } = require('./helpers/gm-build');

const BIN = path.join(__dirname, '..', 'bin', 'gm-publish.js');

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '0.0.0.0', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

function get(port, agent) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/', agent, timeout: 3000 }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('timeout', () => { req.destroy(); resolve(0); });
    req.on('error', () => resolve(0));
  });
}

describe('serve --background, --status and --stop (#883)', () => {
  let built; let runDir; let env; let port;
  const cli = (...args) => spawnSync(process.execPath, [BIN, 'serve', ...args, '--config', built.configPath],
    { env, encoding: 'utf8', timeout: 60000 });

  before(async () => {
    built = buildBoth({ 'NPCs/Ann.md': '# Ann\n' });
    runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-run-'));
    env = { ...process.env, GM_APPRENTICE_RUN_DIR: runDir };
    port = await freePort();
  });
  after(() => {
    spawnSync(process.execPath, [BIN, 'serve', '--stop', '--config', built.configPath], { env, timeout: 60000 });
    built.cleanup();
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it('starts apart from its terminal, reports itself, and stops with every connection closed', async () => {
    const started = cli('--background', '--port', String(port));
    assert.equal(started.status, 0, started.stderr);
    const pid = Number(/in the background \(pid (\d+)\)/.exec(started.stdout)?.[1]);
    assert.ok(pid > 0, started.stdout);
    assert.match(started.stdout, new RegExp(`http://localhost:${port}/`));
    assert.match(started.stdout, /keeps running when this terminal or session closes, until serve --stop/);
    // The command has returned; the server answers on its own.
    assert.equal(await get(port), 200);

    const again = cli('--background', '--port', String(port));
    assert.equal(again.status, 0, again.stderr);
    assert.match(again.stdout, new RegExp(`already being served \\(pid ${pid}, in the background\\)`));

    const status = cli('--status');
    assert.equal(status.status, 0, status.stderr);
    assert.match(status.stdout, new RegExp(`is being served \\(pid ${pid}, since .*, in the background until serve --stop\\)`));

    // A tablet keeps its connection open; the stop must not wait on it.
    const agent = new http.Agent({ keepAlive: true });
    assert.equal(await get(port, agent), 200);
    const stopped = cli('--stop');
    agent.destroy();
    assert.equal(stopped.status, 0, stopped.stderr);
    assert.match(stopped.stdout, new RegExp(`Stopped the GM site server \\(pid ${pid}\\)\\. Port ${port} is free\\.`));
    assert.equal(records.pidAlive(pid), false);
    assert.equal(await get(port), 0);
    assert.deepEqual(fs.readdirSync(runDir).filter((f) => f.endsWith('.json') || f.endsWith('.stop')), []);

    const none = cli('--stop');
    assert.equal(none.status, 0, none.stderr);
    assert.match(none.stdout, /not being served: nothing to stop/);
    assert.match(cli('--status').stdout, /The GM site is not being served\./);
  });

  it('keeps running when whatever started it is killed with its whole process group', { skip: process.platform === 'win32' && 'process groups are POSIX' }, async () => {
    // An agent's command limit ends the shell and everything in its group: the server is not in it.
    const shell = spawn('/bin/sh', ['-c', `"${process.execPath}" "${BIN}" serve --background --port ${port} --config "${built.configPath}"; sleep 60`],
      { env, detached: true, stdio: 'ignore' });
    try {
      assert.ok(await records.waitFor(async () => (await get(port)) === 200, 20000, 200), 'the server never answered');
      process.kill(-shell.pid, 'SIGKILL');
      await records.waitFor(() => !records.pidAlive(shell.pid), 5000);
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(await get(port), 200);
    } finally {
      try { process.kill(-shell.pid, 'SIGKILL'); } catch { /* gone */ }
      const stopped = cli('--stop');
      assert.match(stopped.stdout, /Stopped the GM site server/);
    }
  });

  it('never takes a server in a terminal or task for a lasting one, and stops it too', async () => {
    const plain = spawn(process.execPath, [BIN, 'serve', '--port', String(port), '--config', built.configPath], { env, stdio: 'ignore' });
    try {
      assert.ok(await records.waitFor(async () => (await get(port)) === 200, 20000, 200), 'the server never answered');
      const bg = cli('--background', '--port', String(port));
      assert.equal(bg.status, 1);
      assert.match(bg.stderr, new RegExp(`already being served \\(pid ${plain.pid}, from a terminal or task\\).*It stops when that terminal or task ends: stop it with serve --stop, then start it again with serve --background\\.`));
      assert.match(cli('--status').stdout, /from a terminal or task: it stops when that ends/);
      const exited = new Promise((r) => plain.once('exit', (code) => r(code)));
      const stopped = cli('--stop');
      assert.equal(stopped.status, 0, stopped.stderr);
      assert.match(stopped.stdout, new RegExp(`Stopped the GM site server \\(pid ${plain.pid}\\)\\. Port ${port} is free\\.`));
      assert.equal(await exited, 0);
    } finally { try { plain.kill('SIGKILL'); } catch { /* gone */ } }
  });

  it('two starts at once give one server, and both say where it is', async () => {
    const start = () => new Promise((resolve) => {
      const c = spawn(process.execPath, [BIN, 'serve', '--background', '--port', String(port), '--config', built.configPath], { env });
      let text = '';
      c.stdout.on('data', (d) => { text += d; });
      c.stderr.on('data', (d) => { text += d; });
      c.on('close', (code) => resolve({ code, text }));
    });
    try {
      const [a, b] = await Promise.all([start(), start()]);
      assert.equal(a.code, 0, a.text);
      assert.equal(b.code, 0, b.text);
      const pids = [a, b].map((r) => /\(pid (\d+)/.exec(r.text)?.[1]);
      assert.ok(pids[0] && pids[1], `${a.text}\n${b.text}`);
      assert.equal(pids[0], pids[1], `${a.text}\n${b.text}`);
      assert.equal(await get(port), 200);
    } finally {
      assert.match(cli('--stop').stdout, /Stopped the GM site server/);
    }
  });

  it('refuses --port with --status or --stop, and two modes at once', () => {
    const withPort = cli('--status', '--port', '4000');
    assert.equal(withPort.status, 1);
    assert.match(withPort.stderr, /--status finds the server by its site, so it takes no --port/);
    const two = cli('--stop', '--background');
    assert.equal(two.status, 1);
    assert.match(two.stderr, /give one of --background, --status and --stop/);
  });
});

describe('serve records', () => {
  it('a server that ended but is not yet reaped counts as stopped, and is not signalled', async () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-run-'));
    const rec = records.recordFor('/some/site-gm', { GM_APPRENTICE_RUN_DIR: runDir });
    records.writeRecord(rec, { pid: 424243, port: 1, id: 'x', urls: [], site: 'gm', folder: '/some/site-gm' });
    let answering = true;
    const signals = [];
    try {
      const res = await records.stopServer(rec, {
        pidAlive: () => true, // a zombie still looks alive
        answersTo: async () => { const a = answering ? 'yes' : 'no'; answering = false; return a; },
        portFree: async () => true,
        graceMs: 1000,
        kill: (pid, sig) => signals.push(sig),
      });
      assert.deepEqual(res, { stopped: true, pid: 424243, port: 1, portFree: true, answering: true });
      assert.deepEqual(signals, []);
    } finally { fs.rmSync(runDir, { recursive: true, force: true }); }
  });


  it('a server in a terminal stops on a stop request and removes its record', async () => {
    const built = buildBoth({ 'NPCs/Ann.md': '# Ann\n' });
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-run-'));
    const env = { GM_APPRENTICE_RUN_DIR: runDir };
    const listen = (server) => new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const proc = new (require('node:events').EventEmitter)();
    proc.pid = process.pid;
    let result;
    try {
      result = await runServe({ configPath: built.configPath, site: 'gm', keepRecord: true },
        { out: () => {}, listen, env, proc, stopPollMs: 50 });
      const rec = records.recordFor(built.gm.dir, env);
      const record = records.readRecord(rec);
      assert.equal(record.pid, process.pid);
      assert.equal(record.port, result.server.address().port);
      assert.equal(await records.answersTo(record.port, record.id), 'yes');
      assert.equal(await records.answersTo(record.port, 'not-its-id'), 'no');
      // A second server for the same folder is refused while the first runs.
      await assert.rejects(runServe({ configPath: built.configPath, site: 'gm', keepRecord: true }, { out: () => {}, listen, env, proc }),
        /already being served .*Stop it first with serve --stop\./);
      // A stop request for another server is not this one's.
      fs.writeFileSync(records.stopFile(rec, 'another-server'), 'now');
      await new Promise((r) => setTimeout(r, 200));
      assert.equal(result.server.listening, true);
      fs.writeFileSync(records.stopFile(rec, result.id), 'now');
      await result.closed;
      assert.equal(result.server.listening, false);
      assert.equal(fs.existsSync(rec.file), false);
      assert.equal(fs.existsSync(records.stopFile(rec, result.id)), false);
    } finally {
      // A failed assertion must not leave the server holding this test process open: the managed stop.
      if (result && result.server.listening) {
        fs.writeFileSync(records.stopFile(records.recordFor(built.gm.dir, env), result.id), 'now');
        await result.closed;
      }
      built.cleanup();
      fs.rmSync(runDir, { recursive: true, force: true });
    }
  });

  it('a record left by a restart, whose pid now belongs to another program, is cleared and that program is never stopped', async () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-run-'));
    const env = { GM_APPRENTICE_RUN_DIR: runDir };
    const rec = records.recordFor('/some/site-gm', env);
    // This test's own pid: alive, but it answers to no id on that port.
    records.writeRecord(rec, { pid: process.pid, port: await freePort(), id: 'old', urls: [], site: 'gm', folder: '/some/site-gm' });
    const killed = [];
    try {
      assert.equal(await records.runningRecord(rec), null);
      assert.equal(fs.existsSync(rec.file), false);
      records.writeRecord(rec, { pid: process.pid, port: await freePort(), id: 'old', urls: [], site: 'gm', folder: '/some/site-gm' });
      const res = await records.stopServer(rec, { kill: (pid, sig) => killed.push([pid, sig]) });
      assert.deepEqual(res, { stopped: false });
      assert.deepEqual(killed, []);
    } finally {
      fs.rmSync(runDir, { recursive: true, force: true });
    }
  });

  it('a process that stops answering is never signalled, and is reported as not answering', async () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-run-'));
    const rec = records.recordFor('/some/site-gm', { GM_APPRENTICE_RUN_DIR: runDir });
    records.writeRecord(rec, { pid: 424244, port: 1, id: 'x', urls: [], site: 'gm', folder: '/some/site-gm' });
    const signals = [];
    try {
      // Busy at first (no answer in time), then a reused pid on a port someone else holds: never confirmed.
      let calls = 0;
      const res = await records.stopServer(rec, {
        pidAlive: () => true,
        answersTo: async () => (calls++ === 0 ? 'slow' : 'no'),
        portFree: async () => false,
        graceMs: 100,
        kill: (pid, sig) => signals.push(sig),
      });
      assert.deepEqual(signals, []);
      assert.equal(res.stopped, false);
      assert.equal(res.answering, false);
    } finally { fs.rmSync(runDir, { recursive: true, force: true }); }
  });

  it('a folder named through a link has the same record as the folder', { skip: process.platform === 'win32' && 'links need rights on Windows' }, () => {
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'serve-link-')));
    try {
      fs.mkdirSync(path.join(base, 'site-gm'));
      fs.symlinkSync(path.join(base, 'site-gm'), path.join(base, 'linked'));
      const env = { GM_APPRENTICE_RUN_DIR: base };
      assert.equal(records.recordFor(path.join(base, 'linked'), env).file, records.recordFor(path.join(base, 'site-gm'), env).file);
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });

  it('a claim left unreadable by a start that died is taken over after 10 s, not before', () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-run-'));
    const rec = records.recordFor('/some/site-gm', { GM_APPRENTICE_RUN_DIR: runDir });
    try {
      fs.writeFileSync(rec.file, '');
      assert.equal(records.claim(rec, process.pid), false);
      const old = new Date(Date.now() - 20000);
      fs.utimesSync(rec.file, old, old);
      assert.equal(records.claim(rec, process.pid), true);
    } finally { fs.rmSync(runDir, { recursive: true, force: true }); }
  });

  it('a server that ignores the stop request is ended', async () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-run-'));
    const env = { GM_APPRENTICE_RUN_DIR: runDir };
    const rec = records.recordFor('/some/site-gm', env);
    records.writeRecord(rec, { pid: 424242, port: 1, id: 'x', urls: [], site: 'gm', folder: '/some/site-gm' });
    let alive = true;
    const signals = [];
    try {
      const res = await records.stopServer(rec, {
        pidAlive: () => alive,
        answersTo: async () => (alive ? 'yes' : 'no'),
        portFree: async () => true,
        graceMs: 100,
        kill: (pid, sig) => { signals.push(sig); if (sig === 'SIGTERM') alive = false; },
      });
      assert.deepEqual(signals, ['SIGTERM']);
      assert.deepEqual(res, { stopped: true, pid: 424242, port: 1, portFree: true, answering: true });
      assert.equal(fs.existsSync(rec.file), false);
    } finally {
      fs.rmSync(runDir, { recursive: true, force: true });
    }
  });
});
