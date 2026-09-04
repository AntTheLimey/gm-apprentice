# Mechanization analysis — campaign-organizer, campaign-qa, shared schema files

Scope read in full: `skills/campaign-organizer/SKILL.md` + all 5 references;
`skills/campaign-qa/SKILL.md` + 3 references + all 9 `references/checks/*`;
`skills/shared/{vault-structure,entity-schema,relationship-normalization,migrations,canon-status}.md`.
Baseline established by running `--help` on all 8 scripts in
`skills/shared/scripts/` and reading `vault_check.py`'s check functions.

All paths below are repo-relative to `/Users/antonypegg/PROJECTS/gm-apprentice/`.

---

## 0. What is already mechanized (baseline)

| Script | Subcommands | Covers |
|---|---|---|
| `vault_check.py` | frontmatter, names, index, stale-drafts, changed, tables, timeline, read-aloud, relationships, all | required fields, enums, legacy/deprecated field keys, unquoted frontmatter links, name similarity (difflib), index drift both directions, DRAFT staleness per chapter, changed-since-session, relationship predicate vocabulary |
| `graph_check.py` | orphans, unresolved, deadends, backlinks, ambiguous, all | link graph only |
| `vault_search.py` | — | BM25 prose search |
| `session_context.py` | — | session-prep read-set bundle (incl. PC `## Current Status` extraction) |
| `stamp_entities.py` | — | surgical batch frontmatter writes (`asOfSession`, `lastUpdated`, tag retag) |
| `schema_rules.py` | (library) | canonical enums, `REQUIRED_FIELDS`, `DEPRECATED_FIELDS`, predicate vocabulary, session-number/chapter parsing |
| `gurps_check.py` / `gurps_calc.py` | — | out of scope here |

Repo-side only (not shipped to vaults): `scripts/validate_schema.py`,
`scripts/validate_ontology.py`.

---

## 1. Redundancy flags — prose that hand-does what a script already does

These are drift risks: the script and the prose are two implementations of one
rule, and only one of them gets updated.

| Where | Prose says | Already scripted by |
|---|---|---|
| `campaign-qa/references/checks/graph-health.md:76-84` (Step 3 Schema Compliance) | "Read `_meta/entity-types.md` … verify all required frontmatter fields are present, field values match expected types, `type` matches a known type" | `vault_check.py frontmatter`. The file's own header (`:6-18`) routes to `graph_check.py` but **never mentions `vault_check.py`** — the model is told to hand-validate schema in the same breath. |
| `campaign-qa/references/checks/graph-health.md:33-47` (broken links, ambiguous links) | "Search for `[[...]]` patterns across all files, then verify each linked target file exists"; "Build a basename → file-list index across the whole vault" | `graph_check.py unresolved` / `ambiguous`. The preferred-procedure header covers this, but the manual steps are written as the primary procedure, not as a fallback (contrast `name-similarity.md:6-19` and `stale-draft-detection.md:7-10`, which say "fallback" explicitly). |
| `campaign-qa/references/checks/legacy-canon-field-repair.md:12-15` | "Scan every `.md` file in the vault … for frontmatter keys `source_confidence:` and `confidence:`" | `vault_check.py frontmatter` already emits `ERROR … legacy field '<old>' — renamed to '<new>'` via `schema_rules.DEPRECATED_FIELDS`. The check file names no script at all. |
| `campaign-qa/SKILL.md:240-242`; `graph-health.md:76-84` | "Frontmatter schema violations (missing required fields, wrong types)" listed as a model task | same as above |
| `campaign-organizer/references/graph-hygiene.md:42-46` | "Frontmatter: `"[[Entity Name]]"` (quoted, double brackets)" stated as a convention to uphold by hand | `vault_check.py frontmatter` has `UNQUOTED_LINK_RE` and flags it — graph-hygiene doesn't say so. |
| `campaign-qa/references/checks/canon-audit.md:24-34` | "Read `_meta/index.md` (or scan the vault if no index exists)" to build the entity index | `vault_check.py index` already builds the name/alias/type map internally but does not expose it. Every skill rebuilds it in-context. |

**Two substantive contradictions found while reading (not mechanization, but
they will produce wrong output today):**

1. `graph-health.md:49-51` tells the model to "flag one-way relationships that
   should be mutual", while `entity-schema.md:552-554` says "Storage is
   single-direction only… Do NOT store both" and
   `relationship-normalization.md:20-33` gives the inverse-collapse table. A
   model following graph-health will *add* the exact duplicate edges that
   `graph-health.md:197-209` (redundant edges) tells it to *remove*.
2. `name-similarity.md:6-19` says the script "covers exact duplicates, alias
   collisions, and fuzzy matches", then Step 4 (`:52-65`) specifies a phonetic
   check (consonant skeleton, rhyme, b/d m/n s/z f/v confusions) that
   `vault_check.check_names` does **not** implement (it is difflib ratio only).
   Taking the preferred path silently drops the phonetic check. Fix by adding it
   to the script (see B-14), not by re-adding manual steps.

Also worth flagging: `scripts/validate_schema.py:232-244` validates
`portrait` (type, allowed entity types, `_attachments/` prefix) but the
*vault-facing* `vault_check.py` does not. The repo-side validator is stricter
than the tool GMs actually run.

---

## 2. MECHANIZABLE (B)

Ordered by leverage. "Overlap" says whether to extend an existing script.

### B-1. Version check and compare — `vault_check.py version`
- **Cite:** `campaign-organizer/SKILL.md:92-112`; `campaign-qa/SKILL.md:61-69`;
  `campaign-organizer/references/migration-procedure.md:8-12,18-19`
