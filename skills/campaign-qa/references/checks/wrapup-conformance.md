## Wrap-Up Conformance

Verifies every Session Wrap-Up file against the canonical
structure in `shared/templates/session-wrap.md` (spec:
`shared/session-document-chain.md` §4). Wrap-ups written before
the template existed drifted in frontmatter, heading structure,
and publish-safety — this check finds the drift and repairs it
through the standard Fix Workflow, one finding at a time.

**All fixes are content-preserving.** This check relocates,
demotes, renames, and fences — it never rewrites, summarizes, or
re-voices prose. If a fix would require changing what a section
*says*, that is not conformance drift; dismiss it or route it to
Canon Audit.

### Step 1: Enumerate Wrap-Ups

Search for files whose frontmatter `type` is `session_wrap`,
`session-wrap-up`, or `session-wrapup`. Frontmatter is
authoritative — do not rely on filenames; real vaults contain
`Session NN - Title - Wrap-Up.md`, `Session_NN_Wrap_Up.md`, and
chapter-level variants that a filename glob misses.

### Step 2: Frontmatter Conformance

Per file, against the spec's frontmatter block:

- **`session:` is a quoted wiki-link** to the session index
  (`"[[Session NN - Title]]"`). Integer or plain-string values
  are drift — Warning; fix derives the link from the session
  index in the same directory.
- **`session_number:` scalar present.** Absent — Info; backfill
  from the session index or the filename.
- **`play_date:`** present, `"YYYY-MM-DD"`. Non-ISO forms
  (`"May 21, 2026"`) — Info; normalize.
- **`in_game_date:`** present in timeline format. Legacy forms
  (`in_game_dates:`, `in_game_date_start`/`_end` pairs) — Info;
  map to a single `in_game_date` (session-end date), preserving
  the range in body prose if not already there.
- **`source_document:`** wiki-link to the Play Notes file where
  one exists — Info; backfill.
- **`reconciled:`** present. If absent — Info; backfill from a
  `**Reconciled:** YYYY-MM-DD` line inside
  `### Reconciliation Context`, else `null`.
- **Unreconciled promotion:** `canon_status: AUTHORITATIVE` with
  `reconciled: null` and no Reconciliation Context section —
  Warning; ask whether the review actually happened (stamp the
  date) or the status was stamped prematurely (demote to DRAFT
  and queue for reconcile).
- **`type:` synonym drift** (`session-wrap-up`, `session-wrapup`)
  — Info; normalize to `session_wrap`.

### Step 3: Structure Conformance (publish safety)

- **Keeper-facing sibling H2s** — any of PC Carry-Forward, What
  Carries Forward, World State, Keeper Checklist, Quality Notes,
  Quick Bullets, World Fact Findings, Reconciliation Context (or
  their variants) sitting at `##` instead of `###` under
  `## GM Notes` — **Critical**: `exclude_sections` configs strip
  only `GM Notes` by name, so these publish to player sites
  today. Fix: create `## GM Notes` if absent, relocate each
  section under it, demote it and its children one level.
  (Same repair the 1.8.52 migration performs for Reconciliation
  Context; this check extends it to every Keeper-facing section.)
- **Missing `<!-- gm-only -->` fence** around the `## GM Notes`
  block — Warning (Critical if the vault has a published site);
  fix wraps the block in one pair. Fences are nesting-aware
  (1.8.52+), so inner fences inside the block are safe.
- **Recap heading variants** (`## What Happened — Narrative
  Recap`) — Info; the publish tool's contains-match already
  finds these, but normalize to `## Narrative Recap`.
- **Keeper Checklist semantics** — a checklist of already-done
  `- [x]` bookkeeping (ingest-era logs) rather than
  forward-looking GM tasks — Info; offer to retitle the old list
  (e.g. `### Ingest Log`) so `### Keeper Checklist` keeps one
  meaning. Never delete the old content.
- **PC Carry-Forward format drift** — flat bullet lists instead
  of `#### [[PC Name]] (Player)` blocks — Info, opt-in; the fix
  re-headings each PC's existing bullets without rewording them.

### Step 4: Filename Conformance

Filename should be `Chapter_CC_Session_NN_Wrap_Up.md`
(zero-padded, no title). Drifted names — Warning; a rename must
update the session index `documents.wrap_up` link and every
inbound wiki-link in the same fix (basenames resolve vault-wide
in Obsidian, so a half-done rename breaks links silently).
Chapter-level wrap-ups from ingested back-history
(`Chapter_N_Wrap_Up.md`, no per-session files) are conformant
as-is — note them, don't rename.

### Reporting

Group findings per file, worst severity first. A vault that has
never run this check will produce many Info items — offer batch
application per Step (all frontmatter backfills at once) while
keeping Critical/Warning items individual.
