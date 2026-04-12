# Benchmark Questions — ttrpg-expert (Regency Cthulhu)

**Skill:** ttrpg-expert
**Purpose:** Quality baseline for Regency Cthulhu overlay + non-regression of base CoC
**Runs:** 3 per variant (control, test) to establish variance

## Questions

### Q1 — Regency Gentleman character creation

Create a Regency Cthulhu Gentleman investigator. Include all
8 characteristics, derived values, occupation skills, Credit
Rating band, living standard, and Reputation score.

### Q2 — Regency skill replacements

What skills are unavailable in Regency Cthulhu and what
replaces them? My investigator wants to use Science and
Hypnosis — what are the Regency equivalents?

### Q3 — Regency social mechanics at a ball

My Regency investigators are attending a ball. What social
skills matter and how does Etiquette work compared to Credit
Rating? Include Dancing and Fashion if relevant.

### Q4 — Base CoC character (non-Regency)

Create a standard 1920s Call of Cthulhu Private Investigator.
Include characteristics, derived values, occupation skills,
and Credit Rating.

### Q5 — Base CoC skill lookup (non-Regency)

What's the base chance for Drive Auto and Electrical Repair
in Call of Cthulhu 7e?

## Agent Prompts

### Control prompt (pre-Regency — current main branch)

```text
You are a TTRPG rules expert. Read the skill entry point:
skills/ttrpg-expert/SKILL.md
Follow routing to find the right files for each question.
Answer each question concisely (under 150 words each).

Questions:

Q1: Create a Regency Cthulhu Gentleman investigator. Include
all 8 characteristics, derived values, occupation skills,
Credit Rating band, living standard, and Reputation score.

Q2: What skills are unavailable in Regency Cthulhu and what
replaces them? My investigator wants to use Science and
Hypnosis — what are the Regency equivalents?

Q3: My Regency investigators are attending a ball. What social
skills matter and how does Etiquette work compared to Credit
Rating? Include Dancing and Fashion if relevant.

Q4: Create a standard 1920s Call of Cthulhu Private
Investigator. Include characteristics, derived values,
occupation skills, and Credit Rating.

Q5: What's the base chance for Drive Auto and Electrical
Repair in Call of Cthulhu 7e?
```

### Test prompt (post-Regency — feature branch)

Same questions. Point at the feature branch checkout.

```text
You are a TTRPG rules expert. Read the skill entry point:
skills/ttrpg-expert/SKILL.md
Follow routing to find the right files for each question.
Answer each question concisely (under 150 words each).

Questions:

Q1: Create a Regency Cthulhu Gentleman investigator. Include
all 8 characteristics, derived values, occupation skills,
Credit Rating band, living standard, and Reputation score.

Q2: What skills are unavailable in Regency Cthulhu and what
replaces them? My investigator wants to use Science and
Hypnosis — what are the Regency equivalents?

Q3: My Regency investigators are attending a ball. What social
skills matter and how does Etiquette work compared to Credit
Rating? Include Dancing and Fashion if relevant.

Q4: Create a standard 1920s Call of Cthulhu Private
Investigator. Include characteristics, derived values,
occupation skills, and Credit Rating.

Q5: What's the base chance for Drive Auto and Electrical
Repair in Call of Cthulhu 7e?
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

Q1: Regency Gentleman character with stats, CR band, Reputation
Q2: Regency unavailable skills and their replacements
Q3: Regency ball — social skills, Etiquette vs Credit Rating
Q4: Standard 1920s CoC Private Investigator (NOT Regency)
Q5: Base chance for Drive Auto and Electrical Repair (NOT Regency)

For each question, output:
- Scores for A and B on each dimension
- Brief justification (1 sentence per dimension)
- Total per question and overall total

Do NOT reveal which you think is control or test.
```
