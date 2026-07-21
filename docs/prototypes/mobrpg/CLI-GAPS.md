> **Historical.** The crosswalk/sidecar approach described below is retired. Per-note `mobrpg:` frontmatter nodes are the sole id source; unlinked vaults are established with `mobrpg adopt` (live name-match). This document is kept for provenance.

# mobRPG CLI — gaps to add or fix

Running list of CLI shortfalls the `mobrpg-sync` skill needs closed. **The goal
is to bring the CLI up to what the skill requires — not to degrade the skill to
match a limited CLI.** The skill is authored to its intended target behavior;
each item below is where the CLI currently falls short of that target, so it can
be fixed rather than worked around.

Discovered during the mobrpg-sync skill build (Plan 1, branch `mobrpg-cli`).

## Open

### P1 — make the `provenance` marker self-sustaining (templates + the-midwife skill)

The source-level `provenance:` field (`mobrpg`/`play`/`midwife`/`backstory`/`manual`,
see `PROVENANCE.md`) was backfilled onto the `space_game` vault so origin is answerable,
and `suggest` filters on it (`--only-/--exclude-provenance`) for tranche pushes. But it's
only durable going forward if the tools that CREATE entities stamp it. As part of this
branch:

- **Entity templates** — add `provenance:` to the entity frontmatter templates (the
  shared/per-kind templates in the gm-apprentice repo), next to `source:`, so every
  newly-scaffolded note carries the field.
- **the-midwife skill** — when the midwife scaffolds entities for the Session-0 handoff,
  it must set `provenance: "midwife"` on what it creates (the whole reason this marker
  exists — midwife output is otherwise indistinguishable from manual genesis prep).
- Consider the sibling skills that create entities (session-wrapup → `play`,
  ttrpg-expert/manual → `manual`, vault-ingest, campaign-organizer) so the field is set
  at creation everywhere, not just by the midwife.

NOTE: templates + skills live in the **main gm-apprentice repo**, not this prototype dir —
this touches main-repo schema, so follow `docs/schema-change-procedure.md` (new frontmatter
field) when it's picked up.

## Resolved

### V1 — no verb for the "what's new" discovery report ✅
**Resolved 2026-07-19.** New read-only `mobrpg whats-new <world> --vault <path>
[--extract F] [--json]` verb, formalizing the hand-rolled discovery pass. Diffs a
live pull (or a pre-pulled `--extract`) against the vault's `mobrpg:` nodes + type
map via a pure `diff_world()`: **new** entities (in mobRPG, no linked node → pull
candidates), **gone** (vault nodes whose element_id is absent upstream →
deleted/zombie notes), **new types** (from pull's G4 `types` section, not yet in
the map). Reuses `pull.extract()`; GET-only, never writes the vault. Live-proven
on the Space world post-migration: `1 new (Meridian), 0 gone, 5 new type(s), 140
linked`. Coverage: 3 tests in `test_whats_new.py`. The pull-side companion to the
push-side `suggest-desc`/`suggest`.

### G7 — hardcoded `canticle` namespace mints mismatched externalRefs on non-Canticle vaults ✅
**Found + resolved 2026-07-19.** `map_cmd.build_map` hardcoded
`"vaultNamespace": "canticle"` and `backfill.run` defaulted `--namespace` to
`"canticle"`. For any non-Canticle vault this is wrong: the `space_game` vault's
nodes carry `space_game:` external_refs (from `backfill --namespace space_game`),
but `map init` wrote `vaultNamespace="canticle"`, so `suggest` built `canticle:`
externalRefs that don't correlate to the existing elements — the backend can't
dedupe by externalRef, so a `--execute` risks **duplicate-creating** every
element instead of matching it.

Fix: a shared `map_cmd.derive_namespace(vault)` helper — prefer the namespace of
an existing note's `mobrpg:` node `external_ref` (the substring before the first
`:`, scanning the vault's `FOLDERS` for the first note with a node), else fall
back to the vault directory basename. Wired into **both** `map init`
(`vaultNamespace`) and `backfill` (the `--namespace` default is now derived, not
`"canticle"`, when not passed). Two adjacent footguns closed in the same class:
`suggest.run` fell back to `"canticle"` when a (older/foreign) map omitted
`vaultNamespace` — now `mp.get("vaultNamespace") or derive_namespace(vault)`; and
its batch label hardcoded `"Canticle suggest (...)"` — now `f"{namespace} suggest
(...)"`.

