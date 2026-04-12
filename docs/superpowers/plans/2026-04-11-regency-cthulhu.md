# Regency Cthulhu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Regency Cthulhu as a CoC 7e overlay variant with routing, benchmarks, and a file-format standards doc.

**Architecture:** Overlay model — 5 Regency-specific files in `systems/coc-7e/variants/regency/` list only differences from base CoC 7e. Routing in SKILL.md and INDEX.md detects "Regency" keyword or campaign tag and loads base + overlay together. TDD via dedicated benchmark.

**Tech Stack:** Markdown content files, Claude Code plugin skill system, benchmark evaluation framework.

**Spec:** `docs/superpowers/specs/2026-04-11-regency-cthulhu-design.md`

**Source material:** `docs/supplemental/regency_cthulhu_reference_tables.md` (already extracted, copyright-safe). Source PDF at `/Users/antonypegg/Documents/CTHULHU/cha23179_-_regency_cthulhu_v1.5_reduced_file_size.pdf` for verification only — never copy prose.

**Copyright rule:** Names, point costs, short mechanical notes only (Baker v. Selden, 1879). No verbatim Chaosium prose, flavour text, or extended descriptions.

---

## File Map

### New files

| File | Responsibility |
|------|---------------|
| `docs/file-format-standards.md` | Documents file-writing conventions for all system files |
| `tests/benchmark-questions/ttrpg-expert-regency.md` | 5-question benchmark (3 Regency + 2 cross-cutting) |
| `skills/ttrpg-expert/systems/coc-7e/variants/regency/skills.md` | Skill changes overlay |
| `skills/ttrpg-expert/systems/coc-7e/variants/regency/occupations.md` | Occupation overlay |
| `skills/ttrpg-expert/systems/coc-7e/variants/regency/equipment.md` | Weapons, carriages, costs, glossary overlay |
| `skills/ttrpg-expert/systems/coc-7e/variants/regency/character-generation.md` | CR bands, living standards, estates, Reputation overlay |
| `skills/ttrpg-expert/systems/coc-7e/variants/regency/gm-guidance.md` | Investigation and social differences (original content) |
| `tests/baselines/ttrpg-expert-regency-baseline.md` | Baseline scores after implementation |

### Modified files

| File | Change |
|------|--------|
| `skills/ttrpg-expert/SKILL.md` | Add variant detection block + Regency routing to CoC 7e section |
| `skills/ttrpg-expert/INDEX.md` | Add variant row to system selection + per-system tables |

---

## Task 1: File Format Standards

**Files:**
- Create: `docs/file-format-standards.md`

- [ ] **Step 1: Write the standards doc**

```markdown
# File Format Standards — System Reference Files

Conventions for all files under `skills/ttrpg-expert/systems/`.
Read this before writing or modifying any system file.

## Attribution Header

First lines of every file that references copyrighted game
content. Format:

```
> [Source] attribution: [License]. See ATTRIBUTION.md.
> [System] adaptation: Our own descriptions of uncopyrightable
> game mechanics (Baker v. Selden, 1879). Not [Publisher] text.
```

Omit for files containing only original content (e.g.,
gm-guidance written from general knowledge).

## Priming Paragraph

Immediately after the H1 title. Tells the LLM:
- **What** this file contains
- **When** to use it (chargen, play, lookup)
- **Scope** boundaries (what's NOT here, where to look instead)

One paragraph, 2-4 lines. Example:

```
Complete CoC 7e skill list with base chances and usage notes.
For character creation (allocating points) and play (quick
lookup). Uses bonus/penalty dice, not flat modifiers.
```

## Overlay Priming (Variant Files)

Variant overlay files add to the priming paragraph:
- Which base file this overlays
- That only differences are listed
- That unlisted content from the base file still applies

Example:

```
Regency (1811-1820) overlay for CoC 7e. Use alongside base
`../skills.md`. Only differences listed here; all unlisted
base CoC skills remain available.
```

## Compact Writing Rules

- **One-line descriptions** for skills, traits, items. No
  multi-sentence explanations unless the mechanic is complex.
- **Tables** for lookup data (skill lists, weapon stats,
  equipment costs, occupation templates).
- **No prose padding** — no "In the world of..." or "This
  skill represents..." introductions.
- **Terse format:** `**Skill Name** (base%) — what it does.`
- **Mechanical precision:** include exact numbers, formulas,
  dice, thresholds. Vague descriptions waste tokens.

## Cross-Reference Conventions

Point to related files with relative paths from the current
file's directory:

- Within same system: `See combat-reference.md`
- To base from variant: `See ../skills.md`
- To shared refs: `See shared/entity-schema.md`
- To other systems: `See systems/gurps-4e/combat.md`

Place cross-references inline where relevant or in a
"See Also" section at the end.

## Attribution Footer

Last lines of files with licensed content. Summarise the
legal basis:

```
> **Attribution:** [Framework] adapted from [Source] by
> [Publisher], used under [License]. [System]-specific
> [content type] are our own descriptions of uncopyrightable
> game mechanics. See ATTRIBUTION.md for full license details.
```

## Copyright Boundaries

All system files must stay within copyright-safe territory:
- **Allowed:** Names, point costs, base percentages, skill
  lists, stat block formats, damage values, formulas, short
  mechanical notes.
- **Not allowed:** Verbatim prose, flavour text, extended
  descriptions, scenario content, artwork descriptions,
  narrative examples from sourcebooks.
- **Original content** (GM guidance, session advice) needs
  no attribution and has no copyright constraints.
```

