# gma prop-move

Use it once per vault, to move props a site script built (or hand-made prop pages) into prop notes. It needs the vault; `plan` writes nothing, so show the GM the plan before `apply`.

<!-- BEGIN GENERATED: gma prop-move -->
Move a vault's own props into prop notes.

```text
gma prop-move <vault> <mode> [options]
```

| Argument | Value | Help |
|---|---|---|
| `<vault>` |  | the vault folder |
| `<mode>` | `plan`, `apply` | plan (writes nothing) or apply |
| `--decisions` | `FILE` | a JSON file of decisions that override what is inferred |
| `--draft` | `OUT` | plan: write the decisions used to this file |
| `--json` | `OUT` | plan: write the rows and counts as JSON to this file |

Example: `gma prop-move "<vault>" plan`
<!-- END GENERATED -->
