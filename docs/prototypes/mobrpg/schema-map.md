> **Historical.** The crosswalk/sidecar approach described below is retired. Per-note `mobrpg:` frontmatter nodes are the sole id source; unlinked vaults are established with `mobrpg adopt` (live name-match). This document is kept for provenance.

# Schema comparison map: gm-apprentice ↔ mobRPG

How the gm-apprentice vault schema (`skills/shared/entity-schema.md`) maps onto
mobRPG's API entity model (OpenAPI `https://www.mobrpg.com/docs/api-docs`).
Foundation for any future sync. See `FINDINGS.md` for how this was obtained.

## TL;DR — two opposite philosophies

| | gm-apprentice | mobRPG |
|---|---|---|
| Shape | **Rich / denormalized** — many typed attributes per entity type | **Lean / normalized** — every entity is the same thin shape |
| Entity body | YAML frontmatter (typed) + markdown prose + protected GM/Notes sections | One free-text `description` + attached `files` |
| Identity | Filename + `[[wiki-link]]` (names drift) | Stable `id` (UUID) |
| Relationships | Embedded in frontmatter: `target, type, tone, strength, bidirectional, description` | Flat edge list: `{sourceId, targetId, type}` — no tone/strength/description |
| Time | String dates + session counters (`lastUpdated`, `asOfSession`) | Structured `startTimestamp`/`endTimestamp` numbers; first-class `calendar` |
| Narrative layer | chapter → session → scene → plan → clue → thread | **None** (campaign + campaignNote are the only structure) |
| Canon state | `source_confidence` enum (DRAFT/AUTHORITATIVE/SUPERSEDED) | `statusId` integer (enum meaning not documented) |

**The core tension:** gm-apprentice carries meaning in *structure*; mobRPG carries
it in *free text + a relationship graph*. Vault→mobRPG flattens rich attributes
into `description`; mobRPG→vault must *parse* `description` back into fields.

## mobRPG's universal entity shape

Every world element (`person`, `event`, `political`, `culture`, `organization`,
`item`, `creature`, `race`, `campaign`, `campaignNote`, `landFeature`, …)
returns exactly:

```
id, statusId, lastModifiedById, lastModified, type, name, description,
altNames[], files[], relations[], notes[]
```

