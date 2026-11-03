## TOHIT_UNREAD

Part of the Site Faults check. Read `site-faults.md` (the folder's
neighbour) first: it says what `SITE` means and how a fix is put to the
GM.

A row of a GURPS PC's sheet that the to-hit calculator on the Combat
tab cannot fully read. The row names the PC's note, the table and the
weapon or technique, says what is wrong, and after the `—` says the
fix. The template (`shared/templates/pc-gurps-4e.md`, the comments
under `## Skills`, `## Techniques`, `## Melee Weapons`) has the forms
it reads. Work one PC at a time: show the sheet's line, the line as it
would be with the row's fix made, and edit on a yes. Never change a
number the GM wrote without saying so.

**A skill the Skills table lacks** asks nobody. That is a row whose fix
says to add a skill to the Skills table for 0 points (for an attribute
in the Skill cell, `DX-12`, the weapon's skill: Knife for a knife), and
a Skill cell with no level. Where the row gives a nearest name, first
check the skill is not that one misspelt. GURPS uses such a skill at
its default, 0 points spent. Run
`python3 "${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/gurps_skill_default.py"
"<PC note>" "<skill>" --write`. It works the level out from the sheet
and the GURPS tables and prints one row:

- `ADDED`: the Skills table row it wrote. Write the weapon row's Skill
  cell as the skill and that level (`Knife-10`), and report both.
- `HAVE`: the skill is in the table; use its level the same way.
- `NO-DEFAULT`: the skill can't be used until at least 1 point is
  spent on it, so nothing is added. Report that for this row; the GM
  may buy the skill or drop the weapon row.
- `NOT-FOUND` or `CHECK-DEFAULT`: ask ttrpg-expert for the skill's
  difficulty and every default, with the page, and run it again with
  `--difficulty` and `--default "<defaults>"`.

Offer each other row's fix as it reads. Where the fix is not all of it:
- **A technique in the Skill cell** (`INFO`): offer to remove the row,
  or to keep it as the fix says.
- **A technique, Dual-Weapon Attack or Off-Hand Weapon Training that
  finds no skill:** the full spelling nests (`Dual-Weapon Attack (Beam
  Weapons (Pistol))`, Default `Beam Weapons (Pistol)-4`). Off-Hand
  Weapon Training is a technique: in Techniques, named for the skill.
- **Techniques with no weapon row for a shooting skill:** leaving it
  is an answer too, if the character no longer carries the weapon.
- **A level above the skill by more than the row's named bonuses**
  (`INFO`): ask what the difference is. Name it in the row's Notes, as
  the fix says, or put the level right.

A row the GM wants left as it is stays a row: it comes back on every
run and in the build's count. Log it as "left as written" and do not
raise it again in the same run.
