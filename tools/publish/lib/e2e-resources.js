// Guarded lifecycle helper for ephemeral E2E test resources (Cloudflare KV
// namespaces, Pages projects). Built after issue #142: a session-driven
// cleanup sweep ran ad-hoc wrangler commands and deleted the *production*
// INBOX KV namespace.
//
// What this module actually guarantees:
//
//   - every resource this module creates is named `e2e-<runId>-<label>`;
//     there is no way to construct a bare production-shaped name (e.g.
//     "INBOX") through the factory.
//   - cleanup() only ever considers resources it tracked itself, and for
//     each one independently checks (a) the recorded name carries the
//     `e2e-` prefix, and (b) the record is the *same object* this instance
//     minted via createKvNamespace/createPagesProject — an internal Set
//     checks identity, not just field content. A record hand-pushed onto
//     `_records` with a spoofed `e2e-`-looking name and a real (e.g.
//     production) id is still refused, because it was never minted here.
//   - there is no list-and-delete or delete-by-title API: the only inputs
//     to a deletion are records this instance itself created.
//   - every tracked record is frozen at the moment it's created, so neither
//     `_records` (kept exposed for inspection) nor cleanup()'s return value
//     can be mutated afterwards to redirect a later delete at a different
//     id — a dry-run report can't be tampered with and then fed back in to
//     change what a real cleanup deletes.
//
// `_records` stays a live, writable array (rather than a defensive copy)
// specifically so callers — including this module's own tests — can
// exercise the identity guard above by pushing a foreign record onto it.
// It is the guard, not read-only-ness, that makes this safe: appending to
// the array cannot bypass the checks above, and the frozen record objects
// already in it cannot be edited in place.
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
      `Refusing to delete "${name}": recorded resource name does not carry the e2e- prefix.`
    );
  }
}

function createE2eResources({ runWrangler, runId }) {
  if (!runId) throw new Error('createE2eResources requires a runId');
  if (typeof runWrangler !== 'function') throw new Error('createE2eResources requires a runWrangler function');

  // Creation-ordered list of resources this instance has created. See the
  // header comment for why this stays live/writable rather than a copy.
  const _records = [];

  // Identity provenance: only record objects that came out of `track()`
  // (i.e. were actually returned by createKvNamespace/createPagesProject)
  // are ever valid deletion targets — regardless of what a record pushed
  // directly onto `_records` claims about its own `name`/`id` fields.
  const minted = new Set();

  function track(record) {
    Object.freeze(record);
    _records.push(record);
    minted.add(record);
    return record;
  }

  function createKvNamespace(label) {
    const name = trackedName(runId, label);
    const r = runWrangler(['kv', 'namespace', 'create', name]);
    const id = parseCreatedId(r.stdout);
    if (r.code !== 0 || !id) {
      throw new Error(`Could not create KV namespace "${name}": ${(r.stderr || r.stdout || '').trim()}`);
    }
    return track({ type: 'kv', name, id }).id;
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
    return track({ type: 'pages', name, id }).id;
  }

  function cleanup({ dryRun = false } = {}) {
    const toDelete = _records.slice().reverse();

    // Validate every record before deleting anything, dry-run or not: a
    // single polluted/foreign record aborts the whole cleanup rather than
    // being silently skipped or, worse, silently deleted.
    toDelete.forEach((record) => {
      assertPrefixed(record.name);
      if (!minted.has(record)) {
        throw new Error(
          `Refusing to delete "${record.name}": this record was not created by this ` +
            'createE2eResources instance (tracking looks polluted).'
        );
      }
    });

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
      minted.delete(record);
    }
    return toDelete;
  }

  return { createKvNamespace, createPagesProject, cleanup, _records };
}

module.exports = { createE2eResources };
