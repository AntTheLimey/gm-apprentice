# gma reconcile-promote

Use it at the end of reconcile, once the GM approves: it promotes the Wrap-Up, marks the session index reviewed and promotes exactly the DRAFTs `reconcile-scan` lists as created or played this session. Preview first, then `--write`; it writes every note or none.

<!-- BEGIN GENERATED: gma reconcile-promote -->
Promote a reconciled session: Wrap-Up, index, and the DRAFTs the scan lists.

```text
gma reconcile-promote <vault> <wrap_up> --reconciled YYYY-MM-DD [options]
```

| Argument | Value | Help |
|---|---|---|
| `<vault>` |  | the vault folder |
| `<wrap_up>` |  | the Wrap-Up: its path (vault-relative or absolute) or its name |
| `--reconciled` | `YYYY-MM-DD` | the date stamped as the Wrap-Up's reconciled: |
| `--except` | `NOTE` | a note of the scan's lists the GM has not confirmed: left DRAFT (path or name; repeatable) (repeatable) |
| `--write` |  | write it (default: preview) |

Example: `gma reconcile-promote "<vault>" "<wrap-up>" --reconciled 2026-11-17 --write`
<!-- END GENERATED -->
