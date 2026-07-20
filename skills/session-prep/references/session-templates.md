# Session Note Templates

Templates for session documents at each lifecycle stage. Each
session produces up to four documents in a chain (see
`shared/session-document-chain.md`). These are defaults — the
vault's `_meta/` files are authoritative once initialized.

## Session Index

The hub document. Metadata and links only — no body content.
Created when the GM first plans a session. Status is updated
as each downstream document is created.

```markdown
---
type: session
session_number: N
chapter: "[[Chapter N - Title]]"
campaign: ""
play_date: null             # real-world date session was played, YYYY-MM-DD
in_game_date: null          # In-game date(s): "YYYY-MM-DD" preferred; month-name/seasonal or non-Earth forms with a 4-digit year also sort (see shared/session-document-chain.md). Array allowed for multi-day.
status: planned
documents:
  plan: "[[Session NN - Title - Plan]]"
  play_notes: "[[Session NN - Title - Play Notes]]"
  wrap_up: "[[Chapter_CC_Session_NN_Wrap_Up]]"
scenes:
  - "[[Scene Title]]"
tags: []
---
```

## Session Plan

Created by session-prep. Contains all the preparatory material
for an upcoming session — scenes, NPCs, threads, hooks,
decision points. Archived after play (not deleted, not updated
except to append Planned vs Played).

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
prep — not decided by the apprentice. One or two sentences: what the GM
wants this session to be *about*, and whose moment it is. This governs
the spotlight and the scenes that follow. (E.g. "This one's Emma's — the
anklet debt finally comes due, and I want the Brotherhood to feel close
for the first time.")

## Session Overview

Short dramatic synopsis, derived from the Session Intent above. What is
this session *about* dramatically? Not "the PCs go to the opera" but
"the investigators make first contact with Viennese high society and get
their first glimpse of the Brotherhood's influence."

## Reconciliation Context

[Written by Phase 1 Reconcile. Absent for first sessions.]

### Consequences
[Forward-looking summary of what follows from last session]

### Salvageable Prep
[Unplayed prep: dropped / recycled / must-happen]

### GM Decisions
[Resolved decisions with outcomes, appended one at a time]

## Prior Prep Review

[If prior prep existed, summary of what was kept vs updated.]

<!-- Preamble discipline: the Keeper must reach the first scene
fast. Keep all pre-scene context below (Previously On, Active
Threads, NPC Quick Reference, World State) under ~1,000 words
combined; recap ≤150 words; NPC Quick Reference one line per NPC.
Thousands of words of preamble is a defect, not thoroughness.
Scenes themselves are not word-capped — a scene runs as long as
its situation, initiator, branches, and mechanical notes earn;
cut bloat, not substance. Over ~1,200 words, sanity-check that
the length is load-bearing. -->

## Previously On...

[Narrative recap from session-wrapup, presented during prep.]

## Active Threads

[Carry-forward, stale threads, unfollowed clues, pending
consequences. Includes stale thread detection (3+ sessions).]

## NPC Quick Reference

| NPC | Role This Session | Key Detail | Location |
|-----|-------------------|------------|----------|
| [[Name]] | What they're doing | One memorable fact | Where |

## World State

[In-game date, location, active threats, faction postures,
ticking clocks.]

## Planned Scenes

### Scene 1: [Title]
**Type:** investigation | social | combat | chase | horror | other
**Objective:** The *situation* this scene puts in front of the
players — a thing that is happening, not a lesson to land or a
feeling to produce. Name the pressure, not the theme. (Not "hand
a spy the perfect operational condition"; yes "Bruyère corners
the viscount to reminisce about a France neither has seen since
1801.")
**Entities:** [[NPC]], [[Location]], [[Item]]
**Setup:** Who brings this PC here in the first sixty seconds?
Name the NPC who initiates and what they want from *this* PC, or
the errand/schedule that sends them. Ensemble scenes: the
household schedule (a shared meal, a departure) is a valid
initiator. A scene that cannot answer this is not finished.
**Behaviours:** What the situation and its NPCs do on their own —
independent of the players, and how it escalates if the PCs do
nothing. Ask "what happens here if the characters never show up?"
The initiator opens the door; the behaviours keep it moving. This
is the engine that lets the scene survive any player choice — a
scene that only moves when a PC acts is fragile. (Sly Flourish's
"Behaviours"; a Front-style clock for anything on a timer.)
**Branching:** What choices do players face? Where do different
choices lead?
**Complications:** 2–3 curveballs held ready to spike tension when
the scene sags — a rival arrives, a PC is recognised, the contact
is being watched, the timer is discovered. Distinct from Behaviours
(the situation's default motion) and Branching (the players' own
choices): these are the GM's escalation toolkit, dropped when
needed, not scripted to a beat. (Sly Flourish's "Complications.")

### Scene 2: [Title]
[Same structure]

## Contingency Scenes

Scenes that trigger based on player choices or timing rather
than being part of the default sequence.

### [Contingency Title]
**Trigger:** What causes this scene to activate?
[Same structure as planned scenes]

## Session End Objectives

What should the GM try to accomplish before ending the session?
Not a railroad — a set of possible good stopping points.

- [Dramatic beat that makes a strong session-end cliffhanger]
- [Alternate stopping point if pace is slower]
- [Minimum viable progress for the session]

## PC Roster & Arcs

[Per-PC: arc stage, arc theme, next beat, A/B/C plot assignment.
Written during creative planning step 12.]

## Touchpoint Plan

[Per-PC touchpoint assignments with type, description, timing.
Coverage checklist. Written during step 13.]

## Spotlight Forecast

[Per-PC estimated spotlight share. Imbalance flags. Written
during step 13.]

## Open Questions

Calls the GM deferred, and anything the apprentice could not ground in
canon. Kept explicit and un-invented — never auto-filled. If the
apprentice had to guess (e.g. a headless run), the guess lives here,
labelled **(apprentice guess — confirm)**, never promoted into settled
plan content.

- [ ] [Unresolved question — who owns it, what's blocked until it's answered]

## Gaps & Actions

[Missing entities, stale files, structural issues. Written
during step 16.]

## Planned vs Played

[Appended after session by session-wrapup for archival
comparison. Left blank during prep.]

| Planned Scene | Status | Notes |
|---------------|--------|-------|
| [Scene Title] | Played / Modified / Skipped | Brief note |
| [Unplanned] [Title] | Played | Origin and note |
```

## Play Notes

Raw record of what happened during the session. Written by the
GM during play (via session-play), reconstructed by vault-ingest,
or entered manually. Preserved as-is — no editing or polishing.

```markdown
---
type: session-play-notes
session: "[[Session NN - Title]]"
chapter: "[[Chapter N - Title]]"
campaign: ""
canon_status: AUTHORITATIVE
created_by: session-play
tags: []
---

## Raw Play Notes

[Unedited GM notes from during the session. Preserved as-is.
Shorthand, fragments, and abbreviations are expected.]

## Entity Flags

[New entities spotted during play, flagged for wrap-up:]
- NEW-NPC: [[Name]] — brief note
- NEW-LOC: [[Name]] — brief note
- NEW-ITEM: [[Name]] — brief note
- UPDATE: [[Existing Entity]] — what changed
```

## Session Wrap-Up

Canonical record of what happened and what carries forward.
Written by session-wrapup from Play Notes. Starts DRAFT,
promoted to AUTHORITATIVE via reconcile.

```markdown
---
type: session_wrap
session: "[[Session NN - Title]]"
chapter: "[[Chapter N - Title]]"
campaign: ""
canon_status: DRAFT
created_by: session-wrapup
tags: []
---

## Narrative Recap

[3-5 paragraphs of dramatic prose capturing the session's events.
Written for players to read or for campaign journaling.]

## GM Notes

### Quick Bullets

- [One-line summary of each major event]
- [Key decisions made]
- [Important discoveries]
- [Significant mechanical outcomes]

### PC Carry-Forward

| PC | Arc Update | Open Threads | Next Beat |
|----|-----------|--------------|-----------|
| [[Name]] | What changed for this PC | Unresolved threads | What comes next |

### What Carries Forward

#### Active Threads
[Threads still in play, updated with this session's events]

#### New Clues & Hooks
[Information or hooks introduced this session]

#### Pending Consequences
[Decisions made this session that will have future effects]

#### Next Session Seeds
[Concrete starting points for the next session's prep]

### World State

[Updated in-game date, location, active threats, faction
postures, ticking clocks. Reflects post-session reality.]

### Keeper Checklist

- [ ] Entity files created/updated for all new and changed entities
- [ ] Scene notes updated with played/skipped status
- [ ] Session index status updated to wrap-up
- [ ] Carry-forward threads verified against play notes
- [ ] Canon status set correctly on all new files

### Quality Notes

[Self-assessment of the session: pacing, spotlight balance,
player engagement, what worked, what to improve.]
```

## Scene Note Template

Individual scene notes sit in the chapter's Scenes/ folder and
are referenced from session notes.

```markdown
---
type: scene
session: "[[Session 07 - The Opera and the Invitation]]"
chapter: "[[Chapter 3 - Vienna]]"
campaign: "Canticle of the End"
scene_type: social
status: planned
sort_order: 1
objective: "Investigators enter Viennese high society"
gm_notes: ""
entities:
  - "[[Countess von Hagen]]"
  - "[[Vienna State Opera]]"
  - "[[Graf von Sternberg]]"
connections:
  - "[[Scene - The Invitation]]"
canon_status: DRAFT
tags: []
---

## Read-Aloud Text

[Atmospheric description the GM can read or paraphrase when the
scene begins. 2-4 sentences. Sensory details.]

## Setup

How does this scene begin? What brings the investigators here?

## NPC Motivations & Behaviours

For each NPC present, what do they want and what will they do —
including what they do on their own timeline, independent of the
players? And the situation itself: what environmental or timed
pressure advances if no NPC acts (a fire spreading, a ritual
completing, a tide rising)? What happens here if the PCs never
show up? The scene should run on this behaviour, not on a
predicted PC response.

## Complications

What can go wrong? What creates dramatic tension?

## Resolution Paths

How might this scene end? List 2-4 plausible outcomes and where
each one leads.

## Mechanical Notes

Any skill checks, SAN rolls, or combat that might occur. Include
difficulty and consequences for success/failure.

## GM Notes

Private keeper notes: hidden information, connections to the
larger plot, things to foreshadow.
```
