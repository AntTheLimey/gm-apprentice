# Backfill — legacy crosswalk sidecar → `mobrpg:` nodes (one-time)

Entered when a vault has a legacy `*-crosswalk.json` sidecar but its entities
don't yet carry a `mobrpg:` `element_id`. Older vaults recorded vault↔mobRPG
links in that sidecar; the `mobrpg:` node `element_id` is now the single
source of truth. This is a **one-time migration**, not a phase the GM cycles
through repeatedly — once the nodes carry `element_id` and the sidecar is
retired, this vault never routes here again. Every write here is a
`.venv/bin/mobrpg backfill ...` invocation — never `python -m mobrpg`.

## Canticle-specific

`backfill` exists because Canticle is the only vault that ever had a
crosswalk sidecar (IDs were kept out of frontmatter before `mobrpg:` nodes
existed). If you're running this for a different campaign, that's a signal
to stop and check with the GM first — there's likely no sidecar to migrate,
and this phase probably doesn't apply.

## `--crosswalk` is required — unlike `suggest`

```
mobrpg backfill --vault VAULT --crosswalk CROSSWALK [--namespace NAMESPACE] [--execute] <world>
```

- `--vault` and the `<world>` positional are required, as everywhere else.
- **`--crosswalk` is required here** — there is no packaged default. Contrast
  with `suggest`, which falls back to a packaged Canticle crosswalk when
  `--crosswalk` is omitted (see `push.md`). `backfill` has no such fallback:
  the GM must supply the sidecar path explicitly.
- `--namespace` defaults to `"canticle"`, matching the Canticle-only scope
  above. Only override it if the GM is migrating a differently-namespaced
  sidecar.

## Flow

1. **Dry-run** (no `--execute` — this is the default):

   ```
   .venv/bin/mobrpg backfill --vault <path> --crosswalk <sidecar.json> <world>
   ```

   The CLI prints `N node(s) to write; M unresolved`, lists each unresolved
   entity or relationship (e.g. `entity not in vault: <name>` when the
   sidecar references something the vault folders don't contain), then
   `[dry-run — no files changed]`.

2. **Present the dry-run result to the GM** before writing anything: how many
   nodes would be created, and every unresolved item by name. Unresolved
   entries mean the sidecar and the vault have drifted — the GM may need to
   fix a name mismatch or accept that entity won't migrate.

3. **On an explicit yes, re-run with `--execute`:**

   ```
   .venv/bin/mobrpg backfill --vault <path> --crosswalk <sidecar.json> --execute <world>
   ```

   This writes a `mobrpg:` node into each resolved entity's file, carrying
   the migrated `element_id` with `review_state: "accepted"`. The CLI prints
   `✓ written` in place of the dry-run line. `backfill` makes no API calls —
   it only touches local vault files, so the PROD write guard
   (`MOBRPG_ALLOW_PROD_WRITES=1`) does not gate it. It's still a vault
   mutation, though, so the same dry-run → present → confirm → `--execute`
   sequence applies; don't skip the confirm step just because the guard
   doesn't fire.

4. **Confirm the migration landed**, then help the GM retire the sidecar.
   Spot-check that the entities reported as written now carry `mobrpg:`
   `element_id` in their frontmatter. Once confirmed, the sidecar is
   redundant — recommend deleting or archiving the `*-crosswalk.json` file
   (outside the vault, e.g. move it to a `deprecated/` location the GM
   controls) so there is one source of truth for vault↔mobRPG links, not two
   that can silently disagree as either side changes.

There is no `--crosswalk` flag on `pull-canon` — don't reach for `backfill`
as a substitute for ongoing reconcile. `backfill` is the one-time sidecar
migration; `pull-canon` (see `reconcile.md`) is the recurring canon pull once
nodes carry `element_id`.
