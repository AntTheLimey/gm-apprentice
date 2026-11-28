'use strict';
const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { spawnSync } = require('node:child_process');
const { runTable, runFlushCapped, killTree, whoHolds, openBrowser, parseParty, STOP_SIGNALS } = require('../lib/run-sheet/table-cli');
const RS = require('../lib/run-sheet/web/state');
const { copyRecordFixture } = require('./helpers/record-fixture');
const { removeFixture } = require('./helpers/systems-fixture');

const FIXTURE = path.join(__dirname, 'fixtures', 'run-sheet-app');
const BIN = path.join(__dirname, '..', 'bin', 'gm-publish.js');
const S2 = 'Chapters/Chapter 1/Sessions/Session 02/Session 02 - The Test.md';
const S1 = 'Chapters/Chapter 1/Sessions/Session 01/Session 01 - The Start.md';

const made = [];
const handles = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-cli-'));
  made.push(d);
  return d;
};
const vaultCopy = () => {
  const d = tmp();
  fs.cpSync(FIXTURE, d, { recursive: true });
  return d;
};
after(async () => {
  for (const h of handles) await h.close();
  for (const d of made) fs.rmSync(d, { recursive: true, force: true });
});

// A deps bag that talks to nobody: no browser, no flush, no lsof.
function quiet(extra = {}) {
  const lines = [];
  const errs = [];
  const deps = {
    out: (l) => lines.push(l),
    err: (l) => errs.push(l),
    openBrowser: () => { deps.opened = (deps.opened || 0) + 1; },
    runFlushCapped: async () => { deps.flushed = (deps.flushed || 0) + 1; return { ok: true, why: null }; },
    proc: new EventEmitter(),
    exit: () => {},
    ...extra,
  };
  return { deps, lines, errs };
}
const freePort = () => new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});
async function start(opts, extra) {
  const q = quiet(extra);
  const port = await freePort();
  const h = await runTable({ port, open: false, ...opts }, q.deps);
  if (typeof h !== 'number') handles.push(h);
  return { h, port, ...q };
}
// A directory standing in for a site folder with the status bar deployed.
function addSite(vault) {
  const site = path.join(vault, 'Site');
  fs.mkdirSync(path.join(site, 'functions', 'api'), { recursive: true });
  fs.writeFileSync(path.join(site, 'functions', 'api', 'loadout.js'), '//');
  fs.writeFileSync(path.join(site, 'wrangler.toml'), 'name = "x"\n[[kv_namespaces]]\nbinding = "INBOX"\nid = "0123456789abcdef0123456789abcdef"\n');
  fs.writeFileSync(path.join(site, 'vault.config.json'), '{"vaultPath":".."}');
  const cfg = path.join(vault, '_meta', 'vault-config.yaml');
  fs.writeFileSync(cfg, fs.readFileSync(cfg, 'utf8').replace(/player_site:\r?\n/, 'player_site:\n  folder: Site\n'));
}

describe('gm-publish table: pick', () => {
  it('pick prints JSON and serves nothing', async () => {
    const vault = vaultCopy();
    const { deps, lines } = quiet();
    const port = await freePort();
    const rc = await runTable({ vault, pick: true, json: true, port }, deps);
    assert.strictEqual(rc, 0);
    assert.strictEqual(lines.length, 1);
    const got = JSON.parse(lines[0]);
    assert.strictEqual(got.ok, true);
    assert.strictEqual(got.index, S2);
    assert.ok(got.plan.endsWith('Session 02 - The Test - Plan.md'));
    assert.ok(got.tableLog.endsWith('Table Log.md'));
    assert.strictEqual(got.label, 'Session 2');
    assert.ok(/^chapter-1--session-02/.test(got.stateId));
    assert.deepStrictEqual(got.others, []);
    assert.strictEqual(deps.flushed, undefined);
    assert.strictEqual(deps.opened, undefined);
    assert.ok(!fs.existsSync(path.join(vault, '_meta', 'table', `${got.stateId}.json`)));
    // the port was let go
    await new Promise((resolve, reject) => { const s = net.createServer().listen(port, '127.0.0.1', () => s.close(resolve)).on('error', reject); });
  });

  it('pick refuses a wrapped-up session with exit 1', async () => {
    const { deps, lines } = quiet();
    const rc = await runTable({ vault: FIXTURE, session: S1, pick: true, json: true, port: await freePort() }, deps);
    assert.strictEqual(rc, 1);
    const got = JSON.parse(lines[0]);
    assert.strictEqual(got.ok, false);
    assert.match(got.error, /^Session 1 is wrapped up; its record is the Wrap-Up\.$/);
  });

  it('pick refuses a busy port and files nothing', async () => {
    const holder = net.createServer();
    await new Promise((r) => { holder.listen(0, '127.0.0.1', r); });
    const port = holder.address().port;
    try {
      const { deps, lines } = quiet({ whoHolds: async () => 'node (pid 4242)' });
      const rc = await runTable({ vault: FIXTURE, pick: true, json: true, port }, deps);
      assert.strictEqual(rc, 1);
      const got = JSON.parse(lines[0]);
      assert.strictEqual(got.ok, false);
      assert.strictEqual(got.error, `Port ${port} is busy: node (pid 4242) holds it. Stop it, or start this with --port <another>.`);
    } finally { await new Promise((r) => { holder.close(r); }); }
  });

  it('a missing vault is an error, not a throw', async () => {
    const { deps, lines } = quiet();
    const rc = await runTable({ vault: path.join(os.tmpdir(), 'rs-no-such-vault-xyz'), pick: true, json: true }, deps);
    assert.strictEqual(rc, 1);
    assert.strictEqual(JSON.parse(lines[0]).ok, false);
  });

  it('a name two sessions share is refused with the error text, without --json too', async () => {
    const { deps, lines, errs } = quiet();
    const rc = await runTable({ vault: FIXTURE, session: 'Nope Nothing', pick: true }, deps);
    assert.strictEqual(rc, 1);
    assert.strictEqual(lines.length, 0);
    assert.match(errs.join('\n'), /No session matches/);
  });
});

