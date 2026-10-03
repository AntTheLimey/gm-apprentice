# Vault Migration Procedure

Runs when `vault_check.py <vault> version` returns `MISMATCH`. The
migration is a script; this file says how to drive it.

1. Run `python3 "${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/migrate.py" <vault> plan`
   and show the GM its lists as printed: Will do, Your choice, Needs a
   person, and, while the site's publish tool is out of date, Checked
   once the site's tool is updated. It writes nothing. `up to date`
   means there is nothing to do: skip to the end.
2. Ask once: "May I apply Will do and the checks listed to run once
   the site's tool is updated? Tell me which of Your choice you
   want." A choice that shows `id=<…>` needs the GM's answer for the
   value.
3. On the GM's yes, run the same script with `<vault> apply`, adding
   `--choose <id>` or `--choose "<id>=<value>"` once for each choice
   they took. An instruction already in the request ("apply the
   migration") is a yes. If it prints "the site's publish tool is
   updated; run plan again…", a check that waited on the update offers
   a choice the GM has not seen, so it did not stamp: go back to step 1
   and ask the GM only about the new rows.
4. Report what it printed under Did, and any `not offered: <id>` line
   (a choice it had nothing to apply to). Work through Needs a person with
   the GM, one row at a time; the script never changes those. A row
   ending "apply stops here until this is fixed" comes first.
   Rows from one check that share a message print it once, as
   `check (N): message`, with the paths indented under it. After an
   `apply`, `# N rows unchanged from the plan` stands for rows the
   plan already showed; only the rows it could not have shown print.
5. If it exits 1, give the GM the error line as printed. The vault is
   stamped at the last release that finished (the output says which,
   or "not stamped"), and the next run starts at the step that failed.
6. No GM reachable (a scripted or headless run with no instruction
   about the migration): run `plan`, report it, apply nothing.
7. Exit 2 is a refusal; the script changed nothing. A vault below
   1.10.12, or ahead of the plugin, cannot be migrated by this plugin:
   tell the GM the line it printed and stop. A `--choose` it rejects
   means the id was wrong: check it against `plan` and run again.

Then return to the calling skill, or carry on with the GM's request.