- **Prose asks:** read `gm_apprentice_version` from `_meta/vault-config.md`,
  read `current_version` from `shared/migrations.md` frontmatter, compare,
  decide whether to migrate.
- **Contract:** `vault_check.py VAULT version` → `vault=<v> plugin=<v>
  verdict={ok|migrate|newer|new-vault}` (+ `--stamp` write mode for setup).
- **What goes wrong today:** the comparison is a *semver* compare done by an LLM
  on strings. `"1.8.9"` vs `"1.8.15"` compares the wrong way lexically, and
  `"1.9.5"` vs `"1.8.52"` likewise. A silent wrong verdict either skips a needed
  migration or triggers a spurious one. Also costs 2 file reads × 5 vault-aware
  skills × every session. Note `migrations.md:3` currently reads
  `current_version: "1.8.15"` in-repo while `plugin.json` is `1.9.5` (stamped at
  build by `scripts/build-skill-zips.sh:11`) — a script should surface that skew
  rather than have each skill rediscover it.
- **Size:** S. **Overlap:** add subcommand to `vault_check.py`.

### B-2. `_meta/index.md` regeneration — `index_build.py`
- **Cite:** `campaign-organizer/SKILL.md:257` ("Update index — Full rebuild"),
  `:282`, `:300`; `campaign-organizer/references/index-template.md:5-59` (exact
  target structure), `:61-68` (maintenance rules)
- **Prose asks:** scan the whole vault and hand-write a several-hundred-line
  index with per-type sections, counts, stub list, `last_updated`, and
  `entity_count`/`narrative_count`/`stub_count` frontmatter.
- **Contract:** `index_build.py VAULT [--write] [--incremental]` → renders
  `_meta/index.md` from a vault scan against the template in
  `index-template.md`; dry-run prints a diff.
- **What goes wrong today:** this is the single largest token sink in Organize
  (read every entity, emit every line). Counts are computed by an LLM and are
  routinely off by one; entities get dropped between rebuilds. `index-template.md:68`
  already declares "The index is derived — if stale, delete and rebuild", i.e.
  the file is by definition a pure function of the vault, and yet nothing
  computes it. `vault_check.py index` *detects* the drift it can't fix.
- **Size:** M. **Overlap:** new script, but reuse `vault_check.check_index`'s
  name/alias/link resolution; move that into a shared helper.

### B-3. Migration engine — `migrate.py` (see §4 for the full breakdown)
- **Cite:** `campaign-organizer/references/migration-procedure.md:14-32`
  (Step 1), `:36-99` (Step 3 diff), `:104-149` (Step 4 preview),
  `:167-219` (Step 6 execute), `:221-229` (Step 7 stamp);
  `shared/migrations.md` entries throughout
- **Size:** L. **Overlap:** new; absorbs B-1, B-6, B-8, B-9.

### B-4. Legacy canon-key repair — `stamp_entities.py --repair-canon`
- **Cite:** `shared/canon-status.md:37-57` (the authoritative 3-case algorithm);
  `campaign-qa/references/checks/legacy-canon-field-repair.md:12-24`;
  `shared/migrations.md:298-308` (1.8.0 vault-wide sweep)
- **Prose asks:** for every file, classify into case 1 (rename), case 2
  (collapse agreeing duplicate), case 3 (conflict: keep `canon_status`, delete
  legacy, surface); then verify no file has two `canon_status:` lines.
- **Contract:** `stamp_entities.py VAULT --repair-canon [--write]` → per file:
  `CASE<TAB>path<TAB>action<TAB>values`; `--write` applies; exits non-zero if
  any file ends with >1 `canon_status:` line.
- **What goes wrong today:** the prose itself warns (`canon-status.md:43-46`)
  that a blind rename leaves duplicate keys and "YAML parsers then silently keep
  one, which can flip the entity's status." An LLM hand-editing YAML across
  dozens of files is precisely the failure mode described. This is the
  highest-consequence B item in the QA set: a wrong edit silently changes canon
  status with no error anywhere.
- **Size:** S–M. **Overlap:** `stamp_entities.py` already does surgical,
  shape-preserving frontmatter edits with dry-run-by-default — the same engine.

### B-5. Wrap-Up conformance — `wrapup_check.py`
- **Cite:** `campaign-qa/references/checks/wrapup-conformance.md:16-22`
  (enumerate by frontmatter type), `:24-69` (frontmatter conformance),
  `:71-126` (structure/publish safety), `:127-141` (filename)
- **Prose asks:** for every wrap-up: check `session:` is a quoted wiki-link,
  `session_number:` present, `play_date:` ISO, `in_game_date:` present and not a
  legacy `in_game_dates`/`_start`/`_end` pair, `source_document:` backfilled,
  `reconciled:` present (backfilled from a `**Reconciled:**` line / dated
  callout / dated heading), `AUTHORITATIVE` + `reconciled: null` + no
  Reconciliation Context, `type:` synonym drift, canonical fields present;
  classify every H2 against a 2-item player-facing allowlist; check fence
  containment against the vault's *effective* exclude list; check filename against
  `Chapter_CC_Session_NN_Wrap_Up.md`.
- **Contract:** `wrapup_check.py VAULT [frontmatter|structure|filename|all]
  [--fix]` → `LEVEL<TAB>path<TAB>message`; `--fix` applies the hoist/re-nest/
  demote/fence transform and the frontmatter backfills.
