# Push — vault entities → mobRPG suggestions

Entered once the map is clean (see `mapping-maintenance.md`) and a dry-run
`suggest --write-back` shows entities ready to go. Every write here is a
`mobrpg suggest ...` invocation (the installed CLI verb).

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
| `suggest --write-back --out <dir>` | Full dry-run. Writes `suggest-batch-N.json` into `<dir>`, computes the write-back and prints `write-back: N node(s) would be written, M unchanged (skipped)  [dry-run — no files changed]` — but touches nothing. |
| `suggest --write-back --out <dir> --execute` | Submits the batches to the API **and**, per batch, once the POST has succeeded, writes pending `mobrpg:` nodes for the creates the server stored (preserving any already-ratified `element_id` — see below). A batch that fails stamps nothing; an externalRef the server refused as already claimed is not stamped either. |
| `suggest --out <dir> --execute` (no `--write-back`) | Submits the batches. No vault file is touched. |

Before building batches, `suggest` checks the live world for net-new entities
that already exist upstream without a `mobrpg:` node (matched by name within
their element kind, as `adopt` does). Those are **held**, listed under
`[held] … already exist upstream`, and not filed: the server would skip the
create as already claimed and every edge referencing it would fail the whole
batch with a bare HTTP 400. Run `mobrpg adopt <world> --vault <path> --execute`
to link them, then re-run `suggest`.

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
- **Unresolved `status:"review"` routes still in the map.** If `map check`
  reports any `review > 0`, send the GM back to mapping maintenance first —
  building suggestions against an undecided type mapping bakes the guess in.
  For classifiers this is also enforced downstream (an unresolved review is
  dropped rather than minted, so no near-duplicate type is created), but resolve
  it first so the entity actually gets its intended classifier rather than none.
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

```bash
mobrpg suggest --vault <path> --write-back --out <dir> --execute <world>
```

(Drop `--write-back` if the GM only wants the API submission this pass, per
the flag table above.)

If the target is **PROD**, a `--execute` submits straight to Tim's live shared
world — there is no extra env-var opt-in gating it. The client prints a loud
`⚠️ THIS IS PRODUCTION` banner to stderr on every run; heed it. Tell the GM the
target is PROD and get their explicit yes before running a PROD `--execute`, or
switch to `MOBRPG_ENV=dev` for a non-prod run. Dry-runs (Step 1–2 above) never
write, so they're safe against either target.

**Reading the execute output.** Each submitted batch prints
`N stored, N corrected in place, N already claimed (NOT submitted)` — the
per-batch source of truth, not the pre-submit report above. *Stored* are
newly-filed rows; *corrected in place* are the caller's own still-Pending rows
whose payload the resubmit just replaced (expected on a re-push of the same
entity); *already claimed* means the externalRef was already resolved by a
terminal Accepted/Dismissed suggestion, so that proposal was **not** stored
and the GM will never see it in their queue — the CLI lists the claimed
externalRefs so you can tell the GM which entities silently didn't go through
and need a fresh push (a re-`suggest`/`sync` after `pull-canon` mints a new
ref, see `reconcile.md`).

## Relationships: two mechanisms, and target resolution

`suggest` maps each vault relationship to one of mobRPG's **two** relationship
mechanisms:

- a reified **Event** (eventType Membership/Leadership/Employ/Reign/War/Generic)
  — for social/narrative predicates (`member_of`, `leads`, `owns`, …), or
- a direct **WorldElementRelation** (Attribute/Link/Parent/Child/Spouse) — for
  *structural* predicates. Spatial containment is **Link**, not Parent:
  Parent/Child/Spouse are genealogy between people and the backend auto-creates
  the reciprocal row. `part_of`/`located_at`/`headquartered_at` emit one
  container-first `AddRelation` Link and no reified Event.

### Person ↔ group affiliations follow mobRPG's own grid

mobRPG never asks which event type you want. Its GUI hangs relation tabs off an
element and derives the type from which tab you were on — Reign/Employ on a
Political, Leadership/Membership on an Organization — so the same vault
predicate means different things depending on **what it points at**:

