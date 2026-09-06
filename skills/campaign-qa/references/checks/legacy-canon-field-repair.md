## Legacy Canon Field Repair

**Severity:** ERROR
**Trigger:** Any file's frontmatter contains the legacy field
keys `source_confidence:` or `confidence:`. The canonical field
is `canon_status` (since plugin 1.8.0). Run this check on every
full QA pass — it keeps vaults converged after the 1.8.0
migration.

**Procedure:**

1. Detect with `vault_check.py frontmatter` (rows report
   `legacy field …`) or a `stamp_entities.py <vault>
   --repair-canon` dry run — either surfaces every file
   carrying `source_confidence:` or `confidence:`.
2. Present the dry-run rows as the batch finding: `WOULD-REPAIR`
   lists the rename/collapse actions per file, `WOULD-CONFLICT`
   lists both the kept `canon_status` value and the disagreeing
   legacy value — per the authoritative algorithm in
   `shared/canon-status.md` § Repairing Legacy Keys, never a
   blind key rename.
3. On GM confirmation, re-run with `--write`. Rows become
   `REPAIRED` / `CONFLICT`. The repair target is always
   `canon_status` — the GM decides when, not what.
4. The script guarantees exactly one `canon_status:` line
   survives per file, or nothing is written.

**Messages:** map directly to the script's row actions —
"renamed `{field}` -> canon_status: `{value}`" and "removed
`{field}`" for a clean repair; a `CONFLICT` row appends
"`{field}: {other}` disagrees with canon_status: `{value}` —
kept canon_status, confirm it" naming both values for the GM
to check.

**Rationale:** Three field names for canon status accumulated
across plugin versions (`canon_status`, `source_confidence`,
`confidence`). The 1.8.0 migration sweeps vaults once, but
files restored from backups, copied from old campaigns, or
written by outdated tooling can reintroduce legacy names. This
check makes campaign-qa the permanent enforcement point:
always repair to `canon_status`.
