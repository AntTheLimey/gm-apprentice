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
  wrap_up: "[[Chapter_CC_Session_NN_Wrap_Up]]"
scenes:
  - "[[Scene Title]]"
world_evolved: null
tags: []
---
```

**Date fields:** `play_date` is the real-world date the session
was played — always `YYYY-MM-DD`. `in_game_date` is the fictional
in-world date; the published timeline sorts on it
(`tools/publish/lib/timeline.js`) by anchoring on a **4-digit year**,
and it accepts ISO dates, month-name dates (`"August 11, 1814"`,
`"July 1814"`), and seasonal phrases (`"Autumn 1813"`). Keep
narrative time-of-day out of the field (`"Evening, 11 August 1814"`
loses its date) — put it in prose.

For a **non-Earth calendar** (Forgotten Realms, stardates, invented
calendars), record the date in the world's own format — never
fabricate a Gregorian date to satisfy the parser. If the string
contains a 4-digit year it still sorts roughly by year; if it has
none it is left off the auto-built timeline (not an error) but still
appears on its own entity page.

**Status** reflects the furthest document that exists:

| Status | Meaning |
|--------|---------|
| planned | Index created, no other documents |
| prepped | Plan file exists |
| played | Play Notes file exists |
| wrap-up | Wrap-Up file exists |
| reviewed | GM has reviewed and confirmed the Wrap-Up |

**`world_evolved`:** Set by reconcile step 6.5 after the
world-evolution procedure completes. Value is the session
reference (e.g., `"Session_07"`). Null until world-evolution
runs. Prevents reconcile from re-offering world-evolution
for the same session.

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
canon_status: DRAFT
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
canon_status: AUTHORITATIVE
created_by: session-play    # or: vault-ingest | manual
tags: []
---
```

### 4. Session Wrap-Up (`Chapter_CC_Session_NN_Wrap_Up.md`)

Canonical record: narrative recap, quick bullets, PC
carry-forward, world state changes, keeper checklist.
Starts DRAFT, promoted to AUTHORITATIVE via reconcile.

Filename uses zero-padded chapter and session numbers with
underscores: `Chapter_03_Session_07_Wrap_Up.md`. No session
title in the filename. The chapter number is load-bearing, not
decorative — session numbers are unique only within a chapter,
and Obsidian wikilinks resolve by basename, so a title-free,
chapter-free `Session_07_Wrap_Up.md` collides the moment a
second chapter reaches its own session 7. The chapter number
guarantees the basename stays unique vault-wide regardless of
how session numbering itself is scoped. The file lives in the
session's own directory (e.g.,
`Sessions/Session 07/Chapter_03_Session_07_Wrap_Up.md`).

```yaml
---
type: session_wrap
session: "[[Session NN - Title]]"
chapter: "[[Chapter N - Title]]"
campaign: ""
canon_status: DRAFT
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
| reconcile | Wrap-Up file | Promotes canon status, session index | wrap-up → reviewed |
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
Chapters/Chapter 1 - Title/Sessions/
└── Session 01/
    ├── Session 01 - The Arrival.md           (index)
    ├── Session 01 - The Arrival - Plan.md
    ├── Session 01 - The Arrival - Play Notes.md
    └── Chapter_01_Session_01_Wrap_Up.md
```

## Companion References

- `shared/session-principles.md` — Shared session rules
- `shared/canon-status.md` — DRAFT/AUTHORITATIVE/SUPERSEDED
- `shared/entity-schema.md` — Entity frontmatter schemas
- `shared/vault-structure.md` — Folder layout and naming