Verified live read-only: rebuilding the real `space_game` vault map
(`map init … --vault ~/Documents/space_game`) now writes
`vaultNamespace: "space_game"` (was `canticle`), with `relationshipTypes` still
mapping `part_of`→Parent / `contains`,`hosts`→Child / `adjacent_to`→Link. A
`suggest … --only "Eris II"` dry-run (no `--execute`) then emitted
`CreateElement Political 'Eris II' externalRef=space_game:Locations/Eris II`
(not `canticle:`), batch label `space_game suggest (all)`, and resolved the
`part_of` Parent target to the real Eris System element id
(`caee3173-1f28-4b46-b1fe-e5ece1f68340`). Coverage: 3 tests in `test_map.py`
(node-derived, basename fallback, init end-to-end), 2 in `test_backfill.py`
(derived default + explicit override), 1 in `test_suggest.py` (no `canticle`
fallback in namespace or label).

### G4 — `pull` was entity-only; it never traversed classifier `/type` endpoints ✅
**Resolved 2026-07-19.** `pull.extract()` now emits a top-level **`types`**
section alongside `entities`/`events`/`counts`. A new `TYPE_KINDS`
(`creature/type`, `organization/type`, `political/type`) is GET'd via the
existing `_list_all()` helper — which already swallows the endpoints that 404 or
return non-JSON/empty (mirrors the entity-list try/except), so a missing endpoint
yields `[]` rather than aborting the pull. Each entry is a bare `{id, name}`
record. landfeature/item are deliberately excluded — they have **no** `/type`
endpoint (their types live on the elements as `landFeatureTypes` / item
`attributes.itemType`, already surfaced as entity `classifiers`). So a "what's
new in mobRPG" report built from a `pull` extract now covers **entities + edits +
classifier types (bound or not)**, no longer silently dropping a standalone/new
type that no vault content references.

Verified live read-only against the Space world (`a254e424-…`): the `types`
section carried the **2 creature types** the gap was filed for (Thideian Furry
Lamprey, Thideian Chitinoteuthis), plus **3 organization types** (Governmental,
Criminal, Corporation) and **5 political types** (Gate, City, Starport,
Spaceship, Space Station) — none of which appear as entity records. Coverage: 3
new tests in `test_pull.py` (extraction, empty/missing, non-JSON endpoint).

### G6 — `backfill` only accepts the Regency-style crosswalk, not the `detect_updates` dict format ✅
**Resolved 2026-07-19** (commit `8252a9a`). `backfill.nodes_from_crosswalk` now
detects the crosswalk schema by the presence of the `entities` key: the
Regency-style `{worldId, entities[], relationships[]}` list form still routes
through the fuzzy name-match path, while the `detect_updates` id-keyed dict
(`element_id` → `{name, kind, vault_path, …}`) routes through the new
`_nodes_from_dict_crosswalk()`. A mobRPG-kind→element_kind map
(`_MOBRPG_KIND_NAME`: person→Person, organization→Organization,
political→Political, landfeature→LandFeature, item→Item, creature→Creature,
currency→Currency, culture→Culture) converts the stored mobRPG kind to the
`element_kind` used in `mobrpg:` nodes. The dict form resolves each node **by
`vault_path`** (exact join against the vault root), not by name — a missing
file is reported unresolved rather than silently dropped. So the
`space_game` vault's dict-format `_meta/mobrpg-crosswalk.json` now migrates
instead of reporting `0 node(s) to write`. Coverage in `test_backfill.py`.

### Structural relationship mapping — predicates now map to WorldElementRelation, not Generic events ✅
**Resolved 2026-07-19** (commit `250d2e6`). `map_cmd` gained `PREDICATE_RELATION`
+ `RELATION_TYPES` + `predicate_type()`: mobRPG has a second relationship
mechanism besides reified Events — a direct `WorldElementRelation` whose enum is
`{Attribute, Link, Parent, Child, Spouse}` (`WorldElementRelationType`, backend).
Structural/spatial predicates now resolve there: `part_of`→Parent,
`contains`/`hosts`→Child, `adjacent_to`→Link (spouse_of/married_to→Spouse). A
planet `part_of` a system is the system's Child (Parent/Child are
auto-bidirectional on the backend), not a `Generic` event. `suggest` now emits a
direct `AddRelation` (`type=Parent|Child|Link`) for a structural predicate
instead of reifying it as an Event; non-structural predicates still map to an
Event `eventType` (defaulting to Generic). The map's `relationshipTypes` block is
generated via `predicate_type()` so a GM can override per predicate.

