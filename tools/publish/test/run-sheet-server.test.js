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
const { bodyHash, recordBodyOf } = require('../lib/run-sheet/record');

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
const kept = (vault, id) => (fs.existsSync(tableDir(vault)) ? fs.readdirSync(tableDir(vault)).filter((n) => n.startsWith(`${id}.table-log-`) && n.endsWith('.txt')) : []);
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
    assert.strictEqual((await req(run.port, 'GET', '/api/state')).json.label, 'Session 2', 'a page that finds another session says which (proof defect 1)');
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
      assert.strictEqual(r.headers['content-security-policy'], "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
      assert.strictEqual(r.headers['cross-origin-resource-policy'], 'same-origin');
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
    assert.deepStrictEqual(fs.readdirSync(tableDir(vault)).sort(), [`${run.stateId}.json`, `${run.stateId}.lock`], 'the state and the lock while it runs');
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
      assert.ok(!fs.readdirSync(tableDir(vault)).some((n) => n.endsWith('.md')), 'the kept copy is not a note a vault scan reads (PR review L3)');
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

describe('run sheet server: the third review', () => {
  const T = 'Session 02 - The Test';
  const stateFileOf = (vault, run) => path.join(tableDir(vault), `${run.stateId}.json`);
  const readState = (vault, run) => JSON.parse(fs.readFileSync(stateFileOf(vault, run), 'utf8'));
  const logHash = (vault) => bodyHash(recordBodyOf(logText(vault)));
  // What a kill -9 leaves besides the files: a lock whose process is gone.
  const staleLock = (vault, run) => fs.writeFileSync(path.join(tableDir(vault), `${run.stateId}.lock`), JSON.stringify({ pid: 999999, port: 1 }));
  const gone = {}; // the store takes over a lock with a port: the CLI asks the port first

  it('Ctrl+C a moment after the last click: the restart copies nothing aside (H1)', async () => {
    const vault = copyOf();
    const a = await start(vault, T, { deps: { delayMs: 1000 } });
    await markFirst(a, 'landed', 0);
    await wait(200);
    await a.close();
    assert.match(logText(vault), /## Points landed\n\n- The Gate: the tracks/);
    assert.strictEqual(readState(vault, a).recordHash, logHash(vault), 'the record hash reached disk');
    assert.ok(!fs.existsSync(path.join(tableDir(vault), `${a.stateId}.lock`)), 'a clean close removes the lock');
    const b = await start(vault, T, { deps: { delayMs: 1000 } });
    const sse = listen(b.port);
    try {
      await markFirst(b, 'missed', 1);
      await b.close();
      assert.deepStrictEqual(kept(vault, a.stateId), []);
      assert.ok(!sse.events.some((e) => e.event === 'record-kept'));
      assert.match(logText(vault), /## Tried and missed\n\n- The Gate: the bell/);
    } finally { sse.close(); }
  });

  it('a close that cannot save rejects, and keeps the lock', async () => {
    const vault = copyOf();
    let stuck = false;
    const flaky = { ...fs, renameSync: (x, y) => { if (stuck && y.endsWith('.json')) { const e = new Error('EPERM: operation not permitted'); e.code = 'EPERM'; throw e; } return fs.renameSync(x, y); } };
    const a = await start(vault, T, { deps: { fs: flaky, delayMs: 1000, retryMs: [10000], log: () => {} } });
    await markFirst(a);
    stuck = true;
    await assert.rejects(a.close(), /operation not permitted/);
    assert.ok(fs.existsSync(path.join(tableDir(vault), `${a.stateId}.lock`)));
    assert.strictEqual(a.server.listening, false, 'the server still stops');
    servers.splice(servers.indexOf(a), 1);
  });

  describe('the kill -9 windows, reconciled at start (M1)', () => {
    it('the log was written, its recordHash was not: the log is adopted, nothing copied', async () => {
      const vault = copyOf();
      const a = await start(vault, T);
      await markFirst(a, 'landed', 0);
      await waitFor(() => /Points landed\n\n- /.test(logText(vault)));
      await wait(100);
      await a.close();
      const st = readState(vault, a);
      st.recordHash = 'the hash before the last write';
      fs.writeFileSync(stateFileOf(vault, a), JSON.stringify(st));
      staleLock(vault, a);
      const before = [logText(vault), fs.statSync(path.join(vault, LOG)).mtimeMs];
      const b = await start(vault, T, { deps: gone });
      await waitFor(() => readState(vault, b).recordHash === logHash(vault));
      assert.deepStrictEqual([logText(vault), fs.statSync(path.join(vault, LOG)).mtimeMs], before, 'the log is not rewritten');
      await markFirst(b, 'missed', 1);
      await waitFor(() => /Tried and missed\n\n- /.test(logText(vault)));
      await wait(50);
      assert.deepStrictEqual(kept(vault, a.stateId), []);
    });

    it('the state was written, the log was not: the log is brought up to date at start', async () => {
      const vault = copyOf();
      const a = await start(vault, T);
      await markFirst(a, 'landed', 0);
      await waitFor(() => /Points landed\n\n- /.test(logText(vault)));
      await wait(100);
      const log0 = logText(vault);
      const hash0 = readState(vault, a).recordHash;
      assert.strictEqual(hash0, logHash(vault));
      await markFirst(a, 'missed', 1);
      await waitFor(() => /Tried and missed\n\n- /.test(logText(vault)));
      await wait(100);
      await a.close();
      // The state at S1 with S0's recordHash, the log at S0.
      fs.writeFileSync(path.join(vault, LOG), log0);
      const st = readState(vault, a);
      st.recordHash = hash0;
      fs.writeFileSync(stateFileOf(vault, a), JSON.stringify(st));
      staleLock(vault, a);
      const b = await start(vault, T, { deps: gone });
      assert.match(logText(vault), /## Tried and missed\n\n- The Gate: the bell/, 'rewritten before the first click');
      await waitFor(() => readState(vault, b).recordHash === logHash(vault));
      assert.deepStrictEqual(kept(vault, a.stateId), []);
    });

    it('a log edited by hand while the sheet was off is left alone until the next change', async () => {
      const vault = copyOf();
      const a = await start(vault, T);
      await markFirst(a, 'landed', 0);
      await waitFor(() => /Points landed\n\n- /.test(logText(vault)));
      await wait(100);
      await a.close();
      withHandLog(vault);
      const before = logText(vault);
      const b = await start(vault, T);
      await wait(100);
      assert.strictEqual(logText(vault), before);
      assert.deepStrictEqual(kept(vault, a.stateId), []);
      await b.close();
    });
  });

  describe('save and record status (M2)', () => {
    const helloOf = async (port) => {
      const sse = listen(port);
      try { return (await waitFor(() => sse.events.find((e) => e.event === 'hello'))).data; } finally { sse.close(); }
    };

    it('a record that fails is said once, retried quietly, and given to a page that connects later', async () => {
      const vault = copyOf();
      let failing = true;
      const lines = [];
      const flaky = {
        ...fs,
        renameSync: (x, y) => {
          if (failing && y.endsWith('Table Log.md')) { const e = new Error('EBUSY: resource busy or locked, rename'); e.code = 'EBUSY'; throw e; }
          return fs.renameSync(x, y);
        },
      };
      const run = await start(vault, T, { deps: { fs: flaky, recordRetryMs: [30], log: (l) => lines.push(l) } });
      const sse = listen(run.port);
      try {
        await waitFor(() => sse.events.find((e) => e.event === 'hello'));
        assert.deepStrictEqual(sse.events[0].data.status, { saving: 'ok', saveError: null, record: 'ok', recordError: null });
        await markFirst(run, 'landed', 0);
        await waitFor(() => sse.events.find((e) => e.event === 'record-failed'));
        await wait(200);
        await markFirst(run, 'missed', 1);
        await wait(100);
        assert.strictEqual(sse.events.filter((e) => e.event === 'record-failed').length, 1, 'said once');
        assert.strictEqual(lines.filter((l) => /could not be written/.test(l)).length, 1, 'one terminal line');
        const late = await helloOf(run.port);
        assert.strictEqual(late.status.record, 'failing');
        assert.match(late.status.recordError, /EBUSY/);
        const m = (await req(run.port, 'GET', '/api/model')).json;
        assert.ok(m.notices.some((n) => n.kind === 'record-failing' && /EBUSY/.test(n.error)), JSON.stringify(m.notices));
        failing = false;
        await waitFor(() => sse.events.find((e) => e.event === 'record-ok'));
        assert.match(logText(vault), /## Tried and missed\n\n- The Gate: the bell/);
        assert.strictEqual((await helloOf(run.port)).status.record, 'ok');
        assert.ok(!(await req(run.port, 'GET', '/api/model')).json.notices.some((n) => n.kind === 'record-failing'));
        assert.ok(lines.some((l) => /written again/.test(l)));
        assert.deepStrictEqual(kept(vault, run.stateId), []);
      } finally { sse.close(); }
    });

    it('a Table Log turned into another type mid-session is said once, not on every write', async () => {
      const vault = copyOf();
      const run = await start(vault, T, { deps: { log: () => {} } });
      const sse = listen(run.port);
      try {
        await markFirst(run, 'landed', 0);
        await waitFor(() => /Points landed\n\n- /.test(logText(vault)));
        // The index the server holds still names the note; no /api/model call refreshes it below.
        fs.writeFileSync(path.join(vault, LOG), logText(vault).replace('type: session-table-log', 'type: session-notes'));
        const before = logText(vault);
        await act(run, [{ type: 'jot', id: 'c1-j1', text: 'one', beat: null }]);
        await waitFor(() => sse.events.find((e) => e.event === 'record-failed'));
        await act(run, [{ type: 'jot', id: 'c1-j2', text: 'two', beat: null }]);
        await wait(150);
        assert.strictEqual(sse.events.filter((e) => e.event === 'record-failed').length, 1);
        assert.strictEqual((await helloOf(run.port)).status.record, 'failing');
        assert.strictEqual(logText(vault), before, 'never written');
      } finally { sse.close(); }
    });

    it('a state that cannot be saved shows on a page that connects later, until it saves', async () => {
      const vault = copyOf();
      let stuck = true;
      const flaky = { ...fs, renameSync: (x, y) => { if (stuck && y.endsWith('.json')) { const e = new Error('EPERM: operation not permitted'); e.code = 'EPERM'; throw e; } return fs.renameSync(x, y); } };
      const lines = [];
      const run = await start(vault, T, { deps: { fs: flaky, retryMs: [30], log: (l) => lines.push(l) } });
      await markFirst(run);
      await waitFor(() => lines.some((l) => /could not be saved/.test(l)));
      const late = await helloOf(run.port);
      assert.strictEqual(late.status.saving, 'failing');
      assert.match(late.status.saveError, /EPERM/);
      assert.ok((await req(run.port, 'GET', '/api/model')).json.notices.some((n) => n.kind === 'save-failing'));
      await wait(150);
      assert.strictEqual(lines.filter((l) => /could not be saved/.test(l)).length, 1, 'one terminal line');
      stuck = false;
      await waitFor(() => lines.some((l) => /saved again/.test(l)));
      assert.strictEqual((await helloOf(run.port)).status.saving, 'ok');
    });
  });

  describe('a state file that is not a whole state (M3)', () => {
    for (const [name, make] of [
      ['{ rev, stateId } alone', (id) => ({ rev: 3, stateId: id })],
      ['one missing visited', (id) => { const s = RS.emptyState({ stateId: id }); delete s.visited; delete s.end.where; return { ...s, rev: 2 }; }],
      ['an empty object', () => ({})],
    ]) {
      it(`${name} serves, and writes a record`, async () => {
        const vault = copyOf();
        const id = stateIdOf(pickSession(listSessions(vault), T, vault).session);
        fs.mkdirSync(tableDir(vault), { recursive: true });
        fs.writeFileSync(path.join(tableDir(vault), `${id}.json`), JSON.stringify(make(id)));
        const run = await start(vault, T);
        assert.strictEqual((await req(run.port, 'GET', '/api/model')).status, 200);
        const st = (await req(run.port, 'GET', '/api/state')).json.state;
        for (const k of Object.keys(RS.emptyState({}))) assert.ok(k in st, k);
        assert.strictEqual((await req(run.port, 'GET', '/api/record')).status, 200);
        assert.strictEqual((await markFirst(run)).status, 200);
        await waitFor(() => /## Points landed\n\n- The Gate: the tracks/.test(logText(vault)));
        assert.strictEqual(run.store.broken, null);
      });
    }

    it('a key of the wrong type moves the file aside as broken; a PUT of one is refused', async () => {
      const vault = copyOf();
      const id = stateIdOf(pickSession(listSessions(vault), T, vault).session);
      fs.mkdirSync(tableDir(vault), { recursive: true });
      fs.writeFileSync(path.join(tableDir(vault), `${id}.json`), JSON.stringify({ ...RS.emptyState({ stateId: id }), positions: [] }));
      const run = await start(vault, T, { deps: { log: () => {} } });
      const m = (await req(run.port, 'GET', '/api/model')).json;
      assert.ok(m.notices.some((n) => n.kind === 'state-broken'), JSON.stringify(m.notices));
      assert.ok(fs.readdirSync(tableDir(vault)).some((n) => n.startsWith(`${id}.broken-`)));
      const got = (await req(run.port, 'GET', '/api/state')).json;
      const r = await req(run.port, 'PUT', '/api/state', { body: { stateId: got.stateId, base: got.rev, state: { ...got.state, jots: {} } } });
      assert.strictEqual(r.status, 400);
      assert.match(r.json.error, /jots/);
      assert.strictEqual((await req(run.port, 'GET', '/api/state')).json.rev, got.rev);
    });
  });

  it('another site cannot frame the page or fire requests at it; a link to the page still opens (L1)', async () => {
    const vault = copyOf();
    fs.mkdirSync(path.join(vault, 'Pictures'), { recursive: true });
    fs.writeFileSync(path.join(vault, 'Pictures', 'rook.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const run = await start(vault, T);
    const sf = (site, mode, dest) => ({ 'Sec-Fetch-Site': site, 'Sec-Fetch-Mode': mode, 'Sec-Fetch-Dest': dest });
    const refused = [
      ['/', sf('cross-site', 'navigate', 'iframe')],
      ['/', sf('same-site', 'navigate', 'iframe')],
      ['/api/model', sf('cross-site', 'no-cors', 'image')],
      ['/api/model', sf('same-site', 'cors', 'empty')],
      ['/api/state', sf('cross-site', 'navigate', 'document')],
      ['/vault/Pictures/rook.png', sf('cross-site', 'no-cors', 'image')],
      ['/web/gm.js', sf('same-site', 'no-cors', 'script')],
    ];
    for (const [u, h] of refused) assert.strictEqual((await req(run.port, 'GET', u, { headers: h })).status, 403, `${u} ${JSON.stringify(h)}`);
    assert.strictEqual((await req(run.port, 'GET', '/', { headers: sf('cross-site', 'navigate', 'document') })).status, 200, 'a link to the page');
    assert.strictEqual((await req(run.port, 'GET', '/', { headers: sf('none', 'navigate', 'document') })).status, 200, 'typed in');
    assert.strictEqual((await req(run.port, 'GET', '/api/model', { headers: sf('same-origin', 'cors', 'empty') })).status, 200);
    const pic = await req(run.port, 'GET', '/vault/Pictures/rook.png', { headers: sf('same-origin', 'no-cors', 'image') });
    assert.strictEqual(pic.status, 200);
    assert.strictEqual(pic.headers['cross-origin-resource-policy'], 'same-origin');
    const put = await req(run.port, 'PUT', '/api/state', { headers: sf('same-site', 'cors', 'empty'), body: { stateId: run.stateId, base: 0, state: {} } });
    assert.strictEqual(put.status, 403);
  });
});
