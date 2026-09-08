# Index Template for `_meta/index.md`

`index_build.py` generates this file; the structure below is its output
contract.

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
  - [[Session 01]] (status: played)
    - plan: [[Session_01_Plan]]
    - play notes: [[Session_01_Play_Notes]]
    - wrap-up: [[Chapter_01_Session_01_Wrap_Up]]
  - [[Scene 01 - Title]] (status: ready)
- [[Chapter 2 - Title]] (sessions: N, scenes: N, status: in_progress)

### Active Session
- [[Session NN - Title]] (chapter: N, status: prepped)

### Plans (N)
- [[Plan Name]] — arc

## Entities by Type

### Characters

**PCs (N):**
- [[PC Name]] — brief descriptor
  - story: [[PC_Name_Story]]

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
- YYYY-MM-DD: index rebuilt — N entities, M narrative, K stubs
```

Sessions and scenes nest under their chapter; a session's own plan, play
notes, and wrap-up nest under that session in turn. A PC's `*_Story.md`
companion nests directly under the PC. Every `type: plan` entity gets its
own `### Plans (N)` line instead of appearing under Entities by Type. A
file the script can't place anywhere sensible — an orphaned chain
document, a Story file with no matching PC — surfaces under Stubs
instead of being dropped. A type outside this list (not one of the
sections above) gets its own `### Other` section, subgrouped by type.

## Maintenance Rules

- After Organize / Dissect / Weave / any note change: `index_build.py <vault> --write`
- The index is derived — if stale, delete and rebuild
