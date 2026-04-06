# World Evolution — Benchmark Results

**Date:** 2026-04-06
**Model:** sonnet (agents), opus (evaluators)
**Test version:** v1 — initial world-evolution framework

## Metrics

| | Control | Test |
|---|:---:|:---:|
| Tokens | 10,710 | 43,199 |
| Time (s) | 57.0 | 117.3 |
| Tool uses | 0 | 7 |
| Overhead | 1x | ~4x tokens, ~2x time |

## Quality Scores (15 max per question)

| Question | Control | Test | Delta | Evaluator note |
|----------|:-------:|:----:|:-----:|----------------|
| Q1 Warehouse break-in | 12 | 11 | -1 | Control named NPC, more evocative |
| Q2 Consequences | 11 | 11 | 0 | Tied — different strengths |
| Q3 Thread triage | 11 | 12 | +1 | Test used Chekhov thresholds precisely |
| Q4 Discovery states | 12 | 13 | +1 | Test provided 5-level model + table format |
| Q5 FitD factions | 12 | 15 | +3 | Test: perfect score — clocks, ticks, heat threshold, named NPCs |
| Q6 FitD Bluecoats | 15 | 14 | -1 | Control added rival crew — more surprising fiction |
| Q7 CoC cult | 14 | 12 | -2 | Test used FitD clock language in CoC context |
| Q8 CoC Arkham | 14 | 11 | -3 | Control was more decisive and creepier |
| Q9 D&D power vacuum | 14 | 11 | -3 | Control named all NPCs, committed to actions |
| Q10 D&D post-dragon | 13 | 10 | -3 | Control had dragon's mate hook — brilliant escalation |
| **Total** | **128** | **120** | **-8** | |

## Analysis

### What the framework adds (where test won)

- **Q5 (FitD factions):** Perfect 15/15. The framework's
  faction turn procedure + FitD module produced precise
  clock tick values, named faction leaders, heat thresholds,
  and conditional triggers. This is exactly what the
  framework was designed for.
- **Q3 (Thread triage):** Correct session-count thresholds,
  Chekhov protocol references, precise "danger zone" framing.
- **Q4 (Discovery states):** The 5-level model and table
  format gave the GM a reusable tracking tool.

### Where the base model won (and why)

- **Q6-Q10:** The control consistently produced more
  **decisive, evocative, surprising** fiction. Named NPCs
  without being told to. Committed to specific actions
  rather than hedging. Created unexpected escalations
  (dragon's mate, rival crew, flat-faced figure).
- **Q7:** The test imported FitD clock language into a CoC
  context, which the evaluator correctly flagged as a
  system mismatch.

### Root cause

The world-evolution framework is a **process tool** — it
ensures the GM checks all six categories and doesn't miss
anything. But the base model is already good at creative
worldbuilding when given a scenario. The framework adds
value through:

1. **Completeness** — ensures threads, consequences,
   foreshadowing, and discovery states are ALL checked
2. **System mechanics** — FitD faction turns are dramatically
   better with the framework
3. **Structure** — proposals are formatted for GM approval

But it currently costs in:

1. **Fiction quality** — the framework-guided output
   sometimes reads like a checklist rather than living world
2. **System bleed** — the CoC module needs stronger identity
   to prevent FitD mechanics leaking in
3. **Decisiveness** — the "propose, don't decide" instruction
   may cause the test to hedge more than the control

### Recommendations

1. **CoC faction turn module needs strengthening** — the
   current module is too thin. The test defaulted to clock
   language because the CoC module didn't provide strong
   enough alternative mechanics. Add more narrative-timeline
   examples and CoC-specific pacing guidance.

2. **Encourage decisiveness in proposals** — the "apprentice
   proposes" framing is correct, but proposals should be
   *specific committed actions* ("The cult dispatches two
   cultists within 48 hours") not *hedged possibilities*
   ("The cult may dispatch cultists").

3. **The framework's real value is the checklist, not the
   individual answers** — when tested question-by-question,
   the base model can match or beat it. But in a real post-
   session workflow, the base model would miss categories
   entirely. The framework ensures nothing falls through
   the cracks. This is hard to benchmark with isolated
   questions.

4. **Name NPCs in the procedure guidance** — the control
   consistently named NPCs while the test didn't. Add
   explicit instruction: "always name NPCs and factions
   in your proposals."
