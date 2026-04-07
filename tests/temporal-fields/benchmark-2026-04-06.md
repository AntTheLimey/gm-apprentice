# Temporal Fields — Benchmark Results

**Date:** 2026-04-06
**Model:** sonnet (agents), opus (evaluator)

## Metrics

| | Control | Test |
|---|:---:|:---:|
| Tokens | 9,040 | 26,847 |
| Time (s) | 20.4 | 32.6 |
| Tool uses | 0 | 3 |

## Quality Scores (15 max per question)

| Question | Control | Test | Delta |
|----------|:-------:|:----:|:-----:|
| Q1 Staleness detection | 10 | 14 | +4 |
| Q2 Temporal queries | 10 | 14 | +4 |
| Q3 Source-based quality pass | 11 | 14 | +3 |
| Q4 Post-session filing | 11 | 15 | +4 |
| **Total** | **42** | **57** | **+15** |

## Analysis

Strongest per-question improvement of any benchmark so far.
The temporal fields give the skill a concrete vocabulary
(lastUpdated, asOfSession, source, discoveryState) that the
base model simply doesn't have.

The control offered sound ad-hoc advice ("session-stamped
fact log," "triage by staleness") but left the GM to design
the actual structure. The test provided named fields, exact
values, and executable steps every time.

### Evaluator highlights

- Q1: "References a named field and an explicit condition
  as the sorting mechanism" — test correctly ordered
  entities by staleness while control contradicted itself
  (prioritised S7 entity for review, then said skip S7+)
- Q2: "Names specific field (discoveryState), specific
  entity type (Secret), per-NPC timestamps — a reusable
  structured approach" vs control's informal "fact log"
- Q4: Perfect 15/15 — "Each action is a concrete executable
  step with named fields and explicit values for every
  entity touched"