| | target is a **Political** | target is an **Organization** |
|---|---|---|
| the person runs it (`leads`, `owns`, `rules`, `commands`, `employs`) | `Reign` | `Leadership` |
| the person belongs to it (`serves`, `member_of`, `founded`, `vassal_of`) | `Employ` | `Membership` |

`suggest` resolves each affiliation through that grid using what the endpoints
actually are (canon `element_kind` for a linked note, the proposed kind for a
net-new one), and names the event the way mobRPG does — the **person always
leads**: `"{Person}, Member of {Org}"`, `"{Person}, Employment at {Political}"`.
A vault edge authored group-first (`Corvid Financial employs Marek Solano`) is
still named person-first. A **title** (Boss, Marshal, Underling) is the
reviewer's to pick from the target's title vocabulary — the push deliberately
doesn't guess one, since the vault's `occupation` already goes up as a
Profession classifier.

Two things the report will tell you, and both are worth reading:

- **`Membership -> Employ` style regrades.** The grid disagreed with the flat
  predicate mapping. Usually that is the fix, but it can also mean the *target*
  is the wrong entity: `Alphonse member_of Station 45` regrades to Employ
  because Station 45 is authored as a location, and mobRPG has no "member of a
  Political". If the gang deserves its own faction note, that's the real fix.
- **`… is not a person/group pair`.** The predicate map produced an affiliation
  type for endpoints mobRPG's GUI could not pair — `Beam Pistol owns Kinetic
  Logistics` is an inverse stored the wrong way round, not a Reign event. It
  still pushes (unchanged behaviour), but fix the vault edge.

An affiliation authored on **both** endpoints is one fact, not two: the
duplicate half is collapsed before submit and reported, because storage is
single-direction by rule (`shared/relationship-normalization.md`).

A per-world `relationshipTypes` entry in `_meta/mobrpg-map.json` overrides the
grid only when it **differs** from the ontology default — `map init`/`map sync`
write an entry for every predicate they discover, and those just restate the
default.

Relationship **targets** resolve from the vault's own `mobrpg:` nodes (each note's
`element_id`) — the single source of truth; there is no crosswalk. If the report
shows a target skipped for want of an id, the target note either has no `mobrpg:`
node yet (link it first — push it, or match it to its live element by name and
stamp the node) or its name doesn't match the `[[link]]`.

## Description content up — `sync`

Pushing entities is separate from reconciling their *authored description prose*.
Once a note is linked, its description prose is kept in step with the mobRPG
element by `mobrpg sync`, not by this push flow. `sync` decides per note from
timestamps (last-writer-wins) — when the vault's prose is newer it files an
`UpdateElement` suggestion **up** for the owner to accept or dismiss; when
mobRPG's is newer it pulls the canon prose down. See `reconcile.md` for the full
decision table (including the `baseline` verdict for a never-synced note) and
the dry-run → present → confirm → `--execute` walk-through. `## GM Notes` and
the other vault-only sections (`## Notes`, `## Appearances`,
`## Source References`, or a vault's own `vaultOnlySections` list) are never
pushed — they stay local to the vault by design. The same list is stripped from
the `CreateElement` descriptions this push flow sends, so a section a vault has
opted out of never reaches the world by either route.

Descriptions push as raw Markdown, not HTML — every non-empty description
`suggest`/`sync` sends carries `descriptionType: "Markdown"`, so mobRPG stores
the authored prose verbatim instead of the CLI's own lossy markdown→HTML
conversion. There are two exceptions, both HTML fragments the CLI builds itself
and both sent with no `descriptionType` (so the backend stores them as Html):
the empty-description stub for an entity with no authored prose at all
(`<p></p>` — see the "Missing/blank description" risk flag above), and the
one-line blurb on a reified relationship Event (`<p>…</p>`, from the edge's
`description:` or its predicate). Neither carries authored vault prose, so
nothing is lost to the conversion.
