# gma tool

Use it when a message says the publish tool is not installed. The Claude Code plugin carries the tool; other installs download it once, on the first command that needs it, from the release that matches these skills (checked against its SHA256SUMS). If that download was blocked, for example by a sandbox without network access, ask the GM to allow `gma tool install`, or to run it once in a terminal as `python3 "<shared>/scripts/gma.py" tool install` with the full path filled in (`gma` alone is not a terminal command). `gma tool path` prints the tool in use.

<!-- BEGIN GENERATED: gma tool -->
Download the publish tool (installs without it), or print where it is.

```text
gma tool <command> ...
```

| Argument | Value | Help |
|---|---|---|
| `<command>` | `install`, `path` | install: download and check it now; path: print the tool in use |

Example: `gma tool install`
<!-- END GENERATED -->

<!-- BEGIN GENERATED: gma tool install -->
download and check the tool now

```text
gma tool install
```
<!-- END GENERATED -->

<!-- BEGIN GENERATED: gma tool path -->
print the tool in use

```text
gma tool path
```
<!-- END GENERATED -->
