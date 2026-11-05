# gma gurps-skill-default

Use it when a GURPS PC uses a skill they have no points in, often because a weapon's to-hit row names it: it works out the default level and adds the skill at 0 points. It needs the sheet and the skill's name; it previews unless `--write` is given.

<!-- BEGIN GENERATED: gma gurps-skill-default -->
Add a GURPS skill to a PC's sheet at its default level.

```text
gma gurps-skill-default <sheet> <skill> [options]
```

| Argument | Value | Help |
|---|---|---|
| `<sheet>` |  |  |
| `<skill>` |  |  |
| `--difficulty` | `DX/A` |  |
| `--default` | `DEFAULTS` |  |
| `--for` | `ATTACK` |  |
| `--write` |  |  |

Example: `gma gurps-skill-default "<PC note>" "<skill>" --write`
<!-- END GENERATED -->
