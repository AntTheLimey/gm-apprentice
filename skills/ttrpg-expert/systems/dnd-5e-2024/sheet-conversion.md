# D&D 5e 2024 -- Converting an Old-Layout PC

How to bring a PC note written before the full sheet into the template's
layout (`shared/templates/pc-dnd-5e-2024.md`). Read "Writing the Sheet
in the Vault" in `character-sheet.md` first: it holds the everyday rules
this file builds on.

An old note is one with prose feature lists, `### Prepared Spells`
lists, no `Save` column, or its stats in frontmatter. It still publishes
with nothing lost, so there is no hurry: convert a PC when you next work
on that character, never in bulk, and never without the GM knowing.

## The rule under every step

**Write only what the note says.** A conversion moves the GM's facts
into tables; it does not choose anything for them. When the note does
not say, ask the GM, and leave the cell or row empty until they answer.
A published sheet that names spells the player never picked is worse
than one with an empty table, because nobody can tell which rows are
real.

Things an old note usually does not say, and so must be asked:

- which spells are known or prepared (a note that gives slots but no
  spell names gets an empty `### Spells` table)
- languages
- which skills an "any two" choice went to
- current hit points, when only a maximum is written

## Steps

1. **Read the whole note, frontmatter included.** List what it holds
   and where: stats in frontmatter fields, features in a list, gear in
   prose.
2. **Add the template's sections and columns** the note lacks, in the
   template's order. Keep every heading the note already has.
3. **Fill scores, level, class line and proficiencies** from the note.
   The class's two save proficiencies and the XP for a level come from
   the tables in `mechanics.md`. Those are rules, not choices, so they
   need no question.
4. **Split a mixed feature list.** Old notes often keep everything in
   one list. A class or subclass feature goes to `## Class Features`; a
   species entry ("Human", "Elf (high elf lineage)") becomes the
   species' traits in `## Species Traits`; a background's feat and any
   other feat go to `## Feats`. The species and background names
   themselves belong on the `## Background` lines, not in a table.
5. **Give each feature its row**: Action, Uses, Used, Recovers and a
   one-line summary in your own words.
6. **Move bonuses to `### Bonuses`** instead of carrying a hand-summed
   number across. An old `Initiative +5` on a character with Alert
   becomes a blank Initiative cell and an `Initiative | PB | Alert` row.
7. **Run `dnd_sheet.py`**, show the GM the `FILL` rows, and write on
   their yes. Then write the attack lines, AC, hit point maximum and
   Speed from the numbers it filled, add Gear with weights, and run it
   again. With those numbers in, read the rules-check rows at the end of
   that run (character-sheet.md, "Rules checks"): fix a `WRONG`, tell the
   GM each `LOOK`.
8. **Delete the retired frontmatter stat fields** (`ability_scores`,
   `proficiencies`, `class_features`, `spell_slots`) once every value
   in them is in the sheet. The page no longer reads them, the build
   warns while they remain, and two copies of a number will drift. Do
   not delete one until you have checked its values are all placed.
9. **Run the tool a last time**: it should report no `FILL` and no
   `ERROR`.

## What stays as it is

- **Sections the template does not have** (`## Personality`, a diary,
  a list of contacts) stay where they are, under their own headings.
  They publish as their own sections under the sheet. Do not fold them
  into `## Background` and do not drop them.
- **Prose that is more than a list** stays as prose. `## Background`
  holds the template's labelled lines; the GM's paragraphs may sit
  under them.
- **`## Notes` and `## GM Notes`** are never touched.

## When the note contradicts itself

A feature's text says one thing and a proficiency list another; a
maximum is lower than a current value. Do not pick a side, and do not
pick the one that makes the sums work. Show the GM both lines and ask
which is right, then write that one and correct the other.
