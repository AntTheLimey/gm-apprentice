# Entity Schema

Entity type hierarchy, frontmatter schemas and per-type attributes
for all campaign entities. Read the section you need
(`grep -n '^## ' shared/entity-schema.md`, then Read at that
offset) unless you are seeding `_meta/`.

## System-Specific Guidance

Schemas here are system-agnostic. For stat blocks and mechanical
conventions also read, under `ttrpg-expert/`:
`systems/coc-7e/occupations.md` (percentile stats),
`systems/dnd-5e-2024/conditions-rules.md` (CR, proficiency),
`systems/gurps-4e/character-generation.md` (point-buy),
`systems/fitd/factions.md` (tier, hold, clocks).

## Universal Fields

On **every** entity type:

| Field | Type | Description |
|-------|------|-------------|
| lastUpdated | string | Session number or date of last modification |
| asOfSession | string | Session when current state was confirmed accurate |
| createdSession | string | Session when first introduced |
| source | string | How it entered canon: "play", "prep", "backstory", or "world-evolution" |
| canon_status | string | Canon status: DRAFT / AUTHORITATIVE / SUPERSEDED / STUB |
| era | string | Optional: named era from `_World/history-timeline.md` (e.g., "Second Age"). Assumed campaign present if absent. |

Set `lastUpdated` and `asOfSession` to the current session when
filing or updating.

**Dated GM rulings** in an entity body stay as history. When a
ruling replaces an earlier one, strike the old one through and
append `superseded YYYY-MM-DD` in the same edit:
`~~stays in town (2026-08-30)~~ superseded 2026-09-03`.
Cite only the latest ruling that is not struck through.

## Entity Type Hierarchy

```text
person (abstract)
├── player
├── game_master
└── character (abstract)
    ├── pc
    └── npc

agent (abstract) — can act, decide, exert influence
├── character (see above)
├── creature
│   ├── beast
│   ├── undead
│   ├── construct
│   ├── spirit
│   ├── deity
│   └── aberration
├── faction
└── organization
    ├── government
    ├── corporation
    ├── cult
    ├── guild
    ├── military
    └── criminal

place (abstract)
└── location  (nests via part_of)

artifact (abstract)
├── item
│   ├── weapon
│   ├── armor
│   ├── vehicle
│   ├── treasure
│   ├── relic
│   ├── tool
│   └── consumable
└── document
    ├── spell
    ├── map
    ├── letter
    ├── prophecy
    ├── contract
    └── journal

narrative (abstract)
├── event
│   ├── battle
│   ├── ritual
│   ├── disaster
│   ├── discovery
│   ├── betrayal_event
│   └── celebration
├── clue
├── plan
├── adventure-brief
└── campaign_overview

world (abstract)
├── heritage
├── world_domain
└── world_flags
```

Abstract types are never assigned to entities; they exist for
constraint inheritance in the relationship ontology.

## Frontmatter Schemas

### Required Fields (All Entity Types)

```yaml
---
type: npc              # From the type hierarchy
canon_status: DRAFT    # DRAFT | AUTHORITATIVE | SUPERSEDED | STUB
aliases: []
tags: []
source_document: ""
campaign: ""
first_appearance: ""   # Link to scene or session
---
```

(`vault_check.py frontmatter` enforces `type` and `canon_status`,
plus per-type extras; write the rest anyway.)

### Relationships Block

```yaml
relationships:
  - target: "[[Target Entity Name]]"
    type: member_of       # From _meta/relationship-types.md
    tone: respectful      # friendly | romantic | respectful
                          # professional | hostile | fearful
                          # distrustful | contemptuous | neutral
                          # unknown | complicated
    strength: 7           # 1-10 (1-2 weak, 9-10 defining)
    bidirectional: false
    description: "Serves as lieutenant"
    gm_only: false        # optional; true hides the edge from a published
                          # site (page, relationship graph, search index)
```

