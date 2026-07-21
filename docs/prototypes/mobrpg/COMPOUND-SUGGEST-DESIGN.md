> **Historical.** The crosswalk/sidecar approach described below is retired. Per-note `mobrpg:` frontmatter nodes are the sole id source; unlinked vaults are established with `mobrpg adopt` (live name-match). This document is kept for provenance.

# Compound `suggest` — design

**Status:** design (2026-07-18). Approved for implementation. Implements
"Implementation order" **#3** of `COMPLETE-SUGGESTIONS-SPEC.md` — the map-driven
compound-batch builder. Companion inputs: `COMPLETE-SUGGESTIONS-SPEC.md` (Pillars
1–2), `schema-map.md` (entity/field/relationship mapping), the per-vault
`_meta/mobrpg-map.json`, and `canticle-regency-crosswalk.json`.

## Problem

`mobrpg suggest` today shells out to `push_suggestions.py`, which emits **bare**
`CreateElement`s — a name + description + minimal `data`, nothing else. Every
suggestion lands structurally empty: a Person with no Race/Sex/Profession, a
location with no type, an org with no type, a creature with no type, and **no
relationships**. This is the gap called out in the spec's "Why".

## Goal

Upgrade `suggest` **in place** to a native command that, for each vault entity,
builds the **full datatype graph** — the element + its classifier Types (as
`Attribute` edges) + its relationships (as reified `Event`s with `Link` edges) —
and submits it as one or more compound `SubmitSuggestionsRequest` batches through
the **existing** submit transport. No re-implementation of auth or transport.

Out of scope (later impl-order steps): Pillar 3 vault-writeback, crosswalk
review-state, the authority/reconciliation rule, and the mobRPG skill. This task
is the **builder + chunker** only.

## Command surface

```
mobrpg suggest <world> --vault <path>
    [--map FILE]        # default: <vault>/_meta/mobrpg-map.json
    [--crosswalk FILE]  # default: alongside this package (canticle-regency-crosswalk.json)
    [--chapter X]       # restrict to entities tagged with a chapter
    [--kind K]          # restrict to one vault kind (npc, location, item, ...)
    [--only SUBSTR]     # substring match on entity name
    [--limit N]         # cap number of *entities* considered
    [--batch-label L]   # override the batch label
    [--out DIR]         # where to write the request/response JSON (default ./push_out)
    [--execute]         # actually submit (default: dry-run)
```

- **Dry-run by default:** prints the per-entity plan and writes the assembled
  batch JSON to `--out`; makes no mutating call.
- **`--execute`** submits. Prod writes additionally require
  `MOBRPG_ALLOW_PROD_WRITES=1`; the builder calls
  `client.assert_writes_allowed()` before any POST.
- Auth/env resolved by `mobrpg.client` exactly as the other verbs.

## Inputs

1. **`_meta/mobrpg-map.json`** (Pillar 2 rules). Read: `classifiers`
   (`profession`, `organizationType`, `creatureType`, `sex`), `locationRouting`,
   `relationshipTypes` (predicate → eventType), `kinds` (vault kind → element
   kind). A classifier/route entry is consumed by **field presence, not status
   string**:
   - `mobrpgId` present → reference that **real** type id directly (no create).
   - `status: "drop"` → omit that classifier entirely for the entity.
   - otherwise → emit a `CreateElement` for the Type keyed by its `name`, and let
     the server **swallow** same-named classifiers by name-identity (Pillar 1b),
     rewriting the ref to the real id in `resolvedRefs`.
2. **crosswalk JSON** — `entities[]` (`name`, `kind`, `mobrpg_id`) and
   `relationships[]` (`subject`, `target`, `predicate`, `mobrpg_event_id`,
   `file`). Used **read-only** here: resolve a relationship endpoint (and a known
   entity) to a **real** mobRPG id so cross-entity links need not sit in the same
   batch.
3. **vault `.md` files** — per-entity frontmatter (`type`, `occupation`,
   `gender`, `location_type`, `faction_type`, `creature_type`, `aliases`,
   `relationships`) + body markdown. Frontmatter parsing reuses the `map_cmd`
   helpers (`_frontmatter`, `_scalar`, `_first_token`) and the relationship
   parser shape from `push_relationships.parse_rels`; the body→HTML description
   reuses `push_to_mobrpg.md_to_html` (which delegates to the shared `mobrpg/md`
   converter and strips the housekeeping/GM sections).
