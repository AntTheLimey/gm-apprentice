# gm-apprentice

[![npm: gm-apprentice-publish](https://img.shields.io/npm/v/gm-apprentice-publish)](https://www.npmjs.com/package/gm-apprentice-publish)

TTRPG Game Master skills for Claude. An apprentice that helps GMs
run tabletop role-playing games -- from rules validation and content
generation to campaign management and session lifecycle support.

## Skills

| Skill | Description | Obsidian Required |
|-------|-------------|-------------------|
| **ttrpg-expert** | Rules engine, content generation, canon management, continuity checking, session planning, encounter design, scenario writing | Optional |
| **campaign-organizer** | Campaign architect -- classifies, structures, cross-references, and interlinks campaign content with knowledge graph metadata. Works with Obsidian or plain filesystem. | Recommended |
| **campaign-qa** | Campaign quality auditing -- canon audit, timeline validation, name similarity, clue redundancy, graph health checks. Works with Obsidian or plain filesystem. | Recommended |
| **session-prep** | Between-session preparation — reconciles last session's results, reviews PC arcs, scans threads, flags gaps, builds prep package. Works with Obsidian or plain filesystem. | Recommended |
| **session-play** | At-the-table GM support — fast lookups, rules assist, on-the-fly NPC/location generation, note capture. Speed-optimised for live play. | Optional |
| **session-wrapup** | Post-session processing — narrative recaps, entity creation/updates, timeline entries, carry-forward identification. Works with Obsidian or plain filesystem. | Recommended |
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
| **Adventure creation** | the-midwife *(planned)* | Idea to starting adventure + vault | Creative midwife — draws ideas out of the GM, shapes them into a playable starting point. |

## Supported Game Systems

- Call of Cthulhu 7th Edition (CoC 7e)
- GURPS 4th Edition — includes 7 archetype chargen kits,
  24 topic-based reference files, and curated Basic Set content
- Forged in the Dark (Blades in the Dark)
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
- [ttrpg-expert](docs/ttrpg-expert.md) -- rules, content
  generation, and GM assistance
- [campaign-organizer](docs/campaign-organizer.md) -- vault
  structure and knowledge graphs
- [campaign-qa](docs/campaign-qa.md) -- campaign quality
  auditing
- [session-prep](docs/session-prep.md) -- between-session
  preparation and reconciliation
- [session-play](docs/session-play.md) -- at-the-table GM
  support
- [session-wrapup](docs/session-wrapup.md) -- post-session
  processing and recaps
- [publish-tool](docs/publish-tool.md) -- publishing your vault
  as a static website
- [gm-apprentice-publish](tools/publish/README.md) -- npm package
  reference for the publish tool

## Obsidian Setup

Five of the six skills (campaign-organizer, campaign-qa,
session-prep, session-play, session-wrapup) work with an Obsidian vault to manage campaign
content. The ttrpg-expert skill works standalone.

### Dependency Tiers

| Skill | No Obsidian | Obsidian (no MCP) | Full Setup (Obsidian + MCP) |
|-------|-------------|-------------------|----------------------------|
| ttrpg-expert | Fully functional | Enhanced continuity checks | Best experience |
| campaign-qa | Functional (filesystem mode) | Partial (file reads only) | Full QA auditing |
| session-prep | Functional (filesystem mode) | Read-only analysis | Full prep workflow |
| session-play | Functional (filesystem mode) | Read-only lookups | Full play support |
| session-wrapup | Functional (filesystem mode) | Read-only analysis | Full wrap-up workflow |
| campaign-organizer | Functional (filesystem mode) | Manual vault management | Full automation |

### Required Obsidian Community Plugins

Install these from Settings > Community Plugins > Browse:

1. **Smart Connections** -- Semantic search of vault content.
   Powers context-aware entity and relationship discovery.

2. **Templater** -- Template engine for entity and session file
   creation from structured templates.

3. **Local REST API** -- Exposes an HTTP API for reading and
   writing vault files programmatically.

4. **MCP Tools** -- Exposes vault operations as MCP tools for
   Claude. Provides search, file listing, and file retrieval
   capabilities.

### Configuring the MCP Server

After installing MCP Tools:

1. Open Obsidian Settings > MCP Tools.
2. Enable the MCP Server.
3. Note the port number and any authentication settings.
4. Add the MCP server to your Claude configuration so Claude
   can access your vault through the MCP tools.

### Connecting Claude to Obsidian

Add the Obsidian MCP server to your Claude MCP configuration
(`.mcp.json` in your project or Claude Desktop settings) so that
Claude can use tools like `search_vault`, `search_vault_simple`,
`search_vault_smart`, `list_vault_files`, and `get_vault_file`.

### Verify the Connection

Ask Claude to search your vault:

> "Search my vault for any NPCs"

If the connection is working, Claude will use the MCP tools to
query your Obsidian vault and return results.

## Using Without Obsidian

Two skills work without Obsidian:

**ttrpg-expert** is fully functional and provides:

- Game system rules help and validation
- NPC, location, faction, and item generation
- Session planning and encounter design advice
- Scenario writing assistance
- Canon management guidance
- Continuity checking (from conversation context)
- General GM support across all four game systems

**campaign-organizer** works in filesystem mode — it creates
the same structured markdown files, folder hierarchy, YAML
frontmatter, and wiki-links, just without Obsidian's graph
visualization and semantic search. Open the folder in Obsidian
later for the full experience.

**campaign-qa**, **session-prep**, **session-play**, and
**session-wrapup** also work in filesystem mode — same
audit procedures and lifecycle workflows, using
Glob/Grep/Read instead of MCP tools.
Obsidian adds faster search and graph visualization but
is not required.

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
