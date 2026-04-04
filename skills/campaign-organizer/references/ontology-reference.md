# Ontology Reference — Seed Data for `_meta/`

This file contains the default entity types, relationship types,
and frontmatter schemas used to seed a new vault's `_meta/` files.
Read this file when initializing a vault or evolving its schema.

## Entity Type Hierarchy

```
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

### Narrative Element Schemas

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

### Type-Specific Fields

**NPC:** `occupation`, `age`, `gender`, `nationality`, `status`
(alive/dead/missing/unknown)

**PC:** `player_name`, `occupation`, `age`, `gender`, `nationality`,
`status` (alive/dead/missing/unknown), `key_traits`

**Location:** `location_type`, `parent_location` (wiki-link),
`atmosphere`

**Faction/Organization:** `faction_type` (cult, guild, military,
etc.), `goals`, `leadership` (wiki-link), `territory` (wiki-link)

**Item:** `item_type` (weapon, armor, relic, etc.),
`current_holder` (wiki-link), `origin`

**Event:** `event_type` (battle, ritual, etc.), `date` (in-game),
`location` (wiki-link), `participants` (wiki-links), `outcome`

**Clue:** `clue_type` (physical, testimonial, documentary),
`found_at` (wiki-link), `found_by`, `leads_to`, `reliability`

**Creature:** `creature_type` (beast, undead, aberration, etc.),
`location` (wiki-link), `abilities`, `weaknesses`

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
