# Pull live state into the vault ("flush")

`gm-apprentice-publish flush` snapshots each PC's current **live vitals** from
the site's KV store back into their vault `.md`, so the build-time fallback seed
stays fresh past KV's 30-day TTL and the GM sees where players left off. It edits
vault source only — no rebuild, no deploy — and is idempotent, so re-running it
when nothing changed is a harmless no-op.

- **GURPS 4e:** current HP and FP, written into the PC's `## Current Status`
  block (`**HP:** N/M` / `**FP:** N/M`). An existing line is updated in place; a
  missing line is added, with max derived from the sheet's attributes.
- **CoC 7e:** HP/MP/SAN/Luck, current Reputation, and the five Status conditions,
  written into the Derived table, Reputation, and Status sections.

Loadout (carried items) and hero points are not synced.

## When to run it

- **Tier-2b (inbox loop):** the change-request loop already runs flush on **stop**
  — see `change-request-loop.md`. Nothing extra to do.
- **Tier-2a (status bar, no inbox loop):** there is no unattended process, so run
  it yourself — session-wrapup does this automatically (below), or run it ad hoc.

## How to run it

From the **site directory** (the one holding `vault.config.json` and
`wrangler.toml`):

    npx gm-apprentice-publish flush

(or `node <tool>/bin/gm-publish.js flush`). It prints a per-PC summary
(`✓ Karl Brenner — HP 12→7, FP 11→9`). Report that summary to the GM.

## When it does nothing

- The campaign has no published Tier-2 site (no KV) → there is nothing to pull;
  skip silently.
- A GURPS sheet has no Attributes block → flush can update an existing HP/FP line
  but cannot seed a missing one (no max to write), so it leaves that vital alone;
  if nothing else changed the PC just shows `· no change`.
- No players have saved live state yet → flush reports "no live state to flush".

Copyright: flush writes only the GM's own campaign data — no licensed text.
