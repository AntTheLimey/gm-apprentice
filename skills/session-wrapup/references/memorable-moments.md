# Memorable Moments

Read when `gma moments <vault> status` says `moments on`: the site
shows a wrap-up's Memorable Moments as cards on its Story page.

Players read every card. A moment comes only from what happened at
the table as the players saw it (the Play Notes, the player-facing
recap): never from GM Notes, gm-only text or a secret.

## This wrap-up

- Notes that bring moments (a gmassistant.app export, or the GM's
  own): carry them into `## Memorable Moments` as written, tagged.
  A speaker line is `— [[Speaker]]` when that note exists, the
  plain name otherwise.
- Notes that bring none: offer to write them from the Play Notes,
  and write them only on the GM's yes. As many as the session gave;
  none is a fine answer. Each is one bold beat line, or a
  block-quoted line of table dialogue with a speaker line, then one
  italic context line. Faithful to the notes: invent nothing.
- Tag every moment: end its last line, the italic one, with
  ` #moment/<kind>`, one of status's `kinds`, picked from what the
  moment says:

  ```markdown
  **Mal lit a match and watched the flame lean toward the wall.**
  *How the party found the hidden passage.* #moment/intriguing
  ```

- Send the section with the other `##` sections.
- After the write, step 5b runs `gma moments <vault> check "<wrap-up>"`.

## Back-fill, offered once per campaign

When status's `backfill` line says `not offered`, offer once, after
step 5c, to tag the moments in past wrap-ups and write moments for
those with none. `gma moments <vault> list --except "<this wrap-up>"` names them; the GM picks all, some or none. Then run `gma moments <vault> offered`, whatever
the answer, so it is never offered again.

For each wrap-up picked:

- With moments: `gma moments <vault> show "<wrap-up>"` numbers them.
  Pick each untagged one's kind and send `N<TAB>kind` rows to
  `gma moments <vault> tag "<wrap-up>"` (dry run, then `--write`).
  It changes nothing but the tags.
- With none: write them from that session's Play Notes (its
  player-facing recap if it has none) as above, show the GM, and on
  their yes place them with `vw wrapup-add "<wrap-up>" --write`
  (`--append` when it already has the heading).
