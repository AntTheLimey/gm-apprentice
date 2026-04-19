# Schema Reference — Frontmatter Fields per Entity Type

This file lists the frontmatter fields that `gm-apprentice-publish`
reads when generating site pages. Fields marked **Required** must
be present for the page to render correctly. Fields marked
**Optional** are used when present and silently ignored when absent.

The tool reads the `type` frontmatter field first to decide which
template to use. If `type` is missing or does not match a known
value, the entity falls through to the smart wiki fallback.

---

## Dedicated Templates

These entity types have purpose-built page layouts.

### PC (Player Character)

`type: pc`

| Field | Status | Description |
|-------|--------|-------------|
| `occupation` | Optional | Background or character class |
| `status` | Optional | active, retired, dead, npc |
| `key_traits` | Optional | List of defining traits (shown on PC card and landing page) |
| `player_name` | Optional | Real-world player name |
| `point_total` | Optional | Character point total (defaults to 200) |
| `portrait` | Optional | Path relative to vault root (e.g. `_attachments/characters/slug.jpg`) |

The PC template renders all body content as collapsible accordion
sections using the H2 headings as panel titles. Use H2 headings
in the vault file to divide the character sheet into sections
(e.g. `## Attributes`, `## Skills`, `## Equipment`).

---

### NPC (Non-Player Character)

`type: npc`

| Field | Status | Description |
|-------|--------|-------------|
| `occupation` | Optional | Role label (e.g. "Patron", "Antagonist", "Shopkeeper") |
| `nationality` | Optional | Origin or nationality |
| `status` | Optional | active, dead, missing, unknown |
| `age` | Optional | Character age |
| `rank` | Optional | Military or organizational rank |
| `portrait` | Optional | Path relative to vault root |

Body content renders below the header card. The `Relationships`
section in the body is excluded from the public site by default
(see `excludeSections` in `vault.config.json`).

---

### Location

`type: location`

| Field | Status | Description |
|-------|--------|-------------|
| `location_type` | Optional | Type label (e.g. "City", "Building", "Wilderness") |
| `parent_location` | Optional | `[[wiki-link]]` to the containing location |
| `security_level` | Optional | Security descriptor (rendered as badge) |
| `atmosphere` | Optional | Tone or mood of the location (rendered as badge) |
| `portrait` | Optional | Path relative to vault root |

The parent location renders as a breadcrumb above the page title
if the linked note can be resolved.

---

### Creature

`type: creature`

| Field | Status | Description |
|-------|--------|-------------|
| `hp` | Optional | Hit points or equivalent |
| `dr` | Optional | Damage resistance or armour value |
| `speed` | Optional | Movement rate |
| `sm` | Optional | Size Modifier |
| `st` | Optional | Strength |
| `dx` | Optional | Dexterity |
| `iq` | Optional | Intelligence |
| `ht` | Optional | Health |
| `creature_type` | Optional | Type label (rendered as badge) |
| `threat_level` | Optional | Threat rating (rendered as badge) |
| `abilities` | Optional | List of special abilities (rendered as bullet list) |
| `weaknesses` | Optional | List of vulnerabilities (rendered as bullet list) |
| `portrait` | Optional | Path relative to vault root |

The creature template renders a combat stat block at the top of
the page followed by body content. Intended for in-session lookup
during encounters.

---

### Item

`type: item`

| Field | Status | Description |
|-------|--------|-------------|
| `damage` | Optional | Damage value or dice |
| `dr` | Optional | Damage resistance (for armour items) |
| `weight` | Optional | Weight in relevant units |
| `cost` | Optional | Cost in campaign currency |
| `tl` | Optional | Tech Level |
| `item_type` | Optional | Type label (rendered as badge) |
| `rarity` | Optional | Rarity level (rendered as badge) |
| `current_holder` | Optional | `[[wiki-link]]` to current owner |
| `origin` | Optional | `[[wiki-link]]` to origin location or entity |
| `portrait` | Optional | Path relative to vault root |

Body content follows the stat block.

---

### Faction / Organization

`type: faction` or `type: organization`

Both factions and organizations use the same template.

| Field | Status | Description |
|-------|--------|-------------|
| `faction_type` | Optional | Type label (rendered as badge) |
| `alignment` | Optional | Faction alignment (rendered as badge) |
| `goals` | Optional | List of faction goals |
| `leadership` | Optional | `[[wiki-link]]` to leader entity |
| `territory` | Optional | `[[wiki-link]]` to home location |
| `resources` | Optional | Brief description of faction resources |
| `portrait` | Optional | Path relative to vault root (faction banner or insignia) |

The faction page also performs a reverse lookup: any entity in
the vault with a `member_of` or `assigned_to` relationship
pointing to this faction will be listed in a **Members** section.

---

## Smart Wiki Fallback

Any entity whose `type` does not match a dedicated template
renders using the smart wiki template. This template reads all
frontmatter fields and displays them as metadata badges above
the body content. No fields are required beyond `name`.

The types listed below are common smart-wiki entities.
Dedicated templates for them will be added in later versions.
Any other unrecognised `type` value also falls through here.

### Event

`type: event`

Badges rendered: `event_type`, `date`, `location`

### Clue

`type: clue`

Badges rendered: `clue_type`, `reliability`, `found_by`

### Document

`type: document`

Badges rendered: `document_type`, `author`, `classification`,
`date_written`

### Chapter

`type: chapter`

Badges rendered: `sort_order`

### Session

`type: session`

Badges rendered: `session_number`, `actual_date`, `status`,
`stage`

### Scene

`type: scene`

Badges rendered: `scene_type`, `status`

---

## Common fields

These fields are read by all templates if present:

| Field | Description |
|-------|-------------|
| `aliases` | List of alternate names used for wiki-link resolution |
| `canon_status` | DRAFT / AUTHORITATIVE / SUPERSEDED — SUPERSEDED entities render a redirect banner |
| `superseded_by` | `[[wiki-link]]` shown in the redirect banner if `canon_status` is SUPERSEDED |
| `relationships` | List of `{ target, type, description }` objects rendered as a Relationships section |
| `tags` | Used for NPC importance scoring on the landing page; not rendered on entity pages |

**Page title:** The page title is always derived from the vault
filename (without the `.md` extension), not from frontmatter. To
change a page's title, rename the file. To make a page findable
under alternate names, use the `aliases` field.

---

## Portrait paths

Portrait paths must be relative to the vault root and use
forward slashes. The `attachmentsDir` field in `vault.config.json`
sets the base folder (default: `_attachments`).

Example vault frontmatter:
```yaml
portrait: "_attachments/characters/alice-morgan.jpg"
```

Supported formats: `.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`,
`.svg`, `.avif`.

If a portrait file cannot be found at the given path, the portrait
area is hidden rather than showing a broken image.
