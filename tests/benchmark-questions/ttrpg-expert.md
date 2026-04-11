# Benchmark Questions — ttrpg-expert

**Skill:** ttrpg-expert
**Purpose:** Baseline quality before shared-refs + filesystem-fallback refactor
**Runs:** 3 per variant (control, test) to establish variance

## Questions

### Q1 — Entity tracking schema for CoC 7e

How should I structure entity tracking for a new CoC 7e campaign?
What entity types do I need and what fields go in each?

### Q2 — Full NPC entity (cult leader)

Create a full NPC entity for a cult leader in my CoC campaign.
Include all required frontmatter fields, the AIMS profile, and
stat highlights.

### Q3 — Faction entity with clock

I need a faction entity for a secret society. Include goals,
clock, alliances, and the proper schema fields.

### Q4 — Clue entity with discovery state model

My investigators found a clue — a coded letter in a professor's
desk. Create a clue entity with the discovery state model showing
what each PC knows.

### Q5 — Thread entity for campaign-spanning narrative

I have a narrative thread — "The Missing Professor" — that was
introduced in Session 1 and needs to be tracked across the
campaign. How do thread entities work, and create one for me.

## Agent Prompts

### Control prompt (baseline — current main branch)

```text
You are a TTRPG rules expert and campaign entity architect. Read
the skill entry point:
skills/ttrpg-expert/SKILL.md
Follow routing to find the right files for each question.
Answer each question concisely (under 150 words each).

Questions:

Q1: How should I structure entity tracking for a new CoC 7e
campaign? What entity types do I need and what fields go in each?

Q2: Create a full NPC entity for a cult leader in my CoC campaign.
Include all required frontmatter fields, the AIMS profile, and
stat highlights.

Q3: I need a faction entity for a secret society. Include goals,
clock, alliances, and the proper schema fields.

Q4: My investigators found a clue — a coded letter in a
professor's desk. Create a clue entity with the discovery state
model showing what each PC knows.

Q5: I have a narrative thread — "The Missing Professor" — that was
introduced in Session 1 and needs to be tracked across the
campaign. How do thread entities work, and create one for me.
```

### Test prompt (post-refactor — feature branch)

Same as control prompt. Point at the feature branch checkout.
The skill entry point path is identical; the branch content differs.

```text
You are a TTRPG rules expert and campaign entity architect. Read
the skill entry point:
skills/ttrpg-expert/SKILL.md
Follow routing to find the right files for each question.
Answer each question concisely (under 150 words each).

Questions:

Q1: How should I structure entity tracking for a new CoC 7e
campaign? What entity types do I need and what fields go in each?

Q2: Create a full NPC entity for a cult leader in my CoC campaign.
Include all required frontmatter fields, the AIMS profile, and
stat highlights.

Q3: I need a faction entity for a secret society. Include goals,
clock, alliances, and the proper schema fields.

Q4: My investigators found a clue — a coded letter in a
professor's desk. Create a clue entity with the discovery state
model showing what each PC knows.

Q5: I have a narrative thread — "The Missing Professor" — that was
introduced in Session 1 and needs to be tracked across the
campaign. How do thread entities work, and create one for me.
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

Q1: Entity tracking schema for a new CoC 7e campaign
Q2: Full NPC entity — cult leader with AIMS profile and stats
Q3: Faction entity — secret society with goals, clock, alliances
Q4: Clue entity — coded letter with discovery state model per PC
Q5: Thread entity — "The Missing Professor" spanning multiple sessions

For each question, output:
- Scores for A and B on each dimension
- Brief justification (1 sentence per dimension)
- Total per question and overall total

Do NOT reveal which you think is control or test.
```
