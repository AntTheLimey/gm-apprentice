# gma section

Use it to read one section of a note without reading the whole note: a session bundle prints a long PC section as an outline, and each outline line names the note and path to fetch. It needs the vault, the note (a path, name or alias) and a heading path such as `Current Status/Session Log`; it reads only. Titles match without regard to case, a heading inside a code block does not count, and a section runs to the next heading of the same or a higher level. A path that matches two headings is refused with each candidate listed: pass a longer path, or start it with `##` marks to pin the first heading's level (`"## GM Notes/Hooks"`). Candidates no path can tell apart (two `### Hooks`) are fetched through their parent section.

<!-- BEGIN GENERATED: gma section -->
Print one section of a note by heading path.

```text
gma section <vault> <note> <path>
```

| Argument | Value | Help |
|---|---|---|
| `<vault>` |  | the vault folder |
| `<note>` |  | the note: a vault-relative path, name or alias |
| `<path>` |  | the heading path: Heading or Heading/Sub; '## Heading/Sub' pins the first heading's level |

Example: `gma section "<vault>" "<note>" "Current Status/Session Log"`
<!-- END GENERATED -->
