const { describe, it } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { detectInbox, detectStatusBar, hasRealKvId } = require('../../lib/backend-flags');

function siteDir({ request = false, loadout = false, kv = 'none' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-site-'));
  if (request || loadout) fs.mkdirSync(path.join(dir, 'functions', 'api'), { recursive: true });
  if (request) fs.writeFileSync(path.join(dir, 'functions', 'api', 'request.js'), '// fn');
  if (loadout) fs.writeFileSync(path.join(dir, 'functions', 'api', 'loadout.js'), '// fn');
  if (kv === 'real') fs.writeFileSync(path.join(dir, 'wrangler.toml'), '[[kv_namespaces]]\nbinding = "INBOX"\nid = "abc123def456"\n');
  else if (kv === 'placeholder') fs.writeFileSync(path.join(dir, 'wrangler.toml'), '[[kv_namespaces]]\nbinding = "INBOX"\nid = "PUT-YOUR-KV-NAMESPACE-ID-HERE"\n');
  return dir;
}

// A hand-edited wrangler.toml with an account_id line ABOVE the KV namespace
// block. A loose whole-file regex for `id = "..."` would match account_id's
// value first and falsely report the KV as configured.
function siteDirWithAccountIdAbove(kvId) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-site-'));
  fs.writeFileSync(
    path.join(dir, 'wrangler.toml'),
    `account_id = "abc123realvalue"\n\n[[kv_namespaces]]\nbinding = "INBOX"\nid = "${kvId}"\n`
  );
  return dir;
}

describe('backend detection (used by the migration only)', () => {
  it('a placeholder KV id counts as not configured', () => {
    const dir = siteDir({ request: true, loadout: true, kv: 'placeholder' });
    assert.strictEqual(detectInbox(dir), false);
    assert.strictEqual(detectStatusBar(dir), false);
  });

  it('function present but no wrangler.toml is off', () => {
    const dir = siteDir({ request: true, loadout: true, kv: 'none' });
    assert.strictEqual(detectInbox(dir), false);
    assert.strictEqual(detectStatusBar(dir), false);
  });

  it('detects inbox and status bar independently', () => {
    const dir = siteDir({ request: false, loadout: true, kv: 'real' });
    assert.strictEqual(detectInbox(dir), false);
    assert.strictEqual(detectStatusBar(dir), true);
  });

  it('no longer exports resolveBackendFlags', () => {
    assert.strictEqual(require('../../lib/backend-flags').resolveBackendFlags, undefined);
  });

  it('hasRealKvId rejects the placeholder', () => {
    assert.strictEqual(hasRealKvId(siteDir({ kv: 'placeholder' })), false);
    assert.strictEqual(hasRealKvId(siteDir({ kv: 'real' })), true);
  });

  it('an account_id line above the KV block does not count as the KV id (placeholder)', () => {
    const dir = siteDirWithAccountIdAbove('PUT-YOUR-KV-NAMESPACE-ID-HERE');
    assert.strictEqual(hasRealKvId(dir), false);
  });

  it('an account_id line above the KV block is ignored when the KV id is real', () => {
    const dir = siteDirWithAccountIdAbove('abc123def456');
    assert.strictEqual(hasRealKvId(dir), true);
  });
});
