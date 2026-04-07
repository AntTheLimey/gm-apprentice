# Canonical Timeline — Benchmark Results

**Date:** 2026-04-06
**Model:** sonnet (agents), opus (evaluator)

## Metrics

| | Control | Test |
|---|:---:|:---:|
| Tokens | 8,731 | 28,584 |
| Time (s) | 13.9 | 56.0 |
| Tool uses | 0 | 3 |

## Quality Scores (15 max per question)

| Question | Control | Test | Delta |
|----------|:-------:|:----:|:-----:|
| Q1 Timeline entry + entities | 9 | 14 | +5 |
| Q2 Read-aloud recap | 7 | 13 | +6 |
| Q3 Fact-check Pell | 10 | 15 | +5 |
| Q4 Standalone setup | 11 | 14 | +3 |
| **Total** | **37** | **56** | **+19** |

## Analysis

Strongest overall benchmark so far. Average +4.75 per
question across all four.

**Q1 (+5):** Test produced a structured timeline entry with
Decisions/Introduced/Changed fields plus 8 entity updates
with named schema fields. Control produced a blockquote
and 4 brief bullet points.

**Q2 (+6):** Largest single-question delta. Control refused
to produce output ("I can't fill this in without your notes").
Test produced a complete read-aloud template with fill-in
brackets for sessions 3-4 and a fully written session 5
paragraph. Practical help vs learned helplessness.

**Q3 (+5, perfect 15/15):** Test provided a 3-step
verification protocol: check timeline Introduced/Changed
fields, check NPC entity createdSession, then raw notes.
If nothing found: create DRAFT entity with gmNotes flagging
"Player claims this — verify before AUTHORITATIVE." Control
suggested "search notes for Pell."

**Q4 (+3):** Test provided the full campaign/ directory
structure with entity subdirectories and named workflows
(world-evolution six-step checklist, entity-types.md
schema). Control suggested flat files (npcs.md, locations.md)
that would become unwieldy quickly.

## Evaluator Highlights

- Q2: "Delivers a usable template with fill-in brackets —
  produces useful output even when data is incomplete"
- Q3: "DRAFT entity with verification flag gives the GM a
  concrete in-session and post-session workflow" — 15/15
- Q4: "Full directory tree, named checklists, one-file-per-
  entity convention — GM can create this and start using it
  immediately"
