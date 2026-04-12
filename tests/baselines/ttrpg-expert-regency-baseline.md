# Baseline: ttrpg-expert (Regency Cthulhu)

**Date:** 2026-04-12
**Model:** sonnet (agents), opus (evaluator)
**Questions:** Regency Gentleman chargen, skill replacements,
social mechanics at ball, base CoC PI (cross-cutting),
base CoC skill lookup (cross-cutting)

## Scores (6 agents across 3 runs)

| Run | A | B | Spread |
|-----|:-:|:-:|:------:|
| R1  | 65 | 72 | 7 |
| R2  | 71 | 68 | 3 |
| R3  | 69 | 71 | 2 |

All individual scores: 65, 68, 69, 71, 71, 72

**Mean:** 69.3
**Median:** 70
**Range:** 65-72 (variance: 7)

## Pass Criteria

Post-change median must be >= 63 (baseline median minus variance).
A score below 63 indicates a regression beyond normal variance.

## Per-Question Patterns

- **Q1 (Regency chargen):** Main variance source. Point arithmetic
  errors and CR/living-standard mismatches account for most deductions.
- **Q2 (skill replacements):** Consistently strong (14-15/15).
  Overlay routing works reliably.
- **Q3 (social mechanics):** Strongest question (15/15 in 2 of 3 runs).
  GM guidance file clearly effective.
- **Q4 (base CoC PI):** Cross-cutting — scores 10-14. No Regency
  contamination observed. Base CoC chargen unaffected.
- **Q5 (base CoC skills):** Cross-cutting — scores 14-15. Drive Auto
  and Electrical Repair correctly returned from base files. No
  contamination from Regency unavailable list.

## Non-Regression: ttrpg-expert (base)

Ran 1 confirmation run against existing benchmark questions
(entity schema, NPC cult leader, faction, clue, thread).
Response quality consistent with baseline (pass threshold >= 61).
No regression detected.

## Observations

- Regency overlay routing works correctly — Regency questions
  pull from variant files, base CoC questions use base files only.
- Q2 and Q3 (the most overlay-dependent questions) score highest,
  confirming the overlay content quality.
- Cross-cutting questions (Q4, Q5) show no Regency contamination,
  confirming the overlay model doesn't pollute base CoC responses.
- Variance (7) matches the base ttrpg-expert baseline exactly.