- **What goes wrong today:** every one of the ~14 frontmatter rules is a
  deterministic predicate, and the H2 classification rule is literally "these
  two names are player-facing, everything else is not" (`:73-78`). Doing it by
  reading each file costs a full read per wrap-up and produces inconsistent
  severity assignment — and the severity rule (`:88-91`) is itself mechanical
  (Critical iff the heading is not covered by the effective exclude list). This
  check is the enforcement point for content **leaking to a player-facing site**.
- **Size:** L. **Overlap:** new script, but it and the 1.9.5 migration
  (`shared/migrations.md:656-692`) specify the *same transform twice* — one
  engine must serve both, or they will diverge.

### B-6. GM-only leak detection — `vault_check.py gm-leak`
- **Cite:** `campaign-qa/references/checks/graph-health.md:58-74`;
  `campaign-organizer/references/migration-procedure.md:77-99` (same three scans,
  restated); `shared/migrations.md:385-407`
- **Prose asks:** search every file for headings (any level) and bold-paragraph
  lines (`**Text:**`) whose text contains keeper/secret/tactic/confidential/
  gm-only/dm notes (case-insensitive); for each, test containment inside
  `## GM Notes` or a `<!-- gm-only -->`/`<!-- spoiler -->` fence; skip files the
  publish pipeline excludes wholesale (`exclude_dirs`, session plans, drafts when
  `exclude_drafts` set); severity Critical iff `publish.site_dir` is configured.
- **Contract:** `vault_check.py VAULT gm-leak` → `LEVEL<TAB>path:line<TAB>
  heading text<TAB>protection={none|gm-notes|fence}`.
- **What goes wrong today:** grep-by-hand across 6 keyword variants × 3 syntactic
  forms (`### X`, `### **X**`, `**X:**`), with a *containment* test that grep
  cannot express at all. Misses here publish a Keeper's tactical notes to
  players. Fence containment must also be nesting-aware (`migrations.md:636-645`).
- **Size:** M. **Overlap:** add to `vault_check.py`; the same scanner satisfies
  migration Step 3's bold/callout detection, so B-3 imports it.

### B-7. World-rule evaluation — `world_check.py`
- **Cite:** `campaign-organizer/references/world-validation.md:14-31` (the
  evaluator), `:52-57` (`_flags.md` suppression), `:42-50` (which checks fire);
  `campaign-qa/references/world-audit-criteria.md:6-15` (hard checks), `:33-37`
  (deferred review); `shared/entity-schema.md:366-372` (rules are declared
  "machine-checkable" with an explicit `check` object)
- **Prose asks:** for each active `_World/` domain file, evaluate each rule's
  `check` object — `field`, `max`/`min`, `allowed_values`, `entity_type` —
  against every entity, then suppress anything already in `_flags.md` Ignored.
- **Contract:** `world_check.py VAULT [--include-soft]` → `LEVEL<TAB>entity<TAB>
  rule_id<TAB>message`, with ignored/deferred flags applied; `--deferred` prints
  the deferred register with mention counts.
- **What goes wrong today:** the schema calls these rules machine-checkable and
  then asks the model to be the machine. Numeric range comparison and list
  membership by LLM across N entities × M rules is both expensive and
  non-reproducible run to run; `_flags.md` suppression is silently skipped when
  the model forgets to read it first.
- **Size:** M (hard checks + flags). Soft checks (`world-audit-criteria.md:19-28`)
  stay with the model — see C-6. **Overlap:** new script; wire into
  `vault_check.py all` output shape.

### B-8. Wrap-Up filename rename + vault-wide relink
- **Cite:** `campaign-organizer/references/migration-procedure.md:68-76`
  (detection), `:179-190` (execute); `checks/wrapup-conformance.md:127-141`;
  `shared/migrations.md:332-350`
- **Prose asks:** find wrap-ups on the old `Session_NN_Wrap_Up.md` pattern,
  derive the chapter from the session index's `chapter:` field, rename to
  `Chapter_CC_Session_NN_Wrap_Up.md`, then rewrite **every** inbound reference —
  plain `[[X]]`, aliased `[[X|Alias]]`, embed `![[X]]`, and frontmatter link
  fields — plus flag live basename collisions.
- **Contract:** `relink.py VAULT --rename OLD=NEW [--write]` → planned edits as
  `path:line<TAB>before<TAB>after`; `--write` applies; refuses on any
  undeterminable reference and lists it.
- **What goes wrong today:** four link syntaxes plus frontmatter. The prose says
  it outright (`wrapup-conformance.md:136-138`): "a half-done rename breaks links
  silently." An LLM doing a multi-form rewrite across a vault will miss the
  `![[…]]` and quoted-frontmatter forms; nothing errors.
- **Size:** M. **Overlap:** `graph_check.py` already parses all four link forms —
  factor its link parser into a shared module and build the rewriter on it.

### B-9. Heading re-nest transform — `renest.py` (or `wrapup_check.py --fix`)
- **Cite:** `campaign-organizer/references/migration-procedure.md:191-199`;
  `shared/migrations.md:385-392` (1.8.3), `:599-608` (1.8.52),
  `:679-692` (1.9.5); `checks/wrapup-conformance.md:88-98`
- **Prose asks:** move each matching heading and its subtree under `## GM Notes`
  (creating it if absent), demoting the heading and all its children by the
  needed level; hoist player-facing sections above the block first; wrap the
  block in one nesting-aware `<!-- gm-only -->` pair; then collapse the vault's
  `exclude_sections` to `["GM Notes"]`.
- **Contract:** `renest.py FILE --under "GM Notes" --headings ... [--fence]
  [--write]` → unified diff; `--write` applies.
