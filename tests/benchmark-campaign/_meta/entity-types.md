---
type: meta
purpose: entity-types
---

# Entity Types

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

**Tones.** `tone` is always one of: positive, friendly, warm, loving,
romantic, loyal, devoted, protective, trusting, respectful (positive);
negative, hostile, fearful, distrustful, contemptuous, tense, cold,
resentful, predatory, ominous (negative); neutral, unknown,
complicated, cautious, transactional, formal, professional (neutral).
The nuance goes in `description`. The list is
`shared/gm-apprentice-ontology.json`'s `tones`.

### Publish control fields

Optional, on any entity — how a frontmatter secret or a whole
GM-facing file stays off a player site (`<!-- gm-only -->` has no
meaning in frontmatter).

| Field | Type | Meaning |
|-------|------|---------|
| `publish` | `false` or `stub` | `false` — no page in any mode; links to it render as plain text. `stub` — page emitted for navigation, keeping only `publish_include_sections`. |
| `publish_exclude_fields` | array | Fields hidden on **this file only**, merged over the vault's `player_site.hide.fields`. Not re-admitted by `player_site.hide.field_exceptions`. |
| `publish_include_sections` | array | With `publish: stub` only. Headings to keep; default none. |

Absent, or an unrecognized `publish:` value, means normal
publication.

**PC `live_key`** (optional string, a slug; machine-written). The key the
site stores a PC's live stats under (current HP/SAN, loadouts, party board).
Absent means the slug of the filename, as always. `relink.py` writes it when
it renames a PC, so the stats stay with the character; nothing else sets it
and templates do not carry it.

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
`props/<note name>`, or `props/<note name>-prop.html` when a page
the site builds has that address), `prop_style` (the look of the page the
site makes from `## The Text`; not with a `prop_file`), `prop_hand` (a hand id
from the vault's `_meta/prop-hands.json`, so one writer always has one hand;
`prop_font` on the note wins), `prop_line` (one line
for the props page), `prop_group` (its heading there; empty uses its
chapter), `prop_container` (wiki-link to the container prop it sits
in), `show_sealed` (containers: `titles` or `none`), `prop_state`
(containers: a `.js` file filled with what the page lists, for
its script), `prop_state_global` (the global it sets; default
`PROP_ITEMS`), `revealed_in`
(the session it reached the players; wrap-up's reveal step writes it, first arrival only). Style fields
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
