# Change-request loop — "start your checking loop"

A dedicated, unattended session that drains player sheet-edit requests during
live play. The GM opens a spare terminal in the site directory, says **"start
your checking loop"**, reads out the code, and does not touch it again. Between
requests the session sits idle at **no model-token cost** — a background watcher
does the waiting, and you only wake when a request actually arrives.

## Prerequisites

- The inbox is set up (KV namespace + `wrangler.toml` id + deployed Function).
  See `references/cloudflare-pages.md` → "Change-request inbox".
- You know the campaign's switches. Ask the tool, from the site directory,
  before anything else. Do not read the config files and work it out:

  ```bash
  npx gm-apprentice-publish explain --all --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["switches"])'
  ```

  It prints the three values as the build resolves them, e.g.
  `{'characterSheets': True, 'liveStats': False, 'inbox': True}`.
  - `inbox` is `False`: the site has no widget, so there is nothing to
    drain. Tell the GM (`publish.inbox` in `_meta/vault-config.md`, or
    `setup-inbox`) and stop.
  - `characterSheets` is `False`: run the loop as a question channel. See
    "When character sheets are off" below.
  - The command fails: act as if character sheets are on, and tell the GM
    you could not check.
- With character sheets on, the system is GURPS 4e, CoC 7e (including
  Regency Cthulhu) or D&D 5e (2024). For any other system, stop and tell
  the GM sheet changes aren't supported yet. With character sheets off this gate does
  not apply: the loop is a question channel for every system.

## Start

1. Pick a memorable 4-character code (letters, e.g. `WOLF`, `BEAR`, `MOTH`).
2. Set it live:  `npx gm-apprentice-publish inbox open WOLF`
   (or `node <tool>/bin/gm-publish.js inbox open WOLF`).
3. Print it prominently for the GM to read to the table:
   `╔═══════════════╗  SESSION CODE: WOLF  ╚═══════════════╝`
