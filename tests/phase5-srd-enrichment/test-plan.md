# Phase 5: SRD Enrichment — Smoke Test Plan

## Purpose

Verify that the new topic files provide measurable value to a GM
using the ttrpg-expert skill. Compare answers WITH the skill
(using SKILL.md as entry point) vs WITHOUT (pure model knowledge).

## Method

- Same model (sonnet) for both control and test
- Control: answer from training knowledge only, no file access
- Test: read SKILL.md as entry point, follow routing to find
  the right reference files, then answer
- 5 questions per system, 3 systems, 15 total
- Each answer under 100 words
- Separate evaluator (opus) scores both answers blind using
  the rubric, with answers labeled A/B in randomised order
- Factual spot-checks on lookup questions via grep

## Questions

### CoC/BRP

| # | Activity | Question |
|---|----------|----------|
| 1 | Run (lookup) | What's the base chance for the Dodge skill in BRP/CoC? |
| 2 | Prep (NPC) | Give me a 1920s doctor NPC with key skills and stats for a CoC game. |
| 3 | Prep (location) | Describe Innsmouth for a scenario hook — what makes it creepy and what might draw investigators there? |
| 4 | Table prep (chargen) | Help a player pick a profession for an archaeologist character — what skills should they focus on? |
| 5 | Build (encounter) | What creature would fit a dockside horror scene in a CoC game? |

### FitD

| # | Activity | Question |
|---|----------|----------|
| 1 | Run (lookup) | What tier are the Bluecoats faction in Doskvol? |
| 2 | Prep (NPC) | Give me a Skovlander fence NPC for Nightmarket — name, look, quirk, what they deal in. |
| 3 | Prep (location) | Describe Crow's Foot for a score setup — what's the district like, what factions operate there? |
| 4 | Table prep (chargen) | Which playbook fits a con artist character? What are their key abilities? |
| 5 | Build (encounter) | What faction conflict could drive a score in Silkshore? |

### D&D 5e

| # | Activity | Question |
|---|----------|----------|
| 1 | Run (lookup) | What's a Basilisk's CR and AC? |
| 2 | Prep (NPC) | Give me a CR 3 cult leader NPC — class, key stats, spells, and tactics. |
| 3 | Prep (location) | Set the scene for a ruined temple encounter — description, hazards, what the PCs find. |
| 4 | Table prep (chargen) | Summarise the Warlock class for a new player — key features, how it plays, what makes it unique. |
| 5 | Build (encounter) | Build a CR 5 encounter for 4 level-3 PCs — which monsters, how many, why it works. |

## Prompt Templates

### Control prompt
```
You are a TTRPG GM assistant helping with [SYSTEM]. Answer each
question concisely (under 100 words each). Do NOT read any
files — answer purely from your training knowledge.

[5 questions]

Answer all 5, numbered. Be specific with game mechanics where
possible.
```

### Test prompt
```
You are a TTRPG GM assistant. You have access to a skill file
that tells you how to find reference data for different game
systems.

Start by reading the skill entry point:
/Users/antonypegg/PROJECTS/gm-apprentice/skills/ttrpg-expert/SKILL.md

Then follow its routing instructions (via INDEX.md) to find the
right reference files for each question about [SYSTEM]. Read
only the files the routing directs you to — do not read all
files.

[5 questions]

Answer all 5, numbered. Be specific with game mechanics where
possible. Cite which reference file informed each answer.
```

### Evaluator prompt
```
You are evaluating two TTRPG GM assistant answers for quality.
You do not know which answer used reference files and which
used training knowledge. Score each independently.

## Question
[question text]

## Answer A
[one answer, randomly assigned]

## Answer B
[other answer, randomly assigned]

## Scoring Rubric (1-3 per dimension, 15 max)

| Dimension | 1 (Poor) | 2 (Partial) | 3 (Nailed it) |
|-----------|----------|-------------|----------------|
| Factual accuracy | Wrong stats, hallucinated names/rules | Mostly correct, minor errors | All verifiable facts correct |
| System specificity | Could be any system, wrong terminology | Right system but generic | Uses system's specific idiom, conventions, tone |
| Actionability | Needs significant rework to use | Usable with some GM effort | Drop-in ready, use as-is |
| Mechanical grounding | No concrete numbers or game values | Some mechanics but incomplete | Specific stats, DCs, costs, rolls |
| Table-ready fiction | Generic/obvious, AI slop, tonally wrong | Fits system but predictable, GM would rewrite | Evocative, system-native, sparks play — GM sees how it plays out |

Score each answer on all 5 dimensions. Return:
- Answer A: [score per dimension] = [total]/15
- Answer B: [score per dimension] = [total]/15
- Brief justification for any score difference
```

## Metrics Collected

- Tokens used (from agent usage report)
- Time taken (from agent duration_ms)
- Tool uses (file reads)
- Quality score per dimension (from blind evaluator)
- Total quality score out of 15
