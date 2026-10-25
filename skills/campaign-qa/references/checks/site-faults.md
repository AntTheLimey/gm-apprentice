# Site Faults

Faults in the GM's notes that change what the published site shows.
The site's own publish tool finds them and the build warns about them;
this check fixes each one or asks the GM what the fix should be. Only
for a vault with a site.

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/vault_check.py" "<vault>" site-faults
```

It asks the tool the site builds with and prints one row per finding,
leaks first. Nothing about the rules lives here or in the script.

Run the version check first, as for every mode (`SKILL.md`). On
`MISMATCH`, do the migration it calls for, then run this check: the
migration is what brings the site's tool up to date.

The check reads the notes, not the site as it was last published. A
fix shows on the next `site-faults` run at once; the site itself
changes the next time it is published.

## Reading the rows

- `INFO (vault) site-faults has no site to check: player_site.publish is not
  on`: skip this check and say nothing about it, in the conversation or
  the report.
- `INFO (vault) site-faults has no site to check (<why>); <fix>`: the
  publish tool could not read the vault's settings. Give the GM the
  reason and the fix as written; nothing was checked.
- `INFO (vault) site-faults not run: … from before this check`: the
  site builds with an older publish tool. Never ask the GM to update
  anything by hand. Run the version check (`SKILL.md`): on `MISMATCH`
  the migration brings the site's tool up to date, then run this
  again. Otherwise put one line in the report's recommendations:
  Site Faults was not run, and will be after the next plugin update.
- `ERROR` rows that are not a finding (`NAMED_NO_PAGE` and
  `WITHHELD_PUBLISHED` are findings, walked below):
  the site's tool could not be asked, or its audit stopped. Nothing
  was checked. Treat a tool that is missing or not
  installed as the older tool above; report any other row as it reads.
  Stop this check either way. `NOTE_FAULTS_UNCHECKED` means a page of
  the site could not be built, so the list would be short: the row
  names the page. That is publish-site's to fix; run this again after.
- `INFO (site) the site's tool: node "<tool>" <command> --config
  "<config>" --vault "<vault>"`: the tool, the site file and the vault
  to use for every `SITE` command below. `SITE explain "<note>"` means
  `node "<tool>" explain "<note>" --config "<config>" --vault "<vault>"`.
  Keep all three: the site file may name another copy of the vault,
  and a fix must land in the vault that was checked.
- `WARNING` rows, and `ERROR` rows for `NAMED_NO_PAGE` and
  `WITHHELD_PUBLISHED`: the findings,
  one each. The table below says how much each one matters.
- A closing `INFO … settled as "stays hidden"` row: notes the GM has
  already said no to. Never raise them; give the count in the report.
- No rows at all: the site has none of these faults. Say so in a line.

Add `--file "<note>"` (repeatable) to see one note's rows alone, with
every page that names it. Use it to confirm each fix.

| Row | Report it as | Why |
|-----|--------------|-----|
| `ALIAS_IN_PROSE` | Critical | A secret name is on the site now |
| `WITHHELD_IN_PROSE` | Critical | The name of a note you marked withheld is on the site now |
| `NEVER_SHOW_IN_PROSE` | Critical | A word the GM listed never to show is on the site now; deploy stops on it |
| `NAMED_NO_PAGE`, withheld (`ERROR`) | Critical | A published page links a withheld note |
| `WITHHELD_PUBLISHED` (`ERROR`) | Critical | A withheld note is on the site under its name |
| `WITHHELD_NAME_PUBLIC` | Warning | A withheld name is not looked for |
| `WITHHELD_FLAG_UNREADABLE` | Warning | The flag does nothing until it is fixed |
| `FENCE_UNCLOSED` | Critical | Hidden text is on the site now |
| `COMMENT_STRAY` | Warning | Text the GM wrote is missing from the site |
| `NAMED_NO_PAGE`, entity | Warning | Players read a name and cannot look it up |
| `NAMED_NO_PAGE`, working or no type | Info | A prep note's name is printed on the site |
| `TOHIT_UNREAD` (`WARNING`) | Warning | The to-hit calculator gives a row less than it should |
| `TOHIT_UNREAD` (`INFO`) | Info | A row's numbers do not add up, or it is written another way |
| `SKILL_BELOW_BASE` (`INFO`) | Info | A CoC skill is written below the base its characteristics give |
| `HEADING_IN_HIDDEN_BLOCK` (`INFO`) | Info | A hidden heading sits inside a hidden block, so the text after it is withheld |
| `TABLE_OVERWIDE` (`INFO`) | Info | A table row has more cells than its header, so the site widened the table |
| `PROP_NOT_COPIED` | Warning | A prop's file, address or a file it links to is not on the site |

A row is raised only where the site shows the fault. A stray `%%` or
an open fence that lies wholly under `## GM Notes` changes nothing a
player sees, and has no row.

