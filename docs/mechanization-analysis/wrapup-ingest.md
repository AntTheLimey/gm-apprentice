# Mechanization analysis — session-wrapup, vault-ingest, and their shared references

Scope read in full: `skills/session-wrapup/SKILL.md` (512 lines) + both references;
`skills/vault-ingest/SKILL.md` (272) + all four references; `skills/shared/reconcile.md`,
`canon-status.md`, `content-fidelity.md`, `character-story-format.md`,
`templates/session-wrap.md`, `templates/character-story.md`;
`skills/ttrpg-expert/canon-management.md`, `world-evolution.md`. Cross-checked against
`skills/shared/scripts/*.py --help`, `vault_check.py` source, `skills/shared/vault-access.md`,
`tools/mobrpg/llms.txt`, and `skills/campaign-qa/references/checks/wrapup-conformance.md`
(out of scope but load-bearing for finding B2).

Existing mechanization (baseline, so nothing below duplicates it): `vault_check.py`
(`frontmatter names index stale-drafts changed tables timeline read-aloud relationships all`),
`graph_check.py` (`orphans unresolved deadends backlinks ambiguous`), `vault_search.py`,
`session_context.py`, `stamp_entities.py` (`asOfSession`/`lastUpdated`/`--retag`),
`gurps_check.py`, `gurps_calc.py`, `schema_rules.py` (shared schema tables).

---

## Headline

The two skills contain roughly **14 fully deterministic procedures** currently written as
prose the model executes by hand, **7 hybrids** where a script should produce candidates,
and a smaller genuinely-judgment core (recap prose, keeper interview, faction turns,
conflict adjudication). The two largest single wins are:

1. **`ingest_images.py`** — `vault-ingest/references/image-handling.md` is 162 lines that
   read as a written specification for a script nobody wrote. Every rule in it except
   "which entity does this orphan image belong to" is decidable.
2. **`vault_check.py wrapup`** — wrap-up structural conformance. The repo already admits
   this fails in practice: `campaign-qa/references/checks/wrapup-conformance.md` is a
   146-line *repair* procedure whose existence is proof the authoring rules in
   `session-wrapup/SKILL.md` and `shared/reconcile.md` are not reliably followed.

Third, unglamorous but pervasive: **reconcile's step-6 bookkeeping** and **wrap-up's
frontmatter stamping** are field writes across N files that the model does with N×(Read+Edit)
cycles. `stamp_entities.py` already proved this pattern for one case (3c steps 1–2); the
same script should absorb four more.

---

## A. ALREADY-SCRIPTED (for reference — do not re-propose)

| Where | What | Script |
|---|---|---|
| `session-wrapup/SKILL.md:186-199` | PC sheet frontmatter refresh (`asOfSession`, `lastUpdated`, chapter retag) | `stamp_entities.py` |
| `session-wrapup/SKILL.md:346-350` | Post-entity-write validation loop | `vault_check.py frontmatter --folder` |
| `session-wrapup/SKILL.md:295-306` | `relationships[].type` against the sanctioned vocabulary | `vault_check.py relationships` |
| `session-wrapup/SKILL.md:69-75` | Live-vitals pull before wrap-up | `npx gm-apprentice-publish flush` |
| `vault-ingest/SKILL.md:75` (Gotcha 6) | Per-bucket entity validation | `vault_check.py frontmatter` |
| `canon-status.md:32-36` | Legacy `source_confidence`/`confidence` **detection** | `vault_check.py frontmatter` (`DEPRECATED_FIELDS`, vault_check.py:136-141) |

---

## B. MECHANIZABLE

### B1 — Wrap-Up file scaffold + filename derivation
- **Cite:** `session-wrapup/SKILL.md:27-56`; `shared/templates/session-wrap.md:1-29`
- **Prose asks:** read the template, fill nine frontmatter fields (two of them derived
  wiki-links), derive `Chapter_CC_Session_NN_Wrap_Up.md` with zero-padding, place it in the
  session's own directory, preserve the `<!-- gm-only -->` fence, and write the session
  index's `documents.wrap_up` link.
- **Contract:** `wrap_scaffold.py VAULT --session N [--play-date D] [--in-game-date S] [--write]`
  → resolves chapter/session index/play-notes file, renders the template with frontmatter
  filled, writes the file and the index link. Dry-run by default.
