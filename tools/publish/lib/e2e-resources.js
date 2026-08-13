// Guarded lifecycle helper for ephemeral E2E test resources (Cloudflare KV
// namespaces, Pages projects). Built after issue #142: a session-driven
// cleanup sweep ran ad-hoc wrangler commands and deleted the *production*
// INBOX KV namespace. This module makes that incident inexpressible:
//
//   - every resource this module creates is named `e2e-<runId>-<label>`;
//     there is no way to construct a bare production-shaped name (e.g.
//     "INBOX") through the factory.
//   - cleanup() only ever deletes ids it recorded itself, in reverse
//     creation order — there is no list-and-delete or delete-by-title API.
//   - cleanup() independently refuses (throws) to delete any recorded
//     resource whose name lacks the `e2e-` prefix, even if the tracked
//     records were somehow polluted. This is a second, unconditional guard
//     on top of the naming scheme, not a substitute for it.
//
// `runWrangler` is always injected — see tools/publish/lib/setup-backend.js
// for the same pattern. Real wrangler must never run from a test.

const { parseCreatedId } = require('./setup-backend');

function trackedName(runId, label) {
  return `e2e-${runId}-${label}`;
}

function assertPrefixed(name) {
  if (typeof name !== 'string' || !name.startsWith('e2e-')) {
    throw new Error(
      `Refusing to delete "${name}": recorded resource name does not carry the e2e- prefix. ` +
        'This guard exists so a polluted tracking record can never reach a real delete call.'
    );
  }
}

function createE2eResources({ runWrangler, runId }) {
  if (!runId) throw new Error('createE2eResources requires a runId');

  // Creation-ordered list of resources this instance has created. Exposed
  // (as `_records`) only so tests can exercise the second delete guard by
  // hand-injecting a malformed record; production code should never write
  // to it directly — createKvNamespace/createPagesProject are the only
  // supported way to add a tracked resource.
  const _records = [];

  function createKvNamespace(label) {
    const name = trackedName(runId, label);
    const r = runWrangler(['kv', 'namespace', 'create', name]);
    const id = parseCreatedId(r.stdout);
    if (r.code !== 0 || !id) {
      throw new Error(`Could not create KV namespace "${name}": ${(r.stderr || r.stdout || '').trim()}`);
    }
    _records.push({ type: 'kv', name, id });
    return id;
  }

  function createPagesProject(label) {
    const name = trackedName(runId, label);
    const r = runWrangler(['pages', 'project', 'create', name, '--production-branch=main']);
    if (r.code !== 0) {
      throw new Error(`Could not create Pages project "${name}": ${(r.stderr || r.stdout || '').trim()}`);
    }
    // Pages projects are addressed by name, not a separate id; wrangler's
    // create output doesn't reliably print one. Reuse parseCreatedId in
    // case a future version does, and fall back to the name otherwise.
    const id = parseCreatedId(r.stdout) || name;
    _records.push({ type: 'pages', name, id });
    return id;
  }

  function cleanup({ dryRun = false } = {}) {
    const toDelete = _records.slice().reverse();

    // Guard: refuse the whole cleanup if any recorded name lacks the
    // e2e- prefix — checked before anything is deleted, dry-run or not.
    toDelete.forEach((record) => assertPrefixed(record.name));

    if (dryRun) return toDelete;

    for (const record of toDelete) {
      const r =
        record.type === 'kv'
          ? runWrangler(['kv', 'namespace', 'delete', '--namespace-id', record.id])
          : runWrangler(['pages', 'project', 'delete', record.name]);
      if (r.code !== 0) {
        throw new Error(`Could not delete ${record.type} "${record.name}": ${(r.stderr || r.stdout || '').trim()}`);
      }
      _records.splice(_records.indexOf(record), 1);
    }
    return toDelete;
  }

  return { createKvNamespace, createPagesProject, cleanup, _records };
}

module.exports = { createE2eResources };
