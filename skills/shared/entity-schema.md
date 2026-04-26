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
| source | string | How it entered canon: "play", "prep", or "backstory" |
| confidence | string | Canon confidence: DRAFT / AUTHORITATIVE / SUPERSEDED |

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
└── clue
```

Abstract types cannot be assigned directly to entities but are
used for constraint inheritance in the relationship ontology.

## Frontmatter Schemas

### Required Fields (All Entity Types)

```yaml
---
type: npc              # From the type hierarchy
source_confidence: DRAFT    # DRAFT | AUTHORITATIVE | SUPERSEDED | STUB
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

### Clue

| Attribute | Type | Description |
|-----------|------|-------------|
| clueType | string | Physical, testimonial, etc. |
| foundAt | string | Location discovered |
| foundBy | string | Who found it |
| leadsTo | array | What it reveals |
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

### Event

| Attribute | Type | Description |
|-----------|------|-------------|
| event_type | string | Battle, ritual, meeting, etc. |
| date | string | In-game date |
| location | string | Where (wiki-link to Location entity) |
| participants | array | Who — entries can be `[[Entity]] (role)`, `[[Entity\|Display]] (role)`, or plain text |
| outcome | string | Result |

### Document

| Attribute | Type | Description |
|-----------|------|-------------|
| docType | string | Letter, journal, map, etc. |
| author | string | Who wrote it |
| date | string | When written |
| content | string | The text |
| condition | string | Physical state |

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
planned_date: null        # Real-world date
actual_date: null
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
source_confidence: DRAFT
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

All PC entity files follow this canonical heading hierarchy.
Templates in `shared/templates/` implement the full structure
per system; skills that create or update PC files follow the
same skeleton.

```text
## Stat Sheet          — system-specific stats (always first body section)
## Background          — backstory, personality, description
## [System Sections]   — varies by system (see per-system template)
## Equipment           — gear, possessions, wealth/encumbrance
## Notes               — player-facing (protected: skills never modify)
## GM Notes            — keeper-only (protected: skills never modify)
```

Templates may omit inapplicable sections (e.g., FitD crews
have no `## Equipment` — gear is handled through Quality).

`## Notes` and `## GM Notes` are **protected sections** — only
the GM edits them directly. Automated skills must preserve
their content unchanged.

### Story Companion Convention

Every PC entity `Characters/PCs/{Name}.md` may have a
companion story file at `Characters/PCs/{Name}_Story.md`.

- Frontmatter: `type: character-story`,
  `character: "[[{Name}]]"`, plus universal fields
- Discovered by naming convention (`{Name}_Story.md`),
  not frontmatter pointer
- Append-only — new sessions add a `## Session {N}` heading
- `campaign-qa` validates every active PC has a story file
- See `shared/character-story-format.md` for narrative voice,
  genre matching, and append protocol

**Location:** `location_type`, `parent_location` (wiki-link),
`atmosphere`, `portrait` (optional)

**Faction/Organization:** `faction_type` (cult, guild, military,
etc.), `goals`, `leadership` (wiki-link), `territory` (wiki-link),
`portrait` (optional)

**Item:** `item_type` (weapon, armor, relic, etc.),
`current_holder` (wiki-link), `origin`, `portrait` (optional)

**Event:** `event_type` (battle, ritual, etc.), `date` (in-game),
`location` (wiki-link), `participants` (wiki-links), `outcome`

**Clue:** `clue_type` (physical, testimonial, documentary),
`found_at` (wiki-link), `found_by`, `leads_to`, `reliability`

**Creature:** `creature_type` (beast, undead, aberration, etc.),
`location` (wiki-link), `abilities`, `weaknesses`, `portrait` (optional)

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
rival_of, friend_of, borders, trades_with, alter_ego_of, nemesis_of

**Genre tags:** Each type carries tags: `universal`, `fantasy`,
`horror`, `scifi`, `superhero`, `historical`, `romance`. Filter
suggestions to match the campaign's genre.

For domain/range constraints and the full inverse name list,
consult `relationship-patterns.md` in the ttrpg-expert skill.

## Required Relationships

| Entity Type | Required Relationship |
|-------------|----------------------|
| `npc` | `located_at` |
| `pc` | `located_at` |
| `creature` | `located_at` |
| `faction` | `headquartered_at` |
| `organization` | `headquartered_at` |

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
