# mobRPG CLI — gaps to add or fix

Running list of CLI shortfalls the `mobrpg-sync` skill needs closed. **The goal
is to bring the CLI up to what the skill requires — not to degrade the skill to
match a limited CLI.** The skill is authored to its intended target behavior;
each item below is where the CLI currently falls short of that target, so it can
be fixed rather than worked around.

Discovered during the mobrpg-sync skill build (Plan 1, branch `mobrpg-cli`).

## Open

### G4 — `pull` is entity-only; it never traverses classifier `/type` endpoints
**Found 2026-07-19** during a live pull of the Space world
(`a254e424-…`). `pull.py` walks only entity kinds (`KINDS` = person /
organization / political / landfeature / item / creature / culture / race /
event) and does **not** GET the classifier endpoints
(`creature/type`, `organization/type`, `political/type`, …). So a "what's new
in mobRPG" report built from a `pull` extract **silently drops every classifier
type** — e.g. two genuinely new creature types (Thideian Furry Lamprey,
Thideian Chitinoteuthis) were missing from the entity diff until queried
directly. New-content discovery must cover **entities + edits + classifier
types**, not just entities.

**`map init` does NOT rescue this** (verified live 2026-07-19). `map_cmd.discover()`
*does* GET `creature/type`, but the proposed map is built by iterating over
**vault vocab** (`for v in vocab["creature_type"]`), and with zero creature
entities/vocab the discovered types are discarded — the two creature types
appear **nowhere** in the emitted map file, not even `_discoveredVocab`
(`creatureType total=0`). So the underlying gap is: **a mobRPG classifier type
that no vault content references is silently dropped by every current verb.**
Only a direct `GET /world/{world}/creature/type` surfaces them.

Fix direction: add a discovery path that emits **all discovered classifier
types (bound or not)** so unrepresented/new types are visible — either (a) a
`types` section in the `pull` extract fetched from the `/type` endpoints, or (b)
a `map`/report mode that lists discovered mobRPG types with no vault counterpart
(the "new type, vault has no equivalent" set). The traversal set is
creature/organization/political types; landfeature/item have no `/type` endpoint
(those types live on the elements).

## Resolved

### G3 — no verb re-points a moved/renamed note's `external_ref` ✅
**Resolved 2026-07-19.** New `mobrpg relink` verb (native, vault-only — no API
call, so no token/world):

    mobrpg relink --vault <path> --to <new-rel-path> [--from <old-rel-path>] [--execute]

Reads the note now at `--to`, derives the namespace from its existing
`external_ref`, rewrites `external_ref` → `<namespace>:<to>`, **preserves
`element_id`**, and records the prior ref in a new optional `previous_ref` node
scalar (`node._SCALARS`, emitted only when present → backward compatible).
`--from` is an optional guard that refuses the relink if the note's current ref
doesn't match. Dry-run → present → `--execute` like the other vault mutations;
no-op when already linked; refuses `..` traversal / missing note / node without
an `external_ref`. Registered in `cli.py` + documented in `llms.txt`. Verified
end-to-end (dry-run leaves the file byte-identical; execute preserves authored
frontmatter). Coverage: 9 tests in `test_relink.py` + 2 in `test_node.py`.

### G2 — `map`: `status:"review"` is schema-reserved but never emitted ✅
**Resolved 2026-07-19.** Ambiguity criterion (Ant's call): *word-embedded
feature* for locations, *fuzzy near-duplicate* for classifiers.

- `_route_location()` now parks a location in `status:"review"` when its type
  **embeds a landfeature word as a component** (`_embedded_landfeature()`,
  word-split against the enum + synonym tables) but isn't itself a clean feature
  — e.g. "River port and boatyard on the Nile". Clean features still route to
  landfeature; plain political types ("Hospital", "Town") still auto-route to a
  new PoliticalType; existing types still bind. The review entry carries both
  candidates (`politicalType` default + `landFeatureType` hint) so the skill's
  review loop can present the decision.
- `_bind()` now flags a classifier value `status:"review"` when it is a **close
  fuzzy match to an existing type** (`difflib`, cutoff 0.85) but not exact-CI —
  e.g. "Archaeologist" vs existing "archeologist" — carrying `nearExisting` /
  `nearId`. Prevents silently minting near-duplicate types.
- Push-time safety net: `suggest.resolve_classifier()` treats an unresolved
  `status:"review"` as `drop` (skip minting) so an un-triaged near-duplicate is
  never created behind the GM's back; a GM resolution to `confirmed` (create) or
  a bound `mobrpgId` (reuse) still works. `_merge` gives classifiers the same
  confirmed-wins / review→bound parity as locations.
- Validated on real data: locations 3/80 review (all genuine, 0 false
  positives), professions 1/201 review (the Archaeologist/archeologist variant).
- Coverage: 7 new tests across `test_map.py` + `test_suggest.py`.

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