Every fix is the GM's decision, as in every campaign-qa check. Show
the line, say what you would change, and edit only on a yes. You do
all the editing and all the bookkeeping; the GM says yes, no, or how
they want it instead. Speak in plain words, never in the row's codes:
"Vesper Hale has no page on the site, and nine pages name him", not
`NAMED_NO_PAGE`. Tell the GM once that the site itself changes the
next time it is published.

## ALIAS_IN_PROSE

A name the GM keeps in a note's `gm_aliases` is printed on a published
page. The row gives the note the page is built from (a PC's
`…_Story.md` for its story page), the name, the note that owns it, how
often it is printed and the sentence as the page prints it.

Find where the note writes it: the body, the title, a frontmatter
field the page prints (`occupation`, a relationship's `description`),
or the name of another page it links. Show the sentence. Offer:

- **Reword** it to the name the players know. In the title or a
  frontmatter field this is the only fix.
- **Link it**, in body text: write the name as a link
  (`[[Old Smuggler]]`). The site prints the note's public title for a
  linked secret name.
- Where the name is part of another page's title, that page's row is
  the one to fix; this one goes with it.
- A row that ends "printed on the index or listing page: …" is a name
  an index page prints from one of the note's frontmatter fields (a
  creature's `subtype`, a chapter's `overview`). Reword that field.

If the GM says the name is no longer a secret, move it from
`gm_aliases` to `aliases` on the owning note instead.

## NEVER_SHOW_IN_PROSE

A word or phrase the GM listed under `player_site.never_show` is printed
on a published page. The row gives the note, the word, how often it is
printed and the sentence. A public name that holds the word is still a
row: the GM said never. Show the sentence. Offer: **reword** it; or
**move** it into a part of the note players do not see (a `## GM Notes`
section, a gm-only block). A row ending "printed on the index or listing
page: …" comes from a frontmatter field: reword that field. If the GM
says the word no longer needs guarding, take it off the list on their
word: `node "${CLAUDE_PLUGIN_ROOT}/tools/publish/bin/gm-publish.js"
settings remove player_site.never_show "<word>" --vault "<vault>"`.

## WITHHELD_IN_PROSE

A note marked `withheld: true` keeps its own name secret: its file
name, title and `aliases`. The row gives the page the name is on (an
attachment's path when the name is in a copied file's name), the name,
the withheld note, how often it is printed and the sentence. Offer, as
for `ALIAS_IN_PROSE`: **reword** it to what the players know; or in
body text **link** the note, which prints a neutral word for the
kind of note in its place.
For an attachment, rename the file and the embeds that name it.

A name in plain text has no "leave it" answer, and `stays hidden:`
does not settle this row: the GM rewords the sentence, links the note
(the neutral word prints), or takes `withheld: true` off. When the fix
says the name is an everyday word and to rename the note, also take
the same name off its `title:` and `aliases:`, then offer to:
`python3 "${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/relink.py"
"<vault>" "<note>" "<new name>"` previews it, links included; on a yes,
again with `--apply`.

A row that says "in the address of a link" is a Markdown-style link
(`[x](Lord_Zorn.md)`): turn it into a `[[wiki-link]]` or plain words.
A row that says "link previews" or "search index" names a text the site
builds from the note's own fields: reword the field.

## WITHHELD_PUBLISHED

A note marked `withheld: true` is on the site under its name: the row
names its page. Ask which was meant. If the name is no secret, take
`withheld: true` off. If it is, stop the note publishing: `publish:
false` in its frontmatter, or out of `publishing` on the publish list
(`SITE manifest apply --exclude "<note>"`). Edit on a yes.

## WITHHELD_NAME_PUBLIC

A withheld name is also the name of another published page, so it is
not looked for. Offer a new title or alias for the page that answers to
the name, or to take `withheld: true` off.

## WITHHELD_FLAG_UNREADABLE

A `withheld:` value that is not true or false (`tru`, a list) is read as
not withheld, so the note's name is not looked for. Show the value and
propose `withheld: true` or `withheld: false` as the GM says.

## FENCE_UNCLOSED