Extraction defaults: `tone: neutral` and `strength: 5` when the
source is ambiguous; `bidirectional: false` unless inherently
symmetric; a `description` traceable to source text; `gm_only`
omitted unless the edge's *existence* is the secret.

### Publish control fields

Optional, on any entity — how a frontmatter secret or a whole
GM-facing file stays off a player site (`<!-- gm-only -->` has no
meaning in frontmatter).

| Field | Type | Meaning |
|-------|------|---------|
| `publish` | `false` \| `stub` | `false` — no page in any mode; links to it render as plain text. `stub` — page emitted for navigation, keeping only `publish_include_sections`. |
| `publish_exclude_fields` | array | Fields hidden on **this file only**, merged over the vault's `exclude_fields`. Not re-admitted by a config-level `overrides.fields.*.include`. |
| `publish_include_sections` | array | With `publish: stub` only. Headings to keep; default none. |

Absent, or an unrecognized `publish:` value, means normal
publication.

## Core Entity Types

Attribute names as each type has used them. Where a name differs
from `## Type-Specific Fields` below (e.g. `factionType` vs
`faction_type`), follow the vault's `_Templates/` file for that
type.

- **NPC** — occupation, age (number), gender, nationality,
  characteristics (object: system stats), skills (array),
  motivations (array), secrets (hidden information), portrait
- **Location** — locationType (building, outdoor…), address,
  size, atmosphere, inhabitants (array), points_of_interest
  (array), secrets, portrait (establishing shot)
- **Item** — itemType (weapon, book, artifact…), value
  (worth/rarity), origin (provenance), properties (object: special
  abilities), currentHolder, portrait
- **Faction** — factionType, goals (array), resources, leadership,
  territory, tier (number, FitD), currentPlan (active objective),
  planProgress (clock value or stage), alliances (array),
  recentActions (array: last 1-3 sessions), status (active /
  weakened / destroyed / allied / dormant), portrait (logo or HQ),
  part_of (optional wiki-link to parent organization,
  `"[[Parent Org]]"`)
- **Clue** — clueType (physical, testimonial…), foundAt, foundBy,
  leads_to (array of wiki-links to the node(s) this clue reveals;
  shared with Plan), reliability, discoveryState (object, per PC:
  `{"PC": "Unknown/Rumoured/Observed/Investigated/Understood"}`)
- **Thread** — threadType (Plot / Faction / Mystery / Chekhov /
  Foreshadowing), status (Active / Stale / Resolved / Retired),
  introduced and lastAdvanced (session numbers), knownBy (array:
  PCs and NPCs aware), nextBeat, resolutionCondition,
  plantedDetail and intendedPayoff (foreshadowing), ripeness
  (Planted / Ripening / Ready / Paid Off / Retired)
- **Creature** — creatureType, size, abilities (array),
  weaknesses (array), sanityLoss (SAN loss on sight), stats
  (object), portrait
- **Organization** — orgType (university, company…), purpose,
  size (member count), resources, notable_members (array),
  portrait, part_of (optional wiki-link to parent organization)
- **Event** — event_type, in_game_date, location (wiki-link),
  participants (array: `[[Entity]] (role)`,
  `[[Entity|Display]] (role)`, or plain text), outcome
- **Plan** — plan_type (`arc`, `scene`, `investigation`,
  `timeline`), chapter (`"[[Chapter_N_Overview]]"`), participants
  and locations (wiki-link arrays), leads_to (wiki-link array; see
  Not relationship predicates)
- **Document** — docType (letter, journal, map…), author, date
  (when written), content (the text), condition
- **Adventure Brief** — scope (campaign / one-shot / few-shot),
  sessions_estimated (number or range, e.g. "3-5"),
  continuation_type (new / new-chapter / new-arc / time-jump /
  prequel / parallel / new-pcs), adventure_shape (linear /
  branching / hub-and-spoke / open-node / sandbox), system (game
  system identifier or "undecided")
