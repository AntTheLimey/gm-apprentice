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

The top two rows are **pinned**: the user's designated next work, ordered by
decision rather than pure score.

| Item | Impact | Urgency | Effort | Score | Status | Notes |
|------|:------:|:-------:|:------:|:-----:|--------|-------|
| 📌 Upgraded GURPS character sheet on website | 5 | 4 | L (3) | 4.7 | Next (pinned) | **User-designated #1 next.** Rebuild the publish tool's GURPS PC sheet renderer based on Armin's colour-style GCA template — colour-coded stat-block layout matching the GCA look. |
| 📌 Free hosting with a backend for editable character sheets | 4 | 4 | M (2) | 6.0 | Next (pinned) | **User-designated #2 next.** Research where a campaign site could run a small backend service so character sheets become editable in-browser, not just static. Extends "Find better free hosting solution" below with the dynamic/editable requirement. |
| Validation loops for entity creation | 3 | 2 | S (1) | 8.0 | Idea | Add self-validation steps to session-wrapup Step 4, vault-ingest, and campaign-organizer entity creation. Pattern: create entity, check frontmatter against template and schema, fix before moving on. Benchmark before/after. |
| "Why" reasoning on rigid skill directives | 3 | 2 | S (1) | 8.0 | Idea | Add reasoning to key bare directives across all skills. "ONE file per entity — multiple entities break wiki-link resolution and publish rendering." Models comply more reliably when they understand downstream consequences. Benchmark before/after. |
| Handout document type with image creation prompts | 4 | 2 | M (2) | 5.0 | Idea | Session-prep scene artifact: handout markdown + frontmatter linking to scene/session + auto-generated image prompt for DALL-E/Midjourney |
| Publish tool: thematic cause-of-death icons for The Fallen | 2 | 1 | S (1) | 5.0 | Idea | New optional PC frontmatter field `cause_of_death` (combat, madness, eldritch, disease, etc.) with thematic SVG icons on Fallen cards |
| Publish tool: per-page header banner | 2 | 1 | S (1) | 5.0 | Idea | Custom banner image per page via frontmatter |
| Decompose arc-spotlight reference into focused files | 2 | 1 | S (1) | 5.0 | Experiment | Split arc-spotlight-reference.md into arc-model.md, spotlight-planning.md, touchpoint-framework.md for token efficiency |
| Portrait rendering in Obsidian vaults | 3 | 3 | M (2) | 4.5 | Idea | Obsidian doesn't render `portrait` frontmatter as images — needs Dataview inline, CSS snippet, or Templater approach. See [spec](docs/portrait-rendering-obsidian.md) |
| Obsidian vault-picker | 3 | 2 | M (2) | 4.0 | Idea | Campaign config drives vault switching: on session start, disable Obsidian REST plugin + MCP server for other vaults, ensure this campaign's REST API / MCP server is running and configured |
| Publish tool: layout options (sidebar vs top nav, card grid vs list) | 3 | 2 | M (2) | 4.0 | Idea | Site-wide config for nav style and index page layout |
| Find better free hosting solution | 3 | 2 | M (2) | 4.0 | Idea | Research alternatives to GitHub Pages — evaluate Cloudflare Pages, Netlify, Vercel free tiers for static site hosting. Consider deploy simplicity for non-technical GMs |
| Build-time section extraction for routing | 3 | 1 | M (2) | 3.5 | Experiment | Pre-process multi-section reference files into per-section extracts or line-range indexes at build time. [Findings](docs/experiment-section-extraction.md) |
| GCA4 (`.gca4`) → vault ingest | 4 | 2 | L (3) | 3.3 | Idea | Drop a `.gca4` GCA character file, get a populated GURPS PC markdown file in the vault. Parser reads the GCA4 XML/binary format and generates frontmatter + section tables in the standard vault format, ready for publish-site rendering. Score: (4×2+2)/3 = 3.3 |
| LoM-style 8-bit scene illustration | 4 | 1 | L (3) | 3.0 | Experiment | Programmatic 8-bit landscape vistas (Lords of Midnight style) from vault metadata using Pillow. No AI models, no API cost. [Prototype findings](docs/image-gen-lom-prototype-findings.md) |
| Pulp Cthulhu variant support | 4 | 4 | XL (4) | 3.0 | Idea | CoC variant overlay: hero/pulp talents, psychic powers, archetypes, adjusted lethality. Blocked on finding a legit distributable source — Chaosium BRP ORC license may not cover Pulp-specific content |
| Publish tool: Chapter/Session/Scene templates + hierarchy nav | 3 | 2 | L (3) | 2.7 | Idea | Dedicated templates for narrative hierarchy with parent/child nav |
| mobRPG integration (sync vault ↔ mobRPG world graph) | 3 | 2 | L (3) | 2.7 | Experiment | Sync the vault with Tim's mobRPG world-builder API (442 endpoints; relational + custom-calendar graph). Prototype done — API driven, Canticle ↔ Regency Cthulhu compared, drift found (Edwin Fairchild in mobRPG only). Needs an ID crosswalk + reconciliation, not blind copy. See `docs/prototypes/mobrpg/FINDINGS.md`. |
| Zero-subscription GM access | 4 | 2 | XL (4) | 2.5 | Idea | Figure out how a GM with no Claude knowledge or subscription can use gm-apprentice. Research: hosted web UI wrapping the API, simplified onboarding that hides the Claude layer, free/low-cost access model, or a different distribution path entirely. Product strategy question before it's a technical one. |
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

