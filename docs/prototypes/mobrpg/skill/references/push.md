# Push — vault entities → mobRPG suggestions

Entered once the map is clean (see `mapping-maintenance.md`) and a dry-run
`suggest --write-back` shows entities ready to go. Every write here is a
`.venv/bin/mobrpg suggest ...` invocation — never `python -m mobrpg`.

## Two flags, independent meanings

`suggest` has two off-by-default flags that gate different things. Keep them
straight — conflating them is how a GM ends up surprised about what actually
got written:

- **`--write-back`** — gates whether the CLI computes/attempts a pending
  `mobrpg:` node write-back into the vault **at all**. Without it, vault files
  are never touched, no matter what `--execute` is set to.
- **`--execute`** — the dry-run/live switch (default: dry-run). It gates
  *both* the API submission *and*, only when `--write-back` is also set, the
  actual node file writes.

So in practice:

| Flags | What happens |
|---|---|
| `suggest --write-back --out <dir>` | Full dry-run. Writes `suggest-batch-N.json` into `<dir>`, computes the write-back and prints `write-back: N node(s) written, M unchanged (skipped)  [dry-run — no files changed]` — but touches nothing. |
| `suggest --write-back --out <dir> --execute` | Submits the batches to the API **and** writes pending `mobrpg:` nodes into the vault (preserving any already-ratified `element_id` — see below). |
| `suggest --out <dir> --execute` (no `--write-back`) | Submits the batches. No vault file is touched. |

`--out` defaults to `./push_out` if omitted. `suggest-batch-N.json` files are
written unconditionally on every run, dry-run or not — they're the batch
payloads, chunked at exactly ≤100 items per batch.

## Flow

1. **Dry-run the batch:**
   `mobrpg suggest --vault <path> --write-back --out <dir> [--chapter CH] [--kind K] [--only ONLY] <world>`
   (no `--execute`). This emits `suggest-batch-N.json` and computes — but does
   not write — the node write-back.
2. **Build and show the submission report** (below). This is the confirm gate
   — nothing gets pushed until the GM has read it and said yes.
3. **On an explicit yes, re-run with `--execute`** (and keep `--write-back` if
   the GM wants nodes written this pass — see the flag table above). Surface
   the prod-write guard first if the target is PROD (see Executing, below).

## Submission report — `<dir>/suggestion-report.md`

Build a GM-readable manifest from the dry-run's console output plus the
`suggest-batch-N.json` files it wrote. **Do not dump raw JSON at the GM.**
Save the report to `<dir>/suggestion-report.md` — it's the durable per-push
record — **and** show it inline in the same turn.

**Per entity, report:**
- name → element kind (`political`, `landfeature`, `person`, `organization`,
  `creature`, `item`, …),
- **new vs. already-linked** — read the entity's current `mobrpg:` node (before
  this run touches it). If it already carries an `element_id`, this push is an
  update against a ratified element: the server dedupes on `externalRef`, so no
  new element is created. If there's no `element_id` yet, this is a net-new
  element create,
- determined classifiers (profession, race, sex, organization/creature/political
  type — whichever apply) and aliases,
- reified relationships as `predicate → target (event type)`,
- the entity's `externalRef`.

Pull the node-level facts (kind, `external_ref`, determined classifiers,
relationships) from the write-back computation; cross-reference the
`suggest-batch-N.json` items (classifier `Type` creates, `Attribute` edges,
`Event` creates + `Link` edges) to get exact counts and to catch anything the
write-back summary doesn't surface on its own.

**Totals:** N new / N already-linked / N classifier-Type creates / N Attribute
edges / N relationships, across M batches.

**Risk flags — call these out loudly, don't bury them in the per-entity list:**

- **Missing/blank description.** mobRPG requires a non-null `description` on
  every element create — the `elements` table has a hard `NOT NULL` constraint,
  and a create that omits it raises `HTTP 500` (`null value in column
  "description"`). `suggest`'s own batch builder already defends the literal-null
  case: every item it emits (element, classifier Type, or reified-relationship
  Event) substitutes an empty `<p></p>` stub — or `<p>{predicate}</p>` for
  relationship events — when the vault entity has no description, so a plain
  `suggest --execute` push won't itself 500 on this. `submit-batch`, though,
  submits whatever payload it's handed verbatim with no such default, so a
  hand-edited or externally-authored batch JSON can still 500 on a blank field.
  Either way, name the offending entities: it's either a live 500 risk (batch
  didn't go through `suggest`'s builder) or a silent blank stub landing in
  mobRPG (via `suggest`'s own `<p></p>` default) — neither is a push to wave
  through blind. Tell the GM which entities have no real description and let
  them add one before pushing, rather than accept the placeholder.
- **Unresolved `status:"review"` routes still in the map.** If the map has any
  entry parked at `review`, send the GM back to mapping maintenance first —
  building suggestions against an undecided type mapping bakes the guess in.
  > **Current CLI status:** `map check` never actually reports `review > 0`
  > today — location and classifier routing resolve every ambiguous term
  > automatically instead of parking it (tracked as **G2** in
  > `docs/prototypes/mobrpg/CLI-GAPS.md`). This flag is still correct target
  > behavior: once G2 is fixed and review routes can exist, this is what stops
  > a push from running against an unresolved mapping decision. Until then it
  > naturally never fires, since `review` is always `0`.
- **Pending-window re-suggest.** If an entity's existing `mobrpg:` node has
  `review_state: "pending"`, its prior suggestion hasn't been accepted or
  dismissed yet. Re-pushing it now risks creating a duplicate suggestion on
  the mobRPG side. Recommend running `pull-canon` to reconcile first (see
  `reconcile.md`) rather than pushing over an open window.
- **Synthetic refs on relationship events (informational).** Reified-relationship
  events get a synthetic `externalRef` —
  `<namespace>:rel/<entity-path>/<predicate>/<target>` — that doesn't
  correspond to any actual vault file. Flag these on the report so the GM
  isn't surprised later if a pull-canon reconcile treats one as an orphan ref
  and offers to scaffold a stub note for it. Not a blocker, just a heads-up.

## Executing

Only after the GM has read the report and given an explicit yes:

```
.venv/bin/mobrpg suggest --vault <path> --write-back --out <dir> --execute <world>
```

(Drop `--write-back` if the GM only wants the API submission this pass, per
the flag table above.)

If the target is **PROD**, the CLI raises exit code 3 on `--execute` unless
`MOBRPG_ALLOW_PROD_WRITES=1` is set — this is a deliberate guard, not a bug.
**Never set it yourself.** Tell the GM the target is PROD, explain the opt-in,
and let them either set `MOBRPG_ALLOW_PROD_WRITES=1` themselves or switch to
`MOBRPG_ENV=dev` for a non-prod run. Dry-runs never hit this guard, so nothing
in Step 1–2 above needs it.
