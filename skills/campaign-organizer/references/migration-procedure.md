# Vault Update Procedure

Runs when `vault_check.py <vault> version` returns `MISMATCH`, or when
the GM asks to update the vault. The update is one command; this file
says how to drive it. It does the bookkeeping itself (renames, moves,
new folders, template copies, the site's publish tool), takes a backup
of the notes before its first write, and asks before anything that
would remove what the GM wrote. There is no separate "may I apply?"
step: run it.

1. Run `python3 "${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/gma.py" update <vault> --json`
   and show the GM its `report` as printed: Done, Waiting for you,
   Could not read, Worth knowing, and the Backup line.
2. **Could not read** lines name a file the update could not read and
   its fix (for an iCloud file, `brctl download "<path>"`). Tell the GM
   the file and the fix; the update left that file as it was.
3. **Exit 0** means done (or nothing to do). Go to the end.
4. **Exit 3** means `questions` wait. Each has an `id`, `options` and
   `detail`. Put each question to the GM once, one at a time, in plain
   words:
   - Say what saying yes would do (`detail.if_yes`).
   - A template question (`template:<file>@...`): use `detail.summary`
     and `detail.comparison` to say what the GM's version has that the
     plugin's does not, and what the plugin's adds. `keep` keeps theirs
     as it is; `take` puts the plugin's in its place. Never show a raw
     diff.
   - A question with no `options` is something to fix by hand: tell
     the GM what and where (`detail.lines`), then run the update again
     once it is fixed.
   - `leave` is always an answer and leaves that thing as it is.
5. Run it again with every answer, one `--answer` per question, by its
   `id` exactly as given (the `@` part names the text the GM saw):
   `python3 "${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/gma.py" update <vault> --json --answer template:pc-coc-7e-regency.md@1a2b3c4d=keep`.
   Each answer is kept in `_meta/update-record.json`, so the same
   question is not asked again while what it would change stays the
   same. If a file changed since the GM was asked, Worth knowing says
   so and the question comes back; if it exits 3 again, ask only about
   the new questions.
6. **Exit 1** means a step failed: give the GM the line under "Stopped"
   as printed. What finished is kept, and the next run carries on from
   the failed step.
7. **Exit 2** means it refused and changed nothing: the vault is not one
   it updates (first-time setup, not yet moved: see "A vault not yet
   moved" below, or ahead of the plugin), or an answer was not one of
   the question's options. Tell the GM what the message names and stop. For a rejected answer, check the id and
   value against the `--json` output and run again.
8. **No GM to ask** (a scheduled or unattended run): run
   `python3 "${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/gma.py" update <vault> --headless`.
   It does the bookkeeping only and leaves every question for the next
   run with a GM. Report what it printed, including how many questions
   wait. It takes no `--answer`.

**Asked later.** When the GM asks which version of a template they are
on, why, or what an update did, read `_meta/update-record.json`:
`templates` says, per template, whose text it is, the release it
matches and what was decided when; `answers` holds each answer;
`updates` lists each run and its backup.

**A vault not yet moved.** The update refuses it (exit 2; `vault_check.py
<vault> version` says `ERROR`) and names what is left on it: a stamp older
than 1.10.60, the old settings file, the old publish list, or a site
publish tool older than 1.27.0. This release no longer moves those. Tell
the GM what it names and the release it links to: update the vault with
plugin 1.10.134 first (that release's campaign-organizer, and its update),
then run this update again.

Then return to the calling skill, or carry on with the GM's request.
