# Benchmark Questions — session-lifecycle

**Skill:** session-lifecycle
**Purpose:** Baseline quality before shared-refs + filesystem-fallback refactor
**Runs:** 3 per variant (control, test) to establish variance
**Campaign data:** `tests/benchmark-campaign/`

## Questions

### Q1 — Post-session summary and next-steps

I just finished playing Session 2 of my campaign at
tests/benchmark-campaign/. Read the session notes and the PC
roster. Prep me a summary of what happened and what I need to do
before next session.

### Q2 — Raw notes to narrative recap

Process the raw play notes from Session 2 into a proper narrative
recap. The notes are in the session file at
tests/benchmark-campaign/Chapters/Chapter 1/Sessions/.

### Q3 — Entity update sweep

Based on Session 2, what entities need updating? Check for new
NPCs mentioned that don't have files, status changes, and
relationship shifts.

### Q4 — Reconcile prep against play

Session 3 was prepped before Session 2 was played. Read both
session files and reconcile — what in the Session 3 prep is still
valid, what needs changing, and what's missing?

### Q5 — Carry-forward threads

What carries forward from Session 2 to Session 3? List open
threads, unresolved decisions, PC arc beats, and faction clock
states.

## Agent Prompts

### Control prompt (baseline — current main branch)

```text
You are a TTRPG session lifecycle manager — the between-sessions
workhorse that turns "we just finished playing" into organized
canon and "we play next week" into solid prep. Read the skill
entry point:
skills/session-lifecycle/SKILL.md
Follow routing to find the right files for each question.
Answer each question concisely (under 150 words each).

Also read the campaign files at:
tests/benchmark-campaign/
Start with the index at _meta/index.md, then read session notes,
PC roster, entity files, and timeline as needed for each question.

Questions:

Q1: I just finished playing Session 2 of my campaign at
tests/benchmark-campaign/. Read the session notes and the PC
roster. Prep me a summary of what happened and what I need to do
before next session.

Q2: Process the raw play notes from Session 2 into a proper
narrative recap. The notes are in the session file at
tests/benchmark-campaign/Chapters/Chapter 1/Sessions/.

Q3: Based on Session 2, what entities need updating? Check for
new NPCs mentioned that don't have files, status changes, and
relationship shifts.

Q4: Session 3 was prepped before Session 2 was played. Read both
session files and reconcile — what in the Session 3 prep is still
valid, what needs changing, and what's missing?

Q5: What carries forward from Session 2 to Session 3? List open
threads, unresolved decisions, PC arc beats, and faction clock
states.
```

### Test prompt (post-refactor — feature branch)

Same as control prompt. Point at the feature branch checkout.
The skill entry point path is identical; the branch content differs.

```text
You are a TTRPG session lifecycle manager — the between-sessions
workhorse that turns "we just finished playing" into organized
canon and "we play next week" into solid prep. Read the skill
entry point:
skills/session-lifecycle/SKILL.md
Follow routing to find the right files for each question.
Answer each question concisely (under 150 words each).

Also read the campaign files at:
tests/benchmark-campaign/
Start with the index at _meta/index.md, then read session notes,
PC roster, entity files, and timeline as needed for each question.

Questions:

Q1: I just finished playing Session 2 of my campaign at
tests/benchmark-campaign/. Read the session notes and the PC
roster. Prep me a summary of what happened and what I need to do
before next session.

Q2: Process the raw play notes from Session 2 into a proper
narrative recap. The notes are in the session file at
tests/benchmark-campaign/Chapters/Chapter 1/Sessions/.

Q3: Based on Session 2, what entities need updating? Check for
new NPCs mentioned that don't have files, status changes, and
relationship shifts.

Q4: Session 3 was prepped before Session 2 was played. Read both
session files and reconcile — what in the Session 3 prep is still
valid, what needs changing, and what's missing?

Q5: What carries forward from Session 2 to Session 3? List open
threads, unresolved decisions, PC arc beats, and faction clock
states.
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

Q1: Post-session summary and next-steps after Session 2
Q2: Raw play notes from Session 2 into narrative recap
Q3: Entity update sweep — new NPCs, status changes, relationship shifts
Q4: Reconcile Session 3 prep against Session 2 play
Q5: Carry-forward threads, decisions, PC arcs, faction clocks

For each question, output:
- Scores for A and B on each dimension
- Brief justification (1 sentence per dimension)
- Total per question and overall total

Do NOT reveal which you think is control or test.
```
