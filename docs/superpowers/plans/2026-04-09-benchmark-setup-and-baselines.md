# Benchmark Setup & Baselines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a synthetic campaign for benchmarking campaign-qa and session-lifecycle, establish baseline scores for all four skills before the shared-refs refactor begins.

**Architecture:** A small synthetic CoC campaign (~20 files) with deliberate problems for QA to catch and session history for lifecycle to process. Benchmarks follow the existing methodology (sonnet agents, opus blind evaluator, 5-dimension rubric, 3 runs each). Baselines gathered against the current main branch.

**Tech Stack:** Markdown files, Claude Code agents (sonnet/opus), existing benchmark methodology from docs/testing-methodology.md.

---

### Task 1: Create Synthetic Campaign Files

**Files:**
- Create: `tests/benchmark-campaign/_meta/index.md`
- Create: `tests/benchmark-campaign/_meta/entity-types.md`
- Create: `tests/benchmark-campaign/_Campaign/Timeline.md`
- Create: `tests/benchmark-campaign/_Campaign/Player Characters.md`
- Create: `tests/benchmark-campaign/Chapters/Chapter 1/chapter-overview.md`
- Create: `tests/benchmark-campaign/Chapters/Chapter 1/Sessions/Session 1 - The Missing Professor.md`
- Create: `tests/benchmark-campaign/Chapters/Chapter 1/Sessions/Session 2 - The Docks at Night.md`
- Create: `tests/benchmark-campaign/Chapters/Chapter 1/Sessions/Session 3 - The Inner Sanctum.md`
- Create: `tests/benchmark-campaign/NPCs/Professor_Ashford.md`
- Create: `tests/benchmark-campaign/NPCs/Inspector_Crane.md`
- Create: `tests/benchmark-campaign/NPCs/Mrs_Whitmore.md`
- Create: `tests/benchmark-campaign/NPCs/Brother_Ezra.md`
- Create: `tests/benchmark-campaign/NPCs/Tommy_Flanagan.md`
- Create: `tests/benchmark-campaign/Locations/Ashford_Study.md`
- Create: `tests/benchmark-campaign/Locations/Kingsport_Docks.md`
- Create: `tests/benchmark-campaign/Locations/St_Anselms_Church.md`
- Create: `tests/benchmark-campaign/Factions/Order_of_the_Silver_Twilight.md`
- Create: `tests/benchmark-campaign/Clues/Coded_Letter.md`
- Create: `tests/benchmark-campaign/Clues/Strange_Symbol.md`
- Create: `tests/benchmark-campaign/Clues/Witness_Statement.md`

The campaign is "The Ashford Case" — a 3-session CoC 7e
investigation in 1920s Kingsport. Two investigators track a
missing professor into a cult conspiracy.

**Deliberate problems baked in for QA to find:**
1. Timeline contradiction: Professor Ashford's status is
   "missing" in his NPC file but Session 2 notes reference
   him speaking at a lecture
2. Name similarity: Inspector Crane / Professor Crain
   (Crain mentioned in Session 2 notes as a witness)
3. Broken wiki-link: Session 1 references `[[Dr. Marsh]]`
   but no entity file exists
4. Three Clue Rule violation: the cult hideout location has
   only one clue path (the coded letter)
5. Orphaned entity: St_Anselms_Church has zero inbound links
   from any other file
6. Stale thread: Tommy Flanagan (informant) introduced in
   Session 1, not mentioned or advanced in Session 2 or 3

**Session-lifecycle test data:**
- Session 2 has raw play notes (unprocessed, shorthand)
- Session 3 is status:planned with prep that doesn't account
  for what happened in Session 2
- New NPC "Dockmaster Hayes" mentioned in Session 2 play
  notes but has no entity file

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p tests/benchmark-campaign/_meta
mkdir -p tests/benchmark-campaign/_Campaign
mkdir -p tests/benchmark-campaign/Chapters/Chapter\ 1/Sessions
mkdir -p tests/benchmark-campaign/NPCs
mkdir -p tests/benchmark-campaign/Locations
mkdir -p tests/benchmark-campaign/Factions
mkdir -p tests/benchmark-campaign/Clues
```

- [ ] **Step 2: Create _meta/index.md**

```markdown
# Campaign Index: The Ashford Case

