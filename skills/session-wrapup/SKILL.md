---
name: session-wrapup
description: "Use when a TTRPG session has just ended and the GM needs to process what happened — generating recaps, updating entity files, recording timeline events, and identifying what carries forward to the next session. This is the post-session workhorse that turns raw play notes into organized canon. Not for session prep (session-prep) or during-play help (session-play)."
---

Post-session processor. Turns raw play notes into organized
canon, updates the world, sets the stage for session-prep.

**Shared references:** Read `shared/session-principles.md` on
first invocation.

**Trigger phrases:** "session's over", "wrap up", "post-session",
"process my notes", "what happened today"

## Workflow

### 1. Gather Sources

Collect play notes, transcripts, GM notes. Read PC roster.
Read this session's prep note for planned-vs-actual comparison.

### 2. Narrative Recap

3-5 paragraphs of campaign prose. Dramatic, character names,
`[[wiki-links]]` for every entity. Tone-calibrate per
`references/recap-formats.md`. Also generate **Quick Bullets**
(5-8 points).

This recap is the **single source of truth**. Session-prep
reads it later — never regenerates. Write both formats into
the session note.

### 3. PC Carry-Forward

Per active PC, note what carries forward. Focus on **player
intent** — stated plans, unfinished actions, shifted NPC
relationships, exclusive information. Ground in observable
behaviour, not generated emotional analysis. Write into
session note.

### 4. Update the World

- **New entities** (improvised NPCs, locations, items):
  Create vault files immediately. Don't ask — do it.
  `source_confidence: DRAFT`. If session-play already saved
  provisional content, incorporate rather than recreate.

- **Updated entities**: Update the entity's own vault file.
  ONE file per entity. No separate "update" files.

- **Timeline**: Linked events:
  `- **{date}** — [[Event_Name]] — {summary}`.
  Inline events: `- **{date}** — {description}`.

- **Event decomposition**: Create Event entity files for
  moments meeting the threshold (≥2 of: changes entity state,
  multiple named participants, forward consequences, will be
  referenced from multiple entities). Use
  `campaign-organizer/references/event-template.md`.

**Receipt lifecycle:** Show new/updated entity content to the
GM **in the conversation** as `## New Entity Files` and
`## Updated Entities`. This is the review artifact. Do **NOT**
write these appendices into the session note file. Entity
files are the permanent record. Session note references
entities via wiki-links only.

Every entity reference: `[[wiki-link]]`.

### 5. What Carries Forward

Write into session note:
- Unresolved cliffhangers
- Player-stated intentions
- Unrealised consequences
- NPCs needing follow-up
- Skipped prep with critical clues players still need

### 6. World State

In-game date, location, active threats, faction postures,
ticking clocks. Brief. Write into session note.

### 7. Keeper Checklist

Concrete tasks for next prep. Write into session note:
scenes to write, GM decisions needed, rules to review,
handouts to prepare.

### 8. Quality Notes

Brief, honest: what worked in prep, what was missing,
what to adjust. Write into session note.

## Handoff Contract

The played session note hands off to session-prep. Wrap-up
**must** produce all sections so prep reads one file:

| Section | Required |
|---------|----------|
| Narrative Recap | Yes |
| Quick Bullets | Yes |
| PC Carry-Forward | Yes |
| What Carries Forward | Yes |
| World State | Yes |
| Keeper Checklist | Yes |

**Quality test:** Would a GM who hasn't looked at this
campaign in two weeks be able to prep from this note alone?

## Sub-agent Opportunity (Claude Code only)

Step 4 parallelizes well — entity creation, updates, and
timeline are independent writes. If Agent tool available,
spawn sub-agents (Sonnet/Haiku) for concurrent entity work.
If unavailable (e.g., Desktop), run sequentially.

## Recap Style Guide

Match campaign tone. Read chapter overview and recent notes.
- Character names, not player names
- Past tense for events, present for ongoing
- Highlight player decisions and consequences
- End with forward momentum
- Horror: atmospheric tension even in recaps
- Social/romance: center interactions and relationship shifts

See `references/recap-formats.md` for templates.