- [ ] **Step 2: Commit**

```bash
git add docs/file-format-standards.md
git commit -m "Add file format standards for system reference files"
```

---

## Task 2: Benchmark Spec

**Files:**
- Create: `tests/benchmark-questions/ttrpg-expert-regency.md`

- [ ] **Step 1: Write the benchmark spec**

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add tests/benchmark-questions/ttrpg-expert-regency.md
git commit -m "Add Regency Cthulhu benchmark questions"
```

---

## Task 3: Regency Skills Overlay

**Files:**
- Create: `skills/ttrpg-expert/systems/coc-7e/variants/regency/skills.md`
- Reference: `docs/supplemental/regency_cthulhu_reference_tables.md` (lines 29-303)
- Reference: `skills/ttrpg-expert/systems/coc-7e/skills.md` (base file format)
- Reference: `docs/file-format-standards.md` (writing conventions)

- [ ] **Step 1: Create the variants/regency/ directory and write skills.md**

Follow the format standards doc. Content to include from the reference tables:

1. Attribution header — Regency Cthulhu (Chaosium, 2022), Baker v. Selden
2. Priming paragraph — overlay for CoC 7e, use alongside `../skills.md`, only differences listed
3. **Unavailable Skills** — list the 9 skills by name with replacement notes where applicable (lines 29-42 of reference)
4. **New Skills** — each with base %, one-line mechanical note in the terse `**Name** (base%) — description` format. Skills: Astronomy (01%), Dancing (DEX/5), Drive Carriage/Cart (20%), Etiquette (INT/5), Fashion (10%), Gaming (10%), Mesmerism (01%), Natural Philosophy (01%), Reassure (APP/5). Keep descriptions to one line each — do NOT copy the full opposing-skill/pushing paragraphs from the reference tables
5. **Adjusted Skills** — Credit Rating (00%, note about occupational bands and social class), Religion (10%, note about adjustment)
6. **Specialization Changes** — Art/Craft (Regency-appropriate list), Fighting (period weapons only), Firearms (Bow, Pistol, Rifle/Blunderbuss)
7. **Uncommon Skills** — bullet list with availability notes (lines 233-241 of reference)
8. **Full Regency Skill Table** — base chance lookup table matching the format in lines 246-303 of reference, but using the compact two-column layout from the base skills.md (lines 226-250)
9. Attribution footer

Total target: ~120 lines. Match the terse style of the base `skills.md`.

- [ ] **Step 2: Verify file reads correctly**

Read the file back. Check:
- Attribution header present
- Priming paragraph references `../skills.md`
- No verbatim multi-sentence descriptions from sourcebook
- Skill table is complete (all 38 Regency skills)
- File under 150 lines

- [ ] **Step 3: Commit**

```bash
git add skills/ttrpg-expert/systems/coc-7e/variants/regency/skills.md
git commit -m "Add Regency Cthulhu skills overlay"
```

---

## Task 4: Regency Occupations Overlay

**Files:**
- Create: `skills/ttrpg-expert/systems/coc-7e/variants/regency/occupations.md`
- Reference: `docs/supplemental/regency_cthulhu_reference_tables.md` (lines 307-420)
- Reference: `skills/ttrpg-expert/systems/coc-7e/occupations.md` (base file format)
- Reference: `docs/file-format-standards.md`

- [ ] **Step 1: Write occupations.md**

Content to include:

1. Attribution header
2. Priming paragraph — overlay, use alongside `../occupations.md`, Regency occupation list replaces base list for Regency play
3. **Regency Occupation List** — full table from lines 307-328 of reference. Bold for gentry-suitable, † for new, * for hobby careers. Use a compact three-column table
4. **Hobby Career Note** — one line explaining the * and † markers (lines 330-332 of reference)
5. **New Occupation Stat Blocks** — Gentleman, Gentlewoman, Nouveau Riche, Servant (Footman), Servant (Housemaid). Each in the same format as base occupations.md: name, formula, CR range, 8 skills. One concise line of description per occupation — do NOT copy the full paragraph descriptions from the reference tables
6. **Occupational Bands** — 5-band table (band name, CR range, occupations) from lines 395-420. Compact format
7. Cross-reference to `../occupations.md` for skill point formula table
8. Attribution footer

Total target: ~100 lines.

- [ ] **Step 2: Verify file reads correctly**

Check:
- All 5 new occupations have stat blocks
- All 5 bands listed with CR ranges
- No verbatim descriptions copied
- Cross-reference to base occupations.md present

- [ ] **Step 3: Commit**

```bash
git add skills/ttrpg-expert/systems/coc-7e/variants/regency/occupations.md
git commit -m "Add Regency Cthulhu occupations overlay"
```

---

## Task 5: Regency Equipment Overlay

**Files:**
- Create: `skills/ttrpg-expert/systems/coc-7e/variants/regency/equipment.md`
- Reference: `docs/supplemental/regency_cthulhu_reference_tables.md` (lines 486-624)
- Reference: `skills/ttrpg-expert/systems/coc-7e/equipment-weapons.md` (base file format)
- Reference: `docs/file-format-standards.md`

- [ ] **Step 1: Write equipment.md**

Content to include:

1. Attribution header
2. Priming paragraph — overlay, replaces base weapon tables for Regency play, cross-ref `../equipment-weapons.md` for table-reading conventions and special success types
3. **Melee & Ranged Weapons** — stat table from lines 572-589 of reference. Same columns as base: Weapon, Skill, Damage, Base Range, Uses/Round, Malfunction. Include the key for (i), *, ∆
4. **Firearms** — stat table from lines 596-603. Include notes on flintlock reload (1 per 4 rounds) and blunderbuss damage dropoff
5. **Carriages and Chases** — stat table from lines 614-621. Include open/closed armor note
6. **Sample Equipment Costs** — tables from lines 488-541. Staff, Clothing, Food, Miscellaneous. Keep exact format from reference (item + cost)
7. **Costume Glossary** — term/definition table from lines 547-568. One-line definitions
8. Attribution footer

Total target: ~150 lines.

- [ ] **Step 2: Verify file reads correctly**

Check:
- All weapon tables have correct columns
- Carriage table present with MOV/Build/limits
- Equipment costs in period currency (£, s, d)
- Glossary definitions are one line each

- [ ] **Step 3: Commit**

```bash
git add skills/ttrpg-expert/systems/coc-7e/variants/regency/equipment.md
git commit -m "Add Regency Cthulhu equipment overlay"
```

---

## Task 6: Regency Character Generation Overlay

**Files:**
- Create: `skills/ttrpg-expert/systems/coc-7e/variants/regency/character-generation.md`
- Reference: `docs/supplemental/regency_cthulhu_reference_tables.md` (lines 395-468)
- Reference: `skills/ttrpg-expert/systems/coc-7e/character-generation.md` (base file format)
- Reference: `docs/file-format-standards.md`

- [ ] **Step 1: Write character-generation.md**

Content to include:

1. Attribution header
2. Priming paragraph — overlay, use alongside `../character-generation.md` for core attribute generation, derived values, age modifiers. This file covers Regency-specific social economics only
3. **Occupational Bands and Credit Rating** — explain the band system: check occupation → find band → invest skill points to meet minimum CR. Cross-ref `occupations.md` for band table
4. **Living Standards** — table from lines 427-437 (CR range, description). One-line descriptions
5. **Cash and Assets** — table from lines 442-452 (CR, description, cash, assets, spending). Period currency
6. **Estate Standards** — 1d6 table from lines 459-466
7. **Reputation** — formula: (CR + Etiquette) / 2, max 99. Effects table from lines 476-483 (score range, society's opinion, mechanical effect)
8. Cross-reference to `../character-generation.md` for core chargen steps
9. Attribution footer

Total target: ~80 lines.

- [ ] **Step 2: Verify file reads correctly**

Check:
- Living standards table covers CR 0-100
- Cash table has all 8 tiers
- Reputation formula and effects both present
- Cross-reference to base chargen present

- [ ] **Step 3: Commit**

```bash
git add skills/ttrpg-expert/systems/coc-7e/variants/regency/character-generation.md
git commit -m "Add Regency Cthulhu character generation overlay"
```

---

## Task 7: Regency GM Guidance

**Files:**
- Create: `skills/ttrpg-expert/systems/coc-7e/variants/regency/gm-guidance.md`
- Reference: `docs/file-format-standards.md`

- [ ] **Step 1: Write gm-guidance.md**

This is **original content** — written from general Regency-era knowledge and the mechanical changes in the other overlay files. No attribution header needed. No content from the sourcebook.

Content to include:

1. Title: `# Regency Cthulhu — GM Guidance`
2. Priming paragraph — how running Regency sessions differs from standard 1920s CoC. Use alongside `../session-procedures.md` for core investigation structure
3. **Etiquette vs Credit Rating** — in Regency, Etiquette replaces CR for social influence rolls. CR still determines wealth/living standard but doesn't open social doors. Etiquette governs introductions, forms of address, social acceptance. Note: this is the single biggest mechanical shift from base CoC
4. **Social Class as Investigation Barrier** — who can talk to whom. Gentry don't speak directly to servants (go through butler/housekeeper). Lower class can't approach gentry without introduction. Investigators of mixed class must navigate these barriers. Practical advice: split the party by class for different investigation angles
5. **The Season** — London social calendar (spring). Balls, assemblies, card parties, morning calls are investigation opportunities. Country house parties in summer/autumn. These social events replace the speakeasy/library scenes of 1920s CoC
6. **Investigation Without Modern Tools** — no forensics, no telephones, no automobiles. Communication by letter (days of delay). Travel by carriage (reference `equipment.md` for stats). Information via Library Use, personal contacts, servants' gossip. Medical knowledge limited (no Psychoanalysis — use Reassure instead)
7. **Period Narration Tips** — address people by title/surname (never first name in company). Describe costume using glossary terms from `equipment.md`. Dancing is social currency. Reputation matters — actions have social consequences tracked by the Reputation mechanic in `character-generation.md`
8. Cross-reference to `../session-procedures.md` for node-based investigation, Three Clue Rule