- **Campaign Overview** — campaign, game_system, setting_year,
  current_game_date, genre_tags (array), scope, status
  (not_started / in_progress / paused / completed / abandoned),
  sessions_played (number), last_session (wiki-link),
  last_play_date (real-world ISO date), current_arc, arcs_planned
  (number; 0 for sandbox), current_chapter (wiki-link),
  chapters_planned (number: in current arc, or total), portrait.
  session-wrapup auto-updates current_game_date, sessions_played,
  last_session and last_play_date.
- **Heritage** — lifespan_range ([min, max] age), maturity_age,
  average_height, notable_traits (array), portrait
- **World Domain** — one domain's world rules, in `_World/`; a
  structural file, not a graph entity. domain (e.g. `heritages`,
  `geography-climate`), status (active / stub / inactive), summary
  (one line), rules (array; each rule has `id` for flag tracking,
  `rule` in plain words, and `check` — a structured object:
  field comparisons, allowed values, ranges)
- **World Flags** — the three-state flag tracker, one per campaign
  at `_World/_flags.md`; structural, not a graph entity.
  last_reviewed (date)

`portrait` is always optional: a path under `_attachments/`.

## Narrative Element Schemas

**Chapter:**
```yaml
---
type: chapter
sort_order: 1
title: "Chapter Title"
campaign: ""
overview: ""
tags: []
---
```

**Session:**
```yaml
---
type: session
session_number: 1
chapter: "[[Chapter 1 - Title]]"
campaign: ""
play_date: null           # Real-world date session was played, YYYY-MM-DD
in_game_date: null        # In-game date(s) — string or array
status: planned           # planned | prepped | played | reviewed
stage: outline            # outline | draft | ready | in_play | wrap_up
prep_notes: ""
actual_notes: ""
play_notes: ""
scenes:                   # Ordered list of scene links
  - "[[Scene Title]]"
tags: []
---
```

**Scene:**
```yaml
---
type: scene
session: "[[Session 01 - Title]]"
chapter: "[[Chapter 1 - Title]]"
campaign: ""
scene_type: investigation  # investigation | social | combat | chase
                           # transition | horror | downtime | other
status: planned            # planned | ready | played | cut
sort_order: 1
objective: ""
gm_notes: ""
entities:                  # Entities that participate in this scene
  - "[[NPC Name]]"
  - "[[Location Name]]"
  - "[[Item Name]]"
connections: []            # Links to scenes this leads to/from
canon_status: DRAFT
tags: []
---
```

## Type-Specific Fields

Mirrored into each vault's `_meta/entity-types.md`; migrations diff
the mirror against these entries.

**NPC:** `occupation`, `age`, `gender`, `nationality`, `status`
(alive/dead/missing/unknown), `portrait` (optional)

**PC:** `player_name`, `occupation`, `age`, `gender`, `nationality`,
`status` (alive/dead/missing/unknown), `key_traits`, `portrait` (optional),
`display_meta` (optional array: ordered field names for published site meta row;
defaults to `[occupation, age, nationality]` when omitted)

### PC Body Structure

The PC body-heading hierarchy, the `## Current Status` block spec,
and the Story Companion Convention now live in
`shared/pc-body-structure.md`.

**Character Story:** `character` (wiki-link to the PC), plus
universal fields — no other type-specific attributes. Body is
append-only session sections; see the Story Companion Convention in
`shared/pc-body-structure.md`.

**Location:** `location_type`, `parent_location` (wiki-link),
`atmosphere`, `portrait` (optional). `parent_location` groups the
published Locations listing (fallback: `location_type`).

**Faction/Organization:** `faction_type` (cult, guild, military,
etc.), `goals`, `leadership` (wiki-link), `territory` (wiki-link),
`part_of` (wiki-link to the parent body, optional), `portrait`
(optional). `faction_type` groups the published Factions listing.

**Item:** `item_type` (weapon, armor, relic, etc.),
`current_holder` (wiki-link), `origin`, `portrait` (optional)