describe('gm-publish table: a session from the record', () => {
  it('the pick answer carries a record session', async () => {
    const vault = copyRecordFixture();
    after(() => removeFixture(vault));
    const { deps, lines } = quiet();
    const rc = await runTable({ vault, pick: true, json: true, port: await freePort() }, deps);
    assert.strictEqual(rc, 0);
    const got = JSON.parse(lines[0]);
    assert.strictEqual(got.ok, true);
    assert.strictEqual(got.index, null);
    assert.strictEqual(got.fromRecord, true);
    assert.strictEqual(got.number, 15);
    assert.strictEqual(got.chapter, 'Chapters/Chapter 3/Chapter 3.md');
    assert.strictEqual(got.plan, null);
    assert.strictEqual(got.label, 'Session 15');
    assert.strictEqual(got.stateId, 'chapter-3--session-15');
    assert.ok('after' in got && 'planVault' in got && 'playDate' in got);
    assert.deepStrictEqual(got.others, []);
    // the plain pick line does not print "null"
    const plain = quiet();
    assert.strictEqual(await runTable({ vault, pick: true, port: await freePort() }, plain.deps), 0);
    assert.ok(!plain.lines.join('\n').includes('null'), plain.lines.join('\n'));
  });

  it('a record session is served, not refused as an unreadable Plan', async () => {
    const vault = copyRecordFixture();
    after(() => removeFixture(vault));
    const seen = [];
    const fake = (opts) => {
      seen.push(opts);
      const http = require('node:http');
      const server = http.createServer((req, res) => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ model: { warnings: [] } }));
      });
      return { server, close: () => new Promise((r) => { server.close(r); server.closeAllConnections(); }) };
    };
    const { deps, lines, errs } = quiet({ createTableServer: fake });
    const h = await runTable({ vault, port: await freePort(), open: false, fileLog: { cmd: ['x'], takesTitle: true } }, deps);
    assert.notStrictEqual(typeof h, 'number', errs.join('\n'));
    handles.push(h);
    assert.ok(lines.join('\n').includes('Run sheet for'), lines.join('\n'));
    assert.ok(!errs.join('\n').includes('cannot be read'));
    assert.strictEqual(seen[0].session.fromRecord, true);
    assert.strictEqual(seen[0].stateId, 'chapter-3--session-15');
    assert.strictEqual(seen[0].stateFile, path.join(path.resolve(vault), '_meta', 'table', 'chapter-3--session-15.json'));
    assert.deepStrictEqual(seen[0].fileLog, { cmd: ['x'], takesTitle: true });
  });

  it('a record session not filed yet is served by the real server, with its own line, and filed on the first thing (Task 7)', async () => {
    const vault = copyRecordFixture();
    after(() => removeFixture(vault));
    const a = await start({ vault, fileLog: { cmd: ['gma-never-run'], takesTitle: true } });
    assert.ok(a.h && a.h.url, a.errs.join('\n'));
    const text = a.lines.join('\n');
    assert.ok(text.includes('Session 15 is not in the vault yet: it is filed with its Table Log on the first thing that happens at the table, so a look leaves nothing.'), text);
    assert.ok(!/No Table Log/.test(text), text);
    const body = await (await fetch(`${a.h.url}api/model`)).json();
    assert.strictEqual(body.session.fromRecord, true);
    assert.strictEqual(body.session.filed, false);
    assert.ok(body.model.record);

    const v2 = copyRecordFixture();
    after(() => removeFixture(v2));
    const b = await start({ vault: v2 });
    assert.ok(b.lines.join('\n').includes('Session 15 is not in the vault yet: start it with `gma table` to have it filed and the record written.'), b.lines.join('\n'));
  });

  // CodeRabbit #895: the array form files a Table Log for an index that exists; for a session not filed yet it would fail
  // on every action, so it is refused before anything is served.
  it('a session not filed yet refuses the array --file-log, before the flush', async () => {
    const vault = copyRecordFixture();
    after(() => removeFixture(vault));
    const a = await start({ vault, fileLog: ['gma-never-run'] });
    assert.strictEqual(a.h, 1, a.lines.join('\n'));
    assert.match(a.errs.join('\n'), /Session 15 is not in the vault yet/);
    assert.strictEqual(a.deps.flushed, undefined);
    assert.ok(!fs.existsSync(path.join(vault, '_meta', 'table')) || !fs.readdirSync(path.join(vault, '_meta', 'table')).some((n) => n.endsWith('.lock')));
    // --pick is not affected
    const pick = quiet();
    assert.strictEqual(await runTable({ vault, port: await freePort(), pick: true, json: true, fileLog: ['gma-never-run'] }, pick.deps), 0);
  });

  it('a record that cannot be read is refused in its own words (Task 7)', async () => {
    const vault = copyRecordFixture();
    after(() => removeFixture(vault));
    const { deps, errs } = quiet({ server: { readRecord: () => { throw new Error('the Wrap-Up is torn'); } } });
    const rc = await runTable({ vault, port: await freePort(), open: false }, deps);
    assert.strictEqual(rc, 1);
    assert.strictEqual(errs.join('\n'), 'The record for Session 15 cannot be read: the Wrap-Up is torn');
  });

  // CodeRabbit #895: a no-Plan sheet open for an unfiled session holds the number-named lock with no state saved yet. Prep
  // then files that session with a Plan; a second start finds the Plan-named state file, and must still find the first sheet.
  it('a sheet started once prep has filed a Plan still finds the no-Plan sheet open for that session', async () => {
    const vault = copyRecordFixture();
    after(() => removeFixture(vault));
    const a = await start({ vault, fileLog: { cmd: ['gma-never-run'], takesTitle: true } });
    assert.ok(a.h && a.h.url, a.errs.join('\n'));
    const dir = path.join(vault, 'Chapters', 'Chapter 3', 'Sessions', 'Session 15');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'Session 15 - Wickwork.md'), '---\ntype: session\nsession_number: 15\nchapter: "[[Chapter 3]]"\nstatus: planned\ndocuments:\n  plan: "[[Session 15 - Wickwork - Plan]]"\n---\n\n# Session 15 - Wickwork\n');
    fs.writeFileSync(path.join(dir, 'Session 15 - Wickwork - Plan.md'), '---\ntype: session-plan\nsession: "[[Session 15 - Wickwork]]"\nchapter: "[[Chapter 3]]"\n---\n\n## Session Intent\n\nWickwork.\n');
    const b = await start({ vault });
    assert.strictEqual(b.h, 1, b.lines.join('\n'));
    assert.match(b.errs.join('\n'), new RegExp(`already running \\(pid ${process.pid}, port ${a.port}`));
  });

  it('a state iCloud has taken is found under the number name (the lock and iCloud checks use stateFileFor)', async () => {
    const vault = copyRecordFixture();
    after(() => removeFixture(vault));
    const { deps, errs } = quiet({ inCloud: (f) => f.endsWith('chapter-3--session-15.json') });
    const rc = await runTable({ vault, port: await freePort(), open: false }, deps);
    assert.strictEqual(rc, 1);
    assert.match(errs.join('\n'), /iCloud/);
  });
});


