const { test, before } = require('node:test');
const assert = require('node:assert');
const { runInbox } = require('../lib/inbox-cli.js');

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
  assert.deepEqual(await inbox.getStatuses(kv, ['a', 'b']), { a: 'handled', b: 'flagged' });
  // both left the pending queue
  assert.deepEqual((await inbox.readPending(kv)).map(e => e.id), []);
});
