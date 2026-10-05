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
| Conditions | `### Combat`, `Conditions`: names joined by `, `, or `—` for none. `None`, `N/A`, `No` or a dash in the cell reads as none |
| Exhaustion | `### Combat`, `Exhaustion` |
| Heroic Inspiration | `### Core`, `Heroic Inspiration`: `Yes` or `No` |
| Concentrating | never written; it lasts only on the site |

- **Only a cell changes.** No row, column or section is ever added. A cell
  is written only when the live value differs from what it reads as.
- **A reason is kept.** `38 (after the fall)` becomes `31 (after the fall)`.
- **A blank cell has a value.** Blank `Temp HP`, `Exhaustion`, `Used` and
  `Expended` read as 0, and a blank `HP (Current)` reads as the maximum. A
  blank cell is filled in only when the live value differs from that. In
  `HP (Current)`, `Temp HP` and `Exhaustion` a dash (`—`, `–`, `-`) is a
  blank, and so is `None`, `N/A` or `No` in `Temp HP` and `Exhaustion`.
- **A number is written through emphasis.** `**38**` becomes `**31**`.
- **A cell the page could not read is not live, and is never written.**
  The usual reasons are in "D&D 5e: why the page cannot read a cell"
  below.
- **A value the note could not take is named**, on a line under the PC's
  own:
  `Mara Voss — not written, no cell in the note can hold: temp, slot:pact (3rd), class:second wind`.
  The names are the site's keys: `hp`, `temp`, `exhaustion`, `conditions`,
  `inspiration`, `ds:s` and `ds:f` (death saves), and `hd:`, `slot:`,
  `class:`, `species:`, `feat:` or `item:` with the row's name in lower
  case. It means the row is missing, was renamed or deleted since the count
  was saved, stops short of the cell (a row typed without its last cells),
  or holds a cell the page cannot read (below). Tell the GM which; do not
  add the row or the cell yourself. Nothing else on that PC is held back.
- **Nothing lost, nothing named.** A value that is what a missing cell
  already means (no temporary hit points, no exhaustion, no conditions, no
  inspiration, a count of 0) is not named. So a line under a PC's name
  always means a real number did not reach the note.
- **A condition is a short plain name.** A name is letters (of any
  language), digits, spaces, apostrophes, hyphens and round brackets, 1 to
  60 characters, and nothing else. `flush` writes only names that pass
  that test, joined by `, `, and at most 20. Anything else in a saved
  record is dropped, because the site's store can be written by anyone who
  knows the site's address.
- **A `Conditions` cell that holds anything else is never rewritten.** It
  is the GM's own writing, and conditions are then not live for that PC
  (below). `flush` leaves the cell exactly as it is.
- **An old-layout note** (prose features, no `Temp HP` row) is written only
  where its cells exist, and a real value with no cell is named as above. Converting the
  note gives the missing cells a home (`ttrpg-expert`'s
  `systems/dnd-5e-2024/sheet-conversion.md`).

## D&D 5e: the saved value and the note

A live value is changed on the PC's page (from any device), not in the
note.

- The site keeps what a player last saved for 30 days. For those 30 days
  `flush` writes that saved value over the note's cell, every time it
  runs, whether or not the player was at the session.
- So a number typed into a live cell between sessions does not last. The
  GM sets `HP (Current)` to 17 after an off-screen rest; the player is
  away next session; `flush` at wrap-up writes the 3 that player saved a
  fortnight ago. GURPS and CoC live values behave the same way.
- What the page shows depends on the device. A device that saved the
  value shows the saved one, and so does any device using the same
  session code. A device with no session code or a different one, or a
  cleared browser, has nothing saved, so that page shows the note.
- To change a live value between sessions, open that PC's page and change
  it there. That saves a newer record, which is the one `flush` writes.
- The maxima are different: `HP (Max)`, `Uses`, `Charges`, `Total` and the
  maximum half of hit dice always come from the note. Edit those in the
  note; a saved count above a new maximum is cut to it, on the page and
  by `flush`.

## D&D 5e: why the page cannot read a cell

The built page decides what is live. These are the usual reasons a thing
is shown as written, with nothing to tap; `flush` never writes such a
cell. They are not every reason: an unusual table can also leave a row as
written.

- **Hit points:** `HP (Max)` is not a whole number (a reason in brackets
  may follow, as in `38 (Tough)`), or `HP (Current)` holds text that is
  not a number (`about half`). Either way hit points are not live, the
  page shows both cells as written, and `flush` writes neither. A blank
  `HP (Current)` is fine: it reads as the maximum, and `flush` fills it
  in.
- **`Temp HP`:** anything but a whole number (a reason may follow) or
  blank. Temporary hit points are set from the hit point tile, so they
  are also not live whenever hit points are not.
- **`Exhaustion`:** anything but a whole number (a reason may follow) or
  blank.
- **`Heroic Inspiration`:** not a yes or no word. Blank reads as no.
- **`Conditions`:** a name written as a link, in bold or italic, or with a
  character that is not a letter, a digit, a space, an apostrophe, a hyphen
  or a round bracket; a name over 60 characters; the same name twice; more
  than 20 names. Conditions are then not live: the page shows the cell as
  written and offers no conditions drawer, and `flush` never rewrites the
  cell.
- **Death saves:** not two whole numbers with a slash (`1/2`), or either
  over 3.
- **Hit dice:** not `spent/max` (`2/5`), or spent over max, or a max of 0.
- **A spell slot row:** a `Total` that is not a whole number or is 0, an
  `Expended` that is not a whole number or blank, or `Expended` over
  `Total`.
- **A feature or magic item row:** a `Uses`, `Charges` or `Used` that is
  not a whole number or blank (a reason in brackets is not allowed here);
  a `Used` above 0 with no `Uses` or `Charges` beside it; `Uses` or
  `Charges` of 0; `Used` over `Uses` or `Charges`. A row with `Uses` blank
  has nothing to count, which is not a fault.
- **A magic item row** whose `Attuned` is not a yes or no word (blank
  reads as no).
- **A link in the wrong place:** in the label or value of a `### Core` or
  `### Combat` row (a link inside a trailing reason is fine), or anywhere
  in a slot row. A linked feature or item name is fine.

Two rows with one name in a table cannot both be live. The first row of
the name owns it: if the page can read that row it is the live one, and a
later row of the name is shown as the note has it, never tapped and never
written. If the page cannot read the first row, no row of that name is
live. Give each row its own name.

A cell the page cannot read is not reported at every flush. The page
saves nothing for a value it does not track, so there is nothing to
report until the cell is fixed.

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
