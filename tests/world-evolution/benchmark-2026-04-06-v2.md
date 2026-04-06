# World Evolution — Benchmark Results v2

**Date:** 2026-04-06
**Model:** sonnet (agents), opus (evaluators)
**Test version:** v2 — after output quality fixes (decisiveness
guidance, strengthened CoC faction turn module)

## Changes from v1

- Added "Output Quality" section to world-evolution.md:
  be decisive, name everyone, surprise the GM, write scenes
  not summaries, match system tone
- Strengthened CoC faction turn module: explicit "no clocks/
  ticks" warning, narrative heat levels (Unaware → Hostile),
  detailed NPC loyalty guidance, environmental Mythos signs

## Metrics

| | Control | Test v2 |
|---|:---:|:---:|
| Tokens | 10,710 | 44,123 |
| Time (s) | 57.0 | 124.7 |
| Tool uses | 0 | 7 |
| Overhead | 1x | ~4x tokens, ~2x time |

## Quality Scores (15 max per question)

| Question | Control | Test v2 | Delta |
|----------|:-------:|:-------:|:-----:|
| Q1 Warehouse break-in | 10 | 12 | +2 |
| Q2 Consequences | 10 | 12 | +2 |
| Q3 Thread triage | 10 | 12 | +2 |
| Q4 Discovery states | 12 | 13 | +1 |
| Q5 FitD factions | 10 | 15 | +5 |
| Q6 FitD Bluecoats | 12 | 15 | +3 |
| Q7 CoC cult | 11 | 14 | +3 |
| Q8 CoC Arkham | 10 | 14 | +4 |
| Q9 D&D power vacuum | 12 | 14 | +2 |
| Q10 D&D post-dragon | 11 | 14 | +3 |
| **Total** | **108** | **135** | **+27** |

## v1 → v2 Comparison

| Metric | v1 | v2 |
|--------|:--:|:--:|
| Test total | 120 | 135 |
| Control total | 128 | 108 |
| Delta (test - control) | -8 | **+27** |
| Swing | — | **+35** |

The output quality fixes flipped every single question from
v1. Biggest gains in CoC (Q7-Q8: +5, +7 swing) and D&D
(Q9-Q10: +5, +6 swing).

## Per-Dimension Analysis

**Where the test excels (scores 3/3):**
- Factual accuracy: 10/10 questions scored 3
- Actionability: 9/10 questions scored 3
- Mechanical grounding: 6/10 scored 3 (all system-specific)
- Table-ready fiction: 7/10 scored 3

**Consistent ceiling — system specificity:**
System-specific questions (Q5-Q10) all scored 2/3 on system
specificity except Q5-Q6 (FitD, both 3/3). CoC and D&D
modules don't prompt the agent to include system mechanics
(skill checks, SAN costs, CR values) in proposals. This is
the remaining improvement opportunity.

System-agnostic questions (Q1-Q4) inherently score 1/3 on
system specificity since no system is specified.

## Evaluator Highlights

- Q5 (FitD): "The clock ticking BACK because Red Sashes
  are too busy shoring losses is exactly the kind of non-
  obvious emergent consequence that makes faction play sing"
  — 15/15
- Q6 (FitD): "Masked Wardens enter building, seal cellar,
  emerge with contained vessel — vivid and evocative" — 15/15
- Q8 (CoC): "A flat-faced stranger near the library on two
  consecutive days is perfect slow-burn Lovecraftian dread"
  — 14/15
- Q10 (D&D): "The cargo manifest revealing the dead cleric
  ordered building materials three months ago — meaning the
  cleric knew something was coming — is genuinely brilliant"
  — 14/15

## Remaining Improvement Opportunities

1. **System-specific mechanical hooks** — CoC and D&D faction
   turn modules could prompt: "suggest relevant skill checks/
   SAN costs" (CoC) or "reference CR values and stat blocks"
   (D&D). Risk: may reintroduce checklist tone. Current
   scores are 14/15 without this.

2. **System-agnostic questions** inherently score low on
   system specificity. Could add a prompt to ask the GM what
   system they're using, but this is a test design issue not
   a framework issue.

3. **Evaluator variance** — single-run evaluations have noise.
   Future benchmarks should run 3x and average.
