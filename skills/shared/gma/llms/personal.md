# gma personal

Use it before reading or saving a GM's personal reference files: their own notes from books they own (setting, factions, NPCs, tables). It prints the folder they live in, `~/gm-apprentice/personal/<system>/`, and with `--system` that system's files, README first; read the README, then only the files the question needs. It first copies any personal files left in the plugin's own folders (an update leaves them in the old version's) into that folder, never moving, deleting or overwriting, and says so in one line each. When the GM asks you to keep notes from a book, write them into that system's folder: never into the plugin's folders. It never prints a file's contents.

<!-- BEGIN GENERATED: gma personal -->
Where the GM's personal reference files live, and what is there.

```text
gma personal [options]
```

| Argument | Value | Help |
|---|---|---|
| `--system` | `SYSTEM` | list this system's files (fitd, gurps-4e, coc-7e, dnd-5e-2024, pf2e, or generic for any other game) |
| `--json` |  | print the result as JSON |

Example: `gma personal --system fitd`
<!-- END GENERATED -->
