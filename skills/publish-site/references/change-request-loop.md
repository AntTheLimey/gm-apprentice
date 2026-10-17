# Change-request loop — "start your checking loop"

A dedicated, unattended session that drains player sheet-edit requests during
live play. The GM opens a spare terminal in the site directory, says **"start
your checking loop"**, reads out the code, and does not touch it again. Between
requests the session sits idle at **no model-token cost** — a background watcher
does the waiting, and you only wake when a request actually arrives.

## Prerequisites

- First, bring the site's pinned tool up to date, from the site directory
  (`$TOOL` as in `SKILL.md`): `node "$TOOL" update-pin --site .`. A site
  still pinned to an older tool has no `inbox watch` and no `sheetFamily`.
- The inbox is set up (KV namespace + `wrangler.toml` id + deployed Function).
  See `references/cloudflare-pages.md` → "Change-request inbox".
- You know the campaign's switches and system. Ask the tool, from the site
  directory. Do not read the config files and work it out:

  ```bash
  npx gm-apprentice-publish explain --all --json | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["switches"], d.get("sheetFamily"))'
  ```

  It prints the three switches as the build resolves them, then the sheet
  family, e.g. `{'characterSheets': True, 'liveStats': False, 'inbox': True} coc`.
  - `inbox` is `False`: the site has no widget, so there is nothing to
    drain. Tell the GM (the `player_site.features.inbox` setting, or
    `setup-inbox`) and stop.
  - `characterSheets` is `False`: run the loop as a question channel. See
    "When character sheets are off" below.
  - The command fails: act as if character sheets are on, and tell the GM
    you could not check.
  - It fails or prints `None` for the family: read the system with
    `npx gm-apprentice-publish settings get vault.system` and map it:
    `gurps`/`gurps-4e` → `gurps`; `coc`/`coc-7e`/`regency-cthulhu`/
    `coc-7e-regency` → `coc`; `dnd`/`dnd-5e`/`dnd-5e-2024` → `dnd`;
    anything else → `None`.
- With character sheets on, read the one file for the sheet family, and only
  that one: `gurps` → `change-request-gurps.md` (GURPS 4e), `coc` →
  `change-request-coc.md` (CoC 7e, Regency Cthulhu included), `dnd` →
  `change-request-dnd.md` (D&D 5e 2024). It is step 2 below for that system.
  For `None` (any other system), stop and tell the GM sheet changes aren't
  supported yet. With character sheets off this gate does not apply: the
  loop is a question channel for every system, and no system file is read.

## Start

1. Pick a memorable 4-character code (letters, e.g. `WOLF`, `BEAR`, `MOTH`).
2. Set it live:  `npx gm-apprentice-publish inbox open WOLF`
   (or `node <tool>/bin/gm-publish.js inbox open WOLF`). A new code starts a
   new session, so the watcher forgets which requests it showed you before.
   Stop any watcher still running first: a monitor-mode watcher keeps its
   shown ids in memory and would write the old ones back.
3. Print it prominently for the GM to read to the table:
   `╔═══════════════╗  SESSION CODE: WOLF  ╚═══════════════╝`
4. Launch the **watcher** from `<site_dir>`, then leave the session idle.
   `inbox watch` polls the queue every 30s, writes the Unix time to
   `<site_dir>/.watcher-heartbeat` on every poll, and prints a batch only
   when it holds a request it has not shown you before (it remembers them in
   `.watcher-seen.json`, across relaunches). A request it showed you that is
   still pending 5 minutes later (`--remind-after N` seconds, 60 to 3600)
   prints `WATCHER: still pending: <id> <id>...`, and again every 5 minutes
   while it stays pending. After 5 failed polls in a row it prints
   `WATCHER: inbox pull failed N times in a row`, and again every 5 more.
   Every wrangler call is bounded at 60s, so a hung network turn is a failed
   poll, not a frozen loop.
   - **If the host offers a supervised or persistent monitor primitive** —
     something that runs a task for the whole session and notifies you per
     line of output, rather than only when the process exits — prefer it: a
     plain background shell can die without anyone noticing, and a dead
     watcher looks exactly like a quiet table. Run it once, for the rest of
     the session:

     ```bash
     npx gm-apprentice-publish inbox watch
     ```

   - **Otherwise, a background shell command** (`run_in_background: true`),
     which only notifies you when it exits. It exits 0 after a new batch or
     a reminder line, 1 after the first failure line and 2 on a usage error
     (fix the command), and is relaunched each time:

     ```bash
     npx gm-apprentice-publish inbox watch --exit-on-batch
     ```

   `--every N` sets another interval in seconds (kept between 1 and 300).
   What neither mode can self-report is dying outright (terminal closed,
   process killed); that's what `.watcher-heartbeat` is for — see Stop
   below. Idle time between requests costs no model tokens.

