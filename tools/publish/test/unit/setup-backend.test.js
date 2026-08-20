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

test('patchWranglerToml replaces a single-quoted name (no duplicate name line)', () => {
  const single = "name = 'old'\npages_build_output_dir = \"docs\"\n";
  const out = patchWranglerToml(single, { name: 'proj-x', kvId: 'kv999' });
  assert.match(out, /^name = "proj-x"$/m);
  assert.strictEqual((out.match(/^name\s*=/gm) || []).length, 1);
});

test('patchWranglerToml replaces a name line with an inline comment (no duplicate)', () => {
  const commented = 'name = "old" # existing project\npages_build_output_dir = "docs"\n';
  const out = patchWranglerToml(commented, { name: 'proj-x', kvId: 'kv999' });
  assert.match(out, /^name = "proj-x"$/m);
  assert.strictEqual((out.match(/^name\s*=/gm) || []).length, 1);
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

test('ensureKvNamespace creates when only the placeholder is present (never lists)', () => {
  const calls = [];
  const runWrangler = (args) => {
    calls.push(args);
    return { code: 0, stdout: 'id = "newkv456"', stderr: '' };   // create output
  };
  const r = ensureKvNamespace({ runWrangler, tomlText: WITH_PLACEHOLDER });
  assert.strictEqual(r.created, true);
  assert.strictEqual(r.id, 'newkv456');
  // No title-based reuse: must never enumerate other namespaces.
  assert.ok(!calls.some((a) => a.join(' ') === 'kv namespace list'));
  assert.deepStrictEqual(calls, [['kv', 'namespace', 'create', 'INBOX']]);
});

// #160 audit: setup-backend is the third wrangler entry point and was the other
// unbounded spawn. Its calls are quick control-plane ones (kv namespace
// list/create), so a stall means a wedged setup with no error.
test('the wrangler call backend setup runs through is bounded by a timeout', () => {
  const { defaultRunWrangler, WRANGLER_TIMEOUT_MS } = require('../../lib/setup-backend');
  const seen = [];
  const res = defaultRunWrangler(['kv', 'namespace', 'list'], { cwd: '/site' }, (cmd, args, opts) => {
    seen.push({ cmd, args, opts });
    return { code: 0, stdout: '[]', stderr: '' };
  });
  assert.equal(res.code, 0);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].cmd, 'npx');
  assert.deepEqual(seen[0].args, ['wrangler@4', 'kv', 'namespace', 'list']);
  assert.equal(seen[0].opts.cwd, '/site', 'cwd still reaches the child');
  assert.ok(Number.isFinite(seen[0].opts.timeoutMs) && seen[0].opts.timeoutMs > 0,
    `expected a finite positive timeoutMs, got ${JSON.stringify(seen[0].opts)}`);
  assert.equal(seen[0].opts.timeoutMs, WRANGLER_TIMEOUT_MS);
});

// #161 review: the wrappers dropped run-command's `error`, so a timed-out or
// un-spawnable wrangler produced "wrangler could not list KV namespaces: " with
// nothing after the colon — indistinguishable from a silent success.
test('a permission check on a timed-out wrangler names the failure', () => {
  const res = checkKvPermission({ runWrangler: () => ({ code: 1, stdout: '', stderr: '', error: 'ETIMEDOUT' }) });
  assert.equal(res.ok, false);
  assert.match(res.fix, /ETIMEDOUT/);
});

test('the backend-setup wrapper passes the process error through', () => {
  const { defaultRunWrangler } = require('../../lib/setup-backend');
  const res = defaultRunWrangler(['kv', 'namespace', 'list'], {},
    () => ({ code: 1, stdout: '', stderr: '', error: 'ETIMEDOUT' }));
  assert.equal(res.error, 'ETIMEDOUT');
});
