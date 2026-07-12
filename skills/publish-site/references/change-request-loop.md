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
   watcher is a plain shell loop that polls the queue every ~60s and **sleeps
   while it is empty — spending no model tokens**. It exits (waking you) only
   when a request arrives.

   ```bash
   while :; do
     out=$(npx gm-apprentice-publish inbox pull 2>/dev/null)
     if [ -n "$out" ] && [ "$out" != "[]" ]; then printf '%s\n' "$out"; break; fi
     sleep 60
   done
   ```

   Run it as a **background command** (`run_in_background: true`). The harness
   re-invokes you when it exits — i.e. when the queue is non-empty — handing you
   the pending JSON. Idle time between requests therefore costs no model tokens;
   you only think when there is real work.

## When a batch arrives

The watcher exits and re-invokes you with a JSON array of pending entries
`{id, character, text, timestamp, status}` (re-run `npx gm-apprentice-publish
inbox pull` if you want the freshest state). Then:

1. Group by `character`; within each character sort by `timestamp` ascending.
2. For each character, walk their requests in order, tracking **running unspent
   points** (read the current value from the PC's `.md`):
   - **Interpret** the natural-language `text`.
   - **Validate** against GURPS costs using `ttrpg-expert`'s references
     (`systems/gurps-4e/character-generation.md`, `character-sheet.md`,
     `skills-*.md`, `traits-*.md`). Attributes: ST/HT 10/level, DX/IQ 20/level.
     Skills and traits: per those references.
   - **Classify:**
     - **Clean** (unambiguous AND affordable/valid): edit the PC's `.md` —
       raise the attribute/skill, add the equipment, grant/adjust XP, or edit
       the narrative field — and decrement running unspent points accordingly.
       Collect the entry `id` into `appliedIds`. Log a `✓` line.
     - **Edge case** (can't afford / over-budget / ambiguous skill or item):
       do **not** edit; collect into `flaggedIds`; log a `⚠` line with the
       reason. Never block the clean ones.
3. **If `appliedIds` is non-empty**, publish once for the whole batch:
   `npm run build` then `npx wrangler@4 pages deploy`.
   - **On deploy success:** `npx gm-apprentice-publish inbox handled <appliedIds…>`.
   - **On deploy failure:** do NOT mark handled — the entries stay `pending`
     (nothing marks them otherwise) and are pulled again on the next watcher
     cycle. Log the failure.
4. For each flagged id: `npx gm-apprentice-publish inbox flag <id>` and keep it
   in the terminal's visible "needs you" list.
5. **Relaunch the background watcher** (the same command as in Start step 4) so
   the next request wakes you. Idle resumes at zero model-token cost.

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
