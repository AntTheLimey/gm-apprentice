# Compaction Pass — Benchmark Results

**Date:** 2026-04-06
**Model:** sonnet (agents), opus (evaluator)
**What changed:** SKILL.md compacted 20K → 8.5K chars (58%),
INDEX.md compacted 14K → 5.5K chars (60%). Same routing
tables and Quick Commands, less prose. Priming guidance
preserved on key Quick Commands after v1 regression.

## Performance Metrics

| Metric | Pre-compaction | Post-compaction | Change |
|--------|:---:|:---:|:---:|
| Tokens | 42,533 | 41,371 | -2.7% |
| Time | 48.1s | 45.9s | -4.6% |
| Tool uses | 5 | 6 | +1 |
| SKILL.md | 20,033 chars | 8,451 chars | -58% |
| INDEX.md | 13,960 chars | 5,565 chars | -60% |
| Combined routing | 33,993 chars | 14,016 chars | -59% |

## Quality Scores (15 max per question)

| Question | Pre-compaction | Post-compaction | Delta |
|----------|:---:|:---:|:---:|
| Q1 Canon check | 11 | 14 | +3 |
| Q2 Spotlight | 10 | 14 | +4 |
| Q3 Kira's arc | 11 | 14 | +3 |
| Q4 Failed lockpick | 12 | 15 | +3 |
| Q5 Player improv | 11 | 13 | +2 |
| **Total** | **55** | **70** | **+15** |

## Compaction History

| Version | Q2 Score | Issue |
|---------|:--------:|-------|
| Pre-compaction (main) | 10 | Baseline |
| Compaction v1 (no priming) | 12 | Stripped priming, slight regression from expected |
| **Compaction v2 (priming restored)** | **14** | **Restored compact priming, +4 over baseline** |

## Analysis

The compacted version is both smaller AND better quality.
Verbose prose wasn't helping — it was diluting the signal.

**Why quality improved despite fewer chars:**
- Less routing noise means the agent focuses on the actual
  framework files faster
- Compact priming ("Flag below 15% floor. Assign B/C plots.")
  is more directive than verbose descriptions
- Named frameworks and thresholds in tight format are easier
  for the model to parse than prose explanations

**Key lesson:** Routing (where to go) compresses aggressively.
Priming (what to focus on) must be preserved. The line
between filler and priming is whether it shapes output
quality. "These common requests have streamlined workflows"
is filler. "Review last 2-3 sessions per-PC. Flag below 15%
floor." is priming.

Token savings are modest (-2.7%) because the framework files
themselves (session-planner.md, continuity-engine.md, etc.)
haven't been compacted yet. They are the real token consumers.
The routing overhead reduction is a foundation for further
compaction passes.
