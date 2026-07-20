const { test } = require('node:test');
const assert = require('node:assert');
const { readNamespaceId, makeAdapter } = require('../lib/inbox-wrangler.js');

test('readNamespaceId extracts the INBOX namespace id', () => {
  const toml = [
    'name = "dead-end"',
    'pages_build_output_dir = "docs"',
    '',
    '[[kv_namespaces]]',
    'binding = "INBOX"',
    'id = "abc123def456"',
  ].join('\n');
  assert.equal(readNamespaceId(toml), 'abc123def456');
  assert.equal(readNamespaceId('name = "x"'), null);
});

test('adapter.get returns stdout on success, null on missing', async () => {
  const calls = [];
  const runWrangler = (args) => {
    calls.push(args);
    if (args.includes('get')) {
      return args.includes('req:missing')
        ? { code: 1, stdout: '', stderr: 'not found' }
        : { code: 0, stdout: '{"id":"a"}\n', stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  const kv = makeAdapter({ runWrangler, namespaceId: 'NS' });
  assert.equal(await kv.get('req:a'), '{"id":"a"}');           // trailing newline trimmed
  assert.equal(await kv.get('req:missing'), null);
  assert.deepEqual(calls[0], ['kv', 'key', 'get', 'req:a', '--namespace-id', 'NS', '--remote']);
});

test('adapter.get throws on a real read failure (not a missing key)', async () => {
  const runWrangler = () => ({ code: 1, stdout: '', stderr: 'Authentication error [code: 10000]' });
  const kv = makeAdapter({ runWrangler, namespaceId: 'NS' });
  await assert.rejects(() => kv.get('req:a'), /wrangler kv get failed/);
});

test('adapter.get throws on a namespace error even though it says "not found"', async () => {
  // A wrong-namespace failure carries "not found" too; it must NOT be swallowed
  // as an absent key, or flush/inbox would read it as an empty campaign.
  const runWrangler = () => ({ code: 1, stdout: '', stderr: 'KV namespace "NS" not found [code: 10041]' });
  const kv = makeAdapter({ runWrangler, namespaceId: 'NS' });
  await assert.rejects(() => kv.get('req:a'), /wrangler kv get failed/);
});

test('adapter.get returns null on a missing-key 404 whose URL embeds "namespaces"', async () => {
  // Regression (#118): wrangler's missing-key 404 embeds the REST endpoint
  // (.../storage/kv/namespaces/<id>/values/<key>). The "namespaces" substring
  // must NOT trip the `namespace` operational signal — the key is simply absent,
  // so the whole inbox pull must not crash on one orphaned index id.
  const runWrangler = () => ({
    code: 1, stdout: '',
    stderr: '✘ [ERROR] Failed to fetch https://api.cloudflare.com/client/v4/accounts/acct/storage/kv/namespaces/ns/values/req%3Aa - 404: Not Found',
  });
  const kv = makeAdapter({ runWrangler, namespaceId: 'NS' });
  assert.equal(await kv.get('req:a'), null);
});

test('adapter.put forwards value and optional TTL', async () => {
  const calls = [];
  const runWrangler = (args) => { calls.push(args); return { code: 0, stdout: '', stderr: '' }; };
  const kv = makeAdapter({ runWrangler, namespaceId: 'NS' });
  await kv.put('config:code', 'WOLF');
  await kv.put('req:a', '{"x":1}', { expirationTtl: 300 });
  assert.deepEqual(calls[0], ['kv', 'key', 'put', 'config:code', 'WOLF', '--namespace-id', 'NS', '--remote']);
  assert.deepEqual(calls[1], ['kv', 'key', 'put', 'req:a', '{"x":1}', '--namespace-id', 'NS', '--remote', '--ttl', '300']);
});

test('adapter.list parses wrangler JSON into {keys:[{name}]}', async () => {
  const runWrangler = (args) => {
    assert.deepEqual(args, ['kv', 'key', 'list', '--namespace-id', 'NS', '--remote', '--prefix', 'req:']);
    return { code: 0, stdout: JSON.stringify([{ name: 'req:a' }, { name: 'req:b' }]), stderr: '' };
  };
  const kv = makeAdapter({ runWrangler, namespaceId: 'NS' });
  const out = await kv.list({ prefix: 'req:' });
  assert.deepEqual(out.keys.map(k => k.name), ['req:a', 'req:b']);
});
