# Index Template for `_meta/index.md`

Use this structure when creating or rebuilding the vault index.

```markdown
---
type: meta
purpose: vault-index
last_updated: YYYY-MM-DD
entity_count: 0
narrative_count: 0
stub_count: 0
---

## Narrative Structure

### Chapters
- [[Chapter 1 - Title]] (sessions: N, scenes: N, status: played)
- [[Chapter 2 - Title]] (sessions: N, scenes: N, status: in_progress)

### Active Session
- [[Session NN - Title]] (chapter: N, status: prepped)

## Entities by Type

### Characters
**PCs (N):**
- [[PC Name]] — brief descriptor

**NPCs (N):**
- [[NPC Name]] — role or location descriptor

### Locations (N)
- [[Location Name]] — chapter hub or parent location

### Factions & Organizations (N)
- [[Faction Name]] — brief descriptor

### Items & Artifacts (N)
- [[Item Name]] — brief descriptor

### Creatures (N)
- [[Creature Name]] — brief descriptor

### Events (N)
- [[Event Name]] — brief descriptor

### Documents (N)
- [[Document Name]] — brief descriptor

### Clues (N)
- [[Clue Name]] — brief descriptor

## Stubs (Needs Attention)
- [[Stub Name]] — type: X, needs: what's missing

## Recent Changes
- YYYY-MM-DD: Description of what changed
```

## Maintenance Rules

- After Organize: full rebuild from vault scan
- After Dissect: add new entries, update counts
- After Weave: update relationship-related metadata
- After any note creation/modification: incremental update
- Always update `last_updated` and counts in frontmatter
- The index is derived — if stale, delete and rebuild
