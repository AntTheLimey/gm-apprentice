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
   migration") is a yes, but neither it nor a plain "go ahead" answers
   a choice shown as `id=<…>`: never run `apply` with one unanswered;
   ask for its value first. `leave` is an answer to every choice that
   needs a value (`--choose tone-words=leave` keeps things as they are).
   A yes/no choice (no value) left unanswered is a no: once the vault is
   stamped past its release it is not offered again (the checks that run
   on every pass, such as templates, come back on each plan). If it prints
   "the site's publish tool is updated; run plan again…", a check that
   waited on the update offers a choice the GM has not seen, so it did
   not stamp: go back to step 1 and ask the GM only about the new rows. If it prints
   `not answered: <id>=<…>` and `not stamped`, a choice that needs a
   value was left open: everything else was applied, but the vault stays
   unstamped so the choice comes back. Ask the GM, then run `apply` again
   with `--choose "<id>=<value>"` for it (the plan's stamp row names the
   choices it waits for). While the stamp is held, a `leave` answer and the said-once
   notices are not asked again; `--choose "<id>=<value>"` still overrides
   a remembered leave. A yes/no choice takes no value but `leave`.
4. Report what it printed under Did, and any `not offered: <id>` line
   (a choice it had nothing to apply to). Work through Needs a person with
   the GM, one row at a time; the script never changes those. A row
   ending "apply stops here until this is fixed" comes first.
   Rows from one check that share a message print it once, as
   `check (N): message`, with the paths indented under it. After an
   `apply`, `# N rows already shown in the plan` stands for rows the
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

**The settings move.** The update itself moves the vault's settings
to the new settings file (`settings-move`). Its rows under Needs a
person:

- The vault stays on the old file because its site's publish tool is
  older than 1.23.0 and cannot read the new one. The row comes back on
  every pass until that tool is updated; tell the GM once and carry on.
- The settings cannot move yet. Each row says what blocks the move, and
  the vault is not stamped until it has moved. A row naming a setting:
  campaign-qa's Settings check. A site folder that belongs to another
  vault or cannot be read: correct `vaultPath` in that site's
  `vault.config.json`. A `vault-notes.md` that already exists and
  differs: ask the GM, then move it aside. Then run the update again.
- Settings still in the site folder's file of a vault already moved:
  campaign-qa's Settings check.

Then return to the calling skill, or carry on with the GM's request.