4. **one live discovery call** at start — `GET /world/{w}/person/race` — to obtain
   the live **Human** race id (the map stores only the name). Cached for the run.

## The per-entity group (the atomic chunk unit)

For one subject entity the builder emits a **group** of batch items that always
travel together:

1. **Element create** — `CreateElement` with:
   - `name` = display name (filename-derived, `push_to_mobrpg.display_name`),
   - `description` = HTML from the body,
   - `altNames` = `aliases`,
   - `data` = the minimal valid `WorldElementData` for the kind (Pillar 1a table),
   - `externalRef` = `"<namespace>:<vault-relative path w/o .md>"` (idempotency).
   - client-local `ref` unique within its batch, e.g. `e{n}`.
2. **Classifier Types + `Attribute` edges** (classifier = **source**, entity =
   **target**):
   | Entity kind | Classifiers emitted |
   |---|---|
   | person (npc/pc) | **Profession** (from `occupation`), **Race** (Human default), **Sex** (from `gender`, race-scoped) |
   | organization (faction) | **OrganizationType** (from `faction_type`) |
   | creature | **CreatureType** (from `creature_type`) |
   | political (built location) | **PoliticalType** (from `location_type` routing) |
   | landfeature (natural location) | *no edge* — inline `landFeatureTypes` enum on the element `data` |

   Each non-dropped, non-bound classifier is one `CreateElement` (Type) + one
   `AddRelation` (`Attribute`, `source → target`). Bound classifiers skip the
   create and point the edge `sourceRef` straight at the real id.
3. **Race + Sex wiring (persons).** Race defaults to **"Human"**; the edge
   references the **live Human race id** (from the discovery call) as `sourceRef`
   — no in-batch Race create needed since it already exists. Sex is **race-scoped**
   (Pillar 1c): emit a Sex `CreateElement` (or reference a bound id) plus **two**
   `Attribute` edges — `Race(realId) → Sex` (scopes/dedupes it) and
   `Sex → Person` (classifies). Because the Race id is real (not an in-batch ref),
   the server can dedupe "Male"/"Female" onto the existing Sex.
4. **Relationships → reified Events.** For each relationship in the entity's
   frontmatter: one `Event` `CreateElement` (`data = {type:"Event", eventType:
   <mapped>}`, name/title/description carrying the predicate so meaning survives)
   + two `Link` `AddRelation` edges: `Event → subject`, `Event → target`.
   - `eventType` from the map's `relationshipTypes` (predicate → one of Employ /
     Membership / Leadership / Reign / War / Score / Generic; default Generic).
   - Endpoints resolve to **real ids** via the crosswalk. If the subject is the
     entity being created in this same group, its endpoint uses the in-batch
     `suggestion:<ref>`. If the **target** is neither in the crosswalk nor being
     created in this run, the relationship is **skipped and reported** (queued for
     a later run once the target exists) — never emitted with an unresolvable
     endpoint.
   - **Idempotency.** The Event create carries a stable `externalRef`
     (`<namespace>:rel/<subject-path>/<predicate>/<target>`), so a re-run resolves
     to the existing event instead of duplicating it. Additionally, if the
     crosswalk's `relationships[]` already records this `(subject, predicate,
     target)` triple **with a `mobrpg_event_id`**, the relationship is skipped
     entirely (already linked) — a read-only use of the crosswalk that keeps
     re-runs clean without entering Pillar-3 writeback.

Edges carry no `externalRef` (only element creates do). `dependsOn` lists the
client-local refs an item needs within its batch (e.g. an `Attribute` edge
depends on the Type create and the element create it connects).

## Chunker

- Build every entity-group first (a list of item-lists).
- **Greedily pack** whole groups into `SubmitSuggestionsRequest` batches with
  `len(suggestions) <= 100`. A group is never split across batches; its in-batch
  refs (`suggestion:<ref>`, `dependsOn`) therefore always resolve within the same
  POST. Cross-entity relationship endpoints use crosswalk real ids, so they never
  force two groups into one batch.
- A single group that alone exceeds 100 items is a hard error naming the entity
  (extremely unlikely — an entity would need ~30+ relationships — but explicit,
  never a silent truncation).
- Submit batches **in order**; aggregate `stored` counts and `resolvedRefs`
  across batches for the summary. Dry-run writes each batch's JSON to `--out`.

## Transport (shared, not duplicated)

Extract the POST + dry-run summary from `submit_batch.py` into a reusable
function, e.g.:

```python
# submit_batch.py
def submit(world, request, *, execute, out=None, label_index=None) -> dict:
    """Dry-run summary or POST one SubmitSuggestionsRequest; return the response
    (or {} on dry-run). Callers: `submit-batch` (file in) and `suggest` (built)."""
