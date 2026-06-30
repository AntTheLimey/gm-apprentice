# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.7.10] — 2026-06-30

### Added

- **Published sites now have a "Story" section** — a curated, prose-first
  reading layer over the narrative that already lives in a vault, alongside
  the unchanged reference Wiki. A `/story.html` landing presents two
  branches:
  - **The Campaign Saga** — dedicated story pages built from each unit's
    `Narrative Recap`, walked in order with prev/next (cover to cover). The
    spine is *adaptive*: a chapter contributes one page, or one page per
    session, depending on where its recaps live. Chapters/sessions with no
    recap are omitted (no dead pages).
  - **Character Stories** — a dedicated prose page per PC built from
    `*_Story.md`, grouped Current / Retired / Fallen; the PC stat-sheet's
    Story tab now links to it.
  - The recap is found by heading wherever it lives — a separate wrap-up
    file or embedded in the session/chapter file — and matched even when
    decorated (e.g. `What Happened — Narrative Recap`). Units are paired by
    folder proximity (robust to free-form title refs). Story pages are built
    only from the published view (gm-only/excluded sections stripped), so no
    spoilers leak, and a vault with no narrative gets no Story section at all.
  - New modules: `lib/story-spine.js` (pure spine builder),
    `lib/templates/story.js`, `lib/templates/story-landing.js`. The "Story"
    nav points at the landing when a Story section exists.

### Changed

- `gm-apprentice-publish` bumped to 1.3.2.

---

## [1.7.9] — 2026-06-30

### Fixed

- **Excluded sections no longer leak when both config sources are set
  (B8).** `_meta/vault-config.md`'s `exclude_sections`/`exclude_dirs`
  silently shadowed `vault.config.json`'s lists (an `A || B`), so a section
  listed only in the JSON — e.g. `Source References` — was never stripped.
  The two sources are now unioned (case-insensitive dedupe), falling back to
  defaults only when neither is set.
- **Derived widgets no longer leak GM-only names (B6).** "NPCs in Play"
  (recency) and the relationship graph (via backlinks) scanned raw page
  markdown, surfacing entities mentioned only in `<!-- gm-only -->` blocks or
  excluded sections. Each page's "published view" (those stripped) is now
  computed once and used by backlinks and recency; graph edges derive from
  backlinks, so they are covered too.
- **Cross-subtree links no longer 404 (B3).** `wiki.js`, `location.js`, and
  `npc.js` passed a page's file path where `relativePath` expects a
  directory, adding an extra `../` that dropped a path segment (e.g. cross-
  chapter links lost `chapters/`). Added a `relativeHref(fromFile, toFile)`
  helper and routed all file-to-file links through it.
- **Wikilinks no longer render as raw underscore slugs (B1).** Body links
  showed `Lord_Percival_Harcourt`; display text is now humanized (underscores
  to spaces) for resolved and unresolved links, leaving explicit aliases
  untouched.
- **The 404 page is themed (B4).** It loaded `style.css` + `theme.css` but
  not `css/themes/<genre>.css`, so it fell back to default accents; the genre
  overlay link is now emitted.
- **Breadcrumb dead-links removed.** Breadcrumbs linked every last directory
  segment to `index.html`, but only top-level dirs get one — chapter
  subfolders 404'd; those segments are now plain text. The `parent_location`
  breadcrumb also used the root-relative output path as a same-dir href
  (resolving to `locations/locations/…`); it is now made relative.
- **More raw-slug surfaces humanized.** Beyond body wikilinks (B1), event
  participant/location links and item holder/origin links showed raw
  underscore slugs; all now humanize via a shared `humanizeName` helper,
  preserving explicit aliases. Against the Canticle vault this drives broken
  links from 586 (pre-fix) to 15 and raw-slug links from 2043 to 0 (the
  remaining 14 broken are relationship-graph SVG node paths, tracked
  separately).
- **Sparse sidebars no longer squeeze the article (B2).** A page with a
  single small sidebar box still reserved the full 18rem column; sidebars
  with ≤1 section now collapse to a single comfortably-wide column.

### Changed

- `gm-apprentice-publish` bumped to 1.3.1.

---

## [1.7.8] — 2026-06-29

### Fixed

- **Publish build no longer fails on a clean install with "Cannot find
  module 'gray-matter'".** The `gm-apprentice-publish` tool is distributed
  by git-copying the repo into the plugin cache; a site pins it with a
  `file:` dependency, which npm satisfies by symlinking the cached copy.
  Node then resolves the tool's `require()`s from the cache, where
  `npm install` never runs — so its runtime deps were absent. The tool now
  **vendors** its production dependencies (`gray-matter`, `lunr`,
  `markdown-it` + transitive) as committed files, so a fresh install builds
  with no manual steps and offline. A root `.gitignore` negation tracks the
  subtree; `tools/publish/README.md` documents re-vendoring.
