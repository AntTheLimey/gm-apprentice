# gma dnd-ddb

Use it to bring a D&D 5e PC note up to date from the character's public D&D Beyond page, or every linked PC with `--party`. It needs the note's `dndbeyond` field and a network connection; it previews unless `--write` is given, and keeps any cell the GM has marked with a reason.

<!-- BEGIN GENERATED: gma dnd-ddb -->
Bring a D&D 5e PC note up to date from D&D Beyond.

```text
gma dnd-ddb [<sheet>] [options]
```

| Argument | Value | Help |
|---|---|---|
| `<sheet>` |  | the PC note's path |
| `--write` |  | write the changes (default: preview) |
| `--party` | `VAULT` | every PC note in a vault that has a D&D Beyond link |
| `--on-build` |  | with --party: run only when vault.dndbeyond_sync is build |
| `--player-text` |  | the player's D&D Beyond text for each background part the note does not match (not report rows) |

Example: `gma dnd-ddb "<PC note>" --write`
<!-- END GENERATED -->
