# gma index-build

Use it to rebuild `_meta/index.md` from the vault's notes when the index is stale or missing. It needs the vault; show the GM the diff it prints, then run it again with `--write`.

<!-- BEGIN GENERATED: gma index-build -->
Derive _meta/index.md from a vault scan.

```text
gma index-build <vault> [options]
```

| Argument | Value | Help |
|---|---|---|
| `<vault>` |  |  |
| `--write` |  | apply the rendered index (default: dry run) |
| `--force` |  | replace an _meta/index.md this tool did not make |
| `--date` | `DATE` | override today's date (YYYY-MM-DD) |

Example: `gma index-build "<vault>" --write`
<!-- END GENERATED -->
