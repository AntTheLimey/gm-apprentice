> **Historical.** The crosswalk/sidecar approach described below is retired. Per-note `mobrpg:` frontmatter nodes are the sole id source; unlinked vaults are established with `mobrpg adopt` (live name-match). This document is kept for provenance.

# mobRPG → vault integration log

Running research notes for building the real mobRPG → gm-apprentice-vault
integration. Records the method, decisions, and gotchas discovered while
synthesising Tim's **Space** world into the local **Dead End** vault
(`~/Documents/space_game`). Companion to `schema-map.md`,
`gm-apprentice-ontology-export.md`, and `FINDINGS.md`.

## Goal & policy

- **Task:** pull the mobRPG *Space* world (`worldId a254e424-…`, shared with
  read access by `timmah`) and synthesise its entities into the Dead End vault.
- **Canon policy (GM directive):** **mobRPG is canon over the existing vault.**
  On any conflict, mobRPG wins. Preserve only the vault's *protected* sections
  (`## GM Notes`, `## Notes`) — never overwrite those from the API.
- **Direction:** one-way, mobRPG → vault (the "pull" direction from `schema-map.md`).

## Drift map (Space world ↔ Dead End vault)

Surveyed 2026-06-28. **The two are the same setting but have near-disjoint casts.**

| | Dead End vault | mobRPG Space |
|---|---|---|
| People | 18 NPCs + 2 PCs (Aldous Renn, Bex Sennet, Corwin Dace, Rock Lavey, Six…) | **22 different people** (Julija Borja, Holger Graeme, Wilton Agramunt…) |
| Orgs | 9 | **20** (corporations, syndicates, churches, news nets) |
| Places | 11 Locations (Thides I–VI, Meridian, Amber Lady, Sundog Base) | 21 `political` + 32 `landfeature` |
| Ships/items | 1 | 9 ships (`item`) |
| Relationships | in NPC frontmatter | 28 reified `event`s |

- **Overlap = star-system geography only:** Thides System + Thides II–VI exist in
  *both* (vault `Locations/`, mobRPG `landfeature`). Corwin system is mobRPG-only
  but the vault has an NPC "Corwin Dace" (system likely named for a character).
