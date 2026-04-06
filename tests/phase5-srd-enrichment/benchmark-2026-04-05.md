# Phase 5 SRD Enrichment — Benchmark Results

**Date:** 2026-04-05
**Model:** sonnet (all agents), opus (evaluators)
**Test version:** v2 (SKILL.md as entry point, blind evaluation)

## A/B Assignment Key

| System | Question | Answer A | Answer B |
|--------|----------|----------|----------|
| CoC | Q1 | Test (with skill) | Control (no files) |
| CoC | Q2 | Control | Test |
| CoC | Q3 | Test | Control |
| CoC | Q4 | Control | Test |
| CoC | Q5 | Test | Control |
| FitD | Q1 | Control | Test |
| FitD | Q2 | Test | Control |
| FitD | Q3 | Control | Test |
| FitD | Q4 | Test | Control |
| FitD | Q5 | Control | Test |
| D&D | Q1 | Test | Control |
| D&D | Q2 | Control | Test |
| D&D | Q3 | Test | Control |
| D&D | Q4 | Control | Test |
| D&D | Q5 | Test | Control |

## Performance Metrics

| System | Variant | Tokens | Time (s) | Tool Uses |
|--------|---------|--------|----------|-----------|
| CoC | Control | 8,732 | 18.2 | 0 |
| CoC | Test | 51,546 | 57.6 | 8 |
| FitD | Control | 8,671 | 16.4 | 0 |
| FitD | Test | 32,750 | 41.1 | 5 |
| D&D | Control | 8,914 | 22.7 | 0 |
| D&D | Test | 50,336 | 83.8 | 13 |

**Averages:**
- Control: 8,772 tokens, 19.1s
- Test: 44,877 tokens, 60.8s
- Overhead: ~5.1x tokens, ~3.2x time

## Quality Scores (blind evaluator, 5 dimensions x 3 points = 15 max)

### CoC/BRP

| Question | Control | Test | Delta |
|----------|---------|------|-------|
| Q1 Dodge lookup | 9 | 12 | +3 |
| Q2 Doctor NPC | 10 | 15 | +5 |
| Q3 Innsmouth hook | 13 | 12 | -1 |
| Q4 Archaeologist | 10 | 14 | +4 |
| Q5 Dockside creature | 15 | 12 | -3 |
| **Total** | **57** | **65** | **+8** |

Notes: Control scored higher on Q3 (slightly better atmosphere)
and Q5 (offered three creatures vs one). Test won on structured
NPC output (Q2) and profession guidance (Q4). The evaluator
noted that the test's NPC used a structured framework (AIMS,
derived stats, secret) that made it immediately playable.

### FitD

| Question | Control | Test | Delta |
|----------|---------|------|-------|
| Q1 Bluecoats tier | 7 | 15 | +8 |
| Q2 Skovlander fence | 12 | 14 | +2 |
| Q3 Crow's Foot | 9 | 14 | +5 |
| Q4 Con artist playbook | 10 | 12 | +2 |
| Q5 Silkshore conflict | 10 | 14 | +4 |
| **Total** | **48** | **69** | **+21** |

Notes: Biggest improvement across all systems. Control
hallucinated faction details (Q1: wrong hold, Q5: invented
"Iruvian Consulate" scenario) and playbook abilities (Q4:
"Temptation" is not a Slide ability). Test provided canonical
faction data with tiers, holds, clocks, and named NPCs.
Evaluator noted both had minor ability description errors in
Q4 but test was closer to source.

### D&D 5e

| Question | Control | Test | Delta |
|----------|---------|------|-------|
| Q1 Basilisk | 11 | 14 | +3 |
| Q2 Cult leader NPC | 9 | 13 | +4 |
| Q3 Ruined temple | 14 | 15 | +1 |
| Q4 Warlock summary | 10 | 13 | +3 |
| Q5 CR 5 encounter | 14 | 13 | -1 |
| **Total** | **58** | **68** | **+10** |

Notes: Test provided more precise mechanical data (DCs, HD
formulas, SRD subclass names). Control won narrowly on Q5
(evaluator preferred the Green Hag encounter's narrative
richness). Test's cult leader NPC had name, AIMS, and retreat
trigger — significantly more table-ready.

## Summary

| System | Control Total | Test Total | Delta | % Improvement |
|--------|:------------:|:----------:|:-----:|:------------:|
| CoC | 57 | 65 | +8 | +14% |
| FitD | 48 | 69 | +21 | +44% |
| D&D | 58 | 68 | +10 | +17% |
| **All** | **163** | **202** | **+39** | **+24%** |

### Key Findings

1. **FitD showed the largest improvement (+44%)** because the
   model's training data is weakest on Blades in the Dark
   specifics. The skill files prevented hallucination of faction
   details, playbook abilities, and setting facts.

2. **D&D showed solid improvement (+17%)** primarily through
   mechanical precision — exact DCs, stat block references, and
   structured NPC frameworks.

3. **CoC showed modest improvement (+14%)** because the model
   already knows CoC well from training data. The skill added
   value through structured NPC output (AIMS framework) and
   profession template guidance, but the model's baseline CoC
   knowledge is strong.

4. **The control occasionally won** on creative/atmospheric
   questions (CoC Q3, Q5; D&D Q5) where the model's training
   produced richer narrative fiction. The skill files excel at
   factual grounding, not creative writing.

5. **Cost trade-off:** ~5x tokens and ~3x time for ~24% quality
   improvement. The improvement is concentrated in factual
   accuracy and mechanical grounding — preventing hallucination
   and providing exact game values.

6. **Routing worked:** The test agents successfully navigated
   SKILL.md → INDEX.md → correct topic files without being
   told which files to read. The routing infrastructure is
   functional.

### Areas for Improvement

- CoC creatures.md lacks BRP stat blocks for Lovecraft entities
  (by design — copyright). Consider adding more BRP ORC
  creatures with stat blocks for direct table use.
- The skill's NPC generation framework (AIMS, secrets) added
  significant value — ensure all systems leverage it.
- Creative/atmospheric output was sometimes stronger without
  the skill files. Consider whether the files can include
  more evocative setting prose alongside the mechanical data.
