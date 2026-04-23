# Reconcile

Shared procedure for reviewing vault content with the GM and
promoting canon confidence. Any skill can invoke this.

## When to Call

- **session-wrapup** — after producing a Wrap-Up file, walk
  GM through review before closing out
- **session-prep** — fallback when previous session is at
  `wrap-up` status (not yet `reviewed`)
- **vault-ingest** — after each ingested Wrap-Up is generated
- **standalone** — GM surfaces a contradiction or wants to
  review specific content ("these notes contradict Session 3")

Skip for first sessions or when status is already `reviewed`.

## Prerequisites

Before starting, have:
- The target Wrap-Up file path
- Access to related entity files and timeline entries
- The session index file for status updates

## Procedure

### 1. Load the target

Read the Wrap-Up file. Read related entity files, timeline
entries, and any linked scene notes. Build a picture of what
this session established. *(reads only — no writes yet)*

### 2. Highlight uncertain areas

Surface everything that needs GM attention:
- `<!-- UNVERIFIED -->` markers in the Wrap-Up
- Reconstruction notes (`> [!info] Reconstruction Note`)
- DRAFT entities created during wrap-up
- Timeline entries with uncertain dates or ordering
- Any `source_confidence: DRAFT` content tied to this session

Present as a short inventory, not a wall of text.

### 3. Walk through conflicts

One conflict at a time. For each:
1. Show both versions (what the Wrap-Up says vs what the
   vault says, or two contradicting sources)
2. Explain the discrepancy in one sentence
3. Propose a resolution
4. **Wait for GM decision before moving on**

Each answer shapes the next question. This is a conversation,
not a report.

### 4. Salvageable prep triage

If a Plan file exists for this session, scan unplayed content.
For each unplayed element, ask the GM:

| Disposition | Meaning |
|-------------|---------|
| **drop** | No longer relevant, discard |
| **recycle** | Reuse in a future session |
| **must-still-happen** | Critical clue or event players still need |

Flag `must-still-happen` items prominently — these carry
forward into the next session's prep.

### 5. Promote confidence

On GM approval:
1. Set Wrap-Up `source_confidence` to `AUTHORITATIVE`
2. Update session index `status` to `reviewed`
3. Promote related entity `source_confidence` from DRAFT
   to AUTHORITATIVE where GM confirmed content
4. Mark any contradicted content as `SUPERSEDED` with
   `superseded_by` reference

Do the bookkeeping immediately — don't leave a list for
the GM. Hand off to campaign-organizer if entity filing
is needed.

### 6. Record decisions

Write a `## Reconciliation Context` section capturing:
- **Consequences** — forward-looking summary of what this
  session established (every claim traceable to vault or
  play notes, no invention)
- **Salvageable prep** — disposition of each unplayed item
- **GM decisions** — each conflict resolution with rationale

This section provides cross-conversation continuity.
Session-prep reads it to avoid re-gathering context.

**Where to write it:** In the session's prep note if one
exists (session-prep reconcile flow). Otherwise append to
the Wrap-Up file itself.

## Rules

- **One conflict at a time.** Conversation, not report.
- **Never silently resolve.** Even obvious corrections need
  GM confirmation before writing.
- **Record as you go.** Write each resolution immediately
  after GM confirms. Don't batch.
- **Know when to stop.** If the GM says "good enough," stop.
  Partial review is better than no review.

## Companion References

- `shared/canon-confidence.md` — DRAFT/AUTHORITATIVE/
  SUPERSEDED states and promotion rules
- `shared/session-document-chain.md` — Document types,
  status transitions, skill ownership
- `shared/session-principles.md` — Shared session rules
- `ttrpg-expert/canon-management.md` — Full conflict
  detection and resolution workflow
