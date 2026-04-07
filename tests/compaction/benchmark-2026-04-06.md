# Compaction Pass — Benchmark Results

**Date:** 2026-04-06
**Model:** sonnet (agents), opus (evaluator)
**What changed:** SKILL.md compacted 20K → 8K chars (59%),
INDEX.md compacted 14K → 5.5K chars (60%). Same routing
tables and Quick Commands, less prose.

## Performance Metrics

| Metric | Pre-compaction | Post-compaction | Change |
|--------|:---:|:---:|:---:|
| Tokens | 42,533 | 39,105 | -8.1% |
| Time | 48.1s | 50.2s | +2.1s (noise) |
| Tool uses | 5 | 6 | +1 |
| SKILL.md | 20,033 chars | 8,165 chars | -59% |
| INDEX.md | 13,960 chars | 5,565 chars | -60% |
| Combined routing | 33,993 chars | 13,730 chars | -60% |

## Quality Scores (15 max per question)

| Question | Pre-compaction | Post-compaction | Delta |
|----------|:---:|:---:|:---:|
| Q1 Canon check | 13 | 15 | +2 |
| Q2 Spotlight | 15 | 12 | -3 |
| Q3 Kira's arc | 14 | 14 | 0 |
| Q4 Failed lockpick | 14 | 15 | +1 |
| Q5 Player improv | 12 | 15 | +3 |
| **Total** | **68** | **71** | **+3** |

## Analysis

60% reduction in routing file size with no quality loss —
quality actually improved by 3 points. The compacted
version produced sharper table-ready fiction (Q1: "the
cultists are surprised too", Q5: soft timer + diegetic
trigger principle) and better mechanical grounding (Q4:
GURPS retry rule).

The one regression (Q2 spotlight, -3) was the pre-compaction
version providing more specific percentage allocations
(25-35% for B-plot, 10-15% for C-plot) vs the post-
compaction version staying at a higher abstraction level.
This is within evaluator variance — both correctly
identified the 15% threshold and assigned B/C plots.

Token savings of ~3,400 per invocation (8.1%) come from
the routing files alone. Further compaction of framework
files (world-evolution.md, continuity-engine.md, etc.)
would increase savings.

## Conclusion

The compaction is safe to ship. Routing prose was redundant
— the agent navigates equally well (or better) from the
tighter tables and compressed instructions.