- **Stale build-tool version pins no longer fail silently.** A bare
  `/plugin` update drops a new version into the cache but leaves existing
  sites pinned to the old one, so builds kept using the old renderer (e.g.
  the new Phoenix GURPS sheet didn't appear). The build CLI now detects this
  drift at startup — comparing the version it runs as against the newest
  installed in the cache — and prints a loud warning naming the exact `file:`
  path to switch to. The publish-site routine-update flow (capability 2) and
  troubleshooting guide were tightened to repoint reliably and verify the
  repoint took effect.

### Added

- `tools/publish/lib/version-check.js` — `detectVersionDrift()`, with unit
  coverage for semver comparison, no-drift, dev-checkout, and non-semver
  sibling cases.
- Build CLI preflight that reports missing runtime dependencies with
  actionable remediation instead of a raw stack trace.
- `clean-install` integration test (mirrors a git-copy cache + symlinked
  site, fully offline) and a `runtime-deps` test that fails if any declared
  dependency is not both requireable and git-tracked.

### Changed

- **Committed fully to the plugin-cache distribution model for the publish
  tool.** The build tool ships inside the plugin and is driven from the
  plugin cache, never the npm registry (which lagged at 1.2.1 and risked
  version skew between the renderer and the skill). `init` now auto-pins a
  new site's `package.json` to the exact cache version it ran from — the
  scaffold default changed from `"latest"` to a self-referential `file:`
  pin — so a new site needs no manual repoint and no registry round-trip.
  The publish-site SKILL, setup wizard, and tool README were updated to
  drive `init` from the cache and to stop pointing users at npm.
- `gm-apprentice-publish` bumped to 1.3.0; lockfile version realigned to
  1.3.0 (it was stale at 1.2.1, two patches behind the previous
  `package.json` value of 1.2.3).

---

## [1.7.7] — 2026-06-29

### Added

- **GURPS character sheets now publish as a complete Phoenix-style record.**
  A new `tools/publish/lib/templates/gurps/` module replaces the previous
  thin renderer. It reads standard markdown-table vault format (with optional
  frontmatter overrides) and produces three output payloads assembled by the
  PC shell:
  - **Character Sheet** — 2-column block flow: attributes/secondary/derived,
    lifting feats + slam derived tables, active defenses + hit-location DR,
    senses + checks, encumbrance ramp, reaction modifiers, cultural
    familiarities + languages, advantages/perks/disadvantages/quirks/templates,
    skills with effective levels + footnote legend + parry/block sub-lines,
    techniques, spells, points summary, melee + ranged attack tables, grimoire.
  - **Combat tab** — dedicated dashboard tab with current status banner,
    active defenses, melee and ranged attack tables, combat action chains +
    multi-action chains, and a collapsible rules-reference appendix (hit
    location B552, size/speed-range B550) with source citation. Appears only
    for GURPS vaults; non-GURPS PCs are unaffected.
  - **Equipment tab** — Phoenix-styled inventory table + per-load-out tables
    with totals footer. Parses `## Equipment` and `### Encumbrance` / `### Load-Outs`
    subsections from the PC body.
  - Always-on footnote legend, page citations (`{p. Bxxx}`), and parry/block
    sub-lines on skill rows. Dark/light theming via CSS variables. Print styles
    force all tabs visible and rules-reference open.
  - Parser hardening: header-row guard, cost-column auto-detection, encumbrance
    subsection fallback, skill cross-reference to active defenses and melee
    weapon parry values.

---

## [1.7.6] — 2026-06-28

### Fixed

- **Non-Earth campaign dates are no longer corrupted.** Three skills told
  agents that `in_game_date` "must be parseable by JS `new Date()`"
  (`session-wrapup`, `vault-ingest`, and the shared
  `session-document-chain.md`). That was wrong: the published timeline
  parser (`tools/publish/lib/timeline.js`) anchors on a 4-digit year and
  accepts ISO, month-name, and seasonal forms — it does not require a
  `new Date()`-parseable string. A compliant agent following the old rule
  would *fabricate* a Gregorian date for a fantasy/sci-fi calendar (e.g.
  rewriting "14th of Flamerule, 1492 DR" as "July 14, 1492"), silently
  losing the campaign's real date. The rule now says to record non-Earth
  dates in the world's own format and never invent a Gregorian date to
  satisfy the parser. `play_date` is clarified as `YYYY-MM-DD`.

---
## [1.7.5] — 2026-06-27

### Changed

- **The PC `## Current Status` block is now load-bearing.** PR #57 made it
  a canonical, cumulative PC body block but left it read only by the
  website and the GM. Four skills now consume it: **session-prep** folds
  each active PC's `Open threads` into its Threads review (fixing
  "thread-decay" — a thread no longer vanishes just because it fell out of
  the last session's carry-forward) and reads `Open threads` /
  `Knows (exclusive)` in its per-PC arc check; **the-midwife** mines it for
  new-chapter hooks; **ttrpg-expert** routes its arc/thread commands
  through it; **campaign-qa** gains a Canon Audit consistency check
  (missing/empty block on an active PC, or an `Open threads` item the
  timeline shows resolved). The read contract lives in
  `ttrpg-expert/arc-spotlight-reference.md` and `continuity-engine.md`
  (the bottom-level references the others already load), with a
  `Consumed by:` pointer in `shared/entity-schema.md`. A new
  `tests/test_current_status_consumers.py` regression (run in CI) fails if
  any consumer is silently un-wired. No schema or template change.

## [1.7.4] — 2026-06-26

### Fixed

- **session-wrapup now keeps PC entity sheets current.** Wrap-up advanced
  each active PC's Story file (Step 3b) and the campaign overview (Step 4b)
  every session, but never the PC's own entity sheet — so its `asOfSession`,
  `lastUpdated`, chapter `tags`, and especially the player-facing
  `## Current Status` block froze at whatever session it was last hand-edited.
  Because `## Current Status` publishes (it sits outside the `<!-- gm-only -->`
  fence), the live character page rendered a stale status that contradicted
  the current Story narrative on the same page. A new **Step 3c (PC Sheet
  Refresh)** reconciles those fields and the `## Current Status` block every
  wrap-up, skipping `dead` PCs.

### Added

- **`## Current Status` is now a canonical PC body section.** Documented in
  `shared/entity-schema.md` and added to all six `pc-*` templates as a
  skill-maintained, player-facing block holding the PC's **cumulative living
  state** in labelled fields (`Location`, `Condition`, `Carrying`,
  `Open threads`, `Knows (exclusive)`) — the counterpart to the protected
  `## Notes`/`## GM Notes`. Each wrap-up reconciles it cumulatively:
  unresolved `Open threads` carry forward across sessions, new ones are
  added, resolved ones removed — so a single read of the latest sheet gives
  the always-current state without walking old wrap-ups. Existing sheets
  self-heal on their next wrap-up.
- **PC freshness check** (`validate_schema.py freshness <vault>`): flags
  active PC entity sheets whose `asOfSession` lags the campaign overview's,
  with a Python regression suite (`tests/test_pc_freshness.py`) and fixture.
  Pointed at a vault with the old behaviour it fails; after a wrap-up it
  passes — guarding the drift from returning.

---

## [1.7.3] — 2026-06-26

### Fixed

- **"NPCs in Play" now reflects who's actually in recent play.** `scoreByRecency`
  identified recent sessions by `session_number`, which breaks when a chapter
  restarts numbering (Calcutta 1–3 ranked below Vienna 12–14), so the landing
  surfaced old NPCs. It now selects recent sessions by `play_date`, scores
  mentions from the paired **wrap-up recaps** (the session index pages are thin
  stubs), counts sessions that are still in the `wrap-up` state (played but not yet
  reviewed), and **recency-weights** so the latest session counts most. Terminal-status
  entities (dead, destroyed, …) are no longer hidden outright — they appear when
  they feature in the **latest** session (e.g. an NPC who just died) and are
  otherwise retired from the list.

---

## [1.7.2] — 2026-06-26

### Fixed

- **Landing page reflects authoritative campaign state.** The hero (in-game date
  and session count) and the *Latest Session* card now read `current_game_date`,
  `sessions_played`, `last_session`, and `last_play_date` from the `_Campaign`
  overview frontmatter (maintained by `session-wrapup`) instead of re-deriving
  them by scanning session pages. The overview is located by its
  `type: campaign_overview` frontmatter — not by filename, so a renamed overview
  such as `Campaign_Overview_Updated` still works — and is read from the full
  vault corpus, so it applies even though the overview is normally excluded from
  publishing. `getLatestSession` now sorts by `play_date` (most recently played),
  with `session_number` only as a tiebreak, so chapters that restart session
  numbering no longer surface the wrong "latest" session. All fields fall back to
  the previous behaviour when absent.

### Internal

- `build` now exposes the full scanned corpus to the landing template, kept
  separate from the manifest publish-filter that governs what is rendered.

---

## [1.7.1] — 2026-06-06

### Added

- **Content-fidelity shared rule** — `skills/shared/content-fidelity.md`
  establishes preserve-by-default for content-moving operations: moving
  existing prose preserves it verbatim; authoring new prose is an explicit,
  justified exception. Includes the block/seam test for mixed operations.
- **Compactor rationale category** — the skill-compactor now treats rule
  rationale ("why") as a preserved category, so the reasoning behind a rule
  is not stripped as verbose connective tissue.

### Changed

- **Fidelity guards across skills** — the-midwife (plan promotion, brief
  synthesis), campaign-organizer (Organize, Dissect, Weave), session-wrapup
  (recap, character story, new entities, timeline), vault-ingest (synthesis,
  backstory entries), and session-prep now carry explicit preserve-guards or
  grudging authoring carve-outs pointing at `content-fidelity.md`.
- **campaign-organizer Dissect** — removed the "body summary" instruction;
  each entity now carries its source slice verbatim rather than condensing it.

---

## [1.7.0] — 2026-05-30

### Added

- **Plan entity type** — new `plan` entity under `narrative`
  hierarchy with `plan_type` discriminator (arc, scene,
  investigation, timeline). Plans live in `Planning/` under
  their chapter directory, capturing the GM's narrative
  planning content (scene designs, arc structures,
  investigation flows, timelines) as first-class vault entities.
- **Plan template** — `skills/shared/templates/plan.md` added
  as canonical template for plan entities
- **Midwife plan promotion** — Phase 4 handoff now promotes
  narrative planning content from `_midwife/` to vault
  `Planning/` folder alongside existing entity promotion
- **Session prep plan surfacing** — context gathering reads
  `Planning/` and surfaces relevant scene plans for the
  upcoming session
- **Session play plan lookup** — scene plans accessible via
  mid-game routing table
- **Campaign QA plan validation** — graph health checks
  validate plan entity frontmatter and references
- **Vault ingest plan support** — planning content from
  external sources can be ingested as plan entities
- **Schema validation** — `validate_schema.py` validates
  plan entities (required fields, plan_type enum)
- **Migration 1.6.6 → 1.7.0** — documents structural and
  content changes for existing vaults

---

## [1.6.6] — 2026-05-28

### Added

- **World evolution in reconcile** — reconcile step 5.5
  offers faction turns, consequence surfacing, foreshadowing
  review, and discovery state updates after session confidence
  is promoted. Gated to most recent session only.
- **`world-evolution` entity source** — entities created by
  the world-evolution procedure are tagged with
  `source: "world-evolution"` for provenance tracking
- **`world_evolved` session field** — session index records
  when world-evolution has run, preventing duplicate offers

### Removed

- **campaign-tracker.md references** — removed dead reference
  from campaign-organizer. The file was never created; its
  functionality is covered by the entity schema and session
  document chain.
- **Tracking templates** — replaced consequence tracker,
  foreshadowing log, campaign tracker, and per-PC discovery
  state templates in world-evolution.md with a pointer to the
  entity schema where these are now tracked

### Changed

- **world-evolution.md** — Storage Checkpoint and timeline
  entry marked standalone-only (reconcile skips both). Filing
  protocol updated for reconcile handoff.

## [1.6.5] — 2026-05-22

### Added

- **Heritage page template** — stat card (lifespan, maturity,
  height), notable traits badges, portrait, relationship graph,
  and context sidebar for published heritage pages
- **World domain page template** — rules sidebar (hideable via
  `publish_rules: false`), summary subtitle for world domain
  pages
- **World nav group entries** — World Overview and Heritages
  added to the World navigation group
- **Vault config template** — `_World` and `Heritages` folder
  mappings added to scaffold template

### Fixed

- **Landing page recap** — now extracts narrative from the
  session's Wrap-Up file instead of the session index
- **Landing page recap link** — points to the Wrap-Up page
  instead of the session index
- **Wrap-up sidebar suppression** — wrap-up pages no longer
  show a "Mentioned In" backlinks sidebar that compressed
  content
- **World flags exclusion** — `_flags.md` (`type: world_flags`)
  is skipped during build instead of generating an error page

### Fixed (upstream from publish-patches-1.5.1)

- **Session count includes reviewed status** — landing page hero
  now counts both `played` and `reviewed` sessions; supports
  `total_sessions` config override
- **Chapter status fallback** — chapters with `status: complete`
  in frontmatter render correctly even without published session
  index files
- **Scanner uses frontmatter title** — `displayTitle` prefers
  frontmatter `title` over filename, fixing redundant session
  titles on chapter index pages

---

## [1.6.4] — 2026-05-22

### Added

- **Session-prep deferred flag surfacing** — world threads
  gaining traction are surfaced during prep (awareness only,
  no prompts)
- **Campaign-QA world consistency audits** — heritage
  consistency, geographic plausibility, economic coherence,
  timeline contradictions, and deferred flag review
- **World audit criteria reference** — hard checks vs soft
  checks, scoping rules, output format

---

## [1.6.3] — 2026-05-22

### Added

- **Session-wrapup world fact detection** — scans session notes
  for unrecognized heritages, place names, cultural practices,
  deity names, and other world facts; stages findings for
  reconcile review
- **Reconcile step 2.5** — world fact review with three-state
  prompts (canon/ignore/defer) during post-session reconciliation
- **Reconcile step 5 world-rule validation** — checks entities
  against `_World/` rules during promotion to AUTHORITATIVE
- **Deferred flag accumulation** — mention counting and
  resurfacing for deferred world facts
- **World fact detection heuristics** — signal/noise distinction
  reference for session-wrapup scanning

---

## [1.6.2] — 2026-05-22

### Added

- **Entity validation against world rules** — campaign-organizer
  checks NPCs, locations, and factions against `_World/` domain
  rules during creation and updates
- **Three-state flag prompts** — violations surface as advisory
  prompts with canon/ignore/defer responses
- **Ad-hoc bootstrap** — world infrastructure created on demand
  when validation needs a domain file that doesn't exist yet

---

## [1.6.1] — 2026-05-22

### Added

- **Midwife standalone worldbuilding mode** — why-chain
  conversations for fleshing out world domains, with per-domain
  question banks, cross-domain implication surfacing, and
  Second-Order Notes
- **Midwife woven worldbuilding** — one-question why-chain
  prompts during adventure creation when world facts are implied
- **Worldbuilding reference files** — question banks (10
  domains), cross-domain implication matrix, spiral/iceberg
  principles, pitfall avoidance
- **TTRPG-expert worldbuilding advisory** — principles reference
  with per-system notes and midwife handoff
- **Worldbuilding benchmarks** — A1-A6 purposeful worldbuilding
  and C2 adventure creation regression

---

## [1.6.0] — 2026-05-22

### Added

- **Heritage entity type** — first-class vault entity for species/ancestry
  definitions with lifespan ranges, maturity age, notable traits, and
  Second-Order Notes
- **`_World/` vault layer** — 10 domain files for world rules (heritages,
  geography, history, politics, economics, magic/technology, cosmology,
  culture, ecology, language), each with machine-checkable rules
- **Three-state flag system** — `_flags.md` tracks world facts as canon,
  ignored, or deferred with accumulation and resurfacing
- **Organization hierarchy** — `part_of` field on faction/organization
  entities enables nested political, military, and religious structures
- **Era field** — optional `era` universal field for temporal referencing
  against world history eras
- **World structural templates** — world-index, world-flags, world-domain,
  heritage, and faction templates in `skills/shared/templates/`
- **Schema validation** — `heritage`, `world_domain`, `world_flags` types
  and `WORLD_DOMAIN_STATUS` enum in `validate_schema.py`
- **Benchmark fixtures** — `_World/` and `Heritages/` test data in
  benchmark campaign

---

## [1.5.3] — 2026-05-16

### Added

- **Gotchas sections** — consolidated critical constraints with inline
  reasoning added to vault-ingest (5) and the-midwife (4). Placed
  before workflow steps to front-load common failure modes.
- **Validation loops** — inline self-check steps after entity creation
  in vault-ingest and the-midwife. Re-read file, compare frontmatter
  against template, verify type/confidence/wiki-links, fix before
  proceeding.
- **Why-reasoning** — downstream-consequence explanations added to bare
  directives in vault-ingest (vault dependency) and the-midwife
  (session-prep invocation).
- **Benchmark questions** — new test suites for vault-ingest (4 Qs) and
  the-midwife (4 Qs), matching the existing session-wrapup and
  campaign-organizer format.

---

## [1.5.2] — 2026-05-12

### Added

- **Campaign overview template** — new `campaign_overview` entity type
  with frontmatter for game date, session tracking, and narrative
  position (arc/chapter progress).
- **Session-wrapup auto-updates** — campaign overview mechanical fields
  (game date, session count, last session, last play date) updated
  after each wrap-up with GM confirmation.
- **The-midwife integration** — creates campaign overview during vault
  scaffolding, populated from the adventure brief conversation.
- **Publish tool rendering** — campaign landing page shows new sections
  (Premise, Setting, Key Themes, Key Factions) with game date and
  current arc param cards.

### Changed

- Publish tool landing page replaces Known Threats / Key Organizations
  / Key Individuals sections with Setting and Key Factions.

---

## [1.5.1] — 2026-05-09

### Added

- **the-midwife skill** — guided adventure creation through
  creative conversation. Handles greenfield campaigns and
  existing vault continuations (new chapters, arcs, prequels,
  time jumps). Produces an adventure brief and scaffolds the
  vault for Session 0 handoff.
- **adventure-brief entity type** — new entity under
  `narrative (abstract)` for structured adventure design
  documents with scope, shape, and continuation metadata.
- **Adventure Shapes framework** — structural skeleton
  taxonomy (linear, branching, hub-and-spoke, open-node,
  sandbox) in scenario-writing reference.
- **CATS pitch method** — Concept/Aim/Tone/Subject session 0
  pitch framework in gm-session-patterns reference.
- **One-shot and few-shot structural guidance** — conception-
  phase constraints and principles in scenario-writing
  reference.
- **Victory-state antagonist design** — reverse-engineering
  villain plans from victory state in scenario-writing
  reference.
- **Playability stress test** — checklist for testing RPG
  viability of adventure concepts.
- **Midwife workspace** — per-adventure working directories
  with automatic topic splitting, shared seed bank, and
  context-aware reading. Replaces monolithic
  `_midwife-notes.md`. Supports multiple adventures in
  parallel.
- **Adventures/ subfolder convention** — adventure briefs
  now live in `Adventures/{adventure-name}/` subdirectories.
- **`_midwife/` vault folder** — creative workspace added
  to vault structure for midwife working files.

## [1.5.0] — 2026-05-09

### Added

- **FitD: gathering-information.md** — SRD gathering info mechanics:
  effect levels, action-specific questions, long-term projects, GM
  guidance for calibrating disclosure
- **FitD: cohorts.md** — consolidated cohort rules: gang types, experts,
  edges/flaws, cohort harm, supervised vs unsupervised use, elite
  upgrades
- **FitD: gm-techniques.md** — practical GM reference: consequence
  fiction with original examples, devil's bargain design, position/effect
  3×3 matrix, clock patterns and anti-patterns
- **FitD: rituals-crafting.md depth pass** — 4 original example rituals
  (ward, compulsion, divination, transformation) and 4 sample
  alchemicals/gadgets with drawbacks
- **Personal reference file routing** — ttrpg-expert, session-play,
  session-prep, and session-wrapup skills now discover and use
  `systems/*/personal/` directories for setting-specific content

### Changed

- **FitD copyright compliance** — stripped Doskvol setting IP from all
  public FitD files. Named factions, NPCs, heritage regions, and
  setting descriptions removed or genericized. Faction mechanics, crew
  frameworks, and playbook role descriptions preserved as SRD content.
- **FitD: factions.md** — retitled "Faction Mechanics", reduced from
  171 to 77 lines. Named factions removed; faction status table, tier
  rules, claims, and faction turn procedure retained.
- **FitD: setting-doskvol.md deleted** — pure setting IP, replaced by
  personal reference files

### Removed

- **FitD: setting-doskvol.md** — Doskvol setting content (not covered by
  CC-BY 3.0 SRD license)

---

## [1.4.22] — 2026-05-08

### Fixed

- **Timeline date parsing** — timeline now reads `in_game_date` (falling
  back to `date` for pre-migration vaults). Vague dates like "Autumn 1813"
  now parse to approximate months instead of defaulting to January 1.
- **Chapter-session matching** — chapter pages now find their sessions via
  three-stage matching (exact filename, filename with spaces, display title
  substring). Previously failed when session `chapter:` values didn't
  exactly match the chapter page title.
- **Genre preset override** — custom theme.css no longer stomps genre
  preset colors when no custom palette is provided. Config sets palette to
  null instead of spreading defaults.
- **Stale npm detection** — publish-site routine updates now check the
  build tool version against the plugin cache and auto-update the `file:`
  dependency path if stale.

### Changed

- **Schema: event `date` → `in_game_date`** — event entity frontmatter
  field renamed for consistency. Migration 1.4.22 auto-applies the rename.
- **Schema: session `planned_date`/`actual_date` → `play_date`** — two
  legacy fields consolidated into one. Migration 1.4.22 picks the
  `actual_date` value (or `planned_date` if that's all that exists) and
  removes both old fields.
- **Session wrap-up conventions** — standardized filename
  (`Session_NN_Wrap_Up.md`), frontmatter type (`session_wrap`), and date
  format guidance (JS-parseable values only).
- **Publish tool field references** — landing page, location pages, badges,
  and event sorting all use new field names with backward-compatible
  fallbacks.

### Added

- **Migration 1.4.22** in `shared/migrations.md` — structural renames for
  event and session date fields; opt-in wrap-up `type` standardization
- **Deprecation warnings** in `validate_schema.py` — flags `date` on events
  and `planned_date`/`actual_date` on sessions
- **`session_wrap` type** recognized in schema validation alongside legacy
  `session-wrap-up`

## [1.4.21] — 2026-05-06

### Added

- **Story progression page** (chapters index) — chapter cards with session lists, status badges
- **Bestiary page** (creatures index) — dossier cards with threat/status badges, abilities/weaknesses pills
- **Theater of Operations** (locations index) — region-grouped layout with parent/child nesting
- **Intelligence Briefing** (factions index) — cards grouped by type with goals, leadership, connections
- **Armory & Acquisitions** (items index) — manifest rows grouped by item type with holder/origin/TL
- **Campaign deep dive** — extracted sections from campaign overview with resolved wikilinks
- **GURPS combat stats bar** on PC sheets — HP, FP, Speed, Move, Dodge, Parries, skills
- **Events index redirect** to timeline page
- **Schema change procedure** checklist (`docs/schema-change-procedure.md`)
- **`in_game_date` array support** for multi-day sessions in timeline

### Fixed

- PC portrait now constrained card layout instead of full-width crop
- Tab-tag clicks now open corresponding accordion section on PC pages
- Empty Relationships/Appearances boxes hidden on PC pages
- Weapons/encumbrance sections moved to Equipment tab (not Sheet)
- Bestiary badges now labeled "Threat:" / "Status:" for clarity
- Nav label "Chapters" renamed to "Story"
- Integration test updated for new locations/creatures page structure

### Changed

- Publish tool npm package bumped to 1.2.1 (patch: QA fixes + index page overhauls)

## [1.4.20] — 2026-05-04

### Added

- **Dark-first responsive CSS** with CSS custom properties and mobile-first breakpoints
- **4 genre preset themes** (horror, fantasy, noir, military) with dark + light mode variants
- **Semantic top navigation** with 4 groups: Story, Characters, World, Reference
- **Breadcrumbs** on all entity pages with path-based crumb generation
- **Backlink resolution engine** — scans wiki-links to build reverse index
- **Recency scoring engine** — weights entities by recent session mentions
- **Full-text search** with lunr.js (Cmd+K overlay, lazy-loaded index)
- **Image lightbox** — pure JS lightbox for all content images
- **8-zone landing page** — hero, recap, team, in memoriam, NPCs, locations, events, explore
- **Index pages** with pill filters, name search, sort controls, and type-specific layouts
- **Context sidebar** on all entity pages showing backlinks, relationships, and parent entity
- **Location pages** with 6-zone layout: hero banner, pull-quote, sub-locations, NPCs, events
- **NPC pages** with 6-zone layout: portrait banner, location card, relationship web, story arc
- **PC pages** with cinematic hero banner and 4-tab layout (Sheet, Equipment, Story, Journey)
- **4 system-specific character sheet renderers** — CoC 7e, GURPS 4e, D&D 5e, FitD
- **SVG relationship graphs** with 2-hop radial layout on all entity pages
- **Campaign timeline** — full-page SVG with zoom controls and landing strip
- **Story/chapter nav** with prev/next links and enriched sidebar (NPCs, events, sessions)
- **Client-side index filters** — pill toggle, name input, sort-select for index pages
- **session-wrapup** gmassistant.app passthrough — when Play Notes are a gmassistant.app export (detected by `## Memorable Moments` heading), adopts the app's narrative summary verbatim and uses its structured NPC/Location/Item sections as entity input instead of regenerating from scratch

### Fixed

- `getLatestSession` now includes `reviewed` sessions (not just `played`)
- `formatDate` no longer shifts dates by timezone offset (UTC parsing fix)

### Changed

- Publish tool npm package bumped to 1.2.0 (minor: new features, no breaking changes)
- Location, NPC, PC, and wiki templates fully rewritten with modern layouts

## [1.4.19] — 2026-05-03

### Added

- Confidence badges in published sites (Draft, Stub, Superseded)
- `exclude_drafts` publish config option to filter DRAFT entities from sites
- Stale DRAFT detection in campaign-qa (WARNING after 3+ sessions)
- SUPERSEDED entities must declare `superseded_by` (enforced in CI)
- Session 4 + confidence test entities in benchmark campaign

### Fixed

- Publish tool now reads `source_confidence` field (was checking nonexistent `canon_status`)
- SUPERSEDED link-map redirect now works against real vault entities

## [1.4.18] — 2026-05-03

### Changed

- **session-play enrichment** — expanded from 80 to 129 lines with direct routing for common mid-game needs (rules disputes, improv NPCs, spotlight management, combat pacing, scene recovery)
- Added Common Mid-Game Lookups routing table pointing to exact files and sections in ttrpg-expert
- Added Capture Shorthand section documenting entity extraction markers (`NEW-NPC:`, `NEW-LOC:`, `UPDATE:`, etc.) that session-wrapup expects
- Explicit companion reference to `active-play-management.md` for GM-craft advice during play

### Removed

- Fix 9 (Filesystem Mode Honest Labeling) dropped from Fix and Fortify design spec

---

## [1.4.17] — 2026-05-03

### Changed

- **D&D monster data enrichment** — 235 monster stat blocks expanded with full SRD 5.2 combat data: ability scores, attack bonuses, damage dice, save DCs, traits, and legendary actions
- Monster CR 11+ split into `cr11-16` and `cr17-plus` sub-files for headroom
- ATTRIBUTION.md updated with expanded SRD 5.2 content note

### Fixed

- Enricher script: combat traits (Heated Body, Trampling Charge) no longer stripped in normal mode
- Enricher script: two-stage save abilities (Paralyzing Breath, Petrifying Breath) now fully parsed
- Enricher script: spellcasting-style actions (Ice Wall, Hellfire Spellcasting) now rendered correctly
- Enricher script: SRD path configurable via CLI argument; size limit aligned to 25 KiB
- Corrupted spell rows fixed: Forcecage, Fly, Knock, Moonbeam, Freedom of Movement, Greater Invisibility
- Missing magic item effects restored: Ring of Telekinesis, Wand of Fear, Belt of Dwarvenkind
- CI lint: `find` command no longer fails when `references/` directory is absent
- Missing migration registry entries for 1.4.16 and 1.4.17 added

---

## [1.4.16] — 2026-05-03

### Added

- **D&D response templates** — spell lookup/browse, magic item lookup/browse, and monster standard/boss templates added to index file headers

---

## [1.4.15] — 2026-05-02

### Changed

- **D&D reference decomposition** — spells.md (79KB), magic-items.md (40KB), and monsters.md (23KB) split into compact indexes + sub-files; no sub-file exceeds 25KB
- CI enforces 25KB reference file size limit

---

## [1.4.14] — 2026-05-02

### Fixed

- Migration version auto-synced from plugin.json at build time
- Content filtering now makes deterministic decisions for cut/skipped/modified scenes

### Added

- Reconcile fast-path for straightforward sessions
- Proof-run infrastructure: 5-run statistical benchmark with median/IQR analysis
- CI checks: migration version sync, content filtering validation

---

## [1.4.13] — 2026-05-02

### Fixed

- **Session-prep: GM approval gate** — Step 13 (Scene Design) now
  proposes each scene to the GM before writing it to the Plan file.
  The GM approves, tweaks, or rejects each scene individually.

---

## [1.4.12] — 2026-05-01

### Added

- **Development workflow** — CLAUDE.md now documents the required
  branch → implement → version bump → changelog → review → PR → merge
  sequence for all non-trivial changes
- **PR discipline checks** — CI warns on missing version bumps and
  changelog updates; blocks on broken build script output

---

## [1.4.11] — 2026-05-01

### Added

- **Automated releases** — GitHub Action creates tagged releases with
  skill zips on version bump; skill zips attached as release assets
  for users who can't install plugins
- **Build script** — `scripts/build-skill-zips.sh` packages each skill
  as a self-contained zip with shared references bundled
- **Individual skill upload docs** — README and quickstart updated with
  instructions for uploading skill zips to Claude Desktop

### Fixed

- **ttrpg-expert description** — trimmed to 983 chars to fit the
  1024-character limit for skill descriptions
- **Claude Desktop install instructions** — updated for the new
  Cowork > Customize > Personal plugins UI flow
- **Stale skill counts** — README Obsidian section and quickstart now
  reference all 8 skills

---

## [1.4.10] — 2026-05-01

### Fixed

- **GURPS PC template** — Skills and Spells sections now enforce single alphabetized tables with no category sub-headings
- **Mobile: accordion table scroll** — Wide tables inside accordion sections scroll horizontally on mobile instead of overflowing
- **Mobile: back-to-top button** — Fixed-position button appears after 400px scroll on all published pages

---

## [1.4.9] — 2026-04-26

### Added

- **Vault versioning and migration system** — vaults now track `gm_apprentice_version` in vault-config; every vault-aware skill checks the version on first invocation and runs campaign-organizer's migration workflow if the vault is behind the plugin version
- **Migration registry** — `skills/shared/migrations.md` defines the current version and per-version migration steps in three categories: structural (auto), content (opt-in), and tooling (opt-in)
- **Publish site directory in vault-config** — `publish.site_dir` field stores the site repo path so the publish-site skill reads it directly instead of asking each session
- **Vault-config field documentation** — entity schema now documents all vault-config frontmatter fields

---

## [1.4.8] — 2026-04-26

### Added

- **Tabbed PC page layout** — published PC pages now show Character Sheet and Story in a two-tab layout with hash-based routing (`#sheet`, `#story`) for direct-linking
- **Story companion rendering** — `{Name}_Story.md` files auto-discovered alongside PC files and rendered as prose narrative in the Story tab; validated via `type: character-story` frontmatter
- **System renderer registry** — dispatch architecture (`pc-registry.js`) decouples layout from system-specific rendering; ships with default renderer, ready for per-system overrides
- **Enhanced stat sheet CSS** — alternating row shading, monospace numeric values, responsive table collapsing, serif prose sections, print styles for tabbed layout

### Changed (publish tool)

- Publish tool version bumped to 1.1.0

---

## [1.4.7] — 2026-04-26

### Added

- **Story lifecycle** — session-wrapup Step 3b writes per-PC character story entries after each session; vault-ingest reconstructs consolidated backstory entries from historical material and recognizes wrap-up files as a source type; campaign-qa Graph Health validates story file existence and recency for active PCs

---

## [1.4.6] — 2026-04-25

### Added

- **Character sheet templates** — 8 canonical vault templates in `skills/shared/templates/` covering GURPS 4e, CoC 7e (base + Regency variant), D&D 5e 2024, FitD (scoundrel + crew), and a generic fallback
- **Character story format** — `skills/shared/character-story-format.md` defines companion story file structure, narrative voice by campaign genre, writing rules, and append protocol
- **PC body structure in entity schema** — canonical heading hierarchy (Stat Sheet → Background → System Sections → Equipment → Notes → GM Notes) and story companion convention documented in `entity-schema.md`

---

## [1.4.5] — 2026-04-25

### Added

- **Skill taxonomy table** in README — documents all skill categories, roles, and boundaries with the advisor/doer distinction
- **ttrpg-expert capabilities table** in `docs/ttrpg-expert.md` — maps all 18 functions to their reference files
- **the-midwife** added to roadmap — planned adventure creation skill with guided creative persona
- vault-ingest added to README Skills table (was missing)

### Changed

- ttrpg-expert description rewritten to clarify advisor-only role with zero dependencies on other skills
- Removed all remaining hardcoded model names: inline `**Model:** Sonnet` from vault-ingest Phases 1-2, `Sonnet/Haiku` from session-wrapup sub-agent guidance

---

## [1.4.4] — 2026-04-25

### Added

- **vault-ingest image handling** — images arriving via folder, one-at-a-time, or mixed batch are classified, filed to the correct `_attachments/` subfolder, and linked to entities via `portrait` frontmatter or `![[embed]]` body syntax
  - Format conversion (best-effort via `sips`/`magick`, skip with message if unavailable)
  - Filename-based entity matching (exact slug → batch → suffix strip)
  - Duplicate detection (identical files skipped, different-content conflicts flagged for GM)
  - Keeper interview questions for unmatched images and portrait selection
  - New reference: `skills/vault-ingest/references/image-handling.md`
- Roadmap item: remove model-specific prescriptions from all skills

### Changed

- vault-ingest model selection table uses complexity guidance (Light/Heavy) instead of hardcoded model names
- Classification taxonomy Image/map row expanded with supported formats and reference pointer

---

## [1.4.3] — 2026-04-23

### Added

- **displayTitle + template overhaul** — `displayTitle` on all page objects, data-driven `display_meta` PC meta row, Team/Fallen landing split with SVG status icons
- `display_meta` field added to PC entity schema and publish-site schema reference
- Character generation references updated with `display_meta` defaults

### Changed

- All publish templates switched to `displayTitle` for rendering
- Landing page roster split into The Team and The Fallen sections
- Relationship link display text replaces underscores with spaces

---

## [1.4.2] — 2026-04-22

### Added

- **vault-ingest skill** — ingests old campaign materials (notes, character sheets, images, transcripts, spreadsheets) into a structured vault via a six-phase pipeline: survey, sort, extract, keeper interview, synthesize, review
  - Classification taxonomy, keeper interview technique, and synthesis templates as references
  - Benchmark questions and campaign fixtures
- **Session document chain** — standardised naming and type conventions for session files (Plan, Play Notes, Wrap-Up)
  - Shared reconcile procedure for GM review workflow
  - All three session skills updated for document chain
  - Benchmark campaign converted to document chain format

### Changed

- Plugin description updated for seven-skill lineup
- vault-structure.md updated with `_inbox/` and document chain naming

---

## [1.4.1] — 2026-04-21

### Added

- **Arc-spotlight reference** — pure GM framework reference for dramatic arc planning, spotlight rotation, and session pacing
- Creative planning benchmark questions for session-prep

### Changed

- **session-prep refactored** — unified gather-plan-verify workflow replacing the older session-planner approach
  - Prep note template rewritten with progressive write sections
  - System-specific arc drivers folded into session-procedures files
- ttrpg-expert routing updated for advisor/doer split
- Compaction pass on arc-spotlight-reference and session-prep workflow

### Removed

- `skills/session-prep/references/session-planner.md` — replaced by arc-spotlight-reference + unified workflow

---

## [1.4.0] — 2026-04-20

### Added

- **session-prep skill** — dedicated between-sessions preparation with two-phase reconcile/prep-forward workflow, status-gated reconciliation (`played` → `reviewed`), and sub-agent opportunity for parallel vault reads
- **session-play skill** — speed-optimised at-the-table assistant for quick lookups, rules questions, on-the-fly content generation, and play note capture
- **session-wrapup skill** — post-session processor turning raw play notes into canon: narrative recaps, entity creation, event decomposition, timeline updates, and carry-forward package
- **Shared session-principles** (`skills/shared/session-principles.md`) — common rules, vault integration, and canon workflow shared across all three session skills
- **Benchmark infrastructure** — per-skill benchmark questions and 3-run blind A/B evaluation results for the session split

### Changed

- **session-lifecycle replaced** — the monolithic 491-line skill is split into three focused skills (402 total lines, 18% reduction) with quality improvement confirmed across 3 benchmark runs
- Plugin description updated to reflect the six-skill lineup
- campaign-qa companion skill references updated for the three-way split
- campaign-organizer, ttrpg-expert references updated
- User-facing docs split into per-skill pages (`docs/session-prep.md`, `docs/session-play.md`, `docs/session-wrapup.md`)
- `docs/campaign-lifecycle.md` and `docs/quickstart.md` updated for new skill names

### Removed

- `skills/session-lifecycle/` — replaced by session-prep, session-play, session-wrapup
- `docs/session-lifecycle.md` — replaced by per-skill docs

---

## [1.3.1] — 2026-04-19

### Added

- **Event dedicated template** — site template, vault template, and session-lifecycle event decomposition
  - `parseParticipant()` supports three formats: `[[Entity]] (role)`, `[[Entity|Display]] (role)`, plain text
  - Location wiki-link alias parsing (`[[Target|Display]]`)
  - Event threshold criteria for coarse-grained event decomposition in wrap-up
  - CSS: outcome callout and participants list styling

### Changed

- Entity schema: `eventType` renamed to `event_type`, `significance` field removed
- Session-lifecycle wrap-up: timeline entries now use linked vs inline format
- Roadmap: favicon generation demoted, event template marked completed

---

## [1.3.0] — 2026-04-19

### Added

- **publish-site skill** — new skill guiding the vault-to-website publishing workflow
- **gm-apprentice-publish npm package (v1.0.0)** — static site generator featuring:
  - Dashboard landing page and PC roster cards
  - NPC scoring and player-mode content/image filtering
  - Themed 404 page
  - Wiki-link resolution and image embed support
  - Relationship rendering
  - Configurable folder mapping and attachment directory
  - CLI entry point
- Pulp Cthulhu variant added to roadmap backlog

### Fixed

- Path traversal guard — bidirectional vault boundary check prevents escaping the vault root
- XSS prevention — HTML escaping applied across all site generator templates

---

## [1.2.0] — 2026-04-12

### Added

- **Regency Cthulhu variant** — skills overlay, occupations, equipment, chargen rules, GM guidance, routing, and benchmark question sets
- **Shared references directory** (`skills/shared/`) — deduplicated entity schema, frontmatter conventions, file format standards, and RPG terminology available to all skills
- **Benchmark infrastructure** — synthetic campaign, question sets, and baselines under `tests/`
- **CI checks** — markdown lint, consistency checks, and relative path validation
- **CLAUDE.md** — copyright compliance rules, GURPS usage constraints, commit conventions, and roadmap workflow
- **Force-ranked ROADMAP.md** backlog with scoring formula
- Image attachment support for campaign-organizer
- Installation instructions for all platforms (Claude Code, Desktop, VS Code, Cursor, JetBrains)
- Cross-routing prompts in all reference and framework files

### Changed

- Compacted 20+ reference and framework files (30–60% token reduction)
- campaign-qa and session-lifecycle now fall back to filesystem when no vault path is configured

---

## [1.1.0] — 2026-04-06

### Added

- Initial public release
- Four skills: `ttrpg-expert`, `campaign-organizer`, `campaign-qa`, `session-lifecycle`
- System support: Call of Cthulhu 7e, GURPS 4e, Forged in the Dark, D&D 5e 2024
- GURPS archetype chargen kits and reference files
- Plugin marketplace packaging (`.claude-plugin/plugin.json`, `marketplace.json`)

---

[1.7.1]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.7.0...v1.7.1
[1.7.0]: https://github.com/AntTheLimey/gm-apprentice/releases/tag/v1.7.0
[1.6.6]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.6.5...v1.6.6
[1.6.5]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.6.4...v1.6.5
[1.6.4]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.6.3...v1.6.4
[1.6.3]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.6.2...v1.6.3
[1.6.2]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.6.1...v1.6.2
[1.6.1]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.6.0...v1.6.1
[1.6.0]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.5.3...v1.6.0
[1.5.3]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.5.2...v1.5.3
[1.5.2]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.5.1...v1.5.2
[1.5.1]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.5.0...v1.5.1
[1.5.0]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.4.22...v1.5.0
[1.4.22]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.4.21...v1.4.22
[1.4.19]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.4.18...v1.4.19
[1.4.18]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.4.17...v1.4.18
[1.4.17]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.4.16...v1.4.17
[1.4.16]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.4.15...v1.4.16
[1.4.15]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.4.14...v1.4.15
[1.4.14]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.4.13...v1.4.14
[1.4.13]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.4.12...v1.4.13
[1.4.12]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.4.11...v1.4.12
[1.4.11]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.4.10...v1.4.11
[1.4.10]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.4.9...v1.4.10
[1.4.9]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.4.8...v1.4.9
[1.4.8]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.4.7...v1.4.8
[1.4.7]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.4.6...v1.4.7
[1.4.6]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.4.5...v1.4.6
[1.4.5]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.4.4...v1.4.5
[1.4.4]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.4.3...v1.4.4
[1.4.3]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.4.2...v1.4.3
[1.4.2]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.4.1...v1.4.2
[1.4.1]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.3.1...v1.4.0
[1.3.1]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/AntTheLimey/gm-apprentice/releases/tag/v1.1.0
