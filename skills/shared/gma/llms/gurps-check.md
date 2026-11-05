# gma gurps-check

Use it to check a GURPS 4e PC sheet's own arithmetic (lift, encumbrance, defenses, points, skills, damage). It needs the sheet's path; it reads only, and its findings are advice for the GM, since perks and talents can shift a number on purpose.

<!-- BEGIN GENERATED: gma gurps-check -->
GURPS 4e sheet arithmetic checks.

```text
gma gurps-check <sheet> [<command>]
```

| Argument | Value | Help |
|---|---|---|
| `<sheet>` |  | the PC sheet's path |
| `<command>` | `attributes`, `encumbrance`, `load`, `defenses`, `points`, `skills`, `damage`, `all` | the check to run (default: all) |

Example: `gma gurps-check "<PC note>" all`
<!-- END GENERATED -->