**`notes[]` is the GM-only channel.** Each element is
`{note: "<html>", hidden: bool, id, lastModified, lastModifiedById}`. The `hidden`
boolean is the visibility switch: **`hidden=true` = Keeper-only, `hidden=false` =
player-safe.** The import splits these into `notes_public` (→ body `## Notes`
section) and `notes_gm` (→ `> [!info] Keeper Only` callout under `## GM Notes`).
**But the API only returns `hidden=true` notes to the world *owner*** — a non-owner
token (like ours on Tim's Space world) receives them stripped, so `notes_gm` is
always empty on that pull. See integration-log.md gotcha #8.

Type-specific fields appear only on the **Create/Update request** bodies:

| mobRPG type | Extra writable fields |
|---|---|
| person | `playerId`, `languages[]` (languageId, type, mastery), `equipment[]`, `lives[]` (DateRange) |
| event | `eventType`, `startTimestamp`, `endTimestamp`, `title` |
| political | `titles[]` (EventTitle), `spans[]` (DateRange) |
| item | `ItemAttributes` (weight, cost, itemType, itemTemplateId) + `GurpsItemAttributes` |
| calendar | `months[]`, `weekdays[]`, `holidays[]` |
| (relation) | separate edge object: `sourceId, targetId, type` |

Everything else (an NPC's occupation, a faction's goals, a clue's reliability)
has **no field** — it lives in `description`.

## Entity type mapping

| gm-apprentice type | mobRPG type | Fidelity | Notes |
|---|---|---|---|
| `npc` | `person` | ⚠️ lossy | All attrs (occupation/age/skills/secrets/motivations) → `description` |
| `pc` | `person` + `playerId` | ⚠️ lossy | `playerId` links a mobRPG user; vault PC body (stat sheet, story) → `description`/`files` |
| `location` | `political` | ⚠️ semantic | mobRPG models *places* as political units (Bath, Hartwell House, The Fox & Hound) |
| `location` (natural) | `landFeature` | ⚠️ | Geography/terrain features |
| `faction` | `organization` (+ `organizationType`) | ⚠️ lossy | tier/goals/clock/planProgress → `description` |
| `organization` | `organization` (+ `organizationType`) | ⚠️ lossy | |
| `item` (+ subtypes) | `item` (+ `ItemAttributes`) | ◐ partial | weight/cost/itemType map; properties/origin → `description`. GURPS attrs supported natively |
| `creature` (+ subtypes) | `creature` (+ `creatureType`) | ⚠️ lossy | stats/abilities/sanityLoss → `description` |
| `event` (story beat) + frontmatter `relationships` + timeline | `event` | ❗ **one ↔ three** | mobRPG `event` is a first-class **join entity** that unifies what the vault splits across three constructs: a relationship join ("X, Member of Order"), a story beat, *and* the timeline (start/end timestamps) |
| `document` (+ subtypes) | `writing` | ◐ partial | mobRPG `writing` for in-world texts; or attach as `files` |
| `heritage` | `race` | ✅ good | lifespan/traits → `description`; structurally aligned |
| `campaign_overview` | `campaign` | ◐ partial | campaign metadata; many vault fields → `description` |
| (session recap / notes) | `campaignNote` | ◐ partial | Closest mobRPG home for GM notes |
| `clue` | **— none —** | ❌ | No clue concept; would be `campaignNote` or `description` text |
| `plan` / `thread` | **— none —** | ❌ | No planning/thread layer |
| `chapter` / `session` / `scene` | **— none —** | ❌ | No narrative-structure layer at all |
| `world_domain` / `world_flags` | `world.settings` / `world.options` | ◐ | World-level config |
| (no vault equivalent) | `culture` | — | mobRPG-only: Bon-Ton, Working Class |
| (no vault equivalent) | `currency`, `language`, `profession`, `calendar`, `term`/glossary, `color`, `icon` | — | mobRPG-only structured reference types |
| `_attachments` / `portrait` | `files[]` + `generated/images` | ✅ | mobRPG can also *generate* images/text |

## Universal field mapping

| gm-apprentice | mobRPG | Notes |
|---|---|---|
| filename / entity name | `name` | Vault identity is the filename; mobRPG is the UUID |
| `aliases` | `altNames[]` | Direct match ✅ |
| `type` | `type` | Different vocabularies; needs a lookup table |
| `source_confidence` (DRAFT/AUTHORITATIVE/SUPERSEDED/STUB) | `statusId` (int) | Enum mapping unknown — **needs probing** |
| `lastUpdated`, `asOfSession`, `createdSession` | `lastModified` (timestamp) | Vault tracks *session*; mobRPG tracks *wall-clock*. No session concept in mobRPG |
| `source` (play/prep/backstory) | — | No equivalent |
| — (vault has no UUID) | `id` (UUID) | **The crosswalk anchor** — store mobRPG `id` in vault frontmatter |
| `tags` | — | No general tag field (icons/terms are closest) |
| `source_document` | `files[]` | |
| `campaign` | world scope + `campaign` entity | mobRPG scopes by `world`; campaign is a separate object |
| body markdown + `gmNotes` | `description` | Everything narrative collapses here |
| `portrait` / `_attachments/` | `files[]`, `generated/images` | |

## Relationship model — the hardest mapping (CORRECTED after deep probe)

The raw `relations[]` edge `type` is **not** the predicate — it's only one of two
generic tags:

- **`Attribute`** — *classification*. Links an entity to a reference/type entity:
  a person → its `race` + `sex`; a place → its `political/type` (Residence,
  Estate, Inn/Tavern…); an org → its `organization/type` (Investigator Society,
  Cult). This is how mobRPG stores "what kind of thing is this."
- **`Link`** — *event endpoint*. Appears on `event`s, joining the event to the
  two entities it relates.

**The real relationship is a reified `event`.** A relationship between A and B is
an event with a typed predicate (`eventType`) + two `Link` edges + optional
time bounds. Example:

```
Event { name: "Lord Percival…, Leader of Order of St. Ælfric",
        eventType: "Leadership", startTimestamp: null }
   --Link--> Lord Percival Harcourt [person]
   --Link--> Order of St. Ælfric   [organization]
```

**`eventType` is a fixed 7-value enum** — the *entire* relationship vocabulary:

| mobRPG `eventType` | Meaning | Observed use |
|---|---|---|
| `Employ` | employment | person → workplace (Hawthorne Grange, Hartwell House) |
| `Membership` | belongs to | person → organization (Order of St. Ælfric) |
| `Leadership` | leads | person → organization |
| `Reign` | rules / owns | person → place ("Owner of The Fox & Hound") |
| `War` | conflict | (none in this world) |
| `Score` | a job / heist | (none in this world) |
| `Generic` | catch-all | fallback for everything else |

### gm-apprentice predicate → mobRPG eventType

gm-apprentice has **~100 named predicates** in 17 categories. They funnel into 7:

| gm-apprentice types | mobRPG eventType |
|---|---|
| `member_of`, `founded`, `defected_from`, `infiltrates` | `Membership` |
| `leads`, `commands` | `Leadership` |
| `employs`, `serves`, `vassal_of` | `Employ` |
| `rules`, `owns`, `headquartered_at` (owner sense) | `Reign` |
| `enemy_of`, `at_war_with`, `conspires_against` | `War` |
| (FitD heist / job framing) | `Score` |
| **everything else** — kinship (parent_of, spouse_of), social (friend_of, rival_of, knows, mentors), spatial (located_at, part_of, borders), possession (wields, seeks), knowledge (studies, conceals), supernatural (worships, bound_to, cursed_by), romance (courts, blackmails)… | **`Generic`** (predicate name must go into event `name`/`title`/`description`) |

| Axis | gm-apprentice | mobRPG |
|---|---|---|
| Predicate vocabulary | ~100 named types + inverses | **7 fixed** (5 specific + War/Score + Generic) |
| Qualitative weight | `tone`, `strength` | ❌ none |
| Edge prose | `description` | event `name`/`title`/`description` |
| Temporal validity | ❌ none | ✅ event `startTimestamp`/`endTimestamp` (all null here) |
| Classification | `type` field + subtype | `Attribute` edge → reference entity |
| Direction | single-stored, implied inverse | explicit via two `Link` edges |

### Tim's design intent: the event IS an entity (the join is first-class)

Per Tim: **events are entities** — the event that creates a relationship is
essentially a **join entity** between the two participants, deliberately so it
can (a) carry extra detail *on the edge itself* and (b) drive a **timeline**.

This corrects the earlier "edge data is lost" pessimism. Because the join is a
full entity, it owns: `name`, `title`, `description` (rich HTML), `altNames`,
`eventType`, `startTimestamp`/`endTimestamp`, `files`, and its own `relations`.
So the *narrative of a relationship* and its *temporal validity* have a real
home — only the vault's scalar `tone`/`strength` lack a typed slot (they'd live
in the join's `description`).

```
gm-apprentice (edge buried in a node's frontmatter):
  Percival.relationships: [{ target: Order, type: leads, tone: ..., strength: ... }]

mobRPG (edge promoted to its own queryable, time-bounded entity):
  Event{ name: "…Leader of Order of St. Ælfric", eventType: Leadership,
         startTimestamp, endTimestamp, description: <html> }
     --Link→ Percival   --Link→ Order
```

**The join's `title` carries the specific role.** Per Tim: a custom `title` can
be assigned to the event to describe the edge precisely — e.g. an `Employ` event
linking an NPC → a station, with `title: "Station Manager"`. So the broad
`eventType` is the bucket and `title` is the exact role. This is the structured
home for the vault's role annotations — `participants: "[[Entity]] (role)"` and
relationship `description: "Serves as lieutenant"` both map to `event.title`.
(In Regency Cthulhu `title` is still null — the role is baked into the
auto-generated event `name` instead; Tim's pointing at the structured path.)
Ranked/office titles can also be predefined on a place via `political.titles[]`
(`EventTitle { title, type, rank }`).

**Implication:** the join-as-entity is *more* expressive than the vault on two
axes (edge narrative + time) and on roles (`title`), and *less* on one (predicate
type: 7 enum values vs ~100). With `title` carrying the role, the predicate gap
shrinks: `eventType` gives the broad class, `title` the specific role, the
join's `description` the prose, and `start/endTimestamp` the validity window.
Only the vault's scalar `tone`/`strength` lack a typed slot (→ `description`).
The five specific eventTypes (Employ/Membership/Leadership/Reign/War) round-trip
cleanly; the rest fall back to `Generic` + a descriptive `title`.

## Classification (`Attribute` edges) → gm-apprentice fields

| mobRPG reference type | Values in Regency Cthulhu | gm-apprentice equivalent |
|---|---|---|
| `race` | (1: Human) | `heritage` entity / implicit |
| `sex` | male, female | `gender` field |
| `organization/type` | Investigator Society, Cult | `faction_type` / org subtype |
| `political/type` | District, Borough, Estate, Theatre, Inn/Tavern, Town, City, HeadQuarters, Members Club, Residence, Bookstore, Blacksmith | `location_type` |
| `culture` | Bon-Ton, Working Class | **no vault equivalent** (social class) |

## Other resolved details

- **`description` is rich HTML** (`<h2>`, `<strong>`, `<p>`…) from a WYSIWYG
  editor — the full narrative body *is* preserved, just as HTML not markdown.
  Vault↔mobRPG body sync = markdown↔HTML conversion (clean, not lossy).
- **`statusId`** is uniformly `1` in this world (= active). Other values exist
  but weren't observed; the DRAFT/AUTHORITATIVE/SUPERSEDED mapping stays unproven.
- **Languages** are first-class: `PersonLanguage { languageId, type:
  Spoken|Literate|Both, mastery: None|Semi|Proficient|Native }` — richer than the
  vault, which has no structured language model.
- **`person.lives` / `political.spans`** are `DateRange`s (birth–death, existence
  period) — a temporal model the vault lacks.
- **`EventTitle`** carries a `rank` (e.g. "8th Earl of Wrexham") — peerage/titles
  are structured, not just prose.

## Temporal model: how event timestamps encode dates

Per Tim: event `startTimestamp`/`endTimestamp` are **the number of hours since
year 0 of the world's default calendar** — *not* Unix epoch. The default
calendar lives on the world record: `GET /world/{id}` → `calendar`
(`CalendarResponse`), defining:

- `months[]` — `{ order, name, days }` (the year's length = Σ days)
- `weekdays[]` — `{ order, name, hours }` (the day's length in hours)
- `holidays[]` — `{ name, month, day }`

**Regency Cthulhu's default calendar** ("Gregorgian Calendar",
id `538c46cf-…`): 12 months totalling **365 days** (Feb fixed at 28 — *no leap
years*), 7 weekdays of **24 hours** each. So 1 year = 8760 hours here.

**Conversion (vault date → mobRPG timestamp):**

```
daysPerYear  = Σ months[].days                     # 365 for this calendar
hoursPerDay  = weekdays[].hours                     # 24 (uniform)
dayOfYear(m,d) = Σ days of months before m  +  (d - 1)
absoluteDays(y,m,d) = y * daysPerYear + dayOfYear(m,d)
timestampHours = absoluteDays * hoursPerDay + hourOfDay
```

Example — **1 July 1813** (Eleanor Finch's era): days before July =
31+28+31+30+31+30 = 181 → absoluteDays = 1813·365 + 181 = 661 926 →
`timestamp = 661 926 · 24 = 15 886 224` hours.

**Integration implications:**
- You **cannot** assume Gregorian/Unix — every world defines its own calendar, so
  any date conversion must first load `world.calendar` and compute from its month
  lengths and day-hours. (This Regency world happens to be near-Gregorian but
  leap-year-free, so it drifts from real-world dates over centuries.)
- The vault stores dates as **free strings** (`in_game_date: "Summer 1813"`,
  `setting_year`) — fuzzy and sometimes non-numeric. Exporting to a precise
  hour-count requires disambiguating ("Summer" → a concrete day) before
  conversion; importing back can format the hour-count into the calendar's
  month/day names.
- This calendar is also the natural backbone for the **campaign timeline** the
  vault lacks: once events carry real timestamps, they sort and range-query.

## What each side uniquely has

**Only in gm-apprentice:** clues (+ per-PC discovery state), threads,
plans, the chapter/session/scene narrative spine, session temporal model
(`asOfSession`), canon-confidence workflow, rich per-type attribute tables,
relationship tone/strength, protected GM/Notes sections, publish config.

**Only in mobRPG:** stable UUIDs, structured custom **calendar**
(months/weekdays/holidays), **culture**/**currency**/**language**/**profession**
reference types, glossary **terms**, temporal relationship **events**, native
**AI image/text generation**, a **map** layer (Mapbox), and a hosted multi-user
**shareable** world with permissions/invites.

## Implications for integration

1. **Match on a UUID crosswalk, not names.** Names drift and collide (we already
   found `Edwin Fairchild` in mobRPG but not the vault). Store mobRPG `id` in
   vault frontmatter (e.g. `mobrpg_id:`) the first time an entity is matched.
2. **`description` is the lossy carrier.** Vault→mobRPG must serialize rich
   attributes into `description` (or accept loss). mobRPG→vault must parse
   `description` into fields, or keep it as the entity body.
3. **mobRPG `event` is a join entity covering three vault constructs.** It is
   *both* a reified relationship (from frontmatter `relationships`) *and* a story
   beat (from `Events/`) *and* the timeline — distinguished by `eventType` +
   whether timestamps are set. A sync must decide which vault construct each
   mobRPG event came from (relationship join vs `Events/` beat) rather than
   assuming `event`↔`Events/` 1:1. The join-as-entity is also the natural place
   to **build a campaign timeline** the vault currently lacks.
4. **Direction shapes the loss profile.** Vault→mobRPG = enrich Tim's tool with a
   fuller world but flatten structure. mobRPG→vault = gain UUIDs, calendar, and
   the relation graph but must reconstitute prose. Two-way needs the crosswalk +
   a conflict policy (last-writer-wins by `lastModified` vs `asOfSession`).
5. **The predicate gap is the headline risk.** ~95% of vault relationship types
   have no mobRPG eventType and become `Generic`. A vault→mobRPG exporter should
   write the predicate into the event `name`/`title` so meaning survives; a
   mobRPG→vault importer must parse it back out.

## Resolved by deep probe (2026-06-28)

- ✅ `relation.type` = `Attribute` (classification) | `Link` (event endpoint) — not predicates.
- ✅ Relationships are reified `event`s; `eventType` enum = **Employ, Generic, Leadership, Membership, Reign, War, Score** (7 only).
- ✅ Classifiers: `race`, `sex`, `organization/type`, `political/type`, `culture`.
- ✅ `description` = rich HTML; `statusId` = 1 (active) throughout this world.
- ✅ Languages, `lives`/`spans` DateRanges, and `EventTitle.rank` are structured.

## Vault entity → suggestion payload (added 2026-07-10)

`push_suggestions.py` targets `POST /world/{worldId}/suggestion`
(`SubmitSuggestionsRequest`) instead of direct element creates. The
`name`/`description`/`altNames` mapping is identical to the direct-create
path (see above); what's new is `payload.data`, a `@Valid @NotNull`
`WorldElementData` that's actually enforced at submit time, so the vault
"kind" → mobRPG type mapping needs each type's minimal required fields, not
just `{}`:

| vault kind | mobRPG `data.type` | minimal `data` |
|---|---|---|
| `location` | `Political` | `{"type":"Political","titles":[]}` |
| `npc` / `pc` | `Person` | `{"type":"Person","languages":[],"equipment":[]}` |
| `faction` / `organization` | `Organization` | `{"type":"Organization","titles":[]}` |
| `item` | `Item` | `{"type":"Item","attributes":{"itemType":"Generic"}}` |
| `creature` | `Creature` | `{"type":"Creature"}` |

`externalRef` (`canticle:<vault-relative path, no extension>`) is the
idempotency key — resubmitting the same file returns the existing suggestion
instead of duplicating it. Only `location` has been exercised against a live
world; the rest are derived from the backend's `*Data.java` `@NotNull`
annotations, not yet submitted for real (see integration-log.md 2026-07-10).

## Still open (cheap, not yet run)

- Inspect a `campaignNote` to judge fit for clues / threads / session notes.
- Confirm `writing` vs `files` as the target for vault `document`s.
- Find a non-`1` `statusId` (probe another world or a draft entity) to pin the
  canon-state mapping.
