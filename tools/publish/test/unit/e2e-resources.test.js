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

test('cleanup deletes a Pages project by name, reverse-ordered alongside a KV namespace', () => {
  const { runWrangler, calls } = fakeRunWrangler([
    { code: 0, stdout: 'id = "kvid1"', stderr: '' },                                       // createKvNamespace
    { code: 0, stdout: "Successfully created the 'e2e-run1-site' project.", stderr: '' },   // createPagesProject
    { code: 0, stdout: '', stderr: '' },                                                    // delete pages (created last)
    { code: 0, stdout: '', stderr: '' },                                                    // delete kv
  ]);
  const resources = createE2eResources({ runWrangler, runId: 'run1' });

  resources.createKvNamespace('inbox');
  resources.createPagesProject('site');

  resources.cleanup({ dryRun: false });

  assert.deepStrictEqual(calls[2], ['pages', 'project', 'delete', 'e2e-run1-site']);
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

test('mutating a dry-run report cannot redirect a later real cleanup (records are frozen)', () => {
  const { runWrangler, calls } = fakeRunWrangler([
    { code: 0, stdout: 'id = "kvid1"', stderr: '' }, // create
    { code: 0, stdout: '', stderr: '' },              // real delete
  ]);
  const resources = createE2eResources({ runWrangler, runId: 'run1' });
  resources.createKvNamespace('inbox');

  const dryReport = resources.cleanup({ dryRun: true });
  assert.strictEqual(calls.length, 1);

  // Attempt to redirect the eventual deletion by mutating the dry-run report.
  dryReport[0].id = 'production-namespace-id';
  dryReport[0].name = 'INBOX';
  assert.strictEqual(dryReport[0].id, 'kvid1', 'record object is frozen — mutation is a no-op');
  assert.strictEqual(dryReport[0].name, 'e2e-run1-inbox');

  resources.cleanup({ dryRun: false });

  assert.deepStrictEqual(calls[1], ['kv', 'namespace', 'delete', '--namespace-id', 'kvid1']);
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

test('cleanup refuses to delete a hand-injected record even with a spoofed e2e- name (identity guard)', () => {
  const { runWrangler, calls } = fakeRunWrangler([]);
  const resources = createE2eResources({ runWrangler, runId: 'run1' });

  // #142's incident, expressed through this module: a name that passes the
  // prefix check but points at a real (e.g. production) id, injected
  // without going through createKvNamespace. The prefix alone must not be
  // enough to authorize a delete.
  resources._records.push({ type: 'kv', name: 'e2e-anything', id: 'production-inbox-id' });

  assert.throws(() => resources.cleanup({ dryRun: false }), /not created by this/);
  assert.strictEqual(calls.length, 0);
});

test('cleanup deletes a duplicated record only once, not twice', () => {
  const { runWrangler, calls } = fakeRunWrangler([
    { code: 0, stdout: 'id = "kvid1"', stderr: '' }, // create
    { code: 0, stdout: '', stderr: '' },              // the single real delete
  ]);
  const resources = createE2eResources({ runWrangler, runId: 'run1' });
  resources.createKvNamespace('inbox');

  // Polluted tracking: the same minted record object pushed onto _records
  // a second time (e.g. accidental double-tracking, not a foreign object).
  resources._records.push(resources._records[0]);
  assert.strictEqual(resources._records.length, 2);

  resources.cleanup({ dryRun: false });

  const deleteCalls = calls.filter((a) => a[2] === 'delete');
  assert.strictEqual(deleteCalls.length, 1, 'exactly one delete call, despite the duplicate entry');
  assert.deepStrictEqual(deleteCalls[0], ['kv', 'namespace', 'delete', '--namespace-id', 'kvid1']);
  assert.strictEqual(resources._records.length, 0, 'tracking left clean, no stray leftover entry');
});

test('a cleanup() call re-entered from inside runWrangler does not double-delete or corrupt tracking', () => {
  // Simulates a buggy/adversarial session or test mock that calls
  // cleanup() again while a delete call from an earlier cleanup() is still
  // in flight — not something real wrangler would ever do, but exactly the
  // "caller mutated our tracking mid-run" class this module defends
  // against. Provenance removal happens *before* the delete call is made,
  // so the nested cleanup() can never see a record the outer call already
  // committed to deleting.
  const calls = [];
  let reentered = false;
  let resources;

  const runWrangler = (args) => {
    calls.push(args);
    if (args[2] === 'create') {
      const label = args[3].split('-').pop();
      return { code: 0, stdout: `id = "id-${label}"`, stderr: '' };
    }
    if (args[2] === 'delete' && !reentered) {
      reentered = true;
      resources.cleanup({ dryRun: false }); // re-entrant, mid-delete
    }
    return { code: 0, stdout: '', stderr: '' };
  };

  resources = createE2eResources({ runWrangler, runId: 'run1' });
  const idA = resources.createKvNamespace('a');
  const idB = resources.createKvNamespace('b');

  resources.cleanup({ dryRun: false });

  const deleteArgv = calls.filter((a) => a[2] === 'delete').map((a) => a.join(' '));
  const deleteA = `kv namespace delete --namespace-id ${idA}`;
  const deleteB = `kv namespace delete --namespace-id ${idB}`;

  assert.strictEqual(deleteArgv.filter((s) => s === deleteA).length, 1, 'A deleted exactly once');
  assert.strictEqual(deleteArgv.filter((s) => s === deleteB).length, 1, 'B deleted exactly once');
  assert.strictEqual(resources._records.length, 0, 'tracking left clean, no stray entries');
});

test('a failed delete restores tracking so a retry can find the record again', () => {
  const { runWrangler, calls } = fakeRunWrangler([
    { code: 0, stdout: 'id = "kvid1"', stderr: '' },        // create
    { code: 1, stdout: '', stderr: 'first attempt fails' }, // delete attempt 1: fails
    { code: 0, stdout: '', stderr: '' },                     // delete attempt 2 (retry): succeeds
  ]);
  const resources = createE2eResources({ runWrangler, runId: 'run1' });
  resources.createKvNamespace('inbox');

  assert.throws(() => resources.cleanup({ dryRun: false }), /first attempt fails/);
  assert.strictEqual(resources._records.length, 1, 'record restored for a retry, not lost');

  resources.cleanup({ dryRun: false }); // retry succeeds

  assert.strictEqual(resources._records.length, 0);
  assert.strictEqual(calls.length, 3);
});

test('a runWrangler that throws instead of returning still leaves the record tracked and retryable', () => {
  const calls = [];
  let shouldThrow = true;
  const runWrangler = (args) => {
    calls.push(args);
    if (args[2] === 'create') return { code: 0, stdout: 'id = "kvid1"', stderr: '' };
    if (args[2] === 'delete' && shouldThrow) throw new Error('spawn ENOENT');
    return { code: 0, stdout: '', stderr: '' };
  };
  const resources = createE2eResources({ runWrangler, runId: 'run1' });
  resources.createKvNamespace('inbox');

  assert.throws(() => resources.cleanup({ dryRun: false }), /spawn ENOENT/);
  assert.strictEqual(resources._records.length, 1, 'record restored for a retry, not leaked');
  assert.strictEqual(resources._records[0].id, 'kvid1');

  // A retry finds it and can succeed once the runner stops throwing —
  // it must not have been silently forgotten as "already handled."
  shouldThrow = false;
  resources.cleanup({ dryRun: false });
  assert.strictEqual(resources._records.length, 0);
  assert.strictEqual(calls.filter((a) => a[2] === 'delete').length, 2, 'first attempt (threw) + retry (succeeded)');
});

test('a resource created during cleanup, followed by a failed delete, retries in true reverse creation order', () => {
  let createdD = false;
  let resources;
  const runWrangler = (args) => {
    if (args[2] === 'create') {
      const label = args[3].split('-').pop();
      return { code: 0, stdout: `id = "id-${label}"`, stderr: '' };
    }
    if (args[2] === 'delete') {
      const id = args[4];
      if (id === 'id-b' && !createdD) {
        createdD = true;
        resources.createKvNamespace('d'); // a resource created mid-cleanup, as a side effect
        return { code: 0, stdout: '', stderr: '' }; // b's own delete still succeeds
      }
      if (id === 'id-a') return { code: 1, stdout: '', stderr: 'a delete fails' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };

  resources = createE2eResources({ runWrangler, runId: 'run1' });
  resources.createKvNamespace('a');
  resources.createKvNamespace('b');

  assert.throws(() => resources.cleanup({ dryRun: false }), /a delete fails/);

  // b succeeded (gone); a failed (restored); d was created mid-run. True
  // reverse-creation order among the survivors (a created 1st, d created
  // 3rd) deletes the newer one, d, before the older one, a.
  const retryOrder = resources.cleanup({ dryRun: true }).map((r) => r.id);
  assert.deepStrictEqual(retryOrder, ['id-d', 'id-a']);
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
  assert.ok(Object.isFrozen(resources._records[0]));
});

test('createKvNamespace throws when wrangler exits non-zero', () => {
  const { runWrangler } = fakeRunWrangler([
    { code: 1, stdout: '', stderr: 'boom' },
  ]);
  const resources = createE2eResources({ runWrangler, runId: 'run1' });
  assert.throws(() => resources.createKvNamespace('inbox'), /boom/);
});

test('createKvNamespace throws when wrangler exits zero but prints no parseable id', () => {
  const { runWrangler } = fakeRunWrangler([
    { code: 0, stdout: 'created!', stderr: '' },
  ]);
  const resources = createE2eResources({ runWrangler, runId: 'run1' });
  assert.throws(() => resources.createKvNamespace('inbox'), /Could not create KV namespace/);
});

test('createPagesProject throws when wrangler exits non-zero', () => {
  const { runWrangler } = fakeRunWrangler([
    { code: 1, stdout: '', stderr: 'nope' },
  ]);
  const resources = createE2eResources({ runWrangler, runId: 'run1' });
  assert.throws(() => resources.createPagesProject('site'), /nope/);
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

test('createE2eResources requires a runId', () => {
  const { runWrangler } = fakeRunWrangler([]);
  assert.throws(() => createE2eResources({ runWrangler }), /runId/);
});

test('createE2eResources requires a runWrangler function', () => {
  assert.throws(() => createE2eResources({ runId: 'run1' }), /runWrangler/);
});

test('createE2eResources exposes exactly the intended surface — no list or delete-by-title API', () => {
  const { runWrangler } = fakeRunWrangler([]);
  const resources = createE2eResources({ runWrangler, runId: 'run1' });
  assert.deepStrictEqual(
    Object.keys(resources).sort(),
    ['_records', 'cleanup', 'createKvNamespace', 'createPagesProject'].sort()
  );
});
