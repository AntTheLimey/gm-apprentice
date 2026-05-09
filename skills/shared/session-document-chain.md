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
play_date: null
in_game_date: null
status: planned
documents:
  plan: "[[Session NN - Title - Plan]]"
  play_notes: "[[Session NN - Title - Play Notes]]"
  wrap_up: "[[Session_NN_Wrap_Up]]"
scenes:
  - "[[Scene Title]]"
tags: []
---
```

**Date fields:** `play_date` is the real-world date the session
was played. `in_game_date` is the fictional in-world date. Both
must be parseable by JS `new Date()` — use formats like
`"August 11, 1814"`, `"June 12, 1814"`, or `"July 1814"`.
Do not include narrative time-of-day prefixes (e.g.,
"Evening, 11 August 1814") — those belong in prose, not
metadata.

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

### 4. Session Wrap-Up (`Session_NN_Wrap_Up.md`)

Canonical record: narrative recap, quick bullets, PC
carry-forward, world state changes, keeper checklist.
Starts DRAFT, promoted to AUTHORITATIVE via reconcile.

Filename uses zero-padded session number with underscores:
`Session_07_Wrap_Up.md`, `Session_12_Wrap_Up.md`. No session
title in the filename. The file lives in the session's own
directory (e.g., `Sessions/Session 07/Session_07_Wrap_Up.md`).

```yaml
---
type: session_wrap
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

Each session has its own directory inside the chapter's
Sessions/ folder:

```text
Chapters/Chapter N - Title/Sessions/
└── Session 01/
    ├── Session 01 - The Arrival.md           (index)
    ├── Session 01 - The Arrival - Plan.md
    ├── Session 01 - The Arrival - Play Notes.md
    └── Session_01_Wrap_Up.md
```

## Companion References

- `shared/session-principles.md` — Shared session rules
- `shared/canon-confidence.md` — DRAFT/AUTHORITATIVE/SUPERSEDED
- `shared/entity-schema.md` — Entity frontmatter schemas
- `shared/vault-structure.md` — Folder layout and naming
