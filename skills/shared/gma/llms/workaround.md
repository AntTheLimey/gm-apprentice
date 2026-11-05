# gma workaround

Use it when you build something in a vault to stand in for a gm-apprentice issue that has not shipped yet: a note, a field, a CSS section, a site script, a `_meta` note or a memory note of your own. Record it with the issue number it waits on, and `gma update` offers to retire it once a release ships that issue. It needs the vault.

- **Record one:** `gma workaround add "<vault>" --issue N --what "<one plain line>" --kind note --where <path>`. The kind is one of note, field, css, script, meta or memory. Give a `--where` for every place it lives: a path relative to the vault, or `memory:<file>` for your own memory. Add `--release X.Y.Z` only when the CHANGELOG maps the issue to the wrong release. An umbrella issue that a release only partly fixed still reads as shipped there: record it with `--release` set to the release that finishes it, if you know it, or leave the issue as it is and tell the GM so. Whether to retire is always the GM's call.
- **The one-time sweep:** a vault with workarounds made before this existed has no record of them, and the update says so. Run `gma workaround scan "<vault>" --memory <your memory folder>`: it lists every line that cites an issue, and writes nothing. Show the GM each finding that is a workaround, `add` only those they say yes to, then run `gma workaround swept "<vault>"`.
- **When the update offers one** (a `workaround:<id>` question, options `retire` and `keep`): ask the GM. On `keep`, answer `--answer workaround:<id>=keep`; it is never offered again. On `retire`, answer `--answer workaround:<id>=retire`: the update removes nothing and its report says `Retire <id>: <where>`. Switch those places to the built-in way the question names, remove the workaround, then run `gma workaround retire "<vault>" <id> --reason "<why>"`.
- `gma workaround list "<vault>"` shows them all with their state.
- When the plugin's CHANGELOG cannot be read (a skill zip install has none), the update offers nothing, not even for a hand-set `--release`, and says so.

<!-- BEGIN GENERATED: gma workaround -->
Record the vault's workarounds by the issue each stands in for.

```text
gma workaround <command> ...
```

| Argument | Value | Help |
|---|---|---|
| `<command>` | `add`, `list`, `keep`, `retire`, `scan`, `swept` | what to do; each has its own --help |

Example: `gma workaround add "<vault>" --issue 510 --what "Gravity noted by hand on the sheet" --kind note --where "PCs/Six.md"`
<!-- END GENERATED -->

<!-- BEGIN GENERATED: gma workaround add -->
record a workaround the GM said yes to

```text
gma workaround add <vault> --issue N --what TEXT --kind KIND [options]
```

| Argument | Value | Help |
|---|---|---|
| `<vault>` |  | the vault folder |
| `--issue` | `N` | the gm-apprentice GitHub issue it stands in for |
| `--what` | `TEXT` | what it is, in one plain line; its id is made from this |
| `--kind` | `note`, `field`, `css`, `script`, `meta`, `memory` | what sort of thing it is |
| `--where` | `PATH` | a vault-relative path it lives in, or memory:<file> for agent memory (repeatable) |
| `--release` | `X.Y.Z` | the release that ships the issue, when the CHANGELOG's is wrong |
<!-- END GENERATED -->

<!-- BEGIN GENERATED: gma workaround list -->
the recorded workarounds

```text
gma workaround list <vault> [options]
```

| Argument | Value | Help |
|---|---|---|
| `<vault>` |  | the vault folder |
| `--json` |  | print them as JSON |
<!-- END GENERATED -->

<!-- BEGIN GENERATED: gma workaround keep -->
the GM keeps it: never offered again

```text
gma workaround keep <vault> <id>
```

| Argument | Value | Help |
|---|---|---|
| `<vault>` |  | the vault folder |
| `<id>` |  | the workaround's id |
<!-- END GENERATED -->

<!-- BEGIN GENERATED: gma workaround retire -->
record it retired, once the agent has switched to the built-in way

```text
gma workaround retire <vault> <id> --reason TEXT
```

| Argument | Value | Help |
|---|---|---|
| `<vault>` |  | the vault folder |
| `<id>` |  | the workaround's id |
| `--reason` | `TEXT` | why, in a few words |
<!-- END GENERATED -->

<!-- BEGIN GENERATED: gma workaround scan -->
lines citing a gm-apprentice issue, for the one-time sweep (writes nothing)

```text
gma workaround scan <vault> [options]
```

| Argument | Value | Help |
|---|---|---|
| `<vault>` |  | the vault folder |
| `--memory` | `DIR` | the agent's memory folder, read as well |
| `--json` |  | print the lines as JSON |
<!-- END GENERATED -->

<!-- BEGIN GENERATED: gma workaround swept -->
record that the one-time sweep is done

```text
gma workaround swept <vault>
```

| Argument | Value | Help |
|---|---|---|
| `<vault>` |  | the vault folder |
<!-- END GENERATED -->