Total target: ~80 lines. Terse, practical, actionable for a GM mid-session.

- [ ] **Step 2: Verify file reads correctly**

Check:
- No content copied from Chaosium sourcebook
- Cross-references to other overlay files and base files present
- Practical and actionable, not lore-heavy
- Under 100 lines

- [ ] **Step 3: Commit**

```bash
git add skills/ttrpg-expert/systems/coc-7e/variants/regency/gm-guidance.md
git commit -m "Add Regency Cthulhu GM guidance (original content)"
```

---

## Task 8: Update SKILL.md Routing

**Files:**
- Modify: `skills/ttrpg-expert/SKILL.md` (lines 173-184, CoC 7e routing section)

- [ ] **Step 1: Add variant detection block after the CoC 7e routing table**

Insert after line 184 (after the `| Lovecraft setting | setting-lovecraft.md |` row):

```markdown

#### CoC 7e Variant: Regency

If the user mentions "Regency" OR the active campaign is
tagged as system "CoC 7e (Regency)":
→ Load the base file above AND the matching overlay.

| Request | Overlay |
|---------|---------|
| Skills | variants/regency/skills.md |
| Occupations | variants/regency/occupations.md |
| Equipment / weapons | variants/regency/equipment.md |
| Character creation | variants/regency/character-generation.md |
| Session / investigation | variants/regency/gm-guidance.md |

No variant keyword or tag → use base CoC files only.
```

