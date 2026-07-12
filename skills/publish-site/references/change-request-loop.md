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
4. Launch the **background watcher** (below), then leave the session idle. The
   watcher is a plain shell loop that polls the queue every ~30s and **sleeps
   while it is empty — spending no model tokens**. It exits (waking you) only
   when a request arrives.

   ```bash
   while :; do
     out=$(npx gm-apprentice-publish inbox pull 2>/dev/null)
     if [ -n "$out" ] && [ "$out" != "[]" ]; then printf '%s\n' "$out"; break; fi
     sleep 30
   done
   ```

   Run it as a **background command** (`run_in_background: true`). The harness
   re-invokes you when it exits — i.e. when the queue is non-empty — handing you
   the pending JSON. Idle time between requests therefore costs no model tokens;
   you only think when there is real work.

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
   - **Ambiguous — ask, don't guess.** If you genuinely can't tell *what* the
     player means (which skill, which item), do not edit — reply asking which they
     meant. An override bypasses affordability, never an unknown target.
3. **Question → answer** using **player-safe scope only** — the published
   sheet/site + GURPS rules + the character's own non-GM sections. NEVER use
   `GM Notes`, `DM Notes`, `Player Notes`, `Source References`,
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
5. **Relaunch the background watcher** (the same command as in Start step 4) so
   the next request wakes you. Idle resumes at zero model-token cost.

Once a request reaches a terminal outcome it returns exactly one response to
the chat log: `applied` (sheet redeployed), `rejected` (with the point-math
reason), or `advice`. A deploy failure leaves the applied items `pending` to
retry next tick, unreplied for now. `reply` is the single finalizer for every
item — it supersedes the old `handled`/`flag` commands.

## Terminal log format

One line per request so a glance tells the whole story:

```text
✓ 14:32  Ana — Streetwise +1 (1 pt)      applied · live
✓ 14:32  Bo  — added TL11 stun baton      applied · live
⚠ 14:33  Cy  — spend 20 pts on DX         needs 40, has 15 · NEEDS YOU
```

## Stop

On "stop", **terminate the background watcher** (stop the running background
command) and do not relaunch it. The session code stays set in KV until the
next "start your checking loop" replaces it.

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
