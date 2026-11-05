# The One-Time Workaround Sweep

Runs when the update says "No workaround record yet", or when the GM asks.
A vault whose agents built stand-ins for plugin gaps before workarounds
were recorded has no record of them, so no update can offer them back when
their issue ships. The sweep finds them once. `GMA` below is
`python3 "${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/gma.py"`.

1. **Find the vault agent's memory folder.** Claude Code keeps it at
   `~/.claude/projects/<slug>/memory`, where `<slug>` is the vault's full
   path with every `/` replaced by `-` (`/home/gm/Vaults/Canticle`
   becomes `-home-gm-Vaults-Canticle`). If unsure, list
   `~/.claude/projects` and pick the folder that matches. No such folder:
   leave `--memory` out.
2. **Scan.** Run `GMA workaround scan "<vault>" --memory <folder>`. It
   lists every line in the vault and the memory that cites a gm-apprentice
   issue, and writes nothing.
3. **Show the GM every candidate**, one at a time or as a short list:
   the issue, the line, where it is. Ask which are stand-ins built for a
   plugin gap. Numbering in a postmortem or a list (`#1` to `#8`) is not an
   issue number: skip it unless the GM says it is.
4. **Record only the yeses.** For each, run `GMA workaround add` as
   `shared/filing-plugin-issues.md` step 2 says, with every place it
   lives. Record nothing the GM did not say yes to.
5. **Close the sweep.** Run `GMA workaround swept "<vault>"`, so the update
   stops asking for it. Run it even when nothing was recorded.
