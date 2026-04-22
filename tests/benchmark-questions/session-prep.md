# Benchmark Questions — session-prep

**Skill:** session-prep
**Purpose:** Establish baseline for split session-prep skill
**Runs:** 3 per variant (Sonnet agent), blind evaluation (Opus)
**Campaign data:** `tests/benchmark-campaign/`
**Models:** claude-sonnet-4-6 (agents), claude-opus-4-6 (evaluator)

## Questions

### Q1 — Full prep from scratch

Read the campaign at tests/benchmark-campaign/. Session 2 has been
played and wrapped up. Prep me for Session 3 — PC review, threads,
NPC reference, world state, and gap analysis.

### Q2 — Reconcile prep against play

Session 3 was prepped before Session 2 was played. Read both
session files and reconcile — what in the Session 3 prep is still
valid, what needs changing, and what's missing?

### Q3 — Missing wrap-up fallback

Pretend Session 2 has status "played" but no narrative recap or
carry-forward sections. You're about to prep Session 3. What do
you tell the GM?

### Q4 — Thread scanning

Review Sessions 1-2 at tests/benchmark-campaign/ and identify
stale threads, unfollowed clues, and pending consequences that
should be picked up in Session 3.

### Q5 — Gap flagging

Read the Session 3 prep note at tests/benchmark-campaign/. Identify
PCs without touchpoints, NPCs without vault files, locations not
described, and missing entity stubs.

### Q6 — Arc check and A/B/C plot assignment

Read the campaign at tests/benchmark-campaign/. Based on Sessions
1-2, assign each PC an arc stage (Establishment/Testing/Crisis/
Transformation/New Equilibrium) and determine the A/B/C plot
structure for Session 3. Which PC gets the B-plot and why?

### Q7 — Touchpoint assignment

Using the campaign at tests/benchmark-campaign/, assign at least
one touchpoint per PC for Session 3. Each touchpoint should have
a type (Backstory Connection, Moral Dilemma, Ability Showcase,
Decision Callback, Arc Advancement Clue, or Character Moment),
a description, and draw on established threads or NPCs from
Sessions 1-2.

### Q8 — Spotlight forecast

Review Sessions 1-2 at tests/benchmark-campaign/ and estimate
the spotlight distribution per PC. Flag any PC below the 15%
floor. Propose corrective B/C plot assignments for Session 3.

## Agent Prompts

### Control prompt (monolith — extracted from main via `git show`)

```text
You are a TTRPG session prep assistant. Read the skill entry point:
skills/session-lifecycle/SKILL.md
Follow routing to find the right files for each question.
Answer each question concisely (under 150 words each).

Also read the campaign files at:
tests/benchmark-campaign/
Start with the index at _meta/index.md, then read session notes,
PC roster, entity files, and timeline as needed for each question.

Questions:

Q1: Read the campaign at tests/benchmark-campaign/. Session 2 has
been played and wrapped up. Prep me for Session 3 — PC review,
threads, NPC reference, world state, and gap analysis.

Q2: Session 3 was prepped before Session 2 was played. Read both
session files and reconcile — what in the Session 3 prep is still
valid, what needs changing, and what's missing?

Q3: Pretend Session 2 has status "played" but no narrative recap
or carry-forward sections. You're about to prep Session 3. What
do you tell the GM?

Q4: Review Sessions 1-2 at tests/benchmark-campaign/ and identify
stale threads, unfollowed clues, and pending consequences that
should be picked up in Session 3.

Q5: Read the Session 3 prep note at tests/benchmark-campaign/.
Identify PCs without touchpoints, NPCs without vault files,
locations not described, and missing entity stubs.

Q6: Read the campaign at tests/benchmark-campaign/. Based on
Sessions 1-2, assign each PC an arc stage (Establishment/Testing/
Crisis/Transformation/New Equilibrium) and determine the A/B/C
plot structure for Session 3. Which PC gets the B-plot and why?

Q7: Using the campaign at tests/benchmark-campaign/, assign at
least one touchpoint per PC for Session 3. Each touchpoint should
have a type (Backstory Connection, Moral Dilemma, Ability
Showcase, Decision Callback, Arc Advancement Clue, or Character
Moment), a description, and draw on established threads or NPCs
from Sessions 1-2.

Q8: Review Sessions 1-2 at tests/benchmark-campaign/ and estimate
the spotlight distribution per PC. Flag any PC below the 15%
floor. Propose corrective B/C plot assignments for Session 3.
```

### Test prompt (split skill — feature branch)

```text
You are a TTRPG session prep assistant. Read the skill entry point:
skills/session-prep/SKILL.md
Follow routing to find the right files for each question.
Answer each question concisely (under 150 words each).

Also read the campaign files at:
tests/benchmark-campaign/
Start with the index at _meta/index.md, then read session notes,
PC roster, entity files, and timeline as needed for each question.

Questions:

Q1: Read the campaign at tests/benchmark-campaign/. Session 2 has
been played and wrapped up. Prep me for Session 3 — PC review,
threads, NPC reference, world state, and gap analysis.

Q2: Session 3 was prepped before Session 2 was played. Read both
session files and reconcile — what in the Session 3 prep is still
valid, what needs changing, and what's missing?

Q3: Pretend Session 2 has status "played" but no narrative recap
or carry-forward sections. You're about to prep Session 3. What
do you tell the GM?

Q4: Review Sessions 1-2 at tests/benchmark-campaign/ and identify
stale threads, unfollowed clues, and pending consequences that
should be picked up in Session 3.

Q5: Read the Session 3 prep note at tests/benchmark-campaign/.
Identify PCs without touchpoints, NPCs without vault files,
locations not described, and missing entity stubs.

Q6: Read the campaign at tests/benchmark-campaign/. Based on
Sessions 1-2, assign each PC an arc stage (Establishment/Testing/
Crisis/Transformation/New Equilibrium) and determine the A/B/C
plot structure for Session 3. Which PC gets the B-plot and why?

Q7: Using the campaign at tests/benchmark-campaign/, assign at
least one touchpoint per PC for Session 3. Each touchpoint should
have a type (Backstory Connection, Moral Dilemma, Ability
Showcase, Decision Callback, Arc Advancement Clue, or Character
Moment), a description, and draw on established threads or NPCs
from Sessions 1-2.

Q8: Review Sessions 1-2 at tests/benchmark-campaign/ and estimate
the spotlight distribution per PC. Flag any PC below the 15%
floor. Propose corrective B/C plot assignments for Session 3.
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

Q1: Full session prep — PC review, threads, NPCs, world state, gaps
Q2: Reconcile Session 3 prep against Session 2 play
Q3: Missing wrap-up fallback — what to tell GM
Q4: Thread scanning across Sessions 1-2
Q5: Gap flagging in Session 3 prep
Q6: Arc check and A/B/C plot assignment per PC
Q7: Touchpoint assignment per PC with type and source
Q8: Spotlight forecast — per-PC balance, 15% floor check

For each question, output:
- Scores for A and B on each dimension
- Brief justification (1 sentence per dimension)
- Total per question and overall total

Do NOT reveal which you think is control or test.
```
