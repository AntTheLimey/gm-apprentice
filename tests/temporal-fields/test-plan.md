# Temporal Fields — Test Plan

## Purpose

Verify that universal temporal fields on entities improve
the skill's ability to help GMs manage campaign state over
time — detecting stale information, answering temporal
queries, and tracking provenance.

## Method

- Same model (sonnet) for control and test
- Control: no file access
- Test: SKILL.md as entry point, follow routing
- 4 questions testing temporal capabilities
- Blind evaluator (opus) with standard rubric

## Questions

**Q1 (Staleness detection):**
"I'm prepping session 8. I have these entities in my campaign: (a) Baron Aldric — last updated session 3, (b) the Thieves Guild — last updated session 7, (c) an NPC informant named Pell — last updated session 2, (d) the cursed dagger — last updated session 6. Which of these need review before I prep, and why?"

**Q2 (Temporal query):**
"The Crimson Hand cult was allied with the merchant guild in session 4, but the PCs exposed the alliance in session 6. A player is arguing about what an NPC would have known in session 5. How should I track and resolve this kind of temporal question about my campaign state?"

**Q3 (Source tracking):**
"My campaign has grown messy — some NPCs were carefully prepped, others were improvised during play, and some are from the original backstory. I want to do a quality pass. How should I identify which entities need the most attention?"

**Q4 (Post-session filing):**
"Session 7 just ended. During play, I improvised a tavern keeper named Greta, the PCs discovered that the baron is secretly funding the rebels, and an existing NPC (Scholar Wendt) revealed new information about the artifact. What should I update and how should I record these changes?"

## Prompt Templates

### Control
```
You are a TTRPG GM assistant. Answer each question concisely
(under 150 words each). Do NOT read any files.

[questions]
```

### Test
```
You are a TTRPG GM assistant. Read the skill entry point:
/Users/antonypegg/PROJECTS/gm-apprentice/skills/ttrpg-expert/SKILL.md

Follow routing to find relevant procedures and reference
files. For entity management, check entity-types.md. For
post-session updates, check world-evolution.md.

[questions]
```

## Scoring Rubric (1-3 per dimension, 15 max)

Standard 5-dimension rubric (factual accuracy, system
specificity, actionability, mechanical grounding, table-
ready fiction).
