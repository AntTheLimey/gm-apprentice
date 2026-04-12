# gm-apprentice

TTRPG Game Master skills for Claude. An apprentice that helps GMs
run tabletop role-playing games -- from rules validation and content
generation to campaign management and session lifecycle support.

## Skills

| Skill | Description | Obsidian Required |
|-------|-------------|-------------------|
| **ttrpg-expert** | Rules engine, content generation, canon management, continuity checking, session planning, encounter design, scenario writing | Optional |
| **campaign-organizer** | Campaign architect -- classifies, structures, cross-references, and interlinks campaign content with knowledge graph metadata. Works with Obsidian or plain filesystem. | Recommended |
| **campaign-qa** | Campaign quality auditing -- canon audit, timeline validation, name similarity, clue redundancy, graph health checks. Works with Obsidian or plain filesystem. | Recommended |
| **session-lifecycle** | Session lifecycle management -- prep, play, wrap-up, and reconciliation between planned and actual session content. Works with Obsidian or plain filesystem. | Recommended |
| **publish-site** | Publish your campaign vault as a static website on GitHub Pages. Guides setup, routine rebuilds, troubleshooting, and schema migrations. | Recommended |

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

1. Open Claude Desktop
2. Go to **Settings > Plugins > Browse plugins**
3. Switch to the **Personal** tab
4. Click **+** to add a marketplace
5. Enter: `https://github.com/AntTheLimey/gm-apprentice`
6. Once synced, click **Install** on the gm-apprentice plugin

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
- [session-lifecycle](docs/session-lifecycle.md) -- session
  prep, play, and wrap-up
- [publish-tool](docs/publish-tool.md) -- publishing your vault
  as a static website
- [gm-apprentice-publish](tools/publish/README.md) -- npm package
  reference for the publish tool

## Obsidian Setup

Three of the four skills (campaign-organizer, campaign-qa,
session-lifecycle) work with an Obsidian vault to manage campaign
content. The ttrpg-expert skill works standalone.

### Dependency Tiers

| Skill | No Obsidian | Obsidian (no MCP) | Full Setup (Obsidian + MCP) |
|-------|-------------|-------------------|----------------------------|
| ttrpg-expert | Fully functional | Enhanced continuity checks | Best experience |
| campaign-qa | Functional (filesystem mode) | Partial (file reads only) | Full QA auditing |
| session-lifecycle | Functional (filesystem mode) | Read-only analysis | Full lifecycle management |
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

**campaign-qa** and **session-lifecycle** also work in
filesystem mode — same audit procedures and lifecycle
workflows, using Glob/Grep/Read instead of MCP tools.
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
