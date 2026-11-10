# gma: the command reference

`gma` is one entry point for the gm-apprentice vault scripts and the
publish tool. Work from these pages, not from `--help` or memory: each
command's page says when to use it, what it needs, every flag, and an
example that is checked against the real command.

There is no `gma` on the PATH: where these pages write `gma`, run {gma}.

- `gma llms` prints this index; `gma llms <command>` prints that
  command's page. Read the page before the first use of a command in a
  task.
- Most commands that write preview first and write only with `--write`
  (or `--apply`, `--execute`); show the GM the preview before the write.
- Exit status 2 means the call was wrong (read the command's page) or the
  command could not run on a right one: unreadable settings, or a publish
  tool that stops answering part-way through `vault-check`. The `error:`
  line on stderr says which.
  When you pipe a command into `head`, `tail` or `grep`, put
  `set -o pipefail` first so its exit status survives.
- Quote a vault path or note name with spaces in it.

<!-- BEGIN GENERATED: gma -->
One entry point for the gm-apprentice vault scripts.

```text
gma <command> ... [options]
```

| Argument | Value | Help |
|---|---|---|
| `--version` |  | print the plugin version |
| `<command>` | `dnd-ddb`, `dnd-sheet`, `graph-check`, `gurps-check`, `gurps-skill-default`, `image`, `index-build`, `ingest-images`, `ingest-survey`, `links`, `migrate`, `moments`, `plan-check`, `plans-index`, `prop-move`, `reconcile-scan`, `relink`, `reveal`, `reveal-scan`, `rules-lookup`, `scene-queue`, `schema-rules`, `section`, `session-context`, `stamp-entities`, `tones`, `update`, `vault-check`, `vault-scaffold`, `vault-search`, `vault-write`, `workaround`, `publish`, `tool`, `llms` | the command to run; each has its own --help |
<!-- END GENERATED -->

<!-- BEGIN GENERATED: gma llms -->
The command reference: when to use each command, its flags, an example.

```text
gma llms [<command>]
```

| Argument | Value | Help |
|---|---|---|
| `<command>` |  | the command whose page to print; none prints the index |

Example: `gma llms relink`
<!-- END GENERATED -->

## Commands

<!-- BEGIN GENERATED ROUTING -->
| Command | Page | Summary |
|---|---|---|
| `dnd-ddb` | `gma llms dnd-ddb` | Bring a D&D 5e PC note up to date from D&D Beyond. |
| `dnd-sheet` | `gma llms dnd-sheet` | Report and fill the derived numbers on a D&D 5e PC note. |
| `graph-check` | `gma llms graph-check` | Vault graph queries: orphans, unresolved links, dead ends, backlinks. |
| `gurps-check` | `gma llms gurps-check` | GURPS 4e sheet arithmetic checks. |
| `gurps-skill-default` | `gma llms gurps-skill-default` | Add a GURPS skill to a PC's sheet at its default level. |
| `image` | `gma llms image` | Draw a vault's pictures inside its spending limits. |
| `index-build` | `gma llms index-build` | Derive _meta/index.md from a vault scan. |
| `ingest-images` | `gma llms ingest-images` | File and link vault-ingest image material. |
| `ingest-survey` | `gma llms ingest-survey` | Classify vault-ingest source material. |
| `links` | `gma llms links` | List a vault's broken links by kind, and fix them. |
| `migrate` | `gma llms migrate` | Bring a vault and its site up to the plugin's version. |
| `moments` | `gma llms moments` | A wrap-up's Memorable Moments, as the Story page reads them. |
| `plan-check` | `gma llms plan-check` | Session Plan conformance checks. |
| `plans-index` | `gma llms plans-index` | Narrative-plan and midwife-adventure discovery. |
| `prop-move` | `gma llms prop-move` | Move a vault's own props into prop notes. |
| `reconcile-scan` | `gma llms reconcile-scan` | What reconcile counts before it talks to the GM. |
| `relink` | `gma llms relink` | Rename or move a note and rewrite every link to it. |
| `reveal` | `gma llms reveal` | Apply the GM's yes to what a session let the players learn. |
| `reveal-scan` | `gma llms reveal-scan` | What is still hidden in the notes a session touched. |
| `rules-lookup` | `gma llms rules-lookup` | Record-level lookup over the ttrpg-expert systems corpus. |
| `scene-queue` | `gma llms scene-queue` | The prep queue: scenes written ahead and not yet played. |
| `schema-rules` | `gma llms schema-rules` | Canonical vault schema rules and relationship vocabulary. |
| `section` | `gma llms section` | Print one section of a note by heading path. |
| `session-context` | `gma llms session-context` | Session-prep context bundle in one call. |
| `stamp-entities` | `gma llms stamp-entities` | Batch frontmatter writes for the session workflows. |
| `tones` | `gma llms tones` | List a vault's stray tone words, and tidy them. |
| `update` | `gma llms update` | Update a vault and its site to the plugin's version, with a plain report. |
| `vault-check` | `gma llms vault-check` | Vault content checks: frontmatter, names, index, drafts and more. |
| `vault-scaffold` | `gma llms vault-scaffold` | Build a new vault's skeleton, or list what one lacks. |
| `vault-search` | `gma llms vault-search` | Ranked vault search. |
| `vault-write` | `gma llms vault-write` | Place text the apprentice wrote into vault notes. |
| `workaround` | `gma llms workaround` | Record the vault's workarounds by the issue each stands in for. |
| `publish` | `gma llms publish` | Build and deploy the campaign site (runs the publish tool under node). |
| `tool` | `gma llms tool` | Download the publish tool (installs without it), or print where it is. |
| `llms` | this page | The command reference: when to use each command, its flags, an example. |
<!-- END GENERATED -->
