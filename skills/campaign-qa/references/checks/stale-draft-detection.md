## Stale DRAFT Detection

**Severity:** WARNING
**Trigger:** Entity has `canon_status: DRAFT` and has been
DRAFT for 3 or more sessions.

**Preferred procedure:** `vault_check.py stale-drafts`
implements the steps below deterministically (session-plan
exemption included); run it and report its findings. Manual
procedure as fallback:

**Procedure:**

1. Determine the current session number — the highest
   `session_number` value across all session-index entities in
   the vault
2. For each entity with `canon_status: DRAFT`:
   - Extract the session number from `createdSession` (e.g.
     "Session 1" → 1)
   - If `createdSession` is greater than the current session,
     flag as WARNING (createdSession exceeds current session)
   - Calculate age: `current_session - created_session`
   - If age >= 3: flag as WARNING
3. Entities without `createdSession` that are DRAFT: flag as
   WARNING with different message

**Messages:**

- With age: "Stale DRAFT (created session N, now session M) —
  promote to AUTHORITATIVE or delete. Entity has been
  unconfirmed for 3+ sessions."
- Without createdSession: "DRAFT entity missing createdSession —
  cannot determine staleness. Add createdSession or promote."
- Future session: "createdSession (N) exceeds current session
  (M) — check the value."

**Rationale:** DRAFT entities are meant to be temporary — they
represent unconfirmed content awaiting GM review. After 3
sessions, the GM has had ample opportunity to confirm or reject.
Lingering DRAFTs indicate either forgotten content or content
that should have been deleted.

**Not flagged:** DRAFT entities less than 3 sessions old are
normal and expected (Info level at most). Prep content
(session-plan type) is always DRAFT and is exempt from this
check.
