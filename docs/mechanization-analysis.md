# Mechanization analysis — what the skills do in prose that code should do

Date: 2026-09-04. Analysis only; nothing in this document has been built.

Question 1: which operations in the nine gm-apprentice skills are currently
executed by the model interpreting prose, but are deterministic and should be
procedural code the skill invokes?

Question 2: should that procedural code stay in Python, or move to Go?

Per-cluster reports with full file:line citations live in
`docs/mechanization-analysis/` (five files, ~157 KB). This document is the
consolidated view and the recommendation.

---

## 1. Headline

The skills contain roughly **80 fully mechanizable procedures and 30 hybrid
ones** (script produces evidence, model or GM decides), against **8 shared
scripts** that exist today. Most of the mechanizable work is not exotic: it is
validators, frontmatter writers, template instantiators, index rebuilders,
lookups, and orchestration loops that the prose describes step by step and the
model then performs by reading whole files and editing YAML by hand.

| Cluster | Files read | B (mechanizable) | C (hybrid) | Scripts invoked today |
|---|---|---|---|---|
| campaign-organizer + campaign-qa + shared schema | 20 | 24 | 10 | vault_check, graph_check, vault_search |
| session-prep + session-play + session refs | 11 | 8 (+1 umbrella) | 6 | session_context, vault_check |
| session-wrapup + vault-ingest + reconcile | 12 | 14 | 7 | stamp_entities, vault_check |
| the-midwife + ttrpg-expert | 20 + systems survey | 12 | 5 | **none** (gurps_check from two system files only) |
| publish-site (wrapper around the Node CLI) | 10 + tools/publish | ~20 | ~4 | gm-publish (7 subcommands) |

Three findings cut across every cluster:

1. **Prose restates checks that scripts already perform.** Twenty-plus
   sites tell the model to hand-validate frontmatter, hand-find unresolved
   links, hand-compare names, or hand-derive the active PC set, when
   `vault_check.py`, `graph_check.py`, or an internal helper already does it.
   Each is a drift risk: the script and the prose are two implementations of
   one rule, and the model follows whichever it read last.
2. **Rules are stated with no check.** The Session Plan has fourteen stated
   conformance rules (required sections, word budgets, read-aloud form, no
   duration estimates, the Hard Guard) and no script checks any of them. The
   wrap-up conformance check exists only as a 146-line campaign-qa *repair*
   procedure, which is itself proof the authoring rules are not followed.
3. **The model is asked to be the machine.** Semver comparison by eye across
   eight skills. Standard deviations for hub overload. "Referenced in 3+
   sessions" traction counts. Point-budget arithmetic for four of five game
   systems. Dice rolls. A polling loop with clamping, back-off, and dedup where
   the prose admits "dedup here is *your* job, not the script's".

## 2. What is already mechanized (baseline)

| Script | Covers |
|---|---|
| `vault_check.py` | frontmatter schema, enums, legacy keys, unquoted links; name similarity (difflib only); index drift; stale drafts; changed-since; table pipes; multi-day timeline cue; read-aloud subset; relationship predicate vocabulary |
| `graph_check.py` | orphans, unresolved, dead ends, backlinks, ambiguous |
| `vault_search.py` | index-free BM25 over a vault |
| `session_context.py` | the session-prep read-set bundle |
| `stamp_entities.py` | surgical `asOfSession` / `lastUpdated` / retag writes |
| `gurps_check.py` + `gurps_calc.py` | GURPS sheet arithmetic; **sums declared costs only**, never checks a cost against canon |
| `schema_rules.py` | shared enums, required fields, predicate vocabulary, session-number parsing |
| `gm-publish` (Node) | init, build, inbox, flush, doctor, setup-status-bar, setup-inbox |

Code volume: Python shared scripts 2.6k lines + 1.8k test lines; mobrpg CLI
7.0k + 7.6k tests; publish tool ~5.4k lib lines plus tests and vendored deps.

## 3. Ranked candidates

Ranked by consequence-per-line, with overlaps merged across clusters. "Extend"
means add a subcommand to an existing script; roughly two-thirds of the list
extends rather than creates. Size: S <100 lines, M 100–400, L 400+.

### Tier 1 — silent-corruption and publish-leak fixes

