const { test, before } = require('node:test');
const assert = require('node:assert');
const { runInbox, defaultRunWrangler, WRANGLER_TIMEOUT_MS } = require('../lib/inbox-cli.js');

let inbox;
before(async () => { inbox = await import('../templates-scaffold/functions/api/inbox-core.mjs'); });

function fakeKV() {
  const store = new Map();
  return {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
    async list({ prefix } = {}) {
      return { keys: [...store.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name })) };
    },
  };
}
function capture() { const lines = []; return { out: (s) => lines.push(String(s)), lines }; }

test('open sets the session code', async () => {
  const kv = fakeKV(); const c = capture();
  const rc = await runInbox(['open', 'wolf'], { adapter: kv, out: c.out });
  assert.equal(rc, 0);
  assert.equal(await inbox.getCode(kv), 'WOLF');
  assert.match(c.lines.join('\n'), /Session code set: WOLF/);
});

test('code prints current or (none)', async () => {
  const kv = fakeKV(); let c = capture();
  await runInbox(['code'], { adapter: kv, out: c.out });
  assert.match(c.lines.join('\n'), /\(none\)/);
  await inbox.setCode(kv, 'BEAR');
  c = capture();
  await runInbox(['code'], { adapter: kv, out: c.out });
  assert.match(c.lines.join('\n'), /BEAR/);
});

test('pull prints pending entries as JSON, sorted by timestamp', async () => {
  const kv = fakeKV(); const c = capture();
  await inbox.enqueue(kv, { id: 'b', character: 'ana', text: 'later', timestamp: '2026-07-11T14:02:00.000Z' });
  await inbox.enqueue(kv, { id: 'a', character: 'ana', text: 'first', timestamp: '2026-07-11T14:01:00.000Z' });
  await runInbox(['pull'], { adapter: kv, out: c.out });
  const arr = JSON.parse(c.lines.join(''));
  assert.deepEqual(arr.map(e => e.id), ['a', 'b']);
});

test('handled and flag transition status', async () => {
  const kv = fakeKV();
  await inbox.enqueue(kv, { id: 'a', character: 'ana', text: 'x', timestamp: '2026-07-11T14:01:00.000Z' });
  await inbox.enqueue(kv, { id: 'b', character: 'bo', text: 'y', timestamp: '2026-07-11T14:02:00.000Z' });
  await runInbox(['handled', 'a'], { adapter: kv });
  await runInbox(['flag', 'b'], { adapter: kv });
  const r = await inbox.getResults(kv, ['a', 'b']);
  assert.deepEqual(r.a, { status: 'handled', response: null, kind: null });
  assert.deepEqual(r.b, { status: 'flagged', response: null, kind: null });
  // both left the pending queue
  assert.deepEqual((await inbox.readPending(kv)).map(e => e.id), []);
});

test('reply attaches response + kind and finalizes status', async () => {
  const kv = fakeKV();
  await inbox.enqueue(kv, { id: 'a', character: 'Six', text: 'x', timestamp: '2026-07-12T00:00:00Z' });
  await inbox.enqueue(kv, { id: 'b', character: 'Bo', text: 'y', timestamp: '2026-07-12T00:00:01Z' });
  const rc1 = await runInbox(['reply', 'a', 'applied', '✓ done'], { adapter: kv });
  const rc2 = await runInbox(['reply', 'b', 'rejected', 'costs 6, has 5'], { adapter: kv });
  assert.equal(rc1, 0); assert.equal(rc2, 0);
  const r = await inbox.getResults(kv, ['a', 'b']);
  assert.deepEqual(r.a, { status: 'handled', response: '✓ done', kind: 'applied' });
  assert.deepEqual(r.b, { status: 'flagged', response: 'costs 6, has 5', kind: 'rejected' });
});

