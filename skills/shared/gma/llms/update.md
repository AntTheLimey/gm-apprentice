# gma update

Use it to bring a vault and its site up to the plugin's version: when a skill's version gate says MISMATCH, or the GM asks to update. It needs the vault. It does the bookkeeping itself (renames, moves, new folders, template copies, the site's publish tool), asks before anything that would remove what the GM wrote, and asks what only the GM can answer. It takes a backup of the notes before its first write, and ends with a plain report: what it did, what waits for the GM, what it could not read, and where the backup is.

How to run it:

1. Run `gma update "<vault>" --json`. Show the GM its `report` as it is, including any "Could not read" line and its fix.
2. Exit 3 means `questions` wait. Each has an `id`, `options` and `detail`. Put each one to the GM in plain words, one at a time: say what the change does (`detail.if_yes`), and for a template use `detail.summary` and `detail.comparison` to say what their version has that the plugin's does not, and what the plugin's adds. Never show a raw diff. A question with no `options` is something to fix by hand: tell the GM what and where (`detail.lines`).
3. Run it again with each answer: `--answer <id>=<option>`, one per question, with the `id` exactly as given (`template:x.md@1a2b3c4d`: the part after `@` names the text the GM was shown). An answer is applied only while that text is unchanged; otherwise "Worth knowing" says so and the question is asked again. `leave` is always an answer, and means leave it as it is. Every answer is kept in `_meta/update-record.json`, so the same question is not asked again while what it would change stays the same.
4. Exit 0 means done. Exit 1 means a step failed: the report names it under "Stopped"; what finished is kept and the next run carries on from the failed step. Exit 2 means it refused: the vault is not one it updates (first-time setup, not yet moved or left with something the build stops on, ahead of the plugin) or an answer is not one of the options; read the message.

With no GM to ask (a scheduled or unattended run), add `--headless`: it does the bookkeeping only, leaves every question for the next run with a GM, and says so. It takes no `--answer`.

When the GM later asks what an update did or how a template was decided, read `_meta/update-record.json`: `templates` says, per template, whose text it is, the release it matches and what was decided when; `answers` holds each answer; `updates` lists each run.

<!-- BEGIN GENERATED: gma update -->
Update a vault and its site to the plugin's version, with a plain report.

```text
gma update <vault> [options]
```

| Argument | Value | Help |
|---|---|---|
| `<vault>` |  | the vault folder |
| `--answer` | `ID@HASH=VALUE` | the GM's answer to a waiting question, by the id the report printed (the hash names the text the GM was shown; a changed question is asked again) (repeatable) |
| `--headless` |  | no GM to ask: do the bookkeeping only and leave every question for next time |
| `--json` |  | print the result as JSON instead of the report |

Example: `gma update ~/Vaults/Canticle --answer template:pc-coc-7e-regency.md@1a2b3c4d=keep`
<!-- END GENERATED -->
