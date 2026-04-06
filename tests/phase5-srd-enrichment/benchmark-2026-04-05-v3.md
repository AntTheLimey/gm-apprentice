# Phase 5 SRD Enrichment — Benchmark Results v3

**Date:** 2026-04-05
**Model:** sonnet (agents), opus (evaluator)
**Test version:** v3 — CoC files adapted to 7e terminology
**Changes from v2:** Complete CoC 7e adaptation — skill names,
Dodge=DEX/2, occupations (not professions), sanity/luck/pushing,
chargen methods (dice/points/array), combat flow

## CoC v3 Results

| Question | Control | Test v3 | Delta |
|----------|:-------:|:-------:|:-----:|
| Q1 Dodge | 9/12 | 12/12 | +3 |
| Q2 Doctor NPC | 10/15 | 15/15 | +5 |
| Q3 Innsmouth | 9/15 | 14/15 | +5 |
| Q4 Archaeologist | 10/15 | 14/15 | +4 |
| Q5 Creature | 9/15 | 15/15 | +6 |
| **Total** | **47/72** | **70/72** | **+23** |

Tokens: 42,988 | Time: 50.7s | Tool uses: 6

## Cross-Version Comparison (CoC only)

| Version | Delta | Key issue |
|---------|:-----:|-----------|
| v1 | +8 | BRP-generic files; modest improvement |
| v2 | -18 | BRP terms confused model; REGRESSION |
| **v3** | **+23** | **CoC 7e terms fixed everything** |

## Evaluator Highlights

- Q2 NPC: "A Keeper can photocopy this and run it tonight" (15/15)
- Q5 Creature: "A Keeper can run this encounter from these
  notes alone" (15/15)
- Q4 Archaeologist: "Correctly identifies EDU x 4, Credit
  Rating 10-40, base values for skills — the information a
  player actually needs during character creation"
- Q1 Dodge: "Nails the formula and adds the exact rules a
  Keeper reaches for mid-combat"

## All Systems Summary (latest version per system)

| System | Version | Control | Test | Delta |
|--------|---------|:-------:|:----:|:-----:|
| CoC | v3 | 47 | 70 | +23 |
| FitD | v2 | 46 | 62 | +16 |
| D&D | v2 | 56 | 65 | +9 |

Note: Scores not directly comparable across systems due to
different evaluator runs. Deltas within each run are the
meaningful metric.

## Lesson Learned

Using a generic system's reference files (BRP ORC) for a
specific game (CoC 7e) is WORSE than having no files at all.
The model's training data knows CoC 7e better than BRP-generic
files can teach it. System-specific terminology and formulas
are essential — they must match what the GM expects to see.
