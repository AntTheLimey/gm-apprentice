# Quick Commands (Discoverability) — Benchmark Results

**Date:** 2026-04-06
**Model:** sonnet (agents), opus (evaluator)
**PR:** #4 (Discoverability + Orchestration)

## Metrics

| | Control | Test |
|---|:---:|:---:|
| Tokens | 8,962 | 42,342 |
| Time (s) | 21.1 | 43.2 |
| Tool uses | 0 | 5 |

## Quality Scores (15 max per question)

| Question | Control | Test | Delta |
|----------|:-------:|:----:|:-----:|
| Q1 Canon check | 9 | 15 | +6 |
| Q2 Spotlight imbalance | 9 | 15 | +6 |
| Q3 Character arc | 13 | 15 | +2 |
| Q4 Failed roll | 13 | 15 | +2 |
| Q5 Open interaction | 9 | 15 | +6 |
| **Total** | **53** | **75** | **+22** |

**Perfect score: 75/75.** Five consecutive 15/15 ratings.

## Analysis

The strongest benchmark result across all PRs. The test
scored perfectly on every question. The evaluator noted:

> "Answer B scores perfectly across all dimensions by naming
> specific frameworks, providing measurable criteria (15%
> floor, 15-20 minute timer, three-session threshold),
> offering multiple categorized options, and delivering
> table-ready fiction that a GM can use without further
> interpretation."

The base model scored well on Q3-Q4 (13/15) — it gives
good general GM advice for arc progression and fail-forward.
But it scored poorly on Q1, Q2, Q5 (9/15) because these
require **structured diagnostic frameworks** that the model
doesn't have in training data:
- Canon Grounding: "motivation break" as a named category
- Spotlight Forecast: 15% per-PC floor, three-session
  corrective threshold, B/C-plot rotation
- Open Interaction Windows: 15-20 min soft timer, diegetic
  trigger method, "the open window you forgot to write"

## Key Finding

The Quick Commands' value isn't in routing — it's in giving
the GM **named, measurable frameworks** to replace vague
instincts. The base model says "give underserved PCs more
scenes." The skill says "Delgado is below the 15% floor,
assign them the B-plot, track rotation explicitly, three
sessions of imbalance triggers a corrective plan."

Named frameworks with thresholds and categories produce
dramatically better guidance than general wisdom.
