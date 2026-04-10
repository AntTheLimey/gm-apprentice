# Filesystem Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make campaign-qa and session-lifecycle work at ~80-90% capability on plain markdown folders without Obsidian MCP tools.

**Architecture:** Add environment detection to both skills and make check-procedures.md tool-agnostic. Instead of naming specific MCP tools in procedure steps, use generic operation names ("enumerate entity files", "search for pattern") and point to shared/filesystem-mode.md for the tool mapping. This is the same pattern campaign-organizer already uses: "The workflow steps are identical — only the tools differ."

**Tech Stack:** Markdown content files (Claude Code skill plugin)

---

## File Map

### Files Modified

| File | What Changes |
|------|-------------|
| `skills/campaign-qa/SKILL.md` | Add environment detection, point to shared/filesystem-mode.md |
| `skills/campaign-qa/references/check-procedures.md` | Replace MCP tool names with generic operations |
| `skills/session-lifecycle/SKILL.md` | Add environment detection, add filesystem-mode entity creation in Wrap-up |

### Files NOT Touched

- `skills/shared/*` — already has filesystem-mode.md with tool mapping
- `skills/campaign-organizer/*` — already has filesystem support
- `skills/ttrpg-expert/*` — standalone, doesn't use vault tools

---

## Task 1: Add filesystem fallback to campaign-qa

**Files:**
- Modify: `skills/campaign-qa/SKILL.md`
- Modify: `skills/campaign-qa/references/check-procedures.md`

### Context for the implementer

campaign-qa currently says "Fall back to file Read tools if the MCP is unavailable" (SKILL.md line 57-58) but never explains how. The check-procedures.md references `list_vault_files`, `search_vault_simple`, and `search_vault` throughout — tying procedures to specific Obsidian tools.

Two changes:

**Part A: SKILL.md** — Replace the "Primary tools" paragraph with environment detection + a pointer to shared/filesystem-mode.md for the tool mapping.

**Part B: check-procedures.md** — Replace every MCP tool name with a generic operation. The mapping (already defined in shared/filesystem-mode.md) is:

| Operation | Generic term to use in procedures |
|-----------|-----------------------------------|
| `list_vault_files` | "Enumerate files" or "List entity files in scope" |
| `search_vault` / `search_vault_simple` / `search_vault_smart` | "Search across files" or "Search for [pattern]" |
| `get_vault_file` | "Read the file" |

Add a brief note at the top of check-procedures.md explaining this: "These procedures use generic operation names. See shared/filesystem-mode.md for which tool to use in each environment."

- [ ] **Step 1: Read both files in full**

Read `skills/campaign-qa/SKILL.md` and `skills/campaign-qa/references/check-procedures.md`.

- [ ] **Step 2: Update SKILL.md Vault Integration section**

Replace the "Primary tools" paragraph (lines 54-58, from "**Primary tools:** Use the Obsidian MCP tools" through "Fall back to file Read tools if the MCP is unavailable.") with:

```markdown
**Environment detection:** On first invocation, check for
Obsidian MCP tools (`search_vault`, `list_vault_files`,
`get_vault_file`). See `shared/filesystem-mode.md` for the
full tool mapping and environment detection procedure.

Both Obsidian mode and filesystem mode run the same audit
procedures — only the tools differ. The procedures in
`references/check-procedures.md` use generic operation names
(enumerate files, search for pattern, read file). Map these
to your environment's tools per `shared/filesystem-mode.md`.
```

Also replace "This skill reads the campaign's Obsidian vault." (line 50) with:

```markdown
This skill reads the campaign vault (Obsidian or plain folder).
```

- [ ] **Step 3: Make check-procedures.md tool-agnostic**

Add a note after the title (line 1) and before the Table of Contents:

```markdown
**Tool note:** These procedures use generic operation names —
"enumerate files," "search for [pattern]," "read [file]." See
`shared/filesystem-mode.md` for which specific tool to use in
your environment (Obsidian MCP tools or filesystem Glob/Grep/Read).
```

Then do a find-and-replace pass through the file. Replace every instance of MCP-specific tool names with generic operations:

