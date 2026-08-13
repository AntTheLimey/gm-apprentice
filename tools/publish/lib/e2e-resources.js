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
//   - a record is removed from tracking *before* its delete call is issued,
//     so a duplicate entry in `_records`, or a cleanup() re-entered from
//     inside `runWrangler` (e.g. an adversarial test mock), can never see
//     the same record as still deletable and delete it twice. A failed
//     delete restores the record so a retry can still find it.
//
// None of this can protect against a `runWrangler` that lies about what it
// created — provenance here means "this instance's own create call returned
// this id," not "this id is actually safe." The guarantee is only as good
// as the injected runner; it's real wrangler in production and a mock that
// must never touch the network in tests.
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
      // Already handled earlier in this same pass — either a duplicate
      // entry in `_records`, or a cleanup() re-entered from inside an
      // earlier iteration's `runWrangler` call already deleted it (see
      // the pre-call removal below).
      if (!minted.has(record)) continue;

      // Remove from tracking *before* issuing the delete call, not after,
      // so a re-entrant cleanup() triggered synchronously from inside this
      // very `runWrangler` call can never see this record as still valid
      // and attempt to delete it again. Use a while-loop over indexOf
      // (rather than a single splice) so a missing/duplicated entry can
      // never splice the wrong element.
      minted.delete(record);
      let idx;
      while ((idx = _records.indexOf(record)) !== -1) _records.splice(idx, 1);

      const r =
        record.type === 'kv'
          ? runWrangler(['kv', 'namespace', 'delete', '--namespace-id', record.id])
          : runWrangler(['pages', 'project', 'delete', record.name]);

      if (r.code !== 0) {
        // Deletion failed — restore tracking so a retry can find it again.
        minted.add(record);
        _records.push(record);
        throw new Error(`Could not delete ${record.type} "${record.name}": ${(r.stderr || r.stdout || '').trim()}`);
      }
    }
    return toDelete;
  }

  return { createKvNamespace, createPagesProject, cleanup, _records };
}

module.exports = { createE2eResources };
