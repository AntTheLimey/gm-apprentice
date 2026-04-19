# Session Note Templates

Templates for session notes at each lifecycle stage. These are
defaults — the vault's `_meta/` files are authoritative once
initialized.

## Prep Session Note

Created when the GM begins preparing for an upcoming session.
This is the "potential" document — it describes what *could*
happen, with branching possibilities.

```markdown
---
type: session
session_number: 7
chapter: "[[Chapter 3 - Vienna]]"
campaign: "Canticle of the End"
planned_date: null
actual_date: null
status: prepped
stage: draft
prep_notes: ""
actual_notes: ""
play_notes: ""
scenes:
  - "[[Scene - The Opera Approach]]"
  - "[[Scene - The Invitation]]"
  - "[[Scene - The Garden Encounter]]"
tags: [prep]
---

## Session Overview

Brief description of the session's dramatic purpose. What is this
session *about* dramatically? Not "the PCs go to the opera" but
"the investigators make first contact with Viennese high society
and get their first glimpse of the Brotherhood's influence."

## Previously On...

[Generated during Prep mode — a summary of the last played
session suitable for reading aloud.]

## Threads to Pick Up

- [Unresolved threads from previous sessions relevant to this one]
- [Player-stated intentions to follow up]
- [Consequences that should manifest]

## Planned Scenes

### Scene 1: [Title]
**Type:** investigation | social | combat | chase | horror | other
**Objective:** What should this scene accomplish narratively?
**Entities:** [[NPC]], [[Location]], [[Item]]
**Setup:** How is this scene initiated?
**Branching:** What choices do players face? Where do different
choices lead?

### Scene 2: [Title]
[Same structure]

## Contingency Scenes

Scenes that trigger based on player choices or timing rather
than being part of the default sequence.

### [Contingency Title]
**Trigger:** What causes this scene to activate?
[Same structure as planned scenes]

## NPC Quick Reference

| NPC | Role This Session | Key Detail | Location |
|-----|-------------------|------------|----------|
| [[Name]] | What they're doing | One memorable fact | Where |

## Session End Objectives

What should the GM try to accomplish before ending the session?
Not a railroad — a set of possible good stopping points.

- [Dramatic beat that makes a strong session-end cliffhanger]
- [Alternate stopping point if pace is slower]
- [Minimum viable progress for the session]
```

## Played Session Note (Post Wrap-up)

After wrap-up, the session note is updated with reality. The prep
plan remains visible for reference, but the actual events are what
matters going forward.

```markdown
---
type: session
session_number: 7
chapter: "[[Chapter 3 - Vienna]]"
campaign: "Canticle of the End"
planned_date: 2025-03-15
actual_date: 2025-03-15
status: played
stage: wrap_up
prep_notes: "See Planned Scenes below"
actual_notes: "See What Actually Happened below"
play_notes: "Raw notes in Play Notes section"
scenes:
  - "[[Scene - The Opera Approach]]"
  - "[[Scene - The Invitation]]"
  - "[[Scene - The Garden Encounter]]"
tags: [played, recap-done]
---

## Narrative Recap

[3-5 paragraphs of dramatic prose capturing the session's events.
Written for players to read or for campaign journaling.]

## Keeper Notes

### Scene-by-Scene Breakdown

**Scene: The Opera Approach** — Status: played
- What happened: [Factual account]
- Player decisions: [Key choices made]
- NPCs encountered: [[Name]], [[Name]]
- Clues found: [What was discovered]
- Clues missed: [What was available but not found]
- Mechanical events: [Skill rolls, SAN loss, combat, etc.]

**Scene: The Garden Encounter** — Status: skipped
- Reason skipped: Players chose to follow the diplomat instead
- Reusable? Yes — can trigger in Session 8 if players return
  to the gardens

**Scene: [Unplanned] The Alleyway Confrontation** — Status: played
- What happened: [Improvised scene details]
- Origin: Player initiative — Thomas followed the suspicious
  servant
- New entities: [[Hans the Footman]] (DRAFT)

### Player Decisions & Consequences

| Decision | Consequence (immediate) | Consequence (pending) |
|----------|------------------------|----------------------|
| Spared the cultist | Gained information about the ritual | Cultist may warn the Brotherhood |
| Accepted the Countess's invitation | Access to the diplomatic ball | Social obligation, reputation risk |

### Entity Changes

| Entity | Change | Status |
|--------|--------|--------|
| [[Hans the Footman]] | Created (improvised NPC) | DRAFT |
| [[Countess von Hagen]] | Updated relationship with PCs | AUTHORITATIVE |

## Planned vs Played

| Planned Scene | Status | Notes |
|---------------|--------|-------|
| The Opera Approach | Played | As planned |
| The Invitation | Modified | Players approached the host directly instead of waiting |
| The Garden Encounter | Skipped | Can reuse in Session 8 |
| [Unplanned] Alleyway | Played | Improvised from player initiative |

## Next Session Seeds

- The diplomatic ball (from the Countess's invitation) — needs
  full scene prep
- Hans the Footman — players want to find and question him again
- The Brotherhood now knows investigators are in Vienna (if the
  cultist warned them)
- Thomas's letter to Emma — player said they'd write it "tonight"
  in game time

## Raw Play Notes

[Unedited GM notes from during the session. Preserved as-is for
reference. Shorthand, fragments, and abbreviations are expected.]
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
source_confidence: DRAFT
tags: []
---

## Read-Aloud Text

[Atmospheric description the GM can read or paraphrase when the
scene begins. 2-4 sentences. Sensory details.]

## Setup

How does this scene begin? What brings the investigators here?

## NPC Motivations

For each NPC present, what do they want and what will they do?

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
