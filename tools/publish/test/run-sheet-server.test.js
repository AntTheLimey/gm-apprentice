'use strict';
const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { createTableServer, listenLocal } = require('../lib/run-sheet/server');
const { SITE_TOOL_FROM } = require('../lib/run-sheet/side-colours');
const { listSessions, pickSession, stateIdOf } = require('../lib/run-sheet/sessions');
const RS = require('../lib/run-sheet/web/state');
const { readRunSheet } = require('../lib/run-sheet/read');
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
// The log with LF line ends, for the checks: a checkout with CRLF fixtures (git on Windows) keeps CRLF in the log.
const lf = (s) => s.replace(/\r\n/g, '\n');
const logLf = (vault) => lf(logText(vault));
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
      headers: { Origin: 'http://evil.example' }, body: { stateId: run.stateId, base: 0, state: { points: { x: { mark: 'landed', n: 1 } } } },
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
    // `?` cannot be in a Windows file name: there the request below is still refused, with no file behind it.
    if (process.platform !== 'win32') fs.writeFileSync(path.join(vault, 'Characters', 'NPCs', 'Secret.md?.png'), 'nope');
    const run = await start(vault);
    const pic = await req(run.port, 'GET', '/vault/Pictures/rook.png');
    assert.strictEqual(pic.status, 200);
    assert.strictEqual(pic.headers['content-type'], 'image/png');
    // an AVIF embed the page shows is served too, as an image
    fs.writeFileSync(path.join(vault, 'Pictures', 'map.avif'), Buffer.from([0, 0, 0, 0x1c]));
    const avif = await req(run.port, 'GET', '/vault/Pictures/map.avif');
    assert.strictEqual(avif.status, 200);
    assert.strictEqual(avif.headers['content-type'], 'image/avif');
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
    fs.writeFileSync(plan, fs.readFileSync(plan, 'utf8').replace(/## Session Intent\r?\n/, '## Session Intent\n\n![[gate.png]] and ![[lost.png]]\n'));
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

  it('a link inside a picture\'s alt text gives its words; a note\'s text never passes for a link', () => {
    const { toHtml } = require('../lib/run-sheet/present');
    const index = { resolve: (t) => (t === 'Brother Ash' ? ASH : null), picture: () => null };
    const alt = toHtml('![See [[Brother Ash|the warden]] here](x.png) then [[Brother Ash]]', index);
    assert.ok(alt.includes('alt="See the warden here"'), alt);
    assert.ok(alt.includes(`<a class="lk" data-note="${ASH}">Brother Ash</a>`), alt);
    // markdown decodes these entities to the private-use characters a placeholder once used
    assert.strictEqual(toHtml('&#xE000;0&#xE001; and &#xE000;7&#xE001;', index, { inline: true }), '\uE0000\uE001 and \uE0007\uE001');
  });

  it('foes carry statsHtml and lairActionsHtml; their text is unchanged', async () => {
    const vault = copyOf();
    const wyrm = path.join(vault, 'Creatures', 'Glacier Wyrm.md');
    fs.writeFileSync(wyrm, fs.readFileSync(wyrm, 'utf8').replace('  - The ice shifts.', '  - The ice shifts around [[Brother Ash]].\n  - Fog <b>rises</b>.'));
    const plan = path.join(vault, PLAN);
    fs.writeFileSync(plan, fs.readFileSync(plan, 'utf8').replace('- **[[Frost Wolf]] (3):** hunting', '- **[[Frost Wolf]] (3):** hunting\n- **[[Glacier Wyrm]]:** wants it dark'));
    const run = await start(vault);
    const { model } = (await req(run.port, 'GET', '/api/model')).json;
    const fresh = readRunSheet(vault, PLAN, { party: [] });
    const foes = model.beats.flatMap((b) => b.foes);
    const w = foes.find((f) => f.note === 'Creatures/Glacier Wyrm.md');
    assert.ok(w, 'the wyrm is a foe of its beat');
    assert.match(w.statsHtml, /<strong>Lair Actions<\/strong>|Lair Actions/);
    assert.match(w.lairActionsHtml, /<ul>[\s\S]*<li>The ice shifts around <a class="lk" data-note="Characters\/NPCs\/Brother Ash.md">Brother Ash<\/a>\.<\/li>/);
    assert.ok(!w.lairActionsHtml.includes('<b>'), 'raw HTML in a note is never run');
    assert.ok(w.lairActionsHtml.includes('&lt;b&gt;'));
    const wolf = foes.find((f) => f.note === 'Creatures/Frost Wolf.md');
    assert.strictEqual(wolf.lairActionsHtml, '');
    assert.ok(typeof wolf.statsHtml === 'string' && wolf.statsHtml.length > 0);
    // the words stay as the reader gave them
    const strip = (f) => { const { statsHtml, lairActionsHtml, ...rest } = f; return rest; };
    assert.deepStrictEqual(foes.map(strip), fresh.beats.flatMap((b) => b.foes));
    // the same in the cast
    const cw = model.cast.find((c) => c.note === 'Creatures/Glacier Wyrm.md');
    assert.deepStrictEqual(strip(cw.foe), fresh.cast.find((c) => c.note === cw.note).foe);
    assert.match(cw.foe.lairActionsHtml, /<li>/);
    assert.ok(model.cast.filter((c) => c.foe).every((c) => typeof c.foe.statsHtml === 'string' && typeof c.foe.lairActionsHtml === 'string'));
  });

  it('a tab from another session gets 409 and does not overwrite', async () => {
    const run = await start(copyOf());
    const r = await req(run.port, 'PUT', '/api/state', { body: { stateId: 'chapter-2--session-01-snowmelt', base: 0, state: { points: { a: { mark: 'landed', n: 1 } } } } });
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
    const a = await req(run.port, 'PUT', '/api/state', { body: { stateId: run.stateId, base: 0, state: { points: { one: { mark: 'landed', n: 1 } } } } });
    const b = await req(run.port, 'PUT', '/api/state', { body: { stateId: run.stateId, base: 0, state: { points: { two: { mark: 'landed', n: 2 } } } } });
    assert.strictEqual(a.status, 200);
    assert.strictEqual(b.status, 409);
    assert.strictEqual(b.json.reason, 'stale');
    assert.deepStrictEqual((await req(run.port, 'GET', '/api/state')).json.state.points, { one: { mark: 'landed', n: 1 } });
  });

  it("a page built on another server's revisions is stale, whatever its base (two unclean restarts can reuse a rev)", async () => {
    const run = await start(copyOf());
    const r = await req(run.port, 'PUT', '/api/state', { body: { stateId: run.stateId, serverId: 'an-earlier-server', base: 0, state: { points: {} } } });
    assert.strictEqual(r.status, 409);
    assert.strictEqual(r.json.reason, 'stale');
    const ok = await req(run.port, 'PUT', '/api/state', { body: { stateId: run.stateId, serverId: run.serverId, base: 0, state: { points: {} } } });
    assert.strictEqual(ok.status, 200);
  });

  it("a Table Log link to another session's log is never written, and the page has a prep note naming it", async () => {
    const vault = copyOf();
    const other = `${S2}Session 02 - The Test - Table Log.md`;
    const f = path.join(vault, other);
    const before = fs.readFileSync(f, 'utf8').replace(/^session: .*$/m, 'session: "[[Session 01 - The Start]]"');
    fs.writeFileSync(f, before);
    // Session 02's index links it (copied from the session before, say)
    const idx = path.join(vault, `${S2}Session 02 - The Test.md`);
    fs.writeFileSync(idx, fs.readFileSync(idx, 'utf8').replace('status: planned', 'status: planned\ndocuments:\n  table_log: "[[Session 02 - The Test - Table Log]]"'));
    const run = await start(vault);
    const m = await req(run.port, 'GET', '/api/model');
    assert.strictEqual(m.json.tableLog, null);
    assert.ok(m.json.model.warnings.some((w) => w.kind === 'table-log' && /Session 01 - The Start/.test(w.text)), JSON.stringify(m.json.model.warnings));
    await req(run.port, 'PUT', '/api/state', { body: { stateId: run.stateId, base: 0, state: RS.reduce(RS.emptyState({ stateId: run.stateId }), { id: 'x-1', type: 'jot', text: 'hello' }, '2026-11-20T19:00:00.000Z') } });
    run.store.flushNow();
    assert.strictEqual(fs.readFileSync(f, 'utf8'), before);
  });

  it('a page reconnecting after a restart with an older base gets 409, not a silent overwrite', async () => {
    const vault = copyOf();
    const a = await start(vault);
    await req(a.port, 'PUT', '/api/state', { body: { stateId: a.stateId, base: 0, state: { points: { one: { mark: 'landed', n: 1 } } } } });
    await req(a.port, 'PUT', '/api/state', { body: { stateId: a.stateId, base: 1, state: { points: { two: { mark: 'landed', n: 2 } } } } });
    await a.close();
    const b = await start(vault);
    assert.strictEqual((await req(b.port, 'GET', '/api/state')).json.rev, 2);
    const r = await req(b.port, 'PUT', '/api/state', { body: { stateId: b.stateId, base: 1, state: { points: { old: { mark: 'landed', n: 1 } } } } });
    assert.strictEqual(r.status, 409);
    assert.strictEqual(r.json.reason, 'stale');
    assert.deepStrictEqual((await req(b.port, 'GET', '/api/state')).json.state.points, { two: { mark: 'landed', n: 2 } });
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
    // 18 since the Task 13 proof added Places the party went (Ant's ruling: a place the players go to is published); 17 since Task 5 added Sides set
    assert.strictEqual((r.json.text.match(/^## /gm) || []).length, 18);
    assert.match(r.json.text, /## Points landed\n\n- The Gate: the tracks/);
  });

  it('the Table Log is rewritten after a point is marked, and not after a no-op PUT', async () => {
    const vault = copyOf();
    const run = await start(vault);
    await markFirst(run);
    await waitFor(() => /## Points landed\n\n- The Gate: the tracks/.test(logLf(vault)));
    const text = logText(vault);
    assert.match(lf(text), /^---\ntype: session-table-log/);
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

  it('a vault with CRLF line ends (a Windows checkout or editor) is read, and its Table Log is rewritten in CRLF', async () => {
    const vault = copyOf();
    for (const n of fs.readdirSync(vault, { recursive: true }).map(String)) {
      const f = path.join(vault, n);
      if (/\.(md|ya?ml)$/.test(n) && fs.statSync(f).isFile()) fs.writeFileSync(f, lf(fs.readFileSync(f, 'utf8')).replace(/\n/g, '\r\n'));
    }
    const a = await start(vault);
    const { model } = (await req(a.port, 'GET', '/api/model')).json;
    assert.deepStrictEqual(model.beats[0].points.map((p) => p.text), ['the tracks', 'the bell', 'the bell']);
    await markFirst(a);
    await waitFor(() => /## Points landed\n\n- The Gate: the tracks/.test(logLf(vault)));
    assert.ok(!/[^\r]\n/.test(logText(vault)), 'every line still ends in CRLF');
    assert.deepStrictEqual(kept(vault, a.stateId), [], 'an empty skeleton is not copied aside');
    await a.close();
    const b = await start(vault);
    await markFirst(b, 'missed', 1);
    await waitFor(() => /## Tried and missed\n\n- The Gate: the bell/.test(logLf(vault)));
    assert.ok(!/[^\r]\n/.test(logText(vault)));
    assert.deepStrictEqual(kept(vault, b.stateId), [], 'the sheet knows its own CRLF log after a restart');
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

  describe('the Table Log is filed on the first thing that happens at the table (#855)', () => {
    // Stands in for `gma vault-write <vault> table-log-new`: the empty skeleton beside the index, and the link.
    // Made before the server: a start with play already saved files the log while the server is built.
    const filer = (vault, session, { failFirst = false } = {}) => {
      const calls = [];
      const runFileLog = (cmd) => {
        calls.push(cmd);
        if (failFirst && calls.length === 1) return { ok: false, why: 'the vault was busy' };
        const idx = path.join(vault, session.index);
        const stem = path.basename(session.index, '.md');
        const rel = `${path.dirname(session.index)}/${stem} - Table Log.md`;
        fs.writeFileSync(path.join(vault, rel), `---\ntype: session-table-log\nsession: "[[${stem}]]"\n---\n\n# ${stem} - Table Log\n\n## Log\n`);
        fs.writeFileSync(idx, fs.readFileSync(idx, 'utf8').replace(/^type: session$/m, `type: session\ndocuments:\n  table_log: "[[${stem} - Table Log]]"`));
        return { ok: true };
      };
      return { calls, runFileLog };
    };
    const next = (vault) => pickSession(listSessions(vault), 'Session 03 - Next', vault).session;
    const startFiling = async (vault, opts) => {
      const f = filer(vault, next(vault), opts);
      const run = await start(vault, 'Session 03 - Next', { deps: { runFileLog: f.runFileLog } });
      return { run, calls: f.calls };
    };
    const startWith = async (vault, { recordRetryMs = [20], ...opts } = {}) => {
      const session = next(vault);
      const f = filer(vault, session, opts);
      const t = createTableServer({ vaultPath: vault, session, fileLog: ['gma', 'vault-write', 'table-log-new'],
        deps: { delayMs: 20, retryMs: [20], recordRetryMs, runFileLog: f.runFileLog } });
      const port = await listenLocal(t.server, 0);
      const run = { ...t, port, session, stateId: stateIdOf(session) };
      servers.push(run);
      return { run, calls: f.calls };
    };
    const logOf = (vault, run) => path.join(vault, path.dirname(run.session.index), `${path.basename(run.session.index, '.md')} - Table Log.md`);

    it('a look files nothing: no clicks, no Table Log', async () => {
      const vault = copyOf();
      const { run, calls } = await startWith(vault);
      const m = (await req(run.port, 'GET', '/api/model')).json;
      assert.strictEqual(m.tableLog, null);
      assert.strictEqual(m.tableLogOnFirst, true, 'the page says the log comes on the first thing that happens');
      const got = (await req(run.port, 'GET', '/api/state')).json;
      await req(run.port, 'PUT', '/api/state', { body: { stateId: got.stateId, base: got.rev, state: got.state } });
      await wait(150);
      assert.deepStrictEqual(calls, []);
      assert.ok(!fs.existsSync(logOf(vault, run)));
    });

    it('the first log line files it once, with the command gma table gave, and writes the line', async () => {
      const vault = copyOf();
      const { run, calls } = await startWith(vault);
      await act(run, [{ type: 'jot', id: 'c1-1', text: 'The party camps.' }]);
      await waitFor(() => fs.existsSync(logOf(vault, run)) && /The party camps\./.test(fs.readFileSync(logOf(vault, run), 'utf8')));
      assert.deepStrictEqual(calls, [['gma', 'vault-write', 'table-log-new']]);
      await act(run, [{ type: 'jot', id: 'c1-2', text: 'Dawn comes.' }]);
      await waitFor(() => /Dawn comes\./.test(fs.readFileSync(logOf(vault, run), 'utf8')));
      assert.strictEqual(calls.length, 1, 'filed once');
    });

    it('a filing that fails is said and tried again', async () => {
      const vault = copyOf();
      const { run, calls } = await startWith(vault, { failFirst: true });
      await act(run, [{ type: 'jot', id: 'c1-1', text: 'The party camps.' }]);
      await waitFor(() => fs.existsSync(logOf(vault, run)) && /The party camps\./.test(fs.readFileSync(logOf(vault, run), 'utf8')));
      assert.strictEqual(calls.length, 2);
    });

    it('a command that wrote the note and then failed has still filed it: no refused retries', async () => {
      const vault = copyOf();
      const session = next(vault);
      const f = filer(vault, session);
      const t = createTableServer({ vaultPath: vault, session, fileLog: ['gma'],
        deps: { delayMs: 20, retryMs: [20], recordRetryMs: [20], runFileLog: (c) => { f.runFileLog(c); return { ok: false, why: 'timed out' }; } } });
      const port = await listenLocal(t.server, 0);
      const run = { ...t, port, session, stateId: stateIdOf(session) };
      servers.push(run);
      await act(run, [{ type: 'jot', id: 'c1-1', text: 'The party camps.' }]);
      await waitFor(() => fs.existsSync(logOf(vault, run)) && /The party camps\./.test(fs.readFileSync(logOf(vault, run), 'utf8')));
      await wait(120);
      assert.strictEqual(f.calls.length, 1, 'run once, never again');
    });

    it('a start with play already in the state and no log files it at once', async () => {
      const vault = copyOf();
      const { run: first } = await startFiling(vault);
      await act(first, [{ type: 'jot', id: 'c1-1', text: 'The party camps.' }]);
      await waitFor(() => fs.existsSync(path.join(tableDir(vault), `${first.stateId}.json`)));
      await first.close();
      // a retry a minute off: only the filing while the server is built can pass this
      const { run, calls } = await startWith(vault, { recordRetryMs: [60000] });
      await waitFor(() => fs.existsSync(logOf(vault, run)) && /The party camps\./.test(fs.readFileSync(logOf(vault, run), 'utf8')));
      assert.strictEqual(calls.length, 1);
    });

    it('without --file-log nothing is filed, as before', async () => {
      const vault = copyOf();
      const { run, calls } = await startFiling(vault);
      assert.strictEqual((await req(run.port, 'GET', '/api/model')).json.tableLogOnFirst, false);
      await act(run, [{ type: 'jot', id: 'c1-1', text: 'The party camps.' }]);
      await waitFor(() => fs.existsSync(path.join(tableDir(vault), `${run.stateId}.json`)));
      await wait(100);
      assert.deepStrictEqual(calls, []);
      assert.ok(!fs.existsSync(logOf(vault, run)));
    });
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
      await waitFor(() => (mark === 'landed' ? /## Points landed\n\n- The Gate: the tracks/ : /## Tried and missed\n\n- The Gate: the bell/).test(logLf(vault)));
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
      await waitFor(() => /Points landed/.test(logLf(vault)));
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
      await waitFor(() => /Points landed/.test(logLf(vault)));
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
        await waitFor(() => /Points landed/.test(logLf(vault)));
        await wait(100);
        assert.deepStrictEqual(kept(vault, run.stateId), []);
        withHandLog(vault, '- 21:00 Typed in by hand mid-session.');
        const old = logText(vault);
        await markFirst(run, 'missed', 1);
        const names = await waitFor(() => { const k = kept(vault, run.stateId); return k.length ? k : null; });
        assert.strictEqual(fs.readFileSync(path.join(tableDir(vault), names[0]), 'utf8'), old);
        await waitFor(() => /## Tried and missed/.test(logLf(vault)) && /Tried and missed\n\n- /.test(logLf(vault)));
        await waitFor(() => sse.events.find((e) => e.event === 'record-kept'));
      } finally { sse.close(); }
    });
  });

  it('a restart with nothing changed writes nothing', async () => {
    const vault = copyOf();
    const a = await start(vault);
    await markFirst(a);
    await waitFor(() => /Points landed/.test(logLf(vault)));
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
    assert.match(logLf(vault), /## Points landed\n\n- The Gate: the tracks/);
    assert.strictEqual(readState(vault, a).recordHash, logHash(vault), 'the record hash reached disk');
    assert.ok(!fs.existsSync(path.join(tableDir(vault), `${a.stateId}.lock`)), 'a clean close removes the lock');
    const b = await start(vault, T, { deps: { delayMs: 1000 } });
    const sse = listen(b.port);
    try {
      await markFirst(b, 'missed', 1);
      await b.close();
      assert.deepStrictEqual(kept(vault, a.stateId), []);
      assert.ok(!sse.events.some((e) => e.event === 'record-kept'));
      assert.match(logLf(vault), /## Tried and missed\n\n- The Gate: the bell/);
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
      await waitFor(() => /Points landed\n\n- /.test(logLf(vault)));
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
      await waitFor(() => /Tried and missed\n\n- /.test(logLf(vault)));
      await wait(50);
      assert.deepStrictEqual(kept(vault, a.stateId), []);
    });

    it('the state was written, the log was not: the log is brought up to date at start', async () => {
      const vault = copyOf();
      const a = await start(vault, T);
      await markFirst(a, 'landed', 0);
      await waitFor(() => /Points landed\n\n- /.test(logLf(vault)));
      await wait(100);
      const log0 = logText(vault);
      const hash0 = readState(vault, a).recordHash;
      assert.strictEqual(hash0, logHash(vault));
      await markFirst(a, 'missed', 1);
      await waitFor(() => /Tried and missed\n\n- /.test(logLf(vault)));
      await wait(100);
      await a.close();
      // The state at S1 with S0's recordHash, the log at S0.
      fs.writeFileSync(path.join(vault, LOG), log0);
      const st = readState(vault, a);
      st.recordHash = hash0;
      fs.writeFileSync(stateFileOf(vault, a), JSON.stringify(st));
      staleLock(vault, a);
      const b = await start(vault, T, { deps: gone });
      assert.match(logLf(vault), /## Tried and missed\n\n- The Gate: the bell/, 'rewritten before the first click');
      await waitFor(() => readState(vault, b).recordHash === logHash(vault));
      assert.deepStrictEqual(kept(vault, a.stateId), []);
    });

    it("a first log write that failed before a stop leaves the skeleton: it is brought up to date at start", async () => {
      const vault = copyOf();
      const skeleton = logText(vault);
      const a = await start(vault, T);
      await markFirst(a, 'landed', 0);
      await waitFor(() => /Points landed\n\n- /.test(logLf(vault)));
      await wait(100);
      await a.close();
      fs.writeFileSync(path.join(vault, LOG), skeleton);
      const st = readState(vault, a);
      st.recordHash = null;
      fs.writeFileSync(stateFileOf(vault, a), JSON.stringify(st));
      const b = await start(vault, T);
      assert.match(logLf(vault), /## Points landed\n\n- The Gate: the tracks/, 'rewritten before the first click');
      assert.deepStrictEqual(kept(vault, a.stateId), [], 'the skeleton held nothing to keep');
      await b.close();
    });

    it('a log edited by hand while the sheet was off is left alone until the next change', async () => {
      const vault = copyOf();
      const a = await start(vault, T);
      await markFirst(a, 'landed', 0);
      await waitFor(() => /Points landed\n\n- /.test(logLf(vault)));
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
        assert.deepStrictEqual(sse.events[0].data.status, { saving: 'ok', saveError: null, record: 'ok', recordError: null, players: 'ok', playersError: null });
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
        assert.match(logLf(vault), /## Tried and missed\n\n- The Gate: the bell/);
        assert.strictEqual((await helloOf(run.port)).status.record, 'ok');
        assert.ok(!(await req(run.port, 'GET', '/api/model')).json.notices.some((n) => n.kind === 'record-failing'));
        assert.ok(lines.some((l) => /written again/.test(l)));
        assert.deepStrictEqual(kept(vault, run.stateId), []);
      } finally { sse.close(); }
    });

    it('a record retry renders the state on disk, never a newer one still waiting to be written', async () => {
      const vault = copyOf();
      let failing = true;
      const flaky = { ...fs, renameSync: (x, y) => { if (failing && y.endsWith('Table Log.md')) { const e = new Error('EBUSY: busy'); e.code = 'EBUSY'; throw e; } return fs.renameSync(x, y); } };
      const run = await start(vault, T, { deps: { fs: flaky, delayMs: 400, recordRetryMs: [30], log: () => {} } });
      const sse = listen(run.port);
      try {
        await markFirst(run, 'landed', 0);
        await waitFor(() => sse.events.find((e) => e.event === 'record-failed'));
        await markFirst(run, 'missed', 1); // rev 2: in memory, written 400 ms from now
        failing = false;
        await waitFor(() => sse.events.find((e) => e.event === 'record-ok'));
        const now = logLf(vault);
        assert.match(now, /## Points landed\n\n- The Gate: the tracks/);
        assert.doesNotMatch(now, /## Tried and missed\n\n- /, 'the log is not ahead of the saved state');
      } finally { sse.close(); }
    });

    it('a stop with a record write waiting on its retry gives it a last try', async () => {
      const vault = copyOf();
      let failing = true;
      const flaky = { ...fs, renameSync: (x, y) => { if (failing && y.endsWith('Table Log.md')) { const e = new Error('EBUSY: busy'); e.code = 'EBUSY'; throw e; } return fs.renameSync(x, y); } };
      const run = await start(vault, T, { deps: { fs: flaky, recordRetryMs: [60000], log: () => {} } });
      const sse = listen(run.port);
      try {
        await markFirst(run, 'landed', 0);
        await waitFor(() => sse.events.find((e) => e.event === 'record-failed'));
      } finally { sse.close(); }
      failing = false;
      await run.close();
      assert.match(logLf(vault), /## Points landed\n\n- The Gate: the tracks/);
    });

    it('a Table Log turned into another type mid-session is said once, not on every write', async () => {
      const vault = copyOf();
      const run = await start(vault, T, { deps: { log: () => {} } });
      const sse = listen(run.port);
      try {
        await markFirst(run, 'landed', 0);
        await waitFor(() => /Points landed\n\n- /.test(logLf(vault)));
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
        await waitFor(() => /## Points landed\n\n- The Gate: the tracks/.test(logLf(vault)));
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

describe('run sheet server: rolls and actions', () => {
  const post = (run, url, body, extra = {}) => req(run.port, 'POST', url, { body, ...extra });
  const jot = (id, text = 'A jot.', extra = {}) => ({ type: 'jot', id, text, ...extra });
  const stateOf = async (run) => (await req(run.port, 'GET', '/api/state')).json;

  it('roll answers numbers and changes no state', async () => {
    const run = await start(copyOf());
    const before = await stateOf(run);
    const r = await post(run, '/api/roll', { rolls: [{ sides: 20, mod: 5 }, { sides: 6 }] });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.results.length, 2);
    assert.ok(r.json.results[0].die >= 1 && r.json.results[0].die <= 20);
    assert.strictEqual(r.json.results[0].total, r.json.results[0].die + 5);
    assert.strictEqual(r.json.results[1].mod, 0);
    assert.strictEqual((await stateOf(run)).rev, before.rev);
  });

  it('roll answers every kind and refuses a bad item with the four kinds named', async () => {
    const run = await start(copyOf());
    const r = await post(run, '/api/roll', { rolls: [{ sides: 6 }, { against: 12 }, { damage: '2d+1', type: 'imp' }, { d100: { target: 50, difficulty: 'hard' } }] });
    assert.strictEqual(r.status, 200);
    const [a, b, c, d] = r.json.results;
    assert.ok(a.die >= 1 && b.dice.length === 3 && b.margin === 12 - b.total);
    // 2d+1 is 3 at the least (two 1s): `>= 4` failed one run in 36
    assert.ok(c.dice.length === 2 && c.type === 'imp' && c.total >= 3 && c.total === c.dice.reduce((x, y) => x + y, 0) + 1, JSON.stringify(c));
    assert.ok(d.needed === 25 && d.asked.bonus === 0);
    const bad = await post(run, '/api/roll', { rolls: [{ sides: 6 }, { foo: 1 }] });
    assert.strictEqual(bad.status, 400);
    assert.match(bad.json.error, /against.*d100.*damage/);
    assert.strictEqual((await post(run, '/api/roll', { rolls: [{ damage: '2d6x' }] })).status, 400);
    const core = await post(run, '/api/roll', { rolls: [{ damage: 'd6+2', type: 'cr' }, { damage: '2d6-1d4' }, { damage: 'd%' }] });
    assert.strictEqual(core.status, 200);
    assert.ok(core.json.results[0].dice.length === 1 && core.json.results[0].total >= 3 && core.json.results[0].total <= 8);
    assert.strictEqual(core.json.results[1].dice.length, 3);
    assert.match((await post(run, '/api/roll', { rolls: [{ damage: 'd' }] })).json.error, /d% or GURPS's 2d\+1/);
    assert.strictEqual((await post(run, '/api/roll', { rolls: [{ against: 100 }] })).status, 400);
  });

  it('roll refuses 65 rolls, a d7, a foreign Origin', async () => {
    const run = await start(copyOf());
    assert.strictEqual((await post(run, '/api/roll', { rolls: Array.from({ length: 65 }, () => ({ sides: 4 })) })).status, 400);
    assert.strictEqual((await post(run, '/api/roll', { rolls: Array.from({ length: 64 }, () => ({ sides: 4 })) })).status, 200);
    assert.strictEqual((await post(run, '/api/roll', { rolls: [{ sides: 7 }] })).status, 400);
    assert.strictEqual((await post(run, '/api/roll', { rolls: [{ sides: 20, mod: 100 }] })).status, 400);
    assert.strictEqual((await post(run, '/api/roll', { rolls: 'x' })).status, 400);
    assert.strictEqual((await post(run, '/api/roll', {})).status, 400);
    assert.strictEqual((await req(run.port, 'POST', '/api/roll', { headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status, 415);
    assert.strictEqual((await req(run.port, 'POST', '/api/roll', { body: '{"rolls": ' })).status, 400);
    assert.strictEqual((await post(run, '/api/roll', { rolls: [{ sides: 20 }] }, { headers: { Origin: 'http://evil.example' } })).status, 403);
    assert.strictEqual((await post(run, '/api/roll', { rolls: [{ sides: 20 }] }, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
    assert.strictEqual((await req(run.port, 'GET', '/api/roll')).status, 405);
  });

  it('roll is too big at 2 MB', async () => {
    const run = await start(copyOf());
    const r = await post(run, '/api/roll', { rolls: [], pad: 'x'.repeat(2 * 1024 * 1024 + 10) });
    assert.strictEqual(r.status, 413);
  });

  it('no dice code in web/', () => {
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    const files = walk(WEB).filter((f) => /\.(js|html|mjs)$/.test(f));
    assert.ok(files.length);
    for (const f of files) {
      const text = fs.readFileSync(f, 'utf8');
      for (const bad of ['Math.random', 'getRandomValues', 'randomInt']) assert.ok(!text.includes(bad), `${f} has ${bad}`);
    }
  });

  it('actions are reduced on the server', async () => {
    const run = await start(copyOf());
    const l = listen(run.port);
    const { model } = (await req(run.port, 'GET', '/api/model')).json;
    const b = model.beats[0];
    const p = b.points[0];
    const r = await post(run, '/api/actions', {
      stateId: run.stateId, base: 0, clientId: 'c9',
      actions: [{ type: 'mark', id: 'c9-1', point: p.key, mark: 'landed', beat: b.key, beatTitle: b.title, text: p.text }],
    });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.rev, 1);
    assert.deepStrictEqual(r.json.rejected, []);
    assert.strictEqual(r.json.state.points[p.key].mark, 'landed');
    assert.ok(!Number.isNaN(Date.parse(r.json.state.points[p.key].at)), 'a server time');
    assert.ok(Date.now() - Date.parse(r.json.state.points[p.key].at) < 5000);
    assert.strictEqual((await stateOf(run)).rev, 1);
    await waitFor(() => l.events.some((e) => e.event === 'state' && e.data.clientId === 'c9' && e.data.rev === 1));
    l.close();
  });

  it('actions: a repeat lands once', async () => {
    const run = await start(copyOf());
    const body = { stateId: run.stateId, base: 0, actions: [jot('c1-j1', 'Once.')] };
    const a = await post(run, '/api/actions', body);
    const b = await post(run, '/api/actions', body);
    assert.strictEqual(a.status, 200);
    assert.strictEqual(b.status, 200);
    const s = (await stateOf(run)).state;
    assert.strictEqual(s.jots.filter((j) => j.text === 'Once.').length, 1);
    assert.strictEqual(b.json.rev, a.json.rev, 'nothing changed, no new rev');
  });

  it('actions from another session get 409', async () => {
    const run = await start(copyOf());
    const r = await post(run, '/api/actions', { stateId: 'chapter-2--session-01-snowmelt', base: 0, actions: [jot('x-1')] });
    assert.strictEqual(r.status, 409);
    assert.strictEqual(r.json.reason, 'session');
    assert.strictEqual(r.json.stateId, run.stateId);
    assert.strictEqual(r.json.label, 'Session 2');
    assert.strictEqual(r.json.rev, 0);
    const s = await stateOf(run);
    assert.strictEqual(s.rev, 0);
    assert.strictEqual(s.state.jots.length, 0);
  });

  it('actions on an old base still apply', async () => {
    const run = await start(copyOf());
    for (let i = 1; i <= 3; i++) assert.strictEqual((await post(run, '/api/actions', { stateId: run.stateId, base: i - 1, actions: [jot(`a-${i}`, `J${i}`)] })).status, 200);
    const r = await post(run, '/api/actions', { stateId: run.stateId, base: 0, actions: [jot('old-1', 'Old base')] });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.rev, 4);
    assert.ok((await stateOf(run)).state.jots.some((j) => j.text === 'Old base'));
  });

  it('bad bodies get 400, 413, 415', async () => {
    const run = await start(copyOf());
    assert.strictEqual((await post(run, '/api/actions', { stateId: run.stateId, base: 0 })).status, 400);
    assert.strictEqual((await post(run, '/api/actions', { stateId: run.stateId, base: 0, actions: {} })).status, 400);
    assert.strictEqual((await post(run, '/api/actions', { stateId: run.stateId, base: 0, actions: Array.from({ length: 201 }, (_, i) => jot(`n-${i}`)) })).status, 400);
    assert.strictEqual((await post(run, '/api/actions', { stateId: run.stateId, base: 0, actions: Array.from({ length: 200 }, (_, i) => jot(`m-${i}`)) })).status, 200);
    assert.strictEqual((await req(run.port, 'POST', '/api/actions', { body: '{"actions": ' })).status, 400);
    assert.strictEqual((await req(run.port, 'POST', '/api/actions', { headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status, 415);
    assert.strictEqual((await post(run, '/api/actions', { stateId: run.stateId, base: 0, actions: [], pad: 'x'.repeat(2 * 1024 * 1024 + 10) })).status, 413);
    assert.strictEqual((await post(run, '/api/actions', { stateId: run.stateId, base: 0, actions: [jot('o-1')] }, { headers: { Origin: 'http://evil.example' } })).status, 403);
    assert.strictEqual((await post(run, '/api/actions', { stateId: run.stateId, base: 0, actions: [jot('o-2')] }, { headers: { 'Sec-Fetch-Site': 'same-site' } })).status, 403);
  });

  it('an unknown action type is ignored and changes nothing', async () => {
    const run = await start(copyOf());
    const r = await post(run, '/api/actions', { stateId: run.stateId, base: 0, actions: [{ type: 'nope', id: 'z-1' }, null, 5] });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.rev, 0, 'nothing changed');
    assert.deepStrictEqual(r.json.rejected, []);
  });

  it('an action that throws is skipped and named; the ones after it land', async () => {
    const real = RS.reduce;
    const run = await start(copyOf(), 'Session 02 - The Test', {
      deps: { reduce: (s, a, at) => { if (a.type === 'boom') throw new Error('it broke'); return real(s, a, at); }, log: () => {} },
    });
    const r = await post(run, '/api/actions', { stateId: run.stateId, base: 0, actions: [jot('k-1', 'Before'), { type: 'boom', id: 'k-2' }, jot('k-3', 'After')] });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.json.rejected, [{ id: 'k-2', type: 'boom', error: 'it broke' }]);
    assert.deepStrictEqual(r.json.state.jots.map((j) => j.text), ['Before', 'After']);
    assert.strictEqual(r.json.rev, 1, 'one bump for the whole post');
  });

  it("an action's own time is kept; a future one gets the server's", async () => {
    const run = await start(copyOf());
    const past = new Date(Date.now() - 600 * 1000).toISOString();
    const future = new Date(Date.now() + 3600 * 1000).toISOString();
    const r = await post(run, '/api/actions', {
      stateId: run.stateId, base: 0,
      actions: [jot('t-1', 'Own', { at: past }), jot('t-2', 'Future', { at: future }), jot('t-3', 'Junk', { at: 'yesterday' }), jot('t-4', 'None')],
    });
    const at = (t) => r.json.state.jots.find((j) => j.text === t).at;
    assert.strictEqual(at('Own'), past);
    for (const t of ['Future', 'Junk', 'None']) {
      assert.notStrictEqual(at(t), future);
      assert.ok(Math.abs(Date.now() - Date.parse(at(t))) < 5000, t);
    }
  });

  it("an action-only write rewrites the Table Log", async () => {
    const vault = copyOf();
    const run = await start(vault);
    const { model } = (await req(run.port, 'GET', '/api/model')).json;
    const b = model.beats[0];
    const p = b.points[0];
    await post(run, '/api/actions', {
      stateId: run.stateId, base: 0,
      actions: [{ type: 'mark', id: 'r-1', point: p.key, mark: 'landed', beat: b.key, beatTitle: b.title, text: p.text }],
    });
    await waitFor(() => /## Points landed\n\n- /.test(logLf(vault)));
    assert.ok(logLf(vault).includes(p.text.slice(0, 12)));
  });

  it('the PUT still works beside the actions', async () => {
    const run = await start(copyOf());
    const a = await post(run, '/api/actions', { stateId: run.stateId, base: 0, actions: [jot('p-1', 'By action')] });
    assert.strictEqual(a.json.rev, 1);
    const got = await stateOf(run);
    const put = await req(run.port, 'PUT', '/api/state', { body: { stateId: got.stateId, base: got.rev, state: got.state } });
    assert.strictEqual(put.status, 200);
    assert.strictEqual(put.json.rev, 2);
  });
});

describe('run sheet server: the players\' half', () => {
  const PLAYERS = path.join(__dirname, 'fixtures', 'run-sheet-players');
  const P_PLAN = 'Chapters/Chapter 1/Sessions/Session 03/Session 03 - Next - Plan.md';
  const P_PARTY = ['Characters/PCs/Ada Moss.md', 'Characters/PCs/Ben Hart.md'];
  const [P_ADA, P_BEN] = P_PARTY;
  const QUIET = 'Characters/NPCs/Quiet Dead.md';
  const GILT = 'Characters/NPCs/Masked Gilt.md';
  const playersRun = (deps = {}) => {
    const vault = copyOf(PLAYERS);
    return start(vault, 'Session 03 - Next', { party: P_PARTY, deps }).then((run) => ({ ...run, vault, model: readRunSheet(vault, P_PLAN, { party: P_PARTY }) }));
  };
  let seq = 0;
  const send = (run, actions) => req(run.port, 'POST', '/api/actions', { body: { stateId: run.stateId, base: 0, actions: actions.map((a) => ({ id: `pl-${++seq}`, ...a })) } });
  const moveTo = (pc, beat) => ({ type: 'move', pc, to: { beat: beat.key, spot: null, title: beat.title } });
  const beatOf = (run) => run.model.beats.find((b) => b.title === 'Ashfall Reckoning');
  const view = async (run) => (await req(run.port, 'GET', '/api/players/view')).json;

  // An SSE client on any route, keeping the raw text too.
  function stream(port, url) {
    const events = [];
    let raw = '';
    let resp = null;
    const r = http.get({ host: '127.0.0.1', port, path: url, headers: { Host: `127.0.0.1:${port}` } }, (res) => {
      resp = res;
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => {
        raw += c;
        buf += c;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const ev = /^event: (.+)$/m.exec(block);
          const data = /^data: (.+)$/m.exec(block);
          if (ev) events.push({ event: ev[1], text: data ? data[1] : null, data: data ? JSON.parse(data[1]) : null });
        }
      });
    });
    r.on('error', () => {});
    return { events, raw: () => raw, close: () => { r.destroy(); if (resp) resp.destroy(); } };
  }

  it('the view before any model load', async () => {
    const run = await playersRun();
    const r = await req(run.port, 'GET', '/api/players/view');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.campaign, 'The Test Campaign');
    assert.strictEqual(r.json.layout, 'none');
  });

  it('players\' view answers with no GM keys', async () => {
    const run = await playersRun();
    await send(run, [moveTo(P_BEN, beatOf(run)), { type: 'show', group: beatOf(run).key, note: GILT, on: true }]);
    const r = await req(run.port, 'GET', '/api/players/view');
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(Object.keys(r.json).sort(), ['campaign', 'layout', 'panels']);
    for (const bad of ['serverId', 'stateId', 'rev', 'label', 'notices', run.serverId, run.stateId, 'Ashfall', '_attachments', '.md']) assert.ok(!r.text.includes(bad), bad);
    assert.strictEqual(r.json.panels[0].people[0].name, 'Masked Gilt');
  });

  it('players\' stream: hello then view; reconnect gets the view', async () => {
    const run = await playersRun();
    await send(run, [moveTo(P_BEN, beatOf(run))]);
    const a = stream(run.port, '/api/players/events');
    await waitFor(() => a.events.length >= 2);
    assert.deepStrictEqual(a.events.map((e) => e.event), ['hello', 'view']);
    assert.strictEqual(a.events[0].text, '{}');
    assert.deepStrictEqual(a.events[1].data, await view(run));
    a.close();
    const b = stream(run.port, '/api/players/events');
    await waitFor(() => b.events.length >= 2);
    assert.deepStrictEqual(b.events.map((e) => e.event), ['hello', 'view']);
    assert.strictEqual(b.events[1].data.panels.length, 1);
    b.close();
  });

  it('the view is broadcast only when it changes', async () => {
    const run = await playersRun();
    const a = stream(run.port, '/api/players/events');
    await waitFor(() => a.events.length >= 2);
    await send(run, [{ type: 'jot', text: 'A jot.' }]);
    await wait(100);
    assert.strictEqual(a.events.filter((e) => e.event === 'view').length, 1, 'a jot changes nothing the players see');
    await send(run, [moveTo(P_BEN, beatOf(run))]);
    await waitFor(() => a.events.filter((e) => e.event === 'view').length === 2);
    assert.strictEqual(a.events[a.events.length - 1].data.panels.length, 1);
    a.close();
  });

  it('the players\' stream carries only hello and view', async () => {
    const run = await playersRun();
    const gm = listen(run.port);
    const a = stream(run.port, '/api/players/events');
    await waitFor(() => a.events.length >= 2);
    await send(run, [moveTo(P_BEN, beatOf(run))]);
    const got = (await req(run.port, 'GET', '/api/state')).json;
    const s = RS.reduce(got.state, { type: 'jot', id: 'pl-put', text: 'By PUT.' }, '2026-11-20T20:00:00.000Z');
    assert.strictEqual((await req(run.port, 'PUT', '/api/state', { body: { stateId: got.stateId, base: got.rev, state: s } })).status, 200);
    await req(run.port, 'GET', '/api/model');
    await waitFor(() => gm.events.some((e) => e.event === 'saved'));
    await wait(100);
    const names = [...a.raw().matchAll(/^event: (.+)$/gm)].map((m) => m[1]);
    assert.deepStrictEqual([...new Set(names)].sort(), ['hello', 'view']);
    assert.ok(!/^data: .*"(?:rev|serverId|stateId)"/m.test(a.raw()));
    assert.ok(/^data: \{\}$/m.test(a.raw()), 'hello is {}');
    gm.close();
    a.close();
  });

  it('pic ids serve current pictures only', async () => {
    const run = await playersRun();
    const beat = beatOf(run);
    await send(run, [moveTo(P_BEN, beat), { type: 'show', group: beat.key, note: QUIET, on: true }]);
    const quiet = (await view(run)).panels[0].people[0].pic;
    assert.match(quiet, /^\/players\/pic\/[0-9a-f]{20}$/);
    const r = await req(run.port, 'GET', quiet);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.headers['content-type'], 'image/png');
    assert.strictEqual(r.text.length > 0, true);
    await send(run, [{ type: 'show', group: beat.key, note: QUIET, on: false }]);
    assert.strictEqual((await req(run.port, 'GET', quiet)).status, 200, 'the previous view\'s picture still serves');
    await send(run, [{ type: 'show', group: beat.key, note: GILT, on: true }]);
    const gone = await req(run.port, 'GET', quiet);
    assert.strictEqual(gone.status, 404, 'two views ago');
    assert.strictEqual(gone.text, 'Not found');
    assert.strictEqual((await req(run.port, 'GET', '/players/pic/0123456789abcdef0123')).status, 404);
    assert.strictEqual((await req(run.port, 'GET', '/players/pic/../x')).status, 404);
    assert.strictEqual((await req(run.port, 'GET', '/players/pic/%2e%2e%2f_attachments%2fquiet-face.png')).status, 404);
  });

  it('a missing picture answers the fixed body', async () => {
    const lines = [];
    const run = await playersRun({ log: (l) => lines.push(l) });
    const beat = beatOf(run);
    await send(run, [moveTo(P_BEN, beat), { type: 'show', group: beat.key, note: QUIET, on: true }]);
    const quiet = (await view(run)).panels[0].people[0].pic;
    fs.rmSync(path.join(run.vault, '_attachments', 'quiet-face.png'));
    const r = await req(run.port, 'GET', quiet);
    assert.strictEqual(r.status, 404);
    assert.strictEqual(r.text, 'Not found');
    assert.ok(lines.some((l) => l.includes('quiet-face.png')), 'the terminal is told which file');
  });

  it('a forPlayers that throws keeps the last view and tells the GM', async () => {
    const { forPlayers } = require('../lib/run-sheet/players');
    let broken = false;
    const lines = [];
    const run = await playersRun({ forPlayers: (...a) => { if (broken) throw new Error('boom\nmore'); return forPlayers(...a); }, log: (l) => lines.push(l) });
    const gm = listen(run.port);
    await send(run, [moveTo(P_BEN, beatOf(run))]);
    const before = await view(run);
    assert.strictEqual(before.panels.length, 1);
    broken = true;
    await send(run, [moveTo(P_ADA, beatOf(run))]);
    const after = await req(run.port, 'GET', '/api/players/view');
    assert.strictEqual(after.status, 200);
    assert.deepStrictEqual(after.json, before, 'the last good view stays');
    await waitFor(() => gm.events.some((e) => e.event === 'players-failed'));
    assert.strictEqual(gm.events.find((e) => e.event === 'players-failed').data.text, "The players' screen could not be updated: boom");
    const m = (await req(run.port, 'GET', '/api/model')).json;
    assert.ok(m.notices.some((x) => x.kind === 'players-failing' && x.text === "The players' screen could not be updated: boom"));
    assert.ok(lines.some((l) => l.includes('boom')));
    broken = false;
    await send(run, [{ type: 'jot', text: 'Again.' }]);
    await waitFor(() => gm.events.some((e) => e.event === 'players-ok'));
    assert.strictEqual((await view(run)).panels[0].pcs.length, 2);
    assert.ok(!(await req(run.port, 'GET', '/api/model')).json.notices.some((x) => x.kind === 'players-failing'));
    gm.close();
  });

  it('a players\' route never answers with an error\'s own words', async () => {
    const run = await playersRun({ forPlayers: () => { throw new Error('secret words'); }, log: () => {} });
    const r = await req(run.port, 'GET', '/api/players/view');
    assert.strictEqual(r.status, 503);
    assert.deepStrictEqual(r.json, { error: 'unavailable' });
    const a = stream(run.port, '/api/players/events');
    await waitFor(() => a.events.length >= 1);
    await wait(50);
    assert.deepStrictEqual(a.events.map((e) => e.event), ['hello']);
    assert.ok(!a.raw().includes('secret'));
    a.close();
    const run2 = await playersRun({ readRunSheet: () => { throw new Error('the plan says secret things'); }, log: () => {} });
    const r2 = await req(run2.port, 'GET', '/api/players/view');
    assert.deepStrictEqual(r2.json, { error: 'unavailable' });
    assert.ok(!r2.text.includes('secret'));
  });

  it('a 5a-shaped PUT keeps the fight keys', async () => {
    const run = await playersRun();
    // a fight ended, one running, a person shown: every fight key holds something
    const b = beatOf(run);
    await send(run, [
      moveTo(P_PARTY[0], b),
      { type: 'show', group: b.key, note: 'Characters/NPCs/Brother Venn.md', on: true },
      { type: 'fightStart', beat: b.key, title: b.title, groups: [b.key], rows: [] },
    ]);
    const first = (await req(run.port, 'GET', '/api/state')).json.state.fight.id;
    await send(run, [{ type: 'fightEnd', fight: first }, { type: 'fightStart', beat: b.key, title: b.title, groups: [b.key], rows: [] }]);
    const got = (await req(run.port, 'GET', '/api/state')).json;
    const before = ['fight', 'fights', 'panels', 'shownEver'].map((k) => got.state[k]);
    assert.ok(before[0] && before[1].length === 1 && Object.keys(before[2]).length && Object.keys(before[3]).length, 'seeded');
    const old = { ...got.state };
    for (const k of ['fight', 'fights', 'panels', 'shownEver']) delete old[k];
    old.jots = [{ id: 'x', text: 'From an old tab.', at: '2026-11-20T20:00:00.000Z', beat: null, spot: null }];
    assert.strictEqual((await req(run.port, 'PUT', '/api/state', { body: { stateId: got.stateId, base: got.rev, state: old } })).status, 200);
    const s = (await req(run.port, 'GET', '/api/state')).json.state;
    assert.deepStrictEqual([s.fight, s.fights, s.panels, s.shownEver], before);
    assert.strictEqual(s.jots[0].text, 'From an old tab.', 'the PUT\'s own keys win');
    assert.strictEqual((await req(run.port, 'GET', '/api/players/view')).status, 200);
  });

  it('players\' routes refuse a foreign Host', async () => {
    const run = await playersRun();
    for (const url of ['/players', '/players/players.js', '/api/players/view', '/api/players/events', '/players/pic/0123456789abcdef0123']) {
      const r = await req(run.port, 'GET', url, { headers: { Host: `evil.example:${run.port}` } });
      assert.strictEqual(r.status, 403, url);
    }
    assert.strictEqual((await req(run.port, 'POST', '/api/players/view', { body: {} })).status, 405);
    assert.strictEqual((await req(run.port, 'GET', '/players/nothing-here.js')).text, 'Not found');
  });
});

// plan 6a Task 8: POST /api/settings/side-colours
describe('the side-colours setting', () => {
  const YAML = require('yaml');
  const OLD_POLL = { ok: true, ours: false, spec: 'gm-apprentice-publish@1.70.40', installedBefore: '1.70.40' };
  const settingsOf = (vault) => YAML.parse(fs.readFileSync(path.join(vault, '_meta', 'vault-config.yaml'), 'utf8'));
  const withSite = (vault) => {
    const cfg = settingsOf(vault);
    cfg.player_site = { ...cfg.player_site, folder: 'site' };
    fs.writeFileSync(path.join(vault, '_meta', 'vault-config.yaml'), YAML.stringify(cfg));
    fs.mkdirSync(path.join(vault, 'site'));
  };
  const post = (run, body) => req(run.port, 'POST', '/api/settings/side-colours', { body });

  it('POST writes the vault setting', async () => {
    const vault = copyOf();
    const run = await start(vault);
    const own = { pc: '#112233', ally: '#223344', foe: '#334455', neutral: '#445566' };
    const r = await post(run, { preset: 'own', own });
    assert.strictEqual(r.status, 200, r.text);
    const cfg = settingsOf(vault);
    assert.strictEqual(cfg.vault.run_sheet.side_colours, 'own');
    assert.strictEqual(cfg.vault.run_sheet.own_colours.foe, '#334455');
    const m = await req(run.port, 'GET', '/api/model');
    assert.deepStrictEqual(m.json.model.sideColours, { preset: 'own', own });
    const back = await post(run, { preset: 'colour_blind' });
    assert.strictEqual(back.status, 200, back.text);
    assert.strictEqual(settingsOf(vault).vault.run_sheet.side_colours, 'colour_blind');
    assert.strictEqual(settingsOf(vault).vault.run_sheet.own_colours.pc, '#112233', 'own colours are kept');
  });
  it('a write is announced to an open page, which re-reads the model', async () => {
    const run = await start(copyOf());
    const events = listen(run.port);
    await wait(50);
    const r = await post(run, { preset: 'colour_blind' });
    assert.strictEqual(r.status, 200, r.text);
    await waitFor(() => events.events.some((e) => e.event === 'side-colours'));
    events.close();
  });
  it('POST with an unknown preset is 400', async () => {
    const vault = copyOf();
    const run = await start(vault);
    const before = fs.readFileSync(path.join(vault, '_meta', 'vault-config.yaml'), 'utf8');
    assert.strictEqual((await post(run, { preset: 'neon' })).status, 400);
    assert.strictEqual((await post(run, { preset: 'own', own: { pc: 'red' } })).status, 400);
    assert.strictEqual((await post(run, {})).status, 400);
    assert.strictEqual(fs.readFileSync(path.join(vault, '_meta', 'vault-config.yaml'), 'utf8'), before);
  });
  it('POST on a site pinned to an older tool is 409 and writes nothing', async () => {
    const vault = copyOf();
    withSite(vault);
    const before = fs.readFileSync(path.join(vault, '_meta', 'vault-config.yaml'), 'utf8');
    const run = await start(vault, 'Session 02 - The Test', { deps: { pinCheck: () => OLD_POLL } });
    const r = await post(run, { preset: 'colour_blind' });
    assert.strictEqual(r.status, 409);
    assert.match(r.json.error, /gma update/);
    assert.strictEqual(fs.readFileSync(path.join(vault, '_meta', 'vault-config.yaml'), 'utf8'), before);
  });
  it('POST when the site tool cannot be checked is 409 and writes nothing', async () => {
    const vault = copyOf();
    withSite(vault);
    const before = fs.readFileSync(path.join(vault, '_meta', 'vault-config.yaml'), 'utf8');
    const run = await start(vault, 'Session 02 - The Test', { deps: { pinCheck: () => { throw new Error('no network\nmore'); } } });
    const r = await post(run, { preset: 'colour_blind' });
    assert.strictEqual(r.status, 409);
    assert.match(r.json.error, /could not be checked \(no network\).*nothing was written/);
    assert.strictEqual(fs.readFileSync(path.join(vault, '_meta', 'vault-config.yaml'), 'utf8'), before);
  });
  it('a partial own, and own colours under another preset, write what was given', async () => {
    const vault = copyOf();
    const run = await start(vault);
    assert.strictEqual((await post(run, { preset: 'own', own: { foe: '#AA0000' } })).status, 200);
    let c = settingsOf(vault).vault.run_sheet;
    assert.strictEqual(c.own_colours.foe, '#aa0000');
    assert.strictEqual(c.own_colours.pc, undefined, 'only the given colour is written');
    assert.strictEqual((await post(run, { preset: 'pens', own: { pc: '#010203' } })).status, 200);
    c = settingsOf(vault).vault.run_sheet;
    assert.strictEqual(c.side_colours, 'pens');
    assert.strictEqual(c.own_colours.pc, '#010203');
    assert.strictEqual(c.own_colours.foe, '#aa0000');
  });
  it('POST when the model cannot be re-read after the write answers 200 with what the file now holds', async () => {
    const vault = copyOf();
    let broken = false;
    const run = await start(vault, 'Session 02 - The Test', { deps: { readRunSheet: (...a) => { if (broken) throw new Error('boom'); return readRunSheet(...a); } } });
    broken = true;
    const r = await post(run, { preset: 'own', own: { foe: ' #AA0000 ' } });
    assert.strictEqual(r.status, 200, r.text);
    assert.strictEqual(r.json.note, 'saved, but the sheet could not be re-read');
    assert.deepStrictEqual(r.json.sideColours, { preset: 'own', own: { pc: '#2c7739', ally: '#7a3fb0', foe: '#aa0000', neutral: '#646870' } });
  });
  it('POST on a site with a current tool, or on a vault with no site, writes', async () => {
    const vault = copyOf();
    withSite(vault);
    const run = await start(vault, 'Session 02 - The Test', { deps: { pinCheck: () => ({ ok: true, ours: false, spec: `gm-apprentice-publish@${SITE_TOOL_FROM}`, installedBefore: SITE_TOOL_FROM }) } });
    assert.strictEqual((await post(run, { preset: 'colour_blind' })).status, 200);
    // no site: the gate is not asked, so an old answer changes nothing
    const bare = await start(copyOf(), 'Session 02 - The Test', { deps: { pinCheck: () => OLD_POLL } });
    assert.strictEqual((await post(bare, { preset: 'colour_blind' })).status, 200);
  });
});