- **Goes wrong today:** padding errors (`Chapter_3_…`), the `session_number` scalar omitted
  while `session:` wiki-link is present (SKILL.md:33-34 has to say "**and**" in bold because
  this is a known miss), `reconciled: null` forgotten, `<!-- /gm-only -->` closer dropped.
  Costs one full template Read (~1.3 KB) plus a Write of hand-assembled YAML every session.
- **Size:** M. **New script** — but its frontmatter resolution overlaps `session_context.py`'s
  chapter-scoping logic; import that rather than re-derive.

### B2 — Wrap-Up conformance validation (highest value)
- **Cite:** `session-wrapup/SKILL.md:463-493` (Handoff Contract table);
  `shared/templates/session-wrap.md:18-129`; `shared/reconcile.md:223-250`; and the whole of
  `campaign-qa/references/checks/wrapup-conformance.md:16-141`
- **Prose asks:** verify required sections exist, optional sections are omitted-not-empty,
  player-facing H2s are **exactly** `## Narrative Recap` + `## Memorable Moments`, every other
  H2 is `###` under `## GM Notes`, exactly one `<!-- gm-only -->` pair fencing the GM block,
  `### Reconciliation Context` absent until reconcile runs, filename matches the pattern,
  and ~10 frontmatter field/format rules.
- **Contract:** `vault_check.py VAULT wrapup [--file REL]` → `LEVEL<TAB>path<TAB>message`
  rows in the existing format. ERROR: heading outside the fence / unfenced Keeper H2 /
  missing required section. WARNING: filename drift, structure drift inside a valid fence.
  INFO: heading-name variants, section-order drift.
- **Goes wrong today:** the single-fence invariant has already been broken often enough to
  justify a 146-line repair check plus a 30-line rationale in `reconcile.md:237-250` — a
  Keeper section landing as a sibling H2 **publishes to the player site**. That is a
  correctness bug with a real-world blast radius, currently prevented only by prose.
  Vault-wide, the QA check is O(files) model reads of whole wrap-up files.
- **Size:** M (~250–350). **Extend `vault_check.py`** — it already has `vault_files`,
  `extract_frontmatter`, `iter_body_lines` (line 356, frontmatter-safe body scanning), the
  `emit`/level convention, and `parse_session_number`/`chapter_key`. Adding a `wrapup`
  command retires the mechanical half of the campaign-qa check as a bonus.

### B3 — Campaign Overview mechanical field update
- **Cite:** `session-wrapup/SKILL.md:361-393`
- **Prose asks:** a six-row table of pure Overwrite/Increment operations, a fixed
  old→new confirmation prompt, and an explicit do-not-touch list (`current_arc`,
  `chapters_planned`, `status`, body sections).
- **Contract:** `stamp_entities.py VAULT _Campaign/"Campaign Overview.md" --session N
  --date D --set current_game_date=… --increment sessions_played --set last_session=…`
  → prints the exact old→new diff (which *is* the confirmation prompt), `--write` applies.
- **Goes wrong today:** `sessions_played` increment done by eye; the forbidden fields are
  one careless whole-frontmatter rewrite away from being clobbered — and the prose has to
  spend lines 391-393 forbidding it, which means it has happened.
- **Size:** S. **Extend `stamp_entities.py`** with generic `--set`/`--increment`.

### B4 — Session index status/field transitions
- **Cite:** `session-wrapup/SKILL.md:57-60, 491-493`; `shared/reconcile.md:46, 149, 189-190`
- **Prose asks:** set `status: wrap-up` → later `reviewed`; set `play_date`/`in_game_date`
  (with an explicit warning not to write `planned_date`/`actual_date`); set
  `documents.wrap_up`; set `world_evolved: "Session_NN"`.
- **Contract:** same `stamp_entities.py --set` extension as B3.
- **Goes wrong today:** wrong field names (the prose warns about exactly this at :57-60),
  the `reviewed` promotion silently skipped when the GM defers, `world_evolved` forgotten
  so 6.5 re-offers next time.
- **Size:** S (free once B3 lands). **Extend `stamp_entities.py`.**

### B5 — Reconcile promotion bookkeeping
- **Cite:** `shared/reconcile.md:42-47` (fast path) and `:144-162` (step 6)
- **Prose asks:** on approval — stamp wrap-up `canon_status: AUTHORITATIVE` +
  `reconciled: "YYYY-MM-DD"`, session index `status: reviewed`, promote every named entity
  DRAFT→AUTHORITATIVE, mark contradicted content `SUPERSEDED` with `superseded_by`.
  `:164` says "Do the bookkeeping immediately — don't leave a list for the GM."
