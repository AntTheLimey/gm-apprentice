# When the leak check stops a deploy

Read this only when `deploy` stops on the leak check (its JSON has
`refused: true` and `leaks.findings`). `TOOL` is the publish tool, as in
`SKILL.md`.

## What happened

The site was built and nothing was uploaded. Before every upload the tool reads
the finished player site for sentences the vault hides (four words or more) and
for secret names. Each finding is something the vault keeps from players and the
built site shows anyway. Say that in a line or two, in plain words, then take
the findings one at a time. `node "$TOOL" leaks list --json --config
<dir>/vault.config.json` shows them again.

## For each finding

Show the sentence (`shown`), the page it is on (`page`), the note it comes from
(`note`) and the rule that hides it (`reason`). Offer three choices.

- **Fix the note.** Open the note at the section or field `reason` names. If the
  sentence is meant to be public, move it into a published section. If it is
  meant to stay hidden and the site shows it anyway, the tool has a bug: take the
  third choice. After a fix, rebuild and deploy again.
- **Accept it**, only on the GM's word:
  `node "$TOOL" leaks accept <page> <id> --config <dir>/vault.config.json`.
  Say that the acceptance holds while the page and the sentence stay the same.
- **Report a tool bug.** Use it when the note hides the sentence correctly and
  the site shows it. Draft a GitHub issue for `AntTheLimey/gm-apprentice` with
  the finding (page, the sentence clipped, `code`, `reason`), the hiding rule as
  the note writes it (the marker, section title or field name, never more of the
  GM's secret than the finding already shows), the plugin and tool versions
  (`node "$TOOL" --version`) and the build steps the site runs. Show the draft.
  Post it with `gh issue create` only on the GM's yes. The finding stays until it
  is fixed or accepted.

## Name findings

A finding with the code `ALIAS_IN_PROSE`, `WITHHELD_IN_PROSE` or
`WITHHELD_PUBLISHED` is a secret name on a public page. Fix it the way the
campaign-qa Site Faults check does; go there rather than repeating it. A name
can also be accepted, for a withheld name that is an ordinary word.

## When they are settled

Run `deploy` again. `node "$TOOL" leaks check --config <dir>/vault.config.json`
names accepted findings the site no longer has; offer `leaks prune` to remove
them.

Never edit `_meta/publish-list.yaml` by hand, and never look for a way round the
check: accepting is the only way past.
