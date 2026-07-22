const fs = require('fs');
const path = require('path');

const KV_PLACEHOLDER = 'PUT-YOUR-KV-NAMESPACE-ID-HERE';

// True only when wrangler.toml declares a KV namespace id that isn't the
// scaffold placeholder — i.e. the site has actually been wired to a KV store.
function hasRealKvId(siteDir) {
  const toml = path.join(siteDir, 'wrangler.toml');
  if (!fs.existsSync(toml)) return false;
  const raw = fs.readFileSync(toml, 'utf8');
  const m = raw.match(/id\s*=\s*"([^"]+)"/);
  return !!(m && m[1] && m[1] !== KV_PLACEHOLDER);
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
