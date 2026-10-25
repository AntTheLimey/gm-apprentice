# Entity Schema

Entity type hierarchy, frontmatter schemas and per-type attributes.
For one type's fields and values, run `schema_rules.py show <type>`
(§ Fields by Type) instead of reading this file. Otherwise read the
section you need (`grep -n '^## ' shared/entity-schema.md`, then Read
at that offset) unless you are seeding `_meta/`.

## System-Specific Guidance

Schemas here are system-agnostic. For stat blocks and mechanics
also read, under `ttrpg-expert/`:
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
| source | string | How it entered canon (`show` lists the words) |
| canon_status | string | Canon status: DRAFT / AUTHORITATIVE / SUPERSEDED / STUB |
| era | string | Optional: named era from `_World/history-timeline.md` (e.g., "Second Age"); absent means the campaign present |

Set `lastUpdated` and `asOfSession` to the current session on every filing or update.

**Dated GM rulings** in an entity body stay as history. When one
replaces an earlier ruling, strike the old one through and append
`superseded YYYY-MM-DD` in the same edit:
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
├── document
│   ├── spell
│   ├── map
│   ├── letter
│   ├── prophecy
│   ├── contract
│   └── journal
└── prop

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

### Fields by Type

`python3 "${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/schema_rules.py"
show <type>` prints one type's required and optional fields, the
values its enumerated fields take, its template, folder and
relationship rules; `show` alone lists the types and the fields any
type takes. It reads the schema checks' own rules and the templates.

Write the recommended fields (`aliases`, `tags`, `source_document`,
`campaign`, `first_appearance`) anyway: `vault_check.py names` reads
`aliases`, and campaign-qa's audits lean on the rest.

`gm_aliases` (optional list) holds names only the GM should know, such
as a disguised NPC's true name. They resolve `[[links]]` like `aliases`,
but publish-site and mobrpg never show them: both rewrite a GM alias to
the owning page's title before publishing or pushing. Obsidian only
resolves links through `aliases`, so to make such a link work in
Obsidian, list the name under both fields. It still stays off the site.

`withheld` (optional boolean, absent means false) marks a note whose
own name is a secret: an NPC the players must not hear of yet. Its file
name, title and `aliases` are then looked for in everything the site
publishes, and an unlabelled `[[link]]` to it prints a neutral
placeholder in place of the name. `gm_aliases` rewrites a secret name;
`withheld` finds one. Write `true` or `false`; the build also reads
`yes`, `on` and `1` as true, as it does for `gm_only`. It is a note's
own flag and is never published. Wrap-up step 4d lifts it when the
GM confirms the note came out in play.

### Relationships Block

```yaml
relationships:
  - target: "[[Target Entity Name]]"
    type: member_of       # From _meta/relationship-types.md
    tone: respectful      # one listed word; see Tones below
    strength: 7           # 1-10 (1-2 weak, 9-10 defining)
    bidirectional: false
    description: "Serves as lieutenant"
    gm_only: false        # optional; true hides the edge from a published
                          # site (page, Connections, search index)
```

