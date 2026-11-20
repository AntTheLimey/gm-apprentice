# gma reveal

Use it after the GM agrees what a session let the players learn: it publishes those notes, lifts `withheld`, stamps props and logs it. With `--unmask`, a disguised NPC the players saw unmasked takes its `unmasked_name` into `aliases` and its `unmasked_portrait` as `portrait`, and Playing Them's `**Unmasked:**` becomes its `**Speech:**`. It needs the vault and the session; it previews unless `--write` is given.

<!-- BEGIN GENERATED: gma reveal -->
Apply the GM's yes to what a session let the players learn.

```text
gma reveal <vault> --session SESSION [options]
```

| Argument | Value | Help |
|---|---|---|
| `<vault>` |  | the vault folder |
| `--session` | `SESSION` | the session's name, e.g. 'Session 12' |
| `--publish` | `PATH` | a note to publish (repeatable) |
| `--released` | `PATH=WHAT` | a note and what came out of it, to log (repeatable) |
| `--unmask` | `PATH` | a disguised NPC the players saw unmasked: its unmasked_name and unmasked_portrait become its own (repeatable) |
| `--write` |  | make the changes (default: preview) |

Example: `gma reveal "<vault>" --session "<title>" --publish "<path>" --write`
<!-- END GENERATED -->
