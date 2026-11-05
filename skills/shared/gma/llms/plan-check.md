# gma plan-check

Use it after writing or editing a Session Plan, to check it against the plan rules, or with `--inventory` or `--state` to see which sections are filled. It needs the plan's path; it reads only.

<!-- BEGIN GENERATED: gma plan-check -->
Session Plan conformance checks.

```text
gma plan-check <plan> [options]
```

| Argument | Value | Help |
|---|---|---|
| `<plan>` |  | the Session Plan's path |
| `--headless` |  | the plan was written with no GM present: apply the hard guard |
| `--gm-input` | `intent`, `scenes`, `spotlight` | with --headless: the GM supplied the spine, so skip the guard; or name the parts the GM's request settled (intent, scenes, spotlight) |
| `--inventory` |  | list the plan's sections instead of findings |
| `--state` |  | print the prep-state comment instead of findings |
| `--json` |  | print as JSON |

Example: `gma plan-check "<plan>" --inventory`
<!-- END GENERATED -->
