# Shared References Extraction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract duplicated infrastructure concepts (entity schema, vault structure, filesystem mode, canon confidence) into `skills/shared/` so all four skills reference one source of truth.

**Architecture:** Four shared reference files replace duplicated content across skill SKILL.md files and reference directories. Each SKILL.md retains enough inline context to function without reading shared files (summaries with cross-references to shared/ for depth). Replaced files are deleted. No filesystem fallback changes in this phase.

**Tech Stack:** Markdown content files (Claude Code skill plugin)

**Baselines (from tests/baselines/SUMMARY.md):**

| Skill | Median | Pass Threshold |
|-------|:------:|:--------------:|
| ttrpg-expert | 68 | ≥ 61 |
| campaign-organizer | 67 | ≥ 57 |
| campaign-qa | 66 | ≥ 60 |
| session-lifecycle | 67.5 | ≥ 61 |

---

## File Map

### New Files (create in `skills/shared/`)

| File | Source | Size Est. |
|------|--------|-----------|
| `skills/shared/entity-schema.md` | Merge: `campaign-organizer/references/ontology-reference.md` (7.3K) + `ttrpg-expert/entity-types.md` (6.1K) | ~10-12K |
| `skills/shared/vault-structure.md` | Move: `campaign-organizer/references/vault-structure.md` (1.3K) | ~1.3K |
| `skills/shared/filesystem-mode.md` | Move: `campaign-organizer/references/filesystem-mode.md` (1.3K) | ~1.5K |
| `skills/shared/canon-confidence.md` | Extract from: duplicated paragraphs across all 4 SKILL.md files + `ttrpg-expert/canon-management.md` for depth | ~1.5K |

### Files Removed After Extraction

| File | Replaced By |
|------|-------------|
| `skills/campaign-organizer/references/ontology-reference.md` | `skills/shared/entity-schema.md` |
| `skills/campaign-organizer/references/vault-structure.md` | `skills/shared/vault-structure.md` |
| `skills/campaign-organizer/references/filesystem-mode.md` | `skills/shared/filesystem-mode.md` |
| `skills/ttrpg-expert/entity-types.md` | `skills/shared/entity-schema.md` |

### Files Modified (cross-reference updates only)

| File | Changes |
|------|---------|
| `skills/campaign-organizer/SKILL.md` | Update `references/` paths → `shared/` paths |
| `skills/ttrpg-expert/SKILL.md` | Update `entity-types.md` → `shared/entity-schema.md`, `canon-management.md` → also ref `shared/canon-confidence.md` |
| `skills/campaign-qa/SKILL.md` | Add cross-ref to `shared/canon-confidence.md` and `shared/entity-schema.md` |
| `skills/session-lifecycle/SKILL.md` | Add cross-ref to `shared/vault-structure.md` and `shared/entity-schema.md` |

### Files NOT Touched

- `skills/campaign-organizer/references/graph-hygiene.md` — skill-specific, stays local
- `skills/campaign-organizer/references/index-template.md` — skill-specific, stays local
- `skills/campaign-qa/references/check-procedures.md` — skill-specific
- `skills/campaign-qa/references/report-template.md` — skill-specific
- `skills/session-lifecycle/references/session-templates.md` — skill-specific
- `skills/session-lifecycle/references/recap-formats.md` — skill-specific
- `skills/ttrpg-expert/canon-management.md` — stays as the deep reference; shared/canon-confidence.md is the summary

---

## Task 1: Create `skills/shared/` with four reference files

**Files:**
- Create: `skills/shared/entity-schema.md`
- Create: `skills/shared/vault-structure.md`
- Create: `skills/shared/filesystem-mode.md`
- Create: `skills/shared/canon-confidence.md`

### Context for the implementer

These files consolidate duplicated content from across 4 skills into a single shared directory. The key merge is entity-schema.md which combines two complementary files:

- `skills/campaign-organizer/references/ontology-reference.md` — has the type hierarchy tree, relationship types taxonomy (16 categories, 60+ types), frontmatter schemas with YAML examples, required relationships table, and default folder mapping
- `skills/ttrpg-expert/entity-types.md` — has universal temporal fields, per-type attribute tables (NPC, Location, Item, Faction, Clue, Thread, Creature, Organization, Event, Document), entity relationship examples, and system-specific routing

