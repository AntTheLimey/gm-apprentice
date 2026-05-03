# Benchmark: [Feature/Change Name]

**Date:** YYYY-MM-DD
**PR:** #NNN
**Change type:** [New feature | Content enrichment | Compaction | Bug fix]

## Hypothesis

[One sentence: what you expect the change to improve and why]

## Control

- **Config:** [No-skill baseline | Main branch pre-change]
- **Model:** sonnet
- **Questions:** [N] questions

## Test

- **Config:** [With SKILL.md | Feature branch]
- **Model:** sonnet
- **Questions:** Same as control

## Questions

1. [Question text]
2. [Question text]
3. [Question text]

## Run Results

Minimum 5 runs required. Report per-run delta (test - control).

| Run | Control | Test | Delta | Notes |
|-----|---------|------|-------|-------|
| 1   |         |      |       |       |
| 2   |         |      |       |       |
| 3   |         |      |       |       |
| 4   |         |      |       |       |
| 5   |         |      |       |       |

## Summary

- **Median delta:** [N] / 75
- **IQR:** [Q1] to [Q3]
- **Control median tokens:** [N]
- **Test median tokens:** [N]
- **Control median time:** [N]s
- **Test median time:** [N]s

## Significance Assessment

[State whether delta exceeds the 8-point threshold]

- [ ] Delta > 8 points: statistically significant
- [ ] Delta ≤ 8 points: Within evaluator variance — not
  statistically significant
