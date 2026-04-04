# Campaign Structure

Guide to organizing campaign content.

## Campaign Model

### Core Fields

| Field | Type | Description |
|-------|------|-------------|
| name | string | Campaign title |
| system_id | UUID | Game system used |
| description | string | Campaign overview |
| settings | JSONB | Custom configuration |

### Settings Examples

```json
{
    "startDate": "1925-03-15",
    "location": "Arkham, Massachusetts",
    "tone": "Pulp Horror",
    "playerCount": 4,
    "customRules": [
        "Pulp Cthulhu: Talents enabled"
    ]
}
```

## Session Management

### Session Lifecycle

```
PLANNED → COMPLETED
    ↓
  SKIPPED
```

### Session Fields

| Field | Type | Description |
|-------|------|-------------|
| session_number | integer | Sequential number |
| planned_date | date | Scheduled date |
| actual_date | date | When it happened |
| status | enum | PLANNED/COMPLETED/SKIPPED |
| prep_notes | text | GM preparation (GM-only) |
| planned_scenes | JSONB | Anticipated scenes |
| actual_notes | text | What happened |
| discoveries | JSONB | What players learned |
| player_decisions | JSONB | Key choices made |
| consequences | JSONB | Results of actions |

### Prep Notes Structure

```markdown
## Goals for Session
- Introduce Dr. Armitage
- Reveal first clue about cult

## Scenes Planned
1. Library research scene
2. Meeting with Dr. Armitage
3. Optional: Night watchman encounter

## NPCs to Prepare
- Dr. Armitage: Helpful but evasive
- Night Watchman: Suspicious

## Clues to Drop
- Letter in restricted section
- Armitage's nervous behavior
```

### Actual Notes Structure

```markdown
## What Happened
Players investigated the library, found the letter.
Armitage was more helpful than expected.
Night watchman was avoided entirely.

## Player Decisions
- Decided to trust Armitage
- Chose to research before confronting

## Consequences
- Armitage will provide more help
- Cult becomes aware of investigation
```

## Discovery Tracking

### Discovery Record

```json
{
    "entityId": "npc-uuid",
    "sessionId": "session-uuid",
    "howDiscovered": "Met during library investigation",
    "whatLearned": ["Name", "Occupation", "Location"],
    "stillHidden": ["Secret cult membership"]
}
```

### Discovery States

| State | Meaning |
|-------|---------|
| Unknown | Players have no knowledge |
| Mentioned | Name/existence known |
| Met | Direct interaction |
| Known | Significant information |
| Understood | Full understanding |

## Timeline Events

### Event Types

| Type | Description | Example |
|------|-------------|---------|
| historical | Past events | "Founding of Arkham" |
| campaign | Campaign events | "Murder at library" |
| session | Session events | "PCs arrived in town" |
| planned | Future events | "Ritual on solstice" |

### Date Precision

| Precision | Example | Use Case |
|-----------|---------|----------|
| exact | 1925-03-15 | Specific dates |
| approximate | ~1925-03-15 | Uncertain timing |
| month | 1925-03 | Month only known |
| year | 1925 | Year only known |
| unknown | null | No date information |

### Timeline Structure

```json
{
    "eventDate": "1925-03-15",
    "eventTime": "23:00",
    "datePrecision": "exact",
    "description": "The ritual begins",
    "entityIds": ["cult-uuid", "location-uuid"],
    "isPlayerKnown": false,
    "sourceDocument": "Cultist's diary"
}
```

## Campaign Organization

### Recommended Structure

```
Campaign
├── Core NPCs (10-20)
│   ├── Allies
│   ├── Antagonists
│   └── Neutral
├── Key Locations (5-15)
│   ├── Safe havens
│   └── Dangerous places
├── Major Factions (3-5)
├── Important Items (5-10)
├── Active Clues (varies)
└── Creatures (as needed)
```

### Tagging Strategy

| Tag | Purpose |
|-----|---------|
| `core` | Essential entities |
| `arc-1`, `arc-2` | Story arcs |
| `player-known` | Discovered by players |
| `deceased` | Dead NPCs |
| `destroyed` | Lost items/locations |
| `active` | Currently relevant |

## Best Practices

### Session Preparation

1. **Review previous session**
   Read actual notes from last session

2. **Update entity status**
   Reflect consequences in entities

3. **Plan flexible scenes**
   Prepare scenes, not scripts

4. **Prepare NPCs**
   Have stats and motivations ready

5. **Queue clues**
   Multiple paths to information

### Post-Session

1. **Record immediately**
   Write actual notes while fresh

2. **Update discoveries**
   Mark what players learned

3. **Track consequences**
   Note what should change

4. **Link timeline events**
   Create timeline entries

5. **Flag conflicts**
   Note any contradictions

### Long-Term Management

1. **Regular reviews**
   Check for stale information

2. **Resolve conflicts**
   Don't let conflicts accumulate

3. **Update relationships**
   Relationships change over time

4. **Archive completed arcs**
   Move finished content

5. **Backup regularly**
   Protect campaign data
