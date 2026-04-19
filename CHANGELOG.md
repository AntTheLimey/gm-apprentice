# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.3.1]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/AntTheLimey/gm-apprentice/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/AntTheLimey/gm-apprentice/releases/tag/v1.1.0
