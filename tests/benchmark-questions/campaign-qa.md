# Benchmark Questions — campaign-qa

**Skill:** campaign-qa
**Purpose:** Baseline quality before shared-refs + filesystem-fallback refactor
**Runs:** 3 per variant (control, test) to establish variance
**Campaign data:** `tests/benchmark-campaign/`

## Questions

### Q1 — Canon audit

Run a canon audit on my campaign at tests/benchmark-campaign/.
Check for factual contradictions between entity files and session
notes.

### Q2 — Timeline validation

Validate the timeline in my campaign at
tests/benchmark-campaign/_Campaign/Timeline.md against the session
notes and NPC statuses. Are there any inconsistencies?

### Q3 — Name similarity check

Check for name similarity issues across all NPCs and entities in
tests/benchmark-campaign/. Any names that could confuse players
or the GM?

### Q4 — Three Clue Rule audit

I have a mystery where the investigators need to find the cult's
hideout. Check the clue files in tests/benchmark-campaign/Clues/ —
does the Three Clue Rule hold?

### Q5 — Graph health check

Check the graph health of my campaign at
tests/benchmark-campaign/. Are there orphaned entities, broken
wiki-links, or missing relationship reciprocals?

## Agent Prompts

### Control prompt (baseline — current main branch)

```
You are a TTRPG campaign auditor and quality analyst. Read the
skill entry point:
/Users/antonypegg/PROJECTS/gm-apprentice/skills/campaign-qa/SKILL.md
Follow routing to find the right files for each question.
Answer each question concisely (under 150 words each).

Also read the campaign files at:
/Users/antonypegg/PROJECTS/gm-apprentice/tests/benchmark-campaign/
Start with the index at _meta/index.md, then read entity files,
session notes, and other campaign data as needed for each question.

Questions:

Q1: Run a canon audit on my campaign at tests/benchmark-campaign/.
Check for factual contradictions between entity files and session
notes.

Q2: Validate the timeline in my campaign at
tests/benchmark-campaign/_Campaign/Timeline.md against the session
notes and NPC statuses. Are there any inconsistencies?

Q3: Check for name similarity issues across all NPCs and entities
in tests/benchmark-campaign/. Any names that could confuse players
or the GM?

Q4: I have a mystery where the investigators need to find the
cult's hideout. Check the clue files in
tests/benchmark-campaign/Clues/ — does the Three Clue Rule hold?

Q5: Check the graph health of my campaign at
tests/benchmark-campaign/. Are there orphaned entities, broken
wiki-links, or missing relationship reciprocals?
```

### Test prompt (post-refactor — feature branch)

Same as control prompt. Point at the feature branch checkout.
The skill entry point path is identical; the branch content differs.

```
You are a TTRPG campaign auditor and quality analyst. Read the
skill entry point:
/Users/antonypegg/PROJECTS/gm-apprentice/skills/campaign-qa/SKILL.md
Follow routing to find the right files for each question.
Answer each question concisely (under 150 words each).

Also read the campaign files at:
/Users/antonypegg/PROJECTS/gm-apprentice/tests/benchmark-campaign/
Start with the index at _meta/index.md, then read entity files,
session notes, and other campaign data as needed for each question.

Questions:

Q1: Run a canon audit on my campaign at tests/benchmark-campaign/.
Check for factual contradictions between entity files and session
notes.

Q2: Validate the timeline in my campaign at
tests/benchmark-campaign/_Campaign/Timeline.md against the session
notes and NPC statuses. Are there any inconsistencies?

Q3: Check for name similarity issues across all NPCs and entities
in tests/benchmark-campaign/. Any names that could confuse players
or the GM?

Q4: I have a mystery where the investigators need to find the
cult's hideout. Check the clue files in
tests/benchmark-campaign/Clues/ — does the Three Clue Rule hold?

Q5: Check the graph health of my campaign at
tests/benchmark-campaign/. Are there orphaned entities, broken
wiki-links, or missing relationship reciprocals?
```

### Evaluator prompt (blind scoring)

```
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

Q1: Canon audit — factual contradictions between entities and sessions
Q2: Timeline validation — timeline vs session notes and NPC statuses
Q3: Name similarity — confusing names across NPCs and entities
Q4: Three Clue Rule — clue redundancy for finding the cult hideout
Q5: Graph health — orphaned entities, broken links, missing reciprocals

For each question, output:
- Scores for A and B on each dimension
- Brief justification (1 sentence per dimension)
- Total per question and overall total

Do NOT reveal which you think is control or test.
```
