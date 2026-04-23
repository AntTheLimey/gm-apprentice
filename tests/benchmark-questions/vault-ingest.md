# Benchmark Questions — vault-ingest

**Skill:** vault-ingest
**Purpose:** Validate ingestion pipeline judgment and output quality
**Runs:** 3 per variant (Sonnet agent), blind evaluation (Opus)
**Campaign data:** `tests/benchmark-campaign/`
**Models:** claude-sonnet-4-6 (agents), claude-opus-4-6 (evaluator)

## Questions

### Q1 — Prep-vs-play discrimination

Here is a mixed document. Classify each section as play
transcript, play fragment, scenario prep, research/brainstorm,
or keeper recollection. Explain your reasoning.

[Use test fixture: tests/benchmark-campaign/_inbox/mixed-source.md]

### Q2 — Name deduplication

Read the source material in tests/benchmark-campaign/_inbox/.
Two documents mention characters with similar but inconsistent
names. Identify which names refer to the same entity and which
are distinct characters.

### Q3 — Canon confidence assignment

Given the classified source material from Q1, assign
source_confidence to each extracted entity. Show your reasoning
for AUTHORITATIVE vs DRAFT vs NOT CANON.

### Q4 — Interview question quality

Given this gaps list from a hypothetical ingestion:
- Unknown: Did the investigators visit the lighthouse?
- Unknown: What happened to Captain Mercer after the storm?
- Unknown: Were the handouts from the library found?
- Unknown: How did the confrontation at the docks end?

Write the first three interview questions you'd ask the GM.
Each must be contextual, single, and designed to trigger memory.

### Q5 — Synthesized play notes quality

Given these confirmed play events and GM answers, produce a
Play Notes file that session-wrapup can process. Include
proper frontmatter per the document chain standard.

[Use confirmed events from Q1-Q4 fixture answers]

### Q6 — Image classification

You receive three images:
- A character sheet PDF
- A hand-drawn map with location labels
- A portrait illustration of an NPC

For each: where does it go in _attachments/? Do you attempt
content extraction? What entity does it attach to?

### Q7 — Bootstrap detection

You're invoked with source material but the working directory
has no _meta/ folder and no vault structure. What do you do?

### Q8 — Bucket sorting

Given source material spanning three different time periods
with mixed chronological signals, sort it into buckets. Show
your sorting signals and confidence levels.

## Agent Prompts

### Test prompt (vault-ingest skill)

````text
You are a TTRPG vault ingestion assistant. Read the skill entry
point: skills/vault-ingest/SKILL.md
Follow routing to find reference files for each question.
Answer each question concisely (under 150 words each, except Q5
which can be up to 300 words).

Also read the campaign files at:
tests/benchmark-campaign/
Start with the index at _meta/index.md, then read _inbox/ files
and entity files as needed.

Questions:
[all 8 questions above]
````

### Evaluator prompt (blind scoring)

````text
You are evaluating two TTRPG GM assistant responses. One is
labelled A, one B. You do not know which is control or test.

Score each answer on 5 dimensions (1-3 each, 15 max per question):

| Dimension | 1 (Poor) | 2 (Partial) | 3 (Nailed it) |
|-----------|----------|-------------|----------------|
| Classification accuracy | Wrong types, prep treated as play | Mostly correct, missed fragments | Perfect prep/play/research discrimination |
| Canon judgment | Wrong confidence, invented content | Mostly correct confidence | Correct confidence, no invention, proper flags |
| Interview quality | Bulk questions, no context | Some context but generic | Contextual, single, memory-triggering |
| Schema conformance | Wrong frontmatter, wrong paths | Partial conformance | Perfect document chain compliance |
| Actionability | Needs significant rework | Usable with GM effort | Drop-in ready, downstream skills accept output |

Questions for context:
Q1: Prep-vs-play discrimination
Q2: Name deduplication across documents
Q3: Canon confidence assignment
Q4: Interview question quality
Q5: Synthesized play notes for session-wrapup
Q6: Image classification and attachment
Q7: Bootstrap detection (no vault)
Q8: Bucket sorting with mixed signals

For each question, output:
- Scores for A and B on each dimension
- Brief justification (1 sentence per dimension)
- Total per question and overall total

Do NOT reveal which you think is control or test.
````
