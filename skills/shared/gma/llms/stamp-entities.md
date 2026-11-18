# gma stamp-entities

Use it for the frontmatter writes the session workflows make across many notes: dates, session stamps, tags, canon status. It needs the vault and the notes; it previews unless `--write` is given.

<!-- BEGIN GENERATED: gma stamp-entities -->
Batch frontmatter writes for the session workflows.

```text
gma stamp-entities <vault> [<files> ...] [options]
```

| Argument | Value | Help |
|---|---|---|
| `<vault>` |  | the vault folder |
| `<files>` |  | vault-relative paths |
| `--session` | `SESSION` | asOfSession value, written verbatim: a bare number (9) or a label ("Chapter 4, Session 9") |
| `--date` | `DATE` | lastUpdated value, YYYY-MM-DD |
| `--retag` | `RETAG` | OLD=NEW chapter tag swap |
| `--set` | `KEY=VALUE` | set a top-level or one-level dotted key; a JSON list (["[[A]]", "B"]) sets a top-level list; repeatable (repeatable) |
| `--add` | `KEY=VALUE` | append one item to a top-level list field, skipping one it already holds (repeatable) |
| `--increment` | `KEY` | add one to an integer field; repeatable (repeatable) |
| `--advance` | `KEY=FROM:TO` | set KEY to TO only when it is FROM; repeatable (repeatable) |
| `--promote` |  | canon_status DRAFT or absent -> AUTHORITATIVE |
| `--supersede-by` | `LINK` | canon_status: SUPERSEDED plus superseded_by |
| `--reconciled` | `YYYY-MM-DD` | reconciled date |
| `--repair-canon` |  | repair legacy canon-status keys; sweeps the whole vault when no FILE is given |
| `--force-shape` |  | allow asOfSession to change shape (label <-> bare number) in files that already use one |
| `--write` |  | apply changes (default: dry run) |

Example: `gma stamp-entities "<vault>" "<note>" --set status=active --write`

Example: `gma stamp-entities "<vault>" "<scene>" --set 'entities=["Ada", "Bram"]' --add locations=Mill --write`
<!-- END GENERATED -->
