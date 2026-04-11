# Benchmark Questions — campaign-organizer

**Skill:** campaign-organizer
**Purpose:** Baseline quality before shared-refs + filesystem-fallback refactor
**Runs:** 3 per variant (control, test) to establish variance

## Questions

### Q1 — Vault scaffold for a new campaign

I'm starting a new CoC 7e campaign called "The Ashford Case" set
in 1920s Kingsport. Set up the vault structure for me — what
folders and files do I need?

### Q2 — NPC entity with frontmatter

Create an NPC entity file for Inspector Crane — he's a Kingsport
police detective, reluctant to help, knows more than he's saying.
Include proper frontmatter.

### Q3 — Chapter and session folder layout

My campaign has Chapter 1 with 3 sessions. What should the folder
layout look like, and what goes in each session file?

### Q4 — Source confidence lifecycle

An entity has source_confidence: DRAFT. When should I promote it
to AUTHORITATIVE, and what does SUPERSEDED mean?

### Q5 — Filesystem mode without Obsidian

I don't have Obsidian installed. Can I still organise my campaign
files? How does filesystem mode work?

## Agent Prompts

### Control prompt (baseline — current main branch)

```text
You are a TTRPG campaign organizer. Read the skill entry point:
/Users/antonypegg/PROJECTS/gm-apprentice/skills/campaign-organizer/SKILL.md
Follow routing to find the right files for each question.
Answer each question concisely (under 150 words each).

Questions:

Q1: I'm starting a new CoC 7e campaign called "The Ashford Case"
set in 1920s Kingsport. Set up the vault structure for me — what
folders and files do I need?

Q2: Create an NPC entity file for Inspector Crane — he's a
Kingsport police detective, reluctant to help, knows more than
he's saying. Include proper frontmatter.

Q3: My campaign has Chapter 1 with 3 sessions. What should the
folder layout look like, and what goes in each session file?

Q4: An entity has source_confidence: DRAFT. When should I promote
it to AUTHORITATIVE, and what does SUPERSEDED mean?

Q5: I don't have Obsidian installed. Can I still organise my
campaign files? How does filesystem mode work?
```

### Test prompt (post-refactor — feature branch)

Same as control prompt. Point at the feature branch checkout.
The skill entry point path is identical; the branch content differs.

```text
You are a TTRPG campaign organizer. Read the skill entry point:
/Users/antonypegg/PROJECTS/gm-apprentice/skills/campaign-organizer/SKILL.md
Follow routing to find the right files for each question.
Answer each question concisely (under 150 words each).

Questions:

Q1: I'm starting a new CoC 7e campaign called "The Ashford Case"
set in 1920s Kingsport. Set up the vault structure for me — what
folders and files do I need?

Q2: Create an NPC entity file for Inspector Crane — he's a
Kingsport police detective, reluctant to help, knows more than
he's saying. Include proper frontmatter.

Q3: My campaign has Chapter 1 with 3 sessions. What should the
folder layout look like, and what goes in each session file?

Q4: An entity has source_confidence: DRAFT. When should I promote
it to AUTHORITATIVE, and what does SUPERSEDED mean?

Q5: I don't have Obsidian installed. Can I still organise my
campaign files? How does filesystem mode work?
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

Q1: Vault scaffold for a new CoC 7e campaign (folders + files)
Q2: NPC entity file with frontmatter (Inspector Crane)
Q3: Chapter/session folder layout with file contents
Q4: Source confidence lifecycle (DRAFT → AUTHORITATIVE, SUPERSEDED)
Q5: Filesystem mode without Obsidian

For each question, output:
- Scores for A and B on each dimension
- Brief justification (1 sentence per dimension)
- Total per question and overall total

Do NOT reveal which you think is control or test.
```
