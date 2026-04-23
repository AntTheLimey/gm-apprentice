# Benchmark Questions — session-wrapup

**Skill:** session-wrapup
**Purpose:** Establish baseline for split session-wrapup skill
**Runs:** 3 per variant (Sonnet agent), blind evaluation (Opus)
**Campaign data:** `tests/benchmark-campaign/`
**Models:** claude-sonnet-4-6 (agents), claude-opus-4-6 (evaluator)

## Questions

### Q1 — Narrative recap

Process the raw play notes from Session 2 into a proper narrative
recap. The notes are in the session file at
tests/benchmark-campaign/Chapters/Chapter 1/Sessions/.

### Q2 — Entity update sweep

Based on Session 2, what entities need updating? Check for new
NPCs mentioned that don't have files, status changes, and
relationship shifts.

### Q3 — Event decomposition

Review Session 2's play notes at tests/benchmark-campaign/.
Identify moments that meet the event threshold (changes entity
state, multiple participants, forward consequences). Which
deserve their own Event entity file vs inline timeline entries?

### Q4 — Carry-forward threads

What carries forward from Session 2 to Session 3? List open
threads, unresolved decisions, PC arc beats, and faction clock
states.

### Q5 — Full wrap-up pipeline

I just finished playing Session 2 of my campaign at
tests/benchmark-campaign/. Do a complete wrap-up: recap, PC
carry-forward, entity updates, timeline, what carries forward,
world state, keeper checklist.

## Agent Prompts

### Control prompt (monolith — extracted from main via `git show`)

```text
You are a TTRPG post-session processor. Read the skill entry point:
skills/session-lifecycle/SKILL.md
Follow routing to find the right files for each question.
Answer each question concisely (under 150 words each, except Q5
which can be up to 400 words).

Also read the campaign files at:
tests/benchmark-campaign/
Start with the index at _meta/index.md, then read session notes,
PC roster, entity files, and timeline as needed for each question.

Questions:

Q1: Process the raw play notes from Session 2 into a proper
narrative recap. The notes are in the session file at
tests/benchmark-campaign/Chapters/Chapter 1/Sessions/.

Q2: Based on Session 2, what entities need updating? Check for
new NPCs mentioned that don't have files, status changes, and
relationship shifts.

Q3: Review Session 2's play notes at tests/benchmark-campaign/.
Identify moments that meet the event threshold (changes entity
state, multiple participants, forward consequences). Which
deserve their own Event entity file vs inline timeline entries?

Q4: What carries forward from Session 2 to Session 3? List open
threads, unresolved decisions, PC arc beats, and faction clock
states.

Q5: I just finished playing Session 2 of my campaign at
tests/benchmark-campaign/. Do a complete wrap-up: recap, PC
carry-forward, entity updates, timeline, what carries forward,
world state, keeper checklist.
```

### Test prompt (split skill — feature branch)

```text
You are a TTRPG post-session processor. Read the skill entry point:
skills/session-wrapup/SKILL.md
Also read: skills/shared/session-document-chain.md
Follow routing to find the right files for each question.
Answer each question concisely (under 150 words each, except Q5
which can be up to 400 words).

Also read the campaign files at:
tests/benchmark-campaign/
Start with the index at _meta/index.md, then read session notes,
PC roster, entity files, and timeline as needed for each question.

Questions:

Q1: Process the raw play notes from Session 2 into a proper
narrative recap. The notes are in the session file at
tests/benchmark-campaign/Chapters/Chapter 1/Sessions/.

Q2: Based on Session 2, what entities need updating? Check for
new NPCs mentioned that don't have files, status changes, and
relationship shifts.

Q3: Review Session 2's play notes at tests/benchmark-campaign/.
Identify moments that meet the event threshold (changes entity
state, multiple participants, forward consequences). Which
deserve their own Event entity file vs inline timeline entries?

Q4: What carries forward from Session 2 to Session 3? List open
threads, unresolved decisions, PC arc beats, and faction clock
states.

Q5: I just finished playing Session 2 of my campaign at
tests/benchmark-campaign/. Do a complete wrap-up: recap, PC
carry-forward, entity updates, timeline, what carries forward,
world state, keeper checklist.
```

### Evaluator prompt (blind scoring)

```text
You are evaluating two TTRPG GM assistant responses. One is
labelled A, one B. You do not know which is control or test.

Score each answer on 5 dimensions (1-3 each, 15 max per question):

| Dimension | 1 (Poor) | 2 (Partial) | 3 (Nailed it) |
|-----------|----------|-------------|----------------|
| Factual accuracy | Wrong stats, hallucinated names | Mostly correct, minor errors | All verifiable facts correct |
| System specificity | Could be any system, no mechanics | Right system but generic | Uses system-specific idiom, conventions, tone |
| Actionability | Needs significant rework | Usable with GM effort | Drop-in ready, use as-is |
| Mechanical grounding | No concrete numbers or values | Some mechanics but incomplete | Specific stats, DCs, costs, rolls, thresholds |
| Table-ready fiction | Generic/obvious/AI slop | Fits system but predictable | Evocative, system-native, sparks play |

Questions for context:

Q1: Narrative recap from Session 2 play notes
Q2: Entity update sweep — new NPCs, status changes, relationships
Q3: Event decomposition — which moments deserve Event entity files
Q4: Carry-forward — threads, decisions, PC arcs, faction clocks
Q5: Full wrap-up pipeline — complete workflow from notes to package

For each question, output:
- Scores for A and B on each dimension
- Brief justification (1 sentence per dimension)
- Total per question and overall total

Do NOT reveal which you think is control or test.
```