- **What goes wrong today:** the migration preview's own example is "Re-nest 47
  headings … across 62 files" (`migration-procedure.md:117-119`). That is 62
  hand-edits with per-file level arithmetic. Wrong demotion depth silently
  reparents a subsection; a missed file leaves Keeper content published. Also
  described *four separate times* across migrations.md and the QA check — four
  chances to drift.
- **Size:** M. **Overlap:** shared with B-5 and B-3.

### B-10. Clue graph metrics — `clue_check.py`
- **Cite:** `campaign-qa/references/checks/clue-redundancy.md:31-41` (Three Clue
  Rule verification), `:42-53` (dead-end / orphan / bottleneck);
  `shared/entity-schema.md:241` (Clue `leads_to`), `:302` (Plan `leads_to`)
- **Prose asks:** count independent clues per conclusion, count distinct nodes,
  flag <3, flag all-in-one-scene, find clues whose target doesn't exist, find
  conclusions with no inbound path, find single-connection bottlenecks.
- **Contract:** `clue_check.py VAULT` → per target node: `clues=N sources=M
  status={ok|thin|single-node|orphan}` plus `bottleneck` rows (graph articulation
  points) and `dead-end` rows (unresolved `leads_to` targets).
- **What goes wrong today:** `leads_to` was made a first-class frontmatter field
  in 1.8.39 (`shared/migrations.md:526-530`) precisely so narrative flow is a
  machine-readable graph — and nothing reads it. Counting, in-degree, and
  articulation points are textbook graph computations currently eyeballed by an
  LLM across the whole vault. Bottleneck detection by inspection is unreliable at
  any real vault size.
- **Size:** M. **Overlap:** new; reuse `graph_check.py`'s link resolver. Step 1
  (identify conclusions) stays judgment — see C-4.

### B-11. Session document-chain validation — `vault_check.py sessions`
- **Cite:** `campaign-qa/SKILL.md:247-251`; `shared/vault-structure.md:94-100`;
  `shared/session-document-chain.md` (referenced spec)
- **Prose asks:** sessions with Play Notes but no Wrap-Up; sessions stuck at
  `wrap-up` status across multiple prep cycles; session index `documents:` links
  pointing at files that don't exist.
- **Contract:** `vault_check.py VAULT sessions` → `LEVEL<TAB>session<TAB>message`
  covering missing chain members, stuck status, and dangling `documents.*` links.
- **What goes wrong today:** requires reading every session index's frontmatter
  and cross-checking file existence — pure I/O, no judgment. `graph_check.py
  unresolved` catches dangling links generically but says nothing about the
  `documents:` semantics or the missing-wrap-up rule.
- **Size:** S. **Overlap:** add to `vault_check.py`.

### B-12. Character-story file validation — `vault_check.py stories`
- **Cite:** `campaign-qa/references/checks/graph-health.md:86-105`;
  `campaign-qa/SKILL.md:257-261`;
  `campaign-organizer/references/migration-procedure.md:25-26`
- **Prose asks:** for each PC whose `status` is not dead/retired, verify
  `Characters/PCs/{Name}_Story.md` exists; for each story file, compare
  `asOfSession` to the latest wrap-up's session number and flag if >1 behind.
- **Contract:** `vault_check.py VAULT stories` → `WARNING<TAB>path<TAB>missing
  story file` / `… asOfSession N vs latest wrap-up M`.
- **What goes wrong today:** an integer comparison and a file-existence test done
  by reading every PC and every wrap-up. `schema_rules.parse_session_number` and
  `chapter_key` already exist for exactly this; `validate_schema.py:358`
  (`find_stale_pcs`) implements a near-identical freshness check on the repo side
  and is not exposed to vaults.
- **Size:** S. **Overlap:** `vault_check.py`; lift `find_stale_pcs` down into
  `schema_rules.py` so both callers share it.

### B-13. Open spoilers listing — `vault_check.py spoilers`
- **Cite:** `campaign-qa/references/checks/open-spoilers.md:7-14`
- **Prose asks:** search the vault for `<!-- spoiler -->`; per hit list the file,
  the first ~15 words, and the file's `lastUpdated`/`asOfSession`.
- **Contract:** `vault_check.py VAULT spoilers` → `path:line<TAB>asOfSession<TAB>
  first 15 words`.
- **What goes wrong today:** grep gives locations but not the 15-word excerpt or
  the frontmatter join, so the model reads each hit file. Purely mechanical
  extraction; the GM review question at `:16-19` stays with the model.
- **Size:** S. **Overlap:** `vault_check.py`.

### B-14. Phonetic name similarity — extend `vault_check.py names`
- **Cite:** `campaign-qa/references/checks/name-similarity.md:52-65`
- **Prose asks:** consonant-skeleton comparison, rhyme, shared first syllable,
  single-sound confusions (b/d, m/n, s/z, f/v).
- **Contract:** `vault_check.py VAULT names [--phonetic]` → additional rows keyed
  `PHONETIC`.
- **What goes wrong today:** the check is currently *lost*: the preferred path
  (the script) doesn't implement it, and the manual steps are marked "only if
  Python is unavailable" (`:17-19`). Soundex/consonant-skeleton is ~30 lines.
- **Size:** S. **Overlap:** `vault_check.py check_names`.

### B-15. Containment scalar/edge pairing — `vault_check.py relationships` (extend)
- **Cite:** `campaign-qa/references/checks/graph-health.md:160-178`;
  `shared/relationship-normalization.md:41-52`, `:81-92`
- **Prose asks:** flag `parent_location:` with no matching `part_of` edge; a
  `part_of` edge with no `parent_location:`; the two naming different parents.
  Same pairing for Faction `territory:`/`headquartered_at` and Item
  `current_holder:`/`owns`.
