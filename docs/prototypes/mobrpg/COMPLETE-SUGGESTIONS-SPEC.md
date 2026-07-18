# Complete Suggestions — prototype spec

**Status:** spec (2026-07-17). Codifies what the prototype must do to send *complete* suggestions to
mobRPG — everything currently hand-derived to build compound batches by hand. Three pillars:
**(1) mapping-discoverable, (2) mapping-building, (3) vault-updating (persist determined mappings until
mobRPG returns an edited version).** Companion: `~/PROJECTS/Docs/mobrpg-gmapprentice/MAPPING-DESIGN.md`.

## Why

`mobrpg suggest` today emits **bare** `CreateElement`s — no classifier Types, no relationships. Every
such suggestion lands incomplete (Person with no Race/Sex/Profession, location with no type, org with
no type, creature with no type, and no relationships). See TESTING-OBSERVATIONS #4/#5/#7/#8/#9. A GM
can technically accept them, but they carry no structured data. The prototype must instead construct
the **full datatype graph** per entity and submit it as one compound batch.

---

## Pillar 1 — Mapping-discoverable (know what mobRPG requires + what already exists)

The tool must carry (or discover at runtime) the mobRPG data contract. All of this was verified against
`~/PROJECTS/game/api` and the live world; codify it, don't re-derive per run.

### 1a. Element taxonomy + minimal valid `data` per discriminator
`WorldElementData` is Jackson-polymorphic on `type`. The suggestible element kinds and their
**minimal valid `data`** (fields with validation constraints — omitting them 400s the whole batch):

| Discriminator | Minimal `data` | Notes |
|---|---|---|
| `Person` | `{"type":"Person","languages":[],"equipment":[]}` | both sets @NotNull |
| `Political` | `{"type":"Political","titles":[]}` | titles @NotNull |
| `PoliticalType` | `{"type":"PoliticalType","titles":[]}` | classifier for Political |
| `Organization` | `{"type":"Organization","titles":[]}` | |
| `OrganizationType` | `{"type":"OrganizationType","titles":[]}` | classifier for Organization |
| `Item` | `{"type":"Item","attributes":{"itemType":"Generic"}}` | attributes @NotNull @Valid |
| `Creature` | `{"type":"Creature"}` | no required fields |
| `CreatureType` | `{"type":"CreatureType"}` | classifier for Creature |
| `LandFeature` | `{"type":"LandFeature","landFeatureTypes":["<enum>"]}` | landFeatureTypes @NotNull, closed enum |
| `Race` | `{"type":"Race"}` | classifier for Person |
| `Profession` | `{"type":"Profession"}` | classifier for Person |
| `Sex` | `{"type":"Sex"}` | classifier for Person, race-scoped (see 1c) |
| `Event` | `{"type":"Event","eventType":"<enum>"}` | eventType @NotNull; reifies a relationship |

`notes` is base `@NotNull` but constructor-initialized to `{}` — omit it, never send `"notes":null`.

### 1b. Classifier model (Types are their own elements + an Attribute edge)
A classifier Type is a separate element joined to its subject by an **`Attribute`** relation where the
**classifier is the SOURCE and the subject is the TARGET**. Name-identity classifiers (dedupe by
`(world, discriminator, trim+lowercase name)`, live rows, oldest wins, altNames ignored):
`Race, Profession, Language, TermGroup, CreatureType, OrganizationType, PoliticalType`. On submit a
same-named classifier create is **swallowed** onto the existing element and its ref rewritten to the
real id (returned in `resolvedRefs`). ⇒ the tool should **discover existing Types first** (`mobrpg
catalog <world> <kind>`) and either reference the real id or let submit swallow.

### 1c. Sex is special (race-scoped)
`Sex` keys on `(normalized name, attached Race id)`. In a batch, a Sex is recognised/deduped only if
exactly **one real (non-in-batch) Race** is attached to it via an `Attribute` edge (Race = SOURCE, Sex
= TARGET). Verified live: attaching the real Human race id (`60a9f2fe-…`) let "Male" swallow onto the
existing Male. Two edges per person Sex: `Race→Sex` (scopes it) and `Sex→Person` (classifies).

### 1d. Relationship model (reified Event + two Link edges)
mobRPG has no predicate-bearing edge between two content elements. Relationships are **reified as an
`Event`** (`eventType` ∈ `Employ, Generic, Leadership, Membership, Reign, War, Score`) with two
**`Link`** edges: `Event→endpointA`, `Event→endpointB`. The vault predicate maps to `eventType` and is
also folded into the Event name/title/description (the only place the predicate survives). A plain
`Link` between two elements carries no predicate — use the reified Event to preserve meaning.

### 1e. Location split
A vault `location` is **not** always Political. Route to **Political + PoliticalType** (built/governed)
or **LandFeature + LandFeatureSubType** (natural; closed enum — Land 39 / Water 30 / Space 11). See
MAPPING-DESIGN.md §2 for the enum and routing.

### 1f. Idempotency + safety
`externalRef` (`<namespace>:<vault-relative path w/o .md>`) makes submit idempotent per world. Batch
submit is **all-or-nothing** on validation — one bad `data` 400s the whole batch. Batch cap 100.

### Discovery surface (already in the CLI)
`mobrpg catalog <world> <kind>` (political/type, organization/type, creature/type, person/race,
person/profession, landfeature, …) lists what exists so the builder reuses/dedupes rather than minting
duplicates. `mobrpg suggestions <world> --state … --correlate` reads the review queue back.

