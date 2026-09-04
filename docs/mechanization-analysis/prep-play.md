# Mechanization audit — session-prep, session-play, and their shared refs

Scope: `skills/session-prep/SKILL.md`, `skills/session-prep/references/session-templates.md`,
`skills/session-play/SKILL.md`, `skills/shared/session-principles.md`,
`skills/shared/session-document-chain.md`, `skills/shared/pc-body-structure.md`,
`skills/shared/templates/{plan,campaign-overview,world-flags}.md`,
`skills/ttrpg-expert/{scenario-writing,continuity-engine}.md`.
All line citations verified against the files as of this pass.

---

## 0. Baseline — what is already mechanized

| Script | Covers |
|---|---|
| `session_context.py` | prep read-set bundle: just-played session + **its `status:`**, wrap-up body, active PC `## Current Status` blocks, upcoming Plan body, `_flags.md` Deferred, campaign overview; ambiguity `Note:` lines |
| `vault_check.py` | `frontmatter` (required fields/enums/legacy/unquoted links), `names`, `index` drift, `stale-drafts`, `changed --since N`, `tables` (aliased/escaped pipe in table cells), `timeline` (multi-day plan lacking `## Timeline`), `read-aloud` (PC name / 2nd-person feeling verb / 3rd-person pronoun in `> ` lines of `session-plan`+`scene`), `relationships` (predicate vocabulary) |
| `graph_check.py` | orphans, unresolved links, dead ends, backlinks, ambiguous |
| `vault_search.py` | BM25 prose search |
| `stamp_entities.py` | batch `asOfSession`/`lastUpdated`/chapter-retag |
| `gurps_check.py` / `gurps_calc.py` | GURPS sheet arithmetic (lift, enc, defenses, points, skills, damage) |
| `schema_rules.py` | shared enums + frontmatter parser (`SCENE_TYPES`, `PLAN_TYPES`, `SESSION_STATUS`, required fields) |
| `scripts/validate_schema.py` (dev-side) | `leads_to` **shape** only (`tests/test_plan_leads_to.py`); no runtime traversal |

Routing table: `skills/shared/vault-access.md:11-21`.

---

## 1. session-prep/SKILL.md

### A — already scripted

- **`SKILL.md:61-66`** Context Source → `session_context.py`. Correct.
- **`SKILL.md:373-390`** tables / multi-day timeline / read-aloud checks → `vault_check.py`. Correct.

### B — mechanizable

**B1. Version check — `SKILL.md:23-31`** (identical block at `session-play/SKILL.md:20-28`, plus 6 more skills: campaign-organizer, campaign-qa, publish-site, session-wrapup, the-midwife, vault-ingest).
Prose: read `gm_apprentice_version` from `_meta/vault-config.md`, read `current_version` from `shared/migrations.md` (limit 10), compare, announce mismatch, skip if `_meta/` absent.
Contract: `version_check.py <vault>` → exit 0 + `OK vault=1.9.5 current=1.9.5`, or `MISMATCH vault=1.8.7 current=1.9.5 → migration-procedure.md`, or `SETUP no _meta/`.
Today: two Read calls × 8 skills × every first invocation; version comparison is string-compare-by-eyeball, so `1.8.10 < 1.8.9` is a live failure mode. Size **S**. New file (too small to bolt onto vault_check, but a candidate for `vault_check.py version` if you want zero new entry points — note the ~90-token-per-read threshold in CLAUDE.md cuts the other way here since the reads it replaces are two, not one).

**B2. Phase 1 gate — `SKILL.md:99-100`** ("Runs when most recent session has status `wrap-up` (not yet `reviewed`)").
The value is *already in* `session_context.py`'s header (`status: {...}`, printed at `session_context.py:216-218`) but the prose never says so, so the model re-derives it by reading the session index. Fix is one prose line, not a script — **A, mis-documented**. See §5.