- **Contract:** `stamp_entities.py VAULT FILE... --promote --reconciled YYYY-MM-DD`
  and `--supersede-by "[[Winner]]"` → dry-run plan, `--write` applies.
- **Goes wrong today:** N files × (Read + Edit) per reconcile, with partial application when
  the conversation is interrupted — the vault ends up half-promoted with no record of where
  it stopped. `reconciled:` stamped without `canon_status` moving (or vice versa) is exactly
  the "unreconciled promotion" drift the QA check hunts for
  (`wrapup-conformance.md:58-62`).
- **Size:** S. **Extend `stamp_entities.py`** (it already refuses malformed frontmatter and
  preserves bytes — the right guarantees for this).

### B6 — Character story append protocol
- **Cite:** `session-wrapup/SKILL.md:139-149`; `shared/character-story-format.md:68-73`;
  `shared/templates/character-story.md:1-9`
- **Prose asks:** locate `Characters/PCs/{Name}_Story.md` by naming convention, create from
  template if absent, append `## Session {N} — {Title}` **at the bottom**, never edit prior
  entries, update `lastUpdated`/`asOfSession`, mirror the wrap-up's `canon_status`.
- **Contract:** `story_append.py VAULT --pc NAME --session N --title T --body-file F
  [--write]` → creates-or-appends, stamps frontmatter, **refuses if a heading for that
  session already exists** (the idempotence guard prose cannot enforce).
- **Goes wrong today:** re-running wrap-up duplicates the entry; "append at the bottom" is
  fragile when the model has the file in context and rewrites it wholesale (append-only is
  stated three times across two files — a sign it gets violated). The prose generation stays
  with the model; only the placement and stamping move.
- **Size:** S. New script; shares the frontmatter writer with `stamp_entities.py`.

### B7 — Timeline entry format + `in_game_date` validation
- **Cite:** `session-wrapup/SKILL.md:322-327` (two fixed line formats) and `:336-344`
  (date-format rules)
- **Prose asks:** emit `- **{date}** — [[Event]] — {summary}` or `- **{date}** —
  {description}`; keep time-of-day out of `in_game_date` (`"Evening, 11 August 1814"` and
  `"Midnight–dawn, August 7–8, 1814"` are named as failures); accept a non-Earth calendar
  as-is; require a 4-digit year for auto-sort.
- **Contract:** add a `dates` rule set to `vault_check.py frontmatter` (regex: leading
  time-of-day token, 4-digit-year presence, `play_date` ISO) plus
  `timeline_append.py VAULT --date D --event "[[X]]" --summary "…"` for the write side.
- **Goes wrong today:** the published timeline silently fails to sort the entry — a
  *silent* failure the GM discovers on the site, not in the vault. Note `vault_check.py
  timeline` (source line 419) is **only** a multi-day-plan cue; it does not check date
  format, so this is not a duplicate.
- **Size:** S. **Extend `vault_check.py frontmatter`** (validation) + tiny new writer.

