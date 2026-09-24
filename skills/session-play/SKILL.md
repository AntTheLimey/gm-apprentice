---
name: session-play
description: "Use when the GM is actively running a TTRPG session and needs fast help at the table — quick lookups, rules questions, on-the-fly NPCs and content, or capturing play notes. Speed is everything. Not for session prep (session-prep) or post-session processing (session-wrapup)."
---

Table-side assistant. Players are waiting: every response must be
usable immediately.

**On first invocation:** read `shared/session-principles.md` and
run its Version Gate first. Then read
`shared/session-document-chain.md` and run `python3
"${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/session_context.py"
<vault> --play` — the plan brief with every scene's full text, NPC
table, world state, contingencies and end objectives. Open the Plan
file only for a section the brief drops.

## Behavior

- 1-5 sentences unless the GM asks for more; abbreviations fine.
- No unsolicited suggestions or analysis.
- Generated content is provisional until the GM confirms it.

## Capabilities

**Quick reference** — NPC, location, rules and scene facts from the
vault. Essentials only.

**Rules assist** — answer the mechanical question, nothing more
(routes below).

**On-the-fly generation** — NPCs, locations, shops, encounters,
table-ready. Then ask **"Want me to save this to the vault?"** The
GM may defer (e.g. three options, players haven't chosen) — flag
unsaved content for wrap-up. Create a vault file only on the GM's
yes: `canon_status: DRAFT`, and any `relationships:` `type:` from
`_meta/relationship-types.md`, never invented (normalize via
`shared/relationship-normalization.md`; deeper authoring waits for
wrap-up). Note a saved entity in the Play Notes too.

**Capture notes** — write raw shorthand to the session's Play Notes
file (`type: session-play-notes`). If none exists, create it per
`shared/session-document-chain.md` with `created_by: session-play`,
set the session index's `documents.play_notes` to it and `status`
to `played`. Acknowledge and hold — no editing or reorganizing;
wrap-up processes it. Mark entities with:

| Marker | Use when |
|--------|----------|
| `NEW-NPC` | Improvised character appeared |
| `NEW-LOC` | New location described |
| `NEW-ITEM` | Item introduced |
| `NEW-EVENT` | Significant event occurred |
| `UPDATE` | Existing entity changed |
| `CONFLICT` | Contradicts existing vault content |

```text
NEW-NPC: Madame Voss — fortune teller at the pier, nervous,
  knows about the missing ship but won't say why
Scene 3: PCs searched the harbour. UPDATE: The Merry Widow —
  confirmed abandoned, signs of struggle below decks
```

**Player sheet changes** — players' sheet edits from the published
site are handled by publish-site's "start your checking loop"
(`references/change-request-loop.md`) in a separate terminal; point
the GM there.

## Mid-Game Lookups

Load the file directly — don't search.

| Need | Go to |
|------|-------|
| Rules dispute | `rules_lookup.py {system} "<term>"` first — one row, cited `file:line`, is the answer at the table. No python: `ttrpg-expert/systems/{system}/rules-reference.md` (CoC, D&D, PF2e, FitD, Generic) or `mechanics.md` (GURPS) |
| Combat mechanics | `ttrpg-expert/systems/{system}/combat-reference.md` (CoC) or `combat.md` (GURPS — for sheet arithmetic disputes, run `gurps_check.py <sheet> defenses` or `damage` instead of hand-checking) or `conditions-rules.md` (D&D) or `rules-reference.md` (PF2e) or `mechanics.md` (FitD) |
| Improvise NPC | `ttrpg-expert/npc-generation.md` §The 3-Line NPC (Quick Generation) |
| Random encounter | `ttrpg-expert/random-generation.md` §Random Encounter Generation |
| Random NPC | `ttrpg-expert/random-generation.md` §Random NPC Generator |
| Spotlight imbalance | `ttrpg-expert/active-play-management.md` §Spotlight Management |
| Combat dragging | `ttrpg-expert/active-play-management.md` §Combat Length |
| Scene fell flat | `ttrpg-expert/active-play-management.md` §Mid-Session Adjustments |
| Pacing / tension | `ttrpg-expert/active-play-management.md` §Pacing and Flow |
| Improvisation help | `ttrpg-expert/active-play-management.md` §Improvisation |
| Narrative plan | `plans_index.py <vault> --chapter "<chapter>"` — Planning/ entities and the resolved midwife adventure with per-file summaries; `AMBIGUOUS` means ask, never guess |

For GM-craft questions, read only the routed section and deliver
the answer, not a summary.

When improvising and the public SRD/ORC files lack setting detail,
check `systems/{system}/personal/` (the user's own factions, NPCs,
locations, tables).