- [ ] **Step 2: Add Regency Quick Commands to the Quick Commands section**

Insert after line 30 (after the existing `**CoC combat**` quick command):

```markdown

**Regency CoC skill** → `systems/coc-7e/skills.md` + `systems/coc-7e/variants/regency/skills.md`
**Regency CoC occupation** → `systems/coc-7e/occupations.md` + `systems/coc-7e/variants/regency/occupations.md`
**Regency CoC equipment** → `systems/coc-7e/equipment-weapons.md` + `systems/coc-7e/variants/regency/equipment.md`
**Regency CoC character** → `systems/coc-7e/character-generation.md` + `systems/coc-7e/variants/regency/character-generation.md`
**Regency CoC session/social** → `systems/coc-7e/session-procedures.md` + `systems/coc-7e/variants/regency/gm-guidance.md`
```

- [ ] **Step 3: Verify the full SKILL.md reads correctly**

Read the file. Check:
- Quick Commands section has Regency entries
- CoC 7e routing table is unchanged
- Variant detection block follows immediately after
- No broken formatting

- [ ] **Step 4: Commit**

```bash
git add skills/ttrpg-expert/SKILL.md
git commit -m "Add Regency Cthulhu routing to SKILL.md"
```

---

## Task 9: Update INDEX.md