describe('gm-publish table: serving', () => {
  it('serves, prints the address and Ctrl+C, and opens the browser unless told not to', async () => {
    const vault = vaultCopy();
    const a = await start({ vault });
    const text = a.lines.join('\n');
    assert.ok(text.includes(`Run sheet for Session 02 - The Test: http://127.0.0.1:${a.port}/`), text);
    assert.ok(text.includes('Ctrl+C to stop.'));
    assert.strictEqual(a.deps.opened, undefined);
    await a.h.close();

    const q = quiet();
    const port = await freePort();
    const h = await runTable({ vault, port, open: true }, q.deps);
    handles.push(h);
    assert.strictEqual(q.deps.opened, 1);
  });

  it('no --party serves with the no-party warning counted', async () => {
    // a Plan with no roster, and no --party: the sheet has no one to put on it
    const vault = vaultCopy();
    const planFile = path.join(vault, 'Chapters/Chapter 1/Sessions/Session 02/Session 02 - The Test - Plan.md');
    fs.writeFileSync(planFile, fs.readFileSync(planFile, 'utf8').replace(/^- \*\*\[\[(Ada Moss|Ben Hart)\]\]\*\*.*\r?\n/gm, ''));
    const a = await start({ vault });
    assert.match(a.lines.join('\n'), /\d+ prep notes? on the page/);
    const res = await fetch(`http://127.0.0.1:${a.port}/api/model`);
    const body = await res.json();
    assert.ok(body.model.warnings.some((w) => w.kind === 'no-party'));
  });

  it('no Table Log: warns and still serves', async () => {
    const vault = vaultCopy();
    fs.rmSync(path.join(vault, 'Chapters/Chapter 1/Sessions/Session 02/Session 02 - The Test - Table Log.md'));
    const a = await start({ vault });
    assert.match(a.lines.join('\n'), /No Table Log note yet/);
    assert.strictEqual((await fetch(`http://127.0.0.1:${a.port}/api/hello`)).status, 200);
  });

  it('a vault with no site folder skips flush, said once', async () => {
    const a = await start({ vault: vaultCopy() });
    assert.strictEqual(a.deps.flushed, undefined);
    assert.strictEqual(a.lines.filter((l) => /No site folder/.test(l)).length, 1);
  });

  it('a site with the status bar flushes first', async () => {
    const vault = vaultCopy();
    addSite(vault);
    const order = [];
    const a = await start({ vault }, {
      runFlushCapped: async (o) => { order.push(['flush', path.basename(o.configFile), o.timeoutMs]); return { ok: true, why: null }; },
      createTableServer: (...x) => { order.push(['server']); return require('../lib/run-sheet/server').createTableServer(...x); },
    });
    assert.deepStrictEqual(order, [['flush', 'vault.config.json', 20000], ['server']]);
    assert.ok(a.h.close);
  });

  it('a flush that throws warns and serves', async () => {
    const vault = vaultCopy();
    addSite(vault);
    const a = await start({ vault }, { runFlushCapped: async () => { throw new Error('wrangler is gone'); } });
    assert.ok(a.lines.concat(a.errs).includes('Flush failed (wrangler is gone): the sheet starts from the PC notes as they are.'), a.lines.concat(a.errs).join('\n'));
    assert.ok(typeof a.h.close === 'function');
  });

  it('a flush that returns 1 warns and serves', async () => {
    const vault = vaultCopy();
    addSite(vault);
    const a = await start({ vault }, { runFlushCapped: async () => ({ ok: false, why: 'exit 1' }) });
    assert.ok(a.lines.concat(a.errs).includes('Flush failed (exit 1): the sheet starts from the PC notes as they are.'));
    assert.ok(typeof a.h.close === 'function');
  });

  it('a flush past the cap is stopped, warns and serves', async () => {
    const vault = vaultCopy();
    addSite(vault);
    const sleeper = (cmd, args, opts) => require('node:child_process').spawn(process.execPath, ['-e', 'setTimeout(()=>{},60000)'], { ...opts, stdio: 'ignore' });
    const a = await start({ vault }, { runFlushCapped: (o) => runFlushCapped({ ...o, timeoutMs: 150, spawn: sleeper }) });
    assert.ok(a.lines.concat(a.errs).includes('Flush took over 20 s and was stopped: the sheet starts from the PC notes as they are.'));
    assert.ok(typeof a.h.close === 'function');
  });

  it('a busy port names the run sheet holding it', async () => {
    const vault = vaultCopy();
    const a = await start({ vault });
    const q = quiet();
    const rc = await runTable({ vault, port: a.port, open: false }, q.deps);
    assert.strictEqual(rc, 1);
    const msg = q.errs.join('\n');
    assert.ok(msg.startsWith(`Port ${a.port} is busy: the run sheet for Session 2 (pid ${process.pid}) holds it.`), msg);
    assert.ok(msg.includes('--port <another>'));
  });

  it('SIGINT flushes the store, then exits 0', async () => {
    const vault = vaultCopy();
    const codes = [];
    const a = await start({ vault, party: [] }, { exit: (c) => codes.push(c) });
    // a state of our own, still inside the debounce
    const got = await (await fetch(`http://127.0.0.1:${a.port}/api/state`)).json();
    const put = await fetch(`http://127.0.0.1:${a.port}/api/state`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stateId: got.stateId, base: got.rev, state: RS.reduce(got.state, { type: 'jot', id: 'c1-1', text: 'kept', beat: null }, '2026-11-20T20:00:00.000Z') }),
    });
    assert.strictEqual(put.status, 200);
    const file = path.join(vault, '_meta', 'table', `${got.stateId}.json`);
    a.deps.proc.emit('SIGINT');
    for (let i = 0; i < 100 && codes.length === 0; i++) await new Promise((r) => { setTimeout(r, 30); });
    assert.deepStrictEqual(codes, [0]);
    assert.ok(fs.existsSync(file));
    assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).rev, got.rev + 1);
    assert.strictEqual(a.deps.proc.listenerCount('SIGINT'), 0);
  });

  for (const sig of ['SIGHUP', 'SIGBREAK', 'SIGTERM']) {
    it(`${sig} saves and removes the lock (PR review M1)`, async () => {
      const vault = vaultCopy();
      const codes = [];
      const a = await start({ vault, party: [] }, { exit: (c) => codes.push(c) });
      const got = await (await fetch(`http://127.0.0.1:${a.port}/api/state`)).json();
      const put = await fetch(`http://127.0.0.1:${a.port}/api/state`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stateId: got.stateId, base: got.rev, state: RS.reduce(got.state, { type: 'jot', id: 'c1-1', text: 'kept', beat: null }, '2026-11-20T20:00:00.000Z') }),
      });
      assert.strictEqual(put.status, 200);
      const file = path.join(vault, '_meta', 'table', `${got.stateId}.json`);
      a.deps.proc.emit(sig);
      for (let i = 0; i < 100 && codes.length === 0; i++) await new Promise((r) => { setTimeout(r, 30); });
      assert.deepStrictEqual(codes, [0]);
      assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).rev, got.rev + 1);
      assert.ok(!fs.existsSync(path.join(vault, '_meta', 'table', `${got.stateId}.lock`)), 'the lock is gone');
      for (const s2 of STOP_SIGNALS) assert.strictEqual(a.deps.proc.listenerCount(s2), 0);
    });
  }
});