```

`submit-batch`'s `run` becomes a thin wrapper (load file → `submit`). `suggest`
calls `submit` per chunk. One transport path, one place that touches
`client.assert_writes_allowed()` / `client._request`.

## Module layout

- **`mobrpg/commands/suggest.py`** — new. `run(argv) -> int`: arg parsing,
  discovery, candidate collection, group building, chunking, and calling
  `submit_batch.submit` per chunk. Pure functions for the testable core:
  `collect_entities`, `build_group(entity, map, crosswalk, race_id)`,
  `chunk_groups(groups, cap=100)`.
- **`mobrpg/commands/submit_batch.py`** — refactor to expose `submit(...)`;
  `run` delegates to it.
- **`mobrpg/cli.py`** — `from mobrpg.commands import suggest as _suggest`; add
  `"suggest": _suggest.run` to `NATIVE`; remove `"suggest"` from `FALLBACK`.
  `VERB_HELP` keeps a `suggest` line (updated wording: "build + submit the full
  datatype graph per entity").
- **`push_suggestions.py`** — left on disk untouched (no longer routed to).

Reuse over copy: frontmatter/aliases/body helpers come from `map_cmd` and
`push_to_mobrpg`; the predicate→eventType and land-subtype tables already live in
`map_cmd`. `suggest.py` should import these rather than restate them.

## Error handling

- Missing/invalid map or crosswalk file → exit 2 with a clear message (mirror
  `submit_batch`'s bad-file handling).
- Map with no matching classifier entry for a value → treat as an unmapped
  "create-new" by the raw value (title-cased), and **report** it in the plan so
  the gap is visible (never silently drop the classifier).
- Unresolvable relationship target → skip + report (see above).
- API error on any batch → surface it and stop (don't half-submit silently);
  already-submitted batches stand (externalRef keeps the run idempotent on
  re-run).
- No candidate entities after filters → exit 1 with guidance.

## Testing (TDD)

Unit tests with fixture vault dirs + fake map/crosswalk dicts, mocking
`client._request` (patterns from `test_map.py`, `test_submit_batch.py`,
`test_pull.py`). Cover:

- **Element data per kind** — Person/Political/Organization/Item/Creature minimal
  `data` is present and valid; `externalRef` shape.
- **Each classifier mechanism** — Profession edge; bound (`mobrpgId`) vs
  create-by-name vs `drop`; OrganizationType; CreatureType; PoliticalType.
- **Race/Sex three-edge wiring** — Race→Person, Sex→Person, Race→Sex; Race edge
  uses the discovered **real** Human id; default race = Human.
- **Location split** — built → Political+PoliticalType edge; natural → LandFeature
  with inline `landFeatureTypes`, no edge.
- **Relationship reification** — Event create with mapped `eventType` + two Link
  edges; endpoint resolution via crosswalk; unresolvable target skipped+reported;
  subject-side uses in-batch `suggestion:<ref>`; Event has a stable `externalRef`;
  a triple already in the crosswalk with a `mobrpg_event_id` is skipped.
- **Chunker** — groups pack to ≤100; a group is never split; boundary case at
  exactly 100; oversized single group errors.
- **Transport** — `submit_batch.submit` dry-run makes no call and summarizes;
  `--execute` POSTs each chunk; `assert_writes_allowed` invoked; `submit-batch`
  still works through the refactored `submit`.
- **CLI wiring** — `suggest` dispatches to the native `run`, not the fallback;
  `test_cli.py` fallback tests still pass (they reference `push`/`images`).

Baseline is 60 passing; the full suite must stay green.

## Non-goals / deferred

- Writing determined mappings back to vault frontmatter or the crosswalk
  (impl-order #4).
- Crosswalk review-state (`pending|accepted|dismissed|edited`), `content_hash`,
  and the "mobRPG wins after an edit" authority rule (#4).
- Language inline-by-UUID references (two-phase; not needed for the Canticle
  vault's current data) — the Person `languages` set stays `[]`.
- The mobRPG skill wrapping curation/judgment (#5).
