# Settings

Faults in the vault's settings (a misspelt name, a bad value, an old
name, a retired setting). A `STOP` could show players more than the GM
meant, and the build refuses. Run it when the GM asks about settings, a
build stopped on one, and in a full QA pass. Never open the settings
file to read it.

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/vault_check.py" "<vault>" settings
```

"Settings: no faults": say so and stop. Otherwise rows come in three
groups.

1. `fix:` rows are certain: they cannot show players more or switch
   anything on. Tell the GM in a short list; on a yes add `--fix`.
2. `proposed:` rows would switch something on or publish more; each
   says what it does. Put them three to five at a time. For each yes
   run the command again with `--apply publish.inbx` (the name in the
   row), several names allowed.
3. Rows with no fix give what the setting takes (`<name>` is as shown
   in the row in full: `settings describe publish.link_previews`).
   With no suggested name, ask the GM what the key was meant to do,
   then find it with `settings list`. A hiding key written beside
   `publish:` instead of under it has no fix (the tool cannot move it):
   add its entries with `settings add`, then, on the GM's yes, delete
   the stray line. Apply the answer:

```bash
TOOL="${CLAUDE_PLUGIN_ROOT}/tools/publish/bin/gm-publish.js"
node "$TOOL" settings set publish.link_previews=off --vault "<vault>"
node "$TOOL" settings add publish.exclude_sections Rumours --vault "<vault>"
node "$TOOL" settings unset publish.link_preview --vault "<vault>"
node "$TOOL" settings list
```

A fault in the site folder's file is fixed by the vault update.
