# Design: Regency Cthulhu System Support

## Problem

Regency Cthulhu (Chaosium, 2022) is a CoC 7e historical
supplement covering 1811-1820 England. It modifies base CoC
with new skills, occupations, equipment, social mechanics, and
investigation guidance. The user runs an active Regency
campaign and needs the skill to handle Regency-specific queries
without polluting base CoC responses.

Currently ttrpg-expert has no concept of system variants or
era-specific overlays. All CoC queries route to the same base
files regardless of setting.

## Goals

1. Regency-specific queries return accurate Regency content
   (unavailable skills, replacement skills, period occupations,
   Reputation, social mechanics).
2. Base CoC queries continue to return base CoC content, even
   with Regency overlay files present.
3. Variant detection works via keyword ("Regency") and campaign
   tag ("CoC 7e (Regency)").
4. Overlay model: Regency files list only differences from base
   CoC. No content duplication.
5. Copyright-safe: names, point costs, short mechanical notes
   only (Baker v. Selden). No verbatim Chaosium prose.
6. No quality regression on existing ttrpg-expert benchmark.

## Non-Goals

- Tarryford campaign setting (future work).
- Pre-generated investigators or scenarios.
- Pulp Cthulhu Regency variant.
- Other CoC eras (Victorian, Dark Ages) — but the variant
  directory structure supports them when needed.

## Architecture

### Variant Directory Pattern

```
systems/coc-7e/
├── skills.md                    # Base CoC (unchanged)
├── occupations.md               # Base CoC (unchanged)
├── equipment-weapons.md         # Base CoC (unchanged)
├── ...                          # All existing files unchanged
└── variants/
    └── regency/
        ├── skills.md            # Overlay: unavailable + new + adjusted
        ├── occupations.md       # Overlay: Regency list + bands + new stat blocks
        ├── equipment.md         # Overlay: period weapons, carriages, costs, glossary
        ├── character-generation.md  # Overlay: CR bands, living standards, estates, Reputation
        └── gm-guidance.md       # Original: investigation + social differences
```

This pattern extends to future variants:
`systems/{system}/variants/{variant}/`

### Overlay File Format

Every overlay file follows these conventions:

1. **Attribution header** — copyright provenance:
   ```
   > Regency Cthulhu (Chaosium, 2022). Names, costs, and short
   > mechanical notes per Baker v. Selden (1879). Not Chaosium text.
   ```

2. **Priming paragraph** — tells the LLM what the file is,
   when to use it, and what base file it overlays:
   ```
   Regency (1811-1820) overlay for CoC 7e. Use alongside base
   `../skills.md`. Only differences listed here; all unlisted
   base CoC skills remain available.
   ```

3. **Compact format** — terse one-line descriptions, tables
   for lookup data, no prose padding. Same style as existing
   base CoC files.

4. **Cross-references** — explicit pointers to base files and
   between overlay files where relevant.

5. **Attribution footer** — legal basis summary.

### Routing

**SKILL.md** gets a new variant detection block in the CoC 7e
routing section:

```
### CoC 7e Variant Detection

If the user mentions "Regency" OR the active campaign is
tagged as system "CoC 7e (Regency)":
→ Load base CoC file + matching variant overlay from
  systems/coc-7e/variants/regency/

| Request            | Base file              | Overlay file                       |
|--------------------|------------------------|------------------------------------|
| Skills             | skills.md              | variants/regency/skills.md         |
| Occupations        | occupations.md         | variants/regency/occupations.md    |
| Equipment/weapons  | equipment-weapons.md   | variants/regency/equipment.md      |
| Character creation | character-generation.md| variants/regency/character-generation.md |
| Session/investigation | session-procedures.md | variants/regency/gm-guidance.md  |

If no variant keyword or tag: use base CoC files only.
```

**INDEX.md** gets a variant row added to CoC 7e in the system
selection table and per-system requests table.

## Overlay File Contents

### skills.md

- Unavailable skills list (9 skills by name)
- New skills with base %, one-line mechanical note:
  Astronomy, Dancing, Drive Carriage/Cart, Etiquette,
  Fashion, Gaming, Mesmerism, Natural Philosophy, Reassure
- Adjusted skills: Credit Rating, Religion
- Specialization changes: Art/Craft, Fighting, Firearms
- Uncommon skills list with availability notes
- Full Regency skill base-chance table
- Cross-reference: base `../skills.md` for unlisted skills

### occupations.md

- Full Regency occupation list (40+ names, gentry markers)
- Hobby career note for Gentleman/Gentlewoman
- New occupation stat blocks: Gentleman, Gentlewoman,
  Nouveau Riche, Servant (Footman), Servant (Housemaid)
  — formula, band, CR range, 8 skills each
- Occupational bands table (5 tiers with CR ranges and
  occupation lists)
- Cross-reference: base `../occupations.md` for unlisted
  occupations and skill point formula table

### equipment.md

- Melee weapons table (name, skill, damage, range, uses,
  malfunction)
