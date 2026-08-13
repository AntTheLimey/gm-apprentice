const { test } = require('node:test');
const assert = require('node:assert');
const { createE2eResources } = require('../../lib/e2e-resources');

function fakeRunWrangler(script) {
  // script: array of { code, stdout, stderr } consumed in call order
  const calls = [];
  let i = 0;
  const runWrangler = (args) => {
    calls.push(args);
    const next = script[i] || { code: 0, stdout: '', stderr: '' };
    i++;
    return next;
  };
  return { runWrangler, calls };
}

test('create then cleanup deletes exactly the created ids, in reverse creation order', () => {
  const { runWrangler, calls } = fakeRunWrangler([
    { code: 0, stdout: 'id = "kvid1"', stderr: '' },      // createKvNamespace
    { code: 0, stdout: 'id = "kvid2"', stderr: '' },      // createKvNamespace (2nd)
    { code: 0, stdout: '', stderr: '' },                  // cleanup delete #2
    { code: 0, stdout: '', stderr: '' },                  // cleanup delete #1
  ]);
  const resources = createE2eResources({ runWrangler, runId: 'run1' });

  const id1 = resources.createKvNamespace('inbox');
  const id2 = resources.createKvNamespace('status-bar');
  assert.strictEqual(id1, 'kvid1');
  assert.strictEqual(id2, 'kvid2');

  const result = resources.cleanup({ dryRun: false });

  assert.strictEqual(result.length, 2);
  assert.strictEqual(result[0].id, 'kvid2');
  assert.strictEqual(result[1].id, 'kvid1');

  // Only the two create calls plus two delete calls happened, in reverse order.
  assert.strictEqual(calls.length, 4);
  assert.deepStrictEqual(calls[2], ['kv', 'namespace', 'delete', '--namespace-id', 'kvid2']);
  assert.deepStrictEqual(calls[3], ['kv', 'namespace', 'delete', '--namespace-id', 'kvid1']);
});

test('dry-run cleanup deletes nothing and reports the pending deletion list', () => {
  const { runWrangler, calls } = fakeRunWrangler([
    { code: 0, stdout: 'id = "kvid1"', stderr: '' },
  ]);
  const resources = createE2eResources({ runWrangler, runId: 'run1' });
  resources.createKvNamespace('inbox');

  const report = resources.cleanup({ dryRun: true });

  assert.strictEqual(report.length, 1);
  assert.strictEqual(report[0].id, 'kvid1');
  assert.strictEqual(report[0].name, 'e2e-run1-inbox');
  // Only the create call happened — no delete call was made.
  assert.strictEqual(calls.length, 1);
});

test('cleanup refuses to delete a hand-injected record whose name lacks the e2e- prefix', () => {
  const { runWrangler, calls } = fakeRunWrangler([]);
  const resources = createE2eResources({ runWrangler, runId: 'run1' });

  // Simulate polluted tracking: a record that did not come through createKvNamespace.
  resources._records.push({ type: 'kv', name: 'INBOX', id: 'prod-namespace-id' });

  assert.throws(() => resources.cleanup({ dryRun: false }), /e2e-/);
  // The guard must fire before any wrangler call is made.
  assert.strictEqual(calls.length, 0);
});

test('production-shaped names are impossible to construct via the factory', () => {
  const { runWrangler } = fakeRunWrangler([
    { code: 0, stdout: 'id = "kvid1"', stderr: '' },
  ]);
  const resources = createE2eResources({ runWrangler, runId: 'run1' });

  resources.createKvNamespace('INBOX');

  // Even asking for the label "INBOX" cannot produce the bare production name.
  assert.strictEqual(resources._records[0].name, 'e2e-run1-INBOX');
  assert.notStrictEqual(resources._records[0].name, 'INBOX');
  assert.match(resources._records[0].name, /^e2e-/);
});

test('createKvNamespace throws when wrangler fails or prints no id', () => {
  const { runWrangler } = fakeRunWrangler([
    { code: 1, stdout: '', stderr: 'boom' },
  ]);
  const resources = createE2eResources({ runWrangler, runId: 'run1' });
  assert.throws(() => resources.createKvNamespace('inbox'), /boom/);
});

test('createPagesProject names and tracks the project, falling back to the name as id', () => {
  const { runWrangler, calls } = fakeRunWrangler([
    { code: 0, stdout: "Successfully created the 'e2e-run1-site' project.", stderr: '' },
  ]);
  const resources = createE2eResources({ runWrangler, runId: 'run1' });

  const id = resources.createPagesProject('site');

  assert.strictEqual(id, 'e2e-run1-site');
  assert.deepStrictEqual(calls[0], ['pages', 'project', 'create', 'e2e-run1-site', '--production-branch=main']);
  assert.strictEqual(resources._records[0].name, 'e2e-run1-site');
});

test('createE2eResources exposes no list-based or title-based deletion API', () => {
  const { runWrangler } = fakeRunWrangler([]);
  const resources = createE2eResources({ runWrangler, runId: 'run1' });
  const keys = Object.keys(resources);
  assert.ok(!keys.some((k) => /list/i.test(k)));
  assert.ok(!keys.some((k) => /delete.*title|title.*delete/i.test(k)));
});
