# Change requests — GURPS 4e

Read this with `change-request-loop.md` when the campaign's `sheetFamily`
is `gurps`. It is step 2 of "When a batch arrives" for GURPS; everything
else (roster match, questions, the look, override and ambiguity rules, the
one deploy per batch, replies) is in `change-request-loop.md`. The running
value each request changes is the PC's unspent points.

Validate spends against GURPS costs using `ttrpg-expert`'s references
(`systems/gurps-4e/character-generation.md`, `character-sheet.md`,
`skills-*.md`, `traits-*.md`). Attributes: ST/HT 10/level, DX/IQ 20/level;
skills/traits per those references. Then:

- **Grants and narrative edits — always apply.** Adding XP to the character's
  own pool ("add 5 xp", "give me 3 points") or editing notes/current-status is
  trusted self-service: apply it, never flag it. An XP grant raises Unspent
  Points (and Total Points Earned). Collect into the applied batch; log a `✓`.
- **Affordable & unambiguous spend — apply.** Edit the `.md`, decrement running
  unspent points, collect into the applied batch; log a `✓`.
- **Player override — apply even if unaffordable.** When the request carries
  a trust signal (see the override rule in `change-request-loop.md`), apply
  the spend even when it's over budget. Edit the `.md` and
  decrement Unspent Points **allowing it to go negative** — write the negative
  value into the Points Summary / Identity "Unspent Points" field so the
  deficit shows honestly on the sheet. Collect into the applied batch. Log a
  prominent **`⚠ OVERRIDE`** terminal line (character · what changed · resulting
  unspent) so you always see what was pushed through on the player's word.
  Its confirmation, once deployed, names the override and the resulting deficit:

  ```bash
  npx gm-apprentice-publish inbox reply <id> applied "✓ Six → DX 13→14 — GM override applied; Unspent now −5 (reconcile when you can)."
  ```

- **Unaffordable with no override — refuse politely.** Apply nothing; finalize
  with the point-math explanation so the player knows exactly how short they
  are and can re-send with an override:

  ```bash
  npx gm-apprentice-publish inbox reply <id> rejected "Ronin → Sex Appeal +2 (11→13). Costs 6; he has 5. One short — nothing applied. Send it again with \"GM said OK\" to override."
  ```

  Then log a `⚠` line (character · what was asked · "can't afford — nothing applied").

A GURPS sheet carries an Identity block with Point Total / Unspent Points /
Total Points Earned, plus Attributes, Skills, and an equipment list. A
request is already applied when the attribute is already at the target
level and the unspent points already reflect the cost.
