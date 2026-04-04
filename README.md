# gm-apprentice

TTRPG Game Master skills for Claude. An apprentice that helps GMs
run tabletop role-playing games -- from rules validation and content
generation to campaign management and session lifecycle support.

## Skills

| Skill | Description | Obsidian Required |
|-------|-------------|-------------------|
| **ttrpg-expert** | Rules engine, content generation, canon management, continuity checking, session planning, encounter design, scenario writing | Optional |
| **campaign-organizer** | Campaign architect -- classifies, structures, cross-references, and interlinks campaign content with knowledge graph metadata. Works with Obsidian or plain filesystem. | Recommended |
| **campaign-qa** | Campaign quality auditing -- canon audit, timeline validation, name similarity, clue redundancy, graph health checks | Primary |
| **session-lifecycle** | Session lifecycle management -- prep, play, wrap-up, and reconciliation between planned and actual session content | Primary |

## Supported Game Systems

- Call of Cthulhu 7th Edition (CoC 7e)
- GURPS 4th Edition
- Forged in the Dark (Blades in the Dark)
- D&D 5th Edition (2024 Revision)

## Installation

```
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

## Obsidian Setup

Three of the four skills (campaign-organizer, campaign-qa,
session-lifecycle) work with an Obsidian vault to manage campaign
content. The ttrpg-expert skill works standalone.

### Dependency Tiers

| Skill | No Obsidian | Obsidian (no MCP) | Full Setup (Obsidian + MCP) |
|-------|-------------|-------------------|----------------------------|
| ttrpg-expert | Fully functional | Enhanced continuity checks | Best experience |
| campaign-qa | Not functional | Partial (file reads only) | Full QA auditing |
| session-lifecycle | Advisory only (~40%) | Read-only analysis | Full lifecycle management |
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

The remaining two skills (campaign-qa, session-lifecycle)
require an Obsidian vault to function meaningfully.

## License

Content (skills and markdown) is licensed under
[CC-BY-SA 4.0](LICENSE). Code (scripts, hooks, and executable
files) is licensed under [MIT](LICENSE-CODE).