describe('gm-publish table: one server per session (third review L4)', () => {
  it('a second run sheet for the same session, on another port, is refused naming the first', async () => {
    const vault = vaultCopy();
    const a = await start({ vault });
    const lock = JSON.parse(fs.readFileSync(path.join(vault, '_meta', 'table', `${a.h.app.stateId}.lock`), 'utf8'));
    assert.deepStrictEqual(lock, { pid: process.pid, port: a.port });
    const before = fs.readdirSync(path.join(vault, '_meta', 'table')).sort();
    const b = await start({ vault });
    assert.strictEqual(b.h, 1);
    assert.strictEqual(b.errs.join('\n'), `The run sheet for Session 2 is already running (pid ${process.pid}, port ${a.port}: http://127.0.0.1:${a.port}/). Use that one, or stop it first.`);
    assert.strictEqual(b.deps.flushed, undefined, 'refused before the flush');
    assert.deepStrictEqual(fs.readdirSync(path.join(vault, '_meta', 'table')).sort(), before);
    const pick = quiet();
    assert.strictEqual(await runTable({ vault, port: await freePort(), open: false, pick: true, json: true }, pick.deps), 1);
    assert.match(JSON.parse(pick.lines[0]).error, /already running/);
  });

  it('a lock whose port does not answer is taken over', async () => {
    const vault = vaultCopy();
    const dir = path.join(vault, '_meta', 'table');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'chapter-1--session-02-the-test.lock'), JSON.stringify({ pid: 999999, port: 4322 }));
    const a = await start({ vault }, { hello: async () => null });
    assert.strictEqual(typeof a.h, 'object', a.errs.join('\n'));
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'chapter-1--session-02-the-test.lock'), 'utf8')), { pid: process.pid, port: a.port });
    assert.ok(a.h.app.store.unclean);
  });

  it('a lock whose pid is alive as another program is taken over (PR review M2)', async () => {
    const vault = vaultCopy();
    const dir = path.join(vault, '_meta', 'table');
    fs.mkdirSync(dir, { recursive: true });
    // this test's own pid is alive; the port it names answers as something that is not the run sheet
    const other = require('node:http').createServer((req, res) => { res.end('{"app":"something else"}'); });
    await new Promise((r) => { other.listen(0, '127.0.0.1', r); });
    try {
      fs.writeFileSync(path.join(dir, 'chapter-1--session-02-the-test.lock'), JSON.stringify({ pid: process.pid, port: other.address().port }));
      const a = await start({ vault });
      assert.strictEqual(typeof a.h, 'object', a.errs.join('\n'));
      assert.ok(a.h.app.store.unclean);
    } finally { other.close(); }
  });

  it('a lock with no port under a minute old is refused; an older one is taken over', async () => {
    const vault = vaultCopy();
    const dir = path.join(vault, '_meta', 'table');
    const lock = path.join(dir, 'chapter-1--session-02-the-test.lock');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(lock, JSON.stringify({ pid: 4242, port: null }));
    const b = await start({ vault });
    assert.strictEqual(b.h, 1);
    assert.strictEqual(b.errs.join('\n'), 'The run sheet for Session 2 is already running (pid 4242). Use that one, or stop it first.');
    const t = (Date.now() - 2 * 60 * 1000) / 1000;
    fs.utimesSync(lock, t, t);
    const c = await start({ vault });
    assert.strictEqual(typeof c.h, 'object', c.errs.join('\n'));
  });

  it('a saved state iCloud has taken off this computer refuses to start, and nothing is written (PR review L1)', async () => {
    const vault = vaultCopy();
    const dir = path.join(vault, '_meta', 'table');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '.chapter-1--session-02-the-test.json.icloud'), 'bplist');
    const before = fs.readdirSync(dir).sort();
    const a = await start({ vault });
    assert.strictEqual(a.h, 1);
    assert.strictEqual(a.errs.join('\n'), 'The saved run sheet for Session 2 is in iCloud, not on this computer (_meta/table/chapter-1--session-02-the-test.json). Download it first (in Finder: Download Now), then start again.');
    assert.deepStrictEqual(fs.readdirSync(dir).sort(), before, 'no lock, no fresh state');
    const pick = quiet();
    assert.strictEqual(await runTable({ vault, port: await freePort(), open: false, pick: true, json: true }, pick.deps), 1, 'refused at the pick, before anything is filed');
    assert.match(JSON.parse(pick.lines[0]).error, /in iCloud/);
  });

  it('Ctrl+C that cannot save says so and exits 1', async () => {
    const vault = vaultCopy();
    const codes = [];
    let stuck = false;
    const flaky = { ...fs, renameSync: (x, y) => { if (stuck && y.endsWith('.json')) { const e = new Error('EPERM: operation not permitted'); e.code = 'EPERM'; throw e; } return fs.renameSync(x, y); } };
    const a = await start({ vault, party: [] }, { exit: (c) => codes.push(c), server: { fs: flaky, delayMs: 10000, retryMs: [10000], log: () => {} } });
    handles.splice(handles.indexOf(a.h), 1); // its close rejects: this test ends it
    const got = await (await fetch(`http://127.0.0.1:${a.port}/api/state`)).json();
    const put = await fetch(`http://127.0.0.1:${a.port}/api/state`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stateId: got.stateId, base: got.rev, state: RS.reduce(got.state, { type: 'jot', id: 'c1-1', text: 'lost', beat: null }, '2026-11-20T20:00:00.000Z') }),
    });
    assert.strictEqual(put.status, 200);
    stuck = true;
    a.deps.proc.emit('SIGINT');
    for (let i = 0; i < 100 && codes.length === 0; i++) await new Promise((r) => { setTimeout(r, 30); });
    assert.deepStrictEqual(codes, [1]);
    assert.match(a.errs.join('\n'), /^Could not save the sheet's state on the way out: EPERM: operation not permitted$/m);
  });
});

