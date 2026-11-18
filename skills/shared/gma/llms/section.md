# gma section

Use it to read one section of a note without reading the whole note: a session bundle prints a long PC section as an outline, and each outline line names the note and path to fetch. It needs the vault, the note (a path, name or alias) and a heading path such as `Current Status/Session Log`; it reads only. Titles match without regard to case, a heading inside a code block does not count, and a section runs to the next heading of the same or a higher level. A path that matches two headings is refused with each candidate listed: pass a longer path, or start it with `##` marks to pin the first heading's level (`"## GM Notes/Hooks"`). Candidates no path can tell apart (two `### Hooks`) are fetched through their parent section. `--lead` in place of the path prints the text above the note's first heading or hidden block, where a scene keeps its Situation, Starts it and If-table; a batch's `=== section NOTE --lead` block writes it.

<!-- BEGIN GENERATED: gma section -->
Print one section of a note by heading path.

```text
gma section <vault> <note> [<path>] [options]
```

| Argument | Value | Help |
|---|---|---|
| `<vault>` |  | the vault folder |
| `<note>` |  | the note: a vault-relative path, name or alias |
| `<path>` |  | the heading path: Heading or Heading/Sub; '## Heading/Sub' pins the first heading's level |
| `--lead` |  | print the note's lead instead: the text above its first heading or hidden block (a scene's Situation, Starts it and If-table; on a paused scene, the text below its Paused section) |

Example: `gma section "<vault>" "<note>" "Current Status/Session Log"`
<!-- END GENERATED -->
