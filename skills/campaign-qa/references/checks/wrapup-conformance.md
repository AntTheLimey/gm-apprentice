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

**Preferred procedure:** run `vault_check.py <vault> wrapup`
(see `shared/vault-access.md`) and present its findings per
file. For the mechanical set — the
frontmatter backfills, the re-nest of a GM Notes heading found
outside the fence, the `<!-- gm-only -->` fence, and the recap/template heading
variants — the dry-run rows print `WOULD-FIX`; on GM
confirmation, re-run with `wrapup --fix` (`FIXED` rows apply
them).
The steps below cover what the script leaves as judgment calls:
dateless Reconciliation Context, unreconciled promotion, Section
order drift, Keeper Checklist semantics, PC Carry-Forward format,
and the filename rename, which `relink.py` does on the GM's yes
(the migration offers it too).

### Step 1: Frontmatter Conformance

`vault_check.py wrapup` backfills the mechanical fields against
the spec's frontmatter block — `session:` link derivation
(chapter-level wrap-ups with no per-session index keep their
existing value; the script never fabricates a link),
`session_number:`, `play_date:`/`in_game_date:` normalization
(including legacy `in_game_dates:`/`_start`/`_end` forms — a
legacy range whose start and end differ is left in place with a
WARNING until the range is preserved in body prose, and a
non-Earth-calendar `in_game_date` is conformant as-is and is not
normalized), `source_document:`, `type:` synonym normalization,
and the remaining canonical fields (`chapter`, `campaign`,
`created_by`, `tags`). Two items stay judgment calls the script
surfaces but doesn't resolve:

- **Dateless `reconciled:`.** The script backfills `reconciled:`
  from date evidence inside `### Reconciliation Context` (a
  `**Reconciled:**` line, a dated reconcile callout, or a dated
  decisions heading) or writes `reconciled: null` when there's no
  Reconciliation Context at all. When a Reconciliation Context
  exists but carries no derivable date, ask the GM once for the
  date (or confirm `null`), rather than leaving the file flagged
  forever.
- **Unreconciled promotion:** `canon_status: AUTHORITATIVE` with
  `reconciled: null` and no Reconciliation Context section —
  Warning; ask whether the review actually happened (stamp the
  date) or the status was stamped prematurely (demote to DRAFT
  and queue for reconcile).

### Step 2: Structure Conformance (publish safety)

A section is Keeper-facing when it sits under the fenced
`## GM Notes` and player-facing when it does not. An H2 outside
the fence is the GM's own, whatever it is called
(`## What the Party Learned`, `## Letters Home`): never flag or
move it. The one exception is a heading the template keeps under
GM Notes (`## World State`, `## Keeper Checklist`,
`## Skipped Prep`, and close variants such as `## World State:`).
As an H2 outside the fence that is a slip, and it publishes Keeper
content.

`vault_check.py wrapup` finds those headings and (with `--fix`)
re-nests them under `## GM Notes`, each demoted a level with its
children. Player-facing sections are hoisted above the GM block
**first**, in their written order, since real files interleave
them between Keeper H2s; one the GM fenced inside
`<!-- gm-only -->` stays fenced. The script also applies the
single `<!-- gm-only -->` fence and normalizes decorated and recap
heading variants to the template name. Severity mirrors what the
script emits (ERROR when the heading line actually publishes,
WARNING when it's already fenced or excluded):

- **GM Notes heading as a sibling H2** already inside a valid
  `<!-- gm-only -->` fence never publishes — Warning (structure
  drift only). Otherwise read the vault's **effective** exclude
  list (the one the publish tool reports for the build: the
  vault file's list, else the site file's, else the defaults;
  the vault file's own list or the defaults when the tool cannot
  be asked) — Critical when the heading is not covered by
  it (it publishes today), Warning when it is.
- **Missing `<!-- gm-only -->` fence** — Warning, Critical if the
  vault has a published site.
- **Unbalanced `<!-- gm-only -->` fence** (an orphan closer, or
  an opener that never closes) — the script reports it and
  refuses to touch the body: which marker is missing, and where
  it belonged, changes what publishes either way. Frontmatter
  backfills still apply. Present it as a GM decision, fix the
  marker by hand, then re-run `--fix` for the re-nest.

Three drift shapes the script doesn't resolve stay judgment
calls:

- **Section order drift** inside `## GM Notes` vs. the template
  — Info, opt-in; reorder whole sections only, never their
  contents.
- **Keeper Checklist semantics** — a checklist of already-done
  `- [x]` bookkeeping (ingest-era logs) rather than
  forward-looking GM tasks — Info; offer to retitle the old list
  (e.g. `### Ingest Log`) so `### Keeper Checklist` keeps one
  meaning. Never delete the old content.
- **PC Carry-Forward format drift** — flat bullet lists instead
  of `#### [[PC Name]] (Player)` blocks — Info, opt-in; the fix
  re-headings each PC's existing bullets without rewording them.

### Step 3: Filename Conformance

Filename should be `Chapter_CC_Session_NN_Wrap_Up.md`
(zero-padded, no title). Drifted names — Warning. Rename with
`python3 "${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/relink.py" <vault> <old path>
Chapter_CC_Session_NN_Wrap_Up` (dry run; add `--apply` on the GM's
yes): it renames the file and rewrites every link to it, the session
index's `documents.wrap_up` included, in one pass.
Chapter-level wrap-ups from ingested back-history
(`Chapter_N_Wrap_Up.md`, no per-session files) are conformant
as-is — note them, don't rename.

### Reporting

Group findings per file, worst severity first. A vault that has
never run this check will produce many Info items — offer batch
application per Step (all frontmatter backfills at once) while
keeping Critical/Warning items individual.