### B8 — Active-PC set exposure
- **Cite:** `session-wrapup/SKILL.md:139, 166-177` ("each PC **active in this session**…
  excludes `dead` PCs")
- **Prose asks:** determine the active roster, three times, in three steps (3, 3b, 3c).
- **Contract:** `vault_check.py VAULT active-pcs` → one PC path per line.
- **Note:** `vault_check.py:442 active_pc_names()` **already implements this** (type `pc`,
  not `*_Story.md`, status not in dead/retired/inactive) but only serves `read-aloud`
  internally. Exposing it is a one-line `choices` addition. Off-screen-this-session
  exclusion stays with the model.
- **Size:** XS. **Extend `vault_check.py`.**

### B9 — Legacy canon-key repair algorithm
- **Cite:** `shared/canon-status.md:38-57`
- **Prose asks:** the file literally calls itself "the single authoritative repair
  algorithm" and gives three exhaustive numbered cases plus a post-condition ("the file must
  contain exactly one `canon_status:` line"). Cases 1 and 2 are mechanical; case 3
  (values disagree) needs the GM.
- **Contract:** `vault_check.py VAULT canon-keys [--fix]` → detection rows today, case-1/2
  repair under `--fix`, case-3 files surfaced with both values.
- **Goes wrong today:** the prose has to spend a bolded paragraph on "never blind-rename a
  key" because a blind rename produces duplicate `canon_status:` lines and YAML silently
  keeps one — a status flip with no error. That is precisely the class of bug a script
  removes permanently.
- **Size:** S. **Extend `vault_check.py`** (detection half already exists via
  `DEPRECATED_FIELDS`).

### B10 — `_inbox/` processed-file archival
- **Cite:** `vault-ingest/SKILL.md:33-36, 74` (Gotcha 5)
- **Prose asks:** move processed source files to `_inbox/_processed/` with a date stamp,
  never delete.
- **Contract:** `ingest_survey.py VAULT --archive FILE...` (or a verb on the image script)
  → date-stamped move, refuses delete.
- **Goes wrong today:** skipped entirely when the conversation runs long; the audit trail
  the gotcha calls "legal proof of ownership" quietly doesn't happen.
- **Size:** XS.

### B11 — Play Notes / Reconstruction Note template instantiation
- **Cite:** `vault-ingest/references/synthesis-templates.md:14-66, 74-84`
- **Prose asks:** render a fixed frontmatter block, a fixed section skeleton, and a
  Reconstruction Note whose fields are all counts the pipeline already holds (N sources,
  N gaps filled, N unresolved). The `## Source Material Index` table (`:61-65`) is a
  direct render of the Phase 1 manifest.
- **Contract:** `ingest_synthesize.py --manifest M --events E --out FILE` → skeleton +
  Reconstruction Note + Source Material Index; the model fills the prose sections.
- **Size:** S — and free if C4's manifest is machine-readable JSON/TSV.

### B12 — World-evolution filing stamps and thread staleness counters
- **Cite:** `ttrpg-expert/world-evolution.md:106-118, 141-142` (stamps) and `:57-60`
  ("dormant 3+ sessions", "Chekhov elements … overdue (5+ sessions unfired)")
- **Prose asks:** set `source: "world-evolution"`, `createdSession`, `lastUpdated`,
  `asOfSession` on every created/changed entity; set `world_evolved` on the session index;
  and count sessions-since-touched for every thread entity by eye.
- **Contract:** stamps → `stamp_entities.py --set source=world-evolution` (B3's extension);
  staleness → `vault_check.py VAULT threads` reusing `check_stale_drafts`'s per-chapter
  session arithmetic (vault_check.py:285-338), which already solved the
  "numbering restarts per chapter" trap (#162) that a hand count would fall into.
- **Size:** S each. **Extend both existing scripts.**

### B13 — Reconcile quick-scan conditions 1 and 3
- **Cite:** `shared/reconcile.md:25-50`
- **Prose asks:** count `<!-- UNVERIFIED -->` markers in the wrap-up (condition 1); check
  whether a Plan file exists for this session (condition 3). Condition 2 is judgment (see D).
- **Contract:** folded into C5's `reconcile_scan.py`.
- **Size:** included in C5.

### B14 — `### Reconciliation Context` placement
- **Cite:** `shared/reconcile.md:203-250`
- **Prose asks:** write a `###` subsection under `## GM Notes`; if no `## GM Notes`, create
  one wrapped in its own `<!-- gm-only -->` fence; if fenced, insert **before** the
  `<!-- /gm-only -->` closer, never after.
- **Contract:** `gm_notes_insert.py FILE --heading "Reconciliation Context" --body-file F`
  → inserts inside the fence, creating heading+fence if absent; exits non-zero rather than
  guessing on a malformed fence.
- **Goes wrong today:** 47 lines of prose (`:223-250`) exist to explain one insertion point,
  including a paragraph on why not to "fix" it by editing the exclude list. The failure mode
  is a Keeper section published to players. The *content* is judgment; the *placement* is
  not, and only the placement is dangerous.
- **Size:** S. New script, or a `--insert-under-gm-notes` mode on B1's writer.

---

## C. HYBRID

### C1 — Image ingestion (largest single win)
- **Cite:** the whole of `vault-ingest/references/image-handling.md:1-162`, invoked at
  `vault-ingest/SKILL.md:94-99` and `:141-146`
- **Prose asks:** classify by extension against two named lists (`:8-12`); convert
  non-web-safe via `sips` then `magick` with a fixed fallback message (`:15-28`); slugify by
  a precisely-stated three-step rule (`:30-48`) with a one-segment suffix strip; file into a
  destination subfolder from a six-row entity-type table (`:58-66`); rename to the slug
  (`:70-72`); duplicate-detect by name then size+content, with a `-2` suffix on "keep both"
  (`:76-97`); set `portrait` when there is a single or unsuffixed match, embed the rest via
  `![[…]]`, defer when all are suffixed, never overwrite an existing portrait (`:101-129`).
- **Script emits:** a plan — per image: detected format, conversion action, slug, matched
  entity (with which of the three matching rules hit), destination path, duplicate verdict,
  and a proposed `portrait` vs body-embed disposition. Plus the **unmatched list** and the
  **portrait-ambiguous list** for the Phase 4 interview. `--execute` applies conversions,
  copies, renames, frontmatter `portrait:` writes and body embeds.
- **Stays with the model/GM:** which entity an unmatched image belongs to; which of several
  suffixed images is the portrait; the replace/keep-both/skip decision on a name collision.
- **Goes wrong today:** literally every step. A file-by-file model execution of a
  162-line spec across a folder of images is slow, expensive (each image inspected), and
  drifts — slug collapsing rules get approximated, the "don't overwrite an existing
  portrait" guard gets forgotten, byte-identical duplicates get re-copied.
- **Size:** M (~250–350). **Do not write from scratch:** `tools/mobrpg` already ships an
  `images` command that matches by name, files into `_attachments/`, and sets `portrait:`
  (`tools/mobrpg/llms.txt`, "Writes locally, never to mobRPG" tier). Extract that matcher
  into `skills/shared/scripts/` and have both call it, or this becomes the third
  implementation of slug-matching in the repo.

### C2 — Source classification (Phase 1)
- **Cite:** `vault-ingest/SKILL.md:84-105`; `references/classification-taxonomy.md:8-41`
- **Prose asks:** "Read all source material" and assign one of nine classifications per
  document *or section*, using named lexical indicators.
- **Script emits:** a manifest row per file: path, size, mtime, extension class, parsed
  frontmatter `type`, and **per-indicator hit counts with line numbers** — play indicators
  (dice-roll patterns `rolled a \d+`, `failed her …`, SAN/HP deltas, combat rounds),
  prep indicators (`If the investigators`, `The GM should`, `At this point`), research
  indicators (Q&A shape, `What would happen if`), plus a tense-shift ratio for the
  mixed-document case (`taxonomy:59-62`) — and a proposed classification with a confidence.
- **Stays with the model:** confirming/overriding the proposal, and section-level splitting
  of genuinely mixed documents.
- **Goes wrong today:** this is the **single most expensive step in the skill** — unbounded
  full reads of an arbitrary pile of files into context, before any filtering. A scorer turns
  it into "read the ~20% the script flags as ambiguous."
- **Size:** M. New script (`ingest_survey.py`).
- **How much is decidable from metadata alone (asked explicitly):** the *Image/map* row is
  100% extension-decidable — `taxonomy:16` enumerates the extensions. *Spreadsheet/data* is
  extension-decidable (csv/xls/xlsx). *Session wrap-up* is frontmatter-decidable —
  `taxonomy:18` names `type: session_wrap`. That is **three of nine rows, ~100% confident,
  with zero file reading**. The other six (transcript / fragment / prep / research /
  recollection / character sheet) need content, but all six are distinguished by literal
  string patterns the taxonomy already lists — so they are high-confidence *scoreable*, not
  metadata-decidable. Realistic split: ~30–40% of a typical pile classified without a model
  read, the rest pre-scored with evidence lines attached.

### C3 — Bucketing (Phase 2)
- **Cite:** `vault-ingest/SKILL.md:106-124`
- **Prose asks:** group items by chapter/session/period using explicit references, timeline
  references, NPC/location clustering, and GM context.
- **Script emits:** per file — every `Session \d+` / `Chapter \d+` mention with line number,
  every date-shaped string, mtime, and an entity-name co-occurrence histogram against
  existing vault entity names (reuse `graph_check.py`'s name resolution). Plus a proposed
  chronological ordering.
- **Stays with the model/GM:** assigning the ambiguous ("unsorted" bucket, resolved at
  Phase 4 start), and the certainty level per bucket.
- **Size:** S as an addition to C2's script.

### C4 — World fact detection and deduplication
- **Cite:** `session-wrapup/SKILL.md:395-415`; `references/world-fact-detection.md:36-47`
- **Prose asks:** step 1 detect (heuristic table, signal-vs-noise judgment); step 2
  **deduplicate** against `_World/_flags.md` (ignored→suppress, deferred→increment, canon→
  suppress), `_World/` domain files, and existing entity files; step 3 stage survivors.
- **Script emits:** given a candidate list from the model, a per-candidate verdict —
  suppressed (with which source suppressed it), incremented (with the new mention count and
  whether the 3-session threshold at `world-fact-detection.md:42-44` is now met), or stage —
  and writes the incremented deferred entries back to `_flags.md`.
- **Stays with the model:** detection itself (`world-fact-detection.md:8-34` is genuinely a
  signal/noise reading task) and the domain tagging.
- **Goes wrong today:** the 3-mention threshold requires a running count the model
  reconstructs from prose each session; a missed suppression re-surfaces a topic the GM
  already said "ignore" to, which is the exact behaviour the flags file exists to prevent.
- **Blocker to note:** `shared/templates/world-flags.md` is three bare H2s
  (`## Canon` / `## Ignored` / `## Deferred`) with **no specified entry format**, and
  `campaign-organizer/references/world-validation.md:56-57` doesn't pin one either.
  Mechanizing this requires first fixing the entry format — do that as a prerequisite, not
  as a side effect.
- **Size:** S–M. New script (`world_flags.py`).

### C5 — Reconcile scan / step-2 inventory
- **Cite:** `shared/reconcile.md:25-50` (quick scan) and `:53-68` (steps 1–2)
- **Prose asks:** read the wrap-up and every related entity, then surface UNVERIFIED
  markers, `> [!info] Reconstruction Note` blocks, DRAFT entities created during wrap-up,
  timeline entries with uncertain dates, and any `canon_status: DRAFT` tied to this session.
- **Script emits:** `reconcile_scan.py VAULT --session N` → the three quick-scan booleans
  (with condition 2 reported as "candidates" not a verdict), plus the step-2 inventory:
  UNVERIFIED marker text with line numbers, Reconstruction Note presence, and the
  DRAFT-entities-touched-this-session list (this last one is `vault_check.py changed
  --since N` intersected with `canon_status: DRAFT` — reuse, don't rewrite).
- **Stays with the model:** quick-scan condition 2 ("DRAFT entities that contradict existing
  AUTHORITATIVE entities on the same facts") — semantic contradiction, genuinely D.
- **Goes wrong today:** step 1 says "Read the Wrap-Up file. Read related entity files,
  timeline entries, and any linked scene notes" — an unbounded read to produce a bounded
  inventory. Missing an UNVERIFIED marker promotes unverified content to canon, which is the
  one thing the marker exists to block (`session-wrapup/SKILL.md:289-293`).
- **Size:** M. Mostly composition over `vault_check.py`.

### C6 — Spoiler reveal check
- **Cite:** `shared/reconcile.md:109-128`
- **Prose asks:** for every entity the wrap-up touched, find open `<!-- spoiler -->` blocks,
  quote the first ~10 words, ask y/n, and on yes remove **both** markers leaving the content.
- **Script emits:** `spoilers.py VAULT list --files F...` → one row per block:
  file, line range, first 10 words. `spoilers.py reveal --file F --block N` → removes the
  marker pair only.
- **Stays with the GM:** the y/n.
- **Goes wrong today:** finding and quoting is a full read of every touched entity; the
  removal is a two-marker edit where deleting one and not the other leaves a permanently
  unclosed block that swallows everything after it in the published output.
- **Size:** S.

### C7 — Cross-entity claim / name-conflict tracking
- **Cite:** `session-wrapup/SKILL.md:279-293` and `:246-252`
- **Prose asks:** surface asides that assert facts about *other* entities; record confirmed
  ones in the target file and unconfirmed ones in the Wrap-Up's `### Cross-Entity Claims`
  with an `<!-- UNVERIFIED: {claim} -->` marker; log export-vs-vault name corrections in a
  three-column table.
- **Script emits:** for the *table* half only — given a list of applied corrections, render
  the `Export said | Vault canon | Applied` rows; and validate that every claim marked HELD
  carries a matching `UNVERIFIED` marker (the invariant reconcile depends on at `:29-31`).
- **Stays with the model:** identifying the cross-entity claim in the first place — pure
  reading comprehension.
- **Size:** XS as a rule inside B2's `wrapup` check (marker/disposition consistency).

---

## D. JUDGMENT — leave with the model

- **Narrative Recap** (`SKILL.md:90-120`) and its tone calibration (`recap-formats.md:25-71`).
- **PC Carry-Forward** (`SKILL.md:122-131`) — inferring player intent from behaviour.
- **Character story prose** (`SKILL.md:133-164`, `character-story-format.md:39-64`).
- **`## Current Status` reconciliation** (`SKILL.md:204-216`) — carry/add/remove/refresh
  requires knowing which threads the session actually resolved. Note the *format* is
  specified (`shared/pc-body-structure.md`), so a validator could check field presence, but
  the content is judgment.
- **Event decomposition threshold** (`SKILL.md:328-334`) — "≥2 of four criteria" looks
  countable but each criterion ("creates forward consequences") is a reading call.
- **Relationship verb → predicate mapping** (`SKILL.md:295-306`) — the *validation* is
  scripted (A); choosing the nearest sanctioned predicate is not. The inverse normalization
  (`owned_by A→B` ⇒ `owns B→A`) *is* a table lookup and could be a `--fix` suggestion.
- **World fact signal-vs-noise** (`world-fact-detection.md:19-34`).
- **The entire keeper interview** (`keeper-interview.md:1-139`) — this is the skill's stated
  exclusive value and should never be scripted. The one exception is the certainty→marker
  mapping table (`:63-68`), whose *application* (writing `<!-- UNVERIFIED: … -->`) is
  mechanical once the GM's answer is classified.
- **Faction turns, consequence surfacing, foreshadowing** (`world-evolution.md:52-104,
  144-164`) — generative by design; `:22-34` explicitly demands surprise.
- **Conflict adjudication** (`reconcile.md:98-107`; `canon-management.md:75-161`) — the
  repo's stated first principle is "AI detects, humans resolve" (`canon-management.md:12-15`).
- **Block/seam test** (`content-fidelity.md:34-46`) — "is this already written to be read, or
  is it raw material?" is the definitional judgment call.
- **Salvageable prep triage** (`reconcile.md:130-142`) — drop/recycle/must-still-happen is
  the GM's.

---

## Flag 1 — Redundancy: prose telling the model to do what a script already does

These are live drift risks: the prose path and the script path can diverge, and the model
will follow whichever it reads first.

1. **`vault-ingest/SKILL.md:196-202` — "Self-check after each entity"** (worst offender).
   Six numbered steps: re-read the file, compare frontmatter against the template, verify
   `type`, verify `canon_status`, verify required fields. Steps 1–3 are **exactly**
   `vault_check.py frontmatter`, which Gotcha 6 at `:75` — 120 lines earlier in the same
   file — already instructs. The skill tells the model to do the deterministic check twice,
   once expensively. *Fix:* delete steps 1–3, keep steps 4–5 (wiki-link format, date format)
   and move both into `vault_check.py frontmatter` per B7.
2. **`vault-ingest/SKILL.md:225-230` — Post-Ingestion cross-reference pass.** Four bullets:
   "Deduplicate entities across buckets" (= `vault_check.py names`), "Identify relationship
   chains" (= `graph_check.py`), "Check timeline consistency" (= `vault_check.py timeline`),
   "Validate entity status progression" (= `vault_check.py stale-drafts`). **None of the four
   names its script.** *Fix:* replace the four bullets with the four commands.
3. **`session-wrapup/SKILL.md:295-306` — relationship edges.** Says "every `type:` must come
   from the controlled vocabulary" and points at a normalization table, without mentioning
   that `vault_check.py relationships` mechanically checks precisely this. *Fix:* add the
   command to the validation loop at `:346-350`.
4. **`ttrpg-expert/canon-management.md:113-129, 162-206`** — a JSON conflict-record schema
   and ~40 lines of **Go code** (`FindSimilarEntities`, `CreateConflict`) describing a
   conflict store that **does not exist in this repository**. The model reads it every time
   the file is loaded and can act on none of it; the duplicate-detection it describes is
   already `vault_check.py names`. *Fix:* cut the Go and the JSON, or move them to a design
   doc outside the skill payload. This is pure token cost with a hallucination surface
   attached (a model may "call" a workflow that isn't there).
5. **`session-wrapup/SKILL.md:139` vs `:166-177` vs `:122`** — the active-PC set is
   re-derived three times in three steps; `vault_check.py:442` already computes it. See B8.

---

## Flag 2 — reconcile.md: bookkeeping vs judgment

Line-budget split of the 273-line procedure:

| Portion | Lines | Class |
|---|---|---|
| Quick scan conditions 1 & 3 | 29-31, 33-35 | B (counting / file existence) |
| Quick scan condition 2 | 32 | D (semantic contradiction) |
| Fast-path writes | 42-47 | **B — four field writes across N files** |
| Step 1 load | 53-57 | C (unbounded read → bounded inventory) |
| Step 2 inventory | 59-68 | C (grep-able; presentation is model's) |
| Step 2.5 world facts | 70-96 | C — dedup is B (see C4), three-state prompt is GM |
| Step 3 conflicts | 98-107 | **D — the core of the procedure** |
| Step 3.5 spoilers | 109-128 | C — find/quote/remove is B, y/n is GM |
| Step 5 prep triage | 130-142 | D |
| Step 6 promotion | 144-162 | **B — pure field writes on a GM-approved list** |
| Step 6 3b world-rule check | 152-160 | D |
| Step 6.5 gate | 168-174 | B (a `world_evolved` field check + "is this latest") |
| Step 6.5 body | 176-201 | D (delegates to world-evolution) |
| Step 7 content | 203-221 | D |
| Step 7 placement | 223-250 | **B — a hard structural rule with a known failure mode** |

**Verdict:** roughly **40% bookkeeping, 45% judgment, 15% presentation glue.** The judgment
is genuinely irreducible and correctly placed — conflict walkthrough, prep triage, world-rule
exceptions, and the "one at a time, never silently resolve" rules at `:252-260` are the
procedure's whole point. But **every write in the file is deterministic given a GM decision**.
Extracting the writes (B5 + B14, both `stamp_entities.py` extensions plus one small inserter)
would leave reconcile as a pure conversation script, which is what its own Rules section
says it is. The current design makes the model do a conversation *and* N×(Read+Edit) cycles
interleaved — the mode most likely to leave a vault half-written when the session ends.

---

## Flag 3 — vault-ingest classification: what's decidable from metadata alone

Answered in detail in C2. Summary:

- **Fully decidable, zero reads:** Image/map (extension list is enumerated verbatim at
  `classification-taxonomy.md:16`), Spreadsheet/data (extension), Session wrap-up
  (frontmatter `type: session_wrap`, stated at `:18`). Add: anything already inside the vault
  with valid gm-apprentice frontmatter classifies itself.
- **Not metadata-decidable but strongly scoreable:** the remaining six rows are separated by
  *literal string patterns the taxonomy already lists* — dice-roll results, `If the
  investigators`, `The GM should`, first-person past tense, attribute/skill/equipment block
  shapes. A scorer emitting hit counts + line numbers per indicator class gives the model
  evidence instead of raw text.
- **Not mechanizable:** mixed documents needing section-level splitting (`:43-62`) and the
  name-variant reconciliation at `:63-75` (though the *candidate* variants are exactly what
  `vault_check.py names` computes — reuse it against the incoming batch).
- **Practical outcome:** roughly a third of a typical pile classified without a model read,
  and the rest read with a pre-computed evidence summary attached — turning Phase 1 from
  "read everything" into "adjudicate the ambiguous."

---

## Recommended build order

| # | Item | Script | Size | Why first |
|---|---|---|---|---|
| 1 | B3+B4+B5+B12 stamps | extend `stamp_entities.py` | S | One extension retires four hand-bookkeeping procedures; lowest risk, highest frequency. |
| 2 | B2 wrap-up conformance | extend `vault_check.py` | M | Prevents player-visible publish leaks; also retires half a campaign-qa check. |
| 3 | C1 image ingestion | new, reusing mobrpg's matcher | M | Largest fully-specified spec with zero implementation. |
| 4 | C2+C3 ingest survey | new `ingest_survey.py` | M | Biggest token reduction in the repo (unbounded → bounded reads). |
| 5 | B8, B9, B7 | extend `vault_check.py` | S/XS | Cheap; B8 is a one-line `choices` change over existing code. |
| 6 | B14 + C6 | small new writers | S | Structural invariants with known past failures. |
| 7 | B1, B6, B11 | new writers | S/M | Template instantiation; do after the validators so they can self-check. |
| 8 | C4 world flags | new `world_flags.py` | S–M | **Blocked** on pinning the `_flags.md` entry format first. |
| 9 | Redundancy cleanup (Flag 1) | prose edits only | XS | Free; do it alongside whichever script it points at. |

**Overlap discipline:** of 21 B/C items, **12 should extend `vault_check.py` or
`stamp_entities.py` rather than become new scripts.** Only four genuinely new scripts are
warranted: `ingest_images.py` (or a shared matcher extracted from `tools/mobrpg`),
`ingest_survey.py`, `reconcile_scan.py`, and one small `gm_notes_insert.py`/`story_append.py`
writer pair that can share a frontmatter-writing module with `stamp_entities.py`.
