# Reconcile — mobRPG canon → vault

Entered when suggestions have gone out and are awaiting pull-back:

```
.venv/bin/mobrpg suggestions <world> --state Accepted --correlate --vault <path>
```

shows accepted review states not yet reflected in the vault's `mobrpg:`
nodes. `--state` takes one value per run — bare `mobrpg suggestions <world>`
defaults to `--state Pending`, which is not what this phase is about, so
accepted and dismissed are two separate queries (swap `--state Dismissed` for
the second). The phase's per-entity outcomes below are built from both lists
together. `--correlate --vault <path>` is what joins each suggestion back to
its originating vault note. Every write here is a
`.venv/bin/mobrpg pull-canon ...` invocation — never `python -m mobrpg`.

## Node authority rule (via `pull-canon`)

mobRPG is canon; the vault is the working surface. Run

```
.venv/bin/mobrpg pull-canon --vault <path> <world>
```

**dry-run first** (no `--execute` — this is the default; the CLI prints
`pull-canon: N node(s) updated` plus `[dry-run — no files changed]`). Present
the per-entity outcomes to the GM before writing anything:

- **accepted** → fill `element_id` (`review_state: "accepted"`).
- **edited** (accepted-with-drift) → canon overwrites the vault's
  `determined` classifiers (`review_state: "edited"`).
- **dismissed** → record the `review_note`, preserve the vault copy as-is.
- **deleted** → flag it (`review_state: "deleted"`, `element_id` cleared).
- **pending** → leave the vault alone; nothing to reconcile yet.

Get an explicit yes on the presented outcomes, then re-run the same command
with `--execute` to write.

All five outcomes are live. To surface **edited** (drift) and **deleted**,
`pull-canon` verifies each accepted suggestion's ratified element: a live
element supplies the canon `determined` (so drift is detected against the
vault's), and a deleted one (element GET 404) flags the node. That verification
pass is on by default; `--no-verify` skips it (faster/offline, but only
accepted/dismissed will then surface). **pending** is queried too but is a
no-op on the vault — it just means "still under review, nothing to reconcile."

There is no `--crosswalk` flag anywhere — sidecar crosswalks are retired and
untrusted. `pull-canon` reconciles against each note's `mobrpg:` node, the
single source of truth.

**Sequencing (from the foundation audit):** always run `pull-canon` after any
re-`suggest`, so relationship `event_id`s heal and no duplicate-suggestion
window stays open. If a push report flagged a `pending`-state node before
re-suggesting, this is the follow-up that closes it out.

## Executing

Only after the GM has read the presented outcomes and given an explicit yes:

```
.venv/bin/mobrpg pull-canon --vault <path> --execute <world>
```

`pull-canon --execute` writes local vault files only — it never calls the
mobRPG API, so the PROD write guard (`MOBRPG_ALLOW_PROD_WRITES=1`) does not
gate it. It is still a vault mutation, though, so it follows the same
dry-run → present → confirm → `--execute` sequence as every other mutating
verb in this skill. Don't skip the confirm step just because the guard
doesn't apply.

## Description content — reconcile via `pull-desc`

`pull-canon` reconciles the machine `mobrpg:` node; it does **not** merge the
note's *description* prose. That is `pull-desc`'s job. Run it after `pull-canon`.

**You are the interactive UI.** `pull-desc` gives you two primitives — a
read-only report and a one-entity apply — and you walk the GM through each
conflict one at a time. Never batch a resolution the GM hasn't seen.

**Step 1 — report (read-only):**

```
.venv/bin/mobrpg pull-desc <world> --vault <path>
```

This classifies every synced note and prints, per changed entity, a
`base → vault` and `base → mobRPG` diff. States:

- **in-sync** → nothing to do (not printed).
- **canon-only** → only mobRPG changed. Safe to `take-canon`.
- **vault-only** → only the vault changed. Nothing to pull; it's push territory
  (the vault is ahead — re-`suggest` if you want mobRPG updated).
- **conflict** → both sides changed. Ask the GM (Step 2).
- **unbaselined** → synced before a base was recorded. Offer `baseline` to
  capture the current state as the reference point (treats the vault as the
  source of truth; the GM can immediately `take-canon` to flip it).
- **deleted** → mobRPG deleted the element. Report it; do not merge.

**Step 2 — present each conflict and ask, one at a time.** For each conflicted
entity, show the GM the two diffs and ask the four-way question:

> *<name>*'s description changed on both sides. Your vault says [X]; mobRPG says
> [Y]. **Merge** them, take **mobRPG's**, keep **yours**, or keep them
> **separate** on purpose?

Then apply their answer to that one entity — dry-run first, show the result,
get an explicit yes, then `--execute`:

```
.venv/bin/mobrpg pull-desc <world> --vault <path> --resolve <mode> --only <ref>
.venv/bin/mobrpg pull-desc <world> --vault <path> --resolve <mode> --only <ref> --execute
```

`<mode>` is `take-canon` | `keep-vault` | `merge` | `separate` | `baseline`;
`<ref>` is the note's `external_ref`. Then move to the next entity.

- **merge** does a three-way merge. Non-overlapping edits combine automatically;
  a genuine overlap is written back with `<<<<<<< vault` / `>>>>>>> mobRPG`
  conflict markers and the command says so — the note sits unresolved until the
  GM cleans the markers, then re-run (a clean `merge`, or `keep-vault` once it
  reads right, re-baselines it).
- **separate** stops reconciling that entity's description entirely, until the
  GM clears the `description_policy`.

Every `pull-desc --execute` writes local vault files only — it never calls a
mobRPG write endpoint, so the PROD write guard (`MOBRPG_ALLOW_PROD_WRITES=1`)
does not gate it. It is still a vault mutation: same dry-run → present → confirm
→ `--execute` sequence, per entity.

*Why it's safe:* change detection compares mobRPG's raw HTML to its recorded
hash and the vault prose to a frozen base — never a lossy converter round-trip —
so an untouched entity never falsely reads as changed, and authored prose is
never clobbered by a guess.
