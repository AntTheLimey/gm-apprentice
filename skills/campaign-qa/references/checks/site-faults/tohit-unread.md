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
would be, and edit on a yes. Never change a number the GM wrote
without saying so; where a fix needs a number the sheet does not have
(a default level, a missing level), ask ttrpg-expert for it and show
the GM where it came from.

- **A skill not in the Skills table:** rename it in the Skill cell to
  the Skills table's name (the row gives the nearest), or add the skill
  to the Skills table at its default level for 0 points.
- **An attribute in the Skill cell** (`DX-12`): name the weapon's skill
  at its default level, and add that skill at 0 points. Check the
  default: a sheet that wrote the attribute has often got it wrong.
- **A bare number, or words after the level:** write the skill and its
  level; move a comment to the row's Notes.
- **A default in place of a level** (`Kick | DX-2`): write the level the
  default comes to.
- **A skill written as a default in the Techniques table** (`INFO`):
  add it to the Skills table at that level for 0 points.
- **A row split by a `|` in a link:** write the `|` inside the link as
  `\|`.
- **No level:** ask the GM for it.
- **A technique in the Skill cell** (`INFO`): the calculator already
  offers it on the parent skill's rows. Offer to remove the row, or to
  keep it for its own damage or reach with the parent skill in its
  Skill cell.
- **Two levels in one cell** (`INFO`): split it into one row each.
- **A technique, Dual-Weapon Attack or Off-Hand Weapon Training that
  finds no skill:** spell the skill in full, in the name and the
  Default alike (`Dual-Weapon Attack (Beam Weapons (Pistol))`, Default
  `Beam Weapons (Pistol)-4`). Off-Hand Weapon Training is a technique:
  in Techniques, named for the skill. Weapon Bond names the weapon as
  its row does.
- **A Targeted Attack with no hit location the calculator knows:** end
  its bracket with the location (`/Neck`, `/Vitals`, `/Arm`, `/Leg`).
- **Techniques with no weapon row for a shooting skill:** add the
  weapon's row, or leave it if the character no longer carries one.
- **A level above the skill by more than the row's named bonuses**
  (`INFO`): ask what the difference is. Name it in the row's Notes
  (`Weapon Bond +1`), or put the level right.

A row the GM wants left as it is stays a row: it comes back on every
run and in the build's count. Log it as "left as written" and do not
raise it again in the same run.
