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

| Rank | Item | Impact | Urgency | Effort | Score | Status |
|:----:|------|:------:|:-------:|:------:|:-----:|--------|
| 1 | Pulp Cthulhu variant support | 4 | 4 | M (2) | 6.0 | Idea |
| 2 | Publish tool: favicon generation from campaign image | 2 | 1 | S (1) | 5.0 | Idea |
| 3 | Publish tool: per-page header banner | 2 | 1 | S (1) | 5.0 | Idea |
| 4 | Publish tool: Event dedicated template | 3 | 2 | M (2) | 4.0 | Idea |
| 5 | Publish tool: layout options (sidebar vs top nav, card grid vs list) | 3 | 2 | M (2) | 4.0 | Idea |
| 6 | CoC/BRP SRD enrichment (Phase 5a) | 4 | 3 | L (3) | 3.7 | Planned |
| 7 | Publish tool: Timeline auto-generation from events/sessions | 3 | 1 | M (2) | 3.5 | Idea |
| 8 | Publish tool: Full-text client-side search (lunr) | 3 | 1 | M (2) | 3.5 | Idea |
| 9 | FitD SRD enrichment (Phase 5b) | 2 | 2 | M (2) | 3.0 | Planned |
| 10 | Publish tool: Chapter/Session/Scene templates + hierarchy nav | 3 | 2 | L (3) | 2.7 | Idea |
| 11 | Character sheet templates | 2 | 1 | M (2) | 2.5 | Idea |
| 12 | Skill description optimization | 2 | 1 | M (2) | 2.5 | Idea |
| 13 | Publish tool: Clue dedicated template | 2 | 1 | M (2) | 2.5 | Idea |
| 14 | Publish tool: Document dedicated template | 2 | 1 | M (2) | 2.5 | Idea |
| 15 | Publish tool: Tag-based browsing (tag index pages) | 2 | 1 | M (2) | 2.5 | Idea |
| 16 | Eval suite for all skills | 3 | 1 | L (3) | 2.3 | Idea |
| 17 | Publish tool: Relationship graph visualisation | 3 | 1 | L (3) | 2.3 | Idea |
| 18 | Publish tool: full site identity (logo variants, social preview) | 3 | 1 | L (3) | 2.3 | Idea |
| 19 | D&D SRD enrichment (Phase 5c) | 2 | 2 | L (3) | 2.0 | Planned |
| 20 | PDF-to-markdown converter | 3 | 1 | XL (4) | 1.8 | Idea |
| 21 | Auto-download SRDs on setup | 1 | 1 | M (2) | 1.5 | Idea |

## Completed

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
