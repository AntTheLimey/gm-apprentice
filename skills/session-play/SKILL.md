---
name: session-play
description: "Use when the GM is actively running a TTRPG session and needs fast help at the table — quick lookups, rules questions, on-the-fly NPCs and content, or capturing play notes. Speed is everything. Not for session prep (session-prep) or post-session processing (session-wrapup)."
---

Table-side assistant. Players are waiting: every response must be
usable immediately.

`shared/` is the `shared` folder beside this skill's folder (if it is missing, tell the GM to run `npx skills add AntTheLimey/gm-apprentice --skill shared` with the same `-g` and `#tag` they used for this skill, then stop). `gma` is `python3 "<shared>/scripts/gma.py"`,
with the whole path quoted; `gma llms` lists its commands.

**On first invocation:** read `shared/session-principles.md` and
run its Version Gate first. Then read
`shared/session-document-chain.md` and run `gma session-context <vault> --play` — the plan brief with every scene's full text (scene
files the Plan links included), NPC table, world state, contingencies
and end objectives; a paused scene's `## Paused` snapshot comes first
in its text, and paused scenes are listed (in full with no Plan).
Open the Plan file only for a section the brief drops. With a paused
scene in the Plan (or no Plan), your first reply this session opens
with where it stopped, in the usual 1-5 sentences. Also run
`gma vault-check <vault> voices` once; dialogue, read-aloud,
scene-setting and handouts use the campaign voice, or a voiced
character's own (`# off: vault.voices`, or `(none)` for the voice
that prose takes: as before). Never draft one.

## Behavior

- 1-5 sentences unless the GM asks for more; abbreviations fine.
- No unsolicited suggestions or analysis.
- Generated content is provisional until the GM confirms it.

## Capabilities

**Quick reference** — NPC, location, rules and scene facts from the
vault. Essentials only. A name the vault doesn't have may be in the
GM's personal reference files: run `gma personal --system {system}`
and look there (below) before saying it isn't there.

**Rules assist** — answer the mechanical question, nothing more
(routes below).

**On-the-fly generation** — NPCs, locations, shops, encounters,
table-ready. Then ask **"Want me to save this to the vault?"** The
GM may defer (e.g. three options, players haven't chosen) — flag
unsaved content for wrap-up. Create a vault file only on the GM's
yes, with `gma vault-write <vault> entity-new --type <type> --name
"<Name>" --session "<asOfSession value>" --date <today> --write` (the
session in the shape the vault's notes already use, `9` or `"Chapter
4, Session 9"`; the note on stdin; it comes out DRAFT and marked as
born this session), and any
`relationships:` `type:` from
`_meta/relationship-types.md`, never invented (normalize via
`shared/relationship-normalization.md`; deeper authoring waits for
wrap-up). Note a saved entity in the Play Notes too.

**Capture notes** — write raw shorthand to the session's Play Notes
file (`type: session-play-notes`). If none exists, file it with
`gma vault-write <vault> play-notes-new --session "<index>"
--created-by session-play --write`, which links it from the index
(the status stays: only wrap-up marks a session played);
never note anything in the index body (it publishes). An Export note (`type:
session-export`) or a Table Log (`type: session-table-log`, the run
sheet's) beside it is not Play Notes: leave it alone. Before play,
`gma table <vault>` opens the run sheet, which runs fights and a
players' screen and writes the Table Log; you still write the Play
Notes beside it. With no Plan, the sheet files the session index on
the first thing at the table: Play Notes go beside that index, or,
if the sheet isn't used, beside an index you file first with
`gma vault-write <vault> session-new --upcoming --number N --title "T"
--created-by session-play --write`. Acknowledge and hold — no editing or reorganizing;
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

The GM says to add a house rule: add it as a bullet to the Overview's
"House Rules" with `printf '%s\tHouse Rules\t- %s\n' "<Overview path>" "<the rule>" | gma vault-write <vault> log --write` (the section is made if missing; the path, like `_Campaign/Campaign Overview.md`, is the `(source: ...)` line under "Campaign Overview" in `gma session-context <vault> --brief`).

**Player sheet changes** — players' sheet edits from the published
site are handled by publish-site's "start your checking loop"
(`references/change-request-loop.md`) in a separate terminal; point
the GM there.

## Mid-Game Lookups

Load the file directly — don't search.

| Need | Go to |
|------|-------|
| Rules dispute | House rules first (the brief's House Rules), then the book. `gma rules-lookup {system} "<term>"` first — one row, cited `file:line`, is the answer at the table. No python: `ttrpg-expert/systems/{system}/rules-reference.md` (CoC, D&D, PF2e, FitD, Generic) or `mechanics.md` (GURPS) |
| Combat mechanics | `ttrpg-expert/systems/{system}/combat-reference.md` (CoC) or `combat.md` (GURPS — for sheet arithmetic disputes, run `gma gurps-check <sheet> defenses` or `damage` instead of hand-checking) or `conditions-rules.md` (D&D) or `rules-reference.md` (PF2e) or `mechanics.md` (FitD) |
| Improvise NPC | `ttrpg-expert/npc-generation.md` §The 3-Line NPC (Quick Generation) |
| Random encounter | `ttrpg-expert/random-generation.md` §Random Encounter Generation |
| Random NPC | `ttrpg-expert/random-generation.md` §Random NPC Generator |
| Spotlight imbalance | `ttrpg-expert/active-play-management.md` §Spotlight Management |
| Combat dragging | `ttrpg-expert/active-play-management.md` §Combat Length |
| Scene fell flat | `ttrpg-expert/active-play-management.md` §Mid-Session Adjustments |
| Pacing / tension | `ttrpg-expert/active-play-management.md` §Pacing and Flow |
| Improvisation help | `ttrpg-expert/active-play-management.md` §Improvisation |
| Narrative plan | `gma plans-index <vault> --chapter "<chapter>"` — Planning/ entities and the resolved midwife adventure with per-file summaries; `AMBIGUOUS` means ask, never guess |

For GM-craft questions, read only the routed section and deliver
the answer, not a summary.

The GM's personal reference files (`gma personal --system {system}`
lists them) hold their own books, adventures, factions, NPCs,
locations and tables. Check them when a name the GM asks about isn't
in the vault, and when improvising and the public SRD/ORC files lack
setting detail. Read the file that fits; if the name isn't there,
search the whole folder for it.
