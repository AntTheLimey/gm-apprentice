# The One-Time Workaround Sweep

Runs when the update says "No workaround record yet", or when the GM asks.
A vault whose agents built stand-ins for plugin gaps before workarounds
were recorded has no record of them, so no update can offer them back when
their issue ships. The sweep finds them once. `GMA` below is
`gma`.

1. **Scan.** Run `GMA workaround scan "<vault>"`. It lists the lines that
   cite a gm-apprentice issue in these places only: the vault's root
   `CLAUDE.md` and `AGENTS.md`, the notes directly in `_meta/`, notes
   named or tagged "workaround", and the vault agent's memory folder. A
   stand-in that no line there names (a field on a PC note, say) is not
   found: ask the GM about any they know of. It finds the memory folder
   itself (Claude Code's `~/.claude/projects/<slug>/memory`, where
   `<slug>` is the vault's full path with every character that is not a
   letter or digit made `-`). If the memory is elsewhere, add
   `--memory <folder>`. It records only that a scan ran and what it read.
2. **Read its last lines to the GM**: how many memory files it read and
   from where, or that it found no memory folder, and any "Could not
   read" line. A scan that read no memory has not looked there.
3. **Show the GM every candidate**, one at a time or as a short list:
   the issue, the line, where it is. Ask which are stand-ins built for a
   plugin gap. Numbering in a postmortem or a list (`#1` to `#8`) is not an
   issue number: skip it unless the GM says it is.
4. **Record only the yeses.** For each, run `GMA workaround add` as
   `shared/filing-plugin-issues.md` step 2 says, with every place it
   lives. Record nothing the GM did not say yes to.
5. **Close the sweep.** Run `GMA workaround swept "<vault>"`, so the update
   stops asking for it. Run it even when nothing was recorded. It refuses
   until a scan has read a memory folder; when the vault's agent keeps no
   memory, add `--no-memory`.
