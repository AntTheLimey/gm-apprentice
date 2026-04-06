# World Evolution — Impact Classification Benchmark

**Date:** 2026-04-06
**Model:** sonnet (agents), opus (evaluator)
**Tests:** Q11-Q13 (event impact classification, added after
the v2 benchmark to specifically test the impact framework)

## Context

Added Critical/Significant/Minor/Flavour impact classification
to the Universal Faction Turn procedure in world-evolution.md.
These 3 questions test whether the classification improves
the skill's ability to help GMs prioritise faction events.

## Metrics

| | Control | Test |
|---|:---:|:---:|
| Tokens | 8,870 | 32,595 |
| Time (s) | 16.4 | 51.0 |
| Tool uses | 0 | 3 |

## Quality Scores (15 max per question)

| Question | Control | Test | Delta |
|----------|:-------:|:----:|:-----:|
| Q11 Classify 3 cult events | 11 | 14 | +3 |
| Q12 Limited prep prioritisation | 13 | 14 | +1 |
| Q13 Missed conflict consequences | 14 | 15 | +1 |
| **Total** | **38** | **43** | **+5** |

## Analysis

The impact classification adds the most value on Q11 (+3)
where the task is explicitly about classification. The
structured Critical/Significant/Minor/Flavour tiers gave
the test a named, reusable framework vs the control's ad-hoc
HIGH/MEDIUM/LOW labels.

On Q12-Q13, the control's instincts were already strong
(13-14/15). The framework's added value is consistency
and teachability — a GM can learn the vocabulary and apply
it independently. The evaluator noted: "the named tiers
give the GM a reusable mental model, not just a one-off
judgement."

Notable: Q13 scored a perfect 15/15 for the test. The
evaluator praised "Let Verosha's hollow eyes do the work"
as outstanding GM direction.

## Evaluator Highlights

- Q11: "Named classification tiers with explicit 'trending
  Critical' escalation give the GM a reusable mental model"
- Q12: "Build one scene for watch, one for gala, others
  cost nothing — a concrete prep plan with time budget"
- Q13: "Let Verosha's hollow eyes do the work — outstanding
  GM direction; devastation feels earned and irreversible"