- **Consequence:** with mobRPG-as-canon this is **mostly an additive import** —
  bring in mobRPG's whole cast/org/place/ship/relationship layer; reconcile the
  shared geography (mobRPG wins); leave non-conflicting vault-only entities alone
  (flag, don't delete).

## How relationships work in this world (critical)

Unlike Regency Cthulhu (where people carried `Attribute` classifier edges),
**Space people have empty `relations[]`** — every relationship is an `event`:

```
event "Holger Graeme, Leader of Station Security (MacMillian Station VI)"
   eventType: Leadership   Link→ Holger [person]   Link→ Station Security [org]
```

So the ETL must, for every event: read its two `Link` endpoints + `eventType` +
role (from `name`/`title`), and attach a derived relationship to each participant
entity. **A person's full relationship set is assembled from the event list, not
from the person record.**

## Gotchas discovered (for the real integration)

1. **Relationships are in events, not on entities.** Must join events → participants.
2. **Event `name` strings can disagree with their `Link` targets.** Events say
   "…MacMillian Station VI" but the only `political` station entity is
   "MacMillian Station IV". **Resolve relationships by `Link` targetId, never by
   parsing the event name.** Treat the name as a display label only.
3. **`description` is HTML** (`<p><span style="">…`), often with empty `style`
   attributes and `<br>` filler — needs HTML→markdown conversion + whitespace
   cleanup.
4. **eventType ≠ role.** `eventType` is the 7-value bucket; the *specific* role
   ("Station Manager", "Boss", "Underling", "Priest", "Marshal") is in the event
   `name`/`title`. Both are needed to reconstruct a meaningful vault relationship.
5. **Places split across two mobRPG types.** `political` (stations, cities,
   starports, ships-as-place) vs `landfeature` (systems, planets, belts, routes).
   Both map to vault `Locations/` but with different `location_type`.
6. **No default calendar on this world** → event timestamps can't be dated
   (all null here anyway). Timeline import deferred.
7. **Vault version is behind** (`1.6.0` vs plugin `1.7.x`). Skill calls for
   migration first; flagged to GM.
8. **`notes[]` carries the GM-only flag.** Every entity detail returns a
   `notes[]` array (empty on most). Each note is
   `{note: "<html>", hidden: bool, id, lastModified, lastModifiedById}` — and
   `hidden` is the GM/player switch: **`hidden=true` is Keeper-only, `hidden=false`
   is player-safe.** The original 2026-06-28 import ignored `notes[]` entirely, so
   those facts were silently dropped from the vault. Fixed 2026-07-05:
   `etl_extract.py` now splits each entity's notes into `notes_public` /
   `notes_gm`; `vault_write.py` renders public notes as a `## Notes` section in the
   body and GM notes as a `> [!info] Keeper Only` callout under `## GM Notes`;
   `detect_updates.py` folds notes into the change hash (keyed in only when
   present, so no-note entities still match the pre-notes baseline). In the Space
   world today only Daniela Akkermans (2) and Pia Kadyrov (1) carry notes, all
   *visible-to-us* as `hidden=false` — so a re-sync surfaces those three
   previously-dropped player-safe facts as `## mobRPG Update Available` sections.

   ⚠️ **Hidden notes are owner-only — our token never receives them.** Confirmed
   with Tim 2026-07-05: the API strips `hidden=true` notes from the response
   unless the requesting user **owns** the world. Our token authenticates as
   `antthelimey`, a non-owner collaborator on Tim's (read-only) Space world, so
   every note we pull comes back `hidden=false` regardless of its real flag — a
   note Tim marks hidden simply vanishes from our extract. **Consequence: for the
   Space → Dead End pull, `notes_gm` is always empty; GM-only mobRPG notes cannot
   be imported into Dead End through this channel.** The split/render code is still
   correct and *is* exercisable owner-side (e.g. the Canticle → Regency world,
   which we own) — it just can't fire on Tim's world. Tested 2026-07-05: after Tim
   added a hidden note to Daniela, our detail GET still returned only her two
   `hidden=false` notes, confirming the server-side filter.

## Type mapping used for this synthesis

| mobRPG | → vault folder | `type` | `location_type`/notes |
|---|---|---|---|
| person | `Characters/NPCs/` | npc | role from events → `occupation` |
| organization | `Factions & Organizations/` | faction | `factionType` from `organization/type` |
| political (station/city/starport/ship) | `Locations/` | location | `location_type` = the political/type |
| landfeature (system/planet/belt/route) | `Locations/` | location | `location_type` = system/planet/etc. |
| item (ship) | `Items & Artifacts/` | item | `item_type: vehicle` |
| event | → relationships on participants | — | not its own file (this world) |
| term | (glossary) | — | deferred |

## ETL pipeline (implemented in `etl_extract.py`)

1. Pull every entity type from the world → `id → {type, name, descriptionHTML}`.
2. Pull every event; for each, resolve the two `Link` endpoints, read `eventType`
   + role, emit a directed relationship onto each endpoint.
3. Convert `description` HTML → markdown; clean whitespace.
4. Emit a structured JSON (`space_extract.json`): one record per entity with
   resolved relationships + markdown body — the vault-writer's input.

(Step 5, writing vault files from the JSON, is the synthesis proper.)

## Results (2026-06-28)

End-to-end run produced a full synthesis **preview** (not the live vault) at
`space_vault_preview/`:

- `etl_extract.py` → `space_extract.json`: **104 entities + 28 events**, with
  relationships assembled from events and HTML→markdown bodies.
- `vault_write.py` → `space_vault_preview/`: **104 vault files**
  (22 NPC, 20 faction, 21+32 location, 9 item).
- **`python3 scripts/validate_schema.py space_vault_preview` → all 104 pass.**

The two scripts are the reusable core of the integration (extract + write).

### Build notes / additional gotchas

8. **Classifier types must be indexed but not emitted.** First pass left
   `factionType`/`location_type` empty because `organization/type` and
   `political/type` entities weren't in the index, so `Attribute` edges couldn't
   resolve. Fix: index them (CLASSIFIER_KINDS) but skip them when writing files.
9. **No `source` enum value fits an API import.** Schema `source` is
   play/prep/backstory/world-evolution. Used `prep` as placeholder + recorded
   provenance in `source_document`. **The real integration should add an
   `api-import` (or `mobrpg`) source value.**
10. **mobRPG lacks fields the vault has slots for:** `age`, `gender`,
    `nationality`, `motivations`, `goals`, `tier` — all left blank. mobRPG keeps
    these (if at all) inside the prose `description`, not as structured fields.
11. **`occupation` for NPCs** is taken from the first event role (e.g. "Leader of
    Station Security"). Works, but a person with several roles only surfaces one;
    the rest live in `relationships[].description`.
12. **Plain-line lists lose bullets.** mobRPG bodies that use `<p>`/`<br>` for
    list-like content (station facilities) convert to bare lines, not `-` lists.
    Acceptable; a smarter HTML→md pass could infer lists.

13. **Naming convention is per-vault — must be detected.** Dead End uses
    **spaces** in filenames and wiki-links (`Thides System.md`,
    `[[Thides System]]`); the Regency vault used **underscores**
    (`[[Marina_Garrick]]`). Writing the wrong style silently breaks every
    wiki-link AND hides real collisions (an underscore preview "collided with"
    nothing because the live files use spaces). The integration must sniff an
    existing vault file to pick the style before writing.

### Real collisions (space-style, 8 of 104)

7 geography + 1 org already exist in the live vault → need merge, not overwrite:
`Thides I–VI`, `Thides System`, and `MacMillian Mining and Extraction
Corporation`. The other **96 files are new** (safe additive import).

## Final outcome (live vault, 2026-06-28)

Backup first: `~/Documents/space_game.backup-*.tar.gz`.

1. **Migrated 1.6.0 → 1.7.0** (additive): added `Sequencing` relationship row
   (`leads_to`, `precedes`, `alternative_to`); bumped `gm_apprentice_version`.
   (`plan` type, plan template, a `Planning/` folder were already present.)
2. **Additive import: 96 new entities** copied with `cp -Rn` (no-clobber, cannot
   overwrite). Vault 76 → 172 files. Final: 40 NPC, 28 org, 57 location, 10 item.
3. **8 overlaps merged non-destructively** (`merge_overlaps.py`): kept the richer
   vault prose, appended a `## mobRPG (canon import)` section before `## GM Notes`,
   added `mobrpg-import` tag, flagged the station-name conflict inline.
4. **Validation:** all 104 imported + 8 merged files pass `validate_schema.py`.
   (11 pre-existing errors remain in `_meta`/`_Templates` files — unrelated.)

### Gotcha 14: orphan status must be judged from the VAULT, not the source

The orphan auto-linker first read "has relationships?" from the mobRPG extract.
But the 6 merged Thides planets carried `part_of` from the *vault* while their
mobRPG records looked like orphans — so it added a **duplicate** `part_of`. Fix:
judge orphan/linked status from the live vault file, never from the import source.
Post-import enrichment must always read current vault state.

## Reverse direction: vault → mobRPG (Canticle → Regency, 2026-06-28)

Proved the **write** path (we own the Regency world: `ReadWriteDelete`).
`push_to_mobrpg.py` is the reverse ETL. Pilot = Canticle **Chapter 1 (London)**,
entities only (relationships deferred per GM).

- **Gap:** Canticle has ~294 entities mobRPG lacked (189 NPC, 70 location, 10
  faction, 14 item, 11 creature). Pilot scoped to one chapter via `chapter-N` tag.
- **Write API:** `POST /world/{w}/{person|political|organization|item|creature}`
  with `Create*Request`. Minimum viable body: `{name, altNames:[], description}`.
  No type/classifier id required to create. Returns the new entity `id`.
- **Result:** 42 entities created, **0 errors** (people 18→45, politicals 15→27,
  items 2→5). Test-wrote 1, verified by GET, then bulk.

### Reverse-direction gotchas

15. **Writes need almost nothing.** `name` + `altNames` are the only hard
    requirements; `description` (HTML) is optional. classifier/type Attribute
    edges can be added later.
16. **md → HTML needs cleanup** (mirror of the import's HTML→md): drop the leading
    `# Title` (duplicates the entity name), convert `[[Under_scored]]` links to
    plain spaced text, turn intra-paragraph `\n` into `<br>`, strip dataview/embeds
    and the `## GM Notes`/`## Appearances`/`## Source References` housekeeping
    sections. Raw markdown in `description` renders as literal text in mobRPG.
17. **Idempotency via name-normalisation.** Re-running the push re-fetches mobRPG
    names and skips matches, so it won't duplicate. The `Ælfric`↔`Aelfric`
    ligature breaks naive normalisation — strip/transliterate `æ`→`ae` (and drop
    `ae`) or you'll re-create existing entities.
18. **Lossy as predicted.** All CoC structured frontmatter (occupation, age,
    skills, secrets) collapses into the one HTML `description`. mobRPG keeps no
    age/gender/occupation fields, so that data is only human-readable prose there.
19. **Relationships are a separate pass.** Entities must exist (and have IDs)
    before their relationship-events can be created — hence entities-first.

## ⚠️ The biggest lesson: canon policy collides with reality

The GM declared "mobRPG is canon over the vault" **before** we knew the overlap
profile. On inspection, the 8 overlapping entities were *far richer in the vault*
— they held the campaign's core plot (the `[[Halcyon]]` conspiracy, `[[Aldous
Renn]]` leadership). A literal "canon wins" would have **destroyed plot-critical
hand-authored content** with two-sentence mobRPG stubs.

**Integration rule:** never blind-overwrite on a canon flag. Always compute the
overlap and *surface richness/loss* before merging. The safe default for
overlaps is **append-and-flag**, with field-level conflicts (e.g. station name)
resolved by the canon policy but prose preserved. Casts were near-disjoint, so
the import was ~92% additive (safe) and only ~8% needed judgement.

### Open decisions before writing to the live vault (resolved above)

- **Geography overlap:** Thides System + Thides II–VI exist in both the vault
  (`Locations/`) and mobRPG (`landfeature`). mobRPG-canon ⇒ overwrite — but that
  would discard any vault-only detail. Recommend **merge** (mobRPG body wins,
  keep vault `## GM Notes`) rather than blind overwrite, even under canon policy.
- **Vault version** `1.6.0` < plugin `1.7.x` — skill calls for migration first.
- **Write strategy:** additive for the ~98 mobRPG-only entities (safe); explicit
  per-file merge for the handful of overlaps.

---

# 📍 STATUS & OPEN DECISIONS — resume here

Last updated end of the 2026-06-28 session. Read this first when picking the
mobRPG integration back up.

## What exists (both directions proven)

The full bidirectional pipeline is built and demonstrated end-to-end, with
reusable scripts in `docs/prototypes/mobrpg/`:

| Direction | Status | Scripts |
|---|---|---|
| **mobRPG → vault** (import) | ✅ Done for the **Space → Dead End** vault: 96 entities imported, 8 overlaps merged, 24 orphans auto-linked, QA'd | `etl_extract.py`, `vault_write.py`, `merge_overlaps.py`, `orphan_link.py` |
| **Keep-up-to-date** (edit detection) | ✅ Added 2026-07-04, crosswalk seeded (104 entities) from the original import baseline | `detect_updates.py` (`bootstrap` + `sync` modes) |
| **vault → mobRPG** (push) | ✅ Done for **Canticle Chapter 1 → Regency Cthulhu**: 42 entities + types + 80 relationship-events | `push_to_mobrpg.py`, `assign_types.py`, `push_relationships.py` |
| Auth / API client | ✅ `smoketest.py` (durable app-token bearer auth) | |
| Schema + ontology | ✅ `schema-map.md`, `gm-apprentice-ontology-export.md/.json` | |
| Crosswalk | ✅ `canticle-regency-crosswalk.json` (42 entities + 80 rels, vault↔mobRPG IDs) | |

## Live state right now

- **Regency Cthulhu world (mobRPG):** Chapter 1 of Canticle is loaded — events
  17→97, people 18→45, locations 15→27, political-types 12→23, items 2→5.
- **Canticle vault:** frontmatter **restored to hand-authored state** — the
  crosswalk was pulled OUT of frontmatter (per GM) into the sidecar file. The
  vault is **not under version control** (GM handling backups).
- **Space world (mobRPG):** read-only to us; Dead End vault holds the import +
  `_QA/QA_post-import_2026-06-28.md`.
- **Keep-up-to-date crosswalk:** seeded 2026-07-04 at
  `space_game/_meta/mobrpg-crosswalk.json` — 104 entities, all matched to an
  existing vault file (0 skipped). Baseline is `space_extract.json` (the actual
  2026-06-28 import state), not today. See "Keeping Dead End up to date" below.

## Keeping Dead End up to date (edit detection, added 2026-07-04)

Closes the limitation noted throughout this log: the original pipeline only
ever notices *new* mobRPG entities (no-clobber copy skips anything that
already has a vault file), so an edit to an already-imported entity was
silently invisible forever. `detect_updates.py` adds a persisted crosswalk
(mobRPG id → vault path + content hash + a full canonical snapshot) and two
modes:

- **`bootstrap`** — seeds the crosswalk from a known-good baseline extract
  (used `space_extract.json`, the actual 2026-06-28 import snapshot, so the
  baseline is real history, not an arbitrary "today"). Read-only on the vault;
  only writes the crosswalk file. **One-time** — re-running it against a
  fresh pull would discard that real baseline in favor of whatever mobRPG says
  right now, defeating the point.
- **`sync`** — compares a freshly-pulled extract against the crosswalk.
  Content is compared on a sorted/canonical form (relationships and
  classifiers order-independent) so API response reordering never reads as a
  false change. Three outcomes per entity: unchanged (no-op), changed on an
  already-imported entity (append a `## mobRPG Update Available (<date>)`
  section before `## GM Notes` — never touches existing prose, and a
  still-pending section from an earlier sync is replaced wholesale rather than
  stacked), or new in mobRPG (reported, not acted on — run the normal import
  path, then re-run `bootstrap` so it joins the crosswalk). A crosswalk entry
  whose vault file has been moved/deleted since the last sync is reported
  separately rather than silently miscounted as unchanged.
- **What "changed" means:** name, description text, alt names, classifiers, or
  relationships (added/removed by predicate+target). The change summary is a
  short bullet list (e.g. "description text changed; +1 relationship
  (trade_route_to Corwin System)"), not a full text diff — matches the level
  of detail `merge_overlaps.py` already surfaces for the original overlaps.
- **Known limitation:** a rename is detected and flagged, but the vault file
  itself is never renamed automatically — the crosswalk's stored `vault_path`
  stays the target of future updates, matching gotcha #14 (orphan/vault state
  is judged from the vault, never re-derived from the source). If the GM
  renames the vault file to match, they'd need to also hand-edit the
  crosswalk's `vault_path` for that entity, or re-run `bootstrap`.
- **Tested** against a synthetic scenario (description edit, relationship
  add/remove, rename, brand-new entity, deleted vault file) before being run
  for real — see the crosswalk's 104-entity seed above.

## How mobRPG actually works (hard-won, confirmed against Tim's backend `~/PROJECTS/game`)

- **Every element create requires a non-null `description`** — the `elements`
  table has a NOT NULL constraint the entity mapping doesn't enforce. Omitting it
  → HTTP 500 (`null value in column "description"`). This was the type-creation
  500. *(Tim is fixing the constraint side.)*
- **Types are `Attribute` edges, not fields.** To type an entity: `POST
  /world/{w}/{political/type|organization/type|person/race|person/race/sex}/{typeId}/relation`
  with `{targetId: entityId, type: "Attribute"}` (source=type → target=entity).
  New types are creatable via `POST /world/{w}/political/type` (with description!).
- **Relationships are reified `event`s** — `POST /event` (eventType from the
  7-enum) + two `Link` edges via `POST /event/{id}/relation {targetId, type:Link}`.
  Predicate→eventType from the ontology JSON; precise predicate preserved in
  `event.title`; tone/strength/prose in `event.description`.
- **Relation enum:** `Attribute, Link, Parent, Child, Spouse`. **eventType enum:**
  `Employ, Membership, Leadership, Reign, War, Score, Generic`.

## Crosswalk decision (settled)

- Store the vault↔mobRPG ID mapping in a **sidecar file**, NOT inline in vault
  frontmatter (GM wants frontmatter to stay hand-authored). Current sidecar:
  `canticle-regency-crosswalk.json`.
- **TODO when resuming:** rewire `push_relationships.py` (and add entity
  `mobrpg_id` capture) to read/write the **sidecar**, not frontmatter. The
  writeback-to-frontmatter code should be removed.

## Open decisions before loading more

1. **Crosswalk home** — sidecar confirmed; decide whether it eventually lives in
   the vault's `_meta/mobrpg-crosswalk.json` or stays with the tooling.
2. **Sync direction & authority** — stay one-way (vault→mobRPG), or go two-way
   using the crosswalk for update/delete (the IDs make this possible now).
3. **Scope** — all entity types + relationships, or a curated subset. Remaining
   Canticle gap ≈ 250 entities across chapters 0, 0.5, 2, 3, 4 (0.1 already in
   mobRPG). Chapter 2 (Lyon) dry-run = 60 entities, ready to go.
4. **Items** — `itemType` is a data field (ItemAttributes), set via
   `UpdateItemRequest`, not an Attribute edge — deferred, not yet implemented.
5. **Relationship targets in other chapters** — 11 Chapter-1 relationships were
   skipped because their targets aren't in mobRPG yet; a re-run after loading
   more chapters will pick them up (they have no crosswalk ID, so they retry).

## Side findings (for Tim — flagged separately, already tracked in his repo)

- **Committed prod secrets:** DB password, AWS key/secret, and the **JWT signing
  secret** are in `api/src/main/resources/application.properties` on GitHub.
  Rotate + externalize. (Note drafted.)
- **Clean build of `master` doesn't boot** with the pinned `hibernate-core
  7.4.0` — the `StringListConverter` UserType is mis-cast (`CustomType` →
  `BasicPluralType`) in Hibernate 7.4's optional-table-update/merge path, failing
  SessionFactory init. Reproduced on a clean build (JDK 25 + Postgres,
  `./gradlew clean bootRun`). **Disputed by Tim** (works for him — likely an
  incremental/cached build or a pre-bump deployed artifact).
  - **Do NOT just swap to `@JdbcTypeCode(SqlTypes.ARRAY)`.** That was a local
    workaround and is the *wrong* fix: `StringListConverter` deliberately
    overrides `equals()` with **order-independent (set) semantics** and
    `isMutable=false`, so reordering `alt_names`/Dashboard id-lists doesn't dirty
    the entity. The ARRAY swap reverts that to order-sensitive list equality
    (spurious `UPDATE`s). The right fix must preserve the set-equality intent (or
    model the fields as `Set<String>`) — **a question for Tim, not a blind PR.**
  - **Status:** workaround reverted; Tim's working tree is pristine; no PR opened.

## Local backend repro environment — TORN DOWN

- Stopped & removed (api on :8080, pgEdge container `mobrpg-local-pg`, temp
  config/logs). **Persistent leftovers** (harmless, remove if desired): JDK 25
  (`brew uninstall openjdk@25`) and `common`/`auth` jars in `~/.m2`.

---

## 2026-07-10 — dev/prod environment switch + suggestion support

Tim's backend added a **suggestions** feature (`feature/world-suggestions`
branch): a review-queue layer in front of direct element creates —
`POST /world/{worldId}/suggestion` accepts a batch of proposed operations
(currently `CreateElement`) that land `Pending` for the world owner to
accept/dismiss, rather than writing live elements immediately. Crucially it
**only requires Read** on the world, not `ReadWriteDelete` — a Read-only
collaborator can propose content. There's a locally-running dev stack
(api on `:8080`, Postgres on `:55432`) with two seeded users: `gm@localhost`
(owns both worlds) and `suggester@localhost` (Read-only on both) — built to
exercise exactly this.

**Environment switch.** `smoketest.py` (the shared config/transport module
every script imports) no longer hardcodes prod. `MOBRPG_ENV=dev|prod`
(default `prod`, so nothing changes for existing prod usage that sets no env
var) selects BASE/CLIENT_ID/REDIRECT_URI; `MOBRPG_BASE` /
`MOBRPG_CLIENT_ID` / `MOBRPG_REDIRECT_URI` override individual fields on top.
The resolved target is printed loudly on import. A new
`api.assert_writes_allowed()` guard refuses any mutating call against `prod`
unless `MOBRPG_ALLOW_PROD_WRITES=1` is *also* set, so a script can never write
to production just by forgetting to set `MOBRPG_ENV`. Verified:
`MOBRPG_ENV=dev MOBRPG_EMAIL=suggester@localhost MOBRPG_PASSWORD=local
python3 smoketest.py` authenticates and lists both dev worlds (`Local Test
World`, `Regency Cthulhu` — same worldId as prod's Canticle target,
`4b07d8dd-…`, loaded locally). `push_to_mobrpg.py` (the existing direct-create
path) now resolves auth via the same shared `api.get_access_token()` helper
(bearer or email/password) instead of only reading `MOBRPG_TOKEN` — so it
picks up `MOBRPG_ENV`/email-login for free — and gates `--execute` behind
`assert_writes_allowed()`.

**Suggestion support.** New sibling script `push_suggestions.py` pushes vault
entities as suggestions instead of direct creates — same vault parsing
(`push_to_mobrpg.parse`/`md_to_html`/`display_name`, imported and reused, not
duplicated), different wire shape. Gotchas found reading the backend
(`~/PROJECTS/game`, read-only — never ran it):

- `SubmitSuggestionRequest.payload` is a `CreateElementPayload` whose
  `data : WorldElementData` field is `@Valid @NotNull` — **it validates at
  submit time**, unlike the direct-create endpoints which accept a bare
  `{name, altNames, description}`. Every vault "kind" needs a minimal data
  object satisfying its own `@NotNull` fields (read straight from each
  `*Data.java`, not guessed):
  - `location` → `Political` — only `titles` is `@NotNull` (empty `Set` is
    fine) → `{"type":"Political","titles":[]}`.
  - `npc`/`pc` → `Person` — `languages` + `equipment` are `@NotNull` →
    `{"type":"Person","languages":[],"equipment":[]}`.
  - `faction`/`organization` → `Organization` — `titles` (`Set<EventTitle>`,
    `@Valid @NotNull`) → `{"type":"Organization","titles":[]}`.
  - `item` → `Item` — `attributes : ItemAttributes` is `@NotNull`, and
    `ItemAttributes` is itself polymorphic on `itemType` (`@JsonTypeInfo`,
    visible) with no documented default, so the discriminator must be
    supplied even though `weight`/`cost` default to `0` in the no-arg
    constructor → `{"type":"Item","attributes":{"itemType":"Generic"}}`.
  - `creature` → `Creature` — no `@NotNull` fields beyond the inherited
    `notes` map, which the no-arg constructor defaults to `{}` and Jackson
    leaves alone when absent from the JSON → `{"type":"Creature"}` is enough.
  - All five types extend `NoteableData`, whose only field (`notes`) is
    `@NotNull` but already defaulted by the constructor — never needs setting
    explicitly.
- `externalRef` is the idempotency key (`world_id, external_ref` unique
  index, scoped to live rows). Used `canticle:<vault-relative path, no
  extension>` (e.g. `canticle:Locations/Fourviere`) — stable across reruns,
  one-to-one with the source file.
- The endpoint is a genuine batch (`SubmitSuggestionsRequest.suggestions`,
  one `POST` for the whole set) — no need to loop one-request-per-entity like
  the direct-create path does.
- `SubmitSuggestionsResponse.resolvedRefs` is the only signal of which
  `CreateElement`s were swallowed as duplicates of an existing classifier
  (Type-like) element; harvested and printed but not otherwise acted on here.

**Proved against dev** (Postgres queried directly with `psql`, not through
the API, per the acceptance check): submitted 8 `Locations/*.md` files tagged
`chapter-2` (Lyon — not yet loaded into either dev or prod Regency Cthulhu,
so a clean landing) from `push_suggestions.py --kind location`, logged in as
`suggester@localhost`. `world_elements.suggestions` went `0 → 8`, every row
`operation=CreateElement`, `review_state=Pending`,
`created_uid=22222222-2222-2222-2222-222222222222` (the suggester's id).
Re-running the identical command returned the **same 8 ids** and the DB count
stayed at 8 — confirms idempotency-on-`externalRef` end to end, not just in
the backend's tests.

Only `location → Political` was exercised live (the guaranteed-clean minimal
data per the task's Locations-only scope). The `npc`/`faction`/`item`/
`creature` mappings above are exercised by code review against the backend's
`*Data.java` sources, not by a live submit — flagged here rather than
claimed as tested.
