'use strict';
// The players' screen leak test (plan 5b Task 8, spec §6.8): nothing the GM keeps back reaches the players.
//
// A scripted session (helpers/run-sheet-leak-script.js) runs against the server in this process, on a copy
// of the players' fixture. After every step the test collects everything the players' half can answer:
// their page and its files, the view, every picture the view names, and every event on their stream. It
// renders each view with the served render.js, as the players' page does. Then it checks:
//
// - no forbidden string is in any of it (the list is read from the fixture's notes, not typed here);
// - every view's keys are exactly the players' whitelist, and a foe's row is name, ini, current, out, lair;
// - no answer sets a cookie or a CORS header, and no header value holds a forbidden string;
// - the players' stream names only `hello` (data `{}`) and `view`;
// - every picture served is, byte for byte, a picture the step allows;
// - positive control: every string the step forbids IS in the GM's own answers, so a sentinel the fixture
//   lost fails here instead of passing for ever.
//
// Matching (Review M5): long sentinels (four digits and up, GMNOTE lines, names, paths) anywhere in the
// bytes collected; short tokens (`+97`, `2/Day`, `(3)`) on word boundaries, in the views, the events and the
// rendered markup only, never in the static scripts. A `dead` flag is checked by keys, a hidden fate by its text.
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const matter = require('gray-matter');
const { createTableServer, listenLocal } = require('../lib/run-sheet/server');
const { listSessions, pickSession, stateIdOf } = require('../lib/run-sheet/sessions');
const { readRunSheet } = require('../lib/run-sheet/read');
const { forPlayers } = require('../lib/run-sheet/players');
const S = require('./helpers/run-sheet-leak-script');
const { browserSkip } = require('./helpers/browser');

const FIXTURE = path.join(__dirname, 'fixtures', 'run-sheet-players');
const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

const wait = (ms) => new Promise((r) => { setTimeout(r, ms); });
async function waitFor(fn, what, ms = 10000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await wait(10);
  }
}

function req(port, method, url, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const headers = { Host: `127.0.0.1:${port}` };
    if (data !== undefined) headers['Content-Type'] = 'application/json';
    const r = http.request({ host: '127.0.0.1', port, method, path: url, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const bytes = Buffer.concat(chunks);
        const text = bytes.toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* not json */ }
        resolve({ url, status: res.statusCode, headers: res.headers, bytes, text, json });
      });
    });
    r.on('error', reject);
    if (data !== undefined) r.write(data);
    r.end();
  });
}

