# Version Check

Run on first invocation in any vault-aware skill, after
environment detection.

## Procedure

1. Read `gm_apprentice_version` from `_meta/vault-config.md`
   frontmatter
2. Read `current_version` from `shared/migrations.md` frontmatter
3. If versions match or vault is higher — proceed normally
4. If vault version is lower or absent — announce the mismatch
   and hand off to campaign-organizer's migration workflow
   (`campaign-organizer/references/migration-procedure.md`).
   Resume after migration completes.
5. Skip this check entirely if `_meta/` doesn't exist — that's
   first-time setup, not migration

When first-time setup creates a new vault, stamp
`gm_apprentice_version` in vault-config to the
`current_version` from `shared/migrations.md`.
