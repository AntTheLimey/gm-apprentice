# Reconcile

Shared procedure for reviewing vault content with the GM and
promoting canon status. Any skill can invoke this.

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

## Quick Scan — Fast Path

Before starting the full procedure, check three conditions:

1. **No unverified markers:** Zero `<!-- UNVERIFIED -->` markers
   in the Wrap-Up file
2. **No DRAFT conflicts:** Zero DRAFT entities that contradict
   existing AUTHORITATIVE entities on the same facts
3. **No unplayed prep:** No Plan file exists for this session
   (nothing to triage)

If all three pass, offer the fast path:

> "Straightforward session — no conflicts found, no unplayed
> prep. Promote all new entities to AUTHORITATIVE? (y/n)"

On GM confirmation:
- Set Wrap-Up `canon_status` to `AUTHORITATIVE`
- Promote all DRAFT entities from this session to AUTHORITATIVE
- Update session index `status` to `reviewed`
- Skip to step 5.5 (world evolution offer)

If any condition fails → proceed with the full 6-step procedure
below.

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
- Any `canon_status: DRAFT` content tied to this session

Present as a short inventory, not a wall of text.

### 2.5. World fact review

If the Wrap-Up file's `## GM Notes` section contains a
`### World Fact Findings` subsection (staged by session-wrapup),
review each finding with the GM.

For each finding, present the three-state prompt:

- **Canon** → create or update the relevant `_World/` domain
  file and entities. Example: new heritage confirmed → create
  `Heritages/{Name}.md` from `shared/templates/heritage.md`,
  add entry to `_World/heritages.md`, record in `_flags.md`
  canon section.
  If `_World/` doesn't exist, create it first (world-index.md
  + _flags.md stubs from shared/templates/).
- **Ignore** → add to `_flags.md` ignored section with date
  and context. Future flags on this topic are suppressed.
- **Defer** → add to `_flags.md` deferred section with session
  number and context. If the item was being re-surfaced
  (accumulated mentions), present the accumulated context:
  "The Old Empire has come up in 3 sessions now — should we
  flesh this out?"

One finding at a time. Wait for GM decision before continuing.
Record each resolution in the `## Reconciliation Context`
section (step 6).

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

### 5. Promote canon status

On GM approval:
1. Set Wrap-Up `canon_status` to `AUTHORITATIVE`
2. Update session index `status` to `reviewed`
3. Promote related entity `canon_status` from DRAFT
   to AUTHORITATIVE where GM confirmed content
   3b. Before finalizing each entity promotion, check the entity
       against active `_World/` rules (if `_World/` exists).
       If a world rule is violated:
       - Surface: "This NPC is 400 years old, but world rules
         say humans live 60-85 years. Is that intentional?"
       - **Yes, intentional** → promote with a note explaining
         the exception
       - **Correct it** → update the entity before promotion
       - **Defer** → promote but tag `needs_review: true`
4. Mark any contradicted content as `SUPERSEDED` with
   `superseded_by` reference

Do the bookkeeping immediately — don't leave a list for
the GM. Hand off to campaign-organizer if entity filing
is needed.

### 5.5. World evolution (conditional)

**Gate:** Only offer when reconciling the **most recent**
session. Check the session index for a `world_evolved` field
— if present and matching this session, skip.

> "Session is settled. Want to evolve the world — faction
> turns, consequence surfacing, foreshadowing review? This
> updates how the world responds to what just happened. (y/n)"

If the GM declines → skip to step 6.

If the GM accepts → read and follow
`ttrpg-expert/world-evolution.md`, skipping the Storage
Checkpoint (already established). Run the 6-step procedure:
thread state updates, faction turns, consequence surfacing,
foreshadowing review, discovery state updates, world state
changes. One item at a time, GM approves each — same
conversational style as the rest of reconcile.

**On completion:**
- Set `world_evolved: "Session_NN"` on the session index
  (current session reference)
- Entity files created or updated use
  `source: "world-evolution"`, with `lastUpdated` and
  `asOfSession` set to the current session
- Results feed into step 6's `## Reconciliation Context`
  under `### World Evolution`, containing:
  - Faction turn summaries (one line per faction: action,
    impact level, what's visible to PCs)
  - Surfaced consequences (trigger, manifestation)
  - Foreshadowing changes (ripeness updates, new plants)
  - Discovery state changes (per-PC knowledge shifts)
  - World state changes (calendar, environment, politics)

### 6. Record decisions

Write a `## Reconciliation Context` section capturing:
- **Consequences** — forward-looking summary of what this
  session established (every claim traceable to vault or
  play notes, no invention)
- **Salvageable prep** — disposition of each unplayed item
- **GM decisions** — each conflict resolution with rationale
- **World evolution** — if step 5.5 ran, include a
  `### World Evolution` sub-section with faction turn
  summaries, surfaced consequences, foreshadowing and
  discovery state changes, and world state updates

This section provides cross-conversation continuity.
Session-prep reads it to avoid re-gathering context.

**Where to write it:** Always in the Wrap-Up file under
`## Reconciliation Context` — session-prep reads this exact
header. If a Plan file exists, you may append a short pointer
(`See Wrap-Up for reconciliation context`) but the Wrap-Up
file is the canonical location.

## Rules

- **One conflict at a time.** Conversation, not report.
- **Never silently resolve.** Even obvious corrections need
  GM confirmation before writing.
- **Record as you go.** Write each resolution immediately
  after GM confirms. Don't batch.
- **Know when to stop.** If the GM says "good enough," stop.
  Partial review is better than no review.

## Companion References

- `shared/canon-status.md` — DRAFT/AUTHORITATIVE/
  SUPERSEDED states and promotion rules
- `shared/session-document-chain.md` — Document types,
  status transitions, skill ownership
- `shared/session-principles.md` — Shared session rules
- `ttrpg-expert/canon-management.md` — Full conflict
  detection and resolution workflow
- `ttrpg-expert/world-evolution.md` — Post-session world
  evolution procedure (faction turns, consequences,
  foreshadowing, discovery state)
