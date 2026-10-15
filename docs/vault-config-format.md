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

A setting can hold a list of entries that each have several parts, such as
`player_site.menu_extra`, where an entry has a `label`, a `link` and
optionally a `group`. In the file it is a YAML list of maps. Through the
command an entry is added one at a time, each part as `name=value`, and
taken out by its `label`:

```text
gm-apprentice-publish settings add player_site.menu_extra label=Gazetteer link=gazetteer/index.html group=World --vault <vault>
gm-apprentice-publish settings remove player_site.menu_extra Gazetteer --vault <vault>
```

A list of words, such as the statuses under `vault.statuses`, is read by
more than one tool: the publish tool reads all three lists, and the
plugin's own scripts read `vault.statuses.out_of_play` and the numbers
under `vault`. A tool that needs one of these asks the command for it, so
the answer is the same everywhere; it does not keep its own copy of the
words.

## The site folder

The folder that holds the site (`player_site.folder`) keeps a
`vault.config.json` with one setting, `vaultPath`: where the vault is on
that computer. It stays out of the vault because it belongs to one
computer. Everything else about the site is a setting of the vault,
including the address, the host, the output folder, the Cloudflare project,
the folders a rebuild keeps (`player_site.url`, `player_site.host`,
`player_site.output`, `player_site.cloudflare_project`,
`player_site.keep`) and the build steps.

The build steps are two lists of shell commands, `player_site.before_build`
and `player_site.after_build`. The publish tool runs them in the site
folder, in order, each printed first, when it builds or deploys. The
`before_build` steps run before anything is read from the vault, and the
`after_build` steps run after every file is written (and only if the build
had no errors). Each step is a shell command with the site folder's
`node_modules/.bin` put first on the path, as `npm run` does, and a limit of
ten minutes. A step that fails, or runs out of time, stops the build and
nothing is published. A dry run, `explain`, `manifest`, `doctor --site`, the
preview, the sheet view and `deploy --no-build` run none. A tool that builds
the site itself has to do the same.

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

## Finding the command

The command ships inside the gm-apprentice plugin, not on the npm
registry. On a machine with the plugin installed it is in the plugin
cache, one folder for each installed version:

```text
TOOL="<plugin-cache>/gm-apprentice/<version>/tools/publish/bin/gm-publish.js"
node "$TOOL" settings --help
```

`<plugin-cache>` is `~/.claude/plugins/cache/gm-apprentice` on macOS and
Linux. Use the newest version there. Wherever this page writes
`gm-apprentice-publish`, run `node "$TOOL"`. Inside a site folder set up
by the plugin, `npx gm-apprentice-publish` runs the copy that site is
pinned to.

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
`unset`, `carry`, `describe`, `check`, `list`, `raw`, `setup-note` and `move`.

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

- `values` holds every setting by its full name (`player_site.title`),
  not nested.
- `origins` holds, under the same names, where each value came from:
  `default`, `file`, `site-file`, `old-name` or `fault`. `fault` means the
  file's value could not be read and the value shown is the fallback.
- `written` holds, under the same names, the name the vault's own file
  writes the setting under: the same name on the new layout, the old
  file's own name for it on the old one. A message to the GM
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
- Only the old file exists (see the next section): the old layout.
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
new one, and the plugin's update runs it for each vault. It changes nothing unless the new file resolves to exactly what the
old one did. When it cannot promise that, it says why and leaves the vault
alone. The old file's prose and any keys that are not settings move to
`_meta/vault-notes.md`.

A site folder's `vault.config.json` once held more than `vaultPath`:
`siteUrl`, `host`, `outputDir`, `cloudflarePagesProject` and `preserveDirs`.
Its `package.json` held the `prebuild` and `postbuild` scripts that were the
site's build steps. The update moves these into the vault as the settings
named under "The site folder" above, and `gm-apprentice-publish settings
move` carries them on a vault already moved. Until it does, the reader takes
those five keys from the site file when the vault sets none, and `deploy`
runs the `package.json` steps. A site whose installed publish tool is older
than 1.24.0 keeps its keys and steps where they are, because that tool
cannot run steps from the vault.

The move holds back when the publish tool installed in the vault's site
is older than 1.23.0, whoever pinned it: that tool would read the moved
vault as having no settings. The vault stays on the old file and the
update says so on every pass, until the tool is 1.23.0 or later. That
makes `settings move` safe to run by hand too; `--check` shows what it
would do.

## The state file

`_meta/vault-state.json` is a JSON object. Two keys matter:

- `gm_apprentice_version` is the plugin version the vault was last updated
  to.
- `setup` is the note the publish set-up guide leaves for itself between
  runs.

Other keys may appear and must be kept. Do not edit the file by hand. The
`settings setup-note` command reads and writes `setup`.
