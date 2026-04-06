# Phase 5 SRD Enrichment — Benchmark Results v2

**Date:** 2026-04-05
**Model:** sonnet (all agents), opus (evaluators)
**Test version:** v2 post-improvements (creative routing, FitD accuracy fixes, routing optimization)
**Changes from v1:** Creative requests now load generation frameworks, FitD ability names fixed, SKILL.md routing skips INDEX.md when Quick Commands match

## Performance Metrics

| System | Variant | Tokens | Time (s) | Tool Uses |
|--------|---------|--------|----------|-----------|
| CoC | Control | 8,732 | 18.2 | 0 |
| CoC | Test v2 | 42,638 | 47.5 | 6 |
| FitD | Control | 8,671 | 16.4 | 0 |
| FitD | Test v2 | 27,831 | 32.0 | 4 |
| D&D | Control | 8,914 | 22.7 | 0 |
| D&D | Test v2 | 53,586 | 123.9 | 22 |

**Token overhead:** ~4.7x average (down from ~5.1x in v1)
**Time overhead:** ~3.5x average (up slightly — D&D agent read more files)

## Quality Scores (blind evaluator, 15 max)

### CoC/BRP — REGRESSION

| Question | Control | Test v2 | Delta | Notes |
|----------|:-------:|:-------:|:-----:|-------|
| Q1 Dodge | 13 | 9 | -4 | Test got formula WRONG (DEX x2% ≠ 12% for DEX 60) |
| Q2 Doctor NPC | 14 | 11 | -3 | Test used incomplete stat block, but better hook |
| Q3 Innsmouth | 13 | 12 | -1 | Very close, both strong |
| Q4 Archaeologist | 14 | 6 | -8 | Test used BRP-generic terms, not CoC 7e |
| Q5 Creature | 12 | 10 | -2 | Test gave one creature + proxy stats; control gave three |
| **Total** | **66** | **48** | **-18** | |

**Root cause:** CoC files use BRP ORC terminology which confuses
the model when answering CoC 7e-specific questions. The BRP
formula "DEX × 2%" is different from CoC 7e "DEX/2". BRP uses
"Knowledge (Archaeology)" where CoC 7e uses just "Archaeology".

### FitD — IMPROVED

| Question | Control | Test v2 | Delta | Notes |
|----------|:-------:|:-------:|:-----:|-------|
| Q1 Bluecoats | 7 | 13 | +6 | Control got hold wrong |
| Q2 Fence NPC | 12 | 13 | +1 | Both strong, test had better setting grounding |
| Q3 Crow's Foot | 10 | 14 | +4 | Test had all 3 factions with tiers/leaders |
| Q4 Slide playbook | 6 | 9 | +3 | Both had errors; test less severe |
| Q5 Silkshore | 11 | 13 | +2 | Test had canonical factions + clock |
| **Total** | **46** | **62** | **+16** | |

### D&D 5e — IMPROVED

| Question | Control | Test v2 | Delta | Notes |
|----------|:-------:|:-------:|:-----:|-------|
| Q1 Basilisk | 12 | 12 | 0 | Tied |
| Q2 Cult leader | 10 | 14 | +4 | Test had named NPC, AIMS, retreat trigger |
| Q3 Temple scene | 12 | 15 | +3 | Test scored perfect 15/15 |
| Q4 Warlock | 10 | 14 | +4 | Test more detailed, specific features |
| Q5 Encounter | 12 | 10 | -2 | Control had better encounter concept |
| **Total** | **56** | **65** | **+9** | |

## Comparison: v1 → v2

### Test Scores

| System | v1 | v2 | Change |
|--------|:--:|:--:|:------:|
| CoC | 65 | 48 | -17 |
| FitD | 69 | 62 | -7 |
| D&D | 68 | 65 | -3 |
| **Total** | **202** | **175** | **-27** |

### Test-vs-Control Delta

| System | v1 Delta | v2 Delta | Change |
|--------|:--------:|:--------:|:------:|
| CoC | +8 | -18 | -26 |
| FitD | +21 | +16 | -5 |
| D&D | +10 | +9 | -1 |
| **Total** | **+39** | **+7** | **-32** |

### Token Overhead

| Metric | v1 | v2 | Change |
|--------|:--:|:--:|:------:|
| Avg test tokens | 44,877 | 41,352 | -8% |
| Token multiplier | 5.1x | 4.7x | Improved |

## Analysis

### What improved
- **D&D Q3 (temple scene): 15/15** — the creative routing fix
  worked. The agent loaded content-generation.md alongside the
  system data, producing a richer scene with more interactive
  elements and story hooks.
- **Token efficiency improved slightly** (~8% fewer tokens) from
  the routing optimization (skipping INDEX.md).
- **FitD accuracy fixes** are in place (Arcane Fighter, Death
  Veil) though the evaluator didn't specifically test those
  abilities in this run.

### What regressed
- **CoC is now WORSE with the skill than without.** The BRP ORC
  files use BRP-generic conventions that clash with CoC 7e.
  The model reads BRP Dodge (DEX × 2%) and gets confused when
  applying it to a CoC 7e context (DEX/2). Same issue with
  skill names, profession names, and derived stat formulas.

### What stayed the same
- **FitD and D&D improvements held** — the skill still
  significantly outperforms control on these systems.
- **FitD Q4 (playbook)** still has accuracy issues in both
  test and control. The Slide ability descriptions need
  further verification.

## Recommended Next Steps

1. **Critical: Add a CoC 7e adaptation layer** to the BRP-based
   files. In our own words (legal — mechanics aren't
   copyrightable), add CoC 7e-specific formulas and terminology
   where they differ from BRP generic. Key items:
   - Dodge = DEX/2 (not DEX × 2%)
   - Skill names: "Archaeology" not "Knowledge (Archaeology)"
   - CoC occupations vs BRP professions
   - Sanity, Luck, Pushing Rolls (already in core files)

2. **FitD Q4 accuracy:** Further verify Slide ability
   descriptions against the full game text.

3. **Evaluator variance:** Consider running evaluations 3x and
   averaging to reduce noise from single-run scoring.
