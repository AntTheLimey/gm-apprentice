# Check Procedures

**Tool note:** These procedures use generic operation names —
"enumerate files," "search for [pattern]," "read [file]." See
`shared/vault-access.md` for the tool mapping (Glob/Grep/
Read plus the bundled graph and search utilities).

Detailed step-by-step procedures for each QA mode. The SKILL.md
describes what each mode checks; each file below describes how to
perform that check systematically. **Read only the check file(s)
for the mode(s) you are running** — a single-mode audit needs one
file, not all eight. Full Audit reads each in order (see below).

## Check Procedure Files

Each check now lives in its own file under `references/checks/`:

1. [Canon Audit](checks/canon-audit.md) — entity-fact
   contradictions, PC roster, canon fabrication, PC Current
   Status consistency.
2. [Timeline Validation](checks/timeline-validation.md) —
   chronological order, entity lifecycle, travel time, date
   references.
3. [Name Similarity](checks/name-similarity.md) — exact
   duplicates, edit distance, phonetic collisions, alias
   clashes.
4. [Clue Redundancy](checks/clue-redundancy.md) — Three Clue
   Rule verification, dead-end and orphan detection.
5. [Graph Health](checks/graph-health.md) — orphans, broken
   links, structural checks, schema compliance, character story
   validation, relationship quality.
6. [Stale DRAFT Detection](checks/stale-draft-detection.md) —
   DRAFT entities left unreviewed past the staleness threshold.
7. [Legacy Canon Field Repair](checks/legacy-canon-field-repair.md)
   — `source_confidence:`/`confidence:` → `canon_status`.
8. [Open Spoilers](checks/open-spoilers.md) — `<!-- spoiler -->`
   content whose reveal condition has passed.

**Full Audit** runs the checks in this order, reading each file
as it goes: Canon Audit → Timeline Validation → Name Similarity
→ Clue Redundancy → Graph Health → Legacy Canon Field Repair →
Stale DRAFT Detection → World Consistency
(`references/world-audit-criteria.md`, if `_World/` exists) →
Open Spoilers. Deduplicate findings that appear in multiple
checks and produce a unified report.
