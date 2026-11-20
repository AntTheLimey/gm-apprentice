# gma table

Use it at the table, before play, to run tonight's session from the run sheet: a page on this computer (127.0.0.1, port 4322) that holds the Plan, the cast and the notes, and keeps the Table Log as the GM clicks. It needs node. It picks the session in progress, else the earliest open one (a Plan and no Wrap-Up), and names any other in progress. It files a missing Table Log first and says so once (`Filed the Table Log: Session 4 now counts as played.`), passes the active PCs as the party, then serves until Ctrl+C. A busy port or a wrapped-up session stops it with a plain line and files nothing. `gma publish table` is the same command. Session-play still writes the Play Notes beside it.

<!-- BEGIN GENERATED: gma table -->
Run tonight's session from the run sheet: a live page on this computer.

```text
gma table <vault> [options]
```

| Argument | Value | Help |
|---|---|---|
| `<vault>` |  | the campaign vault |
| `--session` | `SESSION` | the session to run: an index stem or path, a Plan path, or a name; none picks the one in progress, else the next open one |
| `--port` | `PORT` | the port on this computer (default 4322) |
| `--no-open` |  | do not open the page in the browser |

Example: `gma table <vault>`
<!-- END GENERATED -->
