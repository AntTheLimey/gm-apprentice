const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { readNamespaceId } = require('./inbox-wrangler');

const KV_PLACEHOLDER = 'PUT-YOUR-KV-NAMESPACE-ID-HERE';
const KV_PERMISSION_FIX =
  'Your Cloudflare token lacks KV permission. Edit it (My Profile → API Tokens → your token → Edit) ' +
  'to add the row Account · Workers KV Storage · Edit, then re-run.';

function checkKvPermission({ runWrangler }) {
  const r = runWrangler(['kv', 'namespace', 'list']);
  if (r.code === 0) return { ok: true };
  const blob = `${r.stdout || ''}\n${r.stderr || ''}`;
  if (/10000|Authentication/i.test(blob)) return { ok: false, fix: KV_PERMISSION_FIX };
  return { ok: false, fix: `wrangler could not list KV namespaces: ${(r.stderr || '').trim()}` };
}

// Parse the id from `wrangler kv namespace create` output (prints an `id = "..."`
// line, or JSON with an "id" field depending on version).
function parseCreatedId(stdout) {
  const m = String(stdout).match(/id\s*=\s*"([^"]+)"/) || String(stdout).match(/"id"\s*:\s*"([^"]+)"/);
  return m ? m[1] : null;
}

// Find an existing namespace titled INBOX in `kv namespace list` JSON output.
function findInboxId(listStdout) {
  try {
    const arr = JSON.parse(listStdout);
    const hit = Array.isArray(arr) ? arr.find((n) => n.title === 'INBOX' || /(?:^|_)INBOX$/.test(n.title || '')) : null;
    return hit ? hit.id : null;
  } catch { return null; }
}

function ensureKvNamespace({ runWrangler, tomlText }) {
  const existing = readNamespaceId(tomlText || '');
  if (existing && existing !== KV_PLACEHOLDER) return { id: existing, created: false };
  const list = runWrangler(['kv', 'namespace', 'list']);
  if (list.code === 0) {
    const found = findInboxId(list.stdout);
    if (found) return { id: found, created: false };
  }
  const created = runWrangler(['kv', 'namespace', 'create', 'INBOX']);
  const id = parseCreatedId(created.stdout);
  if (created.code !== 0 || !id) {
    throw new Error(`Could not create the INBOX KV namespace: ${(created.stderr || created.stdout || '').trim()}`);
  }
  return { id, created: true };
}

const INBOX_BLOCK = (kvId) => `[[kv_namespaces]]\nbinding = "INBOX"\nid = "${kvId}"`;

function patchWranglerToml(tomlText, { name, kvId }) {
  let out = String(tomlText);
  // 1. name
  if (/^name\s*=\s*".*"$/m.test(out)) {
    out = out.replace(/^name\s*=\s*".*"$/m, `name = "${name}"`);
  } else {
    out = `name = "${name}"\n${out}`;
  }
  // 2. INBOX kv block — replace the id in an existing INBOX block, else append.
  if (readNamespaceId(out) !== null) {
    // Replace the id line that follows `binding = "INBOX"`.
    const lines = out.split(/\r?\n/);
    let inInbox = false;
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (t === '[[kv_namespaces]]') inInbox = false;
      if (/^binding\s*=\s*"INBOX"/.test(t)) inInbox = true;
      else if (inInbox && /^id\s*=\s*"/.test(t)) { lines[i] = `id = "${kvId}"`; break; }
    }
    out = lines.join('\n');
  } else {
    out = `${out.replace(/\n*$/, '')}\n\n${INBOX_BLOCK(kvId)}\n`;
  }
  return out;
}

const defaultRunWrangler = (args) => {
  const r = spawnSync('npx', ['wrangler@4', ...args], { encoding: 'utf8' });
  return { code: r.status == null ? 1 : r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
};

const FLAG_KEY = { 'status-bar': 'statusBar', inbox: 'inbox' };
const LABEL = { 'status-bar': 'live status bar', inbox: 'change-request inbox' };

async function runSetupBackend(feature, { configPath }, deps = {}) {
  const out = deps.out || console.log;
  const runWrangler = deps.runWrangler || defaultRunWrangler;
  const readFile = deps.readFile || ((p) => fs.readFileSync(p, 'utf8'));
  const writeFile = deps.writeFile || ((p, c) => fs.writeFileSync(p, c));
  const build = deps.build || ((opts) => require('./build').build(opts));

  const flagKey = FLAG_KEY[feature];
  if (!flagKey) { out(`Unknown setup feature: ${feature}`); return 1; }

  const config = JSON.parse(readFile(configPath));
  const siteRoot = path.dirname(path.resolve(configPath));
  const tomlPath = path.join(siteRoot, 'wrangler.toml');
  const projectName = config.cloudflarePagesProject || path.basename(siteRoot);

  // Preflight: KV permission.
  const perm = checkKvPermission({ runWrangler });
  if (!perm.ok) { out(perm.fix); return 1; }

  // Ensure namespace (idempotent).
  let tomlText = readFile(tomlPath);
  let kv;
  try { kv = ensureKvNamespace({ runWrangler, tomlText }); }
  catch (e) { out(e.message); return 1; }

  // Patch wrangler.toml (name-align + KV block) and write back.
  tomlText = patchWranglerToml(tomlText, { name: projectName, kvId: kv.id });
  writeFile(tomlPath, tomlText);

  // Flip the backend flag.
  config.backend = config.backend || {};
  config.backend[flagKey] = true;
  writeFile(configPath, JSON.stringify(config, null, 2) + '\n');

  // Build (the flag is now on → Functions sync in) + deploy.
  build({ configPath });
  const dep = runWrangler(['pages', 'deploy']);
  if (dep.code !== 0) { out(`Deploy failed: ${(dep.stderr || dep.stdout || '').trim()}`); return 1; }

  const url = config.siteUrl || `https://${projectName}.pages.dev`;
  out(`Your ${LABEL[feature]} is set up and deployed. Live at ${url}.`);
  return 0;
}

module.exports = { checkKvPermission, ensureKvNamespace, patchWranglerToml, INBOX_BLOCK, KV_PERMISSION_FIX, runSetupBackend };