### Node-based target resolution — `suggest` resolves relationship targets from `mobrpg:` nodes ✅
**Resolved 2026-07-19** (commit `2c6e701`). `suggest.node_index(vault)` builds
the same `(ent_id_by_key, linked)` shape as `crosswalk_index` but from the
vault's own `mobrpg:` nodes: it walks `map_cmd.FOLDERS`, reads each note's node,
and indexes `element_id` by name-key plus every already-`event_id`-linked
relationship. `suggest` merges this over `crosswalk_index`, so a node-migrated
vault (no sidecar crosswalk) still resolves a relationship's target to a real
element id. Verified live read-only against the Space world: `part_of` on
`Eris II` resolved its Parent target to the real `Eris System` element id.

### G5 — no verb suggests a note's authored description *up* to mobRPG ✅
**Resolved 2026-07-19.** New `mobrpg suggest-desc` verb (native), the inverse of
`pull-desc`: where a linked note carries authored canon-section prose that the
mobRPG element is missing (empty stub) or poorer on, it proposes that prose *up*
as a reviewable suggestion — never a direct element `PUT`.

    mobrpg suggest-desc <world> --vault <path> [--only <ref>] [--threshold F]
                        [--batch-label L] [--execute]

**API shape (grounded in the Spring backend, `models/world/suggestion/`, not
guessed):** operation **`UpdateElement`**, payload `UpdateElementPayload` — a
**sparse** edit `{ operation, targetRef, description?, name?, altNames? }` where a
present field replaces and null leaves alone. `targetRef` must be a **real element
id** (`SuggestionService` throws "UpdateElement must target a real element" on a
`suggestion:` ref); the typed `data` block is deliberately not accepted. Carried
in the same `SubmitSuggestionsRequest` transport as `suggest`/`submit-batch`, so
`submit_batch.submit()` gives the dry-run summary, `--execute`, and the
`assert_writes_allowed()` prod guard for free. Each edit uses a **distinct
`<ns>:desc/<relpath>` externalRef** (never the element's own create externalRef):
the backend dedupes an active suggestion by externalRef, so a re-run collapses
onto its own still-pending desc suggestion instead of piling up or being swallowed
by the element's create.

Candidate selection is pure/testable (mirrors `pull-desc`'s classify/resolve
split): `no-prose` (nothing authored — skip), `empty` (mobRPG stub — the core G5
case), `in-sync` (live >= `--threshold` similar, default 0.98), or `differs`.
Similarity uses `difflib.SequenceMatcher(autojunk=False)` — the default heuristic
drops "popular" characters on long strings and reports false near-zero ratios.
Dry-run by default; `--execute` submits; prod also needs `MOBRPG_ALLOW_PROD_WRITES=1`.
Registered in `cli.py` + documented in `llms.txt` (Mutating list). Coverage: 21
new tests in `test_suggest_desc.py` (189 total, was 168).

Verified live read-only against the Space world (`a254e424-…`,
`~/Documents/space_game`): the first pass reported **140 candidates of 140 synced
notes — 6 `empty` (genuine stubs across NPC/Location/Faction/Item, incl. the
`_World`-style currency case G5 was filed for), 134 `differs`** — dry-run, nothing
written.

**Follow-up (RESOLVED 2026-07-19):** the 134 `differs` were largely *formatting*
noise, not richer content — the vault `canon_section` includes a leading
`## Overview` → `<h2>` heading and HTML-entity encoding, while mobRPG stores
headingless `<span style="">`-wrapped prose (~0.82–0.87 similarity on
otherwise-identical text). `classify_candidate` now compares a NORMALIZED
plain-text key (`normalize_for_compare`) instead of raw HTML: drop `<h1..h6>`
heading blocks (the `## Overview` header), strip remaining tags (incl. the style
spans), decode entities, collapse whitespace, lowercase — applied to BOTH sides;
`similarity` still uses `SequenceMatcher(autojunk=False)`. Empty-stub detection
stays on raw HTML, and the *submitted* description is unchanged (full authored
prose) — only the comparison is normalized. Re-run live read-only, the candidate
set dropped to **35 of 140 — 6 `empty` + 29 genuine `differs`, with 105 now
correctly `in-sync`** (was 134 false `differs`). 3 new tests in
`test_suggest_desc.py`.

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
