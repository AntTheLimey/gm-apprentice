# gma vault-scaffold

Use it to set up a new vault, or to list what an existing one lacks. It needs the vault folder and the game system; it previews unless `--write` is given, and never overwrites what is there.

<!-- BEGIN GENERATED: gma vault-scaffold -->
Build a new vault's skeleton, or list what one lacks.

```text
gma vault-scaffold <vault> [options]
```

| Argument | Value | Help |
|---|---|---|
| `<vault>` |  |  |
| `--system` | `ID` | one of coc-7e, coc-7e-regency, gurps-4e, dnd-5e-2024, pf2e, fitd, or an alias |
| `--no-system` |  | no particular system: generic templates |
| `--name` | `TEXT` | campaign name for page titles (default: the vault folder's name) |
| `--inbox` |  | also create _inbox/ for vault-ingest |
| `--write` |  | create it (default: print the plan) |

Example: `gma vault-scaffold "<vault>" --system <id> --name "<campaign name>"`
<!-- END GENERATED -->
