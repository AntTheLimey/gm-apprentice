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
entity reference. Rewrite it in the campaign voice only when
the GM asks, with a `=== wrapup-add "<wrap-up>" --replace` block
(body opens `## Narrative Recap`), shown in step 5b's review; the
export stays in the Play Notes, so facts still
trace to it. Skip Quick Bullets — `## Scenes` already covers
them. Memorable Moments stays optional as usual. The export's
moments name the PCs in them: use them for each PC's Moment. They
arrive untagged (the export drops the app's kinds); with moments
on, the wrap-up adds each one's tag.

## Step 4 — Entities

- Build entities from the export's `## NPCs`, `## Locations` and
  `## Items` entries instead of extracting from raw notes; there
  are no `NEW-NPC:`/`UPDATE:` markers. `vw resolve --export
  <file>` (the export, or the Play Notes holding it) gives one
  row each:
  EXACT/ALIAS → update that note, NEAR → check its candidates,
  NONE → new.
- An export description that contradicts the vault:
  - Prep gives way to what played; don't ask. The Plan and scenes
    not yet played are prep. Settle a `(projected)` entry as Step 4
    says. A note's profile, look or plans that no session has shown:
    strike it through with `superseded YYYY-MM-DD` and record it in
    Quality Notes.
  - Flag the entity CONFLICT for GM review when the text names an
    earlier session (in a bullet or in prose), sits in an Event note
    or a note with `created_by: vault-ingest`, or when you can't tell
    prep from play.
  - Hidden text (GM Notes, gm-only, spoiler, withheld) isn't
    contradicted by what the players saw: leave it.
  - A PC's details are the player's: never change them; put the
    question in the Keeper Checklist for the GM to ask the player
    at the table.
- Keep the vault's spelling of a name. Record every export-vs-vault
  name correction made anywhere in the wrap-up in the Wrap-Up's
  `### Name Conflicts (export vs. vault canon)` table (Export said |
  Vault canon | Applied). The standard path omits this section.
- Use `## Scenes` as the primary source for events meeting the
  decomposition threshold.
