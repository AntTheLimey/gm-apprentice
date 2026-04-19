# Benchmark Questions — session-play

**Skill:** session-play
**Purpose:** Establish baseline for split session-play skill (no prior coverage)
**Runs:** 3 per variant (Sonnet agent), blind evaluation (Opus)
**Campaign data:** `tests/benchmark-campaign/`
**Models:** claude-sonnet-4-6 (agents), claude-opus-4-6 (evaluator)

## Questions

### Q1 — Quick NPC lookup

We're playing right now. Quick — what does Elias Blackwood want?
Check his vault file at tests/benchmark-campaign/.

### Q2 — Rules assist

We're mid-session, Call of Cthulhu 7e. Can an investigator use
Spot Hidden while running from a Deep One? What's the penalty?

### Q3 — On-the-fly NPC generation

I need a harbour master for the Arkham docks. The investigators
are going to question him about suspicious cargo deliveries.
Make him interesting.

### Q4 — On-the-fly location generation

Give me 3 options for where the cult could be meeting in Arkham.
Each should feel different — I want choices to present to my
players.

### Q5 — Note capture

Notes from play: "PCs went to warehouse. Found crates with
strange symbols. Martha picked lock, Thomas kept watch. Heard
chanting from basement but didn't investigate. Left before
dawn. Martha pocketed a small idol."

## Agent Prompts

### Control prompt (monolith — current main branch)

```text
You are a TTRPG at-the-table assistant. Read the skill entry point:
skills/session-lifecycle/SKILL.md
Follow routing to find the right files for each question.
Answer each question as briefly as possible (under 50 words each
for lookups, under 100 words for generation).

Also read the campaign files at:
tests/benchmark-campaign/
Start with the index at _meta/index.md, then read entity files
as needed for each question.

Questions:

Q1: We're playing right now. Quick — what does Elias Blackwood
want? Check his vault file at tests/benchmark-campaign/.

Q2: We're mid-session, Call of Cthulhu 7e. Can an investigator
use Spot Hidden while running from a Deep One? What's the penalty?

Q3: I need a harbour master for the Arkham docks. The
investigators are going to question him about suspicious cargo
deliveries. Make him interesting.

Q4: Give me 3 options for where the cult could be meeting in
Arkham. Each should feel different — I want choices to present
to my players.

Q5: Notes from play: "PCs went to warehouse. Found crates with
strange symbols. Martha picked lock, Thomas kept watch. Heard
chanting from basement but didn't investigate. Left before dawn.
Martha pocketed a small idol."
```

### Test prompt (split skill — feature branch)

```text
You are a TTRPG at-the-table assistant. Read the skill entry point:
skills/session-play/SKILL.md
Follow routing to find the right files for each question.
Answer each question as briefly as possible (under 50 words each
for lookups, under 100 words for generation).

Also read the campaign files at:
tests/benchmark-campaign/
Start with the index at _meta/index.md, then read entity files
as needed for each question.

Questions:

Q1: We're playing right now. Quick — what does Elias Blackwood
want? Check his vault file at tests/benchmark-campaign/.

Q2: We're mid-session, Call of Cthulhu 7e. Can an investigator
use Spot Hidden while running from a Deep One? What's the penalty?

Q3: I need a harbour master for the Arkham docks. The
investigators are going to question him about suspicious cargo
deliveries. Make him interesting.

Q4: Give me 3 options for where the cult could be meeting in
Arkham. Each should feel different — I want choices to present
to my players.

Q5: Notes from play: "PCs went to warehouse. Found crates with
strange symbols. Martha picked lock, Thomas kept watch. Heard
chanting from basement but didn't investigate. Left before dawn.
Martha pocketed a small idol."
```

### Evaluator prompt (blind scoring)

```text
You are evaluating two TTRPG GM assistant responses. One is
labelled A, one B. You do not know which is control or test.

These are at-the-table responses during live play. Speed and
brevity matter — penalise verbose answers.

Score each answer on 5 dimensions (1-3 each, 15 max per question):

| Dimension | 1 (Poor) | 2 (Partial) | 3 (Nailed it) |
|-----------|----------|-------------|----------------|
| Factual accuracy | Wrong stats, hallucinated names | Mostly correct, minor errors | All verifiable facts correct |
| System specificity | Could be any system, no mechanics | Right system but generic | Uses system-specific idiom, conventions, tone |
| Actionability | Needs significant rework | Usable with GM effort | Drop-in ready, use as-is |
| Mechanical grounding | No concrete numbers or values | Some mechanics but incomplete | Specific stats, DCs, costs, rolls, thresholds |
| Table-ready fiction | Generic/obvious/AI slop | Fits system but predictable | Evocative, system-native, sparks play |

Questions for context:

Q1: Quick NPC lookup — Elias Blackwood's motivation
Q2: Rules assist — Spot Hidden while fleeing, CoC 7e
Q3: On-the-fly NPC — harbour master for questioning
Q4: On-the-fly locations — 3 cult meeting options
Q5: Note capture — raw shorthand play notes

For each question, output:
- Scores for A and B on each dimension
- Brief justification (1 sentence per dimension)
- Total per question and overall total

Do NOT reveal which you think is control or test.
```
