# gma reveal-scan

Use it in wrap-up to list what is still hidden in the notes a session touched, before asking the GM what to reveal. It needs the vault and the session index; it reads only.

<!-- BEGIN GENERATED: gma reveal-scan -->
What is still hidden in the notes a session touched.

```text
gma reveal-scan <vault> <session> [options]
```

| Argument | Value | Help |
|---|---|---|
| `<vault>` |  |  |
| `<session>` |  | the session index's path or file name |
| `--also` | `PATH` | a vault-relative note this run wrote; repeat for each (repeatable) |

Example: `gma reveal-scan "<vault>" "<session index>" --also "<path>"`
<!-- END GENERATED -->
