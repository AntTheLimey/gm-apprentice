# gma ingest-survey

Use it first in vault-ingest, before reading any source file: it classifies what it can by extension, frontmatter and headings, and leaves the rest for reading. It needs the source folder; `--archive` with `--write` moves processed inbox files to `_inbox/_processed/`.

<!-- BEGIN GENERATED: gma ingest-survey -->
Classify vault-ingest source material.

```text
gma ingest-survey <dir> [options]
```

| Argument | Value | Help |
|---|---|---|
| `<dir>` |  | DIR to survey, or VAULT with --archive |
| `--archive` | `FILE ...` | files under _inbox/ to archive to _inbox/_processed/<date>/ (vault-relative, _inbox/-relative, or absolute) |
| `--write` |  | apply the archive move (default: dry-run plan). Only meaningful with --archive. |

Example: `gma ingest-survey "<source dir>"`
<!-- END GENERATED -->
