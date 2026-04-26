---
name: session-wrapup
description: "Use when a TTRPG session has just ended and the GM needs to process what happened — generating recaps, updating entity files, recording timeline events, and identifying what carries forward to the next session. This is the post-session workhorse that turns raw play notes into organized canon. Not for session prep (session-prep) or during-play help (session-play)."
---

Post-session processor. Turns raw play notes into organized
canon, updates the world, sets the stage for session-prep
via the Wrap-Up file.

**Shared references:** Read `shared/session-principles.md` on
first invocation.

**Version check:** On first invocation, read
`gm_apprentice_version` from `_meta/vault-config.md` and
`current_version` from `shared/migrations.md`. If the vault
version is lower or absent, announce the mismatch and hand off
to campaign-organizer's migration workflow
(`campaign-organizer/references/migration-procedure.md`) before
proceeding with wrap-up. Resume after migration completes. Skip
this check if `_meta/` doesn't exist (that's first-time setup,
not migration).

**Document chain:** Read `shared/session-document-chain.md`.
Session-wrapup reads the Play Notes file and writes the Wrap-Up
file. It also creates/updates entity files and timeline entries.

**Trigger phrases:** "session's over", "wrap up", "post-session",
"process my notes", "what happened today"

## Workflow

### 1. Gather Sources

Read the session's Play Notes file (`type: session-play-notes`).
If no Play Notes file exists, ask the GM to provide play notes
(paste, file path, or dictation). Read PC roster. Read the
session's Plan file for planned-vs-actual comparison.

### 2. Narrative Recap

3-5 paragraphs of campaign prose. Dramatic, character names,
`[[wiki-links]]` for every entity. Tone-calibrate per
`references/recap-formats.md`. Also generate **Quick Bullets**
(5-8 points).

This recap is the **single source of truth**. Session-prep
reads it later — never regenerates. Write both formats into
the Wrap-Up file.

### 3. PC Carry-Forward

Per active PC, note what carries forward. Focus on **player
intent** — stated plans, unfinished actions, shifted NPC
relationships, exclusive information. Ground in observable
behaviour, not generated emotional analysis. Write into
Wrap-Up file.

### 3b. Character Story Entries

For each active PC in the session, append a story entry to
their companion file. Read `shared/character-story-format.md`
for the full format, voice, and append protocol.

1. Look for `Characters/PCs/{Name}_Story.md` — if it doesn't
   exist, create from `shared/templates/character-story.md`
2. Determine the campaign's genre voice from the campaign
   overview or world file
3. Write 2–4 paragraphs of narrative prose: what this PC did,
   decided, learned, and how they changed — from this
   character's perspective, not a session recap
4. Append as `## Session {N} — {Session Title}` at the bottom
5. Update frontmatter: `lastUpdated` and `asOfSession` to
   current session; `source_confidence` mirrors the Wrap-Up
   file's confidence

**Input:** Narrative Recap (Step 2) and PC Carry-Forward
(Step 3). No new source gathering.

**Output:** One appended entry per active PC's story file.

Writes for the current session only — no backfilling. If prior
sessions are missing from a story file, that's vault-ingest
territory. Never edit prior session entries (append-only).

### 4. Update the World

- **New entities** (improvised NPCs, locations, items):
  Read `_Templates/_Template_{Type}.md` first, then create
  the vault file using that template as the structure.
  Don't ask — do it. `source_confidence: DRAFT`. If
  session-play already saved provisional content, incorporate
  rather than recreate. Never pattern-match off existing
  entity files — the template is canonical.

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
write these appendices into the Wrap-Up file. Entity
files are the permanent record. The Wrap-Up file references
entities via wiki-links only.

Every entity reference: `[[wiki-link]]`.

### 5. What Carries Forward

Write into Wrap-Up file:
- Unresolved cliffhangers
- Player-stated intentions
- Unrealised consequences
- NPCs needing follow-up
- Skipped prep with critical clues players still need

### 6. World State

In-game date, location, active threats, faction postures,
ticking clocks. Brief. Write into Wrap-Up file.

### 7. Keeper Checklist

Concrete tasks for next prep. Write into Wrap-Up file:
scenes to write, GM decisions needed, rules to review,
handouts to prepare.

### 8. Quality Notes

Brief, honest: what worked in prep, what was missing,
what to adjust. Write into Wrap-Up file.

### 9. Review (Reconcile)

Invoke `shared/reconcile.md` to walk the GM through reviewing
the Wrap-Up. On approval, reconcile promotes session status to
`reviewed` and Wrap-Up confidence to AUTHORITATIVE.

If the GM defers review ("I'll look at it later"), leave status
at `wrap-up`. Session-prep will invoke reconcile as a fallback
when the GM next preps.

## Handoff Contract

The Wrap-Up file hands off to session-prep (via reconcile).
Wrap-up **must** produce all sections so prep reads one file:

| Section | Required | Written to |
|---------|----------|------------|
| Narrative Recap | Yes | Wrap-Up file |
| Quick Bullets | Yes | Wrap-Up file |
| PC Carry-Forward | Yes | Wrap-Up file |
| What Carries Forward | Yes | Wrap-Up file |
| World State | Yes | Wrap-Up file |
| Keeper Checklist | Yes | Wrap-Up file |

Entity files and timeline are updated separately (Step 4).
Character story files are updated separately (Step 3b).
The session index is updated to `wrap-up` status (or `reviewed`
if reconcile completes).

## Sub-agent Opportunity (Claude Code only)

Step 4 parallelizes well — entity creation, updates, and
timeline are independent writes. If Agent tool available,
spawn sub-agents (light model) for concurrent entity work.
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
