# gm-apprentice

[![npm: gm-apprentice-publish](https://img.shields.io/npm/v/gm-apprentice-publish)](https://www.npmjs.com/package/gm-apprentice-publish)

TTRPG Game Master skills for Claude. An apprentice that helps GMs
run tabletop role-playing games -- from rules validation and content
generation to campaign management and session lifecycle support.

## Skills

| Skill | Description | Obsidian Required |
|-------|-------------|-------------------|
| **ttrpg-expert** | Rules engine, content generation, canon management, continuity checking, session planning, encounter design, scenario writing | Optional |
| **the-midwife** | Guided adventure creation through creative conversation -- develops campaign concepts, one-shots, and arcs from a vague idea or nothing at all, producing an adventure brief and vault scaffold for Session 0. | Optional |
| **campaign-organizer** | Campaign architect -- classifies, structures, cross-references, and interlinks campaign content with knowledge graph metadata. Works with Obsidian or plain filesystem. | Recommended |
| **campaign-qa** | Campaign quality auditing -- canon audit, timeline validation, name similarity, clue redundancy, graph health checks. Works with Obsidian or plain filesystem. | Recommended |
| **session-prep** | Between-session preparation — reconciles last session's results, reviews PC arcs, scans threads, flags gaps, builds prep package. Works with Obsidian or plain filesystem. | Recommended |
| **session-play** | At-the-table GM support — fast lookups, rules assist, on-the-fly NPC/location generation, note capture. Speed-optimised for live play. | Optional |
| **session-wrapup** | Post-session processing — narrative recaps, entity creation/updates, timeline entries, carry-forward identification. Accepts raw play notes or [GM-Assistant](https://gmassistant.app) session exports. Works with Obsidian or plain filesystem. | Recommended |
| **vault-ingest** | Ingest old campaign materials (notes, character sheets, images, transcripts) into a structured vault. Interviews the GM to recover what actually happened. | Recommended |
| **publish-site** | Publish your campaign vault as a static website on GitHub Pages. Guides setup, routine rebuilds, troubleshooting, and schema migrations. | Recommended |

### Skill Taxonomy

**ttrpg-expert is the advisor** with zero dependencies on other skills. Everything else is a doer with a specific function.

| Category | Skill | Role | Boundary |
|----------|-------|------|----------|
| **Advisor** | ttrpg-expert | Rules, GM craft, RPG techniques | Pure reference — no vault writes, no dependencies on other skills. Other skills read its references but it never calls them. |
| **Campaign organization** | campaign-organizer | Vault structure, entity filing, knowledge graph | Owns the vault schema and file layout. Creates and restructures — doesn't generate narrative content. |
| **Quality assurance** | campaign-qa | Canon auditing, timeline validation, graph health | Detects problems — doesn't fix them. Hands off to campaign-organizer (structure) or ttrpg-expert (content) for repairs. |
| **Session lifecycle** | session-prep | Between-session preparation and reconciliation | Bridges wrap-up to next session. Reads ttrpg-expert references for creative planning. |
| | session-play | At-the-table GM support | Speed-optimised. Short responses, no unsolicited analysis. Captures play notes for session-wrapup. |
| | session-wrapup | Post-session processing | Turns raw play notes into canon. Creates/updates entities, events, timeline. Feeds session-prep. |
| **Content ingestion** | vault-ingest | Old materials to structured vault | Adapter — classifies, interviews GM, synthesizes. Hands off to campaign-organizer and session-wrapup. |
| **Content publication** | publish-site | Vault to static website | Reads vault, generates HTML. No vault writes. |
| **Adventure creation** | the-midwife | Idea to starting adventure + vault | Creative guide — draws ideas out of the GM through conversation, shapes them into a playable starting point with adventure brief and vault scaffold. |

## Supported Game Systems

- Call of Cthulhu 7th Edition (CoC 7e)
- GURPS 4th Edition — includes 7 archetype chargen kits,
  24 topic-based reference files, and curated Basic Set content
- Forged in the Dark (Blades in the Dark) — 14 SRD reference
  files covering mechanics, playbooks, crew types, cohorts,
  gathering information, GM techniques, and faction procedures
- D&D 5th Edition (2024 Revision)

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

If your plan doesn't include plugin support, you can upload
skills individually:

1. Download the `.zip` files you want from the
   [latest release](https://github.com/AntTheLimey/gm-apprentice/releases/latest)
2. In Claude Desktop, go to **Chat > Skills**
3. Click **+** and upload each zip file

See the skill table above for what each skill does.

### VS Code

1. Install the [Claude Code extension](vscode:extension/anthropic.claude-code)
2. Open the Claude Code prompt and type `/plugins`
3. Go to the **Discover** tab
4. Add the marketplace: `AntTheLimey/gm-apprentice`
5. Click **Install** and choose your scope (user, project, or local)

### Cursor

Cursor supports Claude Code plugins via its VS Code compatibility:

1. Install the [Claude Code extension for Cursor](cursor:extension/anthropic.claude-code)
2. Follow the same steps as VS Code above

### JetBrains IDEs

JetBrains IDEs (IntelliJ, PyCharm, WebStorm, etc.) support
Claude Code but do not currently have a plugin management UI.
Install via the CLI method instead:

```bash
/plugin marketplace add AntTheLimey/gm-apprentice
/plugin install gm-apprentice
```

## Documentation

- [Quickstart Guide](docs/quickstart.md) -- set up your first
  campaign from scratch
- [Campaign Lifecycle](docs/campaign-lifecycle.md) -- how the
  nine skills work together across the life of a campaign
- [ttrpg-expert](docs/ttrpg-expert.md) -- rules, content
  generation, and GM assistance
- [the-midwife](docs/the-midwife.md) -- guided adventure
  creation from vague idea to Session 0
- [campaign-organizer](docs/campaign-organizer.md) -- vault
  structure and knowledge graphs
- [campaign-qa](docs/campaign-qa.md) -- campaign quality
  auditing
- [session-prep](docs/session-prep.md) -- between-session
  preparation and reconciliation
- [session-play](docs/session-play.md) -- at-the-table GM
  support
- [session-wrapup](docs/session-wrapup.md) -- post-session
  processing and recaps, including
  [GM-Assistant](https://gmassistant.app) export support
- [vault-ingest](docs/vault-ingest.md) -- importing old
  campaign materials into a structured vault
- [publish-tool](docs/publish-tool.md) -- publishing your vault
  as a static website
- [Personal reference files](docs/personal-reference-files.md)
  -- adding your own rulebook content for deeper system support
- [gm-apprentice-publish](tools/publish/README.md) -- npm package
  reference for the publish tool

## Obsidian Setup

Six of the nine skills (campaign-organizer, campaign-qa,
session-prep, session-play, session-wrapup, vault-ingest) work
with an Obsidian vault to manage campaign content. The
ttrpg-expert, the-midwife, and publish-site skills work standalone.

### Dependency Tiers

All skills are fully functional on a plain folder of markdown
files. Opening that folder in Obsidian adds the app's own
features (graph view, community plugins); enabling the
Obsidian CLI additionally gives skills ranked search and
native graph queries.

| Skill | No Obsidian | Obsidian | Obsidian + CLI |
|-------|-------------|----------|----------------|
| campaign-qa | Full audits (grep-based graph checks) | Adds in-app graph view | Native orphan/backlink/unresolved queries |
| session-prep | Full prep workflow | Adds vault UI for review | Ranked search for canon lookups |
| session-play | Full play support | Adds vault UI at the table | Faster ranked lookups |
| session-wrapup | Full wrap-up workflow | Adds vault UI for review | Ranked search for entity matching |
| campaign-organizer | Full structuring and linking | Adds graph visualization | Native graph and property queries |
| vault-ingest | Full ingestion workflow | Adds vault UI for review | Ranked search during synthesis |
| the-midwife | Fully functional | Adds vault UI for canon browsing | Ranked search over existing canon |

ttrpg-expert and publish-site are fully functional in every
tier — ttrpg-expert has no vault dependency, and publish-site
reads vault files directly from disk.

### Recommended Obsidian Community Plugins

Install these from Settings > Community Plugins > Browse:

1. **Smart Connections** -- Semantic search inside the
   Obsidian app for browsing your vault. Skills do not invoke
   it; skill-side search comes from the Obsidian CLI below.

2. **Templater** -- Template engine for entity and session file
   creation from structured templates.

### Enabling the Obsidian CLI (optional)

Obsidian 1.12.7+ ships a command-line interface that gives
skills ranked vault search and native graph queries
(backlinks, orphans, unresolved links). To enable it:

1. Update Obsidian to 1.12.7 or later.
2. Open Settings > General and enable
   **Command line interface**.
3. Verify from a terminal: `obsidian vaults` should list
   your vaults.

Skills detect the CLI automatically and fall back to plain
filesystem tools when it's absent. Commands need the Obsidian
app -- running one launches it if closed.

As a companion, the [obsidian-skills](https://github.com/kepano/obsidian-skills)
plugin (MIT, by Obsidian's CEO) is the authoritative CLI and
syntax reference:

```bash
claude plugin marketplace add kepano/obsidian-skills
claude plugin install obsidian@obsidian-skills
```

**Migrating from the old MCP setup:** earlier versions
recommended the MCP Tools and Local REST API plugins with an
`obsidian` server entry in `.mcp.json`. That stack is
retired: uninstall both plugins from Settings > Community
Plugins and delete the `obsidian` entry from any `.mcp.json`.

## Using Without Obsidian

Every skill works without Obsidian — three are fully
functional standalone, the rest fall back to filesystem mode.

**ttrpg-expert** is fully functional and provides:

- Game system rules help and validation
- NPC, location, faction, and item generation
- Session planning and encounter design advice
- Scenario writing assistance
- Canon management guidance
- Continuity checking (from conversation context)
- General GM support across all four game systems

**the-midwife** is fully functional standalone — adventure
conception happens in conversation and its workspace is plain
markdown. With an existing vault it additionally mines your
canon for creative opportunities.

**publish-site** reads vault files directly from disk to build
the static site; Obsidian is never part of the pipeline.

**campaign-organizer** works in filesystem mode — it creates
the same structured markdown files, folder hierarchy, YAML
frontmatter, and wiki-links, just without Obsidian's graph
visualization and semantic search. Open the folder in Obsidian
later for the full experience.

**campaign-qa**, **session-prep**, **session-play**,
**session-wrapup**, and **vault-ingest** also work in
filesystem mode — same audit procedures and lifecycle
workflows, reading and searching the vault folder directly.
The Obsidian CLI adds ranked search and native graph
queries but is not required.

## License

Original content (skills and markdown) is licensed under
[CC-BY-SA 4.0](LICENSE). Code (scripts, hooks, and executable
files) is licensed under [MIT](LICENSE-CODE).

This project includes material from open game content
licensed under CC-BY 4.0 (D&D SRD 5.2), CC-BY 3.0 (Blades
in the Dark SRD), and the ORC License (Basic Roleplaying).

GURPS is a trademark of Steve Jackson Games, and its rules
and art are copyrighted by Steve Jackson Games. All rights
are reserved by Steve Jackson Games. This game aid is the
original creation of AntTheLimey and is released for free
distribution, and not for resale, under the permissions
granted in the
[Steve Jackson Games Online Policy](https://www.sjgames.com/general/online_policy.html).

See [ATTRIBUTION.md](ATTRIBUTION.md) for full credits and
licensing details.
