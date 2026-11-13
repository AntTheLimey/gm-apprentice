# gma vault-check

Use it for the vault's content checks (frontmatter, names, index, tables, sessions, leaks and more) and for the version gate every skill runs first (`version`). It needs the vault and one check; most checks read only.

<!-- BEGIN GENERATED: gma vault-check -->
Vault content checks: frontmatter, names, index, drafts and more.

```text
gma vault-check <vault> <command> [<NAME> ...] [options]
```

| Argument | Value | Help |
|---|---|---|
| `<vault>` |  | the vault folder |
| `<command>` | `frontmatter`, `names`, `index`, `stale-drafts`, `changed`, `tables`, `timeline`, `read-aloud`, `relationships`, `chapters`, `npc-pairs`, `sessions`, `gm-leak`, `pc-body`, `wrapup`, `site-faults`, `settings`, `version`, `active-pcs`, `voices`, `stories`, `report-new`, `report-stats`, `all` | the check to run |
| `<NAME>` |  | voices only: the characters to read, by name, alias or [[link]] |
| `--order` |  | timeline only: check the sessions' in_game_date never goes backwards (qa_checks.py) |
| `--mode` | `MODE` | report-new only: canon_audit, full_audit... |
| `--scope` | `SCOPE` | report-new only: full_vault, chapter_N or custom |
| `--date` | `DATE` | report-new only: YYYY-MM-DD (default today) |
| `--folder` | `FOLDER` | restrict the frontmatter, tables, relationships, gm-leak and pc-body checks to a subfolder |
| `--file` | `FILE` | restrict the check to one vault-relative file (e.g. "Chapters/C3/Sessions/Session 07/Chapter_03_Session_07_Wrap_Up.md") — repeatable for tables, relationships, pc-body and site-faults; wrapup takes only the first if given more than one (repeatable) |
| `--newer-than` | `NEWER_THAN` | restrict tables/relationships/pc-body to files with an mtime at or after this vault-relative file's own mtime — a backstop scope, or a completeness cross-check against an explicit --file list |
| `--json` |  | settings only: print the rows as JSON |
| `--dry-run` |  | report-stats only: print each count's old and new value and write nothing |
| `--force` |  | report-stats only: allow a count to drop below a non-zero one already in the report |
| `--apply` | `NAME ...` | settings only: apply the fix for each named fault (a proposed fix needs the GM's yes by name) |
| `--fix` |  | apply the settings check's certain fixes, or the wrapup or gm-leak check's mechanical repairs (frontmatter backfills and the Keeper-facing re-nest for wrapup; the bold-wrapped ERROR heading re-nest for gm-leak); without it the repairs print as WOULD-FIX rows and nothing is written. Ignored by `all`. |
| `--renest-excludes` |  | gm-leak only, vault-wide: the 1.8.3 migration — re-nest every heading titled with a current exclude_sections entry under ## GM Notes, then collapse exclude_sections to ["GM Notes"]. Dry run unless --fix. |
| `--settle` | `NOTE:LINE` | gm-leak only: the Keeper-looking heading at NOTE:LINE (as a gm-leak row names it) is for players; the publish tool records it and gm-leak stops flagging it until the heading changes |
| `--threshold` | `THRESHOLD` | similarity ratio for names (default: the vault's vault.name_match setting) |
| `--since` | `SINCE` | session number for the changed command |

Example: `gma vault-check "<vault>" version`
<!-- END GENERATED -->
