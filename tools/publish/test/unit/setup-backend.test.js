const { test } = require('node:test');
const assert = require('node:assert');
const { checkKvPermission, ensureKvNamespace, patchWranglerToml } = require('../../lib/setup-backend');
const { readNamespaceId } = require('../../lib/inbox-wrangler');

const MINIMAL = 'name = "old-name"\npages_build_output_dir = "docs"\ncompatibility_date = "2024-11-01"\n';
const WITH_PLACEHOLDER = MINIMAL + '\n[[kv_namespaces]]\nbinding = "INBOX"\nid = "PUT-YOUR-KV-NAMESPACE-ID-HERE"\n';
const WITH_REAL = MINIMAL + '\n[[kv_namespaces]]\nbinding = "INBOX"\nid = "realid123"\n';

test('patchWranglerToml sets name and appends an INBOX block on a minimal toml', () => {
  const out = patchWranglerToml(MINIMAL, { name: 'proj-x', kvId: 'kv999' });
  assert.match(out, /^name = "proj-x"$/m);
  assert.strictEqual(readNamespaceId(out), 'kv999');
  assert.match(out, /pages_build_output_dir = "docs"/);      // preserved
});

test('patchWranglerToml replaces the placeholder id in place (no duplicate block)', () => {
  const out = patchWranglerToml(WITH_PLACEHOLDER, { name: 'proj-x', kvId: 'kv999' });
  assert.strictEqual(readNamespaceId(out), 'kv999');
  assert.strictEqual((out.match(/\[\[kv_namespaces\]\]/g) || []).length, 1);
});

test('patchWranglerToml is idempotent', () => {
  const once = patchWranglerToml(WITH_REAL, { name: 'proj-x', kvId: 'kv999' });
  const twice = patchWranglerToml(once, { name: 'proj-x', kvId: 'kv999' });
  assert.strictEqual(once, twice);
});

test('checkKvPermission ok on code 0', () => {
  const runWrangler = () => ({ code: 0, stdout: '[]', stderr: '' });
  assert.deepStrictEqual(checkKvPermission({ runWrangler }), { ok: true });
});

test('checkKvPermission maps code 10000 to the KV-permission fix', () => {
  const runWrangler = () => ({ code: 1, stdout: '', stderr: 'Authentication error [code: 10000]' });
  const r = checkKvPermission({ runWrangler });
  assert.strictEqual(r.ok, false);
  assert.match(r.fix, /Workers KV Storage/);
});

test('ensureKvNamespace reuses a real id from the toml (no create)', () => {
  let called = false;
  const runWrangler = () => { called = true; return { code: 0, stdout: '', stderr: '' }; };
  const r = ensureKvNamespace({ runWrangler, tomlText: WITH_REAL });
  assert.deepStrictEqual(r, { id: 'realid123', created: false });
  assert.strictEqual(called, false);   // did not shell out
});

test('ensureKvNamespace creates when only the placeholder is present', () => {
  const calls = [];
  const runWrangler = (args) => {
    calls.push(args.join(' '));
    if (args[1] === 'namespace' && args[2] === 'list') return { code: 0, stdout: '[]', stderr: '' };
    return { code: 0, stdout: 'id = "newkv456"', stderr: '' };   // create output
  };
  const r = ensureKvNamespace({ runWrangler, tomlText: WITH_PLACEHOLDER });
  assert.strictEqual(r.created, true);
  assert.strictEqual(r.id, 'newkv456');
});
