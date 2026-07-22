# gm-apprentice

[![npm: gm-apprentice-publish](https://img.shields.io/npm/v/gm-apprentice-publish)](https://www.npmjs.com/package/gm-apprentice-publish)

TTRPG Game Master skills for Claude. An apprentice that helps GMs
run tabletop role-playing games -- from a first spark of an idea
through content generation, live play, and campaign management.

## Installation

### Claude Code (CLI)

```bash
/plugin marketplace add AntTheLimey/gm-apprentice
/plugin install gm-apprentice
/reload-plugins
```

### Claude Desktop (Mac / Windows)

1. Open Claude Desktop and switch to the **Cowork** tab
2. Click **Customize**
3. Under **Personal plugins**, click **+** (Add plugin)
4. Select **Create plugin > Add marketplace**
5. Enter: `https://github.com/AntTheLimey/gm-apprentice`
6. Once synced, click **Install** on the gm-apprentice plugin

#### Individual skill upload (free / starter accounts)

If your plan doesn't include plugin support, upload skills individually:

1. Download the `.zip` files you want from the
   [latest release](https://github.com/AntTheLimey/gm-apprentice/releases/latest)
2. In Claude Desktop, go to **Chat > Skills**
3. Click **+** and upload each zip file

### VS Code / Cursor

1. Install the [Claude Code extension](vscode:extension/anthropic.claude-code)
   (Cursor: the [Claude Code extension for Cursor](cursor:extension/anthropic.claude-code))
2. Open the Claude Code prompt and type `/plugins`
3. Go to the **Discover** tab, add the marketplace
   `AntTheLimey/gm-apprentice`, and click **Install**

### JetBrains IDEs

JetBrains IDEs (IntelliJ, PyCharm, WebStorm, etc.) have no plugin
management UI yet — install via the CLI method above.

## Skills

You talk to Claude normally; skills activate automatically from what
you ask. Say "build me an NPC" and Claude reaches for **ttrpg-expert**;
say "help me start a new campaign" and it reaches for **the-midwife**.

| Skill | Description | Obsidian |
|-------|-------------|----------|
| **the-midwife** | Guided adventure creation through creative conversation — develops a campaign, one-shot, or arc from a vague idea or nothing at all, then writes an adventure brief and scaffolds the vault for Session 0. | Optional |
| **ttrpg-expert** | Rules engine, content generation, canon management, continuity checking, session planning, encounter design, scenario writing. | Optional |
| **campaign-organizer** | Campaign architect — classifies, structures, cross-references, and interlinks campaign content with knowledge-graph metadata. | Recommended |
| **campaign-qa** | Quality auditing — canon audit, timeline validation, name similarity, clue redundancy, graph-health checks. | Recommended |
| **session-prep** | Between-session preparation — reconciles last session, reviews PC arcs, scans threads, flags gaps, builds a prep package. | Recommended |
| **session-play** | At-the-table support — fast lookups, rules assist, on-the-fly NPC/location generation, note capture. Speed-optimised for live play. | Optional |
| **session-wrapup** | Post-session processing — narrative recaps, entity creation/updates, timeline entries, carry-forward. Accepts raw notes or [GM-Assistant](https://gmassistant.app) exports. | Recommended |
| **vault-ingest** | Ingest old campaign materials (notes, character sheets, images, transcripts) into a structured vault, interviewing the GM to recover what happened. | Recommended |
| **publish-site** | Publish your campaign vault as a static website on GitHub Pages or Cloudflare Pages. | Recommended |

**ttrpg-expert is the advisor** — pure reference, zero dependencies on
other skills. Everything else is a doer with a specific job:

| Category | Skill | Boundary |
|----------|-------|----------|
| **Advisor** | ttrpg-expert | Rules, GM craft, RPG techniques. No vault writes; other skills read its references but it never calls them. |
| **Adventure creation** | the-midwife | Draws ideas out of the GM, shapes them into a playable starting point with an adventure brief and vault scaffold. |
| **Campaign organization** | campaign-organizer | Owns the vault schema and file layout. Structures and links — doesn't generate narrative content. |
| **Quality assurance** | campaign-qa | Detects problems — doesn't fix them. Hands off to campaign-organizer (structure) or ttrpg-expert (content). |
| **Session lifecycle** | session-prep → play → wrapup | Prep bridges wrap-up to the next session; play is at-the-table; wrap-up turns raw notes into canon and feeds prep. |
| **Content ingestion** | vault-ingest | Classifies old material, interviews the GM, hands off to campaign-organizer and session-wrapup. |
| **Content publication** | publish-site | Reads the vault, generates HTML. No vault writes. |

## Quickstart

From a spark of an idea to your first session. The full walkthrough
with example prompts is in the [Quickstart Guide](docs/quickstart.md).

1. **Conceive it — the-midwife.** "I want to run a Call of Cthulhu game
   in 1920s Manhattan — help me build it." The midwife draws the concept
   out through conversation and, when you're happy, writes an adventure
   brief and scaffolds your vault. Tell it your system up front; it won't
   assume.
2. **Build the world — ttrpg-expert.** "Make the main antagonist — a
   wealthy industrialist funding occult research." Generate NPCs,
   locations, and factions as you need them; each starts as DRAFT until
   you accept it into canon.
3. **Prep session 1 — session-prep.** "Help me prep session 1." It plans
   scenes as options you choose from and flags the gaps still to fill.
4. **Run it — session-play.** Fast lookups and note capture at the table.
5. **Process it — session-wrapup.** Hand over your notes; it writes the
   recap, creates entities for new NPCs, and tells you what carries
   forward. Next time, session-prep reconciles anything skipped.

As the vault grows, reach for **campaign-organizer** (file and link
accumulated content), **campaign-qa** (periodic health checks), and
**vault-ingest** (import old material). The midwife scaffolds the
starting vault, so none of these are needed on day one.

## Supported Game Systems

- **Call of Cthulhu 7th Edition** (CoC 7e) — includes the Regency Cthulhu variant
- **GURPS 4th Edition** — 7 archetype chargen kits, 24 topic-based
  reference files, and curated Basic Set content
- **Forged in the Dark** (Blades in the Dark) — 14 SRD reference files
  covering mechanics, playbooks, crew types, cohorts, and GM procedures
- **D&D 5th Edition** (2024 Revision)
- **Pathfinder 2nd Edition** (Remaster) — classes, ancestries, spells by
  rank, curated Monster Core statblocks, feats, and GM math tables, all
  from ORC-licensed sources

Tell Claude which system you're running when you start — it won't assume.

## Documentation

- [Quickstart Guide](docs/quickstart.md) — your first campaign, step by step
- [Campaign Lifecycle](docs/campaign-lifecycle.md) — how the skills work
  together across the life of a campaign
- Per-skill guides: [ttrpg-expert](docs/ttrpg-expert.md) ·
  [the-midwife](docs/the-midwife.md) ·
  [campaign-organizer](docs/campaign-organizer.md) ·
  [campaign-qa](docs/campaign-qa.md) ·
  [session-prep](docs/session-prep.md) ·
  [session-play](docs/session-play.md) ·
  [session-wrapup](docs/session-wrapup.md) ·
  [vault-ingest](docs/vault-ingest.md) ·
  [publish-site](docs/publish-tool.md)
- [Personal reference files](docs/personal-reference-files.md) — add your
  own rulebook content for deeper system support
- [gm-apprentice-publish](tools/publish/README.md) — npm package reference
  for the publish tool

## Vaults

A campaign vault is a plain folder of markdown files — no servers,
plugins, or app dependencies. Open it in [Obsidian](https://obsidian.md)
whenever you want the graph view, backlinks, and a vault UI at the table;
nothing requires it.

Bundled vault utilities under `skills/shared/scripts/` (Python 3 standard
library, no install) give the skills ranked search, link-graph audits, and
schema validation — `vault_search.py`, `graph_check.py`, `vault_check.py`,
`session_context.py`, and `stamp_entities.py`. Skills invoke them
automatically when `python3` is on your PATH and fall back to plain search
when it isn't (macOS and most Linux ship Python 3; on Windows,
`winget install python`).

## License

Original content (skills and markdown) is licensed under
[CC-BY-SA 4.0](LICENSE). Code (scripts, hooks, and executable
files) is licensed under [MIT](LICENSE-CODE).

This project includes material from open game content licensed under
CC-BY 4.0 (D&D SRD 5.2), CC-BY 3.0 (Blades in the Dark SRD), and the
ORC License (Basic Roleplaying and Pathfinder Second Edition Remaster).

GURPS is a trademark of Steve Jackson Games, and its rules and art are
copyrighted by Steve Jackson Games. All rights are reserved by Steve
Jackson Games. This game aid is the original creation of AntTheLimey and
is released for free distribution, and not for resale, under the
permissions granted in the
[Steve Jackson Games Online Policy](https://www.sjgames.com/general/online_policy.html).

See [ATTRIBUTION.md](ATTRIBUTION.md) for full credits and licensing details.