Every relationship on a non-PC entity also appears in the body,
readable (a PC's body follows `shared/pc-body-structure.md`): under
`## Related` (grouped People, Places, Groups, Things, one line per
tie), or under `### Hidden Ties` in GM Notes when `gm_only: true`.
Write, change or remove both together.

Extraction defaults: `tone: neutral` and `strength: 5` when the
source is ambiguous; `bidirectional: false` unless inherently
symmetric; a `description` traceable to source text; `gm_only`
omitted unless the edge's *existence* is the secret.

<!-- generated:tones (scripts/gen_ontology_docs.py) -->
**Tones.** `tone` is always one of: positive, friendly, warm, loving,
romantic, loyal, devoted, protective, trusting, respectful (positive);
negative, hostile, fearful, distrustful, contemptuous, tense, cold,
resentful, predatory, ominous (negative); neutral, unknown,
complicated, cautious, transactional, formal, professional (neutral).
<!-- /generated:tones -->
The nuance goes in `description`. The list is
`shared/gm-apprentice-ontology.json`'s `tones`.

### Publish control fields

Optional, on any entity — how a frontmatter secret or a whole
GM-facing file stays off a player site (`<!-- gm-only -->` has no
meaning in frontmatter).

| Field | Type | Meaning |
|-------|------|---------|
| `publish` | `false` \| `stub` | `false` — no page in any mode; links to it render as plain text. `stub` — page emitted for navigation, keeping only `publish_include_sections`. |
| `publish_exclude_fields` | array | Fields hidden on **this file only**, merged over the vault's `player_site.hide.fields`. Not re-admitted by `player_site.hide.field_exceptions`. |
| `publish_include_sections` | array | With `publish: stub` only. Headings to keep; default none. |

Absent, or an unrecognized `publish:` value, means normal
publication.

**PC `live_key`** (optional string, a slug; machine-written). The key the
site stores a PC's live stats under (current HP/SAN, loadouts, party board).
Absent means the slug of the filename, as always. `relink.py` writes it when
it renames a PC, so the stats stay with the character; nothing else sets it
and templates do not carry it.

## Core Entity Types

Threads are not entity files. They live in each PC's `## Current
Status` → Open threads and in the Session Plan's `## Active
Threads`, in the Thread Tracker format in
`ttrpg-expert/continuity-engine.md`.

A type's fields: `schema_rules.py show <type>`. Older vaults spell
some in camelCase (`factionType` for `faction_type`); follow the
vault's `_Templates/` file for that type. What some fields hold:

- **Clue** — `discoveryState` is per PC:
  `{"PC": "Unknown/Rumoured/Observed/Investigated/Understood"}`;
  `leads_to` is the node(s) the clue reveals, as on a Plan.
- **Faction** — `tier` is FitD's; `currentPlan` the active objective;
  `planProgress` a clock value or stage; `recentActions` the last 1-3
  sessions.
- **Event** — each of `participants` is `[[Entity]] (role)`,
  `[[Entity|Display]] (role)` or plain text.
- **Adventure Brief** — `sessions_estimated` is a number or a range
  ("3-5"); `system` a game system id or "undecided".
- **Campaign Overview** — `last_play_date` is a real-world ISO date;
  `arcs_planned` is 0 for a sandbox; `chapters_planned` counts the
  current arc's, or all. session-wrapup updates `current_game_date`,
  `sessions_played`, `last_session` and `last_play_date`.
- **World Domain** — one domain's world rules, in `_World/`; a
  structural file, not a graph entity. Each of `rules` has `id` (flag
  tracking), `rule` (plain words) and `check` (a structured object:
  field comparisons, allowed values, ranges).
- **World Flags** — the three-state flag tracker, one per campaign at
  `_World/_flags.md`; structural, not a graph entity.

## Narrative Element Schemas

**Chapter:** (blank: `_Templates/_Template_Chapter.md`)
```yaml
---
type: chapter
title: "Chapter Title"
sort_order: 1              # decimals allowed
status: planned            # planned | active | complete
date_range:
location:
overview: ""
campaign: ""
tags: []
---
```

**Scene:** (blank: `_Templates/_Template_Scene.md`; prep, never published)
```yaml
---
type: scene
chapter: "[[Chapter 1 - Title]]"
status: planned            # planned | paused
                           # played | dropped
played_in: []              # sessions, written by wrap-up
scene_type:                # optional: investigation | social | combat | chase
                           # transition | horror | downtime | other
entities: []
locations: []
maps: []
tags: []
---
```

## Type-Specific Fields

Mirrored into each vault's `_meta/entity-types.md`; migrations diff
the mirror against these entries.

**NPC:** `occupation`, `age`, `gender`, `nationality`, `status`
(alive/dead/missing/unknown), `location` (wiki-link: where they're
usually found), `portrait` (optional)

**PC:** `player_name`, `occupation`, `age`, `gender`, `nationality`,
`status` (alive/dead/missing/retired/unknown), `key_traits`, `hook` (optional string, any system: one line under the
name and on cards; blank means the backstory's first sentence),
`portrait` (optional), `display_meta` (optional array: ordered field names for the site meta row;
when omitted, the setting `player_site.sheets.header_facts` decides), `sheet_source`
(optional string: where the sheet is kept when not in this file, e.g.
`"D&D Beyond"` or `"paper, with the player"`; not shown by default; see
`shared/pc-body-structure.md`), `dndbeyond` (optional string, D&D only: a
D&D Beyond character link or id; `dnd_ddb.py` syncs the note from it)

### PC Body Structure

The PC body-heading hierarchy, the `## Current Status` block spec,
and the Story Companion Convention now live in
`shared/pc-body-structure.md`.

**Character Story:** `character` (wiki-link to the PC), plus
universal fields only. Body is append-only session sections; see the Story Companion Convention in
`shared/pc-body-structure.md`.

**Location:** `location_type`, `parent_location` (wiki-link),
`atmosphere`, `portrait` (optional). `parent_location` groups the published Locations
listing (fallback `location_type`).

**Faction/Organization:** `faction_type` (cult, guild, military,
etc.), `goals`, `leadership` (wiki-link), `territory` (wiki-link),
`status` (active/weakened/destroyed/allied/dormant),
`part_of` (wiki-link to the parent body, optional), `portrait`
(optional). `faction_type` groups the Factions listing.

**Item:** `item_type` (weapon, armor, relic, etc.),
`current_holder` (wiki-link), `origin`, `portrait` (optional)

**Event:** `event_type` (battle, ritual, etc.), `in_game_date` (in-game),
`location` (wiki-link), `participants` (wiki-links), `outcome`

**Clue:** `clue_type` (physical, testimonial, documentary),
`found_at` (wiki-link), `found_by`, `leads_to`, `reliability`,
`discoveryState` (per PC)

**Document:** `doc_type` (letter, journal, map, etc.), `author`,
`date` (when written), `condition`, `current_holder` (wiki-link).
The text goes in the body under `## The Text`; an older `content`
field moves there

**Prop:** `prop_kind` (document, object, diagram, supplied,
container), `prop_file` (a hand-made page, PDF or picture beside
the note), `prop_address` (its address on the site; empty means
`props/<note name>`), `prop_style` (a style the site builds its page
in from `## The Text`; not with a `prop_file`), `prop_line` (one line
for the props page), `prop_group` (its heading there; empty uses its
chapter), `prop_container` (wiki-link to the container prop it sits
in), `show_sealed` (containers: `titles` or `none`), `revealed_in`
(the session it arrived in; written at wrap-up). Style fields
(`prop_title`, `prop_breaks`, `prop_shift`, `prop_font`, and each
style's own) are listed in publish-site's prop-styles reference. It
publishes when the note does

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
`threat_level` (as the PCs judge it), `location` (wiki-link),
`portrait` (optional). `abilities` and `weaknesses` are optional and
publish; keep them in the body's GM Notes to hide them

**Heritage:** `lifespan_range` (min/max age array), `maturity_age`,
`average_height`, `notable_traits`, `portrait` (optional)

**World Domain:** `domain`, `status` (active/stub/inactive),
`summary`, `rules` (array of world rules, a sentence each)

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

<!-- generated:categories (scripts/gen_ontology_docs.py) -->
| Category | Types |
|----------|-------|
| Kinship | parent_of, ancestor_of, sibling_of, spouse_of, betrothed_to |
| Social | knows, friend_of, rival_of, mentors, trusts, betrayed |
| Power | rules, employs, commands, serves, vassal_of, imprisons |
| Spatial | located_at, headquartered_at, part_of, borders, haunts, visited |
| Possession | owns, created, wields, seeks |
| Knowledge | discovered, conceals, recorded_in, studies |
| Conflict | enemy_of, at_war_with, conspires_against, allied_with |
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
<!-- /generated:categories -->

Each type has an `inverse` name. Storage is single-direction only:
record `A --[employs]--> B` and `B --[employed_by]--> A` is implied.
Never store both.

<!-- generated:symmetric (scripts/gen_ontology_docs.py) -->
**Symmetric types** (stored once, no direction):
sibling_of, spouse_of, betrothed_to, knows, friend_of, rival_of,
borders, enemy_of, at_war_with, allied_with, trades_with,
negotiated_with, alter_ego_of, nemesis_of
<!-- /generated:symmetric -->

<!-- generated:genres (scripts/gen_ontology_docs.py) -->
**Genre tags:** each type carries `universal`, `fantasy`, `horror`,
`romance`, `historical`, `scifi` or `superhero`; filter suggestions to
the campaign's genre.
<!-- /generated:genres -->

Inverse names and modeling patterns (families, hierarchies,
triangles): ttrpg-expert's `relationship-patterns.md`.

This table is generated from
`shared/gm-apprentice-ontology.json`, the one source of the vocabulary. A new
vault's `_meta/relationship-types.md` starts with the full list;
older vaults may hold a genre subset. A predicate found only in a
vault copy is drift.

**Not relationship predicates:** sequencing is never an edge or a
`relationships:` entry. It is a **`leads_to` frontmatter field** —
an array of wiki-links to the next node(s) — on **Clue** and
**Plan** entities. Two or more targets make a branch, so there is
no `precedes` or `alternative_to`. A vault vocabulary with a
`Sequencing` category invented it — convert those edges to
`leads_to` fields.

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
| prop | beside its prop file, e.g. Chapters/{chapter}/Props/ or Documents/ |
| clue | Clues/ |
| plan | `Chapters/{chapter}/Planning/` |
| scene | `Chapters/{chapter}/Scenes/` |
| adventure-brief | Adventures/{adventure-name}/ |
| campaign_overview | _Campaign/ |
| heritage | Heritages/ |
| world_domain | _World/ |
| world_flags | _World/ |

## Vault Settings

The vault's settings (`vault.*` for the campaign, `player_site.*` for
its site) are held by the publish tool, not listed here. Never open a
settings file to read one: run
`node "$TOOL" settings get <name> --vault <vault>` for its value and
where that came from, `settings describe <name>` for what it does and
takes, `settings list` for all of them. `$TOOL` is as in
`publish-site/SKILL.md`. `vault.system` is the game system the tools
read; the Campaign Overview's `game_system` is that note's own field.

The plugin version the vault was last updated to is the tools' own
record: `vault_check.py <vault> version` reads it and the update
writes it.