test('reply attaches an advice response and finalizes status', async () => {
  const kv = fakeKV();
  await inbox.enqueue(kv, { id: 'c', character: 'Ronin', text: 'is it worth raising DX?', timestamp: '2026-07-12T00:00:02Z' });
  const rc = await runInbox(['reply', 'c', 'advice', '• hint'], { adapter: kv });
  assert.equal(rc, 0);
  const r = await inbox.getResults(kv, ['c']);
  assert.deepEqual(r.c, { status: 'handled', response: '• hint', kind: 'advice' });
});

test('reply rejects an unknown kind', async () => {
  const kv = fakeKV(); const c = capture();
  const rc = await runInbox(['reply', 'a', 'bogus', 'x'], { adapter: kv, out: c.out });
  assert.equal(rc, 1);
  assert.match(c.lines.join('\n'), /applied\|rejected\|advice/);
});

test('the wrangler call the watcher polls through is bounded by a timeout', () => {
  // The watcher's poll loop writes .watcher-heartbeat only after `inbox pull`
  // returns. An unbounded spawn on a hung wrangler stalls the heartbeat with no
  // exit and no failure line, so the loop looks dead and the GM cannot tell.
  const seen = [];
  const res = defaultRunWrangler(['kv', 'key', 'list'], (cmd, args, opts) => {
    seen.push({ cmd, args, opts });
    return { code: 0, stdout: '[]', stderr: '' };
  });
  assert.equal(res.code, 0);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].cmd, 'npx');
  assert.deepEqual(seen[0].args, ['wrangler@4', 'kv', 'key', 'list']);
  assert.ok(Number.isFinite(seen[0].opts.timeoutMs) && seen[0].opts.timeoutMs > 0,
    `expected a finite positive timeoutMs, got ${JSON.stringify(seen[0].opts)}`);
  assert.equal(seen[0].opts.timeoutMs, WRANGLER_TIMEOUT_MS);
});

test('a timed-out wrangler call reports failure instead of hanging', () => {
  const res = defaultRunWrangler(['kv', 'key', 'list'],
    () => ({ code: 1, stdout: '', stderr: '', error: 'ETIMEDOUT' }));
  assert.equal(res.code, 1);
});

test('reply exits non-zero and says so when the request no longer exists (#176)', async () => {
  const kv = fakeKV(); const c = capture();
  const rc = await runInbox(['reply', 'nope', 'advice', 'hello'], { adapter: kv, out: c.out });
  assert.equal(rc, 1);
  assert.match(c.lines.join('\n'), /NOT stored/);
  assert.equal(await kv.get('req:nope'), null, 'nothing was written');
});

test('reply reports its own write outcome on success (#176)', async () => {
  const kv = fakeKV(); const c = capture();
  await inbox.enqueue(kv, { id: 'a', character: 'ana', text: 'x', timestamp: '2026-07-11T14:01:00.000Z' });
  const rc = await runInbox(['reply', 'a', 'advice', 'try', 'this'], { adapter: kv, out: c.out });
  assert.equal(rc, 0);
  assert.match(c.lines.join('\n'), /a: reply stored \(advice\) → status handled/);
  assert.equal(JSON.parse(await kv.get('req:a')).response, 'try this');
});

test('handled/flag exit non-zero for an id that does not exist (#176)', async () => {
  const kv = fakeKV(); const c = capture();
  await inbox.enqueue(kv, { id: 'a', character: 'ana', text: 'x', timestamp: '2026-07-11T14:01:00.000Z' });
  assert.equal(await runInbox(['handled', 'a', 'ghost'], { adapter: kv, out: c.out }), 1);
  assert.match(c.lines.join('\n'), /a: marked handled/);
  assert.match(c.lines.join('\n'), /ghost: NOT marked handled/);
  assert.equal(await runInbox(['flag', 'ghost'], { adapter: kv, out: c.out }), 1);
});

test('inbox commands fail clearly outside a site directory (no wrangler.toml) (#176)', async () => {
  const os = require('os'); const fs = require('fs'); const path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-inbox-nosite-'));
  await assert.rejects(runInbox(['pull'], { cwd: dir }), /No wrangler\.toml in .*site directory/);
});