- Firearms table (same columns + bullets in gun)
- Flintlock reload note (1 per 4 rounds)
- Carriages table (name, MOV, build, driver/passenger limits)
- Carriage armor note (closed = 1 point protection)
- Sample equipment costs (staff, clothing, food, misc)
- Costume glossary (term + one-line definition table)
- Cross-reference: base `../equipment-weapons.md` for
  table-reading conventions and special success types

### character-generation.md

- Occupational bands and Credit Rating rules
- Living standards table (CR 0-100 with descriptions)
- Cash and assets table (CR-based income, assets, spending)
- Estate standards (1d6 table)
- Reputation formula: (CR + Etiquette) / 2
- Reputation effects table (score ranges with mechanical
  effects)
- Cross-reference: base `../character-generation.md` for
  core attribute generation, derived values, age modifiers

### gm-guidance.md

Original content — written from general Regency-era knowledge
and the mechanical changes documented in the other overlay
files. Not extracted from sourcebook prose:

- Etiquette replacing Credit Rating for social influence
  rolls — when and how
- Social class as investigation barrier — who can talk to
  whom, introductions, servants vs gentry
- The Season — social calendar, balls, assemblies as
  investigation opportunities
- Period-appropriate narration tips — costume, address,
  manners
- Regency investigation vs 1920s investigation — no
  forensics, no telephones, letter-based communication,
  travel by carriage
- Cross-reference: base `../session-procedures.md` for
  core investigation structure (node-based, Three Clue Rule)

## Benchmarks

### New: ttrpg-expert-regency.md

5 questions, same rubric as existing ttrpg-expert benchmark
(5 dimensions x 3 points, 15 max per question, 75 overall):

| # | Type | Question | Tests |
|---|------|----------|-------|
| Q1 | Regency | Create a Regency Gentleman investigator with full stats, occupation skills, CR band, and Reputation | Chargen overlay, occupations, CR bands, Reputation |
| Q2 | Regency | What skills are unavailable in Regency and what replaces them? Investigator wants Science and Hypnosis | Skill overlay, unavailable list, replacements |
| Q3 | Regency | Investigators attending a ball — what social skills matter, how does Etiquette work vs Credit Rating? | GM guidance, social mechanics, Etiquette/Dancing/Fashion |
| Q4 | Cross-cutting | Create a standard 1920s CoC Private Investigator | Base CoC chargen uncontaminated by Regency |
| Q5 | Cross-cutting | What's the base chance for Drive Auto and Electrical Repair in CoC? | Base skills not polluted by Regency unavailable list |

Same methodology: 3 runs, blind evaluation, baseline +
pass threshold (median minus variance).

### Existing: ttrpg-expert.md

Unchanged. Run after implementation to confirm no regression
against existing baseline (pass threshold >= 61).

## File Format Standards

A new `docs/file-format-standards.md` documents the
conventions used across all system files:

- Attribution header format and when required
- Priming paragraph pattern
- Compact writing rules
- Cross-reference conventions
- Attribution footer format
- Overlay-specific conventions

Under 100 lines. Referenced from project docs so future
conversations can find it without reverse-engineering the
patterns from existing files.

## Deliverables

### New files (8)

| File | Type |
|------|------|
| `docs/file-format-standards.md` | Standards doc |
| `tests/benchmark-questions/ttrpg-expert-regency.md` | Benchmark spec |
| `skills/ttrpg-expert/systems/coc-7e/variants/regency/skills.md` | Overlay |
| `skills/ttrpg-expert/systems/coc-7e/variants/regency/occupations.md` | Overlay |
| `skills/ttrpg-expert/systems/coc-7e/variants/regency/equipment.md` | Overlay |
| `skills/ttrpg-expert/systems/coc-7e/variants/regency/character-generation.md` | Overlay |
| `skills/ttrpg-expert/systems/coc-7e/variants/regency/gm-guidance.md` | Overlay |
| `tests/baselines/ttrpg-expert-regency-baseline.md` | Baseline results |

### Modified files (2)

| File | Change |
|------|--------|
| `skills/ttrpg-expert/SKILL.md` | Variant detection + Regency routing table |
| `skills/ttrpg-expert/INDEX.md` | Variant row in CoC 7e section |

## Implementation Order (TDD)

1. Write `docs/file-format-standards.md`
2. Write benchmark spec (`ttrpg-expert-regency.md`)
3. Run benchmark against current code (expect low scores)
4. Write overlay files following format standards:
   skills → occupations → equipment → character-generation
   → gm-guidance
5. Update SKILL.md and INDEX.md routing
6. Run Regency benchmark — scores should meet threshold
7. Run existing ttrpg-expert benchmark — confirm no regression
8. Establish baselines for both benchmarks

## Source Material

- Primary reference: `docs/supplemental/regency_cthulhu_reference_tables.md`
  (already extracted, copyright-safe)
- Source PDF: local copy of Regency Cthulhu (Chaosium, 2022)
  for verification only — do not copy prose
- Copyright basis: Baker v. Selden (1879) — game mechanics
  are uncopyrightable. Names, point costs, short notes only.

## Out of Scope

- Tarryford setting reference
- Pre-generated investigators
- Regency scenarios
- Pulp Cthulhu Regency rules
- Other CoC era variants (Victorian, Dark Ages, Modern)
- SRD enrichment (Phase 5a is a separate backlog item)
