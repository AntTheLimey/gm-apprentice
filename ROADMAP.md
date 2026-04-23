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

| Rank | Item | Impact | Urgency | Effort | Score | Status | Notes |
|:----:|------|:------:|:-------:|:------:|:-----:|--------|-------|
| 1 | ~~Publish tool: displayTitle + template overhaul~~ | 5 | 5 | S (1) | 15.0 | Done | |
| 2 | ~~Publish tool: Landing page dashboard (recap, PC roster, key NPCs)~~ | 5 | 4 | M (2) | 7.0 | Done | |
| 3 | Skill roles audit: clarify inter-skill relationships | 4 | 4 | M (2) | 6.0 | Idea | Review all 6 skill descriptions, routing, companion skill refs to ensure clear advisor/doer boundaries |
| 4 | Pulp Cthulhu variant support | 4 | 4 | M (2) | 6.0 | Idea | CoC variant overlay: hero/pulp talents, psychic powers, archetypes, adjusted lethality |
| 5 | Handout document type with image creation prompts | 4 | 2 | M (2) | 5.0 | Idea | Session-prep scene artifact: handout markdown + frontmatter linking to scene/session + auto-generated image prompt for DALL-E/Midjourney |
| 6 | Publish tool: per-page header banner | 2 | 1 | S (1) | 5.0 | Idea | Custom banner image per page via frontmatter |
| 7 | Decompose arc-spotlight reference into focused files | 2 | 1 | S (1) | 5.0 | Experiment | Split arc-spotlight-reference.md into arc-model.md, spotlight-planning.md, touchpoint-framework.md for token efficiency |
| 8 | ~~Publish tool: Event dedicated template~~ | 3 | 2 | M (2) | 4.0 | Done | |
| 9 | Publish tool: layout options (sidebar vs top nav, card grid vs list) | 3 | 2 | M (2) | 4.0 | Idea | Site-wide config for nav style and index page layout |
| 10 | Publish tool: Landing page timeline snippet (recent campaign events) | 3 | 2 | M (2) | 4.0 | Idea | Visual timeline of recent events on the landing page |
| 11 | ~~CoC/BRP SRD enrichment (Phase 5a)~~ | 4 | 3 | L (3) | 3.7 | Done | |
| 12 | Publish tool: Timeline auto-generation from events/sessions | 3 | 1 | M (2) | 3.5 | Idea | Generate timeline page from event/session dates in frontmatter |
| 13 | Publish tool: Full-text client-side search (lunr) | 3 | 1 | M (2) | 3.5 | Idea | Client-side search index so players can find content in published site |
| 14 | FitD SRD enrichment (Phase 5b) | 2 | 2 | M (2) | 3.0 | Planned | Expand FitD files to GURPS-level depth: more factions, crew types, entanglements |
| 15 | Publish tool: Chapter/Session/Scene templates + hierarchy nav | 3 | 2 | L (3) | 2.7 | Idea | Dedicated templates for narrative hierarchy with parent/child nav |
| 16 | Character sheet templates | 2 | 1 | M (2) | 2.5 | Idea | Printable/viewable character sheet templates per system in published site |
| 17 | Skill description optimization | 2 | 1 | M (2) | 2.5 | Idea | Marketplace description and SKILL.md routing improvements for discoverability |
| 18 | Publish tool: Clue dedicated template | 2 | 1 | M (2) | 2.5 | Idea | Template for clue entities with status, linked scenes, discovery conditions |
| 19 | Publish tool: Document dedicated template | 2 | 1 | M (2) | 2.5 | Idea | Template for in-world documents (letters, newspapers, journals) |
| 20 | Publish tool: Tag-based browsing (tag index pages) | 2 | 1 | M (2) | 2.5 | Idea | Auto-generated index pages per tag from frontmatter |
| 21 | Eval suite for all skills | 3 | 1 | L (3) | 2.3 | Idea | Extend benchmark methodology to all 7 skills, not just ttrpg-expert |
| 22 | Publish tool: Relationship graph visualisation | 3 | 1 | L (3) | 2.3 | Idea | Interactive graph of entity relationships (d3/force-directed) |
| 23 | Publish tool: full site identity (logo variants, social preview) | 3 | 1 | L (3) | 2.3 | Idea | Logo generation, og:image, social card previews for shared links |
| 24 | D&D SRD enrichment (Phase 5c) | 2 | 2 | L (3) | 2.0 | Planned | Expand D&D files: more monster stat blocks, subclass features, encounter building |
| 25 | PDF-to-markdown converter | 3 | 1 | XL (4) | 1.8 | Idea | Tool to convert published adventure PDFs into vault-compatible markdown |
| 26 | Auto-download SRDs on setup | 1 | 1 | M (2) | 1.5 | Idea | First-run script to fetch CC-BY SRDs (D&D 5.2, FitD) into systems/ |
| 27 | Publish tool: favicon generation from campaign image | 1 | 1 | M (2) | 1.5 | Idea | Auto-generate favicon from campaign hero image during publish |

## Completed

- ~~Publish tool: displayTitle + template overhaul~~ — displayTitle on all page objects, data-driven `display_meta` PC meta row, Team/Fallen landing split with SVG status icons
- ~~CoC/BRP SRD enrichment (Phase 5a)~~ — already covered by v3 terminology fixes, 18 content files, Regency variant overlay
- ~~Publish tool: Event dedicated template~~ — dedicated event template, vault template, session-lifecycle event decomposition (PR #20)
- ~~Publish tool: Landing page dashboard~~ — hero, session recap, PC roster, key NPCs, explore grid
- ~~Publish tool v1.0~~ — npm package + skill for vault-to-static-site generation (PR #19)
- ~~Regency Cthulhu system support~~ — 5 overlay files in variants/regency/, routing updates
- ~~Codebase QA pass~~ — Score 11.0 (Impact 3, Urgency 5, Effort S)
- ~~Filesystem fallback (campaign-qa, session-lifecycle)~~ — PR #14
- ~~Shared-refs extraction~~ — Merged to main
- ~~GURPS content restructure (Phase 4)~~ — 31 files, 7 kits
- ~~Copyright compliance (Phases 1-3)~~ — All systems

## Notes

- **Pulp Cthulhu** is a CoC 7e variant adding pulp-era heroics:
  hero/pulp talents, psychic powers, archetypes, adjusted lethality.
  Implement as CoC variant overlay (similar to Regency Cthulhu).

- **Regency Cthulhu** is the user's active campaign system.
  Source material: `docs/supplemental/regency_cthulhu_reference_tables.md`
  (skills, occupations, equipment, weapons, chase rules from
  Chaosium 2022). Add as CoC variant topic file with Regency-
  specific skill/occupation/equipment overrides.

- **Phase 5 order** (confirmed): CoC/BRP → FitD → D&D.
  Each system is a discrete unit — complete one before starting
  the next.

- **GURPS enrichment** is not on the list — already done in
  Phase 4 (24 topic files, 7 chargen kits).

- **Publish tool** (`tools/publish/`, planned) is a separate npm
  package that lives inside this repo. Publishable as
  `gm-apprentice-publish` on npm. Ships with dedicated templates
  for PC, NPC, Location, Creature, Item, Faction in v1.0.
  Remaining entity types (Event, Clue, Document, Chapter,
  Session, Scene) use a smart wiki fallback template with
  frontmatter-based metadata badges until their dedicated
  templates ship in v1.1+. Working prototype lives at
  `AntTheLimey/gurps-special-forces` until extracted.
