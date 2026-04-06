# World Evolution — Test Plan

## Purpose

Verify that the world-evolution framework produces better
post-session world updates than the base model without the
skill. Compare structured faction turns, consequence tracking,
thread management, and discovery states against unguided
model output.

## Method

- Same model (sonnet) for both control and test
- Control: answer from training knowledge only, no file access
- Test: read SKILL.md as entry point, follow routing
- 10 questions: 4 system-agnostic + 2 per system (FitD, CoC, D&D)
- Each answer under 150 words (world updates are denser than lookups)
- Separate evaluator (opus) scores blind using rubric
- Measure: tokens, time, quality

## Scenario Context

Each question provides a brief "what happened this session"
scenario, then asks the GM assistant to propose world updates.
This tests the core use case: session just ended, help me
evolve the world.

## Questions

### System-Agnostic (any system)

**Q1 (Post-session update):**
"Session 4 just ended. The PCs broke into a merchant guild warehouse and stole shipping records. They were seen by a guard but escaped. The guild master is an NPC they've dealt with before — she sold them information in session 2. What changes in the world before next session?"

**Q2 (Consequence surfacing):**
"In session 1, the PCs burned down a rival's safehouse. In session 2, they made a deal with a corrupt official. It's now session 5. What consequences from those earlier actions should be surfacing by now?"

**Q3 (Thread management):**
"My campaign has these active threads: (a) the missing diplomat — introduced session 1, last advanced session 2; (b) the cursed artifact — introduced session 3, actively investigated; (c) the traitor in the party's patron organisation — hinted at in session 1, never advanced. Which threads need attention and what should I do with each?"

**Q4 (Discovery states):**
"I have 3 PCs. Elena investigated the crime scene (found the ritual dagger). Marcus stayed at the tavern gathering rumours (heard about disappearances). Jun was kidnapped and saw the cult leader's face but doesn't know his name. How should I track what each PC knows, and how does this affect next session's prep?"

### FitD-Specific

**Q5 (FitD faction turn):**
"My Blades crew just pulled a score against the Red Sashes, stealing their drug supply from a Silkshore canal boat. They generated 4 heat. The Lampblacks have been at war with the Red Sashes. The Hive controls the drug trade. What do the factions do in response?"

**Q6 (FitD world state):**
"It's been 3 scores since anyone interacted with the Bluecoats. The crew's wanted level is 2. The Spirit Wardens have a clock 'Investigate ghost activity in Crow's Foot' at 4/6. What advances in the world between sessions?"

### CoC-Specific

**Q7 (CoC faction turn):**
"My investigators just found and destroyed one of three ritual components needed for the cult's summoning. They questioned a cultist who gave up the location of the second component before dying. The cult leader doesn't know the investigators are involved yet. What does the cult do next?"

**Q8 (CoC world state):**
"Session 3 of a 1920s Arkham campaign. Investigators have been asking questions at Miskatonic University about the Marsh family. A librarian NPC has been helpful but nervous. Two sessions have passed since investigators last visited Innsmouth. What changes in the world?"

### D&D-Specific

**Q9 (D&D faction turn):**
"The PCs killed the goblin warchief and cleared the cave system. A local baron hired them for the job. A rival baron wanted the goblins as mercenaries. The nearest orc tribe has been watching the goblins' territory. What happens next in the region?"

**Q10 (D&D world state):**
"The PCs saved a village from a dragon attack but the temple was destroyed. The local cleric died. A merchant caravan is due to arrive in a week of game time. The PCs are level 5 and known in the region. What changes before next session?"

## Prompt Templates

### Control prompt
```
You are a TTRPG GM assistant. Answer each question concisely
(under 150 words each). Do NOT read any files — answer
purely from your training knowledge.

For each question, propose specific world changes the GM
should make. Be concrete — name factions, NPCs, consequences,
and timelines.

[questions with scenario context]

Answer all questions, numbered.
```

### Test prompt
```
You are a TTRPG GM assistant. You have access to a skill
file that tells you how to find reference data and procedures.

Start by reading the skill entry point:
/Users/antonypegg/PROJECTS/gm-apprentice/skills/ttrpg-expert/SKILL.md

Follow its routing instructions to find the right procedures
and reference files for each question. For post-session
world updates, the routing should direct you to
world-evolution.md.

[questions with scenario context]

Answer all questions, numbered, concisely (under 150 words
each). Be specific — name factions, NPCs, consequences,
timelines. Cite which reference file informed each answer.
```

### Evaluator prompt
```
You are evaluating two TTRPG GM assistant answers about
post-session world evolution. You do not know which used
reference files. Score each independently.

## Scoring Rubric (1-3 per dimension, 15 max)

| Dimension | 1 (Poor) | 2 (Partial) | 3 (Nailed it) |
|-----------|----------|-------------|----------------|
| Factual accuracy | Wrong faction names, contradicts scenario | Mostly consistent with scenario | Fully consistent, no contradictions |
| System specificity | Generic advice, no system mechanics | Right system but vague on mechanics | Uses system-specific mechanics (clocks, SAN, CR) |
| Actionability | Vague suggestions GM can't use directly | Usable with GM interpretation | Concrete proposals GM can approve/reject immediately |
| Mechanical grounding | No game values, timelines, or specifics | Some specifics but incomplete | Specific timelines, clock values, NPC names, consequences |
| Table-ready fiction | Generic/predictable, doesn't spark play | Fits the scenario but obvious | Surprising, evocative, makes the GM think "yes, that's what would happen" |

Score each answer on all 5 dimensions.
```

## Metrics Collected

- Tokens used (from agent usage report)
- Time taken (from agent duration_ms)
- Tool uses (file reads)
- Quality score per dimension (from blind evaluator)
- Total quality score out of 15 per question
