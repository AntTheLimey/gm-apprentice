# Baseline: session-lifecycle

**Date:** 2026-04-10
**Model:** sonnet (agents), opus (evaluator)
**Questions:** Post-session summary, narrative recap, entity update sweep, prep reconciliation, carry-forward threads
**Campaign data:** tests/benchmark-campaign/

## Scores (6 agents across 3 runs)

| Run | A | B | Spread |
|-----|:-:|:-:|:------:|
| R1  | 67 | 65 | 2 |
| R2  | 71 | 68 | 3 |
| R3  | 64 | 69 | 5 |

All individual scores: 64, 65, 67, 68, 69, 71

**Mean:** 67.3
**Median:** 67.5
**Range:** 64-71 (variance: 7)

## Pass Criteria for Refactor

Post-refactor median must be ≥ 61 (baseline median minus variance).
A score below 61 indicates a regression beyond normal variance.