// An event stream, raw text kept. `events` are { event, data } as they arrive.
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
        const ev = /^event: (.*)$/m.exec(block);
        const data = /^data: (.*)$/m.exec(block);
        if (ev) events.push({ event: ev[1], text: data ? data[1] : null });
      }
    });
  });
  r.on('error', () => {});
  return { events, raw: () => raw, headers: () => (resp ? resp.headers : null), close: () => { r.destroy(); if (resp) resp.destroy(); } };
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const forms = (s) => [...new Set([s, escHtml(s), JSON.stringify(s).slice(1, -1), escHtml(s).replace(/&#39;/g, '&#x27;')])];
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const clean = (line) => String(line).replace(/^#+\s*/, '').replace(/^[-*]\s+/, '').replace(/\*\*/g, '').replace(/\[\[|\]\]/g, '').trim();

// ---- the forbidden list, read from the fixture ----
// Each entry: { text | re, short, why, control } — `short` matches on word boundaries in the views, events
// and markup only; `control: false` for a string the GM's answers cannot hold (the temp folder). `plan: null` (a no-Plan
// sheet, Task 12): the notes' own entries only, nothing read from a Plan or its beats.
function forbiddenList(vault, model, { plan: planPath = S.PLAN, session: sessionName = S.SESSION, figures = true } = {}) {
  const out = [];
  const add = (text, why, opts = {}) => {
    const t = String(text || '').trim();
    if (t && !out.some((x) => x.text === t)) out.push({ text: t, why, short: false, control: true, ...opts });
  };
  const files = walk(vault).map((f) => path.relative(vault, f).split(path.sep).join('/'));
  const notes = files.filter((f) => f.endsWith('.md'));
  const pictures = files.filter((f) => /\.(png|jpe?g|gif|webp|svg)$/i.test(f));
  const sessionFoes = new Set((model.beats || []).flatMap((b) => (b.foes || []).map((f) => f.note).concat((b.who || []).map((w) => w.note))));

  for (const rel of notes) {
    add(rel, 'a vault path');
    const text = fs.readFileSync(path.join(vault, rel), 'utf8');
    let fm = {};
    let body = text;
    try { ({ data: fm, content: body } = matter(text)); } catch { fm = {}; }
    const lines = body.split(/\r?\n/);
    const type = String(fm.type || '').toLowerCase();
    for (const l of lines) {
      const g = /GMNOTE-[^\r\n<]*/.exec(l);
      if (g) add(g[0].trim(), 'a GM Notes sentinel');
      if (/\*\*Dead\.\*\*/.test(l)) add(clean(l.replace(/^.*\*\*Dead\.\*\*/, '')), 'a hidden fate');
    }
    for (const a of [].concat(fm.gm_aliases || [])) add(a, 'a gm_alias');
    if (fm.unmasked_name) add(fm.unmasked_name, 'an unmasked name before Unmask');
    if (fm.withheld === true && fm.name) add(fm.name, 'a withheld note\'s name');
    if ((type === 'npc' || type === 'creature') && fm.name) add(fm.name, 'an unshown name');
    if (fm.doc_type === 'map' && /\(GM\)/.test(rel)) {
      add(fm.name, 'the GM map\'s name');
      add(path.posix.basename(rel, '.md'), 'the GM map\'s stem');
    }
    if (/\/Scenes\//.test(rel)) add(fm.name || path.posix.basename(rel, '.md'), 'a scene title');
    // a foe's numbers
    const st = /^###\s+Stats\s*$/m.exec(body);
    if ((type === 'npc' || type === 'creature') && st) {
      const rest = body.slice(st.index + st[0].length);
      const stop = rest.search(/^(?:#{2,3}\s|<!--)/m);
      const stats = stop >= 0 ? rest.slice(0, stop) : rest;
      // an ally's HP is on the players' order (decision 7), once the ally is: allowed with its name
      const ally = (model.beats || []).some((b) => (b.foes || []).some((f) => f.note === rel && f.ally));
      const hp = new Set([...stats.matchAll(/\b(?:HP|Hit Points)\**\s*(\d+)/g)].map((m) => m[1]));
      for (const m of stats.matchAll(/\d{4,}/g)) add(m[0], 'a foe number (sentinel)', ally && hp.has(m[0]) ? { with: fm.name } : {});
      // `figures: false` (the CoC and GURPS blocks): a foe's small numbers are the test's own named sentinels there,
      // since a fixture's ordinary figures (HP 12) are the PCs' too
      if (figures && sessionFoes.has(rel)) {
        for (const m of stats.matchAll(/\b(?:AC|HP|Hit Points)\**\s*(\d+)/g)) if (m[1].length < 4) add(m[1], 'a foe number', { short: true });
        for (const m of stats.matchAll(/Initiative\**\s*\+(\d+)/g)) add(`+${m[1]}`, 'a foe\'s initiative modifier', { short: true });
        for (const m of stats.matchAll(/\((\d+)\/Day\)/gi)) add(`${m[1]}/Day`, 'a Legendary Resistance count', { short: true });
        for (const m of stats.matchAll(/Legendary Actions\W*\((\d+)\)/g)) add(`(${m[1]})`, 'a legendary action count', { short: true });
      }
    }
  }
  for (const p of pictures) add(path.posix.basename(p), 'a picture file name');
  add('_attachments', 'a vault folder');
  add('GMNOTE', 'a GM Notes sentinel');
  out.push({ re: /\.md(?![A-Za-z0-9])/, text: '.md', why: 'a vault path', short: false, control: true });
  add('Recharge', 'a foe\'s recharge', { short: true });
  add('Legendary', 'a foe\'s legendary counters', { short: true });
  add('Bloodied', 'a foe\'s Bloodied (no PC or ally is Bloodied in the script)', { short: true });

  if (planPath === null) return out.filter((x) => x.re || x.text.length >= 4 || x.short);
  // the session's Plan: titles, each section's first line, and the beats' own words
  add(path.posix.basename(model.plan || planPath, '.md'), 'the Plan note');
  add(sessionName, 'the session\'s title');
  const plan = fs.readFileSync(path.join(vault, planPath), 'utf8').split(/\r?\n/);
  plan.forEach((l, i) => {
    if (!/^##\s/.test(l)) return;
    const after = plan.slice(i + 1).filter((x) => x.trim() && !/^---/.test(x));
    const first = after[0];
    if (first && !/^##\s/.test(first)) add(clean(first), 'a Plan section\'s first line');
    const prose = after.find((x) => !/GMNOTE/.test(x));
    if (prose && !/^##\s/.test(prose)) add(clean(prose), 'a Plan section\'s first line');
  });
  for (const b of model.beats) {
    add(b.title, 'a beat title');
    add(b.title.replace(/\s*\((?:hub|routing)\)\s*$/, ''), 'a beat title');
    for (const k of ['situation', 'startsIt', 'trigger', 'readAloud', 'complications']) if (String(b[k] || '').length >= 6) add(b[k], 'Plan text');
    if (String(b.then || '').length >= 6) add(clean(b.then), 'Plan text');
    for (const w of b.who || []) { add(w.wants, 'Plan text'); add(w.playAs, 'GM Notes text'); }
    for (const p of b.points || []) add(p.text, 'Plan text');
    for (const x of b.ifs || []) { add(x.do, 'Plan text'); add(x.then, 'Plan text'); }
    for (const sp of b.spots || []) { if (!sp.note) add(sp.name, 'a Plan-only spot'); add(sp.md, 'Plan text'); }
    for (const f of b.foes || []) add(f.name, 'an unseen foe\'s name');
  }
  // too short to be told apart from ordinary words
  return out.filter((x) => x.re || x.text.length >= 4 || x.short);
}

function matcher(x) {
  if (x.re) return (text) => x.re.test(text);
  if (x.short) {
    const res = forms(x.text).map((f) => new RegExp(`(?<![A-Za-z0-9_])${reEsc(f)}(?![A-Za-z0-9_])`));
    return (text) => res.some((re) => re.test(text));
  }
  const fs2 = forms(x.text);
  return (text) => fs2.some((f) => text.includes(f));
}

// ---- the players' whitelist ----
const VIEW_KEYS = ['campaign', 'layout', 'panels'].sort();
const PANEL_KEYS = ['backdrop', 'caption', 'id', 'order', 'pcs', 'people'].sort();
const WHO_KEYS = ['name', 'pic'];
const ORDER_KEYS = ['paused', 'round', 'rows'].sort();
const FOE_ROW = ['current', 'ini', 'lair', 'name', 'out'].sort();
const PC_ROW = ['current', 'hp', 'ini', 'lair', 'name', 'out', 'statuses'].sort();
const PIC = /^\/players\/pic\/[0-9a-f]{20}$/;
const keys = (o) => Object.keys(o).sort();

function checkShape(view, where) {
  assert.deepEqual(keys(view), VIEW_KEYS, `${where}: view keys`);
  assert.ok(['none', 'n1', 'n2', 'n4', 'n6', 'n8', 'n9'].includes(view.layout), `${where}: layout`);
  for (const p of view.panels) {
    assert.deepEqual(keys(p), PANEL_KEYS, `${where}: panel keys`);
    assert.ok(p.backdrop === null || PIC.test(p.backdrop), `${where}: backdrop ${p.backdrop}`);
    for (const w of p.pcs.concat(p.people)) {
      assert.deepEqual(keys(w), WHO_KEYS, `${where}: person keys`);
      assert.ok(w.pic === null || PIC.test(w.pic), `${where}: pic ${w.pic}`);
    }
    if (p.order === null) continue;
    assert.deepEqual(keys(p.order), ORDER_KEYS, `${where}: order keys`);
    for (const r of p.order.rows) {
      const k = keys(r);
      assert.ok(JSON.stringify(k) === JSON.stringify(FOE_ROW) || JSON.stringify(k) === JSON.stringify(PC_ROW), `${where}: row keys ${k}`);
      if (r.lair) assert.deepEqual(k, FOE_ROW, `${where}: the Lair row's keys`);
      if (r.statuses) assert.ok(r.statuses.every((x) => typeof x === 'string'));
    }
  }
}

// The order a fighting panel shows, against the state's fight: one row per ticked row, in order; foe and
// Lair rows carry only name, ini, current, out and lair (Review L1).
// A row is a PC by the model's word, never the row's (the PR review's L1). Changed on purpose by plan 6a
// Task 5 / review P1: a row is an ally by the row's own side as the GM has it now, and only once it is seen
// (an ally the reader infers starts unseen); an ally row not seen, a foe and a neutral carry a foe's keys.
function checkOrder(view, state, where, model) {
  const f = state.fight;
  const pcs = new Set((model.pcs || []).map((p) => p.note));
  for (const p of view.panels) {
    if (!f) { assert.equal(p.order, null, `${where}: no fight, no order`); continue; }
    if (!p.order) continue;
    const ticked = f.rows.filter((r) => r.in);
    assert.equal(p.order.rows.length, ticked.length, `${where}: one row per ticked row, no unticked one`);
    ticked.forEach((r, i) => {
      const named = r.kind !== 'lair' && (pcs.has(r.note) || (r.kind === 'ally' && Boolean(r.seen)));
      assert.deepEqual(keys(p.order.rows[i]), named ? PC_ROW : FOE_ROW, `${where}: ${r.kind} row keys`);
    });
  }
}

describe('the players\' screen leak test', () => {
  it('nothing the GM keeps back reaches the players, step by step', { timeout: 120000 }, async () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-leak-'));
    made.push(vault);
    fs.cpSync(FIXTURE, vault, { recursive: true });
    const model = readRunSheet(vault, S.PLAN, { party: S.PARTY });

    // a forPlayers that can be made to throw once, with GM words in its message
    const THROWN = `GMNOTE-thrown ${S.NOTES.GM_MAP} Hidden Abbot`;
    let throwNext = false;
    const lines = [];
    const deps = {
      delayMs: 20, retryMs: [20], pingMs: 40,
      log: (l) => lines.push(l),
      forPlayers: (...a) => { if (throwNext) { throwNext = false; throw new Error(`${THROWN}\nsecond line`); } return forPlayers(...a); },
    };
    const picked = pickSession(listSessions(vault), S.SESSION, vault);
    assert.ok(picked.session, picked.error);
    const run = createTableServer({ vaultPath: vault, session: picked.session, party: S.PARTY, deps });
    const port = await listenLocal(run.server, 0);
    const stateId = stateIdOf(picked.session);
    try {
      const forbidden = forbiddenList(vault, model);
      forbidden.push({ text: vault, why: 'the vault\'s folder', short: false, control: false });
      forbidden.push({ text: run.serverId, why: 'the serverId', short: false, control: true });
      forbidden.push({ text: stateId, why: 'the stateId', short: false, control: true });
      // a sanity check on the list itself: the fixture's sentinels are all in it
      for (const must of ['7342', '6173', '+97', 'GMNOTE-Glacier Wyrm', 'The Pale Courier Two', 'Lucan Truename', 'Hidden Abbot',
        'The Gate House', 'Ashfall Reckoning', 'Map of the Gate (GM)', 'gate-gm-secret.png', 'Died before the party came.', '2/Day', '(3)']) {
        assert.ok(forbidden.some((x) => x.text === must), `the forbidden list holds ${must}`);
      }
      const checks = forbidden.map((x) => ({ ...x, hit: matcher(x) }));

      // the GM's own answers about every note (static over the session) for the positive control
      const noteAnswers = [];
      for (const f of walk(vault).filter((x) => x.endsWith('.md'))) {
        const rel = path.relative(vault, f).split(path.sep).join('/');
        const r = await req(port, 'GET', `/api/note?path=${encodeURIComponent(rel)}`);
        if (r.status === 200) noteAnswers.push(r.text);
      }

      const pictures = walk(path.join(vault, '_attachments')).map((f) => `_attachments/${path.basename(f)}`);
      const picPath = (url) => {
        const id = url.slice('/players/pic/'.length);
        return pictures.find((p) => crypto.createHash('sha256').update(`${run.serverId}\n${p}`).digest('hex').slice(0, 20) === id) || null;
      };

      let seq = 0;
      const gm = stream(port, '/api/events');
      let players = stream(port, '/api/players/events');
      const oldStreams = [];
      const allowed = new Set();
      const allowedPics = new Set();
      let streamSeen = 0;
      let lastPaused = null;
      const collected = [];

      const t = {
        model,
        vault,
        id: () => `lk-${++seq}`,
        state: async () => { const r = await req(port, 'GET', '/api/state'); return { state: r.json.state, rev: r.json.rev }; },
        send: async (actions) => {
          const r = await req(port, 'POST', '/api/actions', { stateId, base: 0, actions: actions.map((a) => ({ id: `lk-${++seq}`, ...a })) });
          assert.equal(r.status, 200, r.text);
          assert.deepEqual(r.json.rejected, [], `no action rejected: ${JSON.stringify(r.json.rejected)}`);
          return r.json;
        },
        roll: async (rolls) => {
          if (!rolls.length) return [];
          const r = await req(port, 'POST', '/api/roll', { rolls });
          assert.equal(r.status, 200, r.text);
          return r.json.results;
        },
        checkpoint: async (name) => { lastPaused = await collect(`${t.step} (${name})`); },
        reconnect: async () => {
          oldStreams.push(players);
          players.close();
          players = stream(port, '/api/players/events');
          streamSeen = 0;
          await waitFor(() => players.events.length >= 2, 'hello and view after the reconnect');
          assert.deepEqual(players.events.slice(0, 2).map((e) => e.event), ['hello', 'view'], 'a reconnect gets hello, then the view');
          assert.equal(players.events[0].text, '{}');
          assert.deepEqual(JSON.parse(players.events[1].text), (await req(port, 'GET', '/api/players/view')).json, 'and the view is the current one');
        },
        missingPicture: async (rel) => {
          const v = (await req(port, 'GET', '/api/players/view')).json;
          const urls = v.panels.flatMap((p) => [p.backdrop, ...p.pcs.map((x) => x.pic), ...p.people.map((x) => x.pic)]).filter(Boolean);
          const url = urls.find((u) => picPath(u) === rel);
          assert.ok(url, `${rel} is on the view`);
          const keep = fs.readFileSync(path.join(vault, ...rel.split('/')));
          fs.rmSync(path.join(vault, ...rel.split('/')));
          const r = await req(port, 'GET', url);
          assert.equal(r.status, 404);
          assert.equal(r.text, 'Not found', 'a missing picture answers the fixed body');
          assert.ok(lines.some((l) => l.includes(path.posix.basename(rel))), 'the terminal is told which file');
          collected.push({ where: 'a missing picture', text: r.text, headers: r.headers, kind: 'static' });
          fs.writeFileSync(path.join(vault, ...rel.split('/')), keep);
        },
        throwOnce: async (actions) => {
          const before = (await req(port, 'GET', '/api/players/view')).text;
          const count = players.events.length;
          throwNext = true;
          await t.send(actions);
          const now = await req(port, 'GET', '/api/players/view');
          assert.equal(now.status, 200);
          assert.equal(now.text, before, 'a forPlayers that throws keeps the last view');
          await waitFor(() => gm.events.some((e) => e.event === 'players-failed'), 'the GM told');
          const told = JSON.parse(gm.events.find((e) => e.event === 'players-failed').text);
          assert.equal(told.text, `The players' screen could not be updated: ${THROWN}`);
          await wait(120);
          assert.equal(players.events.length, count, 'nothing new on the players\' stream');
          assert.ok(!players.raw().includes('thrown') && !now.text.includes('thrown'), 'the error\'s words stay off the players\' half');
        },
      };

      async function collect(where) {
        const got = [];
        for (const url of ['/players', '/players/players.js', '/players/render.js', '/players/players.css']) {
          const r = await req(port, 'GET', url);
          assert.equal(r.status, 200, `${where}: ${url}`);
          got.push({ where: `${where} ${url}`, text: r.text, headers: r.headers, kind: 'static' });
        }
        const v = await req(port, 'GET', '/api/players/view');
        assert.equal(v.status, 200, `${where}: the view`);
        got.push({ where: `${where} view`, text: v.text, headers: v.headers, kind: 'view' });
        const view = v.json;
        checkShape(view, where);
        const { state } = await t.state();
        checkOrder(view, state, where, model);

        // the stream has caught up with the view; what it sent since the last step is checked
        await waitFor(() => {
          const last = [...players.events].reverse().find((e) => e.event === 'view');
          return last && last.text === v.text;
        }, `${where}: the stream's view`);
        const fresh = players.events.slice(streamSeen);
        streamSeen = players.events.length;
        for (const e of fresh) {
          assert.ok(['hello', 'view'].includes(e.event), `${where}: the players' stream sent "${e.event}"`);
          if (e.event === 'hello') assert.equal(e.text, '{}', `${where}: hello is {}`);
          else checkShape(JSON.parse(e.text), `${where} (stream)`);
          got.push({ where: `${where} event ${e.event}`, text: e.text || '', kind: 'view' });
        }
        // the raw stream: only event/data pairs and pings, nothing else on the wire
        for (const s of [players, ...oldStreams]) {
          const blocks = s.raw().split('\n\n').filter((b) => b.length);
          for (const b of blocks) assert.ok(/^: ping$/.test(b) || /^event: (hello|view)\ndata: .*$/.test(b), `${where}: a stream block ${JSON.stringify(b.slice(0, 80))}`);
          const h = s.headers();
          if (h) got.push({ where: `${where} stream headers`, text: '', headers: h, kind: 'static' });
        }

        // rendered as the players' page renders it, with the render.js the server serves
        const sandbox = { self: {} };
        vm.runInNewContext(got.find((x) => x.where.endsWith('/players/render.js')).text, sandbox);
        const render = sandbox.self.RunSheetPlayersRender.renderPlayers;
        for (const e of [view, ...fresh.filter((x) => x.event === 'view').map((x) => JSON.parse(x.text))]) {
          got.push({ where: `${where} markup`, text: render(e), kind: 'view' });
        }

        // every picture: one the step allows, byte for byte
        const urls = view.panels.flatMap((p) => [p.backdrop, ...p.pcs.map((x) => x.pic), ...p.people.map((x) => x.pic)]).filter(Boolean);
        for (const url of new Set(urls)) {
          const rel = picPath(url);
          assert.ok(rel, `${where}: ${url} is a picture in the vault`);
          assert.ok(allowedPics.has(path.posix.basename(rel)), `${where}: ${rel} may not be shown yet`);
          const r = await req(port, 'GET', url);
          assert.equal(r.status, 200, `${where}: ${url}`);
          assert.ok(r.bytes.equals(fs.readFileSync(path.join(vault, ...rel.split('/')))), `${where}: ${url} serves ${rel}`);
          got.push({ where: `${where} picture headers`, text: '', headers: r.headers, kind: 'static' });
        }

        // headers: no cookie, no CORS
        for (const g of got.filter((x) => x.headers)) {
          assert.ok(!('set-cookie' in g.headers), `${g.where}: Set-Cookie`);
          assert.ok(!Object.keys(g.headers).some((k) => k.startsWith('access-control-')), `${g.where}: a CORS header`);
        }

        // the GM's own answers at this step
        const gmText = [(await req(port, 'GET', '/api/model')).text, (await req(port, 'GET', '/api/state')).text, ...noteAnswers].join('\n');
        assert.match(gmText, /"dead"\s*:/, 'the GM\'s answers hold a dead flag (positive control for the key check)');

        const active = checks.filter((x) => !allowed.has(x.text) && !(x.with && allowed.has(x.with)));
        for (const x of active) {
          if (x.control) assert.ok(x.hit(gmText), `${where}: positive control: "${x.text}" (${x.why}) is not in the GM's answers`);
          for (const g of got) {
            // a short number is matched in the body only: a header's Date or Content-Length holds numbers of its own
            // (`14:21:05` failed the step whenever the clock said 21)
            const texts = [g.text, ...(x.short ? [] : Object.values(g.headers || {}).flat().map(String))];
            if (x.short && g.kind !== 'view') continue;
            for (const text of texts) assert.ok(!x.hit(text.replace(/\/players\/pic\/[0-9a-f]{20}/g, '/players/pic/ID')), `${g.where}: "${x.text}" (${x.why}) reached the players`);
          }
        }
        for (const g of got.filter((x) => x.kind === 'view')) assert.ok(!/"dead"\s*:/.test(g.text), `${g.where}: a dead key`);
        collected.push(...got);
        return { view, state };
      }

      const expect = {
        '1': ({ view }) => {
          assert.equal(view.layout, 'n2');
          assert.deepEqual(view.panels.map((p) => p.pcs.map((x) => x.name)), [['Ada'], ['Ben']]);
          assert.equal(view.panels[0].caption, 'The Gate');
          assert.equal(view.panels[1].caption, null, 'a withheld place has no caption');
          assert.ok(view.panels[1].backdrop, 'and keeps its picture');
        },
        '2a': ({ view }) => assert.deepEqual(view.panels[0].people.map((x) => x.name), ['Masked Gilt']),
        '2b': ({ view }) => assert.deepEqual(view.panels[0].people.map((x) => x.name), ['Lucan Truename']),
        '3': ({ view }) => {
          assert.deepEqual(view.panels[0].people.map((x) => x.name), ['Lucan Truename', 'a stranger']);
          assert.equal(view.panels[0].people[1].pic, null, 'a withheld person has no face');
        },
        '4a': ({ view }) => { assert.equal(view.panels[0].caption, 'Map of the Gate'); assert.ok(view.panels[0].backdrop); },
        '4b': ({ view }) => { assert.equal(view.panels[0].backdrop, null, 'a GM map shows nothing'); assert.equal(view.panels[0].caption, null); },
        '5': ({ view }) => {
          const names = view.panels[0].order.rows.map((r) => r.name);
          assert.ok(names.includes('Brother Venn') && names.includes('Mephit 1') && names.includes('Mephit 2'), names.join(', '));
          assert.equal(view.panels[1].order, null, 'the panel not in the fight has no order');
        },
        '6': ({ view, state }) => {
          assert.ok(state.fight.round >= 2, 'a whole round went by');
          const wyrm = S.rowOf(state, S.NOTES.WYRM);
          assert.ok(wyrm.hp <= wyrm.max / 2 && wyrm.hp > 0, 'the wyrm is Bloodied');
          assert.ok(Object.keys(state.fight.lit).some((k) => k.endsWith(`|${wyrm.id}`)), 'its threshold lit');
          assert.equal(view.panels[0].order.round, state.fight.round);
          const ada = view.panels[0].order.rows.find((r) => r.name === 'Ada');
          assert.deepEqual([ada.hp, ada.statuses], ['17/30', ['Prone']]);
        },
        '7 (paused)': ({ view }) => assert.equal(view.panels[0].order.paused, true),
        '7': ({ view }) => assert.equal(view.panels[0].order.paused, false),
        '8': ({ view }) => {
          const names = view.panels[0].order.rows.map((r) => r.name);
          assert.ok(names.includes('Ice Mephit 1') && names.includes('Mephit 2'), names.join(', '));
        },
        '8b': ({ view }) => {
          const names = view.panels[0].order.rows.map((r) => r.name);
          assert.ok(names.includes('Mephit 1') && names.includes('Mephit 2'), names.join(', '));
        },
        '12 (hostile fight)': ({ view }) => {
          const names = view.panels[0].order.rows.map((r) => r.name);
          assert.ok(names.includes('Mephit 1'), `the model's word, not the row's: ${names.join(', ')}`);
          const wyrm = view.panels[0].order.rows.filter((r) => !('hp' in r));
          // plan 6a Task 5 / review P1: the row's side is the row's now, but an ally row the players have not
          // seen still goes up as a foe: the wyrm sent as an unseen ally shows no HP and no name
          assert.ok(wyrm.length >= 3, 'the wyrm sent as an unseen ally is still a foe: no HP');
        },
        '9': ({ view }) => {
          assert.ok(view.panels[1].order, 'the second group\'s panel shows the order');
          assert.deepEqual(view.panels[1].order, view.panels[0].order);
        },
        '10': ({ view }) => assert.ok(view.panels.every((p) => p.order === null)),
        '12': ({ view }) => {
          assert.deepEqual(view.panels[0].people.map((x) => x.name), ['Lucan Truename', 'a stranger'], 'nothing that is not a person goes up');
          assert.equal(view.panels[0].backdrop, null);
          assert.deepEqual([view.panels[1].backdrop, view.panels[1].caption], [null, null], 'a person is no backdrop');
          assert.ok(!JSON.stringify(view).includes('Nobody Here Either'));
        },
        '13': ({ view, state }) => {
          const ticked = state.fight.rows.filter((r) => r.in);
          const i = ticked.findIndex((r) => r.note === S.NOTES.ABBOT);
          assert.equal(ticked[i].seen, true);
          assert.match(view.panels[0].order.rows[i].name, /^(?:Stranger \d+|A stranger)$/, 'a seen withheld foe keeps the word');
        },
        '14': ({ view, state }) => {
          const wolf = S.rowOf(state, S.NOTES.WOLF);
          assert.equal(wolf.in, false);
          assert.ok(wolf.unseenN === null || wolf.unseenN === undefined, 'an unticked row takes no number');
          const nums = view.panels[0].order.rows.map((r) => /^Stranger (\d+)$/.exec(r.name)).filter(Boolean).map((m) => Number(m[1])).sort((a, b) => a - b);
          // numbers are fixed at first tick, so a shown row keeps its place in the count (decision 5); the
          // unticked wolf has none, so the ticked strangers hold exactly 1..k and no label goes past k
          // a foe seen when it joined (the abbot, shown in step 3) takes no number
          const strangers = state.fight.rows.filter((r) => r.in && r.kind === 'foe' && r.word === wolf.word && !(r.seen && r.unseenN == null));
          assert.deepEqual(strangers.map((r) => r.unseenN).sort((a, b) => a - b), strangers.map((_, k) => k + 1));
          assert.ok(nums.length >= 2 && Math.max(...nums) <= strangers.length, `no stranger numbered past ${strangers.length}: ${nums}`);
        },
        '15': ({ view }) => assert.deepEqual(view.panels[0].people.map((x) => x.name), ['a stranger'], 'the view moves on once forPlayers works again'),
      };

      await waitFor(() => players.events.length >= 1, 'hello');
      for (const step of S.STEPS) {
        t.step = step.name;
        const key = step.name.split(' ')[0];
        await step.run(t);
        for (const a of step.allow || []) allowed.add(a);
        for (const a of step.revoke || []) allowed.delete(a);
        for (const p of step.pics || []) allowedPics.add(p);
        const got = await collect(step.name);
        if (expect[key]) expect[key](got);
        // the checkpoints inside steps 7 and 12 have their own expectations
        if (key === '7') expect['7 (paused)'](lastPaused);
        if (key === '12') expect['12 (hostile fight)'](lastPaused);
      }
      assert.ok(collected.length > 100, 'the test looked at what the players were sent');
      gm.close();
      players.close();
    } finally {
      await run.close();
    }
  });
});

// plan 6a Task 5 / review P1: the players' screen takes a row's side from the row, as the GM has it now.
// Each case builds the fight as the page does, on the players' fixture read as it is, sends the GM's
// actions through the one `reduce`, and checks forPlayers' answer (and its rendered markup) against the
// same forbidden list the scripted session uses.
describe('the players\' screen follows the row\'s side (plan 6a Task 5 / review P1)', () => {
  const RS = require('../lib/run-sheet/web/state');
  const M = require('../lib/run-sheet/web/fight-math');
  const model = readRunSheet(FIXTURE, S.PLAN, { party: S.PARTY });
  const forbidden = forbiddenList(FIXTURE, model).map((x) => ({ ...x, hit: matcher(x) }));
  const sandbox = { self: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'lib', 'run-sheet', 'web', 'players', 'render.js'), 'utf8'), sandbox);
  const render = sandbox.self.RunSheetPlayersRender.renderPlayers;
  const VENN = 'Characters/NPCs/Brother Venn.md';
  const ABBOT = S.NOTES.ABBOT;
  const MEPHIT = S.NOTES.MEPHIT;
  let n = 0;
  const T0 = Date.parse('2026-11-20T19:00:00.000Z');
  const act = (s, a) => RS.reduce(s, { id: `p1-${++n}`, ...a }, new Date(T0 + n * 60000).toISOString());
  const gateOf = (m) => m.beats.find((b) => b.title === 'Ashfall Reckoning');
  const fight = (m = model) => {
    let s = RS.emptyState({ stateId: 's', session: 'x', plan: S.PLAN });
    s = act(s, { type: 'move', pc: S.NOTES.ADA, to: { beat: gateOf(m).key, spot: null, title: gateOf(m).title } });
    const id = `p1-${++n}`;
    const b = M.rowsForFight({ model: m, derived: RS.derive(m, s), state: s, beatKey: gateOf(m).key, idBase: id });
    return RS.reduce(s, { id, type: 'fightStart', beat: gateOf(m).key, title: gateOf(m).title, groups: b.groups, rows: b.rows, thresholds: b.thresholds }, new Date(T0).toISOString());
  };
  const rowOf = (s, note, copy = 1) => s.fight.rows.find((r) => r.note === note && r.copy === copy);
  const setSide = (s, note, side, copy) => act(s, { type: 'setSide', fight: s.fight.id, row: rowOf(s, note, copy).id, side });
  const view = (s, m = model) => forPlayers(m, s, { withheldWords: m.withheldWords, campaign: m.campaign, picId: () => '0'.repeat(20) });
  // the view's row for a fight row, by its place among the ticked rows
  const shown = (v, s, note, copy = 1) => v.panels[0].order.rows[s.fight.rows.filter((r) => r.in).findIndex((r) => r.note === note && r.copy === copy)];
  // nothing the step does not allow reaches the players: the view's JSON and its markup
  const clean = (v, allowed, where) => {
    checkShape(v, where);
    const texts = [JSON.stringify(v), render(v)];
    for (const x of forbidden) {
      if (allowed.has(x.text) || (x.with && allowed.has(x.with))) continue;
      for (const t of texts) assert.ok(!x.hit(t), `${where}: "${x.text}" (${x.why}) reached the players`);
    }
  };

  // changed on purpose by plan 6a Task 5 fix round 1 / review I2: a model-ally set to foe or neutral sends
  // no HP, and its name only if the players were already shown it (seen and ticked in as an ally)
  it('a model-ally set to foe or neutral sends no HP; the name only if it was already shown', () => {
    for (const side of ['foe', 'neutral']) {
      let s = fight();
      let v = view(s);
      assert.deepEqual(keys(shown(v, s, VENN)), PC_ROW, 'Brother Venn starts as the Plan\'s ally');
      assert.equal(shown(v, s, VENN).name, 'Brother Venn');
      s = setSide(s, VENN, side);
      v = view(s);
      assert.deepEqual(keys(shown(v, s, VENN)), FOE_ROW, `set to ${side}: a foe's keys`);
      assert.equal(shown(v, s, VENN).name, 'Brother Venn', 'shown already: the name stays');
      assert.ok(!JSON.stringify(v).includes('7343') && !render(v).includes('7343'), `set to ${side}: no HP`);
      clean(v, new Set(['Brother Venn']), `Brother Venn set to ${side}`);
      // benched, so never shown: no name either
      let b = fight();
      b = act(b, { type: 'fightTick', fight: b.fight.id, row: rowOf(b, VENN).id, in: false });
      b = setSide(b, VENN, side);
      b = act(b, { type: 'fightTick', fight: b.fight.id, row: rowOf(b, VENN).id, in: true });
      v = view(b);
      assert.deepEqual(keys(shown(v, b, VENN)), FOE_ROW);
      clean(v, new Set(), `Brother Venn, benched, set to ${side}`);
    }
  });

  // plan 6a Task 5 fix round 1 / review C1: one copy's switch is that copy's, never the note's. Changed on purpose by
  // the final review (ledger 86): the players saw "Ice Mephit 1" by name, so the next fight names the mephits (a
  // foe's keys, never the HP); a benched copy they never saw leaves no name behind.
  it('one mephit of two set to ally: the next fight is foe-shaped, named as the players saw it, and nothing is carried', () => {
    const next = (s) => {
      const id = `p1-${++n}`;
      const g = gateOf(model);
      const b = M.rowsForFight({ model, derived: RS.derive(model, s), state: s, beatKey: g.key, idBase: id });
      return RS.reduce(s, { id, type: 'fightStart', beat: g.key, title: g.title, groups: b.groups, rows: b.rows, thresholds: b.thresholds }, new Date(T0).toISOString());
    };
    let s = fight();
    s = setSide(s, MEPHIT, 'ally', 1);
    s = act(s, { type: 'fightEnd', fight: s.fight.id });
    assert.deepEqual(RS.derive(model, s).sidesSet, []);
    s = next(s);
    let v = view(s);
    for (const copy of [1, 2]) assert.deepEqual(keys(shown(v, s, MEPHIT, copy)), FOE_ROW, `mephit ${copy}`);
    assert.deepEqual([1, 2].map((c) => shown(v, s, MEPHIT, c).name), ['Ice Mephit 1', 'Ice Mephit 2']);
    clean(v, new Set(['Brother Venn', 'Ice Mephit', 'Ice Mephit 1', 'Ice Mephit 2']), 'the next fight');
    // benched while it was the ally: the players never saw it, so nothing is remembered
    let b = fight();
    b = act(b, { type: 'fightTick', fight: b.fight.id, row: rowOf(b, MEPHIT, 1).id, in: false });
    b = setSide(b, MEPHIT, 'ally', 1);
    b = act(b, { type: 'fightEnd', fight: b.fight.id });
    b = next(b);
    v = view(b);
    for (const copy of [1, 2]) assert.deepEqual(keys(shown(v, b, MEPHIT, copy)), FOE_ROW, `benched: mephit ${copy}`);
    clean(v, new Set(['Brother Venn']), 'the next fight after a benched ally');
  });

  it('an unseen inferred ally set to foe sends no name', () => {
    const m = JSON.parse(JSON.stringify(model));
    for (const f of m.beats.flatMap((x) => x.foes || []).concat((m.cast || []).map((c) => c.foe).filter(Boolean))) {
      if (f.note === VENN) Object.assign(f, { ally: true, allyBy: 'relationships', allyFrom: 'relationships: +2 with this party' });
    }
    let s = fight(m);
    assert.equal(rowOf(s, VENN).seen, false);
    s = setSide(s, VENN, 'foe');
    const v = view(s, m);
    assert.deepEqual(keys(shown(v, s, VENN)), FOE_ROW);
    clean(v, new Set(), 'an unseen inferred ally set to foe');
  });

  it('a model-foe set to ally sends its name and HP', () => {
    let s = fight();
    s = setSide(s, MEPHIT, 'ally', 1);
    const v = view(s);
    const r = shown(v, s, MEPHIT, 1);
    assert.deepEqual(keys(r), PC_ROW);
    assert.equal(r.name, 'Ice Mephit 1');
    assert.equal(r.hp, '7341/7341');
    clean(v, new Set(['Ice Mephit', 'Ice Mephit 1', '7341', 'Brother Venn']), 'a mephit set to ally');
    // the other mephit is still a foe, numbered by its word
    assert.deepEqual(keys(shown(v, s, MEPHIT, 2)), FOE_ROW);
    // plan 6a fix round 1 / review M3: the copy switched to ally still counts, so the other keeps its number
    assert.equal(shown(v, s, MEPHIT, 2).name, 'Mephit 2');
  });

  it('a withheld foe set to ally shows only its withheld word', () => {
    let s = fight();
    s = setSide(s, ABBOT, 'ally');
    const v = view(s);
    const r = shown(v, s, ABBOT);
    assert.equal(r.name, model.withheldWords.person);
    // its HP goes up as an ally's does; its name never does
    clean(v, new Set(['7344', 'Brother Venn']), 'the withheld abbot set to ally');
  });

  it('a neutral sends exactly a foe\'s keys', () => {
    const foe = fight();
    const neutral = setSide(fight(), 'Characters/NPCs/Masked Gilt.md', 'neutral');
    assert.equal(rowOf(neutral, 'Characters/NPCs/Masked Gilt.md').neutral, true);
    // the same fight with the row neutral: the players' view is the same, byte for byte
    assert.deepEqual(view(neutral), view(foe));
    // a Plan ally set neutral is the same as that ally set foe
    assert.deepEqual(view(setSide(fight(), VENN, 'neutral')), view(setSide(fight(), VENN, 'foe')));
  });

  it('an inferred ally with no seenFrom sends nothing named', () => {
    const inferred = (by, seenFrom) => {
      const m = JSON.parse(JSON.stringify(model));
      for (const f of m.beats.flatMap((b) => b.foes || []).concat((m.cast || []).map((c) => c.foe).filter(Boolean))) {
        if (f.note === VENN) Object.assign(f, { ally: true, allyBy: by, allyFrom: `${by}: +2 with this party` });
      }
      for (const c of m.cast || []) if (c.note === VENN) Object.assign(c, { ally: true, allyBy: by });
      if (seenFrom) m.seenFrom = { [VENN]: seenFrom };
      return m;
    };
    for (const by of ['relationships', 'affiliation', 'quickRef']) {
      const m = inferred(by);
      const s = fight(m);
      assert.equal(rowOf(s, VENN).kind, 'ally');
      assert.equal(rowOf(s, VENN).seen, false);
      const v = view(s, m);
      assert.deepEqual(keys(shown(v, s, VENN)), FOE_ROW, `${by}: a foe's keys`);
      clean(v, new Set(), `an ally by ${by}`);
      // with seenFrom it starts seen, and goes up as an ally
      const m2 = inferred(by, 'on the player site');
      const s2 = fight(m2);
      const v2 = view(s2, m2);
      assert.deepEqual(keys(shown(v2, s2, VENN)), PC_ROW);
      assert.equal(shown(v2, s2, VENN).name, 'Brother Venn');
      // and the GM switching it to ally is the GM's word: it goes up too
      const s3 = setSide(setSide(fight(m), VENN, 'neutral'), VENN, 'ally');
      assert.equal(shown(view(s3, m), s3, VENN).name, 'Brother Venn');
    }
  });

  // re-review (minor 3): a name the players saw in an ended fight never starts an INFERRED ally seen, with its HP
  it('a foe seen by name, its side dropped for a mixed group, then inferred an ally: the next fight sends no name and no HP', () => {
    const m = JSON.parse(JSON.stringify(model));
    for (const f of m.beats.flatMap((x) => x.foes || []).concat((m.cast || []).map((c) => c.foe).filter(Boolean))) {
      if (f.note === MEPHIT) Object.assign(f, { ally: true, allyBy: 'relationships', allyFrom: 'relationships: +2 with this party' });
    }
    for (const c of m.cast || []) if (c.note === MEPHIT) Object.assign(c, { ally: true, allyBy: 'relationships' });
    let s = fight(m);
    assert.deepEqual([1, 2].map((c) => [rowOf(s, MEPHIT, c).kind, rowOf(s, MEPHIT, c).seen]), [['ally', false], ['ally', false]]);
    // the GM sets one to foe (a mixed group: the note's side is dropped) and shows its name
    s = setSide(s, MEPHIT, 'foe', 1);
    assert.equal((s.sides || {})[MEPHIT], undefined);
    s = act(s, { type: 'seen', fight: s.fight.id, row: rowOf(s, MEPHIT, 1).id, on: true });
    assert.equal(shown(view(s, m), s, MEPHIT, 1).name, 'Ice Mephit 1', 'the players saw its name');
    s = act(s, { type: 'fightEnd', fight: s.fight.id });
    // the next fight: the reader infers both allies again; neither starts seen from what the players saw
    const id = `p1-${++n}`;
    const g = gateOf(m);
    const b = M.rowsForFight({ model: m, derived: RS.derive(m, s), state: s, beatKey: g.key, idBase: id });
    s = RS.reduce(s, { id, type: 'fightStart', beat: g.key, title: g.title, groups: b.groups, rows: b.rows, thresholds: b.thresholds }, new Date(T0).toISOString());
    assert.deepEqual([1, 2].map((c) => [rowOf(s, MEPHIT, c).kind, rowOf(s, MEPHIT, c).seen]), [['ally', false], ['ally', false]]);
    const v = view(s, m);
    for (const copy of [1, 2]) assert.deepEqual(keys(shown(v, s, MEPHIT, copy)), FOE_ROW, `mephit ${copy}: a foe's keys`);
    assert.ok(!JSON.stringify(v).includes('7341') && !render(v).includes('7341'), 'no HP');
    clean(v, new Set(['Brother Venn']), 'an inferred ally the players once saw as a foe');
  });

  it('after End fight the panel shows no order, whatever the sides', () => {
    let s = fight();
    s = setSide(s, MEPHIT, 'ally', 1);
    s = act(s, { type: 'fightEnd', fight: s.fight.id });
    const v = view(s);
    assert.ok(v.panels.every((p) => p.order === null));
    clean(v, new Set(), 'after End fight');
  });
});

// Changed on purpose: plan 6a Task 7 / Global Constraints (typed place). A place the GM types tonight in Move
// them goes to the players' screen as its plain name, as the panel's caption, and as nothing else: no picture,
// no key, no other words of the state. This is the one widening of forPlayers Task 7 makes.
describe('a place typed tonight (plan 6a Task 7 / Global Constraints (typed place))', () => {
  const RS = require('../lib/run-sheet/web/state');
  const model = readRunSheet(FIXTURE, S.PLAN, { party: S.PARTY });
  const forbidden = forbiddenList(FIXTURE, model).map((x) => ({ ...x, hit: matcher(x) }));
  const sandbox = { self: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'lib', 'run-sheet', 'web', 'players', 'render.js'), 'utf8'), sandbox);
  const render = sandbox.self.RunSheetPlayersRender.renderPlayers;
  const view = (s) => forPlayers(model, s, { withheldWords: model.withheldWords, campaign: model.campaign, picId: () => '0'.repeat(20) });
  let n = 0;
  const act = (s, a) => RS.reduce(s, { id: `tp-${++n}`, ...a }, new Date(Date.parse('2026-11-20T19:00:00Z') + n * 60000).toISOString());

  it('a typed place reaches players as its plain name and nothing else', () => {
    const gate = model.beats.find((b) => b.title === 'Ashfall Reckoning');
    let s = RS.emptyState({ stateId: 's', session: 'x', plan: S.PLAN });
    s = act(s, { type: 'move', pc: S.NOTES.ADA, to: { beat: gate.key, spot: null, title: gate.title } });
    s = act(s, { type: 'jot', beat: gate.key, text: 'JOTSENTINEL-4471 the GM wrote this' });
    const before = view(s);
    const typed = 'The <b>Rusty</b> Anchor';
    s = act(s, { id: 'tp-move', type: 'moveGroup', pcs: [S.NOTES.ADA], name: typed, names: ['Ada'] });
    const v = view(s);
    checkShape(v, 'a typed place');
    assert.equal(v.panels.length, before.panels.length);
    const p = v.panels[0];
    assert.deepEqual([p.caption, p.backdrop], [typed, null], 'the plain name as the caption, no picture');
    // nothing else the state holds goes with it: its key, the move's log line, a jot
    const texts = [JSON.stringify(v), render(v)];
    for (const t of texts) {
      assert.ok(!t.includes('pn-tp-move'), 'no key');
      assert.ok(!/moves to/.test(t), 'no log line');
      assert.ok(!t.includes('JOTSENTINEL'), 'no jot');
      assert.ok(!t.includes('(a new place)'));
    }
    assert.ok(!render(v).includes('<b>Rusty</b>'), 'the name is text, never markup');
    for (const x of forbidden) for (const t of texts) assert.ok(!x.hit(t), `"${x.text}" (${x.why}) reached the players`);
    // the same view as before, but for the caption and the panel's place
    const strip = (w) => JSON.stringify({ ...w, panels: w.panels.map((q) => ({ ...q, caption: null, backdrop: null })) });
    assert.equal(strip(v), strip(before));
    // Fight here at the typed place, for another group: the focused panel's caption is that name, and End fight puts it back
    let s2 = act(s, { type: 'move', pc: S.NOTES.BEN, to: { beat: gate.key, spot: null, title: gate.title } });
    s2 = act(s2, { id: 'tp-f', type: 'fightStart', beat: 'pn-tp-move', title: typed, groups: [gate.key], rows: [], thresholds: [], backdrop: { group: gate.key, place: 'pn-tp-move' } });
    const benPanel = (w) => w.panels.find((q) => q.pcs.some((x) => x.name === 'Ben'));
    assert.deepEqual([benPanel(view(s2)).caption, benPanel(view(s2)).backdrop], [typed, null]);
    s2 = act(s2, { type: 'fightEnd', fight: 'tp-f' });
    assert.equal(benPanel(view(s2)).caption, before.panels[0].caption);
  });
});

// Task 7 fix round 1, changed by Ant (the GM), who reversed review I3: "If the players go to a place that hasn't been
// published, it should become visible and become published." A place need not publish to reach the players'
// screen, but only the GM's own act puts it there: Move them, Fight here or Show. Never before; and the per-note
// rules hold (a place with no name of its own shows no caption; the picture goes as an opaque id).
describe('an unpublished place reaches the players only by the GM\'s act (plan 6a Task 7 fix round 1)', () => {
  const RS = require('../lib/run-sheet/web/state');
  const CELLAR = 'Locations/Secret Cellar.md';
  const PIC = '_attachments/secret-cellar.png';
  let n = 0;
  const act = (s, a) => RS.reduce(s, { id: `np-${++n}`, ...a }, new Date(Date.parse('2026-11-20T19:00:00Z') + n * 60000).toISOString());

  it('an unpublished place shows its picture only after the GM moves the party there, fights there or Shows it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-place-'));
    made.push(dir);
    fs.cpSync(FIXTURE, dir, { recursive: true });
    fs.copyFileSync(path.join(dir, '_attachments', 'gate-place.png'), path.join(dir, PIC));
    fs.writeFileSync(path.join(dir, CELLAR), '---\ntype: location\npublish: false\nportrait: secret-cellar.png\n---\n\nUnder the chapel.\n');
    const m = readRunSheet(dir, S.PLAN, { party: S.PARTY });
    const ids = new Map();
    const picId = (p) => { if (!ids.has(p)) ids.set(p, String(ids.size).padStart(20, '0')); return ids.get(p); };
    const view = (s) => forPlayers(m, s, { withheldWords: m.withheldWords, campaign: m.campaign, picId });
    const cellarPic = () => `/players/pic/${picId(PIC)}`;
    const gate = m.beats.find((b) => b.title === 'Ashfall Reckoning');
    const placed = () => act(RS.emptyState({ stateId: 's', session: 'x', plan: S.PLAN }), { type: 'move', pc: S.NOTES.ADA, to: { beat: gate.key, spot: null, title: gate.title } });
    const shows = (v) => JSON.stringify(v).includes(cellarPic()) || JSON.stringify(v).includes('Secret Cellar');
    // before: nothing names or shows the cellar
    assert.strictEqual(m.placeNotes[CELLAR].portrait, PIC, 'it has a picture to keep back');
    const s = placed();
    const before = view(s);
    assert.ok(!shows(before));
    assert.deepEqual(before.panels.map((p) => p.caption), ['The Gate'], 'the group\'s own place, nothing else');
    // Move them there: its picture, and no caption (it has no name of its own)
    const moved = act(s, { type: 'moveGroup', pcs: [S.NOTES.ADA], place: CELLAR, key: m.placeKeys[CELLAR], title: 'Secret Cellar', names: ['Ada'] });
    assert.deepEqual([view(moved).panels[0].backdrop, view(moved).panels[0].caption], [cellarPic(), null]);
    // Fight here there, for the group at the Gate
    const fought = act(act(s, { type: 'improvise', key: m.placeKeys[CELLAR], title: 'Secret Cellar', place: CELLAR, quiet: true }),
      { type: 'fightStart', beat: m.placeKeys[CELLAR], title: 'Secret Cellar', groups: [gate.key], rows: [], thresholds: [], backdrop: { group: gate.key, place: CELLAR } });
    assert.deepEqual([view(fought).panels[0].backdrop, view(fought).panels[0].caption], [cellarPic(), null]);
    // Show it behind the panel
    const shown = act(s, { type: 'backdrop', group: gate.key, note: CELLAR });
    assert.deepEqual([view(shown).panels[0].backdrop, view(shown).panels[0].caption], [cellarPic(), null]);
    // and none of it before: an improvised place beat nobody went to and no fight at puts nothing up
    const idle = act(s, { type: 'improvise', key: m.placeKeys[CELLAR], title: 'Secret Cellar', place: CELLAR, quiet: true });
    assert.deepEqual(view(idle), before);
    assert.ok(!shows(view(idle)));
    for (const v of [view(moved), view(fought), view(shown)]) checkShape(v, 'an unpublished place');
  });
});

// Final review O1: a Plan ally phrase with a negation or hedge before it is no ally, so a hostile NPC's name and
// HP never reach the players' screen by it. "will never fight as an ally" in a who line, "not with the party" in a
// Quick Reference cell.
describe('a negated Plan ally phrase makes no seen ally (final review O1)', () => {
  const RS = require('../lib/run-sheet/web/state');
  const M = require('../lib/run-sheet/web/fight-math');
  const IMP = 'Creatures/Rime Imp.md';
  const WOLF = S.NOTES.WOLF;
  let n = 0;
  const act = (s, a) => RS.reduce(s, { id: `o1-${++n}`, ...a }, new Date(Date.parse('2026-11-20T19:00:00Z') + n * 60000).toISOString());

  it('"will never fight as an ally", "not with the party" and "is not, for now, with the party" send no name and no HP', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-o1-'));
    made.push(dir);
    fs.cpSync(FIXTURE, dir, { recursive: true });
    const planPath = path.join(dir, S.PLAN);
    const text = fs.readFileSync(planPath, 'utf8').replace(/\r\n/g, '\n')
      .replace('**[[Rime Imp]]:** rides its shoulder', '**[[Rime Imp]]:** rides its shoulder and will never fight as an ally')
      .replace('**[[Ice Mephit]] (2):** circling the torches', '**[[Ice Mephit]] (2):** circling the torches, and is not, for now, with the party')
      .replace('## Contingency Scenes', '## NPC Quick Reference\n\n| NPC | Role This Session | Key Detail | Location |\n|-----|---|---|---|\n| [[Frost Wolf]] | Hunter | not with the party | [[The Gate]] |\n\n## Contingency Scenes');
    assert.ok(text.includes('will never fight as an ally') && text.includes('not with the party') && text.includes('is not, for now,'));
    fs.writeFileSync(planPath, text);
    const m = readRunSheet(dir, S.PLAN, { party: S.PARTY });
    const gate = m.beats.find((b) => b.title === 'Ashfall Reckoning');
    for (const note of [IMP, WOLF, S.NOTES.MEPHIT]) {
      const f = gate.foes.find((x) => x.note === note);
      assert.ok(f, note);
      assert.deepEqual([f.ally, f.allyBy], [false, null], `${note} is a foe`);
    }
    let s = RS.emptyState({ stateId: 's', session: 'x', plan: S.PLAN });
    s = act(s, { type: 'move', pc: S.NOTES.ADA, to: { beat: gate.key, spot: null, title: gate.title } });
    const id = `o1-${++n}`;
    const b = M.rowsForFight({ model: m, derived: RS.derive(m, s), state: s, beatKey: gate.key, idBase: id });
    s = RS.reduce(s, { id, type: 'fightStart', beat: gate.key, title: gate.title, groups: b.groups, rows: b.rows, thresholds: b.thresholds }, new Date().toISOString());
    // tick every row in, so a name or HP has every chance to show
    for (const r of s.fight.rows) if (!r.in) s = act(s, { type: 'fightTick', fight: s.fight.id, row: r.id, in: true });
    const v = forPlayers(m, s, { withheldWords: m.withheldWords, campaign: m.campaign, picId: () => '0'.repeat(20) });
    checkShape(v, 'negated phrases');
    const sandbox = { self: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'lib', 'run-sheet', 'web', 'players', 'render.js'), 'utf8'), sandbox);
    const texts = [JSON.stringify(v), sandbox.self.RunSheetPlayersRender.renderPlayers(v)];
    for (const t of texts) {
      for (const bad of ['Rime Imp', 'Frost Wolf', 'Ice Mephit', '6175', '7341', '7346', '7347']) assert.ok(!t.includes(bad), `"${bad}" reached the players`);
      assert.ok(!/(?<![0-9])21\/21(?![0-9])/.test(t), 'the Imp\'s HP reached the players');
    }
  });
});

