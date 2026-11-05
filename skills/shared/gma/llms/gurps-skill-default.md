# gma gurps-skill-default

Use it when a GURPS PC uses a skill they have no points in, often because a weapon's to-hit row names it: it works out the default level and adds the skill at 0 points. It needs the sheet and the skill's name; it previews unless `--write` is given.

<!-- BEGIN GENERATED: gma gurps-skill-default -->
Add a GURPS skill to a PC's sheet at its default level.

```text
gma gurps-skill-default <sheet> <skill> [options]
```

| Argument | Value | Help |
|---|---|---|
| `<sheet>` |  | the PC sheet's path |
| `<skill>` |  | the skill's name |
| `--difficulty` | `DX/A` | the skill's difficulty, e.g. DX/A, for a skill the tables lack |
| `--default` | `DEFAULTS` | the skill's defaults, for a skill the tables lack |
| `--for` | `ATTACK` | the attack row the skill is for |
| `--write` |  | write the skill to the sheet (default: preview) |

Example: `gma gurps-skill-default "<PC note>" "<skill>" --write`
<!-- END GENERATED -->
