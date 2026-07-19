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

There is no `--crosswalk` flag on `pull-canon` — that flag belongs to
`backfill` (see `backfill.md`) for the one-time sidecar migration. Don't
reach for it here.

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

## Description content — NOT YET (Plan 2)

`pull-canon` reconciles the machine `mobrpg:` node; it does not merge the
note's *description* prose. When a description differs between the vault and
mobRPG, say so plainly and leave the prose to the GM for now. Automated
three-way description merge (merge / take-canon / keep-vault /
maintain-separately) arrives in Plan 2 — do not hand-improvise it here,
because without the recorded canon base you cannot tell which side changed,
and a guess can clobber authored prose.

*Why:* honest degradation — the skill states the boundary instead of faking a
risky merge.