The merged file should:
1. Keep the universal fields section from entity-types.md (it's cleaner)
2. Keep the full type hierarchy from ontology-reference.md
3. Keep all per-type attribute tables from entity-types.md (more complete)
4. Keep the full relationship types taxonomy from ontology-reference.md
5. Keep required relationships and folder mapping from ontology-reference.md
6. Keep the system-specific routing note from entity-types.md
7. Deduplicate where both files cover the same ground (frontmatter schemas appear in both — keep the more detailed version from ontology-reference.md and merge in any unique fields from entity-types.md)

For vault-structure.md and filesystem-mode.md: these are direct moves with no content changes.

For canon-confidence.md: extract a focused 1.5K summary of the three states and their rules. The full detailed workflow stays in `ttrpg-expert/canon-management.md` — the shared file is the quick reference that all skills can point to.

- [ ] **Step 1: Read all source files**

Read these files in full:
- `skills/campaign-organizer/references/ontology-reference.md`
- `skills/ttrpg-expert/entity-types.md`
- `skills/campaign-organizer/references/vault-structure.md`
- `skills/campaign-organizer/references/filesystem-mode.md`
- `skills/ttrpg-expert/canon-management.md` (for canon-confidence extraction)

- [ ] **Step 2: Create `skills/shared/entity-schema.md`**

Merge the two source files as described above. The structure should be:

```
# Entity Schema
(preamble: what this file is, who uses it)

## System-Specific Guidance
(routing note from entity-types.md lines 6-13)

## Universal Fields
(from entity-types.md lines 14-28 — the 5-field table)

## Entity Type Hierarchy
(from ontology-reference.md lines 9-64 — the full tree)

## Frontmatter Schemas
### Required Fields (All Types)
(from ontology-reference.md lines 71-83)
### Relationships Block
(from ontology-reference.md lines 86-104)

## Core Entity Types
(from entity-types.md lines 30-164 — all per-type tables: NPC, Location, Item, Faction, Clue, Thread, Creature, Organization, Event, Document)

## Narrative Element Schemas
(from ontology-reference.md lines 106-161 — Chapter, Session, Scene YAML)

## Relationship Types
(from ontology-reference.md lines 189-227 — full taxonomy table + symmetric types + genre tags)

## Required Relationships
(from ontology-reference.md lines 229-237)

## Default Folder Mapping
(from ontology-reference.md lines 239-252)
```

- [ ] **Step 3: Create `skills/shared/vault-structure.md`**

Copy `skills/campaign-organizer/references/vault-structure.md` verbatim. No changes needed — this file is already well-structured and self-contained.

- [ ] **Step 4: Create `skills/shared/filesystem-mode.md`**

Copy `skills/campaign-organizer/references/filesystem-mode.md` verbatim. Add a brief note at the top about environment detection:

```markdown
## Environment Detection

On first invocation, check for Obsidian MCP tools
(`search_vault`, `list_vault_files`, `get_vault_file`).

- **Tools present** → Obsidian mode. Announce: "Connected to
  Obsidian vault. Using MCP tools."
- **Tools absent** → Filesystem mode. Announce: "Working in
  filesystem mode. Files will be Obsidian-compatible."
- **User override** → If user says "use filesystem mode",
  respect it even if MCP tools exist. Announce: "Obsidian MCP
  available but using filesystem mode as requested."
```

Keep the existing Tool Mapping table, File Format section, and What Is Lost section unchanged.

- [ ] **Step 5: Create `skills/shared/canon-confidence.md`**

Write a focused summary file (~1.5K):

```markdown
# Canon Confidence

Quick reference for the three canon confidence states used
across all campaign entity files. For the full conflict
detection and resolution workflow, see
`ttrpg-expert/canon-management.md`.

## The Three States

| State | Meaning | When to Use |
|-------|---------|-------------|
| DRAFT | Initial entry, not yet confirmed by GM | New entities from play notes, prep content, AI-generated content |
| AUTHORITATIVE | Confirmed as canon by the GM | GM has reviewed and approved the content |
| SUPERSEDED | Replaced by newer information | A retcon, timeline correction, or updated version exists |

## Rules

- New content always starts as **DRAFT**
- The GM promotes DRAFT → AUTHORITATIVE by reviewing the vault
- When facts change, mark old content **SUPERSEDED** (don't delete)
- SUPERSEDED entries retain a `superseded_by` reference
- On conflicts between entries, surface the conflict to the GM — never silently resolve

## The `source_confidence` Field

Every entity frontmatter includes:

```yaml
source_confidence: DRAFT    # or AUTHORITATIVE or SUPERSEDED
```

Some vaults use `canon_status` instead — treat them as equivalent.

## Companion Reference

For detailed conflict detection rules, source tracking,
and the full promotion workflow, read:
`ttrpg-expert/canon-management.md`
```

- [ ] **Step 6: Verify all four files exist and cross-references resolve**

Run:
```bash
ls -la skills/shared/
```

Expected: 4 files (entity-schema.md, vault-structure.md, filesystem-mode.md, canon-confidence.md)

Check that cross-references within the shared files point to valid paths.

- [ ] **Step 7: Commit**

```bash
git add skills/shared/
git commit -m "feat: create skills/shared/ with four shared reference files

Extract duplicated infrastructure concepts (entity schema,
vault structure, filesystem mode, canon confidence) into
shared reference files. Merges ontology-reference.md and
entity-types.md into a unified entity-schema.md."
```

---

## Task 2: Update campaign-organizer to reference shared files

**Files:**
- Modify: `skills/campaign-organizer/SKILL.md`
- Delete: `skills/campaign-organizer/references/ontology-reference.md`
- Delete: `skills/campaign-organizer/references/vault-structure.md`
- Delete: `skills/campaign-organizer/references/filesystem-mode.md`

### Context for the implementer

campaign-organizer/SKILL.md currently references three files in its own `references/` directory that have been moved to `skills/shared/`. Update all cross-references. The SKILL.md content itself doesn't change — only the file paths in routing instructions.

- [ ] **Step 1: Read campaign-organizer/SKILL.md**

Read the full file and identify every reference to:
- `references/filesystem-mode.md` (line 65)
- `references/vault-structure.md` (line 191)
- `references/ontology-reference.md` (line 88)
- `entity-types.md` (line 22 — this points to ttrpg-expert, update to shared)

- [ ] **Step 2: Update path references in SKILL.md**

Replace these exact strings:

| Old | New |
|-----|-----|
| `references/filesystem-mode.md` | `shared/filesystem-mode.md` |
| `references/vault-structure.md` | `shared/vault-structure.md` |
| `references/ontology-reference.md` | `shared/entity-schema.md` |
| `its \`entity-types.md\`` (line 22, referring to ttrpg-expert) | `\`shared/entity-schema.md\`` |

Also add a brief cross-reference to `shared/canon-confidence.md` near the Handling Ambiguity section (line 243-252) where `canon_status: DRAFT` is referenced:

After line 249 (`set \`canon_status: DRAFT\`.`), add:
```
See `shared/canon-confidence.md` for the full confidence state
definitions.
```

- [ ] **Step 3: Delete the three replaced reference files**

```bash
git rm skills/campaign-organizer/references/ontology-reference.md
git rm skills/campaign-organizer/references/vault-structure.md
git rm skills/campaign-organizer/references/filesystem-mode.md
```

Verify the remaining references/ files are untouched:
```bash
ls skills/campaign-organizer/references/
```
Expected: `graph-hygiene.md`, `index-template.md`

- [ ] **Step 4: Commit**

```bash
git add skills/campaign-organizer/
git commit -m "refactor: campaign-organizer references shared/ files

Update all cross-references from local references/ to
shared/. Remove ontology-reference.md, vault-structure.md,
and filesystem-mode.md (now in shared/)."
```

---

## Task 3: Benchmark campaign-organizer (3 runs)

**Files:**
- Read: `tests/benchmark-questions/campaign-organizer.md` (for questions and prompts)
- Read: `tests/baselines/campaign-organizer-baseline.md` (for pass criteria)

### Context for the implementer

Run the standard benchmark: 3 runs, 2 sonnet agents per run, blind opus evaluation. Use the same methodology as the baseline gathering (see the benchmark questions file for agent prompts and evaluator prompt). The existing baseline is median 67, pass threshold ≥ 57.

- [ ] **Step 1: Read the benchmark questions file**

Read `tests/benchmark-questions/campaign-organizer.md` for the control/test agent prompts and evaluator prompt.

- [ ] **Step 2: Run 3 benchmark runs (2 agents each)**

For each run, launch 2 sonnet agents with the test prompt (pointing at current branch). Save answers. Run blind opus evaluation.

- [ ] **Step 3: Compare against baseline**

Baseline: median 67, pass ≥ 57.
If post-refactor median < 57, the shared-refs extraction caused a regression. Investigate which questions scored lower and whether the agent couldn't find the shared files.

- [ ] **Step 4: Save results**

If pass: save to `tests/baselines/campaign-organizer-shared-refs.md` with the same format as the baseline file.
If fail: diagnose and fix before proceeding.

---

## Task 4: Update ttrpg-expert to reference shared entity-schema

**Files:**
- Modify: `skills/ttrpg-expert/SKILL.md`
- Delete: `skills/ttrpg-expert/entity-types.md`

### Context for the implementer

ttrpg-expert/SKILL.md has two references to update:
1. Line 215: `See \`canon-management.md\`.` — keep as-is (canon-management.md stays local), but add a cross-ref to shared/canon-confidence.md
2. Line 218: `See \`entity-types.md\` and \`continuity-engine.md\`.` — update entity-types.md → shared/entity-schema.md

The SKILL.md is loaded via the plugin system, which resolves paths relative to the skill's base directory. The `shared/` directory is a sibling of `ttrpg-expert/`, so the path from SKILL.md's perspective is `../shared/entity-schema.md`. However, the existing convention in this codebase is to use short relative paths without `../` — agents navigate by reading routing instructions. Check how campaign-organizer references its files and follow the same pattern.

- [ ] **Step 1: Read ttrpg-expert/SKILL.md**

Find all references to `entity-types.md` and `canon-management.md`.

- [ ] **Step 2: Update references**

In the "Canon and Validation" section (lines 211-222):

Replace:
```
See `canon-management.md`. On conflicts, ask — never assume.

All content must be mechanically correct and narratively
consistent. See `entity-types.md` and `continuity-engine.md`.
```

With:
```
See `canon-management.md` and `shared/canon-confidence.md`.
On conflicts, ask — never assume.

All content must be mechanically correct and narratively
consistent. See `shared/entity-schema.md` and
`continuity-engine.md`.
```

Also check the SKILL.md skill description frontmatter and any routing tables that mention `entity-types.md` — update those too.

- [ ] **Step 3: Delete entity-types.md**

```bash
git rm skills/ttrpg-expert/entity-types.md
```

- [ ] **Step 4: Verify no broken references**

Search for any remaining references to `entity-types.md` across the project:
```bash
grep -r "entity-types.md" skills/
```
Expected: zero results.

- [ ] **Step 5: Commit**

```bash
git add skills/ttrpg-expert/
git commit -m "refactor: ttrpg-expert references shared/entity-schema.md

Replace entity-types.md with shared/entity-schema.md.
Add shared/canon-confidence.md cross-reference."
```

---

## Task 5: Benchmark ttrpg-expert (3 runs)

Same methodology as Task 3. Baseline: median 68, pass ≥ 61.

- [ ] **Step 1: Read benchmark questions**
- [ ] **Step 2: Run 3 benchmark runs**
- [ ] **Step 3: Compare against baseline**
- [ ] **Step 4: Save results or diagnose regression**

---

## Task 6: Update campaign-qa to reference shared files

**Files:**
- Modify: `skills/campaign-qa/SKILL.md`

### Context for the implementer

campaign-qa/SKILL.md doesn't have files to delete — it doesn't own any of the content being shared. It just needs cross-references added so agents know where to find the canonical definitions.

- [ ] **Step 1: Read campaign-qa/SKILL.md**

- [ ] **Step 2: Add shared references to Vault Integration section**

In the "Vault Integration" section (lines 47-69), after the key vault locations list, add:

```markdown
**Shared references** (read as needed for schema definitions):
- `shared/canon-confidence.md` — DRAFT/AUTHORITATIVE/SUPERSEDED
  state definitions and rules.
- `shared/entity-schema.md` — Entity type hierarchy, frontmatter
  schemas, relationship types, required relationships.
```

- [ ] **Step 3: Add cross-reference to severity ratings**

In the Absolute Rules section (lines 89-95) where DRAFT is mentioned in the severity context, add a brief cross-ref after line 95:

```markdown
  See `shared/canon-confidence.md` for the full confidence
  state definitions.
```

- [ ] **Step 4: Commit**

```bash
git add skills/campaign-qa/SKILL.md
git commit -m "refactor: campaign-qa references shared/ files

Add cross-references to shared/canon-confidence.md and
shared/entity-schema.md for canonical definitions."
```

---

## Task 7: Benchmark campaign-qa (3 runs)

Same methodology as Task 3. Baseline: median 66, pass ≥ 60.

- [ ] **Step 1: Read benchmark questions**
- [ ] **Step 2: Run 3 benchmark runs**
- [ ] **Step 3: Compare against baseline**
- [ ] **Step 4: Save results or diagnose regression**

---

## Task 8: Update session-lifecycle to reference shared files

**Files:**
- Modify: `skills/session-lifecycle/SKILL.md`

### Context for the implementer

session-lifecycle/SKILL.md duplicates vault location lists and entity field guidance. Add cross-references to shared files where this content is defined canonically.

- [ ] **Step 1: Read session-lifecycle/SKILL.md**

- [ ] **Step 2: Add shared references to Vault Integration section**

In the "Vault Integration" section (lines 54-66), after the key vault locations list, add:

```markdown
**Shared references** (read as needed):
- `shared/vault-structure.md` — Default vault folder layout
  and naming conventions.
- `shared/entity-schema.md` — Entity type hierarchy, frontmatter
  schemas, temporal fields, relationship types.
- `shared/canon-confidence.md` — DRAFT/AUTHORITATIVE/SUPERSEDED
  state definitions and promotion rules.
```

- [ ] **Step 3: Add cross-reference to Canon Workflow section**

In the Canon Workflow section (lines 421-441) where `source_confidence: DRAFT` and AUTHORITATIVE are mentioned, add after line 441:

```markdown
See `shared/canon-confidence.md` for the full confidence
state definitions and promotion workflow.
```

- [ ] **Step 4: Commit**

```bash
git add skills/session-lifecycle/SKILL.md
git commit -m "refactor: session-lifecycle references shared/ files

Add cross-references to shared/vault-structure.md,
shared/entity-schema.md, and shared/canon-confidence.md."
```

---

## Task 9: Benchmark session-lifecycle (3 runs)

Same methodology as Task 3. Baseline: median 67.5, pass ≥ 61.

- [ ] **Step 1: Read benchmark questions**
- [ ] **Step 2: Run 3 benchmark runs**
- [ ] **Step 3: Compare against baseline**
- [ ] **Step 4: Save results or diagnose regression**

---

## Task 10: Final verification and commit

- [ ] **Step 1: Verify no broken cross-references**

```bash
grep -r "ontology-reference.md" skills/
grep -r "entity-types.md" skills/
grep -r "references/filesystem-mode.md" skills/
grep -r "references/vault-structure.md" skills/
```

All should return zero results.

- [ ] **Step 2: Verify shared/ files all exist**

```bash
ls -la skills/shared/
```

Expected: 4 files.

- [ ] **Step 3: Verify replaced files are gone**

```bash
ls skills/campaign-organizer/references/
ls skills/ttrpg-expert/entity-types.md 2>&1
```

Expected: references/ has only graph-hygiene.md and index-template.md. entity-types.md returns "No such file."

- [ ] **Step 4: Size comparison**

```bash
wc -c skills/shared/*
```

Compare total shared/ size against the sum of replaced files (20,828 bytes). The shared directory should be smaller than the sum of replaced files due to deduplication.

- [ ] **Step 5: Compile benchmark summary**

Create or update `tests/baselines/shared-refs-results.md` with all four skill benchmark results, comparing post-refactor medians against baseline medians and pass thresholds.