**Files:**
- Modify: `skills/ttrpg-expert/INDEX.md` (lines 7-14, system selection; lines 16-42, per-system requests)

- [ ] **Step 1: Add variant info to system selection table**

Change line 12 from:
```
| CoC 7e | `systems/coc-7e/` |
```
to:
```
| CoC 7e | `systems/coc-7e/` | Variants: `variants/regency/` |
```

This requires adding a third column header. Update the table header (line 8) from:
```
| System | Subfolder |
|--------|-----------|
```
to:
```
| System | Subfolder | Variants |
|--------|-----------|----------|
```

And add empty variant cells to the other systems:
```
| D&D 5e (2024) | `systems/dnd-5e-2024/` | — |
| Forged in the Dark | `systems/fitd/` | — |
| CoC 7e | `systems/coc-7e/` | `variants/regency/` |
| GURPS 4e | `systems/gurps-4e/` | — |
| Other | `systems/generic/` | — |
```

- [ ] **Step 2: Add variant-specific routing row to per-system requests table**

Insert a new row after the "Setting / lore" row (line 37):
```
| Variant-specific rules | `{system}/variants/{variant}/*.md` | Base system file for same topic |
```

- [ ] **Step 3: Verify the full INDEX.md reads correctly**

Read the file. Check:
- System selection table has three columns
- Variant row appears in per-system requests
- No broken table formatting

- [ ] **Step 4: Commit**

```bash
git add skills/ttrpg-expert/INDEX.md
git commit -m "Add variant routing to INDEX.md"
```

---

## Task 10: Run Regency Benchmark

**Files:**
- Reference: `tests/benchmark-questions/ttrpg-expert-regency.md`
- Create: `tests/baselines/ttrpg-expert-regency-baseline.md`

- [ ] **Step 1: Run 3 benchmark runs using the test prompt**

Use the test prompt from `ttrpg-expert-regency.md`. Run 3 times
with 2 agents each (sonnet). Evaluate with opus using the
evaluator prompt. Record scores.

- [ ] **Step 2: Run the existing ttrpg-expert benchmark**

Use the test prompt from `tests/benchmark-questions/ttrpg-expert.md`.
Run 1 time with 2 agents (sonnet). Evaluate with opus.
Confirm scores meet existing pass threshold (≥ 61).

- [ ] **Step 3: Write baseline results**

Create `tests/baselines/ttrpg-expert-regency-baseline.md` in the
same format as the existing `ttrpg-expert-baseline.md`:

```markdown
# Baseline: ttrpg-expert (Regency Cthulhu)

**Date:** 2026-04-11
**Model:** sonnet (agents), opus (evaluator)
**Questions:** Regency Gentleman chargen, skill replacements,
social mechanics at ball, base CoC PI (cross-cutting),
base CoC skill lookup (cross-cutting)

## Scores (6 agents across 3 runs)

| Run | A | B | Spread |
|-----|:-:|:-:|:------:|
| R1  | XX | XX | X |
| R2  | XX | XX | X |
| R3  | XX | XX | X |

All individual scores: ...

**Mean:** XX
**Median:** XX
**Range:** XX-XX (variance: X)

## Pass Criteria

Post-change median must be ≥ [median minus variance].
A score below this indicates a regression.

## Non-Regression: ttrpg-expert (base)

Ran 1 confirmation run against existing benchmark.
Score: XX (pass threshold: ≥ 61). [PASS/FAIL]
```

- [ ] **Step 4: Commit**

```bash
git add tests/baselines/ttrpg-expert-regency-baseline.md
git commit -m "Add Regency Cthulhu benchmark baselines"
```

---

## Task 11: Update future-work.md

**Files:**
- Modify: `docs/plans/future-work.md`

- [ ] **Step 1: Mark Regency Cthulhu as completed**

Change the status of the Regency Cthulhu item from "Planned"
to "Done" and move it to the completed section (following the
pattern of other completed items in the file).

- [ ] **Step 2: Commit**

```bash
git add docs/plans/future-work.md
git commit -m "Mark Regency Cthulhu as completed in backlog"
```
