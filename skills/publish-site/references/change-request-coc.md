# Change requests — CoC 7e (and Regency Cthulhu)

Read this with `change-request-loop.md` when the campaign's `sheetFamily`
is `coc`. It is step 2 of "When a batch arrives" for CoC.

CoC has no points pool to spend from, so a change is checked against the
sheet's own limits instead. Everything else (roster match, questions, the
override and ambiguity rules, the one deploy per batch, replies) is in
`change-request-loop.md`. A change that doesn't say which stat ("lost 4") is
ambiguous: ask which.

- **Notes and Current Status — always apply.** The player's own words, edited
  at their request, are trusted self-service: apply, never flag, log a `✓`.
- **SAN, HP, MP, Luck, Reputation (Regency) and conditions** ("lost 4 SAN",
  "HP is 7 now", "spent 10 Luck", "I'm unconscious"). First check whether the
  sheet is live-tracked. Look at what the site actually built, not the config:
  `player_site.features.live_stats` can be on while the build leaves live tracking out
  (no KV store wired in `wrangler.toml`). The PC's built page in the site's
  output folder contains `id="coc-live-data"` when it is live.
  - **Live-tracked:** these values, and the skill improvement ticks, live on
    the player's sheet and save the moment they tap them. The live value wins
    over the vault, so an edit here would be silently ignored. Apply nothing
    and finalize with **`advice`**:

    ```bash
    npx gm-apprentice-publish inbox reply <id> advice "That's live on your sheet: tap the status bar or the skill tick and it saves straight away."
    ```

  - **Not live-tracked:** the published sheet doesn't show these values at
    all, so there is nothing to deploy. Record the change in the vault for
    the GM: the `### Derived` table's **Current** column, the `### Status`
    checklist for a condition, or the `Current Reputation` row of
    `### Reputation`. Finalize with **`advice`**, not `applied`: an
    `applied` reply reloads the player's page and says the change is live,
    which it isn't. Keep it out of the applied batch, so it never triggers
    a rebuild on its own:

    ```bash
    npx gm-apprentice-publish inbox reply <id> advice "✓ SAN 55→51 — recorded for your Keeper (this site doesn't show SAN)."
    ```

  In both cases, accept a change ("lost 4") or a new value ("SAN is 42"); for
  a change, work from the running value. Keep the result between 0 and the
  row's **Max** (Luck has no Max column; its ceiling is 99). A result above
  Max is refused with a `rejected` reply that explains it and invites an
  override. A player override applies it and logs **`⚠ OVERRIDE`**. A result
  below 0 is set to 0. A Luck spend larger than the current Luck is refused;
  there is nothing to override, because Luck can't go below 0. The table has
  already made the ruling, so don't re-litigate it: you only record the
  number.
- **Thresholds are the Keeper's call, not yours.** Record the number, but
  never tick a condition the player didn't ask for, and log **`⚠ NEEDS YOU`**
  when a change crosses one: HP reaching 0, a single HP loss of half the Max
  or more (a Major Wound), SAN reaching 0, 5+ SAN lost at once (possible
  temporary insanity), or a fifth of the session's starting SAN lost across
  the session (possible indefinite insanity).
- **Improvement checks** ("tick Spot Hidden"). On a live-tracked sheet they
  are one of the ticks the player taps: reply with the same `advice`.
  Otherwise nothing stores them (the sheet's tick is a local toggle and the
  vault has no column for it). Apply nothing and reply **`advice`**: note it
  on paper for the end-of-session improvement rolls.
- **Skill, characteristic or occupation-point changes** ("raise Library Use to
  60"). The loop doesn't handle these: skill increases come from the
  end-of-session improvement rolls, which the GM runs. Apply nothing,
  finalize with **`rejected`** saying so, and log a `⚠` line.

A CoC sheet carries `## Stat Sheet` with `### Derived` (Max and Current
columns) and `### Status` checkboxes, which the site shows only when
live-tracked. A request is already applied when the Current cell already
holds the target value.
