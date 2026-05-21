# Benchmark Questions — vault-ingest

**Skill:** vault-ingest
**Purpose:** Baseline quality before gotchas/validation/why-reasoning improvements
**Runs:** 1 per variant (Phase 1), expand to 3 if warranted
**Campaign data:** `tests/benchmark-campaign/`
**Models:** claude-sonnet-4-6 (agents), claude-sonnet-4-6 (evaluator)

## Questions

### Q1 — Source classification

I have these files to ingest into my campaign vault at
tests/benchmark-campaign/:

1. A 2-page document with NPC names, descriptions, and faction ties
2. A handwritten session log with dice rolls and skill check results
3. A timeline of in-game events with dates
4. A character sheet PDF for a new PC joining mid-campaign

Classify each document and tell me what vault entities each
would produce.

### Q2 — Entity creation from pasted NPC list

Ingest these NPCs into my campaign vault at
tests/benchmark-campaign/. Create proper entity files:

- Lady Ashworth: Patron of the arts, secretly funding occult
  research. Connected to The Hermetic Order. Status: alive.
- Dr. Crane: Alienist at Arkham Sanitarium, treating patients
  who've seen too much. Status: alive.
- The Confessor: Anonymous letter-writer threatening to expose
  the Order's activities. Status: unknown.

### Q3 — Bucket sorting with ambiguity

I have session notes that mention "the incident at the docks"
and reference both Inspector Crane and Lady Ashworth. There's
no session number, but it mentions "three weeks after the gala"
and the in-game date is sometime in November 1923. My campaign
at tests/benchmark-campaign/ has sessions through Session 2.
Where does this material belong? What confidence level would
you assign?

### Q4 — Full synthesis pipeline

Process these raw play notes into a proper wrap-up for my
campaign at tests/benchmark-campaign/. The notes are for a
new Session 3:

"Players investigated the warehouse on Dock Street. Found
crates marked with the Elder Sign. Marcus (PC) failed his
Spot Hidden (rolled 89 vs 45). Sarah (PC) succeeded her
Library Use (rolled 23 vs 65) and found shipping manifests
linking crates to Miskatonic University. New NPC: Dock
foreman Big Pete, gruff, knows something. They left at
sunset heading to the university. In-game date: Nov 15, 1923."

## Agent Prompts

### Control prompt (current main)

```text
You are a TTRPG vault ingestion assistant. Read the skill entry point:
skills/vault-ingest/SKILL.md
Follow routing to find the right reference files for each question.
Answer each question concisely (under 200 words each, except Q4
which can be up to 400 words). When creating entity files, show
complete frontmatter and body content.

Also read the campaign files at:
tests/benchmark-campaign/
Start with the index at _meta/index.md, then read entity files,
session files, and templates as needed.

Questions:

Q1: I have these files to ingest into my campaign vault at
tests/benchmark-campaign/:
1. A 2-page document with NPC names, descriptions, and faction ties
2. A handwritten session log with dice rolls and skill check results
3. A timeline of in-game events with dates
4. A character sheet PDF for a new PC joining mid-campaign
Classify each document and tell me what vault entities each
would produce.

Q2: Ingest these NPCs into my campaign vault at
tests/benchmark-campaign/. Create proper entity files:
- Lady Ashworth: Patron of the arts, secretly funding occult
  research. Connected to The Hermetic Order. Status: alive.
- Dr. Crane: Alienist at Arkham Sanitarium, treating patients
  who've seen too much. Status: alive.
- The Confessor: Anonymous letter-writer threatening to expose
  the Order's activities. Status: unknown.

Q3: I have session notes that mention "the incident at the docks"
and reference both Inspector Crane and Lady Ashworth. There's
no session number, but it mentions "three weeks after the gala"
and the in-game date is sometime in November 1923. My campaign
at tests/benchmark-campaign/ has sessions through Session 2.
Where does this material belong? What confidence level would
you assign?

Q4: Process these raw play notes into a proper wrap-up for my
campaign at tests/benchmark-campaign/. The notes are for a
new Session 3:
"Players investigated the warehouse on Dock Street. Found
crates marked with the Elder Sign. Marcus (PC) failed his
Spot Hidden (rolled 89 vs 45). Sarah (PC) succeeded her
Library Use (rolled 23 vs 65) and found shipping manifests
linking crates to Miskatonic University. New NPC: Dock
foreman Big Pete, gruff, knows something. They left at
sunset heading to the university. In-game date: Nov 15, 1923."
```

### Test prompt (improved skill)

Same as control prompt — identical text. The skill file content
on the branch differs (has gotchas, validation loops, why-reasoning).

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

Q1: Classify source documents and identify what vault entities each produces
Q2: Create NPC entity files from a pasted list (frontmatter + body)
Q3: Sort ambiguous source material into chronological buckets
Q4: Full synthesis — raw play notes into wrap-up + entity files

For each question, output:
- Scores for A and B on each dimension
- Brief justification (1 sentence per dimension)
- Total per question and overall total

Do NOT reveal which you think is control or test.
```
