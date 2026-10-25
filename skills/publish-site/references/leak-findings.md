# When the leak check stops a deploy

Read this only when `deploy` stops on the leak check (its JSON has
`refused: true` and `leaks.findings`). `TOOL` is the publish tool, as in
`SKILL.md`. If the JSON has `refused: true` and no `leaks`, the check could
not run: show the GM `messages` word for word and stop. Nothing was uploaded.

## What happened

Nothing was uploaded. Before every upload the tool reads
the finished player site for sentences the vault hides (four words or more),
for secret names, and for the words the GM listed under `player_site.never_show`. Each finding is something the vault keeps from players and the
built site shows anyway. Say that in a line or two, in plain words, then take
the findings one at a time. `node "$TOOL" leaks list --json --config
<dir>/vault.config.json` shows them again.

## For each finding

Show the sentence (`shown`), the page it is on (`page`), the note it comes from
(`note`) and the rule that hides it (`reason`). The same sentence from the same
note on a page and in the site's data files (`previews.json`,
`search-index.json#<page>`, the search entry for that page) is one leak: take
it once. Offer three choices.

- **Fix the note.** Open the note at the section or field `reason` names. If the
  sentence is meant to be public, move it into a published section. If it is
  meant to stay hidden and the site shows it anyway, the tool has a bug: take the
  third choice. After a fix, rebuild and deploy again.
- **Accept it**, only on the GM's word:
  `node "$TOOL" leaks accept <page> <id> --config <dir>/vault.config.json`.
  This also covers the sentence's copies in the site's data files. Say that the
  acceptance holds while the page and the sentence stay the same.

When several findings sit on one page, or come from one note, ask whether the
GM gave that page or note to the players on purpose (a handout, a letter the
party read in full). On a yes, offer to accept them all in one step:
`leaks accept --page <page>` for every finding on the page, or
`leaks accept --note <note>` for every finding from the note (same `TOOL` and
`--config` as above). Each is still recorded as its own page and sentence. If
accepting stops because the site's publish tool is too old, run the update it
names, then accept again.
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

A finding with the code `NEVER_SHOW` is a word the GM listed under
`player_site.never_show`. The build does not remove it: fix the note or the
build step that puts it on the page, accept it, or, if the word no longer needs
guarding, `node "$TOOL" settings remove player_site.never_show "<word>" --vault
<vault>` on the GM's word. Each file with the word (a page, a data file such
as the search index, a copied file's name) is its own finding, accepted on its
own. Never offer `leaks accept --note player_site.never_show`: it accepts
every listed word on every page at once.

A finding with the code `PROP_UNREVEALED` is a whole file: `page` is the
file of a prop whose note (`note`) the site holds back, at its own address
or as the same bytes elsewhere (a copy left in a kept folder, a picture a
published note embeds). If the players already have the prop, offer to
publish its note: `node "$TOOL" explain "<note>" --config
<dir>/vault.config.json` says what holds it back, and on a yes
`manifest apply --publish "<note>"` (same `TOOL` and `--config`). Otherwise
offer to remove the copy, or the embed or link that ships it, saying
exactly which file or line goes, and change it on a yes. Or accept it, on
the GM's word, as above.

## When they are settled

Run `deploy` again. `node "$TOOL" leaks check --config <dir>/vault.config.json`
names accepted findings the site no longer has; offer `leaks prune` to remove
them.

Never edit `_meta/publish-list.yaml` by hand. Accepting is the way past a
finding the GM means to keep. Only when the GM says, in this conversation, to
put the site online as it is, run the same `deploy` with `--ignore-leaks`: it
prints every finding and uploads anyway, and accepts nothing, so the next deploy
stops again. Never add it on your own.
