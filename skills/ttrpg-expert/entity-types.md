# Entity Types

Schema guide for campaign entities. Used by ttrpg-expert and
campaign-organizer for filing and updating campaign state.

**System-specific field guidance:** schemas here are system-
agnostic. For system-specific stat blocks, skill formats, and
mechanical conventions, also read:
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

### Item

| Attribute | Type | Description |
|-----------|------|-------------|
| itemType | string | Weapon, book, artifact, etc. |
| value | string | Worth/rarity |
| origin | string | Provenance |
| properties | object | Special abilities |
| currentHolder | string | Who has it |

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

### Organization

| Attribute | Type | Description |
|-----------|------|-------------|
| orgType | string | University, company, etc. |
| purpose | string | Mission/function |
| size | string | Member count |
| resources | string | Available assets |
| notable_members | array | Important people |

### Event

| Attribute | Type | Description |
|-----------|------|-------------|
| eventType | string | Battle, ritual, meeting, etc. |
| date | string | When |
| location | string | Where |
| participants | array | Who |
| outcome | string | Result |
| significance | string | Why it matters |

### Document

| Attribute | Type | Description |
|-----------|------|-------------|
| docType | string | Letter, journal, map, etc. |
| author | string | Who wrote it |
| date | string | When written |
| content | string | The text |
| condition | string | Physical state |

## Entity Relationships

| Type | Example |
|------|---------|
| knows | NPC knows NPC |
| located_in | Item in Location |
| member_of | NPC in Faction |
| created_by | Item by NPC |
| witnessed | NPC witnessed Event |
| guards | Creature guards Location |
| leads | NPC leads Faction |
| owns | NPC owns Item |

Guidelines: set both source and target; consider bidirectionality;
add descriptive context; update when circumstances change.

## Best Practices

**Creation:** check for duplicates; use appropriate type;
include meaningful description; set source confidence.

**Management:** track source documents; update GM notes;
maintain relationships; link to timeline; flag canon conflicts.
