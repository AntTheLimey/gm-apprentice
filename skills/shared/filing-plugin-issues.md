# Filing Plugin Issues

For any skill, or a vault's own agent, that finds something the
gm-apprentice plugin cannot do, or does wrong, and builds a stand-in so the
GM can carry on: a note, a field, a CSS section, a site script, a `_meta`
note or a memory note of your own.

1. **Find or file the issue.** Search `AntTheLimey/gm-apprentice` first
   (`gh issue list --search "<words>"`). If none fits, draft one: what the
   GM wanted, what the plugin did, the plugin version, and the stand-in you
   mean to build. Show the draft, and run `gh issue create` only on the
   GM's yes.
2. **Record the stand-in** once it is built, with the issue it waits on:

   ```text
   python3 "${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/gma.py" workaround add "<vault>" --issue N --what "<one plain line>" --kind note --where <path>
   ```

   `--kind` is note, field, css, script, meta or memory. Give a
   `--where` for every place it lives: a path in the vault, or
   `memory:<file>` for your own memory. When the next update finds a
   release that ships the issue, it offers the GM to retire the stand-in.
3. **Add `--release X.Y.Z`** when `add` says a release's notes already
   mention the issue and that release only partly fixed it: run the same
   `add` again with the release that finishes it, if you know it; if not,
   say so to the GM.

With no issue (the GM said no to filing), record nothing: there is nothing
for an update to offer it back against. The script's `workaround --help`
has the rest.