A code fence opens and is never properly closed, so a hidden block
below it is published. A fence closes only on a line of the same marks,
at least as many as opened it, with nothing after them: four backticks
are not closed by three, nor a fence by a line that goes on with words.
The row gives the fence's line and the marker's. Read from the fence
down, show the GM where the code ends, and put a proper closing fence
there on a yes.

## COMMENT_STRAY

A `%%` that is not a comment, or a comment left open in a frontmatter
field. The row quotes the line, or the frontmatter field.

- **Straight after a number** (`10%% now … 5%% later`): everything
  between the two is hidden. If a percent sign was meant, propose a
  single `%`. If a comment was meant, propose a space before the
  opening `%%`.
- **Never closed:** it hides the rest of the note or the field. Propose
  the closing `%%` where the comment ends, or removing the stray one.
- A `%%` in indented text (four spaces or a tab) is a comment like any
  other. Only a fenced code block shows one as written.
- **A `<!--`, `<!-- gm-only -->` or `<!-- spoiler -->` never closed in
  a frontmatter field:** it hides the rest of the field. Propose the
  closing `-->` or closing marker where the hidden words end, or
  removing the opener.

## NAMED_NO_PAGE

A note that has no page is linked from a published page, so its name
is printed there as plain words. The row says what kind of note it is,
how many pages name it and as what words, which rule keeps it off the
site, the reason the GM wrote on the publish list if there is one, and the
first pages that name it. A page is counted only when it prints the
name: a link in a hidden part, or in a field that page does not show,
is not. A PC's story page is listed as its `…_Story.md` file. A page
whose Connections show the name is counted too, though the link
is in a neighbour's relationships.

Where the row ends "printed only by an index or listing page (…) from:
…", the notes after "from:" do not print the name on their own page.
A page built from many notes does (an NPC index prints each NPC's
`first_appearance`, the landing page a recap). The link is in a
frontmatter field of the note named, so `unlink` will not reach it:
handle it as "A link in frontmatter" below, whatever kind the note is.

An `ERROR` row, `withheld entity`, is a note marked `withheld: true`:
it must stay off the site, so there is no page to give it. The links
print a neutral word. Offer the `unlink` command in the row's fix with
`--as` wording the GM agrees. If the neutral word will do, that is a
"stays hidden" for this row only: it settles the link report and
nothing else. Skip steps 1 to 4 below.

Work most-named first, in batches of 3 to 5 notes, one question per
batch. The GM can answer for the batch or note by note, and can stop
at any point: what is left is listed again next time.

### Entity: an NPC, place, faction, item, document, clue

The players have met this name. The usual fix gives the note a page
that shows what the players know and keeps the rest hidden.

**1. Read.** For each note in the batch:

- `SITE explain "<note>" --shown` prints what the site would hold of
  the note if it published as it stands, read off the page as the
  build makes it: the text of the page, the image files that publish
  with it (its portrait is one), its link-preview card, and what the
  search finds it by (title, aliases, every word of the body as
  published).
- What the players know is what published pages already say. Search
  the pages that name the note for its name and read around each hit.
  A fact that is only in the note, a plan or a hidden section is not
  known to the players.
- A reason written on the publish list names the secret. It must end up
  hidden.
- The row's "no page because" says what holds the note back. A
  manifest rule (`MANIFEST_EXCLUDED`, `MANIFEST_NEEDS_DECISION`,
  `MANIFEST_UNLISTED`) is lifted in step 4. Anything else is a second
  decision to put to the GM with the split: the note is still marked
  as prep (`AUTO_EXCLUDED_…`, `DRAFT_EXCLUDED`), it says
  `publish: false` or `publish: none`, or its folder is not on the
  site (`DIR_…`). A folder is added to the site by publish-site, not
  here; offer "stays hidden" or leave the row for that.

**2. Propose the split.** Say, per note:

- **Stays in the open:** the `##` sections the players already know,
  named, each with its first few words.
- **Moves under `## GM Notes`:** every other section. Stat blocks,
  motives, plans, true allegiances and anything not yet played move.
  A section that holds both is split by sentence. Text is moved, never
  reworded and never deleted.
- **Nothing left in the open?** Offer two or three sentences of
  Overview made only of what the published pages already say, and show
  them in full. This is the one piece of new text this check writes.