- ~~publish-site Story section (N1–N6)~~ — The "make the site tell the STORY" North Star from `PUBLISH_SITE_BUGS_SPEC.md`. A prose-first Story reading layer over existing vault narrative, alongside the unchanged Wiki: a `/story.html` landing with two branches — the **Campaign Saga** (dedicated story pages from each unit's `Narrative Recap`, adaptive chapter-or-session spine, prev/next cover-to-cover, no dead pages) and **Character Stories** (per-PC `*_Story.md`, grouped Current/Retired/Fallen; PC stat-sheet tab links to it). Recaps found by heading wherever they live (separate wrap-up *or* embedded session/chapter file), matched even when decorated, paired by **folder proximity** (robust to free-form refs), built from the gm-only-stripped published view (no spoiler leak), and omitted entirely when a vault has no narrative. New `lib/story-spine.js` + `story.js`/`story-landing.js` templates. Validated across three real vaults (Canticle 14 + 7 char pages, specialforces 8, space_game graceful-empty). tool 1.4.0, plugin v1.8.0 (PR #TBD)
- ~~publish-site rendering defects (B1–B8 batch 1)~~ — Six defects from `PUBLISH_SITE_BUGS_SPEC.md`, each reproduced against main then fixed with tests: **B8** exclude lists from `vault-config.md` and `vault.config.json` now union instead of shadow (a `Source References` spoiler leak); **B6** "NPCs in Play" + relationship graph derive from a stripped "published view" not raw markdown (gm-only/excluded names leaked); **B3** cross-subtree links 404'd from a file-as-dir `relativePath` misuse, fixed with a shared `relativeHref` helper (11 call sites in wiki/location/npc); **B1** wikilinks humanize underscore slugs; **B4** the 404 page gets its genre theme; **B2** sparse sidebars collapse to one wide column. B7 (stale PC sheets) was already shipped by #57/#58 and skipped. tool 1.3.1, plugin v1.7.9 (PR #TBD)
- ~~publish-site install/upgrade hardening~~ — Two bugs broke a live site on plugin upgrade (1.7.0→1.7.7). (1) The build tool shipped without its runtime deps: distributed by git-copy into the plugin cache and symlinked via a `file:` pin, Node resolved its `require()`s from the cache where `npm install` never runs, so `gray-matter`/`lunr`/`markdown-it` were missing. Fixed by **vendoring** prod deps (committed; root `.gitignore` negation) so a clean install builds offline with no manual steps. (2) Stale version pins failed silently — a bare `/plugin` update never repointed sites. Added build-time **version-drift detection** (`lib/version-check.js`) that warns with the exact `file:` fix, tightened routine-update repoint + verification, and documented the hard-pin tradeoff. Also **committed fully to the plugin-cache distribution model**: `init` auto-pins new sites to the cache version it ran from (scaffold default `"latest"` → self-referential `file:` pin), and the SKILL/wizard/README stop pointing users at the stale npm registry. Guardrails: `clean-install` + `runtime-deps` + init auto-pin tests; tool 1.3.0, plugin v1.7.8 (PR #TBD)
- ~~Gotchas: non-Earth date-rule fix~~ — Extracted the one benchmark-proven win from the shelved "gotchas consolidation": the false rule that `in_game_date` "must be parseable by JS `new Date()`" made compliant agents *fabricate* a Gregorian date for fantasy/sci-fi calendars (e.g. "14th of Flamerule, 1492 DR" → "July 14, 1492"). Corrected in session-wrapup, vault-ingest, and shared/session-document-chain to record non-Earth dates in the world's own format (v1.7.6). The broader "rules stated up front" consolidation was **shelved** — A/B benchmark showed no behavioural payoff on Opus 4.8 or Sonnet; full work preserved on branch `archive/vault-write-gotchas`
- ~~Narrative planning layer~~ — New `plan` entity type with `plan_type` discriminator (arc/scene/investigation/timeline). Plans live in `Planning/` under each chapter; the-midwife Phase 4 promotes them alongside entities; session-prep surfaces relevant plans. Six skills updated (PR #53)
- ~~Wire PC `## Current Status` consumers~~ — The cumulative PC status block (PR #57) was read by nothing but the website + GM. Wired four consumers — session-prep (Threads + arc check, fixing thread-decay), the-midwife (new-chapter hooks), ttrpg-expert (arc/thread routes), campaign-qa (Canon Audit consistency check) — with the read contract in the two ttrpg-expert references and a structural regression test in CI (PR #58)
- ~~session-wrapup: PC entity-sheet drift fix~~ — Wrap-up never refreshed the PC's own sheet, so its `asOfSession`, chapter `tags`, and the published `## Current Status` froze behind the Story file and overview. New Step 3c refreshes active PC sheets each session; `## Current Status` is now a canonical template section; added a `validate_schema.py freshness` regression check + test fixture (PR #57)
- ~~World evolution integration into reconcile~~ — Reconcile step 5.5 offers faction turns, consequence surfacing, foreshadowing review after session confidence is promoted. Removed dead campaign-tracker.md references. Added `world-evolution` entity source and `world_evolved` session field (PR #52)
- ~~Publish tool: landing recap + wrap-up sidebar fix~~ — Landing page now extracts recap from wrap-up file, links to wrap-up page, wrap-up pages suppress backlinks sidebar, world_flags excluded from build (PR #51)
- ~~Campaign overview template with current game date~~ — `campaign_overview` entity type with session-wrapup auto-updates and the-midwife creation
- ~~the-midwife: guided adventure creation skill~~ — Adventure creation skill with adventure-brief entity type, vault-mining, Session 0 handoff
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
- ~~FitD SRD enrichment (Phase 5b)~~ — Copyright compliance, 3 new SRD files, depth pass, personal reference build-out, skill routing
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
