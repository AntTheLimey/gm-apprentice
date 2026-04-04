# Canon Management

Guidelines for maintaining narrative consistency.

## Core Principles

### 1. Canon Integrity is Primary

The most important goal is maintaining consistent, trustworthy campaign data.
Conflicting information must be detected and surfaced, never silently resolved.

### 2. Human Resolution Required

Only the Game Master can decide which version of events is canon.
AI and automated systems detect conflicts; humans resolve them.

### 3. Source Tracking

Every piece of information should track where it came from.
This enables conflict detection and audit trails.

## Source Confidence Levels

### DRAFT

Initial entry, not yet confirmed as canon.

**When to use:**

- First import of content
- Player speculation
- Unverified information
- Work in progress

**Behavior:**

- Can be freely edited
- May be superseded without conflict
- Displayed with "unconfirmed" indicator

### AUTHORITATIVE

Confirmed as official canon.

**When to use:**

- GM-verified information
- Published source material
- Established in play
- Conflict resolution winner

**Behavior:**

- Editing creates version history
- Cannot be silently overwritten
- Conflicts require resolution

### SUPERSEDED

Replaced by newer information.

**When to use:**

- Retconned information
- Outdated version after update
- Conflict resolution loser
- Corrected errors

**Behavior:**

- Preserved in history
- Not shown in current views
- Available for reference

## Conflict Detection

### What Triggers Conflicts

1. **Same entity, different values**

   ```
   Entity "Dr. Smith"
   Source A: "Age: 45"
   Source B: "Age: 52"
   → Conflict detected
   ```

2. **Contradicting relationships**

   ```
   Entity "John"
   Source A: "Married to Mary"
   Source B: "Single"
   → Conflict detected
   ```

3. **Timeline inconsistencies**

   ```
   Event A: "Smith died in 1925"
   Event B: "Smith attended meeting in 1926"
   → Conflict detected
   ```

4. **Entity duplication**

   ```
   Entity "Dr. John Smith"
   Entity "John Smith, M.D."
   → Potential duplicate detected
   ```

### Conflict Record Structure

```json
{
    "id": "conflict-uuid",
    "campaignId": "campaign-uuid",
    "entityId": "entity-uuid",
    "fieldName": "age",
    "conflictingValues": [
        {"value": "45", "source": "Import from Evernote", "date": "2025-01-15"},
        {"value": "52", "source": "Session 5 notes", "date": "2025-01-20"}
    ],
    "status": "DETECTED",
    "resolution": null,
    "resolvedAt": null
}
```

## Conflict Resolution Workflow

### 1. Detection

System identifies conflicting information and creates conflict record.

### 2. Review

GM reviews conflict in UI:

- See both versions
- View sources
- Consider context

### 3. Decision

GM chooses authoritative version:

- Select winning value
- Add resolution notes
- Confirm decision

### 4. Update

System applies resolution:

- Winner marked AUTHORITATIVE
- Loser marked SUPERSEDED
- Conflict marked RESOLVED
- History preserved

## Implementation Guidelines

### When Creating Entities

```go
// Always check for similar names
existing, _ := FindSimilarEntities(campaignID, name)
if len(existing) > 0 {
    return PotentialDuplicate(existing)
}

// Set initial confidence
entity.SourceConfidence = "DRAFT"
entity.SourceDocument = importSource
```

### When Updating Entities

```go
// Check if changing AUTHORITATIVE data
if entity.SourceConfidence == "AUTHORITATIVE" {
    // Create conflict for review
    if valueChanged(existing, updated) {
        CreateConflict(entity, existing, updated)
        return PendingConflict
    }
}
```

### When Importing

```go
// Always track source
entity.SourceDocument = importFile

// Default to DRAFT
entity.SourceConfidence = "DRAFT"

// Check for existing
existing := FindByName(entity.Name)
if existing != nil {
    // Don't auto-resolve - create conflict
    return CreateConflict(existing, entity)
}
```

## Best Practices

### For Game Masters

1. **Review conflicts promptly**
   Don't let conflicts accumulate

2. **Document resolutions**
   Explain why one version is canon

3. **Promote to AUTHORITATIVE**
   Confirm important information

4. **Use GM notes**
   Track reasoning for decisions

### For Development

1. **Never auto-resolve**
   Surface conflicts, don't hide them

2. **Check before insert**
   Always look for duplicates

3. **Preserve history**
   Use SUPERSEDED, don't delete

4. **Track sources**
   Every update has a source

## Conflict Prevention

### Import Best Practices

- Use consistent naming
- Provide source documentation
- Review before finalizing
- Start as DRAFT

### Session Note Best Practices

- Reference existing entities
- Update, don't duplicate
- Note source session
- Flag uncertainties

### Entity Creation Best Practices

- Search before creating
- Use canonical names
- Include distinguishing details
- Link to sources
