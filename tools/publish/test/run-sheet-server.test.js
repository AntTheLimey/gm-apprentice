'use strict';
const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { createTableServer, listenLocal } = require('../lib/run-sheet/server');
const { listSessions, pickSession, stateIdOf } = require('../lib/run-sheet/sessions');
const RS = require('../lib/run-sheet/web/state');

const FIXTURE = path.join(__dirname, 'fixtures', 'run-sheet-app');
const BENCHMARK = path.join(__dirname, '..', '..', '..', 'tests', 'benchmark-campaign');
const WEB = path.join(__dirname, '..', 'lib', 'run-sheet', 'web');
const S2 = 'Chapters/Chapter 1/Sessions/Session 02/';
const LOG = `${S2}Session 02 - The Test - Table Log.md`;
const PLAN = `${S2}Session 02 - The Test - Plan.md`;
const ASH = 'Characters/NPCs/Brother Ash.md';

const made = [];
const servers = [];
const tmp = (prefix = 'rs-server-') => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.push(d);
  return d;
};
const copyOf = (src = FIXTURE) => {
  const d = tmp();
  fs.cpSync(src, d, { recursive: true });
  return d;
};
after(async () => {
  for (const s of servers) await s.close();
  for (const d of made) fs.rmSync(d, { recursive: true, force: true });
});

const wait = (ms) => new Promise((r) => { setTimeout(r, ms); });
async function waitFor(fn, ms = 3000) {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('timed out waiting');
    await wait(10);
  }
}

async function start(vault, asked = 'Session 02 - The Test', { party = [], deps = {} } = {}) {
  const picked = pickSession(listSessions(vault), asked, vault);
  assert.ok(picked.session, picked.error);
  const t = createTableServer({ vaultPath: vault, session: picked.session, party, deps: { delayMs: 20, retryMs: [20], ...deps } });
  const port = await listenLocal(t.server, 0);
  const run = { ...t, port, session: picked.session, stateId: stateIdOf(picked.session) };
  servers.push(run);
  return run;
}

function req(port, method, url, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body));
    const h = { Host: `127.0.0.1:${port}`, ...headers };
    if (data !== undefined && !Object.keys(h).some((k) => k.toLowerCase() === 'content-type')) h['Content-Type'] = 'application/json';
    const r = http.request({ host: '127.0.0.1', port, method, path: url, headers: h }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* not json */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    r.on('error', reject);
    if (data !== undefined) r.write(data);
    r.end();
  });
}

// An SSE client: `events` fills as they arrive; `close()` ends it.
function listen(port) {
  const events = [];
  let resp = null;
  const r = http.get({ host: '127.0.0.1', port, path: '/api/events', headers: { Host: `127.0.0.1:${port}` } }, (res) => {
    resp = res;
    let buf = '';
    res.setEncoding('utf8');
    res.on('data', (c) => {
      buf += c;
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const ev = /^event: (.+)$/m.exec(block);
        const data = /^data: (.+)$/m.exec(block);
        if (ev) events.push({ event: ev[1], data: data ? JSON.parse(data[1]) : null });
      }
    });
  });
  r.on('error', () => {});
  return { events, close: () => { r.destroy(); if (resp) resp.destroy(); } };
}

// The state the server holds, with `actions` applied as the page would, PUT on its rev.
async function act(run, actions, extra = {}) {
  const got = (await req(run.port, 'GET', '/api/state')).json;
  let s = got.state;
  for (const a of actions) s = RS.reduce(s, a, '2026-11-20T20:00:00.000Z');
  return req(run.port, 'PUT', '/api/state', { body: { stateId: got.stateId, base: got.rev, state: s, clientId: 'c1', ...extra } });
}
async function markFirst(run, mark = 'landed', n = 0) {
  const { model } = (await req(run.port, 'GET', '/api/model')).json;
  const b = model.beats[0];
  const p = b.points[n];
  return act(run, [{ type: 'mark', id: `c1-${mark}-${n}-${Date.now()}`, point: p.key, mark, beat: b.key, beatTitle: b.title, text: p.text }]);
}

