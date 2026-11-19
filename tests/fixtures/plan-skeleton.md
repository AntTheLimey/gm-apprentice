---
type: session-plan
session: "[[Session 03 - Test]]"
chapter: "[[Chapter 1 - Test]]"
campaign: ""
canon_status: DRAFT
created_by: session-prep
tags: []
---

## Session Intent

The GM's stated purpose for *this* session, drawn out at the start of
prep. One or two sentences: what it is *about*, and whose moment it is.
Governs spotlight and scenes. (E.g. "This one's Emma's — the anklet
debt finally comes due, and I want the Brotherhood to feel close for
the first time.")

## Session Overview

Short dramatic synopsis derived from the Intent. Not "the PCs go to
the opera" but "the investigators make first contact with Viennese high
society and get their first glimpse of the Brotherhood's influence."

## GM Notes

<!-- Keeper-facing. Everything under this heading is hidden from a
     published player site by the default exclude, so new GM content
     belongs here rather than in a new top-level section. -->

### Reconciliation Context

[Written by Phase 1 Reconcile. Absent for first sessions.]

#### Consequences
[Forward-looking summary of what follows from last session]

#### Salvageable Prep
[Unplayed prep: dropped / recycled / must-happen]

#### GM Decisions
[Resolved decisions with outcomes, appended one at a time]

## Prior Prep Review

[If prior prep existed, summary of what was kept vs updated.]

<!-- Preamble discipline: the Keeper must reach the first scene
fast. Keep all pre-scene context below (Previously On, Active
Threads, NPC Quick Reference, World State) under ~1,000 words
combined; recap ≤150 words; NPC Quick Reference one line per NPC.
Scenes are not word-capped — a scene runs as long as its situation,
Starts it, the Do | Then table, and mechanical notes earn; cut bloat,
not substance. Over ~1,200 words, check the length is load-bearing.
`plan_check.py` measures these budgets (`preamble`, `recap`,
`scene-length`). -->

## Previously On...

[Narrative recap from session-wrapup.]

## Active Threads

[Carry-forward, stale threads (3+ sessions), unfollowed clues,
pending consequences. Bullets, two lines each.]

## NPC Quick Reference

| NPC | Role This Session | Key Detail | Location |
|-----|-------------------|------------|----------|
| [[Name]] | What they're doing | One memorable fact | Where |

## World State

[In-game date, location, active threats, faction postures,
ticking clocks. Bullets, two lines each.]

## Planned Scenes

Scenes are checklists for improvisation: every line a bullet, a table
row or a one-line label; the only prose is the read-aloud blockquote.
Name the document, the person and the reason in the line that uses
them — never "three papers on the tray"; always "Pargeter's letter to
Sir Nathaniel, Ashworth's chit to Adrien, and Harriet's note to Meg
arrive at breakfast". The GM teases the players; the plan never
teases the GM.

Required: **Situation:** and **Starts it:**. Expected, because the run
sheet is built from them: **Place:** on every scene (a link, or plain
words when no location note fits) and an **NPCs** block on any scene
with people in it. Use the other labels where they earn their place
and leave the rest out; never write "N/A" to fill one. A hub is any
scene holding a **Where they can go** block (a menu of where the party
can stand): it owes none of the four.

The first two scenes below are the template's skeletons, written out
once; `tests/test_plan_check.py` holds them equal to the template's.

<!-- scene-skeleton -->
### Scene 1: [Title]
**Situation:** *(required)* One line. What is happening when the scene
opens — a thing in motion, not a theme.
**Place:** [[Location]]
**Starts it:** *(required)* One line. The named NPC or household schedule
that brings the PCs here in the first sixty seconds, and what they want
from *this* PC.
**Entities:** [[NPC]], [[Location]], [[Item]]
**Handouts:** [[Document]] — what this scene hands over, and how
**NPCs**
- **[[Name]]:** wants X. Does Y if left alone.
**Points to land**
- [ ] A fact you must convey however the improv goes.
**If the players...**
| Do | Then |
|---|---|
| A choice the table may make | What the situation does in reply |
| Nobody engages by [time] | What the NPCs do on their own |
**Treasure**
- An item the scene holds, one per bullet.
**Complications**
- A curveball to drop when the scene sags.

> Read-aloud: 2–4 sentences of objective sensory description addressed to
> the table. Never names one PC or dictates a feeling.
<!-- /scene-skeleton -->

<!-- hub-skeleton -->
### Scene 0: [Title] (hub)
**Where they can go**
- **[[Location]]:** what is there, who is there ([[NPC]]), what changes when they arrive.
- **Plain name:** the same, when no location note fits.
- A lead in words — Scene 3
- [[Scene note]] — a lead to a scene that has its own Place.
<!-- /hub-skeleton -->

### Scene 2: The Harbour Office
**Situation:** The harbourmaster is burning ledgers before the tide.
**Place:** The harbour office, up the stairs from the quay.
**Starts it:** Mrs Orme waves the party in and asks them to hold the door.
**NPCs**
- **Mrs Orme:** wants the ledgers burnt before the tide.

### Scene 3: The Quiet Supper
- **Situation:** The Vicar hosts a supper where nobody mentions the missing boat.
- **Place:** [[The Vicarage]]
**Starts it:** The Vicar's housekeeper seats the party beside Harriet.
**NPCs**
- **[[The Vicar]]:** wants the boat not mentioned.

## Contingency Scenes

Scenes that trigger on a player choice or a clock. Trigger and
consequences only.

### [Contingency Title]
**Trigger:** One line. What activates this scene.
**Then**
- What happens, as bullets. Promote to a full scene above only if it
  needs its own NPCs and Points to land.

## Handouts & Props

[Every handout and prop this session delivers, built or not — one row
each, in scene order. Status is built, print or to build. If there are
none, write "No handouts or props."]

| Document | Scene | Status | Notes |
|----------|-------|--------|-------|
| [[Document]] | Scene 1 | to build | What it says, who hands it over |

## Session End Objectives

Possible good stopping points, not a railroad.

- [Dramatic beat that makes a strong session-end cliffhanger]
- [Alternate stopping point if pace is slower]
- [Minimum viable progress for the session]

## PC Roster & Arcs

[Per-PC: arc stage, arc theme, next beat, A/B/C plot assignment.
Bullets, two lines each. Step 12.]

## Touchpoint Plan

[Per-PC touchpoints: type, description, timing. Coverage checklist.
Bullets, two lines each. Step 13.]

## Spotlight Forecast

[Per-PC role and moment; none left blank. Table or bullets.
Step 13.]

## Open Questions

Plot questions only ("Does Sophia know what her husband has
become?"), each with 2–3 seeds, sorted as in the skill's Stance. Kept
explicit and un-invented. Bookkeeping takes its default where it
applies, with no note that it was defaulted; a value an entity or PC
sheet doesn't record is listed here for the GM as
`- [ ] **Missing:** {value, whose sheet}`, never guessed (no guess
marker needed). A guess
from a run without the GM lives here, labelled
**(apprentice guess — confirm)**, never in settled plan content.

- [ ] [Unresolved question — who owns it, what's blocked until it's answered]

## Gaps & Actions

[Missing entities, stale files, structural issues. Step 16.
Handouts go in Handouts & Props.]

## Planned vs Played

[Appended after the session by session-wrapup. Blank during prep.]

| Planned Scene | Status | Notes |
|---------------|--------|-------|
| [Scene Title] | Played / Modified / Skipped | Brief note |
| [Unplanned] [Title] | Played | Origin and note |
