# gma rules-lookup

Use it first for a one-line rules question (a cost, a stat, a modifier), before opening a whole reference file. It needs the system and the term; `--kind` narrows the record type.

<!-- BEGIN GENERATED: gma rules-lookup -->
Record-level lookup over the ttrpg-expert systems corpus.

```text
gma rules-lookup <system> <term> [options]
```

| Argument | Value | Help |
|---|---|---|
| `<system>` |  | system slug, a recognised alias, or 'all' |
| `<term>` |  | name to look up |
| `--kind` | `KIND` | restrict to one record kind |
| `--variant` | `VARIANT` | include this variant's records |
| `--limit` | `LIMIT` |  |
| `--json` |  | emit the records as JSON instead of rows |
| `--personal` |  | also read the gitignored personal/ files |
| `--systems-dir` | `SYSTEMS_DIR` |  |

Example: `gma rules-lookup gurps-4e "Broadsword" --kind skill`
<!-- END GENERATED -->