**B3. `leads_to` node traversal — `SKILL.md:120-124`.**
Prose: from the `type: plan` entity the last session resolved, read `leads_to` for the next node(s); 2+ targets = a branch to surface.
Contract: `graph_check.py <vault> leads-to "[[Node]]"` (or `plan-graph`) → next node(s), branch flag, unresolved `leads_to` targets, plan nodes nothing leads to (orphan design), cycles.
Today: the model must find the resolving plan node by hand (nothing records which node a session resolved), read frontmatter across `Planning/`, and follow links manually; unresolved targets pass silently. Size **M**. **Extend `graph_check.py`** — it already owns wikilink resolution incl. aliases/case/underscore variants; re-implementing that in a new file is the drift risk.

**B4. World-flag traction counting — `SKILL.md:162-180`.**
Prose: read `_World/_flags.md` Deferred, surface items "Referenced in 3+ distinct sessions" or "3+ mentions within a single session".
Contract: `vault_check.py <vault> flags` (or `world_flags.py <vault> traction`) → per Deferred item: distinct-session count, max in-session count, the session paths, and a `TRACTION`/`quiet` verdict.
Today: to do this honestly the model must read every session file and count string occurrences. It does not; it estimates. The "3 times across sessions 3-5" in the example output at `SKILL.md:169` is exactly the kind of number that gets invented. Size **S–M**. Extends `vault_check.py` (it already walks the vault once and owns `iter_body_lines`).

**B5. Narrative-plan discovery — `SKILL.md:186-240`** (and duplicated in prose at `session-play/SKILL.md:99`).
Prose: enumerate `Chapters/{chapter}/Planning/`, categorize by `plan_type`; then resolve `_midwife/index.md` manifest → exactly one adventure dir or ask; read `_midwife/{adventure}/index.md`; discover by **path not frontmatter** (midwife files have no `---`); read each file's H1/`##` headings to summarize; `timeline.md` first if present.
Contract: `plans_index.py <vault> --chapter "Chapter 3"` → two sections: (a) `Planning/` entities grouped by `plan_type` with `participants`/`locations`; (b) midwife manifest rows (adventure, status, dir, file count), the resolved adventure or an `AMBIGUOUS` line listing candidates, per-file H1 + `##` headings, `timeline.md` hoisted first.
Today: a 55-file tree (the example at `SKILL.md:248`) read one file at a time for headings; the ambiguity rule at `SKILL.md:211-216` is a judgment the model is told to make from a manifest it may not have opened; and `SKILL.md:263-267` documents the exact failure — a "no plans exist" claim written while the design sat in an unopened directory. Size **M**. New file; serves prep step 10c *and* session-play's routing row.

**B6. Preamble + scene word budgets — `SKILL.md:391-399`, `session-templates.md:90-98`, `scenario-writing.md:173-178`.**
Prose: preamble sections (Previously On, Active Threads, NPC Quick Reference, World State) ≤ ~1,000 words combined; recap ≤150; scene over ~1,200 words → sanity-check.
Contract: part of `plan_check.py` (B8) → `WARN <plan>:§Previously On 214 words (cap 150)`, `INFO §Planned Scenes/Scene 2 1,480 words — confirm load-bearing`.
Today: the model is asked to word-count prose it just wrote. It cannot count words reliably and does not try; the budget is decorative. Size **S** as a function inside B8.

**B7. Hard Guard enforcement — `SKILL.md:418-431`.**
Prose: in a headless run, `## Session Intent`, spotlight and `## Planned Scenes` must appear **only** under `## Open Questions`, each line labelled `(apprentice guess — confirm)`.
Contract: `plan_check.py <plan.md> --headless` → ERROR if any of those three H2s has non-placeholder content, ERROR for any line under `## Open Questions` in a headless-produced plan lacking the label.
Today: nothing verifies it. `SKILL.md:431` says "this is what makes the guided flow real rather than cosmetic" — with no check it is cosmetic. Size **S** inside B8.

**B8. Plan conformance (umbrella) — new `plan_check.py`.** See §6 for the full rule inventory it should carry.

### C — hybrid

