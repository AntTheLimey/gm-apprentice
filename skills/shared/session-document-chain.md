# Session Document Chain

Defines the session lifecycle document standard. Each session
splits into separate documents with clear ownership. All
session skills read this reference.

## Document Types

### 1. Session Index (`Session {NN} - {Title}.md`)

The hub. Metadata and links only — no prose content.

```yaml
---
type: session
session_number: N
chapter: "[[Chapter N - Title]]"
campaign: ""
planned_date: null
actual_date: null
status: planned
documents:
  plan: "[[Session NN - Title - Plan]]"
  play_notes: "[[Session NN - Title - Play Notes]]"
  wrap_up: "[[Session NN - Title - Wrap-Up]]"
scenes:
  - "[[Scene Title]]"
tags: []
---
```

**Status** reflects the furthest document that exists:

| Status | Meaning |
|--------|---------|
| planned | Index created, no other documents |
| prepped | Plan file exists |
| played | Play Notes file exists |
| wrap-up | Wrap-Up file exists |
| reviewed | GM has reviewed and confirmed the Wrap-Up |

### 2. Session Plan (`Session {NN} - {Title} - Plan.md`)

Written by session-prep. Contains scenes, NPCs, threads,
hooks, decision points, GM notes. Archived after play —
not deleted, not updated.

```yaml
---
type: session-plan
session: "[[Session NN - Title]]"
chapter: "[[Chapter N - Title]]"
campaign: ""
source_confidence: DRAFT
created_by: session-prep
tags: []
---
```

### 3. Play Notes (`Session {NN} - {Title} - Play Notes.md`)

Raw record of what happened. Written by GM during play
(session-play), reconstructed by vault-ingest, or entered
manually.

```yaml
---
type: session-play-notes
session: "[[Session NN - Title]]"
chapter: "[[Chapter N - Title]]"
campaign: ""
source_confidence: AUTHORITATIVE
created_by: session-play    # or: vault-ingest | manual
tags: []
---
```

### 4. Session Wrap-Up (`Session {NN} - {Title} - Wrap-Up.md`)

Canonical record: narrative recap, quick bullets, PC
carry-forward, world state changes, keeper checklist.
Starts DRAFT, promoted to AUTHORITATIVE via reconcile.

```yaml
---
type: session-wrap-up
session: "[[Session NN - Title]]"
chapter: "[[Chapter N - Title]]"
campaign: ""
source_confidence: DRAFT
created_by: session-wrapup
tags: []
---
```

For reconstructed content (from vault-ingest), include a
Reconstruction Note callout at the top of the document:

```markdown
> [!info] Reconstruction Note
> Reconstructed from [source descriptions] on [date].
> [limitations/gaps noted].
```

## Skill Ownership

| Skill | Reads | Writes | Status Transition |
|---|---|---|---|
| session-prep | Previous wrap-ups, vault | Plan file, session index | planned → prepped |
| session-play | Plan file | Play Notes file, session index | prepped → played |
| session-wrapup | Play Notes file | Wrap-Up file, entities, session index | played → wrap-up |
| reconcile | Wrap-Up file | Promotes confidence, session index | wrap-up → reviewed |
| vault-ingest | Old source material | Play Notes (reconstructed), session index | Then chains to wrapup → reconcile |

## Rules

1. **No skill writes to a document it doesn't own.**
2. **Documents are append/update, never replace.**
3. **The session index is the single source of truth for status.**
4. **Missing documents are normal.** Not every session has
   all four documents — especially reconstructed sessions.
5. **The chain is the same whether played yesterday or
   reconstructed.** Only `created_by` and reconstruction
   notes differ.

## File Layout

All session documents live in the chapter's Sessions/ folder:

```text
Chapters/Chapter N - Title/Sessions/
├── Session 01 - The Arrival.md           (index)
├── Session 01 - The Arrival - Plan.md
├── Session 01 - The Arrival - Play Notes.md
└── Session 01 - The Arrival - Wrap-Up.md
```

## Companion References

- `shared/session-principles.md` — Shared session rules
- `shared/canon-confidence.md` — DRAFT/AUTHORITATIVE/SUPERSEDED
- `shared/entity-schema.md` — Entity frontmatter schemas
- `shared/vault-structure.md` — Folder layout and naming
