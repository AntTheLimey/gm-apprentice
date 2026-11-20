'use strict';
const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { spawnSync } = require('node:child_process');
const { runTable, runFlushCapped, whoHolds, openBrowser, parseParty } = require('../lib/run-sheet/table-cli');

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
  fs.writeFileSync(cfg, fs.readFileSync(cfg, 'utf8').replace('player_site:\n', 'player_site:\n  folder: Site\n'));
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
    assert.match(got.error, /^Session 1 is wrapped up; its record is the Table Log note\.$/);
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
    const a = await start({ vault: vaultCopy() });
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
      body: JSON.stringify({ stateId: got.stateId, base: got.rev, state: { ...got.state, jots: { x: 'kept' } } }),
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
