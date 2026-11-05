# gma ingest-images

Use it in vault-ingest before touching any image by hand: it sorts, converts, names, matches and files a source folder's images. It needs the vault and the source folder; it previews unless `--execute` is given.

<!-- BEGIN GENERATED: gma ingest-images -->
File and link vault-ingest image material.

```text
gma ingest-images <vault> <dir> [options]
```

| Argument | Value | Help |
|---|---|---|
| `<vault>` |  | the vault folder |
| `<dir>` |  | the folder of source material |
| `--execute` |  | write files and metadata (default: dry-run) |

Example: `gma ingest-images "<vault>" "<source dir>" --execute`
<!-- END GENERATED -->
