## Stale DRAFT Detection

**Severity:** WARNING
**Trigger:** Entity has `canon_status: DRAFT` and either has been
DRAFT for as many sessions as `vault.stale_after_sessions` says, or
has a missing or future `createdSession`.

**Procedure:** run `vault_check.py stale-drafts` and report its
findings. It measures age against each chapter's own latest
session and exempts session plans.

**Not flagged:** a younger DRAFT is normal and expected (Info level
at most). Prep content (session-plan type) is always DRAFT and is
exempt from this check.
