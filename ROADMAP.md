# gm-apprentice — Roadmap

Items are force-ranked by score. Higher score = do first.

**Formula:** Score = (Impact × 2 + Urgency) / Effort

| Impact | Meaning |
|:------:|---------|
| 5 | Directly improves the user's active game |
| 4 | Improves the user's primary system |
| 3 | Improves general plugin quality |
| 2 | Adds support for secondary systems |
| 1 | Nice to have |

| Urgency | Meaning |
|:-------:|---------|
| 5 | Blocks other work |
| 4 | Active need (user's current campaign) |
| 3 | Next logical step |
| 2 | Eventually |
| 1 | Whenever |

| Effort | Meaning |
|:------:|---------|
| S (1) | < 1 hour |
| M (2) | 1-4 hours |
| L (3) | 4-12 hours |
| XL (4) | 12+ hours |

---

## The List

| Item | Impact | Urgency | Effort | Score | Status | Notes |
|------|:------:|:-------:|:------:|:-----:|--------|-------|
| the-midwife: guided adventure creation skill | 4 | 2 | M (2) | 5.0 | Idea | Creative midwife persona — draws ideas out of the GM through guided conversation, shapes them into a playable starting point with a vault/folder. Supports campaigns, one-shots, few-shots. |
| Handout document type with image creation prompts | 4 | 2 | M (2) | 5.0 | Idea | Session-prep scene artifact: handout markdown + frontmatter linking to scene/session + auto-generated image prompt for DALL-E/Midjourney |
| Publish tool: thematic cause-of-death icons for The Fallen | 2 | 1 | S (1) | 5.0 | Idea | New optional PC frontmatter field `cause_of_death` (combat, madness, eldritch, disease, etc.) with thematic SVG icons on Fallen cards |
| Publish tool: per-page header banner | 2 | 1 | S (1) | 5.0 | Idea | Custom banner image per page via frontmatter |
| Decompose arc-spotlight reference into focused files | 2 | 1 | S (1) | 5.0 | Experiment | Split arc-spotlight-reference.md into arc-model.md, spotlight-planning.md, touchpoint-framework.md for token efficiency |
| Portrait rendering in Obsidian vaults | 3 | 3 | M (2) | 4.5 | Idea | Obsidian doesn't render `portrait` frontmatter as images — needs Dataview inline, CSS snippet, or Templater approach. See [spec](docs/portrait-rendering-obsidian.md) |
| Obsidian vault-picker | 3 | 2 | M (2) | 4.0 | Idea | Campaign config drives vault switching: on session start, disable Obsidian REST plugin + MCP server for other vaults, ensure this campaign's REST API / MCP server is running and configured |
| Publish tool: layout options (sidebar vs top nav, card grid vs list) | 3 | 2 | M (2) | 4.0 | Idea | Site-wide config for nav style and index page layout |
| Find better free hosting solution | 3 | 2 | M (2) | 4.0 | Idea | Research alternatives to GitHub Pages — evaluate Cloudflare Pages, Netlify, Vercel free tiers for static site hosting. Consider deploy simplicity for non-technical GMs |
| Build-time section extraction for routing | 3 | 1 | M (2) | 3.5 | Experiment | Pre-process multi-section reference files into per-section extracts or line-range indexes at build time. [Findings](docs/experiment-section-extraction.md) |
| LoM-style 8-bit scene illustration | 4 | 1 | L (3) | 3.0 | Experiment | Programmatic 8-bit landscape vistas (Lords of Midnight style) from vault metadata using Pillow. No AI models, no API cost. [Prototype findings](docs/image-gen-lom-prototype-findings.md) |
| Pulp Cthulhu variant support | 4 | 4 | XL (4) | 3.0 | Idea | CoC variant overlay: hero/pulp talents, psychic powers, archetypes, adjusted lethality. Blocked on finding a legit distributable source — Chaosium BRP ORC license may not cover Pulp-specific content |
| FitD SRD enrichment (Phase 5b) | 2 | 2 | M (2) | 3.0 | Planned | Expand FitD files to GURPS-level depth: more factions, crew types, entanglements |
| Publish tool: Chapter/Session/Scene templates + hierarchy nav | 3 | 2 | L (3) | 2.7 | Idea | Dedicated templates for narrative hierarchy with parent/child nav |
| Skill description optimization | 2 | 1 | M (2) | 2.5 | Idea | Marketplace description and SKILL.md routing improvements for discoverability |
| Publish tool: Clue dedicated template | 2 | 1 | M (2) | 2.5 | Idea | Template for clue entities with status, linked scenes, discovery conditions |
| Publish tool: Document dedicated template | 2 | 1 | M (2) | 2.5 | Idea | Template for in-world documents (letters, newspapers, journals) |
| Publish tool: Tag-based browsing (tag index pages) | 2 | 1 | M (2) | 2.5 | Idea | Auto-generated index pages per tag from frontmatter |
| Eval suite for all skills | 3 | 1 | L (3) | 2.3 | Idea | Extend benchmark methodology to all 7 skills, not just ttrpg-expert |
| Publish tool: full site identity (logo variants, social preview) | 3 | 1 | L (3) | 2.3 | Idea | Logo generation, og:image, social card previews for shared links |
| D&D SRD enrichment (Phase 5c) | 2 | 2 | L (3) | 2.0 | Planned | Expand D&D files: more monster stat blocks, subclass features, encounter building |
| PDF-to-markdown converter | 3 | 1 | XL (4) | 1.8 | Idea | Tool to convert published adventure PDFs into vault-compatible markdown |
| Auto-download SRDs on setup | 1 | 1 | M (2) | 1.5 | Idea | First-run script to fetch CC-BY SRDs (D&D 5.2, FitD) into systems/ |
| Publish tool: favicon generation from campaign image | 1 | 1 | M (2) | 1.5 | Idea | Auto-generate favicon from campaign hero image during publish |

## Completed

- ~~Publish tool: site redesign v1.2~~ — Navigation overhaul, breadcrumbs, genre presets, system-specific PC sheets (CoC/GURPS/D&D/FitD), lunr search, relationship graphs, timeline pages, context sidebars, index page redesigns, landing page rewrite (PR #40)
- ~~Publish tool: GURPS PC sheet — single alphabetized skills list~~ — Inline comments enforcing single alphabetized tables for Skills and Spells (PR #32)
- ~~Publish tool: mobile HTML fixes~~ — Accordion table horizontal scroll, back-to-top button with scroll-triggered fade (PR #32)
- ~~Publish tool: displayTitle + template overhaul~~ — displayTitle on all page objects, data-driven `display_meta` PC meta row, Team/Fallen landing split with SVG status icons (PR #25)
- ~~Publish tool: Event dedicated template~~ — Dedicated event template, vault template, session-lifecycle event decomposition (PR #20)
- ~~Publish tool: Landing page dashboard~~ — Hero, session recap, PC roster, key NPCs, explore grid
- ~~Publish tool: Landing page timeline snippet~~ — Visual timeline of recent events on the landing page
- ~~Publish tool: overhaul site navigation~~ — Breadcrumbs, entity-type grouping, cross-linking, mobile responsiveness
- ~~Publish tool: system-specific PC sheet rendering~~ — Per-system HTML/CSS treatments (CoC parchment, GURPS stat blocks, D&D ability cards, FitD)
- ~~Publish tool: Timeline auto-generation~~ — Timeline page generated from event/session dates in frontmatter
- ~~Publish tool: Full-text client-side search (lunr)~~ — Client-side search index for published site
- ~~Publish tool: Relationship graph visualisation~~ — Static SVG relationship graphs with force-directed layout
- ~~Publish tool v1.0~~ — npm package + skill for vault-to-static-site generation (PR #19)
- ~~Session-prep: GM approval gate for new scenes~~ — GM framing questions before scene creation
- ~~Entity creation must read template before writing~~ — Template-reading gate in campaign-organizer, session-wrapup, vault-ingest
- ~~Remove model-specific prescriptions from all skills~~ — Replaced hardcoded model names with complexity guidance (PRs #26, #27)
- ~~Skill roles audit~~ — Skill taxonomy table in README, clarified advisor-only boundaries (PR #27)
- ~~CoC/BRP SRD enrichment (Phase 5a)~~ — Terminology fixes, 18 content files, Regency variant overlay
- ~~Regency Cthulhu system support~~ — 5 overlay files in variants/regency/, routing updates
- ~~GURPS content restructure (Phase 4)~~ — 31 files, 7 chargen kits
- ~~Copyright compliance (Phases 1-3)~~ — All systems
- ~~Codebase QA pass~~ — Score 11.0 (Impact 3, Urgency 5, Effort S)
- ~~Filesystem fallback (campaign-qa, session-lifecycle)~~ — PR #14
- ~~Shared-refs extraction~~ — Merged to main

## Notes

- **Pulp Cthulhu** is a CoC 7e variant adding pulp-era heroics:
  hero/pulp talents, psychic powers, archetypes, adjusted lethality.
  Implement as CoC variant overlay (similar to Regency Cthulhu).

- **Phase 5 order** (confirmed): CoC/BRP → FitD → D&D.
  Each system is a discrete unit — complete one before starting
  the next.

- **GURPS enrichment** is not on the list — already done in
  Phase 4 (24 topic files, 7 chargen kits).
