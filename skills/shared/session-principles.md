# Session Principles

Shared rules for session-prep, session-play, session-wrapup.
Read on first invocation.

## Core Idea

Campaign content cycles between **potential** (GM's prep —
branching scenes, multiple futures) and **reality** (what
happened at the table). Wrap-up captures reality as canon.
Prep builds new potential on established reality.

## Absolute Rules

- **Never estimate scene durations.** No "45-60 minutes."
  Durations constrain the GM and kill creative play.

- **Read the PC roster first.** Before anything else, read
  `player_characters.md`. Know every PC, their player, and
  status (active/retired/dead/NPC). Getting status wrong
  is a serious error.

- **Characters are the story.** Foreground PC arcs. Campaign
  plot serves the characters, not the reverse. (Lazy DM
  Step 1, Sly Flourish.)

- **Wiki-link everything.** Every entity reference:
  `[[wiki-link]]`. NPCs, locations, items, factions,
  sessions, scenes — all linked.

- **Reality over plans.** Once played, the plan is dead.
  Unplayed prep is scrap — only mention if it contains
  critical clues players still need.

## Companion Skills

- **ttrpg-expert** — Content generation, rules reference,
  GM frameworks. Hand off when gaps need content. Key files:
  `arc-spotlight-reference.md` (arcs, spotlight, touchpoints),
  `npc-generation.md`, `continuity-engine.md` (Chekhov
  Protocol, Canon Grounding).

- **campaign-organizer** — Vault structure, entity filing.
  Hand off when work produces new entities. Dissect mode
  extracts entities from large documents.

- **campaign-qa** — Validation. Suggest QA after wrap-up
  or reconciliation. Thread/foreshadowing tracking:
  ttrpg-expert's `continuity-engine.md`.

## Vault Integration

Reads and writes to the campaign vault (Obsidian or plain
folder). All persistent state lives in the vault.

**First invocation:** Check for Obsidian MCP tools per
`shared/filesystem-mode.md`. Announce mode, confirm
campaign folder path.

**Key vault locations:**
- `_meta/index.md` — Master registry. Read first.
- `Chapters/Chapter N/Sessions/` — Session notes.
- `Chapters/Chapter N/Scenes/` — Scene notes.
- `_Campaign/Timeline.md` — Campaign timeline.
- `_Campaign/Player Characters.md` — PC roster.

**Shared references:**
- `shared/vault-structure.md` — Folder layout, naming.
- `shared/entity-schema.md` — Entity types, frontmatter,
  temporal fields, relationships.
- `shared/canon-confidence.md` — DRAFT/AUTHORITATIVE/
  SUPERSEDED states and promotion rules.
- `shared/session-document-chain.md` — Document chain
  standard: Plan, Play Notes, Wrap-Up as separate files.
- `shared/reconcile.md` — Shared review procedure for
  promoting Wrap-Up confidence.

**Session document chain:** Read `shared/session-document-chain.md`
for the full standard. Sessions use separate files for Plan,
Play Notes, and Wrap-Up, linked by a session index hub.

**Session index frontmatter:**

```yaml
---
type: session
session_number: N
chapter: "[[Chapter N - Title]]"
status: planned | prepped | played | wrap-up | reviewed
documents:
  plan: "[[Session NN - Title - Plan]]"
  play_notes: "[[Session NN - Title - Play Notes]]"
  wrap_up: "[[Session NN - Title - Wrap-Up]]"
---
```

Status reflects the furthest document that exists. The `wrap-up`
status is new — it means a Wrap-Up file exists but the GM has
not yet reviewed it via reconcile.

No "half-played" status. If the session ended early, status
is **played** and unplayed content carries forward.

**Scene status:** `planned | ready | played | skipped | modified | cut`

## Working with Play Notes

Accept all forms: raw shorthand, expanded notes, transcripts,
combinations. Don't correct grammar in stored notes. Extract
entities, events, decisions. Ask for clarification only when
genuinely ambiguous. Cross-reference against prep notes.

## Session Note Naming

Convention from `_meta/vault-config.md`.
Default: `Session {NN} - {Title}.md` (zero-padded, evocative).
Good: `Session 07 - The Opera and the Invitation.md`
Bad: `Session 7 - March 15 2025.md`

## Canon Workflow

Entity creation is automatic during wrap-up. Don't ask — do it.

```text
Play: entity mentioned → noted in play notes
Wrap-up: entity found → campaign-organizer
  → vault file (source_confidence: DRAFT)
  → wiki-linked into session note and related entities
```

GM promotes DRAFT → AUTHORITATIVE at their own pace.
See `shared/canon-confidence.md`.
