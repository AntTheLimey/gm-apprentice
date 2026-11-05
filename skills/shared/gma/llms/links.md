# gma links

Use it to find a vault's broken links and fix them: point a name at the right note (`retarget`) or turn its links back into plain text (`unlink`). It needs the vault; with no command it reports, and a fix writes only with `--write`.

<!-- BEGIN GENERATED: gma links -->
List a vault's broken links by kind, and fix them.

```text
gma links <vault> [<command>] [<names> ...] [options]
```

| Argument | Value | Help |
|---|---|---|
| `<vault>` |  |  |
| `<command>` | `retarget`, `unlink` |  |
| `<names>` |  |  |
| `--keep-text` |  |  |
| `--write` |  |  |
| `--in` | `NOTE` | (repeatable) |
| `--as` | `WORDS` |  |
| `--bare` |  |  |
| `--pick` | `N` | (repeatable) |

Example: `gma links "<vault>" unlink "<note>" --in "<page>"`
<!-- END GENERATED -->
