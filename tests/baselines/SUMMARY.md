# Baseline Summary — All 4 Skills

**Date:** 2026-04-10
**Purpose:** Establish quality baselines before shared-refs + filesystem-fallback refactor
**Methodology:** 3 runs per skill, 2 agents per run (sonnet), blind evaluation (opus), 5-dimension rubric (15 pts/question, 75 pts max)
**Campaign data:** tests/benchmark-campaign/ (synthetic CoC 7e campaign, 19 files, 6 deliberate problems)

## Results

| Skill | Median | Mean | Range | Variance | Pass Threshold |
|-------|:------:|:----:|:-----:|:--------:|:--------------:|
| ttrpg-expert | 68 | 67.7 | 64-71 | 7 | ≥ 61 |
| campaign-organizer | 67 | 67.3 | 63-73 | 10 | ≥ 57 |
| campaign-qa | 66 | 64.8 | 61-67 | 6 | ≥ 60 |
| session-lifecycle | 67.5 | 67.3 | 64-71 | 7 | ≥ 61 |

## All Individual Scores

| Skill | R1-A | R1-B | R2-A | R2-B | R3-A | R3-B |
|-------|:----:|:----:|:----:|:----:|:----:|:----:|
| ttrpg-expert | 68 | 71 | 64 | 68 | 69 | 66 |
| campaign-organizer | 67 | 70 | 64 | 67 | 63 | 73 |
| campaign-qa | 62 | 66 | 66 | 67 | 61 | 67 |
| session-lifecycle | 67 | 65 | 71 | 68 | 64 | 69 |

## Pass Criteria

Post-refactor median must meet or exceed the pass threshold for each skill.
Pass threshold = floor(baseline median - variance). Thresholds are integers
because individual scores are integers. A score below the threshold indicates
a regression beyond normal variance.

## Observations

- All four skills cluster in the 64-68 median range — consistent quality across the plugin.
- Variance ranges from 6 (campaign-qa, tightest) to 10 (campaign-organizer, widest).
- campaign-qa has the highest pass threshold (60) relative to its median because of its tight variance.
- Within-run A/B spreads are typically 1-6 points; the largest outlier is campaign-organizer R3 at 10.
- Evaluator scores are meaningful for within-run deltas but not for cross-run absolute comparisons.
