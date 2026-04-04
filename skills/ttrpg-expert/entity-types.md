# Entity Types

Comprehensive guide to Imagineer entity types.

## Core Entity Types

### NPC (Non-Player Character)

People controlled by the Game Master.

**Common Attributes:**

| Attribute | Type | Description |
|-----------|------|-------------|
| occupation | string | Job or role |
| age | number | Character age |
| gender | string | Character gender |
| nationality | string | Origin/nationality |
| characteristics | object | Game-system stats |
| skills | array | Skill list |
| motivations | array | Goals and drives |
| secrets | string | Hidden information |

**Example:**

```json
{
    "name": "Dr. Henry Armitage",
    "type": "npc",
    "description": "Head librarian at Miskatonic University",
    "attributes": {
        "occupation": "Librarian",
        "age": 65,
        "characteristics": {
            "INT": 85,
            "EDU": 90
        },
        "skills": [
            {"name": "Library Use", "value": 90},
            {"name": "Occult", "value": 60}
        ]
    },
    "gmNotes": "Knows about the Necronomicon"
}
```

### Location

Places where action occurs.

**Common Attributes:**

| Attribute | Type | Description |
|-----------|------|-------------|
| locationType | string | Building, outdoor, etc. |
| address | string | Physical location |
| size | string | Scale description |
| atmosphere | string | Mood/feeling |
| inhabitants | array | Who's here |
| points_of_interest | array | Notable features |
| secrets | string | Hidden aspects |

**Example:**

```json
{
    "name": "Orne Library",
    "type": "location",
    "description": "Gothic library at Miskatonic University",
    "attributes": {
        "locationType": "Building",
        "address": "Miskatonic University, Arkham",
        "atmosphere": "Scholarly, dusty, ominous"
    }
}
```

### Item

Objects, artifacts, and equipment.

**Common Attributes:**

| Attribute | Type | Description |
|-----------|------|-------------|
| itemType | string | Weapon, book, artifact, etc. |
| value | string | Worth/rarity |
| origin | string | Where it came from |
| properties | object | Special abilities |
| currentHolder | string | Who has it |

**Example:**

```json
{
    "name": "The Necronomicon",
    "type": "item",
    "description": "Blasphemous tome of forbidden knowledge",
    "attributes": {
        "itemType": "Tome",
        "value": "Priceless",
        "properties": {
            "sanityLoss": "1d10/2d10",
            "mythosGain": "+15%"
        }
    }
}
```

### Faction

Groups with shared goals.

**Common Attributes:**

| Attribute | Type | Description |
|-----------|------|-------------|
| factionType | string | Cult, organization, etc. |
| goals | array | Objectives |
| resources | string | Available power |
| leadership | string | Who's in charge |
| territory | string | Area of influence |
| tier | number | Power level (FitD) |

**Example:**

```json
{
    "name": "The Esoteric Order of Dagon",
    "type": "faction",
    "description": "Cult serving the Deep Ones",
    "attributes": {
        "factionType": "Cult",
        "goals": ["Summon Deep Ones", "Convert Innsmouth"],
        "leadership": "Obed Marsh",
        "territory": "Innsmouth"
    }
}
```

### Clue

Investigation elements.

**Common Attributes:**

| Attribute | Type | Description |
|-----------|------|-------------|
| clueType | string | Physical, testimonial, etc. |
| foundAt | string | Location discovered |
| foundBy | string | Who found it |
| leadsTo | array | What it reveals |
| reliability | string | How trustworthy |

**Example:**

```json
{
    "name": "Bloodstained Letter",
    "type": "clue",
    "description": "Letter found at the crime scene",
    "attributes": {
        "clueType": "Physical",
        "foundAt": "Victim's study",
        "leadsTo": ["Cult meeting location"]
    }
}
```

### Creature

Monsters, supernatural beings.

**Common Attributes:**

| Attribute | Type | Description |
|-----------|------|-------------|
| creatureType | string | Species/category |
| size | string | Physical scale |
| abilities | array | Special powers |
| weaknesses | array | Vulnerabilities |
| sanityLoss | string | SAN loss on sight |
| stats | object | Combat statistics |

**Example:**

```json
{
    "name": "Deep One",
    "type": "creature",
    "description": "Amphibious fish-frog hybrid",
    "attributes": {
        "creatureType": "Mythos",
        "size": "Human-sized",
        "abilities": ["Amphibious", "Immortal"],
        "sanityLoss": "0/1d6"
    }
}
```

### Organization

Formal groups and institutions.

**Common Attributes:**

| Attribute | Type | Description |
|-----------|------|-------------|
| orgType | string | University, company, etc. |
| purpose | string | Mission/function |
| size | string | Number of members |
| resources | string | Available assets |
| notable_members | array | Important people |

### Event

Historical or plot moments.

**Common Attributes:**

| Attribute | Type | Description |
|-----------|------|-------------|
| eventType | string | Battle, ritual, meeting, etc. |
| date | string | When it happened |
| location | string | Where it happened |
| participants | array | Who was involved |
| outcome | string | What resulted |
| significance | string | Why it matters |

### Document

In-game texts and records.

**Common Attributes:**

| Attribute | Type | Description |
|-----------|------|-------------|
| docType | string | Letter, journal, map, etc. |
| author | string | Who wrote it |
| date | string | When written |
| content | string | The actual text |
| condition | string | Physical state |

## Entity Relationships

### Common Relationship Types

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

### Relationship Guidelines

1. Always set both source and target entities
2. Consider bidirectionality
3. Choose appropriate tone
4. Add descriptive context
5. Update when circumstances change

## Best Practices

### Entity Creation

1. Check for duplicates first
2. Use appropriate type
3. Include meaningful description
4. Add relevant tags
5. Set source confidence

### Entity Management

1. Track source documents
2. Update GM notes
3. Maintain relationships
4. Link to timeline events
5. Flag canon conflicts
