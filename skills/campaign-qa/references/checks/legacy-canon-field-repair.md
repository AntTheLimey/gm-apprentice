## Legacy Canon Field Repair

**Severity:** ERROR
**Trigger:** Any file's frontmatter contains the legacy field
keys `source_confidence:` or `confidence:`. The canonical field
is `canon_status` (since plugin 1.8.0). Run this check on every
full QA pass — it keeps vaults converged after the 1.8.0
migration.

**Procedure:**

1. Scan every `.md` file in the vault (including `_Templates/`
   and `_meta/`) for frontmatter keys `source_confidence:` and
   `confidence:`
2. Present all hits as one batch finding, listing each file
   with the repair that will be applied (rename / collapse /
   keep-and-flag, per the authoritative algorithm in
   `shared/canon-status.md` § Repairing Legacy Keys — never a
   blind key rename). Value conflicts are listed individually
   with both values.
3. On GM confirmation, apply the batch. The repair target is
   always `canon_status` — the GM decides when, not what.
4. After repair, verify no file contains more than one
   `canon_status:` line

**Messages:**

- Rename: "Renamed legacy `{field}` → `canon_status` ({value})"
- Collapse: "Removed duplicate legacy `{field}` (agreed with
  canon_status: {value})"
- Conflict: "CONFLICT: kept `canon_status: {value}`, removed
  `{field}: {other}` — confirm this is the right status for
  {file_path}"

**Rationale:** Three field names for canon status accumulated
across plugin versions (`canon_status`, `source_confidence`,
`confidence`). The 1.8.0 migration sweeps vaults once, but
files restored from backups, copied from old campaigns, or
written by outdated tooling can reintroduce legacy names. This
check makes campaign-qa the permanent enforcement point:
always repair to `canon_status`.
