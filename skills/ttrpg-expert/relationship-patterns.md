# Relationship Patterns

Guide to modeling entity relationships.

## Relationship Structure

### Core Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| source_entity_id | UUID | Yes | Relationship from |
| target_entity_id | UUID | Yes | Relationship to |
| relationship_type | string | Yes | Type of connection |
| tone | string | No | Emotional quality |
| description | string | No | Context/details |
| bidirectional | boolean | No | Two-way relationship |
| strength | integer | No | Intensity (1-10) |

## Relationship Types

### Social Relationships

| Type | Description | Example |
|------|-------------|---------|
| knows | Acquaintance | Met at party |
| friend | Close relationship | Trusted ally |
| family | Blood relation | Father, cousin |
| married | Spouse | Husband, wife |
| romantic | Love interest | Dating, affair |
| rival | Competition | Business competitor |
| enemy | Hostile | Active opposition |

### Professional Relationships

| Type | Description | Example |
|------|-------------|---------|
| employer | Employs | Boss |
| employee | Works for | Staff member |
| colleague | Works with | Co-worker |
| mentor | Teaches | Professor |
| student | Learns from | Pupil |
| business | Business connection | Supplier |

### Organization Relationships

| Type | Description | Example |
|------|-------------|---------|
| member | Belongs to | Cult member |
| leader | Leads | Faction head |
| founder | Created | Started org |
| ally | Allied with | Friendly faction |
| rival | Competes with | Opposing faction |

### Location Relationships

| Type | Description | Example |
|------|-------------|---------|
| lives_in | Residence | Home |
| works_in | Employment location | Office |
| owns | Property | Landlord |
| frequents | Regular visitor | Regular at bar |
| guards | Protects | Watchman |

### Item Relationships

| Type | Description | Example |
|------|-------------|---------|
| owns | Possesses | Property owner |
| created | Made | Craftsman |
| seeks | Wants | Quest item |
| guards | Protects | Treasure guardian |

### Knowledge Relationships

| Type | Description | Example |
|------|-------------|---------|
| knows_about | Has information | Witness |
| studies | Researches | Scholar |
| fears | Afraid of | Phobia |
| worships | Religious devotion | Cultist |

## Relationship Tones

### Positive Tones

| Tone | Description |
|------|-------------|
| friendly | Warm, positive feelings |
| romantic | Love, attraction |
| respectful | Admiration, esteem |
| professional | Business-like, cordial |

### Negative Tones

| Tone | Description |
|------|-------------|
| hostile | Active animosity |
| fearful | Fear, dread |
| distrustful | Suspicion, doubt |
| contemptuous | Disdain, scorn |

### Neutral Tones

| Tone | Description |
|------|-------------|
| neutral | No strong feeling |
| unknown | Relationship unclear |
| complicated | Mixed feelings |

## Bidirectionality

### Symmetric Relationships

Bidirectional = true:

- `married` (both are married to each other)
- `friend` (mutual friendship)
- `colleague` (mutual work relationship)
- `rival` (mutual competition)

### Asymmetric Relationships

Bidirectional = false:

- `employer`/`employee` (different roles)
- `mentor`/`student` (different roles)
- `stalks` (not reciprocal)
- `fears` (not reciprocal)

## Relationship Strength

Scale of 1-10:

| Strength | Meaning |
|----------|---------|
| 1-2 | Weak, casual |
| 3-4 | Moderate |
| 5-6 | Significant |
| 7-8 | Strong |
| 9-10 | Defining |

## Modeling Patterns

### Family Networks

```
Grandfather ─┬─ Grandmother
             │
             ├─ Father ─┬─ Mother
             │          │
             │          ├─ Player Character
             │          └─ Sibling
             │
             └─ Uncle ─── Cousin
```

Relationships:
- Father → PC: `family` (parent)
- PC → Father: `family` (child)
- PC → Sibling: `family` (sibling), bidirectional
- PC → Cousin: `family` (cousin), bidirectional

### Faction Hierarchy

```
Faction Leader
     │
     ├── Lieutenant 1
     │      ├── Member A
     │      └── Member B
     │
     └── Lieutenant 2
            └── Member C
```

Relationships:
- Leader → Faction: `leader`, strength 10
- Lieutenant → Leader: `reports_to`
- Member → Faction: `member`
- Member → Lieutenant: `reports_to`

### Love Triangle

```
    Character A
      /     \
     /       \
Character B ─ Character C
```

Relationships:
- A → B: `romantic`, bidirectional
- A → C: `romantic`, bidirectional
- B → C: `rival`, bidirectional

## Best Practices

### When Creating Relationships

1. **Choose appropriate type**
   Use the most specific type that fits

2. **Set bidirectionality correctly**
   Consider if relationship is mutual

3. **Include context**
   Add description for non-obvious connections

4. **Consider tone**
   Emotional quality adds depth

5. **Update when things change**
   Relationships evolve in play

### When Querying Relationships

1. **Consider bidirectionality**
   Check both directions for bidirectional relationships

2. **Filter by type**
   Don't show all relationships at once

3. **Include entity details**
   Return enough context to understand

### Relationship Visualization

For network graphs:
- Node size: Entity importance
- Edge thickness: Relationship strength
- Edge color: Relationship tone
- Edge style: Bidirectional (solid) vs unidirectional (arrow)
