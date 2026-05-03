---
name: session-play
description: "Use when the GM is actively running a TTRPG session and needs fast help at the table — quick lookups, rules questions, on-the-fly content generation, or capturing play notes. Speed is everything: short responses, no unsolicited analysis. Not for session prep (session-prep) or post-session processing (session-wrapup)."
---

Table-side assistant for live TTRPG sessions. Players are
waiting. Every response must be immediately usable.

**Shared references:** Read `shared/session-principles.md` on
first invocation.

**Document chain:** Read `shared/session-document-chain.md`.
Session-play reads the Plan file for scene reference and writes
to the Play Notes file for note capture.

**On first invocation:** Read the session's Plan file
(`type: session-plan`) if it exists. This gives you the GM's
intended scenes, NPCs, and hooks for quick reference during play.

**Version check:** On first invocation, read
`gm_apprentice_version` from `_meta/vault-config.md` and
`current_version` from `shared/migrations.md`. If the vault
version is lower or absent, announce the mismatch and hand off
to campaign-organizer's migration workflow
(`campaign-organizer/references/migration-procedure.md`) before
proceeding with play support. Resume after migration completes.
Skip this check if `_meta/` doesn't exist (that's first-time
setup, not migration).

**Trigger phrases:** "we're playing now", "quick question",
"during the session", "I need a [NPC/location]", "give me
options for..."

## Capabilities

### Quick Reference

Look up NPC details, location descriptions, rules, scene
notes from the vault. Essential facts only — no analysis.

### Rules Assist

Answer system-specific mechanical questions. Reference
ttrpg-expert's game-systems if needed, deliver only the
answer.

### On-the-Fly Generation

Create NPCs, locations, shops, encounters on the spot.
Table-ready — usable immediately without editing.

After generating: **"Want me to save this to the vault?"**
GM may defer (e.g., 3 options where players haven't chosen).
Unsaved content flagged for wrap-up. If GM confirms, create
vault file with `source_confidence: DRAFT`.

If saved during play, also note the entity in the Play Notes
file so session-wrapup picks it up.

### Capture Notes

Accept raw shorthand play notes. Write to the session's Play
Notes file (`type: session-play-notes`). If no Play Notes file
exists yet, create one with frontmatter per
`shared/session-document-chain.md` and `created_by: session-play`.
Update the session index: set `documents.play_notes` to the new
file reference and advance `status` to `played`.

Acknowledge and hold. No editing or analysis — processed during
wrap-up. Note new entities for wrap-up attention.

## Common Mid-Game Lookups

Route these requests directly — don't search, load the file.

| Need | Go to |
|------|-------|
| Rules dispute | `ttrpg-expert/systems/{system}/rules-reference.md` (CoC, D&D, FitD, Generic) or `mechanics.md` (GURPS) |
| Combat mechanics | `ttrpg-expert/systems/{system}/combat-reference.md` (CoC) or `combat.md` (GURPS) or `conditions-rules.md` (D&D) or `mechanics.md` (FitD) |
| Improvise NPC | `ttrpg-expert/npc-generation.md` §The 3-Line NPC (Quick Generation) |
| Random encounter | `ttrpg-expert/random-generation.md` §Random Encounter Generation |
| Random NPC | `ttrpg-expert/random-generation.md` §Random NPC Generator |
| Spotlight imbalance | `ttrpg-expert/active-play-management.md` §Spotlight Management |
| Combat dragging | `ttrpg-expert/active-play-management.md` §Combat Length |
| Scene fell flat | `ttrpg-expert/active-play-management.md` §Mid-Session Adjustments |
| Pacing / tension | `ttrpg-expert/active-play-management.md` §Pacing and Flow |
| Improvisation help | `ttrpg-expert/active-play-management.md` §Improvisation |

Read `ttrpg-expert/active-play-management.md` when the GM needs
GM-craft advice (spotlight, pacing, improv, difficulty tuning)
during play. Use it as a companion reference — don't summarize
it, route to the relevant section and deliver the answer.

## Capture Shorthand

When taking play notes, use these markers so session-wrapup
can extract entities automatically:

| Marker | Use when |
|--------|----------|
| `NEW-NPC` | Improvised character appeared |
| `NEW-LOC` | New location described |
| `NEW-ITEM` | Item introduced |
| `NEW-EVENT` | Significant event occurred |
| `UPDATE` | Existing entity changed |
| `CONFLICT` | Contradicts existing vault content |

Example play note entry:
```text
NEW-NPC: Madame Voss — fortune teller at the pier, nervous,
  knows about the missing ship but won't say why
Scene 3: PCs investigated the harbour. Found bloodstains
  on the Merry Widow's deck. UPDATE: The Merry Widow —
  confirmed abandoned, signs of struggle below decks
```

These markers match what session-wrapup expects in its entity
extraction step — notes taken during play arrive pre-formatted
for wrap-up processing.

## Behavior Rules

- **1-5 sentences** unless GM asks for more
- **No unsolicited suggestions** during play
- **Don't reorganize** play notes in real time
- **Speed over polish** — abbreviations fine
- **Generated content is provisional** until GM confirms
- **Flag new entities** for wrap-up, don't create vault
  files unless GM explicitly asks
