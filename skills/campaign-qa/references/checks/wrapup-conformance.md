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
  index the file belongs to, matched by session number/filename
  (flat `Sessions/` directories hold many indexes — "same
  directory" alone is not a selector). Chapter-level wrap-ups
  with no per-session index keep their existing value — never
  fabricate a link.
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
- **`reconciled:`** present. If absent — Info; backfill from
  date evidence inside `### Reconciliation Context`: a
  `**Reconciled:**` line, a dated reconcile callout
  (`> [!success] Reconciled …`), or a dated decisions heading.
  A Reconciliation Context with no derivable date → ask the GM
  once for the date (or confirm `null`), rather than leaving
  the file flagged forever.
- **Unreconciled promotion:** `canon_status: AUTHORITATIVE` with
  `reconciled: null` and no Reconciliation Context section —
  Warning; ask whether the review actually happened (stamp the
  date) or the status was stamped prematurely (demote to DRAFT
  and queue for reconcile).
- **`type:` synonym drift** (`session-wrap-up`, `session-wrapup`)
  — Info; normalize to `session_wrap`.

### Step 3: Structure Conformance (publish safety)

Classify every H2 first. **Player-facing H2s are exactly**
`## Narrative Recap` (and its recap variants) and
`## Memorable Moments`. **Every other H2 is Keeper-facing by
default** — including names no list anticipates
(`## Open Questions for Reconcile`, `## Handoff to Reconcile`,
`## Combat Snapshot`). Real vaults invent Keeper-facing headings
faster than any enumeration tracks, and a novel heading is in
nobody's `exclude_sections` list. If a flagged heading is
genuinely player-facing, the GM dismisses the finding — that is
what the fix-or-dismiss walkthrough is for.

- **Keeper-facing sibling H2s** — any Keeper-facing section at
  `##` instead of `###` under `## GM Notes`. Severity per
  heading: read the vault's **effective** exclude list (the
  publish defaults, or the union of vault/site config lists
  where set) — **Critical** when the heading is not covered by
  it (it publishes today), Warning when it is (structure drift,
  no live leak). Fix: hoist the player-facing sections
  **first** — `## Narrative Recap` then `## Memorable Moments`
  to the top, in that order; real files interleave them between
  Keeper H2s, and a player-facing section must never end up
  inside the GM block. Then create `## GM Notes` if absent and
  relocate every Keeper-facing section under it, demoting each
  with its children one level. (The 1.8.52 Reconciliation
  Context repair, generalized.)
- **Missing `<!-- gm-only -->` fence** — Warning (Critical if
  the vault has a published site). Fix: one pair, opening on
  the line before `## GM Notes` (heading inside — outside the
  fence it publishes as an orphan heading on any vault whose
  exclude list lacks the name) and closing after the last
  Keeper-facing section, which is end-of-file once player-facing
  sections are hoisted. Fences are nesting-aware (1.8.52+), so
  inner fences inside the block are safe.
- **Decorated headings** — a template section under a decorated
  name (`### Cross-Entity Claims — Held for Confirmation`,
  `## What Happened — Narrative Recap`) — Info; normalize to
  the template name, moving the qualifier into the first body
  line when it carries meaning.
- **Section order drift** inside `## GM Notes` vs. the template
  — Info, opt-in; reorder whole sections only, never their
  contents.
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
(zero-padded, no title). Drifted names — Warning, **opt-in on a
published vault**: the filename derives the page's site URL, so
a rename 404s links players have already shared — say so when
presenting the finding. A confirmed rename must update the
session index `documents.wrap_up` link and every inbound
reference in the same fix — plain wiki-links, aliased links
(`[[X|Alias]]`), embeds (`![[X]]`), and frontmatter link fields
(basenames resolve vault-wide in Obsidian, so a half-done
rename breaks links silently).
Chapter-level wrap-ups from ingested back-history
(`Chapter_N_Wrap_Up.md`, no per-session files) are conformant
as-is — note them, don't rename.

### Reporting

Group findings per file, worst severity first. A vault that has
never run this check will produce many Info items — offer batch
application per Step (all frontmatter backfills at once) while
keeping Critical/Warning items individual.