**C1. Existing-prep review — `SKILL.md:114-118`** ("read it and determine what's already covered. Flag what needs updating vs what can stand").
Script emits: per canonical H2, present / absent / empty / still-template-placeholder (`[Narrative recap from session-wrapup...]`), word count, and `<!-- prep-state: ... -->` if present.
Model keeps: whether present content is *stale* given what Reconcile found. Size **S** inside B8. Note `session_context.py:284-287` already dumps the whole plan body; a section inventory is the cheaper form of the same answer for this step.

**C2. Stale-thread detection — `SKILL.md:143-150`**, spec at `continuity-engine.md:128-133` and `continuity-engine.md:135-143`.
Prose: fold each active PC's `Open threads` in, flag threads with 3+ sessions without advancement. `continuity-engine.md:141-143` states outright that the block carries no age stamp and staleness "comes from session cross-referencing" — i.e. a mechanical cross-reference the model is told to do in its head.
Script emits: `session_context.py --threads` → each Open-threads line per PC, plus wrap-up `#### Unresolved Threads` items, each with first-seen and last-seen session number (by fuzzy line match across wrap-ups) and an age in sessions.
Model keeps: whether two differently-worded lines are the same thread, and whether an old thread is dormant-by-design.
Today: ages are guessed; a thread that fell out of one carry-forward is silently dropped — the exact decay `pc-body-structure.md:77-80` exists to prevent. Size **M**. Extend `session_context.py` (it already selects the chapter/session set and parses the Current Status blocks).

**C3. Spotlight history — `SKILL.md:291-302`** ("Last spotlight level, sessions since last B-plot feature").
Script emits: per active PC, the A/B/C assignment parsed out of every prior plan's `## Spotlight Forecast` / `## Touchpoint Plan`, with session numbers and a "sessions since last B" count.
Model keeps: the arc reasoning and the seed offer at `SKILL.md:317-319`.
Today: pure counting presented as evidence for the GM's decision (`SKILL.md:322`) — invented numbers here corrupt a GM decision, which is worse than a wrong lint. Size **S–M**, inside C2's script or `plan_check.py --history`.

