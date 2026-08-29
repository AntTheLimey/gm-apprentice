# Change-request loop — "start your checking loop"

A dedicated, unattended session that drains player sheet-edit requests during
live play. The GM opens a spare terminal in the site directory, says **"start
your checking loop"**, reads out the code, and does not touch it again. Between
requests the session sits idle at **no model-token cost** — a background watcher
does the waiting, and you only wake when a request actually arrives.

## Prerequisites

- The inbox is set up (KV namespace + `wrangler.toml` id + deployed Function).
  See `references/cloudflare-pages.md` → "Change-request inbox".
- The system is GURPS 4e (v1). For other systems, stop and tell the GM this
  isn't supported yet.

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
submission order (`timestamp` ascending), tracking **running unspent points**
(read the current value from the PC's `.md`):

1. **Classify** the `text`: a **sheet change** (imperative — spend/add/set/
   raise/remove/note) or a **question** (interrogative / advice-seeking). If
   genuinely unsure, treat it as a question — never edit the sheet on a guess.
2. **Change → apply, or refuse only when you must.** Default to trusting the
   player. Validate spends against GURPS costs using `ttrpg-expert`'s references
   (`systems/gurps-4e/character-generation.md`, `character-sheet.md`,
   `skills-*.md`, `traits-*.md`). Attributes: ST/HT 10/level, DX/IQ 20/level;
   skills/traits per those references. Then:
   - **Grants and narrative edits — always apply.** Adding XP to the character's
     own pool ("add 5 xp", "give me 3 points") or editing notes/current-status is
     trusted self-service: apply it, never flag it. An XP grant raises Unspent
     Points (and Total Points Earned). Collect into the applied batch; log a `✓`.
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
3. **Question → answer** using **player-safe scope only** — the published
   sheet/site + GURPS rules + the character's own non-GM sections. NEVER use
   `GM Notes`, `DM Notes`, `Player Notes`, `Source References`,
   `Reconciliation Context`, `Handoff to Reconcile`,
   `<!-- gm-only -->` regions, other PCs' private data, or hidden plot/secret.
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
   `.md` (for GURPS: current HP and FP into the `## Current Status` block; the
   writeback is system-aware), so the site's fallback seed stays fresh past
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
Points Earned, plus Attributes, Skills, and an equipment list). A crash between
editing a `.md` and the deploy leaves the entry `pending`, so the next watcher
cycle pulls it again. Before applying any request, first check whether its
change is already present in the `.md` (the attribute is already at the target
level and the unspent points already reflect the cost); if so, treat the apply
as a no-op and let it ride to the next deploy. This makes re-processing safe.
Copyright: this only writes the GM's own campaign data — no licensed text is
introduced.
