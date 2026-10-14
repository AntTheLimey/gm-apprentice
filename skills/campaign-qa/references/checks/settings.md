# Settings

Faults in the vault's settings (a misspelt name, a bad value, an old
name, a retired setting). A `STOP` could show players more than the GM
meant, and the build refuses. Run it when the GM asks about settings, a
build stopped on one, and in a full QA pass. Never open the settings
file to read it (one exception, at the end).

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/vault_check.py" "<vault>" settings
```

"Settings: no faults": say so and stop. Otherwise rows come in three
groups.

1. `fix:` rows are certain: they cannot show players more or switch
   anything on. Tell the GM in a short list; on a yes add `--fix`.
2. `proposed:` rows would switch something on or publish more; each
   says what it does. Put them three to five at a time. For each yes
   run the command again with `--apply player_site.features.inbx` (the name in the
   row), several names allowed.
3. Rows with no fix give what the setting takes (`<name>` is as shown
   in the row in full: `settings describe player_site.features.link_previews`).
   With no suggested name, ask the GM what the key was meant to do
   and find the setting with `settings list`. Apply the answer:

```bash
TOOL="${CLAUDE_PLUGIN_ROOT}/tools/publish/bin/gm-publish.js"
node "$TOOL" settings set player_site.features.link_previews=off --vault "<vault>"
node "$TOOL" settings add player_site.hide.sections Rumours --vault "<vault>"
node "$TOOL" settings unset player_site.features.link_preview --vault "<vault>"
node "$TOOL" settings carry player_site.exclude_sections player_site.hide.sections --vault "<vault>"
node "$TOOL" settings list
```

`carry` puts a mis-named key's value under the right name and removes
the key. Two hiding lists that repeat or disagree (an old-named list
beside the right one) need no `carry`: `--fix` merges them.

**Keys and build steps left in the site folder** (`vault.config.json`,
`package.json`). Each has a row of one of the three kinds above. A
`fix:` row goes on `--fix`: moved into the vault's settings, or
dropped where the vault already sets it. A `proposed:` row waits for
the GM's yes and `--apply`. A row with neither says what holds it
there, or what to correct in the site folder.

**A file that is not valid YAML.** No `settings` command and no `--fix`
can read it, so this is the one time the file is opened. The message
names the line. Show the GM that line and the ones around it, agree
the correction, change only that line, then run `node "$TOOL" settings
check --vault "<vault>"`.
