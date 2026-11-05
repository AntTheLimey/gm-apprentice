# gma migrate

Use it when a skill's version gate says MISMATCH: `plan` shows what bringing the vault and site up to the plugin's version will do, `apply` does it. It needs the vault; show the GM the plan before any `apply`.

<!-- BEGIN GENERATED: gma migrate -->
Bring a vault and its site up to the plugin's version.

```text
gma migrate <vault> [<command>] [options]
```

| Argument | Value | Help |
|---|---|---|
| `<vault>` |  | the vault folder |
| `<command>` | `plan`, `apply` | plan (writes nothing) or apply (default: plan) |
| `--choose` | `ID[=VALUE]` | apply only: a Your-choice id from plan; repeatable (repeatable) |

Example: `gma migrate "<vault>" plan`
<!-- END GENERATED -->