describe('gm-publish table: the --party flag', () => {
  it('reads PC paths, a JSON array, and a JSON file', () => {
    const d = tmp();
    const f = path.join(d, 'party.json');
    fs.writeFileSync(f, '["B.md","C.md"]');
    assert.deepStrictEqual(parseParty(['A.md', '["D.md"]', f]), { party: ['A.md', 'D.md', 'B.md', 'C.md'] });
    assert.match(parseParty(['[nope']).error, /--party/);
    assert.match(parseParty([path.join(d, 'gone.json')]).error, /--party/);
  });
});

describe('whoHolds', () => {
  const noHello = async () => null;
  it('names another process from lsof -F output', async () => {
    const run = async (cmd) => { assert.strictEqual(cmd, 'lsof'); return 'p4242\ncnode\n'; };
    assert.strictEqual(await whoHolds(1, { platform: 'darwin', run, hello: noHello }), 'node (pid 4242)');
  });
  it('falls back to ss on linux without lsof', async () => {
    const run = async (cmd) => {
      if (cmd === 'lsof') throw new Error('ENOENT');
      return 'LISTEN 0 511 127.0.0.1:4322 0.0.0.0:* users:(("nginx",pid=77,fd=6))\n';
    };
    assert.strictEqual(await whoHolds(4322, { platform: 'linux', run, hello: noHello }), 'nginx (pid 77)');
  });
  it('windows netstat and tasklist parse, CRLF and all', async () => {
    const run = async (cmd) => {
      if (cmd === 'netstat') {
        return '\r\nActive Connections\r\n\r\n  Proto  Local Address          Foreign Address        State           PID\r\n'
          + '  TCP    0.0.0.0:43220          0.0.0.0:0              LISTENING       999\r\n'
          + '  TCP    127.0.0.1:4322         0.0.0.0:0              LISTENING       4242\r\n';
      }
      assert.strictEqual(cmd, 'tasklist');
      return '"node.exe","4242","Console","1","50,000 K"\r\n';
    };
    assert.strictEqual(await whoHolds(4322, { platform: 'win32', run, hello: noHello }), 'node.exe (pid 4242)');
  });
  it('unknown holder gives null, which the message says as "something else"', async () => {
    assert.strictEqual(await whoHolds(1, { platform: 'darwin', run: async () => '', hello: noHello }), null);
    assert.strictEqual(await whoHolds(1, { platform: 'darwin', run: async () => { throw new Error('x'); }, hello: noHello }), null);
    const holder = net.createServer();
    await new Promise((r) => { holder.listen(0, '127.0.0.1', r); });
    try {
      const { deps, errs } = quiet({ whoHolds: async () => null });
      const rc = await runTable({ vault: FIXTURE, port: holder.address().port, open: false }, deps);
      assert.strictEqual(rc, 1);
      assert.ok(errs[0].includes('something else holds it.'), errs[0]);
    } finally { await new Promise((r) => { holder.close(r); }); }
  });
});

