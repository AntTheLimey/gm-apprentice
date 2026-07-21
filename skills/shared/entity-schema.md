# Entity Schema

Merged reference combining entity type hierarchy, frontmatter
schemas, and per-type attribute tables for all campaign entities.

## System-Specific Guidance

Schemas here are system-agnostic. For system-specific stat
blocks, skill formats, and mechanical conventions, also read:
- CoC 7e: `systems/coc-7e/occupations.md` (percentile stats)
- D&D 5e: `systems/dnd-5e-2024/conditions-rules.md` (CR, proficiency)
- GURPS 4e: `systems/gurps-4e/character-generation.md` (point-buy attributes)
- FitD: `systems/fitd/factions.md` (tier, hold, clocks)

## Universal Fields

Apply to **every** entity type. Enable temporal queries
("what changed in session 5?", "which entities are stale?").

| Field | Type | Description |
|-------|------|-------------|
| lastUpdated | string | Session number or date of last modification |
| asOfSession | string | Session when current state was confirmed accurate |
| createdSession | string | Session when first introduced |
| source | string | How it entered canon: "play", "prep", "backstory", or "world-evolution" |
| canon_status | string | Canon status: DRAFT / AUTHORITATIVE / SUPERSEDED / STUB |
| era | string | Optional: named era from `_World/history-timeline.md` (e.g., "Second Age"). Assumed campaign present if absent. |

Always set `lastUpdated` and `asOfSession` to current session
when filing or updating.

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

