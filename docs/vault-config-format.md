# The vault settings format

This page is for people who write tools that work with a gm-apprentice
vault. It says where the vault keeps its settings, what shape the file has,
and how another tool should read and change it.

For what each setting does, see [site-settings.md](site-settings.md). That
page is the list. This one is the format.

## The two files

A vault keeps its settings and the tools' own bookkeeping apart.

| File | Holds | Who writes it |
|------|-------|---------------|
| `_meta/vault-config.yaml` | The settings: choices the GM makes | The GM, or the `gm-apprentice-publish settings` command |
| `_meta/vault-state.json` | Bookkeeping the tools keep | The tools only |

The settings file is plain YAML with nothing else in it. There is no
frontmatter and no prose. A GM can edit it by hand, and the file keeps
its comments and its order when the command changes it.

A note that is not a setting, such as the GM's own conventions, goes in a
separate file. Nothing reads such a note as a setting.

## The shape of the settings file

The top level holds four names and nothing else: `version`, `vault`,
`player_site` and `gm_site`.

- `version` is the number of this layout. It is the integer `1`.
- `vault` holds what is true of the vault whatever site it has: the game
  system, the campaign's name, the pictures folder.
- `player_site` holds everything about the site the players see.
- `gm_site` is reserved for a site the GM keeps. Nothing under it is read
  yet. A tool may put its own settings there later; today the reader gives
  one warning and ignores the content.

Names are grouped, so a setting is a path: `player_site.hide.sections` is
`sections` inside `hide` inside `player_site`. A key written with nothing
after it counts as not set, except the four switches `player_site.publish`,
`player_site.sheets.show`, `player_site.features.live_stats` and
`player_site.features.inbox`, where an empty key is a fault.

An example:

```yaml
version: 1
vault:
  kept_by: gm
  campaign: The Long Night
  system: coc-7e
  attachments: Pictures
player_site:
  publish: true
  folder: ../long-night-site
  title: The Long Night
  hide:
    mode: player
    drafts: true
  features:
    search: true
    connections: web
  landing:
    max_npcs: 8
```

Settings left out take their default. A hiding list is the exception to
read with care: a list written in the file replaces the built-in list, it
does not add to it. The `settings add` command starts from the built-in
list.

A switch takes `true` or `false`, or one of the words `yes`, `no`, `on`
and `off`, in any case. Other values are named in the schema.

## The schema

[`tools/publish/schema/vault-config.schema.json`](../tools/publish/schema/vault-config.schema.json)
is a JSON Schema (draft 2020-12) for the file. It is generated from the
tool's own list of settings and a test fails if it drifts. Use it to
validate a file or to drive an editor.

The schema stops at an unknown name in the same places the tool does: the
top level, directly under `vault` and `player_site`, and anywhere under
`player_site.hide`. A misspelt name there would otherwise hide less than the
GM meant, so the build refuses it. Elsewhere an unknown name is allowed by
the schema, and the tool warns about it.

The schema describes the file as the GM writes it. It does not describe
resolved values. For those, ask the tool (below).

## Reading and writing

Read the file with a YAML library. Do not read it with a pattern or line by
line.

Write it through the command, not with a YAML library of your own:

```text
gm-apprentice-publish settings set player_site.features.search=false --vault <vault>
```

The command checks the name and the value against the list, changes only the
lines it must, and writes all of a change or none of it. A tool that rewrites
the file whole loses the GM's comments and may write a value the build then
refuses. `settings --help` lists the other verbs: `get`, `add`, `remove`,
`unset`, `describe`, `check`, `list`, `raw`, `setup-note` and `move`.

The command reads the file, changes it and puts it back. Do not write the
file yourself while the command runs: there is no lock, and whoever saves
last wins.

## Reading resolved values

To learn what a setting is now, run:

```text
gm-apprentice-publish settings get --json --vault <vault>
```

The file alone does not say it: a setting left out has a default, and a
value that cannot be read falls back to a safe one. The output is the stable
way to read the result.

The output is one JSON object:

- `values` holds every setting by its full name (`player_site.hide.mode`),
  not nested.
- `origins` holds, under the same names, where each value came from:
  `default`, `file`, `site-file`, `old-name` or `fault`. `fault` means the
  file's value could not be read and the value shown is the fallback.
- `written` holds, under the same names, the name the vault's own file
  writes the setting under: the same name on the new layout, the old
  file's name (`publish.site_title`) on the old one. A message to the GM
  names a setting this way.
- `faults` is a list of problems found in the file. Each has `name`,
  `level` (`stop` or `warn`), `kind` and `message`, and may have `setting`,
  `suggest` and `use`. A `stop` fault means a player build refuses to run.
- `file` says which settings file was read: `path`, `exists`, `hasSiteBlock`
  (whether it holds the site's block of settings, `player_site:`) and
  `leftover` (whether an old file sits beside the new one). On the old
  layout it also has `inline`, true when its `publish:` block is written on
  one line.

Pass one or more names to limit the output to those settings.
`settings check` prints only the faults and exits 1 when one stops the
build.

## Telling the layouts apart

A vault is on one of three layouts. The tool decides by which file exists:

- `_meta/vault-config.yaml` exists: the new layout. The old file, if it is
  still there, is not read and is reported as left over.
- Only `_meta/vault-config.md` exists: the old layout.
- Neither exists: the vault has no settings yet.

Do not infer the layout from file contents.

## The old file

Before this layout, settings lived in the frontmatter of
`_meta/vault-config.md`, under a `publish:` block with other names, such as
`publish.exclude_sections`. The tool still reads that file, and still writes
to it, at the old names. Version 1.10.54 is the release that moves vaults to
the new file. The old file's reader stays for two releases after that one,
then goes.

`gm-apprentice-publish settings move` takes a vault from the old file to the
new one. Do not run it by hand yet: the next release runs it, and teaches the
plugin's own scripts to read the new file at the same time. It changes nothing unless the new file resolves to exactly what the
old one did. When it cannot promise that, it says why and leaves the vault
alone. The old file's prose and any keys that are not settings move to
`_meta/vault-notes.md`.

A vault whose site is pinned by another tool stays on the old file until
that tool is version 1.23.0 or later.

## The state file

`_meta/vault-state.json` is a JSON object. Two keys matter:

- `gm_apprentice_version` is the plugin version the vault was last updated
  to.
- `setup` is the note the publish set-up guide leaves for itself between
  runs.

Other keys may appear and must be kept. Do not edit the file by hand. The
`settings setup-note` command reads and writes `setup`.