// ---- Plan 6b Task 26: the players' screen in a CoC and a GURPS fight ----
//
// A fight on each system's fixture (a temp copy, its figures changed to sentinels no ordinary row holds), run through
// the server's own `POST /api/actions` with every kind of action Tasks 10-25 added, while the players' page, view and
// event stream are read after each step. The players' view of a running fight is a foe's or neutral's name (or the
// unseen word) and an ally's name and HP: nothing else, whatever the system. Each step checks:
//
// - every row's keys, name, HP and statuses are exactly what the state gives the players (a foe row, a PC or an
//   ally row), and a status is one of the system's own status words;
// - none of the sentinels armed so far is in the view, the stream, the rendered markup or the players' static files,
//   and no working line, damage type, hit location, roll, defence, pool, mark or calculator word is either;
// - positive control: every sentinel is in the GM's own answers (model, state, notes, calculator data) the moment it
//   is armed, so a sentinel the fixture lost fails here instead of passing for ever.
describe('the players\' screen in a CoC and a GURPS fight (plan 6b Task 26)', () => {
  const SYS = require('./helpers/systems-fixture');
  const RS = require('../lib/run-sheet/web/state');
  const M = require('../lib/run-sheet/web/fight-math');
  const GM = require('../lib/run-sheet/web/gurps-math');
  const CM = require('../lib/run-sheet/web/coc-math');
  const { statusesOf } = require('../lib/run-sheet/web/fight');
  const { rollDamage, rollPercent } = require('../lib/dice');

  const edit = (dir, rel, from, to) => {
    const f = path.join(dir, rel);
    const text = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
    assert.ok(text.includes(from), `${rel} holds "${from}"`);
    fs.writeFileSync(f, text.replace(from, to));
  };
  // What may never be on the players' screen, as words: the pools, the marks, the working of a hit, a defence, a
  // manoeuvre, a CoC roll, a derived figure's tag, the calculator. Matched on the view and its markup with the
  // statuses taken out (a status is checked on its own against the system's list).
  const { LOCATIONS, LOCATION_WORDS } = require('../lib/templates/gurps/hit-locations');
  const PLACE_WORDS = [...new Set(LOCATIONS.flatMap((l) => l.key.split(' ')).concat(Object.keys(LOCATION_WORDS).flatMap((k) => k.split(' ')), Object.values(LOCATION_WORDS).flatMap((v) => v.split(' '))))].filter((w) => w.length >= 3);
  const WORDS = new RegExp([
    '\\b(?:SAN|Sanity|MP|FP|Luck|Energy|Reserve|Reeling|Shock|Knockdown|knockdown|crippled|Crippled|Death|Parry|Block|Dodge|Retreat|retreat|Manoeuvre|manoeuvre',
    'All-Out|Evaluate|Feint|Dying|Mortal|insanity|bout|Bout|CON|INT|DR|DB|armour|Armour|outnumbered|Outnumbered|d100|calculator|Calculator|to-hit|tohit',
    'imp|cut|cr|burn|tox|fat|ST|HT|DX|IQ|Basic|Speed|Fight Back|Fights Back|margin|aim|Aim|Shoot|dive|Dive|reload|Reload',
    'bonus|penalty|die|dice|Bonus|Penalty|Extreme|Hard|Regular|joint|artery|vein)\\b',
    // every hit place the table knows, by its own words, so a new place cannot slip by unchecked
    `\\b(?:${PLACE_WORDS.join('|')})\\b`,
    'from (?:ST|HT|Speed|DX)',
    '[=−×]',
    '\\b\\d*[dD]\\d+\\b',
  ].join('|'));
  const STATIC_WORDS = /tohit|to-hit|calculator|\bSAN\b|Energy Reserve|\bMP\b|\bFP\b|Reeling|Knockdown/i;
  const PICID = /\/players\/pic\/[0-9a-f]{20}/g;
  // the words a view holds: its string values (never its keys), and the text of its markup (never its tags)
  const valuesOf = (x) => (typeof x === 'string' ? [x] : Array.isArray(x) ? x.flatMap(valuesOf) : x && typeof x === 'object' ? Object.values(x).flatMap(valuesOf) : []);
  const textOf = (html) => html.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const withoutStatuses = (view) => ({ ...view, panels: view.panels.map((p) => (p.order ? { ...p, order: { ...p.order, rows: p.order.rows.map((r) => (r.statuses ? { ...r, statuses: [] } : r)) } } : p)) });

  // One server, one players' stream, one fixture copy with its sentinels. `t` is the script's handle.
  async function start({ fixture, plan, session, party, edits, system }) {
    const vault = SYS.copyFixture(fixture);
    made.push(path.dirname(vault));
    for (const e of edits) edit(vault, ...e);
    const model = readRunSheet(vault, plan, { party });
    assert.equal(model.rules.id, system);
    // the server's dice are fixed (every die a 4), so no random figure lands on a sentinel and fails a run by luck
    const lines = [];
    const picked = pickSession(listSessions(vault), session, vault);
    assert.ok(picked.session, picked.error);
    const run = createTableServer({ vaultPath: vault, session: picked.session, party, deps: { delayMs: 20, retryMs: [20], pingMs: 40, log: (l) => lines.push(l), randomInt: () => 4 } });
    const port = await listenLocal(run.server, 0);
    const stateId = stateIdOf(picked.session);
    const sandbox = { self: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'lib', 'run-sheet', 'web', 'players', 'render.js'), 'utf8'), sandbox);
    const render = sandbox.self.RunSheetPlayersRender.renderPlayers;
    const noteAnswers = [];
    for (const f of walk(vault).filter((x) => x.endsWith('.md'))) {
      const rel = path.relative(vault, f).split(path.sep).join('/');
      const r = await req(port, 'GET', `/api/note?path=${encodeURIComponent(rel)}`);
      if (r.status === 200) noteAnswers.push(r.text);
    }
    // names the players may see: the PCs' first words, the Lair, the unseen word and what the GM has shown
    const allowedNames = new Set(['Lair', ...model.pcs.map((p) => firstWordOf(p.name))]);
    // the D&D fixture's own sentinels (an attachments folder, GM Notes lines, a foe's Recharge) are not in these vaults, and a
    // Plan table's header row is markup, not words
    const forbidden = forbiddenList(vault, model, { plan, session, figures: false })
      .filter((x) => !['_attachments', 'GMNOTE', 'Recharge', 'Legendary', 'Bloodied'].includes(x.text) && !/^\|/.test(x.text));
    forbidden.push({ text: vault, why: 'the vault\'s folder', short: false, control: false });
    forbidden.push({ text: run.serverId, why: 'the serverId', short: false, control: true });
    forbidden.push({ text: stateId, why: 'the stateId', short: false, control: true });
    const armed = [];
    const shownTexts = new Set();
    let seq = 0;
    const gm = stream(port, '/api/events');
    let players = stream(port, '/api/players/events');
    let streamSeen = 0;
    const checked = [];
    // the Plan is the GM's own file: the control only proves the fixture holds what the list takes from it
    let extraGm = fs.readFileSync(path.join(vault, plan), 'utf8').split(/\r?\n/).map(clean).join('\n');

    const t = {
      model, vault, port, stateId, lines, checked,
      id: () => `t26-${++seq}`,
      state: async () => { const r = await req(port, 'GET', '/api/state'); return r.json.state; },
      send: async (actions) => {
        const r = await req(port, 'POST', '/api/actions', { stateId, base: 0, actions: actions.map((a) => ({ id: `t26-${++seq}`, ...a })) });
        assert.equal(r.status, 200, r.text);
        assert.deepEqual(r.json.rejected, [], `no action rejected: ${JSON.stringify(r.json.rejected)}`);
        return r.json.state;
      },
      // the GM's own answers: the model, the state, every note, and whatever the script added (calculator data)
      gmText: async () => [(await req(port, 'GET', '/api/model')).text, (await req(port, 'GET', '/api/state')).text, ...noteAnswers, extraGm].join('\n'),
      gmAnswered: (text) => { extraGm += `\n${text}`; },
      // arms a sentinel from now on, after checking the GM's own answers hold it
      arm: async (key, text, opts = {}) => {
        // a sentinel that is a working line, a card or a pool lives only as long as the state holds it: its control is the
        // moment it is armed, and from then on the players' side must never hold it
        const x = { text: String(text), why: key, short: Boolean(opts.short), control: false };
        x.hit = matcher(x);
        assert.ok(x.hit(await t.gmText()), `positive control: ${key} ("${x.text}") is not in the GM's answers`);
        armed.push(x);
      },
      // a name the GM has now shown the players
      show: (name) => { allowedNames.add(name); shownTexts.add(name); },
      stop: async () => { gm.close(); players.close(); await run.close(); },
    };
    function firstWordOf(s) { return String(s).trim().split(/\s+/)[0]; }

    // everything the players' half answers now, checked
    t.look = async (where) => {
      const got = [];
      for (const url of ['/players', '/players/players.js', '/players/render.js', '/players/players.css']) {
        const r = await req(port, 'GET', url);
        assert.equal(r.status, 200, `${where}: ${url}`);
        assert.ok(!STATIC_WORDS.test(r.text), `${where}: ${url} names a GM-side thing: ${(STATIC_WORDS.exec(r.text) || [''])[0]}`);
        got.push({ where: `${where} ${url}`, text: r.text, headers: r.headers, kind: 'static' });
      }
      const v = await req(port, 'GET', '/api/players/view');
      assert.equal(v.status, 200, `${where}: the view`);
      const view = v.json;
      checkShape(view, where);
      const state = await t.state();
      checkOrder(view, state, where, model);
      await waitFor(() => {
        const last = [...players.events].reverse().find((e) => e.event === 'view');
        return last && last.text === v.text;
      }, `${where}: the stream's view`);
      const fresh = players.events.slice(streamSeen);
      streamSeen = players.events.length;
      const views = [view];
      got.push({ where: `${where} view`, text: v.text, headers: v.headers, kind: 'view' });
      for (const e of fresh) {
        assert.ok(['hello', 'view'].includes(e.event), `${where}: the players' stream sent "${e.event}"`);
        if (e.event === 'hello') { assert.equal(e.text, '{}'); continue; }
        const ev = JSON.parse(e.text);
        checkShape(ev, `${where} (stream)`);
        views.push(ev);
        got.push({ where: `${where} event view`, text: e.text, kind: 'view' });
      }
      for (const w of views) got.push({ where: `${where} markup`, text: render(w), kind: 'view' });
      for (const b of players.raw().split('\n\n').filter((x) => x.length)) assert.ok(/^: ping$/.test(b) || /^event: (hello|view)\ndata: .*$/.test(b), `${where}: a stream block`);
      got.push({ where: `${where} raw stream`, text: players.raw(), kind: 'view' });
      for (const g of got.filter((x) => x.headers)) {
        assert.ok(!('set-cookie' in g.headers), `${g.where}: Set-Cookie`);
        assert.ok(!Object.keys(g.headers).some((k) => k.startsWith('access-control-')), `${g.where}: a CORS header`);
      }

      // each row is what the state gives the players, field by field
      const f = state.fight;
      const ticked = f ? f.rows.filter((r) => r.in) : [];
      const sysStatuses = new Set(model.rules.statuses || []);
      const unseen = new RegExp(`^(?:${reEsc(model.withheldWords.person)}|${reEsc(model.withheldWords.person[0].toUpperCase() + model.withheldWords.person.slice(1))} \\d+|Stranger \\d+|a stranger)$`, 'i');
      for (const w of views) {
        const rowsNow = w.panels.flatMap((p) => (p.order ? p.order.rows : []));
        if (w !== view) continue;
        assert.equal(rowsNow.length > 0, ticked.length > 0 && w.panels.some((p) => p.order), `${where}: the order is there while the fight runs`);
        rowsNow.forEach((row, i) => {
          const r = ticked[i];
          assert.ok(allowedNames.has(row.name) || unseen.test(row.name) || /^Lair$/.test(row.name) || [...allowedNames].some((n) => row.name === n || new RegExp(`^${reEsc(n)} \\d+$`).test(row.name)), `${where}: row ${i} is named "${row.name}"`);
          assert.equal(row.out, Boolean(r.out), `${where}: ${row.name} out`);
          assert.equal(row.current, r.id === f.turn, `${where}: ${row.name} current`);
          assert.equal(row.ini, typeof r.ini === 'number' ? r.ini : null, `${where}: ${row.name} ini`);
          if ('hp' in row) {
            assert.equal(row.hp, typeof r.hp === 'number' ? `${r.hp}${typeof r.max === 'number' ? `/${r.max}` : ''}${r.temp > 0 ? ` +${r.temp}` : ''}` : null, `${where}: ${row.name} HP is the HP and its max, nothing more`);
            assert.deepEqual(row.statuses, r.conds, `${where}: ${row.name}'s statuses are the statuses set on it`);
            for (const st of row.statuses) assert.ok(sysStatuses.has(st), `${where}: "${st}" is not one of the system's status words`);
          }
        });
      }
      for (const w of views) {
        const bare = withoutStatuses(w);
        for (const text of [valuesOf(bare).join(' | '), textOf(render(bare))]) {
          const m = WORDS.exec(text.replace(PICID, '/players/pic/ID'));
          assert.ok(!m, `${where}: "${m && m[0]}" reached the players: ${m && text.slice(Math.max(0, m.index - 40), m.index + 40)}`);
        }
      }
      // the forbidden list from the vault and the sentinels armed so far
      const active = forbidden.filter((x) => !shownTexts.has(x.text) && !(x.with && shownTexts.has(x.with))).map((x) => ({ ...x, hit: matcher(x) }));
      const gmAll = await t.gmText();
      for (const x of active.concat(armed)) {
        if (x.control && !x.hit(gmAll)) assert.fail(`${where}: positive control: "${x.text}" (${x.why}) is not in the GM's answers`);
        for (const g of got) {
          const texts = [g.text, ...(x.short ? [] : Object.values(g.headers || {}).flat().map(String))];
          if (x.short && g.kind !== 'view') continue;
          for (const text of texts) assert.ok(!x.hit(text.replace(PICID, '/players/pic/ID')), `${where}: "${x.text}" (${x.why}) reached the players: ${g.where}`);
        }
      }
      for (const g of got.filter((x) => x.kind === 'view')) assert.ok(!/"dead"\s*:|"hit"\s*:|"marks"\s*:|"cards"\s*:/.test(g.text), `${where}: a GM key`);
      checked.push(...got);
      await Promise.resolve();
      return { view, state };
    };

    await waitFor(() => players.events.length >= 1, 'hello');
    return t;
  }

  // The fight as the page starts it: every PC moved to the beat, then Fight, as the 6a describe above does.
  async function fightAt(t, beatTitle, { ally } = {}) {
    let s = await t.state();
    const beat = t.model.beats.find((b) => b.title === beatTitle);
    assert.ok(beat, beatTitle);
    for (const p of t.model.pcs) await t.send([{ type: 'move', pc: p.note, to: { beat: beat.key, spot: null, title: beat.title } }]);
    s = await t.state();
    const id = t.id();
    const b = M.rowsForFight({ model: t.model, derived: RS.derive(t.model, s), state: s, beatKey: beat.key, idBase: id });
    s = await t.send([{ id, type: 'fightStart', beat: beat.key, title: beat.title, groups: b.groups, rows: b.rows, thresholds: b.thresholds, rules: t.model.rules.fight }]);
    return s;
  }
  const rowNamed = (s, name, copy) => s.fight.rows.find((r) => r.name === name && (copy === undefined || r.copy === copy));
  const act = async (t, type, name, extra = {}, copy) => {
    const s = await t.state();
    const r = rowNamed(s, name, copy);
    assert.ok(r, `a row named ${name}`);
    return t.send([{ type, fight: s.fight.id, row: r.id, ...extra }]);
  };
  const turnNext = async (t) => { const s = await t.state(); return t.send([{ type: 'fightNext', fight: s.fight.id, from: s.fight.turn, round: s.fight.round }]); };
  const turnTo = async (t, name, copy) => {
    for (let i = 0; i < 40; i++) {
      const s = await t.state();
      if (s.fight.started && s.fight.turn === rowNamed(s, name, copy).id) return s;
      await turnNext(t);
    }
    assert.fail(`never reached ${name}'s turn`);
  };
  const eventsOf = (s) => s.events.filter((e) => e.fight).map((e) => e.text);
  const rolled3 = (total, target, outcome) => ({ dice: [Math.floor(total / 3), Math.floor(total / 3), total - 2 * Math.floor(total / 3)], total, target, margin: target - total, outcome: outcome || (total <= target ? 'success' : 'failure') });
  const d100 = (kept, target, level) => ({ tens: [Math.floor(kept / 10) * 10], units: kept % 10, kept, target, difficulty: 'regular', needed: target, level, passed: level !== 'fail' && level !== 'fumble', fumbleFrom: 96, bonus: 0, penalty: 0, asked: { bonus: 0, penalty: 0 } });

  it('GURPS: nothing of a worked-out fight reaches the players but a name, an ally\'s HP and the order', { timeout: 120000 }, async () => {
    const GPLAN = 'Chapters/Chapter 1/Sessions/Session 01/Session 01 - Crates - Plan.md';
    const t = await start({
      fixture: 'run-sheet-gurps', plan: GPLAN, session: 'Session 01 - Crates', system: 'gurps-4e',
      party: ['Characters/PCs/Sela Drake.md', 'Characters/PCs/Lysa Venn.md', 'Characters/PCs/Orrin Tate.md', 'Characters/PCs/Corin Ash.md'],
      edits: [
        // ST 19 gives a foe HP 19 "from ST"; an Energy Reserve of 13; a Dodge 18, Parry 15 and Block 14; a PC with FP 17
        ['Characters/NPCs/Rafe Kell.md', 'ST 10 | DX 12', 'ST 19 | DX 12'],
        ['Characters/NPCs/Mara Quint.md', 'FP 10\n', 'FP 10 (+13 Energy Reserve)\n'],
        ['Characters/NPCs/Mara Quint.md', 'Dodge 8 · Parry 9 (Dagger) · Block — · DR 0', 'Dodge 18 · Parry 15 (Dagger) · Block 14 · DR 2'],
        ['Characters/PCs/Sela Drake.md', '**FP:** 10/10', '**FP:** 17/17'],
        ['Characters/PCs/Sela Drake.md', '| FP | 10 |', '| FP | 17 |'],
      ],
    });
    try {
      let s = await t.state();
      await t.look('before the fight');
      s = await fightAt(t, 'The Back Office');
      assert.ok(s.fight && !s.fight.started);
      // the sentinels are in the GM's model and state before a hit is struck
      const rafe0 = rowNamed(s, 'Rafe Kell');
      assert.deepEqual([rafe0.hp, rafe0.max, rafe0.from.hp], [19, 19, 'from ST']);
      assert.equal(rowNamed(s, 'Sela Drake').fp, 17);
      assert.equal(rowNamed(s, 'Mara Quint').er, 13);
      assert.deepEqual([rowNamed(s, 'Mara Quint').dodge, rowNamed(s, 'Mara Quint').parry, rowNamed(s, 'Mara Quint').block], [18, 15, 14]);
      await t.arm('a foe\'s HP from ST', '19', { short: true });
      await t.arm('a foe\'s "(from ST)" tag', 'from ST');
      await t.arm('a PC\'s FP', '17', { short: true });
      await t.arm('a foe\'s Energy Reserve', '13', { short: true });
      await t.arm('a foe\'s Parry', '15', { short: true });
      await t.arm('a foe\'s Block', '14', { short: true });
      await t.arm('a foe\'s Dodge', '18', { short: true });
      await t.arm('a PC\'s spell list', 'Create Fire');
      await t.look('the fight set up');

      // Start: sorted by Speed at Fight, fixed after Start. Rafe acts first.
      s = await turnNext(t);
      assert.equal(s.fight.turn, rowNamed(s, 'Rafe Kell').id);
      await t.look('Round 1 starts');
      s = await act(t, 'manoeuvre', 'Rafe Kell', { name: 'all-out attack' });
      assert.equal(rowNamed(s, 'Rafe Kell').manoeuvre, 'all-out attack');
      await t.arm('a manoeuvre', 'all-out attack');
      await t.look('a manoeuvre picked');

      // a hit with its working, its place, its shock and its mark; the card's roll and the offer taken
      s = await act(t, 'hp', 'Rafe Kell', { entry: '9 imp vitals' });
      let rafe = rowNamed(s, 'Rafe Kell');
      assert.deepEqual([rafe.hp, rafe.hit.location, rafe.hit.type, rafe.shock], [-8, 'vitals', 'imp', 4]);
      assert.ok(rafe.marks.length >= 1 && rafe.cards.length === 1);
      await t.arm('a hit\'s working line', rafe.hit.line);
      await t.arm('a hit\'s location', 'vitals', { short: true });
      await t.arm('a hit\'s damage type', 'imp', { short: true });
      await t.arm('a mark', rafe.marks[0]);
      await t.arm('a card\'s words', rafe.cards[0].what);
      await t.look('Rafe hit 9 imp vitals');
      // the card: roll its line, then take what it offers
      const C = t.model.rules.fight.consequences;
      let card = rafe.cards[0];
      const i0 = GM.nextLine(card, C);
      assert.ok(i0 >= 0, 'a line to roll');
      s = await act(t, 'cardRolled', 'Rafe Kell', { card: card.id, line: i0, result: rolled3(16, GM.lineTarget(card.lines[i0], rowNamed(s, 'Rafe Kell')), 'failure') });
      rafe = rowNamed(s, 'Rafe Kell');
      const logged = eventsOf(s).slice(-1)[0];
      assert.match(logged, /Rafe Kell/);
      await t.arm('a roll on a card', logged);
      await t.look('Rafe\'s card rolled');
      card = rafe.cards[0];
      assert.ok(card && card.lines[i0].offers.length >= 1, `an offer: ${JSON.stringify(card)}`);
      s = await act(t, 'card', 'Rafe Kell', { card: card.id, line: i0, take: card.lines[i0].offers[0] });
      assert.ok(rowNamed(s, 'Rafe Kell').conds.length >= 1, 'the offer was taken');
      await t.arm('an offer taken', eventsOf(s).slice(-1)[0]);
      await t.look('Rafe\'s offer taken');
      // shown to the players by name at last, a foe's keys
      s = await act(t, 'seen', 'Rafe Kell', { on: true });
      t.show('Rafe Kell');
      await t.look('Rafe shown');

      // Tam, a foe the GM makes an ally: the players now get the name and the HP, and nothing else of him
      s = await act(t, 'setSide', 'Tam Osier', { side: 'ally' });
      t.show('Tam Osier');
      let tam = rowNamed(s, 'Tam Osier');
      assert.deepEqual([tam.kind, tam.seen, tam.hp, tam.max], ['ally', true, 6, 9]);
      let look = await t.look('Tam Osier an ally');
      assert.deepEqual(look.view.panels[0].order.rows.find((r) => r.name === 'Tam Osier').hp, '6/9');

      // a groin hit on the ally: a working line, a place, a card; its HP goes down, the rest stays on the GM's page
      s = await act(t, 'hp', 'Tam Osier', { entry: '5 cr groin' });
      tam = rowNamed(s, 'Tam Osier');
      assert.equal(tam.hit.location, 'groin');
      await t.arm('an ally\'s hit working', tam.hit.line);
      await t.arm('a hit\'s place on an ally', 'groin', { short: true });
      look = await t.look('Tam Osier hit in the groin');
      s = await act(t, 'hp', 'Tam Osier', { entry: '12 imp vitals' });
      tam = rowNamed(s, 'Tam Osier');
      assert.ok(tam.hp < -9, `Tam is past his death checks: ${tam.hp}`);
      assert.ok(tam.cards && tam.cards.length >= 1, 'a death check on the card');
      await t.arm('a death check\'s card', tam.cards[tam.cards.length - 1].what);
      look = await t.look('Tam Osier past his death checks');
      assert.equal(look.view.panels[0].order.rows.find((r) => r.name === 'Tam Osier').hp, `${tam.hp}/9`);
      // Out after the death check: what a foe's Out sends today, the flag and nothing more
      s = await act(t, 'card', 'Tam Osier', { card: tam.cards[0].id, take: 'out' });
      assert.equal(rowNamed(s, 'Tam Osier').out, true);
      look = await t.look('Tam Osier out after a death check');
      const tamOut = look.view.panels[0].order.rows.find((r) => r.name === 'Tam Osier');
      assert.deepEqual([tamOut.out, keys(tamOut)], [true, PC_ROW], 'an ally\'s Out is the same row with out true');
      assert.ok(!/dead|Dead|died/.test(JSON.stringify(look.view)), 'no word of dying');

      // PCs: a hit by place on a PC (its HP shows, its place does not), FP spent, a spell's Energy Reserve, a status set
      s = await act(t, 'hp', 'Orrin Tate', { entry: '9 cut spine' });
      let orrin = rowNamed(s, 'Orrin Tate');
      assert.equal(orrin.hit.location, 'spine');
      await t.arm('a PC\'s hit working', orrin.hit.line);
      await t.arm('a spine hit', 'spine', { short: true });
      look = await t.look('Orrin hit in the spine');
      assert.equal(look.view.panels[0].order.rows.find((r) => r.name === 'Orrin').hp, `${orrin.hp}/12`);
      // a limb past half HP is crippled; a spine past HP is crippled and knocks down and stuns outright
      s = await act(t, 'hp', 'Lysa Venn', { entry: '7 cut arm' });
      const corinHurt = rowNamed(s, 'Lysa Venn');
      assert.ok(corinHurt.crippled.length > 0, `a crippled limb: ${JSON.stringify(corinHurt.crippled)}`);
      await t.arm('a crippled mark', corinHurt.crippled[0]);
      await t.arm('a crippling hit\'s working', corinHurt.hit.line);
      await t.look('Lysa\'s arm crippled');
      s = await act(t, 'hp', 'Orrin Tate', { entry: '20 cut spine' });
      orrin = rowNamed(s, 'Orrin Tate');
      assert.ok(orrin.crippled.includes('spine'), `a crippled spine: ${JSON.stringify(orrin.crippled)}`);
      const autoCard = orrin.cards.find((c) => c.lines.some((l) => l.place === 'spine'));
      assert.ok(autoCard, 'a card for the spine');
      const auto = JSON.stringify(autoCard);
      assert.match(auto, /auto|Auto|stun|Stun|knock/, `the automatic knockdown on the card: ${auto}`);
      await t.arm('a spine card', autoCard.what);
      await t.arm('a crippled spine', orrin.hit.line);
      await t.look('Orrin\'s spine crippled');
      s = await act(t, 'status', 'Orrin Tate', { add: 'Stunned' });
      look = await t.look('Orrin Stunned');
      assert.deepEqual(look.view.panels[0].order.rows.find((r) => r.name === 'Orrin').statuses, ['Stunned']);

      s = await act(t, 'hp', 'Sela Drake', { entry: 'f-3' });
      assert.equal(rowNamed(s, 'Sela Drake').fp, 14);
      await t.arm('FP spent', eventsOf(s).filter((l) => /Sela/.test(l)).slice(-1)[0]);
      s = await act(t, 'hp', 'Sela Drake', { entry: 'f-12' });
      const sela = rowNamed(s, 'Sela Drake');
      assert.equal(sela.fp, 2);
      assert.ok(sela.tired, 'Tired at FP 2');
      await t.arm('FP almost gone', eventsOf(s).filter((l) => /Sela/.test(l)).slice(-1)[0]);
      assert.ok(sela.marks.length >= 1 || sela.tired, 'a Tired mark');
      look = await t.look('Sela spent her FP');
      assert.equal(look.view.panels[0].order.rows.find((r) => r.name === 'Sela').hp, '12/12');
      s = await act(t, 'hp', 'Lysa Venn', { entry: 'e-4' });
      assert.equal(rowNamed(s, 'Lysa Venn').er, 2);
      await t.arm('a PC\'s Energy Reserve spent', eventsOf(s).filter((l) => /Lysa/.test(l)).slice(-1)[0]);
      s = await act(t, 'setShock', 'Sela Drake', { n: 3 });
      assert.equal(rowNamed(s, 'Sela Drake').shock, 3);
      look = await t.look('a shock chip tapped');

      // Mara's turn: defences, retreat, Energy Reserve spent, a hit to the face, the face left open
      s = await turnTo(t, 'Mara Quint');
      s = await act(t, 'manoeuvre', 'Mara Quint', { name: 'all-out defence', defence: 'parry' });
      assert.equal(rowNamed(s, 'Mara Quint').manoeuvre, 'all-out defence');
      look = await t.look('Mara picks All-Out Defence');
      const D = t.model.rules.fight.defences;
      const live = GM.liveDefences(rowNamed(s, 'Mara Quint'), D);
      s = await act(t, 'defendRolled', 'Mara Quint', { defence: 'parry', result: rolled3(11, live.parry.value, 'success') });
      assert.equal(rowNamed(s, 'Mara Quint').parries, 1);
      await t.arm('a defence rolled', eventsOf(s).slice(-1)[0]);
      look = await t.look('Mara parries');
      s = await act(t, 'hp', 'Mara Quint', { entry: 'e-4' });
      assert.equal(rowNamed(s, 'Mara Quint').er, 9);
      await t.arm('a foe\'s Energy Reserve spent', eventsOf(s).filter((l) => /Mara/.test(l)).slice(-1)[0]);
      s = await act(t, 'faceOpen', 'Mara Quint', { on: true });
      s = await act(t, 'hp', 'Mara Quint', { entry: '8 cr jaw' });
      const mara = rowNamed(s, 'Mara Quint');
      assert.equal(mara.hit.location, 'jaw');
      await t.arm('a jaw hit', 'jaw', { short: true });
      await t.arm('a hit with no DR', mara.hit.line);
      look = await t.look('Mara hit on the jaw');
      s = await act(t, 'retreat', 'Mara Quint', { on: true });
      look = await t.look('Mara retreats');

      // dice rolled on the server for a typed hit; typed defences; the Martial Arts places
      const roll = await req(t.port, 'POST', '/api/roll', { rolls: [{ damage: '2d+1', type: 'imp' }] });
      assert.equal(roll.status, 200, roll.text);
      s = await act(t, 'hp', 'Corin Ash', { entry: '2d+1 imp torso', rolled: roll.json.results[0].total });
      const corin = rowNamed(s, 'Corin Ash');
      assert.ok(/^2d\+1 = \d+ imp/.test(corin.hit.line), corin.hit.line);
      await t.arm('a dice hit\'s working', corin.hit.line);
      await t.look('Corin hit with dice');
      s = await act(t, 'hp', 'Corin Ash', { entry: '1 imp ear' });
      assert.equal(rowNamed(s, 'Corin Ash').hit.location, 'ear');
      await t.arm('a Martial Arts place', 'ear', { short: true });
      s = await act(t, 'hp', 'Sela Drake', { entry: '3 cr nose' });
      assert.equal(rowNamed(s, 'Sela Drake').hit.location, 'nose');
      await t.arm('another Martial Arts place', 'nose', { short: true });
      s = await act(t, 'setStat', 'Rafe Kell', { key: 'parry', value: 16 });
      assert.equal(rowNamed(s, 'Rafe Kell').parry, 16);
      await t.arm('a typed Parry', '16', { short: true });
      // a foe's main combat skill, a quick figure typed at the table (Task 36)
      s = await act(t, 'setStat', 'Rafe Kell', { key: 'skill', value: 83 });
      assert.equal(rowNamed(s, 'Rafe Kell').skill, 83);
      await t.arm('a typed Skill', '83', { short: true });
      look = await t.look('places and typed figures');

      // the to-hit calculator: its data, a typed skill, none of it on the state or the players' screen
      const before = (await req(t.port, 'GET', '/api/state')).text;
      const list = await req(t.port, 'GET', '/api/tohit');
      assert.equal(list.status, 200);
      const one = await req(t.port, 'GET', `/api/tohit?pc=${encodeURIComponent('Characters/PCs/Sela Drake.md')}`);
      assert.equal(one.status, 200);
      const typed = await req(t.port, 'POST', '/api/tohit/typed', { name: 'Typed 87', type: 'melee', level: 87 });
      assert.equal(typed.status, 200);
      t.gmAnswered(list.text + one.text + typed.text);
      await t.arm('a typed skill in the calculator', '87', { short: true });
      await t.arm('a typed skill\'s name', 'Typed 87');
      await t.arm('a PC\'s weapon in the calculator', 'Broadsword');
      assert.equal((await req(t.port, 'GET', '/api/state')).text, before, 'the calculator writes nothing to the state');
      for (const url of ['/api/players/tohit', '/players/tohit/gurps-tohit.js', '/players/api/tohit']) assert.notEqual((await req(t.port, 'GET', url)).status, 200, `${url} is no players' route`);
      look = await t.look('the calculator asked');

      // the turns go round: shock runs out, a round ends, the order stays names, HP and the turn
      for (let i = 0; i < 9; i++) await turnNext(t);
      s = await t.state();
      assert.ok(s.fight.round >= 2, 'a round went by');
      look = await t.look('a round later');
      await t.send([{ type: 'fightPause', fight: s.fight.id, on: true }]);
      look = await t.look('paused');
      assert.equal(look.view.panels[0].order.paused, true);
      await t.send([{ type: 'fightPause', fight: s.fight.id, on: false }]);
      await t.look('resumed');
      await t.send([{ type: 'fightEnd', fight: s.fight.id }]);
      look = await t.look('after End fight');
      assert.ok(look.view.panels.every((q) => q.order === null));
      assert.ok(t.checked.length > 100, 'the test looked at what the players were sent');
    } finally { await t.stop(); }
  });

  it('CoC: nothing of a worked-out fight reaches the players but a name, an ally\'s HP and the order', { timeout: 120000 }, async () => {
    const CPLAN = 'Chapters/Chapter 1/Sessions/Session 01/Session 01 - Fog Bound - Plan.md';
    const t = await start({
      fixture: 'run-sheet-coc', plan: CPLAN, session: 'Session 01 - Fog Bound', system: 'coc-7e',
      party: ['Characters/PCs/Iris Calder.md', 'Characters/PCs/Jonas Finch.md', 'Characters/PCs/Mabel Quill.md'],
      edits: [
        // a PC's SAN 47, MP 17 and Luck 38; a foe's MP 29, SAN 31 and Luck 33; CON 67 and INT 59; armour 4
        ['Characters/PCs/Iris Calder.md', '| Sanity | 99 | 62 (starting 65) |', '| Sanity | 99 | 47 (starting 65) |'],
        ['Characters/PCs/Iris Calder.md', '| MP | 13 | 13 |', '| MP | 17 | 17 |'],
        ['Characters/PCs/Iris Calder.md', '| Luck | — | 55 |', '| Luck | — | 38 |'],
        ['Characters/NPCs/Tobias Reed.md', '| MP | 9 |', '| MP | 29 |'],
        ['Characters/NPCs/Tobias Reed.md', '| SAN | 45 |', '| SAN | 31 |'],
        ['Characters/NPCs/Tobias Reed.md', '| Luck | 40 |', '| Luck | 33 |'],
        ['Characters/NPCs/Warden Hale.md', '| 60  | 65  | 70  | 50  | 55  | 45  | 60  | 50  |', '| 60  | 67  | 70  | 50  | 59  | 45  | 60  | 50  |'],
        ['Characters/NPCs/Warden Hale.md', '**Armour** none', '**Armour** 4'],
      ],
    });
    try {
      let s = await t.state();
      await t.look('before the fight');
      s = await fightAt(t, 'The Dark Light');
      const iris0 = rowNamed(s, 'Iris Calder');
      assert.deepEqual([iris0.san, iris0.mp, iris0.luck, iris0.con, iris0.int], [47, 17, 38, 60, 75]);
      assert.deepEqual([rowNamed(s, 'Tobias Reed').mp, rowNamed(s, 'Tobias Reed').san], [29, 31]); // a foe's Luck is only on its note
      assert.deepEqual([rowNamed(s, 'Warden Hale').con, rowNamed(s, 'Warden Hale').int, rowNamed(s, 'Warden Hale').armour], [67, 59, 4]);
      for (const [key, n] of [['a PC\'s SAN', '47'], ['a PC\'s MP', '17'], ['a PC\'s Luck', '38'], ['a foe\'s MP', '29'], ['a foe\'s SAN', '31'], ['a foe\'s Luck', '33'], ['a foe\'s CON', '67'], ['a foe\'s INT', '59']]) await t.arm(key, n, { short: true });
      await t.look('the fight set up');
      s = await turnNext(t);
      assert.ok(s.fight.started);
      await t.look('Round 1 starts');

      const COC = t.model.rules.fight;
      const faces = (...f) => { let i = 0; return () => f[i++]; };
      const dmg = (notation, ...f) => rollDamage(notation, { floor: 0, randomInt: faces(...f) });
      let look;
      // an opposed melee exchange: Iris's tapped level against a Brine Walker's Fight Back, the server's d100 for the walker
      let walker = rowNamed(s, 'Brine Walker', 1);
      let auto = CM.attackDice(walker, COC.coc);
      const fighting = CM.skillOf(walker, 'fightBack');
      assert.ok(fighting > 0, 'the walker fights');
      s = await t.send([{ type: 'melee', fight: s.fight.id, attacker: rowNamed(s, 'Iris Calder').id, defender: walker.id, response: 'fightBack', dice: CM.diceOfNet(auto.net, COC.coc), auto, attack: { level: 'regular' }, defence: d100(91, fighting, 'fail') }]);
      assert.ok(s.fight.melee && s.fight.melee.side === 'attacker', 'Iris won the exchange');
      await t.arm('an opposed roll', eventsOf(s).slice(-1)[0]);
      await t.arm('a d100 result', '91', { short: true });
      await t.look('Iris hits a walker in melee');
      // its damage, the damage bonus and armour worked out on the row: the working line stays on the GM's page
      s = await act(t, 'hp', 'Brine Walker', { entry: '1D6', by: rowNamed(s, 'Iris Calder').id, mode: 'full', roll: dmg('1D6', 5), exchange: s.fight.melee.n }, 1);
      walker = rowNamed(s, 'Brine Walker', 1);
      assert.ok(walker.hit && walker.hit.line, 'a working line on the row');
      await t.arm('a damage working line', walker.hit.line);
      await t.look('Iris\'s damage worked out');
      // the walker hits back at Iris: its d100 against the PC's tapped dodge; its damage bonus (+1D6 since the fixture's
      // figures were made its own, PRENTICE review) and Iris's HP
      auto = CM.attackDice(rowNamed(s, 'Iris Calder'), COC.coc);
      s = await t.send([{ type: 'melee', fight: s.fight.id, attacker: walker.id, defender: rowNamed(s, 'Iris Calder').id, response: 'dodge', dice: CM.diceOfNet(auto.net, COC.coc), auto, attack: d100(93, CM.skillOf(walker, 'attack'), 'regular'), defence: { level: 'fail' } }]);
      assert.ok(s.fight.melee && s.fight.melee.side === 'attacker', 'the walker hit Iris');
      await t.arm('a dodge tapped', eventsOf(s).slice(-1)[0]);
      s = await act(t, 'hp', 'Iris Calder', { entry: '1D6+DB', by: walker.id, mode: 'full', roll: dmg('1D6+1D6', 2, 2), exchange: s.fight.melee.n });
      const iris = rowNamed(s, 'Iris Calder');
      assert.ok(iris.hit && iris.hp < 9, `Iris is hurt: ${iris.hp}`);
      await t.arm('a hit on a PC, worked out', iris.hit.line);
      look = await t.look('the walker hits Iris');
      assert.equal(look.view.panels[0].order.rows.find((r) => r.name === 'Iris').hp, `${iris.hp}/11`);
      s = await act(t, 'outnumbered', 'Brine Walker', { off: true }, 2);
      assert.equal(rowNamed(s, 'Brine Walker', 2).outnumberedOff, true);
      look = await t.look('outnumbered turned off');

      // a bonus die and a penalty die on Iris's attacks on Warden Hale, then a hit that goes through his armour
      const hale0 = rowNamed(s, 'Warden Hale');
      const haleFight = CM.skillOf(hale0, 'fightBack');
      for (const [net, word] of [[1, 'bonus'], [-1, 'penalty']]) {
        auto = CM.attackDice(hale0, COC.coc);
        s = await t.send([{ type: 'melee', fight: s.fight.id, attacker: rowNamed(s, 'Iris Calder').id, defender: hale0.id, response: 'fightBack', dice: CM.diceOfNet(net, COC.coc), auto, attack: { level: 'regular' }, defence: d100(90, haleFight, 'fail') }]);
        const diceLine = eventsOf(s).slice(-1)[0];
        assert.match(diceLine, new RegExp(`${word} die`), diceLine);
        await t.arm(`a ${word} die`, diceLine);
      }
      look = await t.look('bonus and penalty dice');
      s = await act(t, 'hp', 'Warden Hale', { entry: '1D6', by: rowNamed(s, 'Iris Calder').id, mode: 'full', roll: dmg('1D6', 6), exchange: s.fight.melee ? s.fight.melee.n : undefined });
      const hale = rowNamed(s, 'Warden Hale');
      assert.match(hale.hit.line, /armour 4/, hale.hit.line);
      await t.arm('armour worked into a hit', hale.hit.line);
      look = await t.look('a hit through armour');

      // a Major Wound: one card, a CON roll, Prone and Unconscious offered and taken; the box stays ticked
      s = await act(t, 'hp', 'Brine Walker', { entry: '-8' }, 2);
      walker = rowNamed(s, 'Brine Walker', 2);
      assert.equal(walker.majorWound, true);
      let card = walker.cards[0];
      await t.arm('a card\'s words', card.what);
      look = await t.look('a Major Wound card raised');
      s = await act(t, 'cardRolled', 'Brine Walker', { card: card.id, line: 0, result: d100(88, CM.lineTarget(card.lines[0], walker), 'fail') }, 2);
      await t.arm('a CON roll', eventsOf(s).slice(-1)[0]);
      walker = rowNamed(s, 'Brine Walker', 2);
      assert.deepEqual(walker.cards[0].lines[0].offers, ['proneOut']);
      s = await act(t, 'card', 'Brine Walker', { card: card.id, line: 0, take: 'proneOut' }, 2);
      assert.ok(rowNamed(s, 'Brine Walker', 2).conds.includes('Unconscious'));
      look = await t.look('the Major Wound card answered');
      // down to 0 HP with the box ticked: Dying, offered and taken; a reminder at each round's end
      s = await act(t, 'hp', 'Brine Walker', { entry: '-6' }, 2);
      walker = rowNamed(s, 'Brine Walker', 2);
      assert.equal(walker.hp, 0);
      card = walker.cards[0];
      s = await act(t, 'card', 'Brine Walker', { card: card.id, line: 0, take: 'dying' }, 2);
      assert.ok(rowNamed(s, 'Brine Walker', 2).conds.includes('Dying'));
      assert.ok(Number.isInteger(rowNamed(s, 'Brine Walker', 2).dyingRound));
      look = await t.look('a walker Dying');
      // Iris loses SAN: an INT card, her roll a tap, temporary insanity offered and its bout rolled by the server
      s = await act(t, 'hp', 'Iris Calder', { entry: 's-5' });
      let irisNow = rowNamed(s, 'Iris Calder');
      assert.equal(irisNow.san, 42);
      card = irisNow.cards[0];
      await t.arm('a SAN loss', eventsOf(s).filter((l) => /Iris/.test(l)).slice(-1)[0]);
      await t.arm('a SAN card', card.what);
      look = await t.look('Iris loses SAN');
      s = await act(t, 'cardRolled', 'Iris Calder', { card: card.id, line: 0, result: { tap: 'passed' } });
      irisNow = rowNamed(s, 'Iris Calder');
      assert.deepEqual(irisNow.cards[0].lines[0].offers, ['insane']);
      const bout = await req(t.port, 'POST', '/api/roll', { rolls: [{ sides: 10, mod: 0 }] });
      assert.equal(bout.status, 200, bout.text);
      s = await act(t, 'card', 'Iris Calder', { card: irisNow.cards[0].id, line: 0, take: 'insane', bout: bout.json.results[0] });
      irisNow = rowNamed(s, 'Iris Calder');
      assert.ok(irisNow.conds.includes('Temporary insanity'));
      await t.arm('a bout', eventsOf(s).filter((l) => /Iris/.test(l)).slice(-1)[0]);
      look = await t.look('Iris temporarily insane');
      assert.deepEqual(look.view.panels[0].order.rows.find((r) => r.name === 'Iris').statuses, irisNow.conds);
      s = await act(t, 'hp', 'Iris Calder', { entry: 'm-3' });
      assert.equal(rowNamed(s, 'Iris Calder').mp, 14);
      await t.arm('MP spent', eventsOf(s).filter((l) => /Iris/.test(l)).slice(-1)[0]);
      look = await t.look('Iris spends MP');

      // Nurse Orla, a foe made an ally: her name and her HP, and a Major Wound only as the status it is
      s = await act(t, 'setSide', 'Nurse Orla Penn', { side: 'ally' });
      t.show('Nurse Orla Penn');
      look = await t.look('Orla an ally');
      assert.equal(look.view.panels[0].order.rows.find((r) => r.name === 'Nurse Orla Penn').hp, '10/10');
      s = await act(t, 'hp', 'Nurse Orla Penn', { entry: '-6' });
      let orla = rowNamed(s, 'Nurse Orla Penn');
      assert.equal(orla.majorWound, true);
      await t.arm('an ally\'s card', orla.cards[0].what);
      look = await t.look('Orla hurt');
      assert.deepEqual(look.view.panels[0].order.rows.find((r) => r.name === 'Nurse Orla Penn').statuses, orla.conds);
      s = await act(t, 'hp', 'Nurse Orla Penn', { entry: '-4' });
      orla = rowNamed(s, 'Nurse Orla Penn');
      assert.equal(orla.hp, 0);
      await t.look('Orla at 0');
      s = await act(t, 'card', 'Nurse Orla Penn', { card: orla.cards[0].id, take: 'out' });
      assert.equal(rowNamed(s, 'Nurse Orla Penn').out, true);
      look = await t.look('Orla out');
      const orlaOut = look.view.panels[0].order.rows.find((r) => r.name === 'Nurse Orla Penn');
      assert.deepEqual([orlaOut.out, keys(orlaOut)], [true, PC_ROW]);

      // rounds go by: Dying's reminders, the bout counting down, an Out after the failed CON roll
      for (let i = 0; i < 24; i++) await turnNext(t);
      s = await t.state();
      assert.ok(s.fight.round >= 4, `rounds went by: ${s.fight.round}`);
      look = await t.look('rounds later');
      walker = rowNamed(s, 'Brine Walker', 2);
      const reminder = walker.cards && walker.cards.find((c) => c.lines.some((l) => l.kind === 'dyingCon'));
      assert.ok(reminder, 'a Dying reminder on the walker');
      await t.arm('a Dying reminder', reminder.what);
      s = await act(t, 'cardRolled', 'Brine Walker', { card: reminder.id, line: 0, result: d100(97, CM.lineTarget(reminder.lines[0], walker), 'fail') }, 2);
      s = await act(t, 'card', 'Brine Walker', { card: reminder.id, line: 0, take: 'dead' }, 2);
      assert.equal(rowNamed(s, 'Brine Walker', 2).out, true);
      look = await t.look('the walker dead');
      await t.send([{ type: 'fightEnd', fight: s.fight.id }]);
      look = await t.look('after End fight');
      assert.ok(look.view.panels.every((q) => q.order === null));

      // a second fight, with guns: a gun made ready, an aim declared, a shot with its chips, a dive, a reload counter
      s = await fightAt(t, 'The Net Loft');
      const fid = s.fight.id;
      s = await act(t, 'setStat', 'Dock Cultist', { key: 'mp', value: 52 }, 1);
      assert.equal(rowNamed(s, 'Dock Cultist', 1).mpMax, 52);
      s = await act(t, 'sameForAll', 'Dock Cultist', {}, 1);
      assert.equal(rowNamed(s, 'Dock Cultist', 2).mpMax, 52, 'the same figures copied');
      await t.arm('a typed MP copied to its group', '52', { short: true });
      s = await act(t, 'firearm', 'Dock Cultist', { on: true }, 1);
      assert.equal(rowNamed(s, 'Dock Cultist', 1).gun, true);
      look = await t.look('a gun made ready');
      s = await turnNext(t);
      s = await turnTo(t, 'Dock Cultist', 1);
      s = await act(t, 'aim', 'Dock Cultist', {}, 1);
      assert.ok(rowNamed(s, 'Dock Cultist', 1).aiming, 'aiming');
      await t.arm('an aim', eventsOf(s).slice(-1)[0]);
      look = await t.look('a cultist aims');
      s = await turnTo(t, 'Dock Cultist', 1); // the next round: the aim is ready
      s = await turnTo(t, 'Dock Cultist', 1);
      const A = rowNamed(s, 'Dock Cultist', 1);
      const D = rowNamed(s, 'Iris Calder');
      const chips = s.fight.round >= 2 ? ['aim'] : [];
      assert.ok(Array.isArray(A.guns) && A.guns.length >= 1, 'a gun on the row');
      const dice = CM.shotDice(chips, A, D, COC);
      const result = rollPercent({ target: CM.shotSkill(A, A.guns[0]), difficulty: dice.difficulty, ...dice.asked }, { randomInt: faces(3, 3) });
      s = await t.send([{ type: 'shot', fight: fid, shooter: A.id, target: D.id, chips, gun: 0, result }]);
      const shotLine = eventsOf(s).slice(-1)[0];
      assert.match(shotLine, /Dock Cultist/);
      await t.arm('a shot\'s line', shotLine);
      assert.ok(rowNamed(s, 'Dock Cultist', 1).reload, 'a slow gun starts its reload counter');
      look = await t.look('a cultist shoots Iris');
      s = await act(t, 'dive', 'Iris Calder', { result: { tap: 'passed' } });
      await t.arm('a dive', eventsOf(s).slice(-1)[0]);
      look = await t.look('Iris dives');
      s = await act(t, 'reload', 'Dock Cultist', { clear: true }, 1);
      await t.arm('a gun made ready', eventsOf(s).slice(-1)[0]);
      s = await act(t, 'status', 'Iris Calder', { add: 'Prone' });
      look = await t.look('Iris prone');
      assert.deepEqual(look.view.panels[0].order.rows.find((r) => r.name === 'Iris').statuses, rowNamed(s, 'Iris Calder').conds);
      assert.ok(rowNamed(s, 'Iris Calder').conds.includes('Prone'));
      assert.ok(t.checked.length > 100, 'the test looked at what the players were sent');
    } finally { await t.stop(); }
  });
});