- **Contract:** extend `vault_check.py relationships` → `WARNING<TAB>path<TAB>
  parent_location "[[X]]" has no part_of edge` etc.
- **What goes wrong today:** the prose documents a real production failure (the
  Dead End vault's Entertainment District, `relationship-normalization.md:49-52`)
  caused by exactly this half-write. Two-field agreement is a join, not a
  judgment. Same file also gives the symmetric-predicate rule (`:35-37`, store
  once with `bidirectional: true`) — a symmetric predicate stored on both
  endpoints is a mechanical duplicate check in the same pass.
- **Size:** S. **Overlap:** `vault_check.py check_relationships`.

### B-16. Structural graph checks not covered by `graph_check.py`
- **Cite:** `campaign-organizer/SKILL.md:308-312` ("type pair violations, missing
  required relationships, bidirectional consistency **on top of** their output");
  `campaign-organizer/references/graph-hygiene.md:33-40`;
  `shared/entity-schema.md:593-602`; `checks/graph-health.md:53-56` (hub
  overload), `:193-195` (generic types), `:197-209` (redundant edges)
- **Prose asks:** required-relationship gaps per type table; domain/range type-pair
  violations; hub overload (>2 SD above the per-type mean); uses of
  `associated_with`/`related_to`; the named redundant-predicate pairs
  (`serves`/`employs`, `member_of`/`has_member`, `leads`/`led_by`, `owns`/`owned_by`,
  `rules`/`ruled_by`) and same-pair-multiple-type edges.
- **Contract:** `graph_check.py VAULT relations` → sections `required-missing`,
  `type-pair`, `hub-overload`, `generic`, `redundant-pair`.
- **What goes wrong today:** hub overload is a *standard deviation* — the prose
  asks for a statistic and gets an impression. The redundant-pair list is a
  5-entry lookup table; the required-relationship rule is a 6-row table
  (`entity-schema.md:595-602`). None of it is scripted, and
  `campaign-organizer/SKILL.md:308-312` explicitly frames it as model work "on
  top of" the scripts.
- **Size:** M. **Overlap:** `graph_check.py`; needs `schema_rules.py` to expose
  the required-relationship table and generic/redundant predicate lists (they
  currently live only in markdown).

### B-17. Vault scaffolding — `vault_init.py`
- **Cite:** `campaign-organizer/SKILL.md:213-238` (Organize step 3 scaffold
  list); `shared/vault-structure.md:5-43` (folder tree), `:199-224` (`_World/`)
- **Prose asks:** create `_World/world-index.md` and `_flags.md` from
  `shared/templates/`, create `Heritages/`, add `_Template_Heritage.md`,
  `_Template_Faction.md`, `_Template_Plan.md`, `_Template_Session_WrapUp.md` if
  absent, create `Planning/` under each chapter directory.
- **Contract:** `vault_init.py VAULT [--system coc-7e] [--write]` → creates
  missing folders and copies missing templates from `shared/templates/`;
  reports created vs skipped; idempotent.
- **What goes wrong today:** an 8-item checklist of "create X if absent"
  executed by hand every setup. Items get skipped (there is a known instance:
  the Event template lives as *prose* in
  `campaign-organizer/references/event-template.md:20-60` rather than in
  `shared/templates/`, so it is invisible to the migration template-diff at
  `migration-procedure.md:51-53` and can never be offered as a template update).
- **Size:** M. **Overlap:** shares the copy-if-missing/diff primitives with
  `migrate.py` (B-3).

### B-18. Portrait / attachment conformance — `vault_check.py attachments`
- **Cite:** `campaign-organizer/SKILL.md:145-174`;
  `shared/vault-structure.md:63-86`; `scripts/validate_schema.py:232-244`
- **Prose asks:** store under `_attachments/<folder>/<slug>.<ext>` per the
  type→folder table, write a vault-root-relative `portrait` path, use slug
  naming matching the entity file, accepted formats jpg/jpeg/png/webp/gif.
- **Contract:** `vault_check.py VAULT attachments` → `portrait` path resolves,
  lives under the right type folder, extension in the allowlist, plus orphaned
  attachment files nothing references.
- **What goes wrong today:** a broken `portrait` path produces a missing image
  on the published site with no error anywhere in the toolchain. The repo-side
  validator already checks three of these rules — the vault-facing tool doesn't.
- **Size:** S. **Overlap:** `vault_check.py`; import `PORTRAIT_TYPES` from
  `schema_rules.py` (already there, unused by `vault_check.py`).

### B-19. Folder-mapping and naming conformance — `vault_check.py layout`
- **Cite:** `shared/entity-schema.md:604-622` (type→folder table);
  `shared/vault-structure.md:59-61` (naming: `Session {NN} - {Title}.md`,
  `Chapter {N} - {Title}/`)
- **Contract:** `vault_check.py VAULT layout` → entities filed in the wrong
  folder for their `type`; session/chapter filenames off the convention.
- **What goes wrong today:** nothing checks it; misfiled entities break the
  publish grouping and the folder-scoped `--folder` options of the existing
  scripts.
- **Size:** S. **Overlap:** `vault_check.py`.

### B-20. Vault-config validation — `vault_check.py config`
- **Cite:** `shared/entity-schema.md:624-649` (the full field table)
- **Contract:** `vault_check.py VAULT config` → unknown keys under `publish:`,
  wrong types (`exclude_sections` not a list), `system` not in the 6-value enum,
  `site_dir` not absolute or nonexistent, `exclude_sections` not collapsed to
  `["GM Notes"]` post-1.8.3.
- **What goes wrong today:** a typo'd `publish.system` silently selects the wrong
  renderer; `migration-procedure.md:77-85` and the wrap-up check both *read* this
  list and assume it is well-formed.
- **Size:** S. **Overlap:** `vault_check.py`.

### B-21. QA report scaffolding — part of a `qa_run.py`
- **Cite:** `campaign-qa/SKILL.md:99-102`;
  `campaign-qa/references/report-template.md:9-87` (frontmatter with 9 computed
  counts), `:88-99` (naming with same-day sequence suffix)
- **Contract:** `qa_run.py VAULT --mode all` → runs every scripted check,
  dedupes findings across checks (`SKILL.md:306`), sorts Critical→Warning→Info
  (`:308-312`), and emits the report skeleton with `vault_stats` counts filled
  and the correctly-sequenced filename.
- **What goes wrong today:** the 9 `vault_stats` counters are hand-tallied by the
  model at the end of a long session (the exact conditions under which counts
  drift), and the same-day sequence-number rule requires listing `_QA/` first.
  Dedupe across 10 checks is set intersection.
- **Size:** M. **Overlap:** new orchestrator; the model still writes the prose
  Summary/Resolution sections (D).

### B-22. Dismissed-findings register — `vault_check.py dismissed`
- **Cite:** `campaign-qa/SKILL.md:343-346` (write `<!-- QA-DISMISSED: reason -->`),
  `:394-397` ("Respect dismissed findings")
- **Contract:** `vault_check.py VAULT dismissed` → `path:line<TAB>reason`, so
  every other check can suppress against it.
- **What goes wrong today:** there is no mechanism at all — the model is told to
  respect dismissals but nothing surfaces them, so a dismissed finding is
  re-flagged on the next run unless the model happens to grep for the marker.
  That is the single most annoying failure mode for a repeat QA user.
- **Size:** S. **Overlap:** `vault_check.py`; feed into `qa_run.py` (B-21).

### B-23. Non-edge predicate detection
- **Cite:** `shared/relationship-normalization.md:127-141`;
  `checks/graph-health.md:150-153`; `campaign-organizer/references/graph-hygiene.md:19-21`
- **Prose asks:** drop edges whose target resolves to a session/scene/play-notes
  file; drop one-off action verbs (`threatened`, `marked`, `released_in`,
  `encountered_by`); convert surviving `leads_to`/`precedes`/`alternative_to`
  edges to the `leads_to` frontmatter field.
- **Contract:** extend `vault_check.py relationships` → `WARNING … edge target
  resolves to <type: session-play-notes> — log reference, not a graph edge`.
- **What goes wrong today:** requires resolving each edge target to a file and
  reading its `type` — the resolver exists in `graph_check.py`, the type lookup
  in `vault_check.py`; nothing joins them.
- **Size:** S. **Overlap:** `vault_check.py check_relationships`.

### B-24. Entity index as machine output — `vault_check.py entities --json`
- **Cite:** `campaign-qa/references/checks/canon-audit.md:24-34`;
  `checks/name-similarity.md:21-31`; `campaign-organizer/SKILL.md:290-291`
- **Prose asks (three separate check files):** "build a complete list of entity
  names, aliases, type, canon status, path."
- **Contract:** `vault_check.py VAULT entities [--json]` → one row per entity:
  name, aliases, type, canon_status, createdSession, asOfSession, path.
- **What goes wrong today:** three checks each rebuild the same table in context
  by reading the vault. `check_index` and `check_names` already build it
  internally and throw it away.
- **Size:** S. **Overlap:** `vault_check.py`; unlocks C-1 and C-2.

---

## 3. HYBRID (C)

### C-1. Cross-file fact contradiction — script emits the disagreement matrix
- **Cite:** `campaign-qa/references/checks/canon-audit.md:36-63`
- **Script emits:** for each entity, the set of *frontmatter scalar* values
  asserted about it across all files (`age`, `status`, `occupation`,
  `nationality`, `location`, `era`), flagging every field where two files
  disagree, annotated with each file's `canon_status` and `asOfSession`. The
  DRAFT-vs-AUTHORITATIVE and SUPERSEDED exemptions (`:56-63`) are mechanical
  filters the script applies.
- **Stays with the model:** contradictions asserted in *prose* (the majority),
  and whether a disagreement is deliberate unreliable narration.
- **Why it matters:** today the model reads the whole vault to find any of it.
  A pre-computed frontmatter disagreement matrix turns a vault-wide read into a
  targeted read of the ~5 files that actually conflict.
- **Size:** M. **Overlap:** builds on B-24.

### C-2. Entity lifecycle / post-death references
- **Cite:** `checks/timeline-validation.md:19-27`; `campaign-qa/SKILL.md:154-155`
- **Script emits:** entities with a terminal `status` (dead/destroyed/retired)
  plus the session it changed, joined against every file that references them
  whose `asOfSession`/session number is *later*.
- **Stays with the model:** whether the later reference actually assumes the old
  status (a eulogy mentions a dead NPC legitimately).
- **Size:** S–M. **Overlap:** `graph_check.py backlinks` + B-24.

### C-3. Link candidates for the Weave pass
- **Cite:** `campaign-organizer/SKILL.md:254` (Link pass), `:290-294` (Weave
  Scan/Discover/Propose)
- **Script emits:** every occurrence of an entity name or alias in another file's
  body text that is not already inside `[[…]]`, a code fence, or frontmatter —
  grouped by target entity, with line context.
- **Stays with the model:** the Explicit/Inferred/Possible certainty grouping
  (`:292`) and whether a mention is the entity or a coincidence.
- **Why it matters:** "Discover — find missing links in body text" currently
  means reading the entire vault N times (once per entity). This is the second
  largest token sink after index rebuild.
- **Size:** M. **Overlap:** new; reuse `vault_search.py`'s tokenizer.

### C-4. Clue → conclusion mapping
- **Cite:** `checks/clue-redundancy.md:8-17` (identify conclusions), `:18-29`
  (map clues)
- **Script emits:** the `leads_to` node graph (B-10) plus, for conclusions not
  expressed as entities, a list of Plan entities with `plan_type:
  investigation`/`arc` as candidate conclusion nodes.
- **Stays with the model:** what counts as a conclusion when it lives only in
  scenario prose, and whether an inferential/environmental clue points at it.

### C-5. Inverse-direction relationship repair
- **Cite:** `shared/relationship-normalization.md:20-33`;
  `checks/graph-health.md:144-148`
- **Script emits:** the exact patch — `owned_by A→B` on A's file deleted, `owns
  B→A` written on B's file — for each of the 7 table rows, as a reviewable diff.
- **Stays with the model/GM:** approval, since it edits two files and the target
  endpoint's meaning is a canon claim. The transform itself has zero degrees of
  freedom.
- **Size:** S on top of B-15/B-23.

### C-6. World soft checks and deferred-flag resurfacing
- **Cite:** `campaign-qa/references/world-audit-criteria.md:19-28` (soft checks),
  `:33-37` (deferred review)
- **Script emits:** the deferred register with mention counts and session refs,
  and the "meets resurfacing criteria (3+ sessions or 3+ mentions)" flag — both
  are counts. Also the trivially-checkable soft signals: faction with no
  `resources`/economic field, settlement with no water/trade field.
- **Stays with the model:** monoculture, stasis, "long-lived no-impact" — these
  need reading comprehension across prose.

### C-7. Childless-container detection
- **Cite:** `checks/graph-health.md:180-191`;
  `shared/relationship-normalization.md:59-103`
- **Script emits:** the detection rule is already written as an exact algorithm
  at `graph-health.md:185-189` — X has `part_of` parent P; X's body or
  `points_of_interest` links `[[A]]`, `[[B]]`; A and B have no `part_of` to X.
  Emit X + candidate children.
- **Stays with the GM:** the yes/no per candidate — `relationship-normalization.md:73-75`
  insists on it ("'inside the district' is a canon claim").

### C-8. Redundant / traversal edge triage
- **Cite:** `checks/graph-health.md:197-216`
- **Script emits:** same-pair-multiple-predicate edges, the 5 named
  double-authored pairs, and pairs connected directly whose endpoints also share
  a 2-hop path through a common node.
- **Stays with the model:** whether the direct edge "carries independent
  narrative meaning" (`graph-hygiene.md:8-11`).

### C-9. Canon fabrication scan
- **Cite:** `checks/canon-audit.md:96-110`
- **Script emits:** capitalized multi-word tokens in session plans that match no
  vault entity name or alias; and entities referenced in a plan whose
  `createdSession` is later than the plan's session.
- **Stays with the model:** whether a claim ("her family home in Kent") is a
  fabricated property — that is squarely reading comprehension. Script narrows
  the search space only.

### C-10. Wrap-up → session-index matching under ambiguity
- **Cite:** `checks/wrapup-conformance.md:31-36` ("flat `Sessions/` directories
  hold many indexes — 'same directory' alone is not a selector")
- **Script emits:** the candidate index set per wrap-up with match evidence
  (session number, chapter, filename); one candidate → auto; 0 or 2+ → ask.

---

## 4. `migrate.py` — the migration procedure as code

`migration-procedure.md` is a 247-line program written in English, and
`migrations.md` is its 714-line step registry. Everything except two judgment
batches is mechanical.

**Step 1 (gather state) — `migration-procedure.md:14-32`.** Nine deterministic
scans: read two version fields, list `_meta/`, read the Type-Specific Fields
section, list `_Templates/`, list PCs and their `_Story.md` companions, list
wrap-ups and classify each filename pattern, read the installed npm version from
`package.json`. **All B.**

**Step 3 (diff) — `migration-procedure.md:36-99`.** Every bullet is a predicate:

| Bullet | Line | Class | Note |
|---|---|---|---|
| Folder exists → skip | :46 | B | |
| Vault-config field set → skip | :47 | B | |
| Template content-compare vs `shared/templates/` | :48-52 | B | a byte diff the model currently does by reading both files |
| Story file exists per PC | :53 | B | |
| `_meta/` file exists | :54 | B | |
| npm version compare | :55 | B | another semver compare — same lexical hazard as B-1 |
| Frontmatter key sweep: grep legacy keys, count files | :56-59 | B | |
| `_meta/entity-types.md` entry vs `entity-schema.md` per built-in type, preserving vault-only entries | :60-66 | B | text diff + set difference |
| Wrap-up filename pattern + live basename collisions | :68-76 | B | see B-8 |
| `exclude_sections` heading scan, exact heading match, any level | :77-85 | B | see B-6/B-9 |
| Bold-wrapped and bold-paragraph GM content | :86-93 | B detect / **C fix** | the prose says why the fix needs a GM: a bold line has no section boundary |
| Callout-only-marked content, with fence/heading containment test | :94-99 | B detect / **C fix** | GM chooses `## GM Notes` vs `<!-- spoiler -->` |

**Step 4 (preview) — `:104-149`.** Rendering the Step 3 result into three
categorized lists. **B**, and it is where the counts in the worked example
("Rename 4 Wrap-Up files… repair 33 wiki-links", "Re-nest 47 headings… across 62
files") come from — counts an LLM cannot produce reliably.

**Step 5 (present and confirm) — `:151-165`.** **D.** The gate stays.

**Step 6 (execute) — `:167-219`.** Items 1–9 and 11 are **B** transforms
(field writes, file creation, the canon sweep = B-4, the rename+relink = B-8, the
re-nest = B-9, template copy/overwrite, entity-types.md line replacement at the
same relative position, story-file creation from template). Item 10 (`:208-213`)
is the **C** judgment batch. Item 12 is a shell-out.

**Step 7 (stamp) — `:221-229`.** **B**, one frontmatter write.

**Step 8 (report) — `:231-243`.** **B** for the change list and the conflict
table; **D** for the closing conversation.

### Proposed contract

```
migrate.py VAULT plan   [--json]            → per-step {id, category, status:
                                              satisfied|pending, evidence, counts}
migrate.py VAULT apply  --steps s1,s2,...   → applies confirmed steps, prints a
                                              per-file change log
migrate.py VAULT stamp                      → writes gm_apprentice_version
```

Steps as declarative data (a per-version table mirroring `migrations.md`) over a
small primitive library: `rename_frontmatter_key`, `ensure_field`,
`copy_template_if_missing`, `diff_template`, `sweep_canon_keys` (B-4),
`rename_file_and_relink` (B-8), `renest_heading` (B-9), `sync_schema_mirror`,
`scan_gm_only` (B-6). The three "always runs, independent of pending versioned
migrations" checks (`:60-66`, `:68-76`, `:77-85`) become plain always-on steps.

**Size:** L (~600-800 lines including primitives, most of which are shared with
B-4/B-6/B-8/B-9 and therefore not incremental cost).

**Concrete per-version steps in `migrations.md` that are pure transforms:**

- `:164-171` (1.4.22) — Event `date:`→`in_game_date:`; Session
  `planned_date:`→`play_date:` **with `actual_date` precedence and removal**.
  A conditional rename across every session file: exactly what an LLM applies
  inconsistently at file 30 of 40.
- `:298-314` (1.8.0) — vault-wide canon key sweep (B-4).
- `:332-350` (1.8.2) — wrap-up rename + vault-wide relink (B-8).
- `:385-392` (1.8.3) — heading re-nest + `exclude_sections` collapse (B-9).
- `:599-608` (1.8.52) — Reconciliation Context demote (a special case of B-9).
- `:656-692` (1.9.5) — wrap-up frontmatter normalization + Keeper H2 re-nest +
  `gm-only` fence wrap (B-5 + B-9, **specified twice** — here and in
  `wrapup-conformance.md`).
- `:36-56` — Schema Mirror Sync: diff `_meta/entity-types.md` against
  `entity-schema.md` per built-in type, never touching vault-only entries.
- `:106-141` — thirteen consecutive "No vault schema changes. Version stamp
  only." entries. That is a version registry, not prose; as data it is 13 rows.

### One structural drift risk worth naming

The entity schema now exists in **three** hand-maintained copies: the tables in
`shared/entity-schema.md`, the Python constants in
`skills/shared/scripts/schema_rules.py:18-77`, and each vault's
`_meta/entity-types.md` (kept in sync by the Schema Mirror Sync step). CI
(`scripts/validate_ontology.py`) checks only the *predicate set and symmetric
set* — `entity-schema.md:568-579` says so explicitly. Nothing checks that
`REQUIRED_FIELDS`/enums agree with the markdown tables. Either generate
`schema_rules.py`'s constants from `entity-schema.md`, or add a CI check that
parses the markdown and asserts agreement; otherwise a schema change made in one
copy will validate green while the other two rot.

---

## 5. JUDGMENT (D) — leave with the model

- Entity extraction and classification from source prose
  (`campaign-organizer/SKILL.md:239-247`, `:266-278`) — including the verbatim-carry
  rule, which is a fidelity discipline, not a transform.
- Deduplication and conflict handling (`SKILL.md:322-333`) — "when in doubt,
  don't merge."
- Schema evolution proposals (`SKILL.md:114-127`).
- Event threshold "at least two of four" (`event-template.md:6-18`) — three of
  the four criteria need narrative judgment.
- Travel-time validation (`timeline-validation.md:29-46`) — setting-specific and
  prose-sourced; the reference table is hardcoded to 1814 Regency and explicitly
  says "calibrated per campaign setting."
- Severity calibration and the "explain the why / table impact" framing
  (`campaign-qa/SKILL.md:122-128`, `:386-392`).
- The whole Fix Workflow gate (`campaign-qa/SKILL.md:314-360`) and the
  three-state world prompt (`world-validation.md:33-40`).
- Report Summary / Resolution prose (`report-template.md:33-38`, `:50`).
- The soft world checks that need comprehension (`world-audit-criteria.md:24-28`).

---

## 6. Suggested sequencing

1. **B-4 (canon repair)** — highest consequence per line of code; the prose
   already documents the silent-corruption failure mode.
2. **B-1 (version compare)** — smallest; fixes a live lexical-semver bug across
   5 skills.
3. **B-6 (gm-leak)** — publish-safety; serves both the QA check and migration
   Step 3.
4. **B-2 (index rebuild)** — largest token saving in campaign-organizer.
5. **B-9 + B-8 (re-nest, rename+relink)** — the shared primitives that make
   B-5 and B-3 tractable.
6. **B-5 (wrapup_check)** then **B-3 (migrate.py)** — B-3 imports everything above.
7. Fill in the S-sized `vault_check.py` subcommands (B-11 … B-24) opportunistically.

Before any of it, fix the two contradictions in §1 — a script built on
`graph-health.md:49-51` would enforce the opposite of the schema.
