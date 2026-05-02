# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