## Campaign
- System: Call of Cthulhu 7th Edition
- Setting: Kingsport, Massachusetts, 1925
- Status: Active
- Sessions played: 2
- Current in-game date: October 18, 1925

## Entity Registry
| Entity | Type | Status | File |
|--------|------|--------|------|
| Professor Ashford | NPC | missing | NPCs/Professor_Ashford.md |
| Inspector Crane | NPC | active | NPCs/Inspector_Crane.md |
| Mrs Whitmore | NPC | active | NPCs/Mrs_Whitmore.md |
| Brother Ezra | NPC | active | NPCs/Brother_Ezra.md |
| Tommy Flanagan | NPC | active | NPCs/Tommy_Flanagan.md |
| Ashford's Study | Location | known | Locations/Ashford_Study.md |
| Kingsport Docks | Location | known | Locations/Kingsport_Docks.md |
| St Anselm's Church | Location | unknown | Locations/St_Anselms_Church.md |
| Order of the Silver Twilight | Faction | active | Factions/Order_of_the_Silver_Twilight.md |
| Coded Letter | Clue | investigated | Clues/Coded_Letter.md |
| Strange Symbol | Clue | observed | Clues/Strange_Symbol.md |
| Witness Statement | Clue | rumoured | Clues/Witness_Statement.md |
```

- [ ] **Step 3: Create _Campaign/Timeline.md**

```markdown
# Campaign Timeline: The Ashford Case

