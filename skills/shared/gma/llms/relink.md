# gma relink

Use it whenever a note is renamed or moved, so no link to it breaks. It needs the vault, the note's current path and its new name or path; it previews unless `--apply` is given.

<!-- BEGIN GENERATED: gma relink -->
Rename or move a note and rewrite every link to it.

```text
gma relink <vault> <old> <new> [options]
```

| Argument | Value | Help |
|---|---|---|
| `<vault>` |  | the vault folder |
| `<old>` |  | the note's path, or its filename when only one note has it |
| `<new>` |  | the new path, or a bare filename for a rename in place |
| `--apply` |  | make the change (default: preview) |

Example: `gma relink "<vault>" "<old path>" "<new name>" --apply`
<!-- END GENERATED -->