- **Frontmatter.** `## GM Notes` hides nothing in frontmatter. Read
  what `--shown` printed as a player would, the header lines of the
  page, the card and the search aliases too, and propose a change for
  each frontmatter value that gives away what the split hides:
  - a secret name in `aliases`: move it to `gm_aliases` (links to it
    keep working, the name is never shown);
  - a relationship the players do not know of: `gm_only: true` on that
    entry;
  - a field the page prints (`occupation`, `nationality`, `status`,
    `age`, `location`, an item's `value` or `properties`, and the
    like): reword it to what the players know and keep the true value
    in a line under GM Notes, or name the field in the note's
    `publish_exclude_fields`;
  - a title that tells (`# Vesper Hale — The Informer`): shorten it.
  `publish-site/references/content-filtering.md`, "Frontmatter is not
  covered by the fence", has the detail.
- **Names that would become links.** Once the note has a page, every
  link to it on a published page leads there. Read the row's "named
  as" words. One that hides who it is (`the stranger`, `the Baron`)
  would name them the moment it is a link. Propose turning those links
  into plain words on the pages that hold them.
- **A page that already tells the secret.** If a published page says
  what the publish-list reason calls hidden, tell the GM: that page is the
  leak, whatever is decided here.

**3. Ask.** Show the batch and wait.

**4. On yes.** In this order, so the note is never publishable with a
secret in the open:

1. Edit the note. Hidden text goes under one `## GM Notes` heading
   (add it at the end if there is none). Each moved heading goes one
   level down (`## Motives` becomes `### Motives`): a `##` below
   GM Notes ends the hidden part, and everything under it is
   published. So a section that stays open (`## Source References`,
   say) stays above GM Notes, or below all the hidden text; never put
   hidden text after it. Keep every `<!-- gm-only -->` pair together
   with the text it wraps; no pair may open above `## GM Notes` and
   close below it. Make the frontmatter changes.
2. Turn the telling links into words:
   `python3 "${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/links.py" "<vault>" unlink "<note name>" --in "<page>"`
   (a preview; again with `--write`). Where two notes share the name,
   give the note's vault path as the name. A link that gives no path
   then prints as `KEPT`: read each line, and when it means this note
   run the command again with `--bare`.
3. Run `SITE explain "<note>" --shown` again and read all of it: the
   page, the card and the search lines. Nothing that moved and nothing
   secret may be anywhere in it. What it prints is all the site would
   hold of this note's body and fields. If something is there, fix the
   edit before going on.
4. Give it a page:
   `SITE manifest apply --publish "<note>"`.
5. Confirm: `vault_check.py "<vault>" site-faults --file "<note>"`
   prints no row for it, and `SITE explain "<note>"` says
   `VERDICT: publishes at …`. If the verdict names another rule, tell
   the GM what still holds the note back.
6. Run `vault_check.py "<vault>" gm-leak --folder "<the note's folder>"`
   and fix any `ERROR` or `WARNING` row that names this note (an
   unbalanced fence the note already had now matters). `INFO` rows,
   such as a count of notes skipped, are not faults.

Tell the GM what the page will show, in a line. A new page can name
other hidden notes; they appear as rows on the next run.

**On no.** Record it so it is never asked again:

```bash
SITE manifest apply --exclude "<note>=stays hidden: <the GM's reason>"
```

Use the GM's own words for the reason. The command replaces whatever
reason the entry had, so carry the old one along: where the GM
confirms it, write it after the prefix; where the GM gives a new one,
write the new one and then the old (`stays hidden: not found yet;
was: campaign-secret prep`). Run `site-faults --file "<note>"` to see
the row is gone. The build's warning counts only what is not settled.

### Working: a plan, scene, play notes, an overview

Not something in the world, so never a page. Offer:

- **Plain words.** The links on the pages that name it become their
  words:
  `links.py "<vault>" unlink "<note name>" --in "<page>" [--in "<page>" …]`.
  A link with its own wording keeps it. Where a link has none and the
  note's name would read as a file name (`Scene 02 Quay`), add
  `--as "<words>"` with wording the GM agrees. Read the preview, then
  run it again with `--write`. Where two notes share the name, give
  the vault path as the name; a link with no path prints as `KEPT`,
  and `--bare` turns it once the GM has agreed it means this note. It
  changes every link to the note on those pages, hidden parts
  included; where the GM wants a private
  link kept, edit the open lines by hand instead.
- **Reword** a sentence that only made sense as a link, by hand.
- **A link in frontmatter.** `unlink` leaves frontmatter alone and
  lists each such link as `KEPT`, so the row comes back. Where a page
  names the note through a relationship's `target` or another field
  it prints, show the GM that field and offer: remove the entry (or
  mark a relationship `gm_only: true`, which keeps it for the GM and
  off the site), or write plain words there in place of the link. Edit
  the frontmatter by hand on a yes.