---

## Pillar 2 — Mapping-building (per-vault map: vault field → mobRPG datatype)

A per-vault map (home: vault `_meta/mobrpg-map.json`) drives construction. It encodes every derivation
used to hand-build the compound batches:

| Vault source | → mobRPG construct |
|---|---|
| top-level `type` (npc/pc/faction/item/creature/location) | element kind (person/org/item/creature/political\|landfeature) |
| `location_type` (first token, normalized) | Political **PoliticalType** name, OR LandFeature **subtype** (closed enum) — routing table |
| `occupation` (first token) | **Profession** classifier |
| `gender` | **Sex** classifier (race-scoped; needs a Race) |
| (implicit / `race` field) | **Race** classifier (default "Human" for period-Cthulhu humans) |
| `faction_type` | **OrganizationType** classifier |
| `creature_type` | **CreatureType** classifier |
| `relationships[].type` (predicate) | reified **Event** `eventType` + Link edges (predicate→eventType table) |
| `aliases` | `altNames` |
| body markdown | `description` **via a real GFM→HTML converter** (see fidelity note) |

Predicate→eventType table (extend from `push_relationships.py` + vault `_meta/relationship-types.md`):
`member_of/serves→Membership, leads/led_by/directed_by→Leadership, employs→Employ, owns/reign→Reign,
enemy_of→War, participated_in→Score, else→Generic`.

**Fidelity note (blocking):** the current `md_to_html` does NOT convert tables or lists (TESTING-
OBSERVATIONS #2 — tested). Replace it with a real GFM→HTML converter (tables/lists/links) and a
matching HTML→md on pull, or rich content is lost on the way in.

### The build pipeline (what `suggest` becomes)
For each vault entity: parse → apply map → **discover** existing Types (catalog) → assemble a compound
`SubmitSuggestionsRequest`:
1. classifier Type creates (or real ids if they exist) — Race/Sex/Profession/Org/Creature/PoliticalType
2. the element create (with minimal valid `data` from Pillar 1a + HTML description + altNames + externalRef)
3. Attribute edges (classifier SOURCE → subject TARGET); Sex also Race→Sex
4. per relationship: an Event create (eventType from predicate) + two Link edges (resolve endpoints to
   real ids if they exist, else in-batch `suggestion:<ref>`; skip/queue if an endpoint is neither)
Submit via `mobrpg submit-batch` (transport already exists).

---

## Pillar 3 — Vault-updating (persist determined mappings until mobRPG edits them back)

Close the loop (TESTING-OBSERVATIONS #10). The vault is the durable memory of every mapping we
*determined*, so we never re-derive — and the GM's mobRPG edits flow back and win.

### 3a. Write determined mappings forward
When the tool derives a value the vault didn't explicitly hold (Profession from `occupation`,
PoliticalType from `location_type`, Race/Sex, the reified event's eventType, the LandFeatureSubType),
**write it back** into the vault — frontmatter (e.g. `mobrpg_profession: Priest`, `mobrpg_element_type:
Political`, `mobrpg_political_type: Hospital`) and/or the crosswalk. Also write `externalRef ↔ mobRPG
element id` once known.

### 3b. Crosswalk schema (extend `canticle-regency-crosswalk.json`)
Per entity: `externalRef`, `mobrpg_id`, the **determined** classifiers + relationships, a
`content_hash`, and a **review-state** (`pending | accepted | dismissed | edited`) with the GM's final
values when known.

### 3c. Authority rule — "until we get an edited version back from mobRPG"
The vault's **determined** mapping is authoritative **until mobRPG returns an edited version**; then
mobRPG wins and the vault is updated to match:
- **Accepted unchanged** → confirm the determined mapping in the vault.
- **Accepted after GM edit** (rename/retype/reclassify) → pull the accepted element's actual fields +
  classifier edges (`mobrpg suggestions --state Accepted --correlate --fetch-elements`) and **overwrite**
  the vault's determined values with the GM's.
- **Dismissed** → record the rejection (+ reviewNote) in the vault so it isn't re-proposed (addresses
  the "dismiss keeps externalRef → can't resubmit" tension). See TESTING-OBSERVATIONS #11/#12.

This makes pushes progressively cleaner and idempotent **by content**, not just by externalRef.

---

## Where this should live (discover vs decide)

- **Deterministic mechanics → CLI** (done): `catalog` (discover), `submit-batch` (transport),
  `suggestions --correlate` (pull-back), `review`. These are stable primitives.
- **Judgment → a mobRPG skill** (build): the routing decisions (Political vs LandFeature, which
  Profession/Type, which eventType, ambiguous monuments), map scaffolding + curation, and the
  vault-writeback/authority reconciliation. LLM-driven because the mappings are open-vocabulary and
  need per-vault judgment. This is the "separate mobrpg skill" Ant asked about — **yes, build it**, on
  top of the CLI primitives.

## Implementation order
1. Real GFM↔HTML converter (unblocks fidelity) — replace `md_to_html` + pull's `html_to_md`.
2. `_meta/mobrpg-map.json` schema + a `map-locations`/`map-build` scaffolder (discover + propose).
3. Teach `suggest` (or a new `suggest-complete`) to build compound batches from the map (Pillars 1–2).
4. Vault-writeback + crosswalk review-state + authority reconciliation (Pillar 3).
5. The mobRPG skill wrapping 2–4 with judgment + curation.
