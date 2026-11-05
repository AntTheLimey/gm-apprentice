# gma graph-check

Use it for questions about links between notes: what nothing links to, links that resolve nowhere, notes that link out to nothing, and what links to one note. It needs the vault and one query; it reads only.

<!-- BEGIN GENERATED: gma graph-check -->
Vault graph queries: orphans, unresolved links, dead ends, backlinks.

```text
gma graph-check <vault> <command> [<name>] [options]
```

| Argument | Value | Help |
|---|---|---|
| `<vault>` |  | the vault folder |
| `<command>` | `orphans`, `unresolved`, `deadends`, `backlinks`, `ambiguous`, `all` | the query to run |
| `<name>` |  | target note name (backlinks only) |
| `--folder` | `FOLDER` | restrict results to this subfolder |
| `--exclude` | `EXCLUDE` | glob of relpaths or top-level dirs to skip (repeatable) |

Example: `gma graph-check "<vault>" orphans --folder Characters`
<!-- END GENERATED -->