const tableDir = (vault) => path.join(vault, '_meta', 'table');
const kept = (vault, id) => (fs.existsSync(tableDir(vault)) ? fs.readdirSync(tableDir(vault)).filter((n) => n.startsWith(`${id}.table-log-`) && n.endsWith('.md')) : []);
const logText = (vault) => fs.readFileSync(path.join(vault, LOG), 'utf8');
const withHandLog = (vault, line = '- 19:30 The party argued about the bell, by hand.') => {
  fs.writeFileSync(path.join(vault, LOG), `${logText(vault)}\n${line}\n`);
};

describe('run sheet server', () => {
  it('binds 127.0.0.1 only', async () => {
    const run = await start(copyOf());
    assert.strictEqual(run.server.address().address, '127.0.0.1');
  });

  it('a busy port rejects with EADDRINUSE', async () => {
    const run = await start(copyOf());
    const other = http.createServer();
    await assert.rejects(listenLocal(other, run.port), (err) => err.code === 'EADDRINUSE');
    other.close();
  });

  it('hello names the app and the session', async () => {
    const run = await start(copyOf());
    const r = await req(run.port, 'GET', '/api/hello');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.app, 'run-sheet');
    assert.strictEqual(r.json.session, 'Session 2');
    assert.strictEqual(r.json.pid, process.pid);
    assert.ok(r.json.serverId);
  });

  it('a foreign Host is refused', async () => {
    const run = await start(copyOf());
    for (const host of ['evil.example', `evil.example:${run.port}`, '127.0.0.1:1', `127.0.0.2:${run.port}`]) {
      const r = await req(run.port, 'GET', '/api/model', { headers: { Host: host } });
      assert.strictEqual(r.status, 403, host);
    }
    assert.strictEqual((await req(run.port, 'GET', '/api/hello', { headers: { Host: `localhost:${run.port}` } })).status, 200);
  });

  it('a PUT with a foreign Origin is refused', async () => {
    const run = await start(copyOf());
    const r = await req(run.port, 'PUT', '/api/state', {
      headers: { Origin: 'http://evil.example' }, body: { stateId: run.stateId, base: 0, state: { points: { x: 1 } } },
    });
    assert.strictEqual(r.status, 403);
    assert.strictEqual((await req(run.port, 'GET', '/api/state')).json.rev, 0);
    const ok = await req(run.port, 'PUT', '/api/state', {
      headers: { Origin: `http://localhost:${run.port}` }, body: { stateId: run.stateId, base: 0, state: { points: {} } },
    });
    assert.strictEqual(ok.status, 200);
  });

  it('a PUT that is not JSON, or too big, is refused', async () => {
    const run = await start(copyOf());
    const text = await req(run.port, 'PUT', '/api/state', { headers: { 'Content-Type': 'text/plain' }, body: '{}' });
    assert.strictEqual(text.status, 415);
    const bad = await req(run.port, 'PUT', '/api/state', { body: '{"stateId": ' });
    assert.strictEqual(bad.status, 400);
    const big = await req(run.port, 'PUT', '/api/state', { body: { stateId: run.stateId, base: 0, state: { pad: 'x'.repeat(2 * 1024 * 1024 + 10) } } });
    assert.strictEqual(big.status, 413);
    assert.strictEqual((await req(run.port, 'GET', '/api/state')).json.rev, 0);
  });

  it('note path traversal is refused', async () => {
    const vault = copyOf();
    fs.mkdirSync(path.join(vault, '_Templates'), { recursive: true });
    fs.writeFileSync(path.join(vault, '_Templates', 'Secret.md'), '# not in the index\n');
    fs.writeFileSync(path.join(path.dirname(vault), `${path.basename(vault)}-outside.md`), 'outside');
    made.push(path.join(path.dirname(vault), `${path.basename(vault)}-outside.md`));
    const run = await start(vault);
    const asks = [
      `../${path.basename(vault)}-outside.md`, path.join(vault, ASH), '%2e%2e%2fx.md', 'Characters\\NPCs\\Brother Ash.md',
      '_Templates/Secret.md', '_meta/vault-config.yaml', '',
    ];
    for (const a of asks) {
      const r = await req(run.port, 'GET', `/api/note?path=${a.startsWith('%') ? a : encodeURIComponent(a)}`);
      assert.ok([403, 404].includes(r.status), `${a}: ${r.status}`);
    }
    const ok = await req(run.port, 'GET', `/api/note?path=${encodeURIComponent(ASH)}`);
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(ok.json.path, ASH);
    assert.strictEqual(ok.json.name, 'Brother Ash');
    assert.strictEqual(ok.json.type, 'npc');
    assert.strictEqual(ok.json.withheld, false);
    assert.ok(!ok.json.html.includes('name: Brother Ash'), 'frontmatter left out');
  });

  it('vault serves pictures only', async () => {
    const vault = copyOf();
    fs.mkdirSync(path.join(vault, 'Pictures', 'dir.png'), { recursive: true });
    fs.writeFileSync(path.join(vault, 'Pictures', 'rook.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    fs.writeFileSync(path.join(vault, 'Characters', 'NPCs', 'Secret.md?.png'), 'nope');
    const run = await start(vault);
    const pic = await req(run.port, 'GET', '/vault/Pictures/rook.png');
    assert.strictEqual(pic.status, 200);
    assert.strictEqual(pic.headers['content-type'], 'image/png');
    const refused = [
      '/vault/Characters/NPCs/Brother%20Ash.md', '/vault/_meta/vault-config.yaml',
      '/vault/Characters/NPCs/Brother%20Ash.md?.png', '/vault/Characters/NPCs/Brother%20Ash.md#.png',
      '/vault/Characters/NPCs/Brother%20Ash.md%23.png', '/vault/Pictures', '/vault/Pictures/', '/vault/Pictures/dir.png',
      '/vault/Pictures/dir.png/', '/vault/../x.png', '/vault/%2e%2e/x.png', '/vault/Pictures%5Crook.png', '/vault/',
    ];
    for (const u of refused) {
      const r = await req(run.port, 'GET', u);
      assert.ok([400, 403, 404].includes(r.status), `${u}: ${r.status}`);
      assert.notStrictEqual(r.headers['content-type'], 'text/markdown');
      assert.ok(!r.text.includes('Brother Ash'), u);
    }
    // `%3F.png` names a real file called `Secret.md?.png`: that one is a picture name, and is served as one.
    const q = await req(run.port, 'GET', '/vault/Characters/NPCs/Secret.md%3F.png');
    assert.ok(q.status === 200 ? q.headers['content-type'] === 'image/png' : [403, 404].includes(q.status));
  });

  it('every answer carries the CSP header and no CORS header; OPTIONS gives 405', async () => {
    const run = await start(copyOf());
    const answers = [
      await req(run.port, 'GET', '/'), await req(run.port, 'GET', '/api/model'), await req(run.port, 'GET', '/api/state'),
      await req(run.port, 'GET', '/nope'), await req(run.port, 'GET', '/api/hello', { headers: { Host: 'evil.example' } }),
      await req(run.port, 'OPTIONS', '/api/state', { headers: { Origin: 'http://evil.example', 'Access-Control-Request-Method': 'PUT' } }),
      await req(run.port, 'GET', '/web/state.js'),
    ];
    for (const r of answers) {
      assert.strictEqual(r.headers['content-security-policy'], "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'");
      assert.ok(!Object.keys(r.headers).some((h) => h.startsWith('access-control-')), JSON.stringify(r.headers));
    }
    assert.strictEqual(answers[3].status, 404);
    assert.strictEqual(answers[5].status, 405);
    assert.strictEqual(answers[0].status, 200);
    assert.match(answers[0].headers['content-type'], /text\/html/);
    assert.strictEqual(answers[6].status, 200);
  });

  it("the drawer's note html runs no raw HTML", async () => {
    const vault = copyOf();
    const p = path.join(vault, ASH);
    fs.writeFileSync(p, `${fs.readFileSync(p, 'utf8')}\n<script>alert(1)</script>\n\n<img src=x onerror=alert(2)>\n\nSee [[The Gate]] and [[Nobody There]].\n`);
    const run = await start(vault);
    const r = await req(run.port, 'GET', `/api/note?path=${encodeURIComponent(ASH)}`);
    assert.ok(!r.json.html.includes('<script>'));
    assert.ok(!r.json.html.includes('<img src=x'));
    assert.ok(r.json.html.includes('&lt;script&gt;'));
    assert.ok(r.json.html.includes('<a class="lk" data-note="Locations/The Gate.md">The Gate</a>'));
    assert.ok(r.json.html.includes('<span class="lk missing">Nobody There</span>'));
  });

  it('the model is presented: links open notes, embeds are pictures', async () => {
    const vault = copyOf();
    fs.mkdirSync(path.join(vault, '_attachments', 'maps'), { recursive: true });
    fs.writeFileSync(path.join(vault, '_attachments', 'maps', 'gate.png'), Buffer.from([0x89, 0x50]));
    const plan = path.join(vault, PLAN);
    fs.writeFileSync(plan, fs.readFileSync(plan, 'utf8').replace('## Session Intent\n', '## Session Intent\n\n![[gate.png]] and ![[lost.png]]\n'));
    const run = await start(vault);
    const r = await req(run.port, 'GET', '/api/model');
    assert.strictEqual(r.status, 200);
    const { model } = r.json;
    assert.ok(model.brief.overviewHtml.includes('<a class="lk" data-note="Characters/NPCs/Brother Ash.md">Brother Ash</a>'));
    assert.strictEqual(model.brief.overview, 'The party arrives at the gate at dusk. [[Brother Ash]] guards it and wants the bell rung.', 'the words stay for the state');
    const intent = model.prep.find((p) => p.title === 'Session Intent');
    assert.ok(intent.mdHtml.includes('<img src="/vault/_attachments/maps/gate.png"'), intent.mdHtml);
    assert.ok(intent.mdHtml.includes('<span class="lk missing">lost.png</span>'));
    const b = model.beats[0];
    assert.ok(b.situationHtml.startsWith('<p>'));
    assert.ok(typeof b.points[0].textHtml === 'string' && !b.points[0].textHtml.startsWith('<p>'));
    assert.ok(typeof b.who[0].playAsHtml === 'string');
    assert.ok(typeof b.ifs[0].doHtml === 'string' && typeof b.ifs[0].thenHtml === 'string');
    assert.strictEqual(r.json.stateId, run.stateId);
    assert.strictEqual(r.json.session.label, 'Session 2');
    assert.strictEqual(r.json.tableLog, LOG);
  });

  it('a tab from another session gets 409 and does not overwrite', async () => {
    const run = await start(copyOf());
    const r = await req(run.port, 'PUT', '/api/state', { body: { stateId: 'chapter-2--session-01-snowmelt', base: 0, state: { points: { a: 1 } } } });
    assert.strictEqual(r.status, 409);
    assert.deepStrictEqual(r.json, { reason: 'session', stateId: run.stateId, rev: 0, label: 'Session 2' });
    assert.deepStrictEqual((await req(run.port, 'GET', '/api/state')).json.state.points, {});
  });

  it('a stale tab gets 409', async () => {
    const run = await start(copyOf());
    assert.strictEqual((await req(run.port, 'PUT', '/api/state', { body: { stateId: run.stateId, base: 0, state: { points: {} } } })).status, 200);
    const r = await req(run.port, 'PUT', '/api/state', { body: { stateId: run.stateId, base: 7, state: { points: {} } } });
    assert.strictEqual(r.status, 409);
    assert.strictEqual(r.json.reason, 'stale');
    assert.strictEqual(r.json.rev, 1);
  });

  it('two tabs: the second PUT on an old base gets 409', async () => {
    const run = await start(copyOf());
    const a = await req(run.port, 'PUT', '/api/state', { body: { stateId: run.stateId, base: 0, state: { points: { one: 1 } } } });
    const b = await req(run.port, 'PUT', '/api/state', { body: { stateId: run.stateId, base: 0, state: { points: { two: 2 } } } });
    assert.strictEqual(a.status, 200);
    assert.strictEqual(b.status, 409);
    assert.strictEqual(b.json.reason, 'stale');
    assert.deepStrictEqual((await req(run.port, 'GET', '/api/state')).json.state.points, { one: 1 });
  });

  it('a page reconnecting after a restart with an older base gets 409, not a silent overwrite', async () => {
    const vault = copyOf();
    const a = await start(vault);
    await req(a.port, 'PUT', '/api/state', { body: { stateId: a.stateId, base: 0, state: { points: { one: 1 } } } });
    await req(a.port, 'PUT', '/api/state', { body: { stateId: a.stateId, base: 1, state: { points: { two: 2 } } } });
    await a.close();
    const b = await start(vault);
    assert.strictEqual((await req(b.port, 'GET', '/api/state')).json.rev, 2);
    const r = await req(b.port, 'PUT', '/api/state', { body: { stateId: b.stateId, base: 1, state: { points: { old: 1 } } } });
    assert.strictEqual(r.status, 409);
    assert.strictEqual(r.json.reason, 'stale');
    assert.deepStrictEqual((await req(b.port, 'GET', '/api/state')).json.state.points, { two: 2 });
  });

  it('model is re-read per load', async () => {
    const vault = copyOf();
    const run = await start(vault);
    const one = (await req(run.port, 'GET', '/api/model')).json.model;
    const plan = path.join(vault, PLAN);
    fs.writeFileSync(plan, fs.readFileSync(plan, 'utf8').replace('The gate holds until the bell rings', 'The gate holds until dawn'));
    const two = (await req(run.port, 'GET', '/api/model')).json.model;
    const intent = (m) => m.prep.find((p) => p.title === 'Session Intent').md;
    assert.match(intent(one), /until the bell rings/);
    assert.match(intent(two), /until dawn/);
  });

  it('a Plan that cannot be read gives 500 with the reason', async () => {
    const vault = copyOf();
    const run = await start(vault);
    fs.rmSync(path.join(vault, PLAN));
    const r = await req(run.port, 'GET', '/api/model');
    assert.strictEqual(r.status, 500);
    assert.match(r.json.error, /could not read the Plan/);
  });

  it('state round trip through PUT and GET', async () => {
    const run = await start(copyOf());
    const put = await markFirst(run);
    assert.deepStrictEqual(put.json, { rev: 1 });
    const got = (await req(run.port, 'GET', '/api/state')).json;
    assert.strictEqual(got.rev, 1);
    assert.strictEqual(got.stateId, run.stateId);
    assert.strictEqual(Object.values(got.state.points)[0].mark, 'landed');
    assert.ok(got.serverId);
  });

  it('SSE hello then saved after a PUT', async () => {
    const run = await start(copyOf());
    const sse = listen(run.port);
    try {
      await waitFor(() => sse.events.find((e) => e.event === 'hello'));
      assert.strictEqual(sse.events[0].event, 'hello');
      assert.strictEqual(sse.events[0].data.rev, 0);
      assert.ok(sse.events[0].data.serverId);
      await markFirst(run);
      const saved = await waitFor(() => sse.events.find((e) => e.event === 'saved'));
      assert.strictEqual(saved.data.rev, 1);
      const state = sse.events.find((e) => e.event === 'state');
      assert.deepStrictEqual(state.data, { rev: 1, clientId: 'c1' });
    } finally { sse.close(); }
  });

  it('the record route gives the body the state renders now', async () => {
    const run = await start(copyOf());
    await markFirst(run);
    const r = await req(run.port, 'GET', '/api/record');
    assert.strictEqual(r.status, 200);
    assert.strictEqual((r.json.text.match(/^## /gm) || []).length, 16);
    assert.match(r.json.text, /## Points landed\n\n- The Gate: the tracks/);
  });

  it('the Table Log is rewritten after a point is marked, and not after a no-op PUT', async () => {
    const vault = copyOf();
    const run = await start(vault);
    await markFirst(run);
    await waitFor(() => /## Points landed\n\n- The Gate: the tracks/.test(logText(vault)));
    const text = logText(vault);
    assert.match(text, /^---\ntype: session-table-log/);
    assert.match(text, /# Session 02 - The Test - Table Log/);
    assert.deepStrictEqual(kept(vault, run.stateId), [], 'an empty skeleton is not copied aside');
    await wait(150);
    const mtime = fs.statSync(path.join(vault, LOG)).mtimeMs;
    const got = (await req(run.port, 'GET', '/api/state')).json;
    const r = await req(run.port, 'PUT', '/api/state', { body: { stateId: got.stateId, base: got.rev, state: got.state } });
    assert.strictEqual(r.status, 200);
    await wait(150);
    assert.strictEqual(fs.statSync(path.join(vault, LOG)).mtimeMs, mtime);
    assert.strictEqual(logText(vault), text);
    const disk = JSON.parse(fs.readFileSync(path.join(tableDir(vault), `${run.stateId}.json`), 'utf8'));
    assert.ok(disk.recordHash, 'the record hash is on disk');
  });

  it('no Table Log: state saves, nothing else is written', async () => {
    const vault = copyOf();
    const list = (d) => fs.readdirSync(d, { recursive: true }).map(String).filter((n) => !n.startsWith(`_meta${path.sep}table`)).sort();
    const before = list(vault);
    const run = await start(vault, 'Session 03 - Next');
    const m = (await req(run.port, 'GET', '/api/model')).json;
    assert.strictEqual(m.tableLog, null);
    await act(run, [{ type: 'jot', id: 'c1-1', text: 'The party camps.' }]);
    await waitFor(() => fs.existsSync(path.join(tableDir(vault), `${run.stateId}.json`)));
    await wait(100);
    assert.deepStrictEqual(list(vault), before);
    assert.deepStrictEqual(fs.readdirSync(tableDir(vault)), [`${run.stateId}.json`]);
  });

  it('a hand-made Table Log of another type is never overwritten', async () => {
    const vault = copyOf();
    const p = path.join(vault, LOG);
    fs.writeFileSync(p, logText(vault).replace('type: session-table-log', 'type: session-notes').replace('## Log', '## Log\n\n- my own notes'));
    const before = logText(vault);
    const run = await start(vault);
    await markFirst(run);
    await waitFor(() => fs.existsSync(path.join(tableDir(vault), `${run.stateId}.json`)));
    await wait(100);
    assert.strictEqual(logText(vault), before);
    assert.deepStrictEqual(kept(vault, run.stateId), []);
  });

  describe('a Table Log the sheet did not write is copied aside first', () => {
    async function expectKept(vault, run, oldText, sse, mark = 'landed', n = 0) {
      await markFirst(run, mark, n);
      const names = await waitFor(() => { const k = kept(vault, run.stateId); return k.length ? k : null; });
      assert.strictEqual(names.length, 1);
      assert.strictEqual(fs.readFileSync(path.join(tableDir(vault), names[0]), 'utf8'), oldText);
      await waitFor(() => (mark === 'landed' ? /## Points landed\n\n- The Gate: the tracks/ : /## Tried and missed\n\n- The Gate: the bell/).test(logText(vault)));
      const ev = await waitFor(() => sse.events.find((e) => e.event === 'record-kept'));
      assert.strictEqual(ev.data.path, `_meta/table/${names[0]}`);
    }

    it('a hand-written Table Log is copied aside before the first rewrite', async () => {
      const vault = copyOf();
      withHandLog(vault);
      const old = logText(vault);
      const run = await start(vault);
      const sse = listen(run.port);
      try { await expectKept(vault, run, old, sse); } finally { sse.close(); }
    });

    it('an unreadable state over a log with content', async () => {
      const vault = copyOf();
      const a = await start(vault);
      await markFirst(a, 'landed', 0);
      await waitFor(() => /Points landed/.test(logText(vault)));
      await a.close();
      fs.writeFileSync(path.join(tableDir(vault), `${a.stateId}.json`), '{ not json');
      const old = logText(vault);
      const run = await start(vault);
      const sse = listen(run.port);
      try {
        const m = (await req(run.port, 'GET', '/api/model')).json;
        assert.ok(m.notices.some((n) => n.kind === 'state-broken'), JSON.stringify(m.notices));
        assert.ok(fs.readdirSync(tableDir(vault)).some((n) => n.startsWith(`${a.stateId}.broken-`)));
        await expectKept(vault, run, old, sse, 'missed', 1);
      } finally { sse.close(); }
    });

    it('a fresh state id (renamed index) over a log with content', async () => {
      const vault = copyOf();
      const a = await start(vault);
      await markFirst(a, 'landed', 0);
      await waitFor(() => /Points landed/.test(logText(vault)));
      await a.close();
      const dir = path.join(vault, S2);
      fs.renameSync(path.join(dir, 'Session 02 - The Test.md'), path.join(dir, 'Session 02 - The Trial.md'));
      for (const n of ['Session 02 - The Test - Plan.md', 'Session 02 - The Test - Table Log.md']) {
        const f = path.join(dir, n);
        fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('[[Session 02 - The Test]]', '[[Session 02 - The Trial]]'));
      }
      const old = logText(vault);
      const run = await start(vault, 'Session 02 - The Trial');
      assert.notStrictEqual(run.stateId, a.stateId);
      const sse = listen(run.port);
      try { await expectKept(vault, run, old, sse, 'missed', 1); } finally { sse.close(); }
    });

    it('a log edited by hand mid-session', async () => {
      const vault = copyOf();
      const run = await start(vault);
      const sse = listen(run.port);
      try {
        await markFirst(run, 'landed', 0);
        await waitFor(() => /Points landed/.test(logText(vault)));
        await wait(100);
        assert.deepStrictEqual(kept(vault, run.stateId), []);
        withHandLog(vault, '- 21:00 Typed in by hand mid-session.');
        const old = logText(vault);
        await markFirst(run, 'missed', 1);
        const names = await waitFor(() => { const k = kept(vault, run.stateId); return k.length ? k : null; });
        assert.strictEqual(fs.readFileSync(path.join(tableDir(vault), names[0]), 'utf8'), old);
        await waitFor(() => /## Tried and missed/.test(logText(vault)) && /Tried and missed\n\n- /.test(logText(vault)));
        await waitFor(() => sse.events.find((e) => e.event === 'record-kept'));
      } finally { sse.close(); }
    });
  });

  it('a restart with nothing changed writes nothing', async () => {
    const vault = copyOf();
    const a = await start(vault);
    await markFirst(a);
    await waitFor(() => /Points landed/.test(logText(vault)));
    await wait(150);
    await a.close();
    const stateFile = path.join(tableDir(vault), `${a.stateId}.json`);
    const t = [fs.statSync(path.join(vault, LOG)).mtimeMs, fs.statSync(stateFile).mtimeMs];
    const texts = [logText(vault), fs.readFileSync(stateFile, 'utf8')];
    const b = await start(vault);
    await req(b.port, 'GET', '/api/model');
    await req(b.port, 'GET', '/api/state');
    await req(b.port, 'GET', '/api/record');
    await wait(150);
    await b.close();
    assert.deepStrictEqual([fs.statSync(path.join(vault, LOG)).mtimeMs, fs.statSync(stateFile).mtimeMs], t);
    assert.deepStrictEqual([logText(vault), fs.readFileSync(stateFile, 'utf8')], texts);
    assert.deepStrictEqual(kept(vault, a.stateId), []);
  });

  it('leftover record temp files are removed at start', async () => {
    const vault = copyOf();
    const leftover = path.join(vault, `${LOG}.tmp-4242`);
    fs.writeFileSync(leftover, 'half a log');
    await start(vault);
    assert.ok(!fs.existsSync(leftover));
  });

  it('/api/model on a 500-person generated vault answers within 3 s', async () => {
    const vault = copyOf();
    const dir = path.join(vault, 'Characters', 'Generated');
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < 500; i++) {
      fs.writeFileSync(path.join(dir, `Person ${i}.md`), [
        '---', `name: Person ${i}`, `type: ${i % 2 ? 'creature' : 'npc'}`, `aliases: [P${i}]`, '---', '', '## Overview', '', `Someone who knows [[Person ${(i + 1) % 500}]].`, '',
        '<!-- gm-only -->', '', '## GM Notes', '', '### Stats', '', `AC 12, Hit Points ${10 + (i % 30)}, Initiative +1`, '',
        '### Playing Them', '', '- **Speech:** low', '', '### Wants', '', 'To be left alone.', '', '<!-- /gm-only -->', '',
      ].join('\n'));
    }
    const run = await start(vault);
    const t0 = Date.now();
    const r = await req(run.port, 'GET', '/api/model');
    const ms = Date.now() - t0;
    assert.strictEqual(r.status, 200);
    assert.ok(r.json.model.cast.length >= 500);
    assert.ok(ms < 3000, `${ms} ms`);
  });

  it("the benchmark vault's old Plan serves a model with no beats", async () => {
    const run = await start(copyOf(BENCHMARK), 'Session 03 - The Inner Sanctum');
    const r = await req(run.port, 'GET', '/api/model');
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.json.model.beats, []);
    assert.ok(r.json.model.prep.length > 0);
    assert.ok(r.json.model.prep.every((p) => typeof p.mdHtml === 'string'));
  });

  it('a vault with no settings file serves', async () => {
    const vault = copyOf();
    fs.rmSync(path.join(vault, '_meta', 'vault-config.yaml'));
    const run = await start(vault);
    const r = await req(run.port, 'GET', '/api/model');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.model.campaign, path.basename(vault));
    assert.strictEqual(r.json.model.system, null);
  });

  it('no outside address in web/', () => {
    const files = fs.readdirSync(WEB, { recursive: true }).map(String).filter((n) => fs.statSync(path.join(WEB, n)).isFile());
    assert.ok(files.includes('gm.html'));
    for (const n of files) {
      assert.doesNotMatch(fs.readFileSync(path.join(WEB, n), 'utf8'), /https?:\/\//i, n);
    }
  });
});
