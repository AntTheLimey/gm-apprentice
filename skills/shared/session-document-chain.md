# Session Document Chain

Each session splits into separate documents, each owned by one skill.

## Document Types

### 1. Session Index (`Session {NN} - {Title}.md`)

The hub: metadata and links only, no prose.

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

**Date fields:** `play_date` is the real-world play date, always
`YYYY-MM-DD`. `in_game_date` is the fictional date; the published
timeline sorts it by its **4-digit year** and accepts ISO dates,
month-name dates (`"August 11, 1814"`, `"July 1814"`) and seasonal
phrases (`"Autumn 1813"`). Keep time-of-day out of the field
(`"Evening, 11 August 1814"` loses its date) — put it in prose. For a
non-Earth calendar, record the world's own format and never fabricate
a Gregorian date; without a 4-digit year it is left off the timeline
(not an error).

**Status** is the furthest document that exists:

| Status | Meaning |
|--------|---------|
| planned | Index created, no other documents |
| prepped | Plan file exists |
| played | Play Notes file exists |
| wrap-up | Wrap-Up file exists |
| reviewed | GM has reviewed and confirmed the Wrap-Up |

Derive/verify with `vault_check.py sessions`; fix with
`stamp_entities.py … --set status=…` (see `shared/vault-access.md`).

**`world_evolved`:** the session reference (e.g. `"Session_07"`) set by
reconcile step 6.5 once world evolution has run for it, so it is not
offered twice. Null until then.

### 2. Session Plan (`Session {NN} - {Title} - Plan.md`)

Written by session-prep: scenes, NPCs, threads, hooks, decision
points, GM notes. Archived after play — not deleted, not updated.

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

Raw record of what happened: written during play (session-play),
reconstructed by vault-ingest, or entered manually.

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

Canonical record of the session. Starts DRAFT, promoted to
AUTHORITATIVE via reconcile.

Filename: zero-padded chapter and session numbers, no title —
`Chapter_03_Session_07_Wrap_Up.md`, in the session's own directory
(`Sessions/Session 07/`). Never drop the chapter number: session
numbers repeat across chapters and Obsidian resolves links by
basename.

```yaml
---
type: session_wrap
session: "[[Session NN - Title]]"
session_number: N
chapter: "[[Chapter N - Title]]"
campaign: ""
play_date: null                # "YYYY-MM-DD"
in_game_date: null             # timeline format (see Session Index)
source_document: "[[Session NN - Title - Play Notes]]"
canon_status: DRAFT
created_by: session-wrapup
reconciled: null               # stamped "YYYY-MM-DD" by reconcile
tags: []
---
```

Keep both `session:` (link) and `session_number:` (scalar) —
consumers key on each.

**Body:** canonical in `shared/templates/session-wrap.md`
(provisioned as `_Templates/_Template_Session_WrapUp.md`). Two
player-facing sections — `## Narrative Recap` (the site's session
recap) and optional `## Memorable Moments` — then one `## GM Notes`
H2 inside a single `<!-- gm-only -->`/`<!-- /gm-only -->` pair holding
every Keeper-facing subsection at `###`. Keeper-facing content never
gets its own top-level H2: a novel H2 name is on no exclude list and
publishes to player sites.

A reconstructed session (vault-ingest) opens with a
`> [!info] Reconstruction Note` callout naming sources, date and gaps.

## Skill Ownership

| Skill | Reads | Writes | Status Transition |
|---|---|---|---|
| session-prep | Previous wrap-ups, vault | Plan file, session index | planned → prepped |
| session-play | Plan file | Play Notes file, session index | prepped → played |
| session-wrapup | Play Notes file | Wrap-Up file, entities, session index | played → wrap-up |
| reconcile | Wrap-Up file | Promotes canon status, session index | wrap-up → reviewed |
| vault-ingest | Old source material | Play Notes (reconstructed), session index | Then chains to wrapup → reconcile |

## Rules

1. **Each skill writes only the documents it owns.**
2. **Documents are append/update, never replace.**
3. **The session index is the single source of truth for status.**
4. **Missing documents are normal**, especially for reconstructed
   sessions.
5. **The chain is the same for played and reconstructed sessions**;
   only `created_by` and the reconstruction note differ.

## File Layout

```text
Chapters/Chapter 1 - Title/Sessions/
└── Session 01/
    ├── Session 01 - The Arrival.md           (index)
    ├── Session 01 - The Arrival - Plan.md
    ├── Session 01 - The Arrival - Play Notes.md
    └── Chapter_01_Session_01_Wrap_Up.md
```
