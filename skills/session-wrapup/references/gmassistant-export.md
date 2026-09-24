# gmassistant.app Export Path

Read when the Play Notes contain a `## Memorable Moments` heading:
they are a gmassistant.app export with pre-written narrative
(`## Summary`), entity sections (`## NPCs`, `## Locations`,
`## Items`) and a scene breakdown (`## Scenes`). These rules
replace the matching parts of Steps 2 and 4; everything else in
the workflow still applies.

## Step 2 — Recap

Adopt `## Summary` verbatim as the Wrap-Up's `## Narrative Recap`:
no rewriting, condensing or tone adjustment (the preserve-guard in
`shared/content-fidelity.md`). Only add `[[wiki-links]]` to every
entity reference. Skip Quick Bullets — `## Scenes` already covers
them. Memorable Moments stays optional as usual.

## Step 4 — Entities

- Build entities from the export's `## NPCs`, `## Locations` and
  `## Items` entries (each has a name and description) instead of
  extracting from raw notes; there are no `NEW-NPC:`/`UPDATE:`
  markers. Compare each entry against the vault to decide new vs.
  update.
- An export description that conflicts with existing vault content
  → flag the entity CONFLICT for GM review.
- Record every export-vs-vault name correction made anywhere in
  the wrap-up in the Wrap-Up's `### Name Conflicts (export vs.
  vault canon)` table (Export said | Vault canon | Applied). The
  standard path omits this section.
- Use `## Scenes` as the primary source for events meeting the
  decomposition threshold.