describe('runFlushCapped and openBrowser', () => {
  it('a clean exit is ok, a non-zero exit is not', async () => {
    const mk = (code) => () => require('node:child_process').spawn(process.execPath, ['-e', `process.exit(${code})`], { stdio: 'ignore' });
    assert.deepStrictEqual(await runFlushCapped({ configFile: 'x', timeoutMs: 5000, spawn: mk(0) }), { ok: true, why: null });
    assert.deepStrictEqual(await runFlushCapped({ configFile: 'x', timeoutMs: 5000, spawn: mk(3) }), { ok: false, why: 'exit 3' });
  });
  it('a flush past the cap is stopped with all it started (PR review L6)', async () => {
    const fake = () => { const c = new EventEmitter(); c.pid = 4321; c.kill = () => { c.killed = true; }; return c; };
    let child;
    const kills = [];
    // the group goes at the signal: the flush is waited for until it has closed
    const r = await runFlushCapped({ configFile: 'x', timeoutMs: 20, platform: 'darwin', spawn: (cmd, args, opts) => { child = fake(); child.opts = opts; return child; }, kill: (pid, sig) => { kills.push([pid, sig]); child.emit('close', null, sig); } });
    assert.deepStrictEqual(r, { ok: false, why: 'timeout' });
    assert.strictEqual(child.opts.detached, true, 'its own process group');
    assert.deepStrictEqual(kills, [[-4321, 'SIGTERM']], 'the whole group');
    const runs = [];
    const w = await runFlushCapped({ configFile: 'x', timeoutMs: 20, platform: 'win32', spawn: (cmd, args, opts) => { child = fake(); child.opts = opts; return child; }, spawnSync: (cmd, args) => { runs.push([cmd, ...args]); child.emit('close', 1, null); } });
    assert.deepStrictEqual(w, { ok: false, why: 'timeout' });
    assert.strictEqual(child.opts.detached, false);
    assert.deepStrictEqual(runs, [['taskkill', '/T', '/F', '/PID', '4321']]);
  });

  it('a flush that does not end at the signal is killed outright after the grace, and only then does the sheet start', async () => {
    const c = new EventEmitter(); c.pid = 4321; c.kill = () => {};
    const kills = [];
    const t0 = Date.now();
    const r = await runFlushCapped({ configFile: 'x', timeoutMs: 20, graceMs: 120, platform: 'darwin', spawn: () => c, kill: (pid, sig) => kills.push([pid, sig]) });
    assert.deepStrictEqual(r, { ok: false, why: 'timeout' });
    assert.deepStrictEqual(kills, [[-4321, 'SIGTERM'], [-4321, 'SIGKILL']]);
    assert.ok(Date.now() - t0 >= 130, 'the grace was waited out');
  });

  it('a real flush and the child it started are both stopped at the cap', async () => {
    if (process.platform === 'win32') return;
    const d = tmp();
    const pidFile = path.join(d, 'grandchild.pid');
    // the flush stand-in starts a grandchild (as flush starts wrangler) and both sleep
    const code = `const c = require('child_process').spawn(process.execPath, ['-e', 'setTimeout(()=>{},60000)'], { stdio: 'ignore' }); require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(c.pid)); setTimeout(()=>{},60000);`;
    const spawn = (cmd, args, opts) => require('node:child_process').spawn(process.execPath, ['-e', code], { ...opts, stdio: 'ignore' });
    // the cap leaves a loaded runner time to start node twice and write the pid file
    const r = await runFlushCapped({ configFile: 'x', timeoutMs: 3000, spawn });
    assert.deepStrictEqual(r, { ok: false, why: 'timeout' });
    assert.ok(fs.existsSync(pidFile), 'the stand-in started its grandchild before the cap');
    const gpid = Number(fs.readFileSync(pidFile, 'utf8'));
    // Linux: a grandchild that has exited but is not yet reaped (a zombie) answers kill 0; it is gone
    const zombie = (pid) => { try { return /^\d+ \(.*\) Z/.test(fs.readFileSync(`/proc/${pid}/stat`, 'utf8')); } catch { return false; } };
    let alive = true;
    for (let i = 0; i < 50 && alive; i++) {
      try { process.kill(gpid, 0); if (zombie(gpid)) alive = false; else await new Promise((res) => { setTimeout(res, 40); }); } catch { alive = false; }
    }
    assert.strictEqual(alive, false, 'the grandchild is gone too');
  });

  it('a stop signal during the flush ends the flush and this process', async () => {
    const proc = new EventEmitter();
    const codes = [];
    const kills = [];
    const c = new EventEmitter(); c.pid = 777; c.kill = () => {};
    const p = runFlushCapped({ configFile: 'x', timeoutMs: 5000, platform: 'linux', spawn: () => c, kill: (pid, sig) => kills.push([pid, sig]), proc, exit: (n) => codes.push(n) });
    proc.emit('SIGHUP');
    assert.deepStrictEqual(await p, { ok: false, why: 'stopped' });
    assert.deepStrictEqual(kills, [[-777, 'SIGTERM']]);
    assert.deepStrictEqual(codes, [130]);
    for (const sig of STOP_SIGNALS) assert.strictEqual(proc.listenerCount(sig), 0);
  });

  it('killTree on a child with no pid does nothing', () => {
    assert.doesNotThrow(() => killTree({}, { kill: () => { throw new Error('asked'); } }));
  });

  it('a spawn that fails is a why, not a throw', async () => {
    const r = await runFlushCapped({ configFile: 'x', timeoutMs: 5000, spawn: () => { throw new Error('no node'); } });
    assert.strictEqual(r.ok, false);
    assert.match(r.why, /no node/);
  });
  it('runs the flush subcommand of this tool', async () => {
    let seen;
    const spawn = (cmd, args) => { seen = { cmd, args }; return require('node:child_process').spawn(process.execPath, ['-e', ''], { stdio: 'ignore' }); };
    await runFlushCapped({ configFile: '/x/vault.config.json', timeoutMs: 5000, spawn });
    assert.strictEqual(seen.cmd, process.execPath);
    assert.deepStrictEqual(seen.args.slice(1), ['flush', '--config', '/x/vault.config.json']);
    assert.ok(seen.args[0].endsWith(path.join('bin', 'gm-publish.js')));
  });
  it('opens with the platform opener, detached; a failure is silent', () => {
    for (const [platform, cmd, args] of [['darwin', 'open', ['http://x/']], ['win32', 'cmd', ['/c', 'start', '', 'http://x/']], ['linux', 'xdg-open', ['http://x/']]]) {
      let seen;
      const child = new EventEmitter();
      child.unref = () => {};
      openBrowser('http://x/', { platform, spawn: (c, a, o) => { seen = { c, a, o }; return child; } });
      assert.strictEqual(seen.c, cmd);
      assert.deepStrictEqual(seen.a, args);
      assert.strictEqual(seen.o.detached, true);
      child.emit('error', new Error('no opener'));
    }
    assert.doesNotThrow(() => openBrowser('http://x/', { platform: 'linux', spawn: () => { throw new Error('boom'); } }));
  });
});

