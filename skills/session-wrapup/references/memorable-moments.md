# Memorable Moments

Read when `moments.py <vault> status` says `moments on`: the site
shows a wrap-up's Memorable Moments as cards on its Story page.
`moments.py` is `python3
"${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/moments.py"`.

## This wrap-up

- Notes that bring moments (a gmassistant.app export, or the GM's
  own): carry them into `## Memorable Moments` as written, tagged.
- Notes that bring none: offer to write them from the Play Notes,
  and write them only on the GM's yes. As many as the session gave;
  none is a fine answer. Each is one bold beat line, or a
  block-quoted line of table dialogue with a `— [[Speaker]]` line,
  then one italic context line. Faithful to the notes: invent
  nothing.
- Tag every moment: end its last line with ` #moment/<kind>`, one
  of status's `kinds`, picked from what the moment says.
- Send the section with the other `##` sections.
- Then run `moments.py <vault> check "<wrap-up>"` and fix each
  moment it names (`UNTAGGED`, `UNKNOWN`) before going on.

## Back-fill, offered once per campaign

When status's `backfill` line says `not offered`, offer once, after
Step 5, to tag the moments in past wrap-ups and write moments for
those with none. `moments.py <vault> list` names them; the GM picks
all, some or none. Then run `moments.py <vault> offered`, whatever
the answer, so it is never offered again.

For each wrap-up picked:

- With moments: `moments.py <vault> show "<wrap-up>"` numbers them.
  Pick each untagged one's kind and send `N<TAB>kind` rows to
  `moments.py <vault> tag "<wrap-up>"` (dry run, then `--write`).
  It changes nothing but the tags.
- With none: write them from that session's Play Notes (its recap
  if it has none) as above, show the GM, and on their yes place
  them with `vw wrapup-add "<wrap-up>" --write`.