| # | Candidate | Contract | Size | Home |
|---|---|---|---|---|
| 1 | **Version check** (8 skills do a semver compare by eye; `"1.8.9"` vs `"1.8.15"` sorts wrong lexically) | `vault_check.py VAULT version` → vault/plugin/verdict | S | extend |
| 2 | **Legacy canon-key repair** (the prose itself warns a blind rename leaves duplicate `canon_status:` keys and silently flips status) | `stamp_entities.py --repair-canon [--write]`; case 1/2 auto, case 3 surfaced | S–M | extend |
| 3 | **Wrap-up conformance** (player-facing H2 allowlist, single gm-only fence, filename, ~14 frontmatter predicates; failure mode is Keeper content on the player site) | `vault_check.py VAULT wrapup [--fix]` | M | extend; must also serve the 1.9.5 migration, which specifies the same transform a second time |
| 4 | **GM-leak scanner** (heading/bold keyword scan with fence *containment*, which grep can't express) | `vault_check.py VAULT gm-leak` | M | extend; also serves migration Step 3 and the adventure-brief check |
| 5 | **Current Status fence placement + PC body structure** (block must sit outside any fence, before Notes; nothing checks it) | `vault_check.py VAULT pc-body` | S–M | extend |
| 6 | **Generic frontmatter writes** (`--set`, `--increment`, `--promote`, `--supersede-by`, `--reconciled`) — retires four hand-bookkeeping procedures: campaign-overview update, session-index transitions, reconcile promotion, world-evolution stamps | `stamp_entities.py` flags | S | extend |
| 7 | **Session document chain** (derive status from which of plan / play-notes / wrap-up exist; `session_context.py` *selects the whole prep bundle from that status*) | `vault_check.py VAULT sessions` | M | extend |
| 8 | **Player-safe sheet view for the change-request loop** (converts a "remember not to look at GM Notes" rule into a data boundary) | `gm-publish sheet show --pc X --player-safe` | S | extend (filters exist in `lib/processor.js`) |

### Tier 2 — largest token sinks

| # | Candidate | Contract | Size | Home |
|---|---|---|---|---|
| 9 | **Rules lookup index** over `systems/` (7,611 table rows, 1.39 MB; a one-line trait cost costs ~6.5k tokens today; GURPS routing across six `traits-*.md` files has no key) | build-time JSON index + `rules_lookup.py SYSTEM "term" [--kind]` → row + file:line | M | new; supersedes the section-extraction experiment, which measured sections not records |
| 10 | **`_meta/index.md` rebuild** (the file declares itself derived; nothing derives it) | `index_build.py VAULT [--write]` | M | new; lift `check_index`'s resolver into a shared helper |
| 11 | **Session plan conformance** (fourteen stated rules, zero checks — see §4) | `plan_check.py PLAN.md [--headless]` | M | new, shaped like `gurps_check.py` |
| 12 | **Ingest survey** (classification scorer: 3 of 9 taxonomy rows decidable from extension/frontmatter alone; the other 6 scoreable from literal patterns the taxonomy already lists; turns "read everything" into "adjudicate the ambiguous") | `ingest_survey.py DIR` → manifest with per-indicator hits | M | new |
| 13 | **Image ingestion** (`image-handling.md` is a 162-line spec for a script nobody wrote; mobrpg already has a name matcher — reuse, don't write a third) | `ingest_images.py VAULT DIR [--execute]` | M | new, sharing mobrpg's matcher |
| 14 | **Narrative-plan discovery** (55 lines of prose in prep, duplicated in a session-play table cell; documents its own known failure mode) | `plans_index.py VAULT --chapter` | M | new |
| 15 | **At-table plan brief + thread ages** | `session_context.py --play`, `--threads` | S/M | extend |
| 16 | **publish-site rebuild path** (`update-pin`, `manifest diff` / `manifest apply`, `deploy --verify`; routine rebuild loads ~7.5k tokens of prose, needs ~1.2k) | three `gm-publish` subcommands | S/M/M | extend |
| 17 | **publish troubleshooting as diagnosis** (8 of 9 failure modes are deterministic; three exist only because the tool fails silently: untyped file, missing portrait, unresolved wikilink) | `gm-publish doctor --site`, `gm-publish explain PATH` | M | extend |

### Tier 3 — counting the model cannot do

| # | Candidate | Contract | Size | Home |
|---|---|---|---|---|
| 18 | World-flag traction, stale threads, Chekhov age, spotlight history (all "3+ sessions" thresholds applied to invented numbers today; spotlight feeds a GM decision) | `vault_check.py flags`, `threads`; `spotlight.py` | S–M | extend / new |
| 19 | `leads_to` traversal + Three Clue Rule (field made first-class in 1.8.39; nothing reads it) | `graph_check.py leads-to`, `clue-paths` | M | extend |
| 20 | Structural graph checks (required relationships per type, type-pair violations, hub overload = a standard deviation, redundant-pair table, containment scalar/edge pairing) | `graph_check.py relations`; extend `relationships` | M | extend; needs `schema_rules.py` to own tables that live only in markdown |
| 21 | World-rule evaluator (schema calls the rules "machine-checkable", then asks the model to be the machine) | `world_check.py VAULT` | M | new |
| 22 | Build validators for CoC 7e, D&D 5e 2024, PF2e, FitD, plus GURPS canonical-cost checks (only GURPS has a validator, and it is narrower than it reads) | `coc_check.py`, `dnd_check.py`, `pf2e_check.py`, `fitd_check.py`; `gurps_check.py costs` | M each | new; GURPS costs depend on #9 |
| 23 | Dice and table roller (no dice code anywhere; results not constrained to the table) | `roll.py "4d6dl1"`, `--table FILE#anchor` | S | new |
| 24 | Change-request loop as a program (`inbox watch` owns clamp, streak, dedup, heartbeat; `inbox commit` does build→deploy→reply transactionally; `sheet quote` and `sheet apply` do point math on the parsed model) | `gm-publish inbox watch` and `inbox commit`; `sheet quote` and `sheet apply` | M/M/L | extend |

### Tier 4 — scaffolds, writers, migration engine

| # | Candidate | Contract | Size | Home |
|---|---|---|---|---|
| 25 | Vault scaffold (~20 dirs + 17 templates by hand; described in three places; partial trees are silent) | `vault_scaffold.py ROOT --system X [--midwife\|--world\|--full]` | M | new |
| 26 | Wrap-up scaffold, story append (idempotent, refuses duplicate session heading), timeline append, GM-Notes insert (fence-aware) | small writers sharing `stamp_entities`' frontmatter module | S each | new |
| 27 | Rename + vault-wide relink (four link syntaxes + frontmatter; "a half-done rename breaks links silently") and heading re-nest (specified four separate times) | `relink.py`, `renest.py` | M each | new; factor `graph_check`'s link parser into a shared module |
| 28 | **Migration engine** (`migration-procedure.md` is a 247-line program in English; every step but "confirm" and one judgment batch is deterministic; 13 "version stamp only" entries are a data table) | `migrate.py VAULT plan\|apply --steps\|stamp` over ~9 primitives | L, mostly shared with #2, #4, #27 | new |
| 29 | Reconcile scan + spoiler list/reveal | `reconcile_scan.py`, `spoilers.py` | M/S | new, composed over vault_check |
| 30 | Entity table as machine output; active-PC set exposure (helper exists at `vault_check.py:442`, unexposed) | `vault_check.py entities --json`, `active-pcs` | XS/S | extend |
| 31 | QA orchestrator (dedupe across checks, sort by severity, fill the 9 hand-tallied `vault_stats` counts, sequence the filename) and a dismissed-findings register | `qa_run.py`, `vault_check.py dismissed` | M/S | new / extend |
| 32 | publish setup: `init` flags that write a valid `vault.config.json` (Step 15 is pure JSON transcription), `setup progress` owning the resume block, `config schema\|validate`, `schema types` | `gm-publish` subcommands | S each | extend |
| 33 | License/attribution: CI banner check per system; shingle-overlap scan (run once by hand for PF2e, never repeated) | `attribution_check.py`, `license_check.py` | S / M | new, CI + skill-invoked |

## 4. Defects found in passing

These were live when the analysis was written, independent of any
script work. **Status (2026-09-04):** everything below except the
`lib/scanner.js` silence, the three-copy entity schema, and the
`_flags.md` entry format was fixed in Mechanization Slice 0 (PR #193);
those three belong to Slices A, D and C respectively. The sub-reports
under `docs/mechanization-analysis/` are dated snapshots and keep
their original line references.

- **Four `systems/` files carry licensed mechanics with no attribution**:
  `fitd/rules-reference.md`, `fitd/mechanics.md`, `fitd/session-procedures.md`
  (CC-BY 3.0 requires it) and `gurps-4e/session-procedures.md` (the strictest
  license in the repo). Verified by grep.
- **`ttrpg-expert/relationship-patterns.md` teaches a vocabulary that does not
  exist.** Of 15 backticked types it lists, 1 (`fears`) is in the 77-predicate
  ontology; the other 14 (`friend`, `family`, `married`, `employer`,
  `reports_to`, `mentor`, `rival`, …) are not. Both `INDEX.md` and
  `the-midwife/SKILL.md` route to it. `vault_check.py relationships` (added for
  issue #130) ERRORs on anything authored from it.
- **`ttrpg-expert/campaign-structure.md`** is legacy database documentation
  (UUID/JSONB fields, a `PLANNED → COMPLETED → SKIPPED` lifecycle that
  contradicts `schema_rules.SESSION_STATUS`). `INDEX.md` still routes to it.
- **`ttrpg-expert/canon-management.md` carries ~40 lines of Go code** and a
  JSON conflict schema for a conflict store that does not exist in this repo.
  Pure token cost with a hallucination surface attached.
- **Two instruction contradictions**: `graph-health.md` tells the model to add
  bidirectional edges that `entity-schema.md` forbids storing; the
  name-similarity phonetic check is silently lost because the "preferred"
  script path doesn't implement it.
- **`session-templates.md` scene-type enum** omits `transition` and
  `downtime`, which `schema_rules.SCENE_TYPES` accepts.
- **`vault_check.py:494-497` records a deliberate decision** to drop the
  plan-wide agency scan; `continuity-engine.md` still instructs the full scan.
- **`lib/scanner.js:69`** skips files without `type:` with no warning; the
  troubleshooting prose then asks the model to diagnose the silence.
- **`gm-publish <cmd> --help`** prints top-level help for every subcommand
  except `flush`, so the skill prose is serving as the CLI's help text.
- **The entity schema exists in three hand-maintained copies** (markdown
  tables, `schema_rules.py`, each vault's `_meta/entity-types.md`) and CI
  checks only the predicate set.
- **`_flags.md` has no entry format** (three bare H2s), which blocks
  mechanizing world-fact dedup until it is pinned.

## 5. Python vs Go

### Facts that bear on the decision

**What the runtime guarantees.** The Claude Code native binary (the
recommended install, and what is on this machine) requires no Node and no
Python. The setup page lists ripgrep as the only additional dependency. On
macOS, installing a marketplace plugin needs git, which arrives with the Xcode
Command Line Tools, which also provide `python3`. On native Windows, Git for
Windows provides Bash but not Python; without it the Bash tool falls back to
PowerShell. So `python3` is likely but not guaranteed, `node` is neither, and a
compiled binary is the only artifact with zero runtime assumptions.

**How the plugin is shipped.** A marketplace plugin is a full git clone of the
repo into `~/.claude/plugins/cache/<name>/<version>/` (12 MB here, of which
7.9 MB is `tools/` with 367 vendored `node_modules` files committed). There is
no postinstall hook. A plugin `bin/` directory is put on PATH for
skills-directory installs but not for organization-managed ones.

**Release cadence and churn.** 66 tags in the last 90 days. Since May: 30
commits to `skills/shared/scripts`, 219 to `tools/publish/lib`, 142 to skill
prose.

**Three code surfaces already exist.** Python stdlib scripts (skill-invoked),
a pip-installed Python package (`mobrpg`), and a Node tool (`gm-publish`) that
requires Node 22 and whose Cloudflare Pages Functions can only be JavaScript.

**The "stdlib only" constraint has a real cost.** Four hand-rolled frontmatter
parsers exist across the shared scripts, none handling nested YAML; the
relationships list is parsed by a separate regex iterator. Go has no YAML in
its standard library either, so this cost is not language-specific; it is a
consequence of refusing dependencies.

### Go, assessed against this repo

What Go would buy: a single static binary with no runtime, fast startup,
static types, trivial cross-compilation, compiled-in dependencies (YAML,
goldmark). For a non-technical GM on native Windows, that is the one
distribution shape that just works.

What it would cost, concretely:

- **Distribution has no good path.** With no postinstall, binaries for five
  targets (darwin arm64/amd64, linux amd64/arm64, windows amd64; 3–5 MB each)
  must be either committed to the repo or downloaded on first run. Committed
  binaries at this release cadence add on the order of 1 GB per quarter to the
  history every user clones, because git cannot delta them. Download-on-first-
  run needs a bootstrap step the skill must perform before its first real
  call, a version-pairing scheme with the plugin version, and a trust story.
- **The scripts are living documents.** They change every couple of weeks and
  the model edits them in-session. A Go binary cannot be hot-patched, needs a
  toolchain and a CI cross-compile stage per release, and has no "try `python`
  if `python3` is missing" degradation.
- **Rewrite cost with no functional gain.** ~10k lines of Python and ~9.4k
  lines of tests to port before any new capability lands.
- **The biggest mechanization target can't move.** Twenty of the candidates
  above are `gm-publish` subcommands. That tool is Node because the Pages
  Functions, the templating stack, and the vendored deps are Node.

### Recommendation

**Stay on Python for skill-invoked scripts. Do not port to Go.** The language
is not the problem; the absence of code is. Go's one genuine advantage (zero
runtime) is outweighed by a distribution model that has no place to put a
binary and a change cadence that punishes compiled artifacts.

Three things to do instead, which recover most of what a Go rewrite would
nominally offer:

1. **One vault-model module.** Collapse the four frontmatter parsers and two
   wikilink resolvers into a single `vaultlib` in `skills/shared/scripts/`
   that every script imports (schema, frontmatter, links, sessions, active
   PCs). This is where the "stdlib only" pain actually lives.
2. **Type-check in CI.** `mypy --strict` on the shared scripts costs one CI
   step and buys most of what static typing would.
3. **Keep the Python floor at 3.10** with `from __future__ import annotations`,
   and keep the documented degradation path (no `python3` → prose fallback)
   honest by making every prose site *invoke* the script rather than restate
   it, so the fallback is the only place the restatement lives.

Revisit Go only if a roadmap item needs a long-running server binary that
cannot be a Cloudflare Worker, or if the plugin's primary audience becomes
native-Windows GMs with no toolchain. Neither is true today.

Node deserves a sentence: it is the stronger consolidation candidate than Go,
because `gm-publish` already contains a vault scanner, a GURPS sheet parser,
a markdown processor, and a wikilink resolver that duplicate the Python side.
But Node is not guaranteed either, the vault checks must work for GMs who
never publish, and the Python side has more tests. The duplication is worth
noting; it is not worth a migration.

## 6. Suggested sequencing

Prefer extending over creating. Fix the two instruction contradictions first,
because a script built on `graph-health.md:49-51` would enforce the opposite
of the schema.

1. **Slice A — safety and correctness (all S/M, all extensions):** version
   check; canon-key repair; wrap-up conformance; gm-leak; pc-body; generic
   stamp flags; sessions chain; `sheet show --player-safe`. Rewrite every
   prose site in the redundancy tables (§1 of each cluster report) to invoke
   the script instead of restating it.
2. **Slice B — token sinks:** rules lookup index; index rebuild; plan_check;
   `session_context --play/--threads`; plans_index; publish `update-pin`,
   `manifest diff`, `deploy --verify`.
3. **Slice C — ingest:** ingest survey; image ingestion (after extracting
   mobrpg's matcher).
4. **Slice D — counting and graphs:** flags/threads/spotlight; leads_to and
   clue paths; structural graph checks; world_check.
5. **Slice E — system validators + dice:** CoC first (most-used system), then
   D&D, PF2e, FitD, then GURPS canonical costs (needs the lookup index).
6. **Slice F — migration engine and writers:** relink, renest, then
   `migrate.py`, then the scaffolds and small writers.
7. **Slice G — license CI:** attribution banner check (would have caught four
   live defects), then the shingle scan.

Each slice should land with tests in `tests/`, an update to
`skills/shared/vault-access.md` (the routing table), and the corresponding
prose deletions, so the prose shrinks as the code grows.
