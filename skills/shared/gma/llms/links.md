# gma links

Use it to find a vault's broken links and fix them: point a name at the right note (`retarget`) or turn its links back into plain text (`unlink`). It needs the vault; with no command it reports, and a fix writes only with `--write`.

<!-- BEGIN GENERATED: gma links -->
List a vault's broken links by kind, and fix them.

```text
gma links <vault> [<command>] [<names> ...] [options]
```

| Argument | Value | Help |
|---|---|---|
| `<vault>` |  | the vault folder |
| `<command>` | `retarget`, `unlink` | the fix to make (default: report only) |
| `<names>` |  | the broken link names, as the report gives them (retarget: NAME NOTE) |
| `--keep-text` |  | retarget: keep the old words as the link's display text |
| `--write` |  | make the change (default: preview) |
| `--in` | `NOTE` | unlink: only in this note (repeatable) |
| `--as` | `WORDS` | unlink: the words for a link with no display text |
| `--bare` |  | unlink: also turn links that give no path |
| `--pick` | `N` | unlink: only the preview row with this number (repeatable) |

Example: `gma links "<vault>" unlink "<note>" --in "<page>"`
<!-- END GENERATED -->
