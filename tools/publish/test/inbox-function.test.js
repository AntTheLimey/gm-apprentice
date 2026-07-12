const { test, before } = require('node:test');
const assert = require('node:assert');

let fn, inbox;
before(async () => {
  fn = await import('../templates-scaffold/functions/api/request.js');
  inbox = await import('../templates-scaffold/functions/api/inbox-core.mjs');
});

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

function postCtx(kv, body, ip = '9.9.9.9') {
  const request = new Request('https://site.pages.dev/api/request', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
    body: JSON.stringify(body),
  });
  return { request, env: { INBOX: kv } };
}

function getCtx(kv, ids) {
  const request = new Request(`https://site.pages.dev/api/request?ids=${ids.join(',')}`);
  return { request, env: { INBOX: kv } };
}

test('POST with valid code enqueues and returns id', async () => {
  const kv = fakeKV();
  await inbox.setCode(kv, 'WOLF');
  const res = await fn.onRequestPost(postCtx(kv, { code: 'wolf', character: 'ana', text: 'spend 1 xp on streetwise' }));
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.ok(out.id);
  assert.equal(out.status, 'pending');
  const pending = await inbox.readPending(kv);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].character, 'ana');
});

test('POST with wrong code returns 403 error:code', async () => {
  const kv = fakeKV();
  await inbox.setCode(kv, 'WOLF');
  const res = await fn.onRequestPost(postCtx(kv, { code: 'BEAR', character: 'ana', text: 'x' }));
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: 'code' });
});

test('POST with empty text returns 400', async () => {
  const kv = fakeKV();
  await inbox.setCode(kv, 'WOLF');
  const res = await fn.onRequestPost(postCtx(kv, { code: 'WOLF', character: 'ana', text: '   ' }));
  assert.equal(res.status, 400);
});

test('GET returns per-id {status,response,kind}', async () => {
  const kv = fakeKV();
  await inbox.enqueue(kv, { id: 'k', character: 'ana', text: 'k', timestamp: '2026-07-11T14:00:00.000Z' });
  await inbox.setResponse(kv, 'k', 'advice', '• hi');
  const res = await fn.onRequestGet(getCtx(kv, ['k', 'gone']));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    k: { status: 'handled', response: '• hi', kind: 'advice' },
    gone: { status: 'handled', response: null, kind: null },
  });
});

test('GET with more than 50 ids returns 400', async () => {
  const kv = fakeKV();
  const ids = Array.from({ length: 51 }, (_, i) => 'x' + i);
  const res = await fn.onRequestGet(getCtx(kv, ids));
  assert.equal(res.status, 400);
});

test('POST is rate-limited after the cap from one IP', async () => {
  const kv = fakeKV();
  await inbox.setCode(kv, 'WOLF');
  let last;
  for (let i = 0; i < 11; i++) {
    last = await fn.onRequestPost(postCtx(kv, { code: 'WOLF', character: 'ana', text: 'x' }, '5.5.5.5'));
  }
  assert.equal(last.status, 429);
  assert.deepEqual(await last.json(), { error: 'rate' });
});
