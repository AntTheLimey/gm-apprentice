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
- **D&D 5e (2024):** hit points, temporary hit points, death saves, hit dice,
  spell slots, feature uses, magic item charges, conditions, exhaustion and
  Heroic Inspiration, each written into its own cell of the PC's tables. See
  "D&D 5e: what is written" below.

Loadout (carried items) and hero points are not synced.

It does nothing when `publish.live_stats` is not `true`, or when
`character_sheets` is `false` (which forces live stats off): it prints one line
saying so and reads nothing from KV.

## D&D 5e: what is written

| Live value | Cell in the note |
|---|---|
| Hit points | `### Combat`, `HP (Current)` |
| Temporary hit points | `### Combat`, `Temp HP` |
| Death saves | `### Combat`, `Death Saves (S/F)`, as `s/f` |
| Hit dice spent | `### Combat`, each `Hit Dice` row: the spent half of `s/m`; the maximum is never touched |
| Spell slots | `### Spell Slots`, `Expended` (a `Pact` row included) |
| Feature uses | `Used`, in `## Class Features`, `## Species Traits`, `## Feats` |
| Magic item charges | `### Magic Items`, `Used` |
| Conditions | `### Combat`, `Conditions`: names joined by `, `, or `—` for none |
| Exhaustion | `### Combat`, `Exhaustion` |
| Heroic Inspiration | `### Core`, `Heroic Inspiration`: `Yes` or `No` |
| Concentrating | never written; it lasts only on the site |

- **Only a cell changes.** No row, column or section is ever added. A cell
  is written only when the live value differs from what it reads as.
- **A reason is kept.** `38 (after the fall)` becomes `31 (after the fall)`.
- **A blank cell has a value.** Blank `Temp HP`, `Exhaustion`, `Used` and
  `Expended` read as 0, and a blank `HP (Current)` reads as the maximum. A
  blank cell is filled in only when the live value differs from that.
- **A cell the page could not read is not live, and is never written.**
  That is a number cell holding anything but a whole number with an optional
  reason in brackets; `HP (Current)` when `HP (Max)` is not such a number;
  hit dice or death saves not written as two whole numbers with a slash
  (death saves over 3 included); a `Used` over its `Uses` or `Charges`, or
  with none beside it; an `Expended` over its `Total`; a `Used` or
  `Expended` cell holding more than digits; a `Heroic Inspiration` cell
  that is not a yes or no word; a magic item whose `Attuned` is not a yes
  or no word. A link in a Combat or Core row (other than inside a reason),
  or anywhere in a slot row, also leaves that row as written. A linked
  feature or item name is fine.
- **Of two rows with the same name in one table, only the first is live.**
  The second is never written.
- **A value with no cell is skipped and named**, on a line under the PC's
  own:
  `Mara Voss — no cell in the note for: temp, slot:pact (3rd), class:second wind`.
  The names are the site's keys: `hp`, `temp`, `exhaustion`, `conditions`,
  `inspiration`, `ds:s` and `ds:f` (death saves), and `hd:`, `slot:`,
  `class:`, `species:`, `feat:` or `item:` with the row's name in lower
  case. It means the row is missing, was renamed or deleted since the count
  was saved, or holds a cell from the list above. Tell the GM which; do not
  add the row yourself. Nothing else on that PC is held back.
- **An old-layout note** (prose features, no `Temp HP` row) is written only
  where its cells exist, and the rest is named as above. Converting the
  note gives the missing cells a home (`ttrpg-expert`'s
  `systems/dnd-5e-2024/sheet-conversion.md`).

## When to run it

- **Tier-2b (inbox loop):** the change-request loop already runs flush on **stop**
  — see `change-request-loop.md`. Nothing extra to do.
- **Tier-2a (status bar, no inbox loop):** there is no unattended process, so run
  it yourself — session-wrapup does this automatically (below), or run it ad hoc.

## How to run it

From the **site directory** (the one holding `vault.config.json` and
`wrangler.toml`):

    npx gm-apprentice-publish flush --dry-run   # preview: same lines, writes nothing
    npx gm-apprentice-publish flush             # write the sheets

(or `node <tool>/bin/gm-publish.js flush`). It prints a per-PC summary
(`✓ Karl Brenner — HP 12→7, FP 11→9`). Report that summary to the GM.
A D&D line names each cell by its row and shows the whole cell
(`✓ Mara Voss — HP (Current) 38→31, 1st 0→2, Second Wind 0→1`); a cell
that was blank shows `?` as its old value.
`flush` is the one command that edits the vault, so preview first when the
GM is unsure; `--help` prints usage, and an unknown flag is rejected rather
than run.

## When it does nothing

- The campaign has no published Tier-2 site (no KV) → there is nothing to pull;
  skip silently.
- A GURPS sheet has no Attributes block → flush can update an existing HP/FP line
  but cannot seed a missing one (no max to write), so it leaves that vital alone;
  if nothing else changed the PC just shows `· no change`.
- A PC's current status is authored as a YAML `status:` *object* in frontmatter
  (rather than the `## Current Status` body block) → flush warns and skips that PC.
  The build reads vitals from the frontmatter object and ignores the body, so a
  body write wouldn't take effect. Author current status in the body block (the
  standard format) so flush can sync it.
- No players have saved live state yet → flush reports "no live state to flush".

Copyright: flush writes only the GM's own campaign data — no licensed text.
