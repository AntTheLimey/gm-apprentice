# QA Report Template

Use this template when generating QA reports in the `_QA/`
folder. The report is both a record of what was checked and
a log of GM decisions.

## Creating and counting

Start the file with `vault_check.py <vault-path> report-new --mode
M --scope S` (mode: `canon_audit`, `timeline`, `name_similarity`,
`clue_redundancy`, `graph_health`, `site_faults`, `full_audit`;
scope: `full_vault`, `chapter_N` or `custom`). It writes
`_QA/QA_{mode}_{date}.md` (a `_2`, `_3` suffix when the name is
taken) with the frontmatter and the headings below, and prints the
path. Set `in_game_date` if known. When the findings are in, run
`report-stats --file <that path>`: it writes the nine `vault_stats`
counts. Never count them by hand.

## Template

```markdown
# QA Report: [Mode Name] — [Date]

**Scope:** [What was checked — full vault, Chapter 3, etc.]
**Duration:** [How many findings were processed]

## Summary

[2-3 sentence overview of vault health. What's the headline?
Is the vault in good shape with minor housekeeping, or are
there critical issues that need attention before the next
session?]

## Critical Findings

### [Finding Title]

**Files:** [[file_a]], [[file_b]]
**Category:** [Canon contradiction | Timeline violation | ...]
**Status:** Fixed | Skipped | Dismissed

[Explanation of the problem]

**Resolution:** [What was done, or why it was skipped/dismissed]

[Repeat for each critical finding]

## Warning Findings

[Same format as critical]

## Info Findings

[Same format, or summarise in a table if there are many:]

| Finding | Files | Category | Status |
|---------|-------|----------|--------|
| ... | ... | ... | ... |

## Recommendations

[Suggest follow-up actions and companion skills where
appropriate:]

- If new content is needed: suggest ttrpg-expert
- If vault structure needs work: suggest campaign-organizer
- If threads need tracking: suggest ttrpg-expert (continuity-engine.md)
- If session prep should incorporate fixes: suggest
  session-prep

## Dismissed Findings Register

[List findings marked as "not a problem" with the GM's
reason. These get `<!-- QA-DISMISSED -->` comments in the
vault files. Recording them here ensures future audits can
reference the GM's reasoning.]

| Finding | Reason | Files |
|---------|--------|-------|
| ... | ... | ... |
```

## Incremental Reports

For full audits, write a single unified report rather than
one per mode. Group findings by severity (Critical → Warning
→ Info), not by mode. Tag each finding with its source mode
so the GM knows what check surfaced it.