| Find | Replace with |
|------|-------------|
| `Use \`list_vault_files\` to enumerate the scope (full vault or chapter folder). Use \`search_vault_simple\` to find entity references across files.` | `Enumerate all entity files in scope. Search for entity names across all files in scope.` |
| `Use \`search_vault\` with date patterns and event-related keywords to find dated references across the vault.` | `Search for date patterns and event keywords across all vault files.` |
| `Use \`list_vault_files\` and read frontmatter from entity files to build this list.` | `Enumerate all entity files and read frontmatter from each to build this list.` |
| `Use \`list_vault_files\` to enumerate, then read frontmatter from each file.` | `Enumerate all entity files in scope, then read frontmatter from each.` |
| `Use \`search_vault_simple\` to find \`[[...]]\` patterns, then verify each target exists.` | `Search for `[[...]]` patterns across all files, then verify each linked target file exists.` |

Also replace any remaining standalone references to `search_vault`, `search_vault_simple`, `list_vault_files`, or `get_vault_file` with the generic equivalent. Grep the file after editing to confirm zero MCP tool names remain (except in any "see also" references to the tool mapping).

- [ ] **Step 4: Commit**

```bash
git add skills/campaign-qa/
git commit -m "feat: add filesystem fallback to campaign-qa

Add environment detection. Make check-procedures.md
tool-agnostic — generic operation names replace MCP tool
references. See shared/filesystem-mode.md for tool mapping."
```

---

## Task 2: Add filesystem fallback to session-lifecycle

**Files:**
- Modify: `skills/session-lifecycle/SKILL.md`

### Context for the implementer

session-lifecycle has no explicit filesystem support. Its Vault Integration section (lines 57-62) assumes Obsidian. The four modes (Prep, Play, Wrap-up, Reconcile) don't mention tool alternatives.

The key insight: session-lifecycle's procedures are mostly just "read this file" and "write this file" — which work in any environment. The handoff to campaign-organizer for entity creation stays the same — campaign-organizer already supports filesystem mode.

Changes:
1. Replace Vault Integration intro with environment detection

That's it. The Prep, Play, Wrap-up, and Reconcile modes work as-is. campaign-organizer handles the filesystem tool mapping for entity creation.

- [ ] **Step 1: Read the full SKILL.md**

Read `skills/session-lifecycle/SKILL.md`.

- [ ] **Step 2: Update Vault Integration section**

Replace lines 57-62 (from "## Vault Integration" through "skill-internal storage." and the blank line after) with:

```markdown
## Vault Integration

This skill reads and writes to the campaign vault (Obsidian
or plain folder). All persistent state lives in the vault —
never in memory or skill-internal storage.

**Environment detection:** On first invocation, check for
Obsidian MCP tools. See `shared/filesystem-mode.md` for the
detection procedure and tool mapping.

Both modes use the same workflow. Entity creation and updates
still hand off to campaign-organizer (which has its own
filesystem mode support).

Announce which mode you're in, then confirm the campaign
folder path with the user.
```

- [ ] **Step 3: Commit**

```bash
git add skills/session-lifecycle/SKILL.md
git commit -m "feat: add filesystem fallback to session-lifecycle

Add environment detection. Filesystem mode creates and
updates entity files directly instead of handing off to
campaign-organizer."
```

---

## Task 3: A/B benchmark — campaign-qa

**Purpose:** Verify filesystem fallback additions don't degrade quality.

- [ ] **Step 1: Run one A/B benchmark**

Launch two agents with the campaign-qa benchmark questions:
- Agent A: reads SKILL.md from **main branch** (control)
- Agent B: reads SKILL.md from **worktree** (test)

Same questions, same evaluator, blind scoring.

- [ ] **Step 2: Evaluate**

If delta is within ±5 points: **pass**.
If delta is worse than -5: investigate which questions regressed.

---

## Task 4: A/B benchmark — session-lifecycle

Same as Task 3 but for session-lifecycle.

- [ ] **Step 1: Run one A/B benchmark**
- [ ] **Step 2: Evaluate**
