# Session Note Templates

Defaults for the documents session-prep writes; the vault's `_meta/`
files are authoritative once initialized. Frontmatter for every
document in the chain is in `shared/session-document-chain.md`.

## Session Index

Create it (frontmatter per `shared/session-document-chain.md` §1)
when the GM first plans a session. `in_game_date` may be an array for
a multi-day session.

## Reading the last Wrap-Up

Structure: `shared/templates/session-wrap.md`. Read
`### Handoff to session-prep` first, then `### What Carries Forward`
and `### World State` (all under the fenced `## GM Notes`). The
`## Narrative Recap` is the player-facing record — use it, never
regenerate it.

## Scene notes

For a standalone scene note in the chapter's `Scenes/` folder, read
`references/scene-note-template.md`.

## Session Plan

Archived after play — not deleted, and not updated except to append
Planned vs Played. The GM-facing blank is `shared/templates/session-plan.md`
(provisioned as `_Templates/_Template_Session_Plan.md`).

```markdown
---
type: session-plan
session: "[[Session NN - Title]]"
chapter: "[[Chapter N - Title]]"
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

Only **Situation:** and **Starts it:** are required. Use the other
labels where they earn their place and leave the rest out; never write
"N/A" to fill one. A routing or hub scene (a menu of where the party is
and what is available) owes neither required label: mark it with
"(routing)" or "(hub)" in its title, `Scene 0`, or
`**Type:** transition`.

### Scene 1: [Title]
**Type:** investigation | social | combat | chase | transition | horror | downtime | other
**Situation:** *(required)* One line. What is happening when the scene
opens — a thing in motion, not a theme or a lesson.
**Starts it:** *(required)* One line. The named NPC or household schedule
that brings the PCs here in the first sixty seconds, and what they want
from *this* PC. A scene that cannot answer this is not finished.
**Entities:** [[NPC]], [[Location]], [[Item]]
**NPCs**
- **[[Name]]:** wants X. Does Y if left alone. Two lines maximum.
**Points to land**
- [ ] A fact the GM must convey however the improv goes.
- [ ] Another. The scene is done when these are ticked.
**If the players...**
| Do | Then |
|---|---|
| A choice the table may make | What the situation does in reply |
| Nobody engages by [time] | What the NPCs do on their own |
**Complications**
- A curveball to drop when the scene sags. Two or three.

> Read-aloud: 2–4 sentences of objective sensory description addressed
> to the table. Never names one PC or dictates a feeling.

### Scene 2: [Title]
[Same structure]

## Contingency Scenes

Scenes that trigger on a player choice or a clock. Trigger and
consequences only.

### [Contingency Title]
**Trigger:** One line. What activates this scene.
**Then**
- What happens, as bullets. Promote to a full scene above only if it
  needs its own NPCs and Points to land.

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

[Per-PC estimated spotlight share and imbalance flags. Table or
bullets. Step 13.]

## Open Questions

Plot questions only ("Does Sophia know what her husband has
become?"), each with 2–3 seeds, sorted as in the skill's Stance. Kept
explicit and un-invented. A guess from a run without the GM lives
here, labelled **(apprentice guess — confirm)**, never in settled plan
content.

- [ ] [Unresolved question — who owns it, what's blocked until it's answered]

## Gaps & Actions

[Missing entities, stale files, structural issues. Step 16.]

## Planned vs Played

[Appended after the session by session-wrapup. Blank during prep.]

| Planned Scene | Status | Notes |
|---------------|--------|-------|
| [Scene Title] | Played / Modified / Skipped | Brief note |
| [Unplanned] [Title] | Played | Origin and note |
```
