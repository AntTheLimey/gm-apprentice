---
name: mobrpg-sync
description: "Use when the GM wants to sync a gm-apprentice vault with a mobRPG world — pushing vault entities up as mobRPG suggestions, pulling ratified mobRPG canon back into the vault, or maintaining the vault↔mobRPG type mapping. Drives the mobrpg CLI with judgment and a preview-before-submit report, and keeps every write behind an explicit confirm. Trigger on 'sync to mobrpg', 'push my vault to mobrpg', 'pull canon from mobrpg', 'update my mobrpg mapping', 'send these NPCs to mobrpg', 'mobrpg suggestions', or any request to move campaign content between the vault and mobRPG — even a vague 'get this into mobrpg'."
---

mobRPG is Tim Dennis's shareable world-builder; the vault is the GM's working
surface. This skill keeps the two in sync by driving the `mobrpg` CLI — it is the
judgment layer, not a second copy of the CLI. It never calls the API directly:
it runs verbs, reads their output, and decides what to show you and what to ask.

Work from `docs/prototypes/mobrpg/` (the CLI lives there). Use the venv:
`.venv/bin/mobrpg …`. The agent-facing CLI guide is `../llms.txt` — read it if a
verb's behavior is unclear rather than guessing flags.

## On invocation: orient, then route

First, orient (all read-only — nothing here writes):
1. Find the vault (ask if not given). Confirm the CLI runs: `.venv/bin/mobrpg whoami`.
2. Note the target: the client prints `mobRPG target: PROD/DEV` to stderr. If PROD,
   remember that any write needs `MOBRPG_ALLOW_PROD_WRITES=1` — you never set it.

Then detect where the GM is and route. Honor an explicit ask ("push", "pull
canon", "fix my mapping") over the detected default.

| Read-only signal | Route to |
|---|---|
| no `<vault>/_meta/mobrpg-map.json`, or `mobrpg map check` shows `new`/unmapped vocab (map drift) | **Mapping maintenance** → `references/mapping-maintenance.md` |
| map clean; `mobrpg suggest --write-back` (dry-run) shows entities to push | **Push** → `references/push.md` |
| `mobrpg suggestions <world> --state Accepted\|Dismissed --correlate --vault <path>` (two queries — one per state) shows ratified suggestions awaiting pull-back | **Reconcile** → `references/reconcile.md` |
| a legacy crosswalk sidecar exists but entities lack `mobrpg:` `element_id` | **Backfill** → `references/backfill.md` |

Present what you found and the recommended phase; let the GM redirect.

## Safety — applies to every phase

These are short and needed every time, so they live here, not in a reference file.

- **Dry-run → present → confirm → execute.** Every mutating verb runs dry-run
  first. Show the result, get an explicit yes, only then re-run with `--execute`.
  Never chain straight to `--execute`.
- **Production writes need `MOBRPG_ALLOW_PROD_WRITES=1`.** If the target is PROD,
  say so, explain the opt-in, and let the GM set it or switch to `MOBRPG_ENV=dev`.
  Do not set it yourself.
- **State detection is read-only** (`map check`, `catalog`, `suggestions`, `pull`,
  and any `--write-back`/`--execute`-less run). Reading never needs confirmation.
- **Invariants from the foundation audit:** an accepted `element_id` is preserved
  across vault edits (fixed on this branch); run `pull-canon` after any re-`suggest`
  so relationship links heal and no duplicate suggestion window opens; treat the
  node `element_id` as the identity source of truth.