**Event:** `event_type` (battle, ritual, etc.), `in_game_date` (in-game),
`location` (wiki-link), `participants` (wiki-links), `outcome`

**Clue:** `clue_type` (physical, testimonial, documentary),
`found_at` (wiki-link), `found_by`, `leads_to`, `reliability`

**Document:** `doc_type` (letter, journal, map, etc.), `author`,
`date` (when written), `content`, `condition`

**Plan:** `plan_type` (arc/scene/investigation/timeline),
`chapter` (wiki-link), `participants` (wiki-links),
`locations` (wiki-links), `leads_to` (wiki-links)

**Adventure Brief:** `scope` (campaign/one-shot/few-shot),
`sessions_estimated`, `continuation_type` (new/new-chapter/new-arc/time-jump/prequel/parallel/new-pcs),
`adventure_shape` (linear/branching/hub-and-spoke/open-node/sandbox),
`system`

**Campaign Overview:** `campaign`, `game_system`, `setting_year`,
`current_game_date`, `genre_tags`, `scope`, `status`, `sessions_played`,
`last_session`, `last_play_date`, `current_arc`, `arcs_planned`,
`current_chapter`, `chapters_planned`, `portrait` (optional)

**Creature:** `creature_type` (beast, undead, aberration, etc.),
`location` (wiki-link), `abilities`, `weaknesses`, `portrait` (optional)

**Heritage:** `lifespan_range` (min/max age array), `maturity_age`,
`average_height`, `notable_traits`, `portrait` (optional)

**World Domain:** `domain`, `status` (active/stub/inactive),
`summary`, `rules` (array of machine-checkable world rules)

**World Flags:** `last_reviewed`

### The `mobrpg:` node (machine-managed — do not hand-edit)

Entities synced to a mobRPG world carry a `mobrpg:` node written by
the `mobrpg` CLI — a regenerable sync ledger, not authored content;
top-line frontmatter stays the source of truth. Never edit it or
copy it into another entity. mobRPG is canon: `accepted`/`edited`
entities (`review_state`) are refreshed from mobRPG on pull-down;
`pending`/`dismissed` ones keep their vault content. Scalar values
are JSON-encoded (`key: "text"`, `key: null`).

| Key | Meaning |
|-----|---------|
| `world_id` / `external_ref` / `element_id` / `element_kind` | identity anchors (element_id is null until mobRPG accepts) |
| `review_state` | `pending` / `accepted` / `dismissed` / `edited` / `deleted` |
| `content_hash` / `last_synced` / `review_note` | sync bookkeeping |
| `determined` | classifiers derived and sent (mobRPG canon overwrites on edit) |
| `relationships[]` | reified-Event ids keyed by `(predicate, target)` |
| `languages[]` | reserved (populated by the mobRPG skill) |

## Relationship Types

Use the most specific type; generic types like `associated_with`
or `related_to` add edges without meaning.

| Category | Types |
|----------|-------|
| Kinship | parent_of, sibling_of, spouse_of, betrothed_to, ancestor_of |
| Social | knows, friend_of, rival_of, mentors, trusts, betrayed |
| Power | rules, employs, commands, serves, vassal_of, imprisons |
| Spatial | located_at, headquartered_at, part_of, borders, haunts |
| Possession | owns, created, wields, seeks |
| Knowledge | discovered, conceals, recorded_in, studies |
| Conflict | enemy_of, allied_with, at_war_with, conspires_against |
| Affiliation | member_of, founded, leads, defected_from, infiltrates |
| Supernatural | bound_to, cursed_by, summoned, worships, corrupted_by |
| Temporal | caused, triggered, participated_in, witnessed |
| Economic | trades_with, supplies, finances, indebted_to |
| Event | murdered, poisoned, wounded, rescued, captured, deceived |
| Horror | possessed_by, infected_by, fears, feeds_on |
| Romance | courts, rejected, disguised_as, blackmails |
| Historical | conquered, exiled_from, succeeded, negotiated_with |
| Sci-Fi | uploaded_to, augmented_by, cloned_from, hacked |
| Superhero | alter_ego_of, empowered_by, nemesis_of |

