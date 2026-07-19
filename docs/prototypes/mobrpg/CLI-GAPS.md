# mobRPG CLI — gaps to add or fix

Running list of CLI shortfalls the `mobrpg-sync` skill needs closed. **The goal
is to bring the CLI up to what the skill requires — not to degrade the skill to
match a limited CLI.** The skill is authored to its intended target behavior;
each item below is where the CLI currently falls short of that target, so it can
be fixed rather than worked around.

Discovered during the mobrpg-sync skill build (Plan 1, branch `mobrpg-cli`).

## Open

### G1 — `pull-canon`: 3 of 5 authority-rule outcomes are unreachable
**Severity:** high (this is the core reconcile value the skill promises).
`apply_state()` (`mobrpg/commands/pull_canon.py:20-52`) implements all five
outcomes — accepted, **edited** (canon overwrites `determined`), dismissed,
**deleted**, **pending** — but `_fetch_live()` (`pull_canon.py:100-121`) only
queries `reviewState=Accepted` and `reviewState=Dismissed` and hardcodes the
state to `"accepted"`/`"dismissed"`, and it always sets `"determined": {}`.
Net effect today: only `accepted` and `dismissed` ever occur; the `edited`
(canon-overwrites-vault) path can never fire because `live_det` is always the
falsy `{}`, and `deleted`/`pending` are never produced.
**Fix:** extend `_fetch_live()` to also query Deleted and Pending review states,
and to populate `determined` from the ratified canon so the edited/drift branch
can fire. Then the skill's reconcile authority rule delivers all five outcomes
as designed.

### G2 — `map`: `status:"review"` is schema-reserved but never emitted
**Severity:** medium.
The map schema and `_counts()` recognize a `review` route status (a route that
needs a human type decision), but `_route_location()`
(`mobrpg/commands/map_cmd.py`, "Ant's rule" docstring ~139-144) resolves every
ambiguous location by fiat so nothing is ever parked in `review`. The skill's
mapping-maintenance phase is written to run a human-in-the-loop review-route
resolution loop — which currently has no input to act on.
**Fix:** have location routing (and classifier routing) flag genuinely
ambiguous vocab as `status:"review"` instead of auto-resolving, so the GM gets
the deliberate type decision the skill offers. Until then the skill documents
the loop as the intended workflow and notes it is dormant pending this fix.

### G3 — no verb re-points a moved/renamed note's `external_ref`
**Severity:** medium.
The `mobrpg:` node's `external_ref` records the vault-relative path. When a note
is renamed or moved, its `external_ref` no longer matches its path; re-pushing it
would create a duplicate element and orphan the old link (the name-collision
hazard the foundation audit flagged). No `mobrpg` verb re-points the ref while
preserving the `element_id` — grep of `pull_canon`/`suggest`/`backfill` finds
none. The skill's mapping-maintenance rename/move guard therefore has to
instruct a **manual** edit of the `mobrpg:` block in the note's frontmatter.
**Fix:** add a verb (e.g. `mobrpg relink --from <old> --to <new>`, or a flag on
an existing verb) that rewrites `external_ref` to the current path, keeps the
`element_id`, and records the old path — dry-run→confirm→execute like the other
mutations — so the guard is a one-command safe operation instead of a hand-edit.

## Resolved
_(none yet)_