Abstract types cannot be assigned directly to entities but are
used for constraint inheritance in the relationship ontology.

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
```

Extraction defaults:

- `tone: neutral` and `strength: 5` when source is ambiguous
- `bidirectional: false` unless inherently symmetric
- Include `description` traceable to source text

## Core Entity Types

### NPC

| Attribute | Type | Description |
|-----------|------|-------------|
| occupation | string | Job or role |
| age | number | Character age |
| gender | string | Character gender |
| nationality | string | Origin |
| characteristics | object | System stats |
| skills | array | Skill list |
| motivations | array | Goals and drives |
| secrets | string | Hidden information |
| portrait | string | Optional: path to portrait image under `_attachments/` |

```json
{
    "name": "Dr. Henry Armitage",
    "type": "npc",
    "attributes": {
        "occupation": "Librarian",
        "age": 65,
        "characteristics": {"INT": 85, "EDU": 90},
        "skills": [{"name": "Library Use", "value": 90}]
    },
    "gmNotes": "Knows about the Necronomicon"
}
```

### Location

| Attribute | Type | Description |
|-----------|------|-------------|
| locationType | string | Building, outdoor, etc. |
| address | string | Physical location |
| size | string | Scale |
| atmosphere | string | Mood |
| inhabitants | array | Who's here |
| points_of_interest | array | Notable features |
| secrets | string | Hidden aspects |
| portrait | string | Optional: path to establishing shot under `_attachments/` |

### Item

| Attribute | Type | Description |
|-----------|------|-------------|
| itemType | string | Weapon, book, artifact, etc. |
| value | string | Worth/rarity |
| origin | string | Provenance |
| properties | object | Special abilities |
| currentHolder | string | Who has it |
| portrait | string | Optional: path to item illustration under `_attachments/` |

### Faction

| Attribute | Type | Description |
|-----------|------|-------------|
| factionType | string | Cult, org, etc. |
| goals | array | Objectives |
| resources | string | Available power |
| leadership | string | Who's in charge |
| territory | string | Area of influence |
| tier | number | Power level (FitD) |
| currentPlan | string | Active objective |
| planProgress | string | Clock value or stage |
| alliances | array | Current allies/enemies |
| recentActions | array | Last 1-3 sessions |
| status | string | active / weakened / destroyed / allied / dormant |
| portrait | string | Optional: path to logo or HQ image under `_attachments/` |
| part_of | string | Optional: wiki-link to parent organization (`"[[Parent Org]]"`) |

### Clue

| Attribute | Type | Description |
|-----------|------|-------------|
| clueType | string | Physical, testimonial, etc. |
| foundAt | string | Location discovered |
| foundBy | string | Who found it |
| leads_to | array | Wiki-links to the node(s) this clue reveals (node-based sequencing; shared with Plan) |
| reliability | string | Trustworthiness |
| discoveryState | object | Per-PC: `{"PC": "Unknown/Rumoured/Observed/Investigated/Understood"}` |

### Thread

| Attribute | Type | Description |
|-----------|------|-------------|
| threadType | string | Plot / Faction / Mystery / Chekhov / Foreshadowing |
| status | string | Active / Stale / Resolved / Retired |
| introduced | string | Session number |
| lastAdvanced | string | Session number |
| knownBy | array | PCs and NPCs aware |
| nextBeat | string | What should happen next |
| resolutionCondition | string | What resolves this thread |
| plantedDetail | string | Foreshadowing: what was planted |
| intendedPayoff | string | Foreshadowing: what it foreshadows |
| ripeness | string | Planted / Ripening / Ready / Paid Off / Retired |

### Creature

| Attribute | Type | Description |
|-----------|------|-------------|
| creatureType | string | Species/category |
| size | string | Physical scale |
| abilities | array | Special powers |
| weaknesses | array | Vulnerabilities |
| sanityLoss | string | SAN loss on sight |
| stats | object | Combat statistics |
| portrait | string | Optional: path to creature art under `_attachments/` |

### Organization

| Attribute | Type | Description |
|-----------|------|-------------|
| orgType | string | University, company, etc. |
| purpose | string | Mission/function |
| size | string | Member count |
| resources | string | Available assets |
| notable_members | array | Important people |
| portrait | string | Optional: path to logo or HQ image under `_attachments/` |
| part_of | string | Optional: wiki-link to parent organization (`"[[Parent Org]]"`) |

### Event

| Attribute | Type | Description |
|-----------|------|-------------|
| event_type | string | Battle, ritual, meeting, etc. |
| in_game_date | string | In-game date |
| location | string | Where (wiki-link to Location entity) |
| participants | array | Who — entries can be `[[Entity]] (role)`, `[[Entity\|Display]] (role)`, or plain text |
| outcome | string | Result |

### Plan

| Attribute | Type | Description |
|-----------|------|-------------|
| plan_type | string | `arc`, `scene`, `investigation`, or `timeline` |
| chapter | string | Wiki-link to chapter overview (`"[[Chapter_N_Overview]]"`) |
| participants | array | Wiki-link array to NPCs, factions, creatures involved |
| locations | array | Wiki-link array to location entities |
| leads_to | array | Wiki-link array to the plan node(s) this one leads to (node-based sequencing; see below) |

### Document

| Attribute | Type | Description |
|-----------|------|-------------|
| docType | string | Letter, journal, map, etc. |
| author | string | Who wrote it |
| date | string | When written |
| content | string | The text |
| condition | string | Physical state |

### Adventure Brief

| Attribute | Type | Description |
|-----------|------|-------------|
| scope | string | campaign / one-shot / few-shot |
| sessions_estimated | string | Number or range (e.g. "3-5") |
| continuation_type | string | new / new-chapter / new-arc / time-jump / prequel / parallel / new-pcs |
| adventure_shape | string | linear / branching / hub-and-spoke / open-node / sandbox |
| system | string | Game system identifier or "undecided" |

### Campaign Overview

| Attribute | Type | Description |
|-----------|------|-------------|
| campaign | string | Campaign name |
| game_system | string | Game system identifier |
| setting_year | string | In-game era or year |
| current_game_date | string | Current in-game date (auto-updated by session-wrapup) |
| genre_tags | array | Genre descriptors |
| scope | string | campaign / one-shot / few-shot |
| status | string | not_started / in_progress / paused / completed / abandoned |
| sessions_played | number | Total sessions played (auto-updated by session-wrapup) |
| last_session | string | Wiki-link to most recent session file (auto-updated) |
| last_play_date | string | Real-world ISO date of last session (auto-updated) |
| current_arc | string | Name of the active story arc |
| arcs_planned | number | Total arcs outlined (0 for sandbox) |
| current_chapter | string | Wiki-link to active chapter |
| chapters_planned | number | Chapters in current arc (or total if no arcs) |
| portrait | string | Optional: path to campaign image under `_attachments/` |

### Heritage

| Attribute | Type | Description |
|-----------|------|-------------|
| lifespan_range | array | [min, max] age range |
| maturity_age | number | Age of adulthood |
| average_height | string | Typical height range |
| notable_traits | array | Distinguishing biological/cultural traits |
| portrait | string | Optional: path to heritage illustration under `_attachments/` |

### World Domain

Structural file defining world rules for one domain (e.g.,
heritages, geography, economics). Lives in `_World/`. Not a
knowledge-graph entity — a structural file like Campaign
Overview.

| Attribute | Type | Description |
|-----------|------|-------------|
| domain | string | Domain identifier (e.g., `heritages`, `geography-climate`) |
| status | string | active / stub / inactive |
| summary | string | One-line domain summary |
| rules | array | Machine-checkable world rules (see below) |

Each rule in the `rules` array has:
- `id` — unique identifier for flag tracking
- `rule` — human-readable description
- `check` — structured object for validation (field comparisons,
  allowed values, range checks)

### World Flags

Structural file tracking the three-state flag system. One per
campaign at `_World/_flags.md`. Not a knowledge-graph entity.

| Attribute | Type | Description |
|-----------|------|-------------|
| last_reviewed | string | Date of last flag review |

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

NOTE: The Core Entity Types section above contains the detailed
attribute tables. This section is the compact summary used
during Dissect mode.

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
`portrait` (optional). `faction_type` groups the published Factions
listing.

**Item:** `item_type` (weapon, armor, relic, etc.),
`current_holder` (wiki-link), `origin`, `portrait` (optional)

**Event:** `event_type` (battle, ritual, etc.), `in_game_date` (in-game),
`location` (wiki-link), `participants` (wiki-links), `outcome`

**Clue:** `clue_type` (physical, testimonial, documentary),
`found_at` (wiki-link), `found_by`, `leads_to`, `reliability`

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

## Relationship Types

Use the most specific type available. Generic types like
`associated_with` or `related_to` add edges without meaning.

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

Each type has an `inverse` name. Storage is single-direction only.
If you record `A --[employs]--> B`, the inverse
`B --[employed_by]--> A` is implied. Do NOT store both.

**Symmetric types** (stored once, no direction):
knows, sibling_of, spouse_of, betrothed_to, enemy_of, allied_with,
at_war_with, rival_of, friend_of, borders, trades_with, alter_ego_of,
nemesis_of, negotiated_with

**Genre tags:** Each type carries tags: `universal`, `fantasy`,
`horror`, `scifi`, `superhero`, `historical`, `romance`. Filter
suggestions to match the campaign's genre.

For domain/range constraints and the full inverse name list,
consult `relationship-patterns.md` in the ttrpg-expert skill.

**This table is the authoritative vocabulary.** The machine-readable
export `shared/gm-apprentice-ontology.json` restates these predicates
and adds the mobRPG projection (`mobrpg_event_type` /
`mobrpg_relation_type`) on top; it is generated *from* this table, not
the other way round. `scripts/validate_ontology.py` fails CI when the
two disagree on the **predicate set or the symmetric set**, and checks
the mobRPG projection for internal enum-consistency — it does **not**
cross-check the per-predicate mobRPG mapping values against this table,
because the table does not carry them (that layer is authored in the
export). A vault's `_meta/relationship-types.md` is a genre-filtered
**subset** of this table — never a superset. Predicates that appear
only in a vault copy are drift, not vocabulary.

**Not relationship predicates:** narrative-flow / sequencing is **not**
an edge in this relationship graph and never a `relationships:` block
entry. It is modelled the node-based way (Alexandrian node-based
scenario design; Twine's passage graph): a **`leads_to` frontmatter
field** — an array of wiki-links to the node(s) this one leads to — on
both **Clue** and **Plan** entities. A node with two or more `leads_to`
targets *is* a branch; the branching is the graph structure, so there
is no separate `precedes` (redundant with `leads_to`) or
`alternative_to` (emergent from multiple targets) predicate or field. A
vault vocabulary that lists a `Sequencing` relationship category
invented it — convert those edges to `leads_to` fields.

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

The vault's `_meta/vault-config.md` file uses YAML frontmatter
for campaign-wide settings. These fields are read by multiple
skills.

### Core fields

| Field | Type | Description |
|-------|------|-------------|
| `gm_apprentice_version` | string | Plugin version this vault was last migrated to. Set by the migration system. Skills compare this to `current_version` in `shared/migrations.md` to detect when migration is needed. |
| `setting_year` | string | In-game date displayed on the published site |

### Publish fields (under `publish:` key)

| Field | Type | Description |
|-------|------|-------------|
| `system` | string | Game system identifier (`coc-7e`, `coc-7e-regency`, `gurps-4e`, `dnd-5e-2024`, `pf2e`, `fitd`). Read by publish tool for system-specific rendering. |
| `site_dir` | string | Absolute path to the site repo directory. Read by publish-site skill instead of asking each session. Optional — omit if vault doesn't use the publish tool. |
| `mode` | string | `"player"` or `"full"` — controls GM-only content visibility |
| `exclude_sections` | array | H2 heading names to strip from published output (default: `["GM Notes"]`) |
| `exclude_fields` | array | Frontmatter field names to strip (default: `["secrets", "current_plan", "plan_progress", "gm_notes", "prep_notes"]`) |
| `exclude_dirs` | array | Vault folders to exclude from publishing (default: `["_meta", "_Templates"]`) |
| `theme` | object | Theme configuration: `genre`, `palette`, `fonts`, `campaign_image` |
| `four_oh_four` | object | Custom 404 page: `style`, `message` |
| `overrides` | object | Per-file include/exclude/field overrides |