// ---- the no-Plan sheet (plan "no-Plan run sheet" Task 10) ----
// A record vault whose Session 14 Wrap-Up holds a secret word in its GM Notes. The sheet opens from that record,
// and the word must never reach the players' view or their stream: not on opening, nor after Move them, Fight here,
// a jot, or the filing (`gma table-file` faked through deps.runFileLog). Real input in the page, as the sheet's own
// browser tests do.
describe('the no-Plan sheet leaks no Wrap-Up GM Notes to the players (Task 10)', { skip: browserSkip() }, () => {
  const { withPage } = require('./helpers/cdp');
  const { copyRecordFixture } = require('./helpers/record-fixture');
  const { removeFixture } = require('./helpers/systems-fixture');
  const { stateFileFor } = require('../lib/run-sheet/sessions');
  const WORD = 'Quillmoth-Sentinel-4417';
  const S15 = 'Chapters/Chapter 3/Sessions/Session 15';
  const FESTIVAL = 'Locations/Harbour Festival Grounds.md';
  const PROBE = 'JSON.parse(document.body.dataset.probe || "null")';

  for (const crlf of [false, true]) {
    it(`a secret in the Wrap-Up's GM Notes never reaches /api/players (${crlf ? 'CRLF' : 'LF'})`, { timeout: 120000 }, async () => {
      const vault = copyRecordFixture({ crlf });
      made.push(vault);
      const wrap = path.join(vault, 'Chapters/Chapter 3/Sessions/Session 14/Session 14 - Ledger - Wrap-Up.md');
      const text = fs.readFileSync(wrap, 'utf8').replace(/\r\n/g, '\n');
      // The word goes where readRecord reads: the Handoff, the Ticking clocks line, an Unresolved Threads bullet and
      // a Pending Consequences line (a bare bullet under "## GM Notes" is never read: the first version missed it).
      const put = (t, from, to) => { assert.ok(t.includes(from), `the Wrap-Up holds ${from}`); return t.replace(from, to); };
      let edited = text;
      edited = put(edited, 'Odalys Venn]] is upstairs and has heard all of it.', `Odalys Venn]] is upstairs and has heard all of it. Mind the ${WORD}handoff wharf.`);
      edited = put(edited, 'starts at midnight.', `starts at midnight, when the ${WORD}clock bell rings.`);
      edited = put(edited, 'someone keeps slipping the crew notes with no name on them.', `someone keeps slipping the crew notes signed ${WORD}thread.`);
      edited = put(edited, 'will blame the crew to his guild.', `will blame the crew to his guild, citing ${WORD}conseq.`);
      fs.writeFileSync(wrap, crlf ? edited.replace(/\n/g, '\r\n') : edited);

      const session = pickSession(listSessions(vault), null, vault).session;
      assert.ok(session && session.fromRecord, 'the record gives Session 15');
      const { file, stateId } = stateFileFor(vault, session);
      const filed = [];
      const runFileLog = async (cmd) => {
        filed.push(cmd);
        const a = cmd.find((x) => x.startsWith('--title='));
        const stem = `Session 15 - ${a ? a.slice('--title='.length) : 'untitled'}`;
        fs.mkdirSync(path.join(vault, S15), { recursive: true });
        fs.writeFileSync(path.join(vault, S15, `${stem}.md`), `---\ntype: session\nsession_number: 15\nchapter: "[[Chapter 3]]"\nstatus: planned\ndocuments:\n  plan: null\n  table_log: "[[${stem} - Table Log]]"\n  wrap_up: null\n---\n\n# ${stem}\n`);
        fs.writeFileSync(path.join(vault, S15, `${stem} - Table Log.md`), `---\ntype: session-table-log\nsession: "[[${stem}]]"\ncreated_by: run-sheet\n---\n\n# ${stem} - Table Log\n\n## Log\n`);
        return { ok: true, out: `CREATED\t${S15}/${stem}.md\t\tsession template\nCREATED\t${S15}/${stem} - Table Log.md\t\tthe Table Log's 18 sections, empty\n` };
      };
      const run = createTableServer({ vaultPath: vault, session, stateFile: file, stateId,
        fileLog: { cmd: ['gma', 'table-file', 'VAULT', '--number', '15', '--chapter', 'Chapter 3'], takesTitle: true },
        deps: { delayMs: 50, log: () => {}, now: () => new Date(2026, 10, 29, 20, 15), runFileLog } });
      const port = await listenLocal(run.server, 0);
      const base = `http://127.0.0.1:${port}/`;
      const pstream = stream(port, '/api/players/events');
      try {
        const views = [];
        const look = async () => { views.push((await req(port, 'GET', '/api/players/view')).text); };
        const noWord = (where) => {
          for (const v of views) assert.ok(!v.toLowerCase().includes(WORD.toLowerCase()), `${where}: the players' view holds the secret word`);
          assert.ok(!pstream.raw().toLowerCase().includes(WORD.toLowerCase()), `${where}: the players' stream holds the secret word`);
        };
        // positive control: the GM's own answer about the note does hold the word
        const gmNote = await req(port, 'GET', `/api/note?path=${encodeURIComponent('Chapters/Chapter 3/Sessions/Session 14/Session 14 - Ledger - Wrap-Up.md')}`);
        assert.equal(gmNote.status, 200, gmNote.text);
        assert.ok(gmNote.text.includes(WORD), 'the GM can read the word');
        // the control that matters: the word is in the GM's own model, so the players' filter is what keeps it back
        const gmModel = await req(port, 'GET', '/api/model');
        assert.equal(gmModel.status, 200, gmModel.text);
        for (const spot of ['handoff', 'clock', 'thread', 'conseq']) {
          assert.ok(gmModel.text.includes(`${WORD}${spot}`), `the ${spot} marker reaches the GM's own model`);
        }
        await look();
        noWord('before the page opens');

        await withPage({ width: 1449, height: 762 }, async (page) => {
          const settled = () => page.waitFor(`(() => { const p = ${PROBE}; return p && p.saved === 'Saved' && p.pending === 0 && document.getElementById('where') && p; })()`);
          await page.goto(`${base}?probe=1`);
          await settled();
          await look(); noWord('opened');
          // Fight here at the lead card's place, then end it
          await page.click(`#coming .lead [data-fplace="${FESTIVAL}"]`);
          await page.waitFor(`(() => { const p = ${PROBE}; return p && p.fight && p.saved === 'Saved' && p.pending === 0 && p; })()`);
          await look(); noWord('Fight here');
          await page.click('#fEnd');
          await page.click('#fEnd');
          await page.waitFor(`(() => { const p = ${PROBE}; return p && !p.fight && p; })()`);
          await settled();
          // Move them
          await page.click('#where .wrow input[data-movebox]');
          await page.type('Marrow');
          await page.waitFor('document.querySelector("#where [data-movepick]")');
          await page.key('Enter');
          await settled();
          await look(); noWord('Move them');
          // a jot, which files the session
          await page.click('#hjot');
          await page.type('The crew lands at Dock Row.');
          await page.key('Enter');
          await page.waitFor('/Filed as: Session 15/.test((document.getElementById("rfiled") || {}).textContent || "")');
          await settled();
          await look(); noWord('the jot and the filing');
          await page.sleep(300);
        });
        assert.equal(filed.length, 1, 'filed once');
        assert.match(pstream.raw(), /event: (hello|view)/, 'the players\' stream was read');
        await look();
        noWord('at the end');
        // the Table Log the filing made holds no word either
        for (const f of walk(path.join(vault, S15)).filter((x) => /Table Log/.test(x))) {
          assert.ok(!fs.readFileSync(f, 'utf8').includes(WORD), `${f} holds the secret word`);
        }
      } finally {
        pstream.close();
        await run.close();
      }
    });
  }

  // Task 12, F10: the no-Plan page's new routes to the players (Show from a card's link, Fight here at the card's place)
  // keep back a withheld NPC's name and a gm_aliases name, both linked from a card: the existing forbidden list, read
  // from the vault's notes, is checked on every view and the stream.
  it('a withheld NPC and a gm_aliases name on a card reach the players by no route', { timeout: 120000 }, async () => {
    const vault = copyRecordFixture();
    made.push(vault);
    const SALT = 'Locations/The Salt Inn.md';
    const MOTT = 'Characters/NPCs/Mott Ferrage.md';
    const DACE = 'Characters/NPCs/Dace Lorrimer.md';
    fs.writeFileSync(path.join(vault, MOTT), '---\nname: Mott Ferrage\ntype: npc\nwithheld: true\nlocation: "[[The Salt Inn]]"\n---\n\nA lamp thief.\n');
    fs.writeFileSync(path.join(vault, DACE), '---\nname: Dace Lorrimer\ntype: npc\ngm_aliases:\n  - The Lantern Hand\nlocation: "[[The Salt Inn]]"\n---\n\nA harbour clerk.\n');
    const wrap = path.join(vault, 'Chapters/Chapter 3/Sessions/Session 14/Session 14 - Ledger - Wrap-Up.md');
    const text = fs.readFileSync(wrap, 'utf8');
    const from = '- **Unsigned notes:** someone keeps slipping the crew notes with no name on them.\n';
    assert.ok(text.includes(from));
    fs.writeFileSync(wrap, text.replace(from, `${from}- **Night visitors:** [[Mott Ferrage]] and [[Dace Lorrimer]] came by [[The Salt Inn]] after dark.\n`));

    const session = pickSession(listSessions(vault), null, vault).session;
    const { file, stateId } = stateFileFor(vault, session);
    const run = createTableServer({ vaultPath: vault, session, stateFile: file, stateId, deps: { delayMs: 50, log: () => {} } });
    const port = await listenLocal(run.server, 0);
    const base = `http://127.0.0.1:${port}/`;
    const pstream = stream(port, '/api/players/events');
    try {
      const gmModel = await req(port, 'GET', '/api/model');
      const model = JSON.parse(gmModel.text).model;
      // a name the players may read: one the sheet starts seen, and Dace's own name, shown on purpose below
      const seen = new Set([...Object.keys(model.seenFrom || {}), DACE].map((n) => (matter(fs.readFileSync(path.join(vault, n), 'utf8')).data || {}).name));
      const forbidden = forbiddenList(vault, model, { plan: null }).filter((x) => !(x.why === 'an unshown name' && seen.has(x.text)));
      for (const must of ['Mott Ferrage', 'The Lantern Hand']) assert.ok(forbidden.some((x) => x.text === must), `the forbidden list holds ${must}`);
      // the control: the GM's own model holds both, so the players' filter is what keeps them back
      for (const must of ['Mott Ferrage', 'The Lantern Hand']) assert.ok(gmModel.text.includes(must), `the GM's model holds ${must}`);
      const checks = forbidden.map((x) => ({ ...x, hit: matcher(x) }));
      const views = [];
      const look = async () => { views.push((await req(port, 'GET', '/api/players/view')).text); };
      const clean = (where) => {
        for (const c of checks) {
          for (const v of views) assert.ok(!c.hit(v), `${where}: the players' view holds ${c.text} (${c.why})`);
          assert.ok(!c.hit(pstream.raw()), `${where}: the players' stream holds ${c.text} (${c.why})`);
        }
      };
      await withPage({ width: 1449, height: 762 }, async (page) => {
        const settled = () => page.waitFor(`(() => { const p = ${PROBE}; return p && p.saved === 'Saved' && p.pending === 0 && document.getElementById('where') && p; })()`);
        await page.goto(`${base}?probe=1`);
        await settled();
        await look(); clean('opened');
        const fightHere = async (where) => {
          await page.click(`#where .wrow [data-fplace="${SALT}"]`);
          await page.waitFor(`(() => { const p = ${PROBE}; return p && p.fight && p.saved === 'Saved' && p.pending === 0 && p; })()`);
          await look(); clean(where);
        };
        // Fight here at the card's place (it places the crew there, so Show has a group), then end it
        await fightHere('Fight here');
        await page.click('#fEnd');
        await page.click('#fEnd');
        await page.waitFor(`(() => { const p = ${PROBE}; return p && !p.fight && p; })()`);
        await settled();
        // Show each from the card's link
        for (const n of [MOTT, DACE]) {
          await page.click(`#scenes a[data-note="${n}"]`);
          // the drawer slides in: the button is pressed once it is wholly on screen and still
          const at = `(() => { const b = document.querySelector('#drawer.open #dshow [data-dshow="${n}"]'); if (!b) return null; const r = b.getBoundingClientRect(); return r.width > 0 && r.right <= innerWidth && r.left >= 0 ? Math.round(r.left) : null; })()`;
          await page.waitFor(at);
          for (let last = null, now = await page.evaluate(at); now !== last; last = now, now = await page.evaluate(at)) await page.sleep(100);
          await page.click(`#dshow [data-dshow="${n}"]`);
          await waitFor(async () => Object.values((await req(port, 'GET', '/api/state')).json.state.panels || {}).some((x) => (x.people || []).includes(n)), `${n} shown`);
          await page.key('Escape');
          await look(); clean(`Show ${n}`);
        }
        // the shown: Dace by his own name, Mott only as the withheld word
        const shown = JSON.parse(views[views.length - 1]).panels.flatMap((p) => p.people.map((w) => w.name));
        assert.ok(shown.includes('Dace Lorrimer') && shown.length === 2, JSON.stringify(shown));
        // and a fight there with both on the players' screen
        await fightHere('Fight here after Show');
        await page.sleep(300);
      });
      await look();
      clean('at the end');
      assert.match(pstream.raw(), /event: (hello|view)/, 'the players\' stream was read');
    } finally {
      pstream.close();
      await run.close();
    }
  });
});
