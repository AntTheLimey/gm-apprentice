# Change requests — D&D 5e (2024)

Read this with `change-request-loop.md` when the campaign's `sheetFamily`
is `dnd`. It is step 2 of "When a batch arrives" for D&D.

D&D has no points pool, so nothing is costed: the table has already made the
ruling and you record it. There is no player override: the bounds below
hold whatever the request says the GM approved. Everything else (roster
match, questions, the ambiguity rule, the one deploy per batch, replies) is
in `change-request-loop.md`.
The note's layout, and how each cell is written, is in `ttrpg-expert`'s
`systems/dnd-5e-2024/character-sheet.md` under "Writing the Sheet in the
Vault". Follow it; it is not repeated here.

- **Notes and Current Status: always apply.** The player's own words, edited
  at their request, are trusted self-service: apply, never flag, log a `✓`.
- **Values the live sheet holds:** hit points, temporary hit points, death
  saves, hit dice spent, spell slots expended, a feature's uses, a magic
  item's charges, conditions, exhaustion, Heroic Inspiration, and a short or
  long rest ("took 9 damage", "used a 2nd-level slot", "I'm poisoned", "we
  took a long rest"). The built page decides what is live, not the config
  and not the note.

  **How to tell whether a thing is live.** The PC's built page in the site's
  output folder holds `id="dnd-live-data"` when the PC is live. That element
  is JSON:

  - **A counted thing** (hit dice, a slot row, a feature's uses, an item's
    charges) is live when `tracks` has an entry for it. Find the entry by
    its `label`, not by building its `key`. The label is the row's name as
    the page shows it: `Second Wind`, `Wand of Magic Missiles`. A slot
    row's label is its level (`1st`, `Pact (3rd)`). Hit dice are
    `Hit Dice`, or `Hit Dice d10` and `Hit Dice d6` when the PC has two
    kinds. Compare ignoring capitals and the style of quotes and dashes:
    the page turns `'` into `’`, `--` into a dash and `...` into `…`, so
    `Monk's Focus` typed from a request is `Monk’s Focus` on the page.
  - **Which table an entry is from** is the start of its `key`: `hd`,
    `slot`, `class`, `species`, `feat` or `item` (`item:wand of magic
    missiles`, `slot:1st`, `hd:hit dice`). Use it to tell a class feature
    from a feat of the same name.
  - **Death saves** are the two entries whose keys are `ds:s` and `ds:f`.
  - **Hit points** are live when `hpMax` is not `null`; temporary hit
    points when `tempLive` is `true`; exhaustion when `exhaustionLive`;
    Heroic Inspiration when `inspirationLive`.
  - **Conditions** are live unless `conditionsLive` is `false` (a name
    written as a link or with unusual characters; the reasons are in
    `live-state-flush.md`). When it is `false` the `Conditions` cell is
    the GM's own writing: a request to change conditions is case 2.
  - **Both rests** are live on any live page.

  **What to do.** Take these in order and stop at the first that fits:

  1. **The thing is live: `advice`.** Consider nothing else. A live value
     is changed on the PC's page (from any device), not in the note: for
     30 days after it was last saved there, `flush` writes the saved value
     over the note's cell, so an edit to the cell would be undone. Apply
     nothing and finalize:

     ```bash
     npx gm-apprentice-publish inbox reply <id> advice "That's live on your sheet: change it there and it saves straight away. Hit points, slots, uses, conditions and both rests are on the page."
     ```

  2. **Not live, and the cell cannot be read** (the usual reasons are in
     `live-state-flush.md`, "D&D 5e: why the page cannot read a cell").
     If two rows in the table share the name, go to case 4. Otherwise
     edit the cell only when the request states the new value outright
     ("my hit dice are 2 spent of 5"). An amount left counts when the
     row's maximum in the note is a whole number: "4 charges left" of `7`
     is a `Used` of `3`. Then collect the request into the applied batch.
     When the request gives only a change ("used a charge"), ask for the
     value, by the ambiguity rule in `change-request-loop.md`.
     Never guess a number to make a cell readable.

     Hit points are the one value with two cells. When `HP (Max)` is the
     cell that cannot be read, `HP (Current)` may still hold a number: a
     change to it is then applied as in case 3, kept at 0 or above, with
     no maximum to hold it to. Log **`⚠ NEEDS YOU`** saying `HP (Max)`
     cannot be read, because only the GM can fix that cell.
  3. **The PC is not live, and the cell reads.** The page shows it as the
     note has it. Edit the cell and collect the request into the applied
     batch. Keep hit points between 0 and `HP (Max)`, and a `Used` or
     `Expended` count between 0 and its total. Damage comes off temporary
     hit points first only if the player says so; if the PC has temporary
     hit points and the request does not say, ask. For a rest, change only
     the cells the player lists, and do not work out a rest by hand. A
     bare "we took a long rest" with nothing listed is ambiguous: ask
     which numbers changed.

     What follows from a number is the DM's call, not yours. Record the
     number, never add a condition or a death save the player did not ask
     for, and log **`⚠ NEEDS YOU`** when a change takes hit points to 0.
  4. **The PC is live, the thing is not, and you cannot tell why** (the
     cell looks fine, two rows share the name, or the table looks
     unusual). Do not edit. Log **`⚠ NEEDS YOU`** naming the row; two rows
     with one name is the usual cause, so say so when you see it. Reply
     once:

     ```bash
     npx gm-apprentice-publish inbox reply <id> rejected "Your sheet can't track that one yet, so I haven't changed it. The GM has been told."
     ```

  **A feature with no `Uses`** ("I used Action Surge", and the row's `Uses`
  is blank) fits none of the four: there is nothing to count yet, which is
  not a fault. Treat it as "any other sheet change" below: set `Uses` to the
  number the request gives, `Used` to `0` and `Recovers` to its phrase. If
  the request does not give the number of uses, ask. Once it is published
  the row is live, so the `applied` reply tells the player to mark the use
  on their sheet.

  **A request that mixes the two** ("took 9 damage and add a rope to my
  gear") gets one reply. Do the part that belongs in the note, by the
  bullet below, and say in the same `applied` reply which part the player
  changes on their own sheet. If nothing is left to apply, the reply is the
  `advice` of case 1.

- **Any other sheet change** (a level-up, a new spell, feature or feat, new
  gear or a magic item, an ability score, a proficiency) is made in the note,
  live-tracked or not. Every maximum on the page comes from the note, and
  the live sheet fits its saved counts to the new ones.
  1. Before you edit, keep the note's text as you read it and run the
     preview:

     ```bash
     python3 "${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/dnd_sheet.py" "<path to the PC note>"
     ```

     If the tool fails here (see "When the tool fails" below), the fault
     was there before you touched the note: leave the note untouched and
     end the request as that paragraph says.
  2. Edit the note. Leave the derived cells alone. A new row starts with
     `Used` at `0`. On a live-tracked PC, change the maxima (`HP (Max)`,
     `Uses`, `Charges`, `Total`) and leave the live cells as they are
     (`HP (Current)`, `Used`, `Expended`, and the rest): the player's
     saved values are fitted to the new maxima. The one exception is a
     cell the page could not read, which case 2 above handles.
  3. Run the preview again and read the report. A `KEPT` row is a value
     the GM set by hand: leave it as it is. If the tool did not fail, write
     the sums:

     ```bash
     python3 "${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/dnd_sheet.py" "<path to the PC note>" --write
     ```

  4. Collect the request into the applied batch; step 4 of "When a batch
     arrives" in `change-request-loop.md` builds and deploys.

  **When the tool fails.** The tool has failed when it prints an `ERROR`
  row, or when it exits with an error (any exit code other than 0). This
  holds for all three runs, `--write` included. Nothing is written while it fails, and
  a request left without a reply would only come back on a `still pending`
  line, so end it here. If an `ERROR` row came from your edit and you can see the
  mistake, fix it and run the preview again. Otherwise: put the note back
  to the text you read before the edit, keep the request out of the
  applied batch, log **`⚠ NEEDS YOU`** with what the tool printed, and
  reply once, with no sheet detail:

  ```bash
  npx gm-apprentice-publish inbox reply <id> rejected "I couldn't update your sheet this time. Nothing was changed, and the GM has been told."
  ```

  If the note itself cannot be written, so you cannot put it back either,
  say so in the `⚠ NEEDS YOU` line and still send the one reply.

- **A level-up needs the player's choices.** The new level and class, the
  hit points gained, and anything picked (a subclass, a feat, spells). What
  the class gives at that level comes from `ttrpg-expert`'s
  `systems/dnd-5e-2024/` references. A choice the request does not make is
  ambiguous: ask, don't guess. On a live-tracked PC the level-up raises
  `HP (Max)` in the note, and the player's saved current hit points stay
  where they were. Say so in the `applied` reply, so the level-up does not
  look half done:

  ```bash
  npx gm-apprentice-publish inbox reply <id> applied "✓ Mara is level 6: hit point maximum 38→45. Add the 7 new hit points on your sheet."
  ```

- **Summaries are your own words.** A new feature, spell or item row gets a
  one-line summary written by you. Never copy rules text into the note: it
  is published. That includes text the player pasted into the request. For
  anything outside the SRD, write the name and a page reference (leave the
  reference out if you do not know it), unless the GM has told you what it
  does.
- **`Recovers` cells.** Write `Long Rest`, `Short Rest` or
  `1 Short Rest, all Long Rest`, exactly: the sheet's rest buttons act on
  these three and nothing else. For any other recovery, say what happens in
  plain words (`Dawn`, `1d6+1 at dawn`); the page shows it and leaves it to
  the player.