## Session 1 — October 14, 1925
- Investigators hired by Eleanor Ashford (professor's daughter)
- Searched Professor Ashford's study at Miskatonic University
- Found coded letter in desk drawer and strange symbol carved under desk
- Met Tommy Flanagan at the Green Parrot tavern — he claims to have seen Ashford at the docks
- Spoke with Mrs Whitmore (department secretary) who noted Ashford's erratic behaviour

## Session 2 — October 16, 1925
- Investigators visited Kingsport Docks at night
- Encountered Brother Ezra near a warehouse, acting suspiciously
- Found crates marked with the same strange symbol from Ashford's desk
- Chase through the dock district — Brother Ezra escaped
- Dockmaster Hayes (new contact) confirmed night-time deliveries to the warehouse
- Professor Ashford seen giving a lecture at the university [DELIBERATE CONTRADICTION — he is supposed to be missing]

## Session 3 — October 18, 1925 (planned, not yet played)
- Investigators plan to infiltrate the Silver Twilight lodge
- Brother Ezra is expected to lead them to the inner sanctum
```

- [ ] **Step 4: Create _Campaign/Player Characters.md**

```markdown
# Player Characters

## Dr. Margaret Voss
- Player: Sarah
- Occupation: Doctor of Medicine
- Status: active
- Key stats: INT 80, EDU 85, Medicine 65, Library Use 55
- Current SAN: 58 (started 65)
- Drive: Find out what happened to her colleague Ashford
- Arc stage: Testing (witnessed things she cannot explain)

## Jack Riley
- Player: Tom
- Occupation: Private Investigator
- Status: active
- Key stats: DEX 70, STR 65, Spot Hidden 60, Fighting (Brawl) 55
- Current SAN: 52 (started 60)
- Drive: The money, at first. Now something personal.
- Arc stage: Testing (the docks chase shook him)
```

- [ ] **Step 5: Create all NPC files**

Write each NPC with YAML frontmatter (type, createdSession,
lastUpdated, asOfSession, source_confidence, aliases) and
2-3 paragraphs of description, motivations, and secrets.

Professor_Ashford.md: missing Miskatonic professor, secretly
involved with the Order, status "missing" in frontmatter.

Inspector_Crane.md: Kingsport police, reluctant ally, knows
more than he says.

Mrs_Whitmore.md: department secretary, witnessed Ashford's
decline, helpful but frightened.

Brother_Ezra.md: cult enforcer, spotted at the docks,
escaped the chase in Session 2.

Tommy_Flanagan.md: dockside informant, introduced Session 1,
DELIBERATELY not referenced in Session 2 or 3 (stale thread).

- [ ] **Step 6: Create Location files**

Ashford_Study.md: Miskatonic University, where the
investigation began. Links to Professor_Ashford and
Coded_Letter.

Kingsport_Docks.md: night-time encounter location. Links to
Brother_Ezra and Strange_Symbol.

St_Anselms_Church.md: the cult's front. DELIBERATELY has
zero inbound links from any other file (orphaned entity).

- [ ] **Step 7: Create Faction file**

Order_of_the_Silver_Twilight.md: the cult. Links to
Brother_Ezra, Professor_Ashford, St_Anselms_Church.
Has a clock: "Complete the Ritual" at 4/8 segments.

- [ ] **Step 8: Create Clue files**

Coded_Letter.md: found in Ashford's desk. Points to the
cult hideout (THE ONLY clue path — Three Clue Rule violation).
discoveryState: Dr. Voss = Investigated, Jack = Observed.

Strange_Symbol.md: carved under desk, also on dock crates.
Points to the Order but not directly to the hideout.
discoveryState: both = Observed.

Witness_Statement.md: Tommy Flanagan's claim about seeing
Ashford at the docks. Not yet corroborated.
discoveryState: both = Rumoured.

- [ ] **Step 9: Create Session notes**

Session 1: status:played, full narrative recap, entity
references via wiki-links, decisions made.

Session 2: status:played, includes raw play notes section
(shorthand, unprocessed — for session-lifecycle to work with).
References `[[Dr. Marsh]]` (BROKEN LINK — no entity exists).
Mentions "Professor Crain" as a witness (NAME SIMILARITY with
Inspector Crane). Mentions "Dockmaster Hayes" (NEW NPC — no
entity file).

Session 3: status:planned, prep notes for the infiltration.
Does NOT account for Session 2 events (for reconciliation
testing).

- [ ] **Step 10: Verify deliberate problems are present**

```bash
# Timeline contradiction: Ashford missing but giving lecture
grep "missing" tests/benchmark-campaign/NPCs/Professor_Ashford.md
grep "lecture" tests/benchmark-campaign/_Campaign/Timeline.md

# Broken link
grep "Dr. Marsh" tests/benchmark-campaign/Chapters/Chapter\ 1/Sessions/Session\ 2*.md

# Name similarity
grep -r "Crane\|Crain" tests/benchmark-campaign/

# Orphaned entity (zero inbound links)
grep -r "St.Anselm\|St_Anselm" tests/benchmark-campaign/ | grep -v "St_Anselms_Church.md"

# Stale thread (Tommy not in Session 2 or 3)
grep -r "Tommy\|Flanagan" tests/benchmark-campaign/Chapters/

# Three Clue Rule (only coded letter points to hideout)
grep -r "hideout\|inner sanctum\|lodge location" tests/benchmark-campaign/Clues/
```

- [ ] **Step 11: Commit**

```bash
git add tests/benchmark-campaign/
git commit -m "Add synthetic benchmark campaign: The Ashford Case

20-file CoC 7e campaign with deliberate problems for QA
benchmarking: timeline contradiction, name similarity, broken
link, Three Clue Rule violation, orphaned entity, stale thread.
Includes raw play notes and unreconciled prep for session-
lifecycle benchmarking."
```

---

### Task 2: Write Benchmark Questions

**Files:**
- Create: `tests/benchmark-questions/campaign-organizer.md`
- Create: `tests/benchmark-questions/campaign-qa.md`
- Create: `tests/benchmark-questions/session-lifecycle.md`
- Create: `tests/benchmark-questions/ttrpg-expert.md`

Each file contains the 5 questions for that skill, plus the
agent prompt template (control and test variants).

- [ ] **Step 1: Write campaign-organizer questions**

```markdown
# campaign-organizer Benchmark Questions

## Questions

Q1: I'm starting a new CoC 7e campaign called "The Ashford
Case" set in 1920s Kingsport. Set up the vault structure
for me — what folders and files do I need?

Q2: Create an NPC entity file for Inspector Crane — he's a
Kingsport police detective, reluctant to help, knows more
than he's saying. Include proper frontmatter.

Q3: My campaign has Chapter 1 with 3 sessions. What should
the folder layout look like, and what goes in each session
file?

Q4: I just generated an NPC for my campaign. It has
source_confidence: DRAFT. When should I promote it to
AUTHORITATIVE, and what does SUPERSEDED mean?

Q5: I don't have Obsidian installed. Can I still organise
my campaign files? How does filesystem mode work?

## Agent Prompts

### Control
You are a TTRPG campaign management assistant. Read the
skill entry point at: [path to main branch SKILL.md]
Follow routing to find the right files for each question.
Answer each question concisely (under 150 words each).

### Test
You are a TTRPG campaign management assistant. Read the
skill entry point at: [path to feature branch SKILL.md]
Follow routing to find the right files for each question.
Answer each question concisely (under 150 words each).
```

- [ ] **Step 2: Write campaign-qa questions**

Questions reference the synthetic campaign data at
`tests/benchmark-campaign/`. The agent prompt includes
instructions to read the campaign files.

```markdown
# campaign-qa Benchmark Questions

## Questions

Q1: Run a canon audit on my campaign at
tests/benchmark-campaign/. Check for factual contradictions
between entity files and session notes.

Q2: Validate the timeline in my campaign at
tests/benchmark-campaign/_Campaign/Timeline.md against the
session notes and NPC statuses. Are there any inconsistencies?

Q3: Check for name similarity issues across all NPCs and
entities in tests/benchmark-campaign/. Any names that could
confuse players or the GM?

Q4: I have a mystery where the investigators need to find
the cult's hideout. Check the clue files in
tests/benchmark-campaign/Clues/ — does the Three Clue Rule
hold?

Q5: Check the graph health of my campaign at
tests/benchmark-campaign/. Are there orphaned entities,
broken wiki-links, or missing relationship reciprocals?
```

- [ ] **Step 3: Write session-lifecycle questions**

Questions reference Session 2 play notes and Session 3 prep.

```markdown
# session-lifecycle Benchmark Questions

## Questions

Q1: I just finished playing Session 2 of my campaign at
tests/benchmark-campaign/. Read the session notes and the
PC roster. Prep me a summary of what happened and what I
need to do before next session.

Q2: Process the raw play notes from Session 2 into a
proper narrative recap. The notes are in the session file
at tests/benchmark-campaign/Chapters/Chapter 1/Sessions/.

Q3: Based on Session 2, what entities need updating? Check
for new NPCs mentioned that don't have files, status changes,
and relationship shifts.

Q4: Session 3 was prepped before Session 2 was played. Read
both session files and reconcile — what in the Session 3
prep is still valid, what needs changing, and what's missing?

Q5: What carries forward from Session 2 to Session 3? List
open threads, unresolved decisions, PC arc beats, and
faction clock states.
```

- [ ] **Step 4: Write ttrpg-expert questions**

Questions target entity schema and shared concepts.

```markdown
# ttrpg-expert Benchmark Questions

## Questions

Q1: How should I structure entity tracking for a new CoC 7e
campaign? What entity types do I need and what fields go in
each?

Q2: Create a full NPC entity for a cult leader in my CoC
campaign. Include all required frontmatter fields, the AIMS
profile, and stat highlights.

Q3: I need a faction entity for a secret society. Include
goals, clock, alliances, and the proper schema fields.

Q4: My investigators found a clue — a coded letter in a
professor's desk. Create a clue entity with the discovery
state model showing what each PC knows.

Q5: I have a narrative thread — "The Missing Professor" —
that was introduced in Session 1 and needs to be tracked
across the campaign. How do thread entities work, and create
one for me.
```

- [ ] **Step 5: Commit**

```bash
git add tests/benchmark-questions/
git commit -m "Add benchmark questions for all four skills

5 questions each for campaign-organizer, campaign-qa,
session-lifecycle, and ttrpg-expert. campaign-qa and
session-lifecycle questions reference the synthetic
benchmark campaign."
```

---

### Task 3: Run Baseline Benchmarks — ttrpg-expert (3 runs)

**Files:**
- Create: `tests/baselines/ttrpg-expert-baseline.md`

Run 3 benchmark runs for ttrpg-expert using the questions
from Task 2. Both control and test read from the current
main branch (this IS the baseline — both should score the
same since there's no change yet).

- [ ] **Step 1: Run 3 pairs (control + test) in parallel**

Launch 6 agents total (3 control, 3 test) using the
ttrpg-expert questions. Control and test both read from
current main branch SKILL.md. This establishes the variance
range for this skill's questions.

- [ ] **Step 2: Run 3 blind evaluations**

Launch 3 opus evaluator agents, one per run pair.

- [ ] **Step 3: Record results**

Save full stats to `tests/baselines/ttrpg-expert-baseline.md`:
- Per-question scores for all 3 runs (both A and B)
- Tokens, time, files read per agent
- Quality per run and across runs (average, median)
- Variance range (max - min across runs)

- [ ] **Step 4: Commit**

```bash
git add tests/baselines/
git commit -m "Add ttrpg-expert baseline: 3 runs, full stats"
```

---

### Task 4: Run Baseline Benchmarks — campaign-organizer (3 runs)

**Files:**
- Create: `tests/baselines/campaign-organizer-baseline.md`

Same pattern as Task 3 but for campaign-organizer. Both
control and test read from current main SKILL.md.

- [ ] **Step 1: Run 3 pairs**
- [ ] **Step 2: Run 3 evaluations**
- [ ] **Step 3: Record results to campaign-organizer-baseline.md**
- [ ] **Step 4: Commit**

```bash
git add tests/baselines/
git commit -m "Add campaign-organizer baseline: 3 runs, full stats"
```

---

### Task 5: Run Baseline Benchmarks — campaign-qa (3 runs)

**Files:**
- Create: `tests/baselines/campaign-qa-baseline.md`

Campaign-qa agents need access to the synthetic campaign at
`tests/benchmark-campaign/`. Both control and test read the
campaign files AND the current main SKILL.md.

**Important:** The agent prompt must include instructions to
read the campaign files. The questions reference specific
file paths in the benchmark campaign.

- [ ] **Step 1: Run 3 pairs with campaign data**

Each agent reads:
1. The campaign-qa SKILL.md (from main branch)
2. The relevant campaign files in tests/benchmark-campaign/
3. Any reference files the skill routes to

- [ ] **Step 2: Run 3 evaluations**
- [ ] **Step 3: Record results to campaign-qa-baseline.md**
- [ ] **Step 4: Commit**

```bash
git add tests/baselines/
git commit -m "Add campaign-qa baseline: 3 runs, full stats"
```

---

### Task 6: Run Baseline Benchmarks — session-lifecycle (3 runs)

**Files:**
- Create: `tests/baselines/session-lifecycle-baseline.md`

Same as Task 5 — agents need the synthetic campaign data.

- [ ] **Step 1: Run 3 pairs with campaign data**
- [ ] **Step 2: Run 3 evaluations**
- [ ] **Step 3: Record results to session-lifecycle-baseline.md**
- [ ] **Step 4: Commit**

```bash
git add tests/baselines/
git commit -m "Add session-lifecycle baseline: 3 runs, full stats"
```

---

### Task 7: Baseline Summary and Variance Report

**Files:**
- Create: `tests/baselines/SUMMARY.md`

Compile all baselines into one summary showing the variance
range per skill, which establishes the noise floor for
detecting regressions.

- [ ] **Step 1: Compile summary**

```markdown
# Baseline Benchmarks Summary

## Per-Skill Baselines (3 runs each, current main branch)

| Skill | Run 1 | Run 2 | Run 3 | Avg | Median | Variance |
|-------|-------|-------|-------|-----|--------|----------|
| ttrpg-expert | X | X | X | X | X | X |
| campaign-organizer | X | X | X | X | X | X |
| campaign-qa | X | X | X | X | X | X |
| session-lifecycle | X | X | X | X | X | X |

## Pass Criteria for Refactor

A change passes if the post-refactor median score is within
the baseline variance range (max - min). Specifically:
- Median delta ≥ -(baseline variance) is acceptable
- Median delta < -(baseline variance) requires investigation
```

- [ ] **Step 2: Commit**

```bash
git add tests/baselines/SUMMARY.md
git commit -m "Add baseline summary with variance ranges and pass criteria"
```

---

## Execution Notes

- Tasks 3-6 can run in parallel (4 skills, independent)
  but each produces a lot of agent output. Consider running
  2 skills at a time to stay manageable.
- The synthetic campaign in Task 1 should be reviewed before
  running benchmarks to confirm all deliberate problems are
  present and detectable.
- All test files go in `tests/` which is gitignored. The
  benchmark questions go in `tests/benchmark-questions/`
  (also gitignored). To preserve them, either un-gitignore
  the specific directories or save results elsewhere.

**IMPORTANT:** The `tests/` directory is currently gitignored.
For benchmark questions and the synthetic campaign to be
tracked, either:
(a) Add exceptions to .gitignore for `tests/benchmark-campaign/`
    and `tests/benchmark-questions/`
(b) Move them to a non-gitignored location like
    `docs/benchmarks/`
