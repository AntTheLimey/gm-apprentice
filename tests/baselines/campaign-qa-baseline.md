# Baseline: campaign-qa

**Date:** 2026-04-10
**Model:** sonnet (agents), opus (evaluator)
**Questions:** Canon audit, timeline validation, name similarity, Three Clue Rule, graph health
**Campaign data:** tests/benchmark-campaign/

## Scores (6 agents across 3 runs)

| Run | A | B | Spread |
|-----|:-:|:-:|:------:|
| R1  | 62 | 66 | 4 |
| R2  | 66 | 67 | 1 |
| R3  | 61 | 67 | 6 |

All individual scores: 61, 62, 66, 66, 67, 67

**Mean:** 64.8
**Median:** 66
**Range:** 61-67 (variance: 6)

## Pass Criteria for Refactor

Post-refactor median must be ≥ 60 (baseline median minus variance).
A score below 60 indicates a regression beyond normal variance.