Each type has an `inverse` name. Storage is single-direction only:
record `A --[employs]--> B` and `B --[employed_by]--> A` is implied.
Never store both.

**Symmetric types** (stored once, no direction):
knows, sibling_of, spouse_of, betrothed_to, enemy_of, allied_with,
at_war_with, rival_of, friend_of, borders, trades_with, alter_ego_of,
nemesis_of, negotiated_with

**Genre tags:** each type carries `universal`, `fantasy`, `horror`,
`scifi`, `superhero`, `historical` or `romance`; filter
suggestions to the campaign's genre.

Inverse names and modeling patterns (families, hierarchies,
triangles): ttrpg-expert's `relationship-patterns.md`.

This table is the authoritative vocabulary
(`shared/gm-apprentice-ontology.json` is generated from it). A
vault's `_meta/relationship-types.md` is a genre-filtered subset —
a predicate found only in a vault copy is drift.

**Not relationship predicates:** sequencing is never an edge or a
`relationships:` entry. It is a **`leads_to` frontmatter field** —
an array of wiki-links to the next node(s) — on **Clue** and
**Plan** entities. Two or more targets make a branch, so there is
no `precedes` or `alternative_to`. A vault vocabulary with a
`Sequencing` category invented it — convert those edges to
`leads_to` fields.

## Required Relationships

| Entity Type | Required Relationship |
|-------------|----------------------|
| `npc` | `located_at` |
| `pc` | `located_at` |
| `creature` | `located_at` |
| `faction` | `headquartered_at` |
| `organization` | `headquartered_at` |
| `heritage` | — (none required) |

## Default Folder Mapping

| Type Category | Vault Folder |
|---------------|-------------|
| pc | Characters/PCs/ |
| npc | Characters/NPCs/ |
| location | Locations/ |
| faction, organization | Factions & Organizations/ |
| item (all subtypes) | Items & Artifacts/ |
| creature (all subtypes) | Creatures/ |
| event (all subtypes) | Events/ |
| document (all subtypes) | Documents/ |
| clue | Clues/ |
| plan | `Chapters/{chapter}/Planning/` |
| adventure-brief | Adventures/{adventure-name}/ |
| campaign_overview | _Campaign/ |
| heritage | Heritages/ |
| world_domain | _World/ |
| world_flags | _World/ |

## Vault Configuration Fields

Frontmatter of `_meta/vault-config.md`, read by several skills.

| Field | Type | Description |
|-------|------|-------------|
| `gm_apprentice_version` | string | Plugin version the vault was last migrated to; set by migration and checked by `vault_check.py <vault> version`. |
| `setting_year` | string | In-game date shown on the published site |

Under `publish:`:

| Field | Type | Description |
|-------|------|-------------|
| `system` | string | `coc-7e`, `coc-7e-regency`, `gurps-4e`, `dnd-5e-2024`, `pf2e` or `fitd`; drives system-specific rendering. |
| `site_dir` | string | Absolute path to the site repo, so publish-site needn't ask each session. Optional. |
| `mode` | string | `"player"` or `"full"` — GM-only content visibility |
| `exclude_sections` | array | H2 headings stripped from output (default `["GM Notes"]`) |
| `exclude_fields` | array | Frontmatter fields stripped (default `["secrets", "current_plan", "plan_progress", "gm_notes", "prep_notes"]`) |
| `exclude_dirs` | array | Vault folders not published (default `["_meta", "_Templates"]`) |
| `theme` | object | `genre`, `palette`, `fonts`, `campaign_image` |
| `four_oh_four` | object | Custom 404 page: `style`, `message` |
| `overrides` | object | Per-file include/exclude/field overrides |