**C4. Planning↔thread overlap — `SKILL.md:198-201`** ("surface scene plans whose `participants` or `locations` overlap with the threads, NPCs, or locations already gathered").
Set intersection of frontmatter arrays against the gathered NPC/location names. Script emits the overlap matrix (B5's output plus the intersection); model picks what's relevant. Size **S** inside B5.

**C5. Gap Check — `SKILL.md:407-413`.** See §5 — two of its four bullets are already scripted and uncited.

**C6. Canon grounding — `SKILL.md:400-403`, `continuity-engine.md:61-77`.**
Script emits: every `[[link]]` in the plan that resolves to no file (`graph_check.py unresolved`, already exists) **plus** capitalised multi-word noun phrases in plan prose that match no vault entity name/alias — the "stated as canon but ungrounded" candidate list.
Model keeps: which candidates are real canon claims vs prose. Size **M** for the bare-name half. Extend `graph_check.py` (`ungrounded` sibling to `unresolved`).

### D — leave with the model

`SKILL.md:10-18` (stance), `276-289` (intent elicitation), `316-332` (spotlight seeds), `334-365` (scene premises, objectives, behaviours, read-aloud drafting), `446-454` (skill handoff routing).

---

## 2. session-play/SKILL.md

session-play cites **zero scripts** (`grep '\.py' skills/session-play/SKILL.md` → no matches). At the table, where token cost and latency matter most, every operation is a Read.

**P1. First-invocation plan load — `SKILL.md:16-18`.** "Read the session's Plan file if it exists" — the model must first work out which session and which chapter, then read a document that is routinely 3–8k words, to get scenes/NPCs/hooks.
Contract: `session_context.py <vault> --play` → the upcoming/current plan's `## Planned Scenes` titles + `**Type:**`/`**Objective:**` lines, `## NPC Quick Reference` table verbatim, `## World State`, `## Contingency Scenes` triggers, `## Session End Objectives`. Nothing else.
Today: whole-file read at the table, or the wrong session's plan. Size **S** (a `--play` flag reusing `section()` at `session_context.py:59-63`). **B.**

**P2. Play Notes creation + index transition — `SKILL.md:65-71`.**
Prose: create the Play Notes file with frontmatter per the chain, `created_by: session-play`; set the session index's `documents.play_notes`; advance `status` to `played`.
Contract: `session_doc.py <vault> new play-notes --session N [--write]` → instantiates from `session-templates.md:220-243`, patches the index's `documents` map and `status`, prints the path; dry-run by default, same discipline as `stamp_entities.py`.
Today: hand-written YAML mid-session plus a surgical edit to a second file — the most error-prone thing session-play does, at the worst possible moment. A half-done transition (file written, index not) is invisible until wrap-up can't find the notes. Size **M**. The same script serves session-prep's `planned → prepped` (`session-document-chain.md:173`), so it is one script for two skills. **B.**

**P3. Narrative-plan routing row — `SKILL.md:99`.** A whole paragraph of manifest-resolution procedure inlined into a lookup table cell, duplicating `session-prep/SKILL.md:202-240`. Replace with a one-line `plans_index.py` invocation (B5). **B/C**, and it removes a prose duplicate.

**P4. System arithmetic at the table.** `gurps_check.py`/`gurps_calc.py` exist and session-play never routes to them; the "Combat mechanics" row (`SKILL.md:90`) points at reference prose instead. A GM asking "what's her Dodge at Heavy?" gets a model computation where a script answer exists. Add a routing row: `gurps_check.py <sheet.md> defenses|encumbrance|damage`. **A, unrouted** — prose fix, zero code.

**P5. Relationship vocabulary — `SKILL.md:53-58`.** Enforcement is post-hoc via `vault_check.py relationships`; at play time the model is told to consult `_meta/relationship-types.md` prose. Marginal — leave as is, but note that a saved-during-play entity with an invented predicate is only caught at the next audit.

**D:** `SKILL.md:36-52` (generation), `114-139` (shorthand markers — a convention, not a procedure), `141-149` (behavior rules).

---

## 3. Shared references

### session-principles.md

- **`:15-16` "Never estimate scene durations"** — an *absolute rule*, trivially greppable (`\d+\s*[-–]\s*\d+\s*(min|minutes|hours)`, `~\d+ ?min`), with **no check**. **B, S**, inside `plan_check.py`.
- **`:18-21` "Read the PC roster first"** — covered by `session_context.py`'s Active PCs section, except the "know their player" part. Note the path drift: this says `player_characters.md`, `:81` says `_Campaign/Player Characters.md`, and the scripts key off `type: pc` entity files instead. **A, with a stale prose pointer.**
- **`:27-33` alias-form links in table cells** — **A** (`vault_check.py tables`), but the rule is restated in three places (here, `session-templates.md:111-113`, `SKILL.md:376-378`) and only one cites the script.
- **`:39-49` "The Plan is an instrument, not an audit trail"** — bans a closed set of phrases in plan content ("formally dropped", "this plan revises", "noted here only so it is a deliberate silence", "that is now wrong"). A phrase lint is exactly the shape of this rule and **no check exists**. **B, S**, inside `plan_check.py`.
- **`:98-118` session index frontmatter + status ladder** — see the document-chain item below.
- **`:150-159` Reconcile fast path** — "no UNVERIFIED markers, no DRAFT conflicts, no unplayed prep" is a three-part deterministic precondition scan (grep `UNVERIFIED` in the wrap-up; DRAFT entities touched this session — `vault_check.py changed --since N` already gives the set; `## Planned vs Played` rows with `Skipped`). **C**: script emits qualifies/doesn't + evidence, GM approves. Size **S**. Note `reconcile.md` itself was out of scope — worth a second pass.

### session-document-chain.md

- **`:49-57` "Status reflects the furthest document that exists"** — the single strongest unmechanized rule in scope. Derive expected status from which of plan/play-notes/wrap-up files exist for each session, compare with the index's declared `status`, and verify every `documents.*` wikilink resolves.
  Contract: `vault_check.py <vault> sessions` → per session: declared vs derived status, unresolved/missing `documents` entries, files present on disk but absent from the map.
  Today: three different skills advance status by hand at three different moments (`:173-175`); nothing ever reconciles it, and `session_context.py` *selects the just-played session from that status* (`session_context.py:96-98`, `PLAYED` set) — so a stale status silently mis-aims the whole prep bundle. **B, M.** Extend `vault_check.py` (it already owns `index` drift).
- **`:33-47` date formats** — `play_date` must be `YYYY-MM-DD`; `in_game_date` must carry a 4-digit year to sort, and must not carry time-of-day. `schema_rules.py` handles legacy *field renames* (`:87-104`) but no format validation. campaign-qa does it in prose (`wrapup-conformance.md:38-45`). **B, S** — add to `vault_check.py frontmatter`.
- **`:101-118` wrap-up filename convention** `Chapter_CC_Session_NN_Wrap_Up.md`, zero-padded, and **`:190-202`** the per-session directory layout. Both deterministic; both currently prose-checked in campaign-qa Step 4 only. **B, S**, folds into `vault_check.py sessions`.

### pc-body-structure.md

- **`:15-23` canonical PC heading hierarchy** and **`:64-75` `## Current Status` labelled-field spec** — `vault_check.py` validates frontmatter only; no body-structure check exists for the entity type four skills depend on. **B, M**: `vault_check.py <vault> pc-body` → missing/out-of-order canonical H2s, non-canonical labels in Current Status, GURPS `Enc:` presence for GURPS vaults.
- **`:88-90` block placement** — Current Status "**must** sit outside any `<!-- gm-only -->` or `<!-- spoiler -->` fence and before `## Notes`/`## GM Notes`". Fence-position arithmetic, publish-visibility consequence, **no check**. Highest-value single line here. **B, S.**
- **`:100-108` Story companion** — `{Name}_Story.md` exists per active PC; append-only `## Session {N} — {Title}` headings. `:105` says campaign-qa validates it (prose). **B, S**, same `pc-body` subcommand.

### templates/

- **`plan.md:11` `plan_type`, `:18-24` relationships** — **A** (`vault_check.py frontmatter` / `relationships`).
- **`plan.md:16-17` `leads_to`** — shape validated dev-side only; traversal is B3.
- **`campaign-overview.md:10-16`** `sessions_played`, `last_session`, `last_play_date`, `current_chapter`, `chapters_planned`, `current_game_date` — every one is derivable from the session files. Drift is deterministic and consequential: `session_context.py:157-160` *trusts* `last_session` to pick the whole bundle and only warns when it fails to resolve, not when it resolves to the wrong (stale) session. Contract: `vault_check.py overview` → declared vs derived, per field. **B, S–M.**
- **`world-flags.md:6-9`** three-section shape + `last_reviewed`; traction counting is B4. **B, S.**

---

## 4. ttrpg-expert refs consumed by session-prep

### scenario-writing.md

- **`:28-36` read-aloud rules.** `vault_check.py read-aloud` implements PC-name / 2nd-person-feeling / 3rd-person-pronoun. It does **not** implement: 2–4 sentence cap (`:31`), hedging words "seems/appears/looks like" (`:34-35`), game-mechanical vocabulary "stunned/frightened" (`:33`). All three are regex/sentence-split work on lines the script already isolates. **B, S — extend `check_read_aloud` (`vault_check.py:486-520`).**
- **`:173-178` ~1,200-word scene nudge** — same budget as B6; make sure one implementation serves both citations.
- **`:210-213` one-shot constraints** ("no more than 3 key NPCs, 2 locations, 1 faction") — countable when `scope: one-shot`. **C**, low priority.
- **`:61-63` ≥3 hooks**, **`:106-121` adventure shapes**, **`:229-241` playability stress test** — **D**.

### continuity-engine.md

- **`:43-48` Relationship consistency** — "flag one-way relationships that should be bidirectional" is pure graph reciprocity given `relationships[].bidirectional` and the reverse edge. `vault_check.py relationships` validates the *predicate vocabulary* only. **B, S — add `--reciprocity` to the existing subcommand.**
- **`:49-54` Clue Path Verification (Three Clue Rule)** — count clues per conclusion (clues carry `leads_to`, `entity-schema.md:241`), require ≥3 and ≥2 distinct nodes, flag targets that don't exist. Entirely deterministic. **B, M — `graph_check.py clue-paths`**, sharing B3's traversal.
- **`:36-42` Timeline Sweep** — **C**: script emits per-entity appearance list across sessions plus any terminal status (`status: dead`, with `asOfSession`) followed by a later mention; model judges whether an appearance is a flashback/hallucination/error. Size **M**. Warning: `vault_check.py timeline` already exists and means something else entirely (multi-day plan cue) — do not reuse the name.
- **`:79-91` Player Agency Violation Scan** — items 1, 3, 4 are regex-shaped; item 5 (≥2 contingencies per confrontation) is **C**. `vault_check.py:494-497` records that the plan-wide "PC name as action subject" scan was **deliberately dropped** because it scolded the GM's own prose. That decision is invisible here — this file still instructs a full scan. See §5.
- **`:120-126` Chekhov Protocol** ("flag unresolved elements older than 5 sessions"), **`:128-133` dormant threads (3+)** — same counting engine as C2.
- **`:217-228` Consistency during generation** — "Name collision — similar name already exists?" is `vault_check.py names` (uncited); the rest is **C/D**.
- **`:168-191` memory-aware revision**, **`:147-166` callbacks**, **`:193-215` world-state tracking** — **D**.

---

## 5. Flag (1): checks a script already does, that prose still asks the AI to do by hand

| Where | Prose asks | Script that already does it |
|---|---|---|
| `session-prep/SKILL.md:408` | "NPCs referenced but lacking vault files" | `graph_check.py unresolved` |
| `session-prep/SKILL.md:410` | "Missing entity stubs needed for planned scenes" | same |
| `session-prep/SKILL.md:409` | "Stale entity files: flag for update vs retire" | `vault_check.py stale-drafts` |
| `session-prep/SKILL.md:99-100` | Phase 1 gate on session status | already in `session_context.py`'s header line |
| `continuity-engine.md:218` | "Name collision — similar name already exists?" | `vault_check.py names --threshold` |
| `continuity-engine.md:79-91` | full agency scan | `vault_check.py read-aloud` implements a **deliberate subset**; the divergence is documented only in the script's docstring (`vault_check.py:494-497`) |
| `session-principles.md:27-33`, `session-templates.md:111-113` | table-cell pipe rule restated as a writing rule | `vault_check.py tables` (cited only at `SKILL.md:376`) |
| `session-prep/SKILL.md:68-84` | manual 5-item fallback read-set | mirrors `session_context.py`'s 5 emit sections — legitimate as a fallback, but the two lists must be kept in sync by hand |
| `session-play/SKILL.md:90` | combat mechanics → reference prose | `gurps_check.py` exists, unrouted from session-play |

Every row is a drift risk: the prose and the script can diverge silently, and the model will follow whichever it read last.

**Bonus drift found:** `session-templates.md:123` lists scene types as
`investigation | social | combat | chase | horror | other`, but `schema_rules.py:21-24`
(`SCENE_TYPES`) also accepts `transition` and `downtime`. The template teaches a
narrower enum than the validator enforces.

---

## 6. Flag (2): plan-conformance rules stated with no mechanical check

These are all rules, all deterministic, and none of them is checked today. Together
they are one script — `plan_check.py <plan.md> [--headless]`, sibling in shape to
`gurps_check.py` (single-file deep checker, `LEVEL<TAB>locus<TAB>message`, advisory
levels). Size **M** (~250–350 lines) for the whole set.

| Rule | Source |
|---|---|
| Required H2s present, in order, non-placeholder (17 sections) | `session-templates.md:51-211` |
| Preamble (Previously On + Active Threads + NPC Quick Reference + World State) ≤ ~1,000 words | `session-templates.md:90-98`, `SKILL.md:397-399` |
| Recap ≤150 words; NPC Quick Reference one line per NPC | `session-templates.md:93` |
| Scene >~1,200 words → sanity-check nudge (not a cap) | `SKILL.md:391-396`, `scenario-writing.md:173-178` |
| Each scene carries **Type / Objective / Entities / Setup / Behaviours / Branching / Complications** — "a scene that cannot answer this is not finished" | `session-templates.md:122-151`, `SKILL.md:344-352` |
| `**Type:**` value in the scene-type enum | `session-templates.md:123` vs `schema_rules.py:21-24` |
| Read-aloud is a `> ` blockquote, 2–4 sentences, no hedging, no mechanical terms | `SKILL.md:356-358`, `scenario-writing.md:28-36` |
| **Never estimate scene durations** (absolute rule) | `session-principles.md:15-16` |
| No audit-trail / self-documentation phrases in session-running content | `session-principles.md:39-49` |
| Mutable PC state referenced, never transcribed (`Location:`/`Condition:`/`Carrying:` labels copied out of a PC sheet into the plan) | `SKILL.md:307-314` |
| Hard Guard: headless runs put intent/spotlight/scenes under `## Open Questions`, each line labelled `(apprentice guess — confirm)` | `SKILL.md:418-431` |
| `<!-- prep-state: ... -->` marker present and parseable on a resumed plan | `SKILL.md:433-444` |
| Session index status ladder + `documents` map resolve | `session-document-chain.md:49-57`, `:173-177` |
| `## Current Status` outside any gm-only/spoiler fence, before `## Notes` | `pc-body-structure.md:88-90` |

Note the precedent and the asymmetry: campaign-qa has a full **Wrap-Up** Conformance
check (`skills/campaign-qa/references/checks/wrapup-conformance.md`, 4 steps) — also
entirely prose, no script. The Plan file has no conformance check at all. One
`plan_check.py` plus a `vault_check.py sessions` subcommand would give both documents
a mechanical floor, and would let the wrap-up conformance prose shrink to the
judgment-only findings.

---

## 7. Recommended consolidation

Ordered by value ÷ effort. Prefer extending over creating: five of the nine land as
subcommands on scripts that already walk the vault.

1. **`plan_check.py`** (new, M) — §6 in full. Biggest single win: turns eleven stated-but-unenforced rules, including the Hard Guard, into one deterministic pass. Serves prep step 15/16 and gives session-wrapup a plan to diff against.
2. **`vault_check.py sessions`** (extend, M) — status-ladder derivation, `documents` map resolution, wrap-up filename + directory layout. Fixes the input `session_context.py` already trusts.
3. **`session_context.py --play` and `--threads`** (extend, M) — P1 (at-table plan brief) and C2 (thread ages). Both reuse machinery already in the file.
4. **`session_doc.py`** (new, M) — Plan / Play Notes instantiation + index transition; serves prep (`planned→prepped`) and play (`prepped→played`). Dry-run-by-default like `stamp_entities.py`.
5. **`plans_index.py`** (new, M) — `Planning/` + `_midwife/` discovery with manifest resolution and ambiguity flagging; kills a 55-line prose procedure in prep and a paragraph-in-a-table-cell in play.
6. **`graph_check.py leads-to` + `clue-paths` + `ungrounded`** (extend, M) — node sequencing, Three Clue Rule, canon-grounding candidates.
7. **`vault_check.py` small extensions** (S each) — `read-aloud` sentence cap / hedging / mechanical terms; `relationships --reciprocity`; `flags` traction counts; `overview` drift; date-format validation in `frontmatter`; `pc-body` structure.
8. **`version_check.py`** (new, S) — eight skills, two reads each, one string comparison currently done by eye.

Tests land in `tests/` alongside `test_vault_check.py` / `test_vault_utilities.py`;
`skills/shared/vault-access.md:11-21` is the routing table that must be updated in the
same commit, and every prose site listed in §5 should be rewritten to *invoke* rather
than *restate* the check.
