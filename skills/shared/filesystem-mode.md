# Filesystem Mode Reference

Read this file when operating in filesystem mode (no Obsidian
MCP tools detected).

## Environment Detection

On first invocation, check for Obsidian MCP tools
(`search_vault`, `list_vault_files`, `get_vault_file`).

- **Tools present** → Obsidian mode. Announce: "Connected to
  Obsidian vault. Using MCP tools."
- **Tools absent** → Filesystem mode. Announce: "Working in
  filesystem mode. Files will be Obsidian-compatible."
- **User override** → If user says "use filesystem mode",
  respect it even if MCP tools exist. Announce: "Obsidian MCP
  available but using filesystem mode as requested."

## Tool Mapping

| Operation | Obsidian (MCP) | Filesystem |
|-----------|----------------|------------|
| Search for entities | `search_vault`, `search_vault_smart` | Grep/Glob |
| Read files | `get_vault_file` | Read tool |
| List files | `list_vault_files` | Glob tool |
| Write/edit files | MCP tools or Edit | Write/Edit tools |

## File Format

**Identical in both modes.** All files use:

- YAML frontmatter with all schema fields
- `[[wiki-links]]` for entity cross-references
- Quoted `"[[Entity Name]]"` in frontmatter (Juggl format)
- Same folder structure, `_meta/` schema, naming conventions

A campaign folder created in filesystem mode is a valid
Obsidian vault — open it in Obsidian at any time with zero
migration.

## What Is Lost in Filesystem Mode

- **Juggl graph visualization** — metadata is written but
  not visualizable until opened in Obsidian.
- **Smart Connections semantic search** — Weave mode's link
  discovery is limited to text/name matching.
- **Templater auto-application** — templates exist as files
  but don't auto-apply on note creation.
- **Dataview queries** — query syntax appears as plain text.
