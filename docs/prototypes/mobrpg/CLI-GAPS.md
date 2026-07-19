# mobRPG CLI — gaps to add or fix

Running list of CLI shortfalls the `mobrpg-sync` skill needs closed. **The goal
is to bring the CLI up to what the skill requires — not to degrade the skill to
match a limited CLI.** The skill is authored to its intended target behavior;
each item below is where the CLI currently falls short of that target, so it can
be fixed rather than worked around.

Discovered during the mobrpg-sync skill build (Plan 1, branch `mobrpg-cli`).

## Open

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

### G1 — `pull-canon`: 3 of 5 authority-rule outcomes are unreachable ✅
**Resolved 2026-07-19.** `apply_state()` already implemented all five outcomes;
the gap was entirely in `_fetch_live()`, which only queried Accepted+Dismissed
and always set `determined: {}`.

Correction to the original fix sketch: the suggestion review-state enum is only
`Pending | Accepted | Dismissed` — **there is no `Deleted` review state**. So
`deleted` and `edited` cannot come from a query; they are detected by verifying
the ratified element.

Fix landed:
- `_fetch_live(world, token, *, verify=True)` now also queries **Pending**
  (emits `state:"pending"` — an `apply_state` no-op, for coverage/reporting).
- For each Accepted row with a `resultElementId`, a verification GET on the
  element (via `suggestions.TYPE_EP`): a **404 → `state:"deleted"`**; a live
  element → `determined` rebuilt by the new `determined_from_element()` helper,
  so the **edited/drift** branch fires when canon differs from the vault.
  Non-404 errors leave the row plain-accepted (a transient failure is never
  mistaken for a deletion).
- `determined_from_element()` maps live classifiers → vault `determined` keys
  (Attribute relations: `sex`/`race`/`profession`/`politicaltype`→`political_type`/
  `organizationtype`→`organization_type`/`creaturetype`→`creature_type`; plus
  item `attributes.itemType` and landfeature `landFeatureTypes`). Multi-valued
  types collapse to a sorted comma-joined string. Verified against live Regency
  Cthulhu payloads across all element kinds.
- New `mobrpg pull-canon --no-verify` skips the element-fetch pass.
- Coverage: 12 new tests in `test_pull_canon.py` (114 total, was 102).