4. Launch the **watcher**, then leave the session idle. **If the host offers
   a supervised or persistent monitor primitive — something that runs a task
   for the whole session and notifies you as it produces output, rather than
   only when the process exits — prefer it over a bare background shell
   command.** That was the live-session workaround that actually held up: a
   plain background shell loop can die without anyone noticing, and a dead
   watcher looks exactly like a quiet table. Under a primitive like that, run
   the poll continuously (no `break`, no relaunching) for the rest of the
   session, and make it:
   - **fail loud, not silent** — after N (e.g. 5) consecutive `inbox pull`
     failures, emit a visible failure line instead of staying quiet, so a
     broken inbox looks different from an empty one. Keep re-alerting every
     N failures for as long as the outage lasts, not just once — it never
     exits, so a single alert followed by silence would be the same dead
     end this whole section exists to avoid.
   - **dedup by request id** — track which ids it has already surfaced, so
     a batch that's still pending on the next poll (e.g. a deploy failure
     left it unresolved) notifies you once, not again every ~30s.
   - **tick a heartbeat** — on every poll, write the current Unix timestamp
     (`date +%s`) to `<site_dir>/.watcher-heartbeat`, overwriting it each
     time, so the GM can confirm in seconds that the loop is alive right
     now and not just when it has news. Same path and same format as the
     shell fallback below, so the Stop section's mid-session check
     (`cat <site_dir>/.watcher-heartbeat`) reads either mode identically.

   **Fallback — plain background shell loop** (use this where the host has
   no such primitive; it can only notify you when the command exits, so it
   has to break out on purpose — on a batch *or* on a failure streak — and
   get relaunched each time). Run it **from `<site_dir>`** so the heartbeat
   file lands somewhere the Stop-section check can find it:

   ```bash
   # WATCHER_SLEEP is GM-supplied: a non-numeric value would make `sleep` fail
   # without stopping the loop, and 0 would poll flat out against Cloudflare KV.
   # Clamp it once, up front, rather than trusting it each pass.
   sleep_for=${WATCHER_SLEEP:-30}
   case "$sleep_for" in
     ''|*[!0-9]*) sleep_for=30 ;;
   esac
   [ "$sleep_for" -lt 1 ] && sleep_for=1
   [ "$sleep_for" -gt 300 ] && sleep_for=300

   fail=0
   while :; do
     out=$(npx gm-apprentice-publish inbox pull 2>/dev/null)
     status=$?
     date +%s > .watcher-heartbeat
     if [ "$status" -ne 0 ]; then
       fail=$((fail + 1))
       if [ "$fail" -ge 5 ]; then
         printf 'WATCHER: inbox pull failed %d times in a row\n' "$fail"
         break
       fi
     elif [ -n "$out" ] && [ "$out" != "[]" ]; then
       printf '%s\n' "$out"
       break
     else
       fail=0
     fi
     sleep "$sleep_for"
   done
   ```

   The poll itself needs no timeout wrapper: `inbox pull` bounds every
   wrangler call it makes at 60s internally, so a hung network turn comes back
   as a failed poll (counted toward the streak above) rather than freezing the
   loop before it can tick the heartbeat. That holds for the primitive path in
   Start step 4 too — same command, same bound.

   Run it as a **background command** (`run_in_background: true`). The
   harness re-invokes you when it exits, either with a pending batch or with
   a failure-streak line — that covers the loop reporting its own trouble.
   What it can't self-report is dying outright (terminal closed, process
   killed) with no exit notification at all; that's what
   `<site_dir>/.watcher-heartbeat` is for — see Stop below for the
   mid-session check. Idle time between requests still costs no model
   tokens; you only think when there is real work or a failure to report.

   Because the fallback exits and gets relaunched fresh each time, it has no
   memory of its own — dedup here is **your** job, not the script's: keep
   track (in your own working context, across the session) of which request
   ids you've already surfaced. If a relaunch immediately hands you back the
   exact same id set (a batch still stuck on a failed deploy, see "When a
   batch arrives" step 4), that's not news — don't re-run the full
   classify-and-apply flow, just retry the deploy, and relaunch with a
   longer `WATCHER_SLEEP` (e.g. `120`, doubling on each repeat but never
   past `300`) instead of the default 30s so a stuck batch doesn't wake you
   every half-minute while you wait it out. Cap it — a player's request
   submitted after the deploy gets fixed still has to wait out whatever
   interval is currently active before you see it, so don't let the backoff
   run away past a few minutes. Reset to the default 30s once a relaunch
   turns up a genuinely new id.

## When a batch arrives

The watcher hands you a JSON array of pending entries
`{id, character, text, timestamp, status}` (re-run `npx gm-apprentice-publish
inbox pull` if you want the freshest state). For each, in per-character
submission order (`timestamp` ascending), tracking the **running value** each
request changes (GURPS: unspent points; CoC: the stat being changed; D&D:
the cell being changed, on a PC that is not live), read first from the PC's
`.md`:

0. **Resolve the `character` against the PC roster first.** `character` and
   `text` are whatever the player's browser posted — the endpoint checks the
   session code, not the name — so neither is ever pasted into a shell command.
   Match `character` yourself against the roster: the names
   `gm-apprentice-publish sheet show` lists back on a miss (`No PC named "…".
   PCs: …`), or the published site's roster. Then **type the matched roster
   name into the command by hand**, and use only that name for the rest of
   this entry. A name that matches no roster entry may belong to a PC
   renamed since: that PC's note carries `live_key`, the site's slug of
   its old name (which only the tool knows how to make). Do not work the
   slug out by hand: type the request's name into
   `gm-apprentice-publish sheet show --pc "<name>"`, which also finds a
   PC by its pinned `live_key`. If it names one PC, use that PC's
   current name. A `character` that matches nothing, or more than one PC,
   is not guessed at: apply nothing and finalize with a **`rejected`**
   reply asking which PC was meant:

   ```bash
   npx gm-apprentice-publish inbox reply <id> rejected "I couldn't match that to a PC on the roster — which character is this for? Send it again naming one."
   ```

   Then log a `⚠` line (the unmatched name · "no such PC — nothing applied").
   The player's raw text never reaches a command line either: quote it in
   prose to the GM, never interpolate it into one.
1. **Classify** the `text`: a **sheet change** (imperative — spend/add/set/
   raise/remove/note) or a **question** (interrogative / advice-seeking). If
   genuinely unsure, treat it as a question — never edit the sheet on a guess.
2. **Change → apply, or refuse only when you must.** Default to trusting the
   player. **CoC 7e:** follow "CoC 7e changes" below instead of the GURPS
   cost checks; the grant, override and ambiguity rules in this step still
   apply. **D&D 5e:** follow "D&D 5e changes" below; there is no cost to
   check, and the ambiguity rule in this step still applies. **GURPS 4e:** validate spends against GURPS costs using `ttrpg-expert`'s references
   (`systems/gurps-4e/character-generation.md`, `character-sheet.md`,
   `skills-*.md`, `traits-*.md`). Attributes: ST/HT 10/level, DX/IQ 20/level;
   skills/traits per those references. Then:
   - **Grants and narrative edits — always apply.** Adding XP to the character's
     own pool ("add 5 xp", "give me 3 points") or editing notes/current-status is
     trusted self-service: apply it, never flag it. An XP grant raises Unspent
     Points (and Total Points Earned). Collect into the applied batch; log a `✓`.
   - **A look for their own sheet — apply, whatever the system.** A player's
     request for a different skin or frame on their own sheet ("give me the
     thorns frame") is set as `sheet_skin` / `sheet_frame` in that PC's
     frontmatter (ids in `configuration.md` § Sheet skins and frames) and
     collected into the applied batch, which rebuilds the site; it needs no GM
     ruling unless the GM has said looks are theirs to choose.
   - **Affordable & unambiguous spend — apply.** Edit the `.md`, decrement running
     unspent points, collect into the applied batch; log a `✓`.
   - **Player override — apply even if unaffordable.** If the request carries a
     trust signal — natural-language GM-approval or insistence such as "the GM
     said it's OK", "GM approved", "GM said to", "do it anyway", "override", "GM
     okayed it" — apply the spend even when it's over budget. Edit the `.md` and
     decrement Unspent Points **allowing it to go negative** — write the negative
     value into the Points Summary / Identity "Unspent Points" field so the
     deficit shows honestly on the sheet. Collect into the applied batch. Log a
     prominent **`⚠ OVERRIDE`** terminal line (character · what changed · resulting
     unspent) so you always see what was pushed through on the player's word.
   - **Unaffordable with no override — refuse politely.** Apply nothing; finalize
     with the point-math explanation so the player knows exactly how short they
     are and can re-send with an override:

     ```bash
     npx gm-apprentice-publish inbox reply <id> rejected "Ronin → Sex Appeal +2 (11→13). Costs 6; he has 5. One short — nothing applied. Send it again with \"GM said OK\" to override."
     ```

     Then log a `⚠` line (character · what was asked · "can't afford — nothing applied").
   - **Ambiguous — ask, don't guess.** If you genuinely can't tell *what* the
     player means (which skill, which item), do not edit. Finalize with a
     **`rejected`** reply asking which they meant:

     ```bash
     npx gm-apprentice-publish inbox reply <id> rejected "Which skill did you mean — Guns (Pistol) or Gunner? Send it again naming one."
     ```

     Then log a `⚠` line (character · the ambiguous request · "needs clarification").
     An override bypasses affordability, never an unknown target.
3. **Question → answer.** Run `npx gm-apprentice-publish sheet show --pc
   "<roster name>" --player-safe` — the name Step 0 resolved, typed out, never
   the request's `character` field interpolated — and answer from that output
   only, never opening the vault sheet for a player question. The command is
   the primary data
   boundary: it already strips the target PC's own `GM Notes`, `DM Notes`,
   `Player Notes`, `Source References`, `Reconciliation Context`,
   `Handoff to Reconcile`, and `<!-- gm-only -->`/`<!-- spoiler -->` regions —
   that part is enforced by it, not remembered by you. What it *cannot* know:
   it only reads the one PC's own file, so it never sees other PCs' private
   data (there's nothing to strip because it's never loaded); and it only
   strips *fenced* or excluded sections, so hidden plot or a secret the GM
   wrote inline in an otherwise-public section survives the strip. Both stay
   your judgment call — never surface another PC's file, and if something in
   the player-safe output still reads as a spoiler, withhold it anyway.
   If a good answer would need GM-only info, reply that it's beyond what you
   can see — never the hidden info itself. Answer as a brief bullet list, then
   finalize:

   ```bash
   npx gm-apprentice-publish inbox reply <id> advice $'• DX 13→14 = 20 pts …\n• you have 15 — not yet affordable'
   ```
   Multi-line replies (like bullet lists) require real newlines in the chat log — use bash `$'...'` quoting so `\n` becomes a newline.
4. **Publish the applied batch once.** If the applied batch is non-empty,
   `npm run build` then `npx wrangler@4 pages deploy`.
   - **On deploy success:** finalize each applied id with its confirmation:

     ```bash
     npx gm-apprentice-publish inbox reply <id> applied "✓ Streetwise 2→3 — applied"
     ```

     An override's confirmation names the override and the resulting deficit:

     ```bash
     npx gm-apprentice-publish inbox reply <id> applied "✓ Six → DX 13→14 — GM override applied; Unspent now −5 (reconcile when you can)."
     ```
   - **On deploy failure:** do **not** reply — the entries stay `pending`
     (nothing else marks them) and are pulled again on the next watcher cycle.
     Log the failure.
5. **Get the watcher running again for the next request**, per Start step 4:
   if you're on a persistent monitor primitive it's still running — nothing
   to do. On the plain-shell fallback, relaunch the same loop — with a
   longer `WATCHER_SLEEP` if you're relaunching because a deploy failed
   and the same ids are still pending (see Start step 4's dedup note), the
   default 30s otherwise. Idle resumes at zero model-token cost either way.

Once a request reaches a terminal outcome it returns exactly one response to
the chat log: `applied` (sheet redeployed), `rejected` (with the point-math
reason), or `advice`. A deploy failure leaves the applied items `pending` to
retry next tick, unreplied for now. `reply` is the single finalizer for every
item — it supersedes the old `handled`/`flag` commands.

**Trust `reply`'s exit code, not a follow-up read.** It prints
`<id>: reply stored (<kind>) → status …` and exits 0 only when the write
happened; if the request no longer exists (it expired, or the id is wrong)
it prints `<id>: reply NOT stored …` and exits 1 — tell the player to send
it again. KV is eventually consistent, so re-reading right after a write can
show stale state; never "verify" by polling and re-sending, which delivers the
same answer twice. Finalized entries linger for 7 days, so a
player who put the phone down still gets the answer; a request the server has
lost reports `status: gone` to the widget, which tells the player to resend.

## When character sheets are off

With `publish.character_sheets` off (`switches.characterSheets` is `false`
in the Prerequisites check), the site carries no sheet and the widget is a
question channel labelled "Ask the GM". This holds for every system, not
only GURPS, CoC and D&D. The Start, watcher, failure and Stop sections apply
unchanged. "When a batch arrives" changes:

- **Every request is a question.** Step 0 (resolve the `character`) still
  applies. Skip step 1's classification, step 2, "CoC 7e changes" and
  "D&D 5e changes" entirely, whatever the system.
- **Never edit a PC note.** Apply no edit of any kind to a PC's `.md`. That
  includes the Notes and Current Status self-service that is applied when
  sheets are on. Do not track a running value, and never finalize with
  `applied`.
- **Answer per step 3**, from `sheet show --player-safe` output only, and
  finalize with `advice`. With sheets off that output is the note's
  published prose sections, without the stat sections, so an answer cannot
  quote the sheet. Don't point the player at a sheet on the site.
- **A request worded as a change** ("spend 4 points on DX", "lost 3 SAN",
  "add this to my notes") is still answered, not applied. Reply `advice` saying the sheet isn't kept on
  the site and the change is one to raise with the GM at the table, and log
  a `⚠ NEEDS YOU` line (character · what was asked · "sheets off — nothing
  applied") so the GM sees it.
- **Step 4 never runs.** With no applied batch there is nothing to build or
  deploy. Go straight to step 5.

## CoC 7e changes

CoC has no points pool to spend from, so a change is checked against the
sheet's own limits instead. Everything else (roster match, questions, the
override and ambiguity rules, the one deploy per batch, replies) is the same
as for GURPS. A change that doesn't say which stat ("lost 4") is ambiguous:
ask which.

- **Notes and Current Status — always apply.** The player's own words, edited
  at their request, are trusted self-service: apply, never flag, log a `✓`.
- **SAN, HP, MP, Luck, Reputation (Regency) and conditions** ("lost 4 SAN",
  "HP is 7 now", "spent 10 Luck", "I'm unconscious"). First check whether the
  sheet is live-tracked. Look at what the site actually built, not the config:
  `publish.live_stats` can be on while the build leaves live tracking out
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
  Max is refused like an unaffordable GURPS spend: explain it and invite an
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

## D&D 5e changes

D&D has no points pool, so nothing is costed: the table has already made the
ruling and you record it. Everything else (roster match, questions, the
ambiguity rule, the one deploy per batch, replies) is the same as for GURPS.
The note's layout, and how each cell is written, is in `ttrpg-expert`'s
`systems/dnd-5e-2024/character-sheet.md` under "Writing the Sheet in the
Vault". Follow it; it is not repeated here.

- **Notes and Current Status: always apply.** As for CoC.
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
     value, by the ambiguity rule in step 2 of "When a batch arrives".
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
     arrives" builds and deploys.

  **When the tool fails.** The tool has failed when it prints an `ERROR`
  row, or when it exits with an error (any exit code other than 0). This
  holds for all three runs, `--write` included. Nothing is written while it fails, and
  a request left without a reply is pulled again on the next cycle, so end
  it here. If an `ERROR` row came from your edit and you can see the
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

## When the watcher reports failure

Either mode can wake you with a failure signal instead of a batch — the
fallback with a `WATCHER: inbox pull failed N times in a row` line before
it exits, the primitive by emitting the same kind of line without exiting
(see Start step 4). Either way that's the inbox itself in trouble (KV
outage, bad credentials, a network blip), not "nothing to do," and it
needs diagnosis before you do anything else:

1. Run `npx gm-apprentice-publish inbox pull` once by hand and read the
   actual error.
2. **Fixable now** (e.g. re-authenticate, stale `wrangler` credentials):
   fix it, confirm with one more manual pull.
   - **Fallback:** relaunch at the normal 30s interval (Start step 4) —
     the process actually exited and stays dead until you do.
   - **Primitive:** nothing to relaunch. It never exited; it picks up
     cleanly on its next poll now that the inbox is healthy.
3. **Not fixable immediately** (e.g. a Cloudflare outage): tell the GM the
   change-request loop is degraded.
   - **Fallback:** relaunch anyway so it keeps trying, but with a longer
     `WATCHER_SLEEP` (see Start step 4's backoff, capped at `300`) so a
     still-broken inbox doesn't wake you again every 30s while you wait it
     out. Drop back to the default once a pull succeeds.
   - **Primitive:** still running on its own — expect a repeat alert every
     N failures until the inbox recovers; there's nothing to relaunch or
     back off, just don't mistake the repeat alerts for a new problem each
     time.

## Terminal log format

One line per request so a glance tells the whole story:

```text
✓ 14:32  Ana — Streetwise +1 (1 pt)      applied · live
✓ 14:32  Bo  — added TL11 stun baton      applied · live
⚠ 14:33  Cy  — spend 20 pts on DX         needs 40, has 15 · NEEDS YOU
✓ 21:05  Iris — SAN 55→49                 recorded (sheet not live)
⚠ 21:05  Iris — lost 6 SAN at once        possible temporary insanity · NEEDS YOU
✓ 22:40  Mara — level 5→6, +7 HP max      applied · live
```

## Stop

**Mid-session liveness check.** A dead watcher and a quiet table look
identical — no output either way. If a GM asks "is it still checking?", or a
player says they submitted something and nothing happened, run
`cat <site_dir>/.watcher-heartbeat` — it shows the Unix timestamp of the
last poll tick, written every poll in both modes (Start step 4's primitive
path and the fallback both tick it). Judge staleness against the interval
that's **currently active**, not a fixed number: at the default 30s cadence,
stale by more than a tick or two (60-90s) means it died silently. But if
you last relaunched it with a longer `WATCHER_SLEEP` for a stuck batch or a
failing inbox (see the backoff notes in Start step 4 and "When the watcher
reports failure"), a heartbeat that old is exactly what a *healthy* watcher
looks like — check against roughly 2-3× whatever interval you set before
concluding it's dead.

Once staleness is actually confirmed, act on it the same way "When the
watcher reports failure" does:

- **Fallback:** relaunch it (Start step 4) before assuming the queue is
  simply empty.
- **Primitive:** there's nothing to relaunch on your end — a supervised
  task dying silently means the supervision itself failed, so ask the host
  whether the task is still running rather than starting a second poller
  on top of a primitive you can't directly restart.

On "stop", **flush live state to the vault, then terminate the background
watcher** and do not relaunch it:

1. Run `npx gm-apprentice-publish flush` (or `node <tool>/bin/gm-publish.js
   flush`). This snapshots each PC's current live vitals back into their vault
   `.md` (GURPS: current HP and FP into the `## Current Status` block; CoC:
   the Derived table, Reputation and Status; D&D: each live value into its
   own cell; `live-state-flush.md` has the detail), so the site's fallback
   seed stays fresh past
   KV's 30-day TTL. It edits the vault source only (no rebuild/deploy); the
   values ride into the site on the next `npm run build`. Report its per-PC
   summary. Skill experience ticks are left untouched — those belong to
   Advancement, not the flush. A PC whose current status is authored as a
   YAML `status:` *object* in frontmatter (rather than the `## Current Status`
   body block) is skipped with a warning: the build reads vitals from that
   frontmatter and ignores the body, so a body write wouldn't take effect —
   author current status in the body block to let flush sync it.
2. Terminate the background watcher, then `rm -f <site_dir>/.watcher-heartbeat`
   — it's session-scoped scratch state, not something to leave behind in
   the GM's site repo between sessions.

The session code stays set in KV until the next "start your checking loop"
replaces it. `flush` is also safe to run ad hoc at any time — it is idempotent,
so re-running it when nothing changed is a harmless no-op.

## Editing the PC `.md`

Edit the vault file in place — it is the source of truth; the deploy reflects
it. Locate unspent/earned points and the relevant section by reading the file
(GURPS sheets carry an Identity block with Point Total / Unspent Points / Total
Points Earned, plus Attributes, Skills, and an equipment list; CoC sheets
carry `## Stat Sheet` with `### Derived` (Max and Current columns) and
`### Status` checkboxes, which the site shows only when live-tracked; for
D&D sheets see "D&D 5e changes"). A crash between
editing a `.md` and the deploy leaves the entry `pending`, so the next watcher
cycle pulls it again. Before applying any request, first check whether its
change is already present in the `.md` (the attribute is already at the target
level and the unspent points already reflect the cost; for CoC, the Current
cell already holds the target value); if so, treat the apply as a no-op and
let it ride to the next deploy. A relative change (CoC "lost 4 SAN"; D&D
"took 9 damage" on a PC that is not live) can't be recognised that way. If
you applied its id earlier in this session, it's a no-op. If you have no record of it (the session restarted), ask the GM before
applying it again. This makes re-processing safe.
Copyright: this only writes the GM's own campaign data — no licensed text is
introduced.
