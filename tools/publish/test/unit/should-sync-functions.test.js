const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { shouldSyncFunctions } = require('../../lib/sync-functions');

function siteDir(contents = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-gate-'));
  if (contents.wrangler) fs.writeFileSync(path.join(dir, 'wrangler.toml'), contents.wrangler);
  if (contents.requestFn) {
    fs.mkdirSync(path.join(dir, 'functions/api'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'functions/api/request.js'), '// fn');
  }
  return dir;
}

test('explicit both-off → no sync', () => {
  assert.strictEqual(shouldSyncFunctions(siteDir(), { statusBar: false, inbox: false }), false);
});

test('explicit inbox on → sync', () => {
  assert.strictEqual(shouldSyncFunctions(siteDir(), { inbox: true }), true);
});

test('explicit statusBar on → sync', () => {
  assert.strictEqual(shouldSyncFunctions(siteDir(), { statusBar: true }), true);
});

test('no explicit flags, real KV id + request Function → detected on → sync', () => {
  const dir = siteDir({
    wrangler: '[[kv_namespaces]]\nbinding = "INBOX"\nid = "abc123realid"\n',
    requestFn: true,
  });
  assert.strictEqual(shouldSyncFunctions(dir, undefined), true);
});

test('no explicit flags, placeholder KV + no Functions → detected off → no sync', () => {
  const dir = siteDir({
    wrangler: '[[kv_namespaces]]\nbinding = "INBOX"\nid = "PUT-YOUR-KV-NAMESPACE-ID-HERE"\n',
  });
  assert.strictEqual(shouldSyncFunctions(dir, undefined), false);
});
