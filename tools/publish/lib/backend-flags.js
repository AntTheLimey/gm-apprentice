const fs = require('fs');
const path = require('path');
const { readNamespaceId } = require('./inbox-wrangler');

const KV_PLACEHOLDER = 'PUT-YOUR-KV-NAMESPACE-ID-HERE';

// True only when wrangler.toml declares an INBOX KV namespace id that isn't
// the scaffold placeholder — i.e. the site has actually been wired to a KV
// store. Delegates to readNamespaceId, which scopes to the `binding =
// "INBOX"` block instead of matching the first `id = "..."` in the file
// (which could belong to an unrelated key like account_id).
function hasRealKvId(siteDir) {
  const toml = path.join(siteDir, 'wrangler.toml');
  if (!fs.existsSync(toml)) return false;
  const raw = fs.readFileSync(toml, 'utf8');
  const id = readNamespaceId(raw);
  return !!(id && id !== KV_PLACEHOLDER);
}

// A capability is detected as "on" for a legacy (flag-less) site only when its
// Function is present AND a real KV id is configured. Both together mean the
// feature was genuinely deployed, not merely scaffolded.
function detectInbox(siteDir) {
  return fs.existsSync(path.join(siteDir, 'functions', 'api', 'request.js')) && hasRealKvId(siteDir);
}

function detectStatusBar(siteDir) {
  return fs.existsSync(path.join(siteDir, 'functions', 'api', 'loadout.js')) && hasRealKvId(siteDir);
}

// Explicit boolean flags are authoritative; an undefined flag falls back to
// detection so pre-flags sites keep their UI after upgrading.
function resolveBackendFlags(explicit, siteDir) {
  const e = explicit || {};
  return {
    statusBar: typeof e.statusBar === 'boolean' ? e.statusBar : detectStatusBar(siteDir),
    inbox: typeof e.inbox === 'boolean' ? e.inbox : detectInbox(siteDir),
  };
}

module.exports = { resolveBackendFlags, detectInbox, detectStatusBar, hasRealKvId };