## When a batch arrives

The watcher hands you a JSON array of pending entries
`{id, character, text, timestamp, status}` (re-run `npx gm-apprentice-publish
inbox pull` if you want the freshest state). A batch holds every pending
entry, so ids you are already working on can appear in it beside the new
one. For each, in per-character
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
   player. Follow the system file named in Prerequisites for what a change
   costs and where it is written. These rules hold for every system:
   - **A look for their own sheet — apply, whatever the system.** A player's
     request for a different skin or frame on their own sheet ("give me the
     thorns frame") is set as `sheet_skin` / `sheet_frame` in that PC's
     frontmatter (ids in `sheet-skins.md`) and
     collected into the applied batch, which rebuilds the site; it needs no GM
     ruling unless the GM has said looks are theirs to choose.
   - **Player override, only where the system file allows one** (GURPS
     costs, CoC maxima; D&D has none, and its bounds always hold). A request
     carrying a trust signal — natural-language GM-approval or insistence
     such as "the GM said it's OK", "GM approved", "GM said to", "do it
     anyway", "override", "GM okayed it" — is applied past the limit that
     file names. Log a prominent **`⚠ OVERRIDE`** terminal line (character ·
     what changed · result) so you always see what was pushed through on
     the player's word.
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
   boundary: it already strips the sections `player_site.hide.sections` hides
   in the target PC's own note (`GM Notes` among them), and
   `<!-- gm-only -->`/`<!-- spoiler -->` regions —
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
   `npx gm-apprentice-publish build --site player --only sheets`, then
   `npx gm-apprentice-publish deploy --no-build`. If the build fails, do
   **not** deploy: log it and leave the ids `pending`. Run a full
   `npx gm-apprentice-publish build` once play ends, to refresh the party
   board, previews and search.
   - **If the deploy stops on the leak check:** do not reply; the ids stay
     `pending`. Tell the GM in one line that the sheet update is held by the
     leak check and how many findings it named; they are dealt with after
     play, or now if the GM asks (`references/leak-findings.md`). The
     watcher names those ids on a `still pending` line every 5 minutes;
     deploy and reply only once the GM has cleared the check.
   - **On deploy success:** finalize each applied id with its confirmation:

     ```bash
     npx gm-apprentice-publish inbox reply <id> applied "✓ Streetwise 2→3 — applied"
     ```

   - **On deploy failure:** do **not** reply — the entries stay `pending`
     (nothing else marks them). Log the failure. The watcher names them on
     a `still pending` line 5 minutes later: retry the deploy then, and
     reply once it succeeds.
5. **Get the watcher running again for the next request.** On the monitor
   primitive it is still running: nothing to do. With `--exit-on-batch`,
   relaunch the same command. Idle resumes at zero model-token cost either
   way. **On a `WATCHER: still pending` line**, those ids were shown before
   and never replied to: retry their deploy (a leak-held batch only once the
   GM has cleared the check) and reply, then step 5 again.

Once a request reaches a terminal outcome it returns exactly one response to
the chat log: `applied` (sheet redeployed), `rejected` (with the point-math
reason), or `advice`. A deploy failure leaves the applied items `pending`
until a retried deploy succeeds, unreplied for now. `reply` is the single
finalizer for every item — it supersedes the old `handled`/`flag` commands.

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

With `player_site.sheets.show` off (`switches.characterSheets` is `false`
in the Prerequisites check), the site carries no sheet and the widget is a
question channel labelled "Ask the GM". This holds for every system, not
only GURPS, CoC and D&D. The Start, watcher, failure and Stop sections apply
unchanged. "When a batch arrives" changes:

- **Every request is a question.** Step 0 (resolve the `character`) still
  applies. Skip step 1's classification, step 2 and the system file
  entirely, whatever the system.
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

## When the watcher reports failure

A `WATCHER: inbox pull failed N times in a row` line means the inbox itself
is in trouble (KV outage, bad credentials, a network blip), not "nothing to
do". Diagnose it before anything else:

1. Run `npx gm-apprentice-publish inbox pull` once by hand and read the
   actual error.
2. **Fixable now** (e.g. re-authenticate, stale `wrangler` credentials):
   fix it, confirm with one more manual pull. With `--exit-on-batch`,
   relaunch the watcher; the monitor primitive never exited and picks up on
   its next poll.
3. **Not fixable immediately** (e.g. a Cloudflare outage): tell the GM the
   change-request loop is degraded. With `--exit-on-batch`, relaunch it with
   `--every 120` so a still-broken inbox doesn't wake you every few
   minutes, and drop back to the default once a pull succeeds. The monitor
   primitive keeps running and repeats the line every 5 failures until the
   inbox recovers; the repeats are the same outage, not a new problem.

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
last poll, written every poll in both modes. Stale by more than two or three
intervals (60-90s at the default 30s; more if you set `--every`) means it
died silently. A fresh heartbeat proves only that it polls, not that a
request was handled: when a player says nothing happened, also run
`inbox pull` and compare its ids with the ones you have replied to. Then:

- **`--exit-on-batch`:** relaunch it (Start step 4) before assuming the
  queue is simply empty.
- **Monitor primitive:** there's nothing to relaunch on your end — a
  supervised task dying silently means the supervision itself failed, so ask
  the host whether the task is still running rather than starting a second
  poller on top of a primitive you can't directly restart.

On "stop", **flush live state to the vault, then terminate the background
watcher** and do not relaunch it:

1. Run `npx gm-apprentice-publish flush` (or `node <tool>/bin/gm-publish.js
   flush`). This snapshots each PC's current live vitals back into their vault
   `.md` (GURPS: current HP and FP into the `## Current Status` block; CoC:
   the Derived table, Reputation and Status; D&D: each live value into its
   own cell; `live-state-flush.md` has the detail), so the site's fallback
   seed stays fresh past
   KV's 30-day TTL. It edits the vault source only (no rebuild/deploy); the
   values ride into the site on the next build. Report its per-PC
   summary. Skill experience ticks are left untouched — those belong to
   Advancement, not the flush. A PC whose current status is authored as a
   YAML `status:` *object* in frontmatter (rather than the `## Current Status`
   body block) is skipped with a warning: the build reads vitals from that
   frontmatter and ignores the body, so a body write wouldn't take effect —
   author current status in the body block to let flush sync it.
2. Terminate the background watcher, then
   `rm -f <site_dir>/.watcher-heartbeat <site_dir>/.watcher-seen.json` —
   they're session-scoped scratch state, not something to leave behind in
   the GM's site repo between sessions.

The session code stays set in KV until the next "start your checking loop"
replaces it. `flush` is also safe to run ad hoc at any time — it is idempotent,
so re-running it when nothing changed is a harmless no-op.

## Editing the PC `.md`

Edit the vault file in place — it is the source of truth; the deploy reflects
it. Locate the running value and the relevant section by reading the file
(the system file says what its sheet carries). A crash between
editing a `.md` and the deploy leaves the entry `pending`, so the restarted
loop's watcher shows it again (its `inbox open` clears what was shown). Before applying
any request, first check whether its
change is already present in the `.md` (the system file says what that looks
like); if so, treat the apply as a no-op and
let it ride to the next deploy. A relative change (CoC "lost 4 SAN"; D&D
"took 9 damage" on a PC that is not live) can't be recognised that way. If
you applied its id earlier in this session, it's a no-op. If you have no record of it (the session restarted), ask the GM before
applying it again. This makes re-processing safe.
Copyright: this only writes the GM's own campaign data — no licensed text is
introduced.
