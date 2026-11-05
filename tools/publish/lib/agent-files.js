'use strict';

// The files at the vault's root that tell an agent how to work in it (the plugin keeps a short
// block of its own in them). They are not notes: the scan, the publish list, `explain` and
// `manifest never-publish` all leave them out. Root only, and matched whatever the case, the
// same rule as vaultlib.py's is_skipped_path.
const AGENT_FILES = new Set(['agents.md', 'claude.md']);

function isAgentFile(rel) {
  const posix = String(rel).replace(/\\/g, '/').replace(/^\.\//, '');
  return !posix.includes('/') && AGENT_FILES.has(posix.toLowerCase());
}

module.exports = { AGENT_FILES, isAgentFile };
