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
Thousands of words of preamble is a defect, not thoroughness.
Scenes themselves are not word-capped — a scene runs as long as
its situation, initiator, branches, and mechanical notes earn;
cut bloat, not substance. Over ~1,200 words, sanity-check that
the length is load-bearing. `plan_check.py` measures these budgets
(`preamble`, `recap`, `scene-length`). -->

## Previously On...

[Narrative recap from session-wrapup, presented during prep.]

## Active Threads

[Carry-forward, stale threads, unfollowed clues, pending
consequences. Includes stale thread detection (3+ sessions). As
bullets, two lines each.]

## NPC Quick Reference

| NPC | Role This Session | Key Detail | Location |
|-----|-------------------|------------|----------|
| [[Name]] | What they're doing | One memorable fact | Where |

## World State

[In-game date, location, active threats, faction postures,
ticking clocks. As bullets, two lines each.]

## Planned Scenes

Scenes are checklists for improvisation, not prose to be read. Every
line is a bullet, a table row, or a one-line label. The only prose is
the read-aloud blockquote. Write for a Keeper who has forgotten the prep
conversation: name the document, the person, and the reason in the line
that uses them. Never "three papers on the tray"; always "Pargeter's
letter to Sir Nathaniel, Ashworth's chit to Adrien, and Harriet's note
to Meg arrive at breakfast". The GM teases the players; the plan never
teases the GM.

### Scene 1: [Title]
**Type:** investigation | social | combat | chase | transition | horror | downtime | other
**Situation:** One line. What is happening when the scene opens — a
thing in motion, not a theme or a lesson.
**Starts it:** One line. The named NPC or household schedule that brings
the PCs here in the first sixty seconds, and what they want from *this*
PC. A scene that cannot answer this is not finished.
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

Scenes that trigger on a player choice or a clock rather than by
default. Trigger and consequences only — bullets, not paragraphs.

### [Contingency Title]
**Trigger:** One line. What activates this scene.
**Then**
- What happens, as bullets. Promote to a full scene above only if it
  needs its own NPCs and Points to land.

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

Plot questions only — the calls that change what an NPC wants, knows or
does, a scene's shape, or what the players can discover ("Does Sophia
know what her husband has become?"). Each carries 2–3 seeds. Anything
else does not belong here: a player decision (which way they go, who
they take) is a `Do | Then` row in a scene; bookkeeping (a die result,
a sheet number, a date no scene turns on) is defaulted with the default
noted in one line; craft and cosmetics (fonts, prop layout, filenames)
are decided, never asked. Test: would a different answer change a scene
this session? If not, it is not a question for the GM. Kept explicit
and un-invented — never auto-filled. If the apprentice had to guess
(e.g. a headless run), the guess lives here, labelled **(apprentice
guess — confirm)**, never promoted into settled plan content.

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

The canonical structure lives in
`shared/templates/session-wrap.md` — read that file, not this
summary, before writing a Wrap-Up. Skeleton:

```markdown
---
type: session_wrap
session: "[[Session NN - Title]]"
session_number: N
chapter: "[[Chapter N - Title]]"
campaign: ""
play_date: null
in_game_date: null
source_document: "[[Session NN - Title - Play Notes]]"
canon_status: DRAFT
created_by: session-wrapup
reconciled: null
tags: []
---

# Chapter CC · Session NN — {Title} — Wrap-Up

> [!info] Source

## Narrative Recap
## Memorable Moments          <!-- optional, player-facing -->
## GM Notes
### Quick Bullets             <!-- optional -->
### PC Carry-Forward
#### [[PC Name]] (Player)
### What Carries Forward
#### Unresolved Threads
#### Player-Stated Intentions
#### Pending Consequences
#### NPCs Needing Follow-Up
#### Skipped Prep
### World State
### Keeper Checklist
### Name Conflicts (export vs. vault canon)   <!-- conditional -->
### Cross-Entity Claims       <!-- conditional -->
### World Fact Findings       <!-- conditional -->
### Quality Notes
### Handoff to session-prep
### Reconciliation Context    <!-- appended by reconcile -->
```

Everything under `## GM Notes` sits inside one
`<!-- gm-only -->` fence pair. Prep reads `### Handoff to
session-prep` first, then `### What Carries Forward` and
`### World State`; the recap is the player-facing record and
is never regenerated.

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
