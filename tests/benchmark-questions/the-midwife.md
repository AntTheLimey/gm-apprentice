# Benchmark Questions — the-midwife

**Skill:** the-midwife
**Purpose:** Baseline quality before gotchas/validation/why-reasoning improvements
**Runs:** 1 per variant (Phase 1), expand to 3 if warranted
**Campaign data:** `tests/benchmark-campaign/`
**Models:** claude-sonnet-4-6 (agents), claude-sonnet-4-6 (evaluator)

## Questions

### Q1 — Shape a vague premise

I want to run something with cosmic horror in 1920s New England.
Maybe investigators? I like the idea of a small town with secrets.
That's all I have. Help me shape this into something playable.
My system is CoC 7e.

### Q2 — Adventure brief from confirmed concept

Write an adventure brief for this confirmed concept:

Title: "The Threshold Beneath"
System: CoC 7e
Scope: few-shot (3-4 sessions)
Shape: hub-and-spoke
Premise: A mining town built over a pre-human structure.
  Miners have broken through into something. The town is
  changing. Investigators arrive after a friend stops writing.
Core tension: The structure wants to be found. It rewards
  curiosity with knowledge that corrodes sanity.
Key NPCs: Mayor Harding (knows, covers up), Nell Briggs
  (miner's widow, saw something), Dr. Voss (geologist,
  obsessed with the symbols).
Factions: Town Council (suppress), The Changed (worship),
  University (exploit).

### Q3 — Vault scaffold for greenfield campaign

I'm starting a brand new CoC 7e campaign called "The Ashford
Inheritance" set in 1920s rural Vermont. No existing vault.
Scaffold the vault structure for me — Campaign Overview,
folders, templates, meta files. Show me what the Campaign
Overview file looks like with proper frontmatter.

### Q4 — Entity promotion from sketches

During our adventure design for "The Threshold Beneath" we
sketched these entities:

- Mayor Harding (npc) — corrupt politician, knows about the
  structure, taking bribes from the university
- The Threshold (location) — pre-human underground structure,
  geometry that hurts to look at
- The Changed (faction) — townsfolk transformed by exposure,
  worship the structure
- Dr. Eliza Voss (npc) — Miskatonic geologist, published a
  paper on the symbols, increasingly erratic
- Briggs Mine (location) — where the breakthrough happened,
  now sealed by the town council
- Nell Briggs (npc) — widow of the first miner who broke
  through, heard him talking in his sleep in an unknown language

Which should I promote to vault entities? Create the files for
the ones you'd recommend, with proper frontmatter and initial
content.

## Agent Prompts

### Control prompt (current main)

```text
You are a TTRPG adventure creation guide. Read the skill entry point:
skills/the-midwife/SKILL.md
Follow routing to find the right reference files for each question.
Answer each question concisely (under 200 words each, except Q2
and Q4 which can be up to 500 words). When creating entity files
or adventure briefs, show complete frontmatter and body content.

Also read the campaign files at:
tests/benchmark-campaign/
Start with the index at _meta/index.md for vault structure context.

Read shared references:
- skills/shared/entity-schema.md
- skills/shared/templates/campaign-overview.md

Questions:

Q1: I want to run something with cosmic horror in 1920s New England.
Maybe investigators? I like the idea of a small town with secrets.
That's all I have. Help me shape this into something playable.
My system is CoC 7e.

Q2: Write an adventure brief for this confirmed concept:
Title: "The Threshold Beneath"
System: CoC 7e, Scope: few-shot (3-4 sessions), Shape: hub-and-spoke
Premise: A mining town built over a pre-human structure. Miners have
broken through into something. The town is changing. Investigators
arrive after a friend stops writing.
Core tension: The structure wants to be found. It rewards curiosity
with knowledge that corrodes sanity.
Key NPCs: Mayor Harding (knows, covers up), Nell Briggs (miner's
widow, saw something), Dr. Voss (geologist, obsessed with symbols).
Factions: Town Council (suppress), The Changed (worship), University (exploit).

Q3: I'm starting a brand new CoC 7e campaign called "The Ashford
Inheritance" set in 1920s rural Vermont. No existing vault. Scaffold
the vault structure for me — Campaign Overview, folders, templates,
meta files. Show me what the Campaign Overview file looks like with
proper frontmatter.

Q4: During our adventure design for "The Threshold Beneath" we
sketched these entities:
- Mayor Harding (npc) — corrupt politician, knows about the structure
- The Threshold (location) — pre-human underground structure
- The Changed (faction) — townsfolk transformed by exposure
- Dr. Eliza Voss (npc) — Miskatonic geologist, increasingly erratic
- Briggs Mine (location) — where the breakthrough happened
- Nell Briggs (npc) — widow of first miner who broke through
Which should I promote to vault entities? Create the files for the
ones you'd recommend, with proper frontmatter and initial content.
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

Q1: Shape a vague cosmic horror premise into a playable concept
Q2: Write a complete adventure brief from a confirmed concept
Q3: Scaffold a greenfield vault with Campaign Overview
Q4: Entity promotion — create vault files from sketched entities

For each question, output:
- Scores for A and B on each dimension
- Brief justification (1 sentence per dimension)
- Total per question and overall total

Do NOT reveal which you think is control or test.
```