describe('the table command line', () => {
  it('--help prints SUBCOMMAND_HELP.table', () => {
    const r = spawnSync(process.execPath, [BIN, 'table', '--help'], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0);
    assert.match(r.stdout, /gm-apprentice-publish table <vault>/);
    assert.match(r.stdout, /--no-open/);
    assert.match(r.stdout, /--pick/);
  });
  it('--pick --json works end to end and serves nothing', () => {
    const r = spawnSync(process.execPath, [BIN, 'table', FIXTURE, '--pick', '--json', '--port', '0'], { encoding: 'utf8', timeout: 30000 });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(JSON.parse(r.stdout).index, S2);
  });
  it('--file-log takes the array or the { cmd, takesTitle } object, and nothing else', () => {
    const run = (v) => spawnSync(process.execPath, [BIN, 'table', FIXTURE, '--pick', '--json', '--port', '0', '--file-log', v], { encoding: 'utf8', timeout: 30000 });
    assert.strictEqual(run('["a","b"]').status, 0);
    assert.strictEqual(run('{"cmd":["a"],"takesTitle":true}').status, 0);
    for (const bad of ['{"cmd":"a","takesTitle":true}', '{"cmd":["a"]}', '[]', '3', 'nope']) {
      const r = run(bad);
      assert.strictEqual(r.status, 1, bad);
      assert.match(r.stderr, /--file-log needs/);
    }
  });
  it('no vault is a usage error', () => {
    const r = spawnSync(process.execPath, [BIN, 'table'], { encoding: 'utf8' });
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /vault/);
  });
  it('an unknown flag is refused', () => {
    const r = spawnSync(process.execPath, [BIN, 'table', FIXTURE, '--bogus'], { encoding: 'utf8' });
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /--bogus/);
  });
});
