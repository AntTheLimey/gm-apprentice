# gma workaround

Use it when you build something in a vault to stand in for a gm-apprentice issue that has not shipped yet: a note, a field, a CSS section, a site script, a `_meta` note or a memory note of your own. Record it with the issue number it waits on, and `gma update` offers to retire it once GitHub says that issue was fixed before the installed release came out. It needs the vault.

- **Record one:** `gma workaround add "<vault>" --issue N --what "<one plain line>" --kind note --where <path>`. The kind is one of note, field, css, script, meta or memory. Give a `--where` for every place it lives: a path relative to the vault, or `memory:<file>` for your own memory. Add `--release X.Y.Z` only when GitHub's answer would be wrong (the issue closed before its fix was whole). When GitHub already has the issue closed as fixed, `add` says so: if that fix only partly covers it, run the same `add` again with `--release` set to the release that finishes it (it sets the release on the one already recorded), or tell the GM you do not know it. Whether to retire is always the GM's call.
- **The one-time sweep:** a vault with workarounds made before this existed has no record of them, and the update says so. Run `gma workaround scan "<vault>"`: it lists the lines citing an issue in the root `CLAUDE.md` and `AGENTS.md`, the notes directly in `_meta/`, notes named or tagged workaround, and your memory folder, which it finds from the vault's path (`--memory <folder>` when it is elsewhere). Nowhere else: ask the GM about stand-ins no line there names. It says how many memory files it read, or that it found none, and records only that a scan ran and what it read, in the update record. Tell the GM that line, show them each finding that is a workaround, `add` only those they say yes to, then run `gma workaround swept "<vault>"`; it refuses until a scan has read a memory folder, unless you add `--no-memory` because you keep none.
- **When the update offers one** (a `workaround:<id>@<hash>` question, options `retire` and `keep`; answer with the id exactly as the report printed it): it says when GitHub closed the issue as fixed, which may be a part fix only, so ask the GM. It asks GitHub (`gh` when installed, else GitHub's public API) and offers nothing for an issue still open or closed as not planned. A `--release` set by hand is offered once the install reaches it, unless GitHub says the issue is open. On `keep`, answer `--answer workaround:<id>@<hash>=keep`; it is never offered again. On `retire`, answer `--answer workaround:<id>@<hash>=retire`: the update removes nothing and its report says `Retire <id>: <where>`. Switch those places to the built-in way the question names, remove the workaround, then run `gma workaround retire "<vault>" <id> --reason "<why>"`.
- `gma workaround list "<vault>"` shows them all with their state.
- When GitHub cannot be reached, the update offers nothing but hand-set releases, and says so in one line; the next update asks again.

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
| `--release` | `X.Y.Z` | the release that ships the issue, when the answer GitHub gives is wrong |
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
lines citing a gm-apprentice issue, for the one-time sweep (records only that a scan ran and what it read)

```text
gma workaround scan <vault> [options]
```

| Argument | Value | Help |
|---|---|---|
| `<vault>` |  | the vault folder |
| `--memory` | `DIR` | the agent's memory folder, when it is not under ~/.claude/projects where scan looks by default |
| `--json` |  | print the lines as JSON |
<!-- END GENERATED -->

<!-- BEGIN GENERATED: gma workaround swept -->
record that the one-time sweep is done

```text
gma workaround swept <vault> [options]
```

| Argument | Value | Help |
|---|---|---|
| `<vault>` |  | the vault folder |
| `--no-memory` |  | the vault's agent keeps no memory folder, so no scan read one |
<!-- END GENERATED -->
