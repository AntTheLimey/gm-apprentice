# Baseline: ttrpg-expert

**Date:** 2026-04-10
**Model:** sonnet (agents), opus (evaluator)
**Questions:** Entity schema, NPC cult leader, faction with clock, clue with discovery state, thread entity

## Scores (6 agents across 3 runs)

| Run | A | B | Spread |
|-----|:-:|:-:|:------:|
| R1  | 68 | 71 | 3 |
| R2  | 64 | 68 | 4 |
| R3  | 69 | 66 | 3 |

All individual scores: 64, 66, 68, 68, 69, 71

**Mean:** 67.7
**Median:** 68
**Range:** 64-71 (variance: 7)

## Pass Criteria for Refactor

Post-refactor median must be ≥ 61 (baseline median minus variance).
A score below 61 indicates a regression beyond normal variance.