- **Leave the links.** That is a no: record `stays hidden:` as above.

### No type

The site cannot tell what the note is. Read it and propose a `type`
from `_meta/entity-types.md`. On yes, write the type with that type's
required fields (`shared/templates/`), run
`vault_check.py "<vault>" frontmatter --folder "<its folder>"` and fix
the ERROR rows for this note. Then run `site-faults --file "<note>"`:
the row now reads entity or working, and is handled as above.

## TOHIT_UNREAD

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

## SKILL_BELOW_BASE

A Call of Cthulhu skill written lower than the base the PC's
characteristics give it (`Dancing | 05 | 10` with DEX 70, base 14).
The row says the number written and the base. The sheet shows the
number written either way. Per PC, ask: raise it to the base, or leave
it? On a raise, write the base in the Regular column and, if the
Half and Fifth cells hold numbers, work them out again. On leave, log
"left as written" and do not raise it again in the same run.

## HEADING_IN_HIDDEN_BLOCK

A hidden heading (`## GM Notes`) is written inside a gm-only block, a
comment or a hidden callout. The site withholds the text after the
block too, to the next heading of the same or higher level. Show the
GM that text and ask: should it stay hidden? On yes, move the heading
out of the block, just above it. On no, move that text above the
block or under a heading the site shows. Edit only on an answer.

## TABLE_OVERWIDE

A table has a row with more cells than its header. The site widened
the table so no cell is lost; the extra columns have blank headings.
Per table, ask the GM what to call each extra column, then add those
header cells (and the matching `---` cells) in the note. Edit only on
an answer.

## PROP_NOT_COPIED

A prop note's file, its address or a file its page links cannot go on
the site. The note's own page still publishes, without the link to the
prop. The row names the note and says what is wrong; after the `—` it
says the fix. Work one note at a time: show the row's words, say what
you would change, and edit on a yes.

- **The prop file is not there, or is outside the note's folder:** look
  for a file of that name in the vault (`find "<vault>" -iname
  "<name>"`). An accented letter can be stored two ways, so if `find`
  gives nothing, list the likely folders and compare the names as they
  read. Offer to move the file beside the note; or, where it already
  sits in the note's folder or a folder under it, to correct
  `prop_file` to that path. Before a move, `grep -rlF "<name>"
  "<vault>"` for other notes that embed or link it; if any do, offer
  to copy it beside the note instead.
- **A kind the site does not copy:** a prop file is a page, a PDF or a
  picture. Where you can make one from the file (a text or Markdown
  handout as a page, say), offer to, and point `prop_file` at it on a
  yes. Ask the GM only for what only they have.
- **The address is taken, or `prop_address` is not a path the site can
  use:** offer a `prop_address` under `props/` that nothing else has,
  ending as the prop file does (`props/invitation.html`).
- **A file the prop's page links** (not there, outside its folder, a
  letter-case difference, an address starting with `/`): show the line
  of the page that links it. Offer to move the file beside the page, or
  into a folder under it, and correct the link to match. The page is
  the GM's own work: never edit it without saying exactly what changes.
- **A kind the page cannot link** (audio, video, a PDF, another page):
  show the line. A prop page cannot carry it, and the site publishes
  no audio, video or other page. A PDF can be a prop of its own: offer
  to make it one, a prop note (`shared/templates/prop.md`) beside the
  file with `prop_file` naming it, linked from this prop's note, and
  to take the link out of the page. A picture can take its place.
  Otherwise offer to take the link out of the page. Say exactly what
  changes and edit on a yes. Before making the note, ask whether
  players see the PDF too. On a no, write `publish: false` in it. On a
  yes, make it and check with `SITE explain "<new note>"`: if something
  holds it back (not on the publish list, or drafts hidden and its
  `canon_status: DRAFT`), say what, and on a yes run `SITE manifest
  apply --publish "<new note>"` or change the status.
- **Not really the kind its name says** (a `.png` that is a link to a
  note): offer to link the real file in its place.
- **Could not be read:** give the GM the file and the reason.
- **A link in the site folder:** a folder on the prop's address, in a
  kept folder of the site, is a link, so nothing is written through it.
  That is the site folder, not the vault. Tell the GM, and offer
  another `prop_address`.

Confirm each fix with `site-faults --file "<note>"`.

## Reporting

Log each finding with its resolution: fixed, fixed differently, or
`stays hidden` with the reason. Findings left for next time are
skipped, not dismissed. `stays hidden:` on the publish list is this
check's record of a no; do not also add a `QA-DISMISSED` comment.
