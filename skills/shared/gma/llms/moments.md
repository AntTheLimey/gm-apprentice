# gma moments

Use it in wrap-up for a session's Memorable Moments: whether moments are on, which wrap-ups lack them, and tagging each moment with its kind. It needs the vault and, for most subcommands, the wrap-up.

<!-- BEGIN GENERATED: gma moments -->
A wrap-up's Memorable Moments, as the Story page reads them.

```text
gma moments <vault> <command> ...
```

| Argument | Value | Help |
|---|---|---|
| `<vault>` |  |  |
| `<command>` | `status`, `list`, `show`, `check`, `tag`, `offered` |  |

Example: `gma moments "<vault>" status`
<!-- END GENERATED -->

<!-- BEGIN GENERATED: gma moments status -->
on or off, the kinds, the back-fill offer

```text
gma moments <vault> status
```
<!-- END GENERATED -->

<!-- BEGIN GENERATED: gma moments list -->
wrap-ups with no moments or untagged ones

```text
gma moments <vault> list [options]
```

| Argument | Value | Help |
|---|---|---|
| `--except` | `WRAPUP` | leave this wrap-up out (this session's) |
<!-- END GENERATED -->

<!-- BEGIN GENERATED: gma moments show -->
one wrap-up's moments, numbered

```text
gma moments <vault> show <wrapup>
```

| Argument | Value | Help |
|---|---|---|
| `<wrapup>` |  |  |
<!-- END GENERATED -->

<!-- BEGIN GENERATED: gma moments check -->
name untagged moments and tags that are no kind (exit 1 on the latter)

```text
gma moments <vault> check <wrapup>
```

| Argument | Value | Help |
|---|---|---|
| `<wrapup>` |  |  |
<!-- END GENERATED -->

<!-- BEGIN GENERATED: gma moments tag -->
tag moments (stdin: N<TAB>kind rows)

```text
gma moments <vault> tag <wrapup> [options]
```

| Argument | Value | Help |
|---|---|---|
| `<wrapup>` |  |  |
| `--write` |  |  |
<!-- END GENERATED -->

<!-- BEGIN GENERATED: gma moments offered -->
record that the back-fill was offered

```text
gma moments <vault> offered
```
<!-- END GENERATED -->
