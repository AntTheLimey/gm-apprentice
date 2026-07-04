# Vault Access Reference

Read this file to determine how to access the campaign vault.
Filesystem tools are the default and always work; the official
Obsidian CLI is an optional enhancement for search and graph
queries.

## Environment Detection

On first invocation, run `command -v obsidian`.

- **Binary present** → Obsidian CLI tier available (requires
  the Obsidian app; a command auto-launches it if closed).
  Announce: "Obsidian CLI detected — using it for vault
  search and graph queries."
- **Binary absent** → Filesystem mode. Announce: "Working in
  filesystem mode. Files will be Obsidian-compatible."
- **User override** → If user says "use filesystem mode",
  respect it even if the CLI exists. Announce: "Obsidian CLI
  available but using filesystem mode as requested."

The CLI ships with Obsidian 1.12.7+ and is enabled via
Settings → General → "Command line interface". Full command
list: `obsidian help`. Docs: https://obsidian.md/help/cli

Detection notes:

- Probe once per session; reuse the result across skills.
- Binary present ≠ CLI working. If a CLI call errors or
  times out (CLI setting disabled in Obsidian, vault not
  registered, app cannot launch), say so and fall back to
  filesystem mode for the rest of the session.
- A user override binds the whole session — never select
  CLI commands later. CLI commands launch the Obsidian app
  if closed; in filesystem mode, never invoke the CLI.

## Tool Mapping

Reads, listing, writes, and frontmatter edits always use the
native Read/Glob/Write/Edit tools in both modes — they are
safer and permission-tracked. Exact-term search is Grep in
both modes: benchmarked at equal result quality and ~20%
fewer tokens than CLI search. The CLI earns its keep on:

| Operation | Obsidian CLI | Filesystem fallback |
|-----------|--------------|---------------------|
| Ranked/prose search | `search query=".." limit=N` (`search:context` for snippets) | Grep is literal — try synonyms |
| Backlinks to a note | `backlinks file=".."` | Grep for `[[Name]]` variants |
| Vault-wide graph health | `orphans`, `unresolved`, `deadends` (benchmarked 2.4× faster) | Build a link map with Grep |
| Base views | `base:query file=".." view=".." format=json` | Read the `.base` YAML only |

`backlinks` with the `total` flag counts link instances, not
distinct linking notes — parse the list when you need a note
count.

## Vault Targeting — Mandatory

CLI commands default to the *most recently focused* vault,
which may be a completely unrelated vault. Every invocation
must pin the vault explicitly, as the first parameter:

```bash
obsidian vault="My Campaign" search query="cult" limit=10
```

The campaign folder path is not the vault name. Resolve the
name once — run `obsidian vaults` and match it to the
confirmed folder path — then reuse it for the session. Quote
values containing spaces. `file=` resolves like a wikilink
(name only, underscores as registered); `path=` is exact
from the vault root.

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

- **Graph queries** — backlinks, orphans, and unresolved
  links fall back to ripgrep approximations over
  `[[wiki-links]]`.
- **Ranked search** — Grep is literal matching; Obsidian's
  search ranks results across prose.
- **Juggl graph visualization**, **Templater
  auto-application**, and **Dataview queries** are
  Obsidian-UI-only in any mode — metadata is written but
  only renders inside the app.

## Canonical CLI Reference

If the kepano/obsidian-skills plugin is installed, its
`obsidian-cli` skill offers fuller command coverage than the
essentials above — which are sufficient for vault work.
Install commands live in the README under "Enabling the
Obsidian CLI".
