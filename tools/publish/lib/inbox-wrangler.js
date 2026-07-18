// KV-like adapter that reaches the site's INBOX namespace from the GM's laptop
// via `wrangler kv key` commands. Same shape inbox-core.mjs expects, so the
// loop reuses the exact Part 1 queue logic locally.

// Pull the INBOX namespace id straight out of wrangler.toml (unambiguous —
// we pass --namespace-id rather than relying on binding resolution).
function readNamespaceId(tomlText) {
  const lines = String(tomlText).split(/\r?\n/);
  let inInbox = false;
  for (const line of lines) {
    const t = line.trim();
    if (t === '[[kv_namespaces]]') { inInbox = false; continue; }
    if (/^binding\s*=\s*"INBOX"/.test(t)) { inInbox = true; continue; }
    if (inInbox) {
      const m = t.match(/^id\s*=\s*"([^"]+)"/);
      if (m) return m[1];
    }
  }
  return null;
}

function makeAdapter({ runWrangler, namespaceId }) {
  const ns = ['--namespace-id', namespaceId, '--remote'];
  return {
    async get(key) {
      const res = runWrangler(['kv', 'key', 'get', key, ...ns]);
      if (res.code === 0) return res.stdout.replace(/\n$/, '');
      // A non-zero exit is EITHER a genuinely-absent key (benign) OR a real read
      // failure — auth expired, wrong namespace, no network, wrangler missing.
      // Mirror a real KV binding: a missing key returns null, everything else
      // throws. Anything swallowed here masquerades as an empty campaign to every
      // caller (getStates, readPending, ...), which is the failure we must avoid.
      //
      // An operational failure often ALSO contains "not found" (e.g. a wrong
      // namespace: "KV namespace ... not found [code: 10041]"), so those signals
      // are checked first and always throw — only a key-scoped not-found with no
      // operational signal is treated as an absent key.
      const err = (res.stderr || '').toLowerCase();
      const operational = /namespace|authenticat|authoriz|unauthor|permission|credential|not logged in|network|fetch failed|timeout|econn|enotfound|10041|10000/.test(err);
      if (!operational && /not found|not_found|no value|does not exist/.test(err)) return null;
      throw new Error('wrangler kv get failed for "' + key + '": ' + ((res.stderr || '').trim() || 'exit ' + res.code));
    },
    async put(key, value, opts) {
      const extra = opts && opts.expirationTtl ? ['--ttl', String(opts.expirationTtl)] : [];
      const res = runWrangler(['kv', 'key', 'put', key, value, ...ns, ...extra]);
      if (res.code !== 0) throw new Error(`wrangler put failed: ${res.stderr}`);
    },
    async delete(key) {
      runWrangler(['kv', 'key', 'delete', key, ...ns]);
    },
    async list({ prefix } = {}) {
      const args = ['kv', 'key', 'list', ...ns];
      if (prefix) args.push('--prefix', prefix);
      const res = runWrangler(args);
      if (res.code !== 0) throw new Error(`wrangler list failed: ${res.stderr}`);
      const parsed = JSON.parse(res.stdout || '[]');
      return { keys: parsed.map(k => ({ name: k.name })) };
    },
  };
}

module.exports = { readNamespaceId, makeAdapter };
