# gma tones

Use it to find relationship tone words that are not on the list and tidy them. It needs the vault; with no command it reports, and a fix writes only with `--write`.

<!-- BEGIN GENERATED: gma tones -->
List a vault's stray tone words, and tidy them.

```text
gma tones <vault> [<command>] [<WORD> ...] [options]
```

| Argument | Value | Help |
|---|---|---|
| `<vault>` |  | the vault folder |
| `<command>` | `fix`, `uses`, `shown` | what to do (default: report only) |
| `<WORD>` |  | uses: the stray words to list; shown --accept: the NOTE:LINE places |
| `--near` |  | fix: change every NEAR word to its listed word |
| `--except` | `WORD` | fix --near: leave this word alone (repeatable) |
| `--set` | `OLD=NEW` | fix: change OLD to NEW (repeatable) |
| `--accept` |  | shown: record ties as accepted |
| `--write` |  | make the change (default: preview) |

Example: `gma tones "<vault>"`
<!-- END GENERATED -->
