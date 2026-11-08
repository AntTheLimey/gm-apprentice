# Site Faults

Faults in the GM's notes that change what the published site shows.
The site's own publish tool finds them and the build warns about them;
this check fixes each one or asks the GM what the fix should be. Only
for a vault with a site.

```bash
gma vault-check "<vault>" site-faults
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
  `WITHHELD_PUBLISHED` are findings, walked in their sections):
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
  one each. The table below says how much each one matters. A row ends
  with the tool's fix, after a dash; offer it, in plain words.
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
| `COMPANION_FLAG_UNREADABLE` | Warning | The companion may be pictured on Story pages |
| `FENCE_UNCLOSED` | Critical | Hidden text is on the site now |
| `COMMENT_STRAY` | Warning | Text the GM wrote is missing from the site |
| `NAMED_NO_PAGE`, entity | Warning | Players read a name and cannot look it up |
| `NAMED_NO_PAGE`, working or no type | Info | A prep note's name is printed on the site |
| `TOHIT_UNREAD` (`WARNING`) | Warning | The to-hit calculator gives a row less than it should |
| `TOHIT_UNREAD` (`INFO`) | Info | A row's numbers do not add up, or it is written another way |
| `SKILL_BELOW_BASE` (`INFO`) | Info | A CoC skill is written below the base its characteristics give |
| `HEADING_IN_HIDDEN_BLOCK` (`INFO`) | Info | A hidden heading sits inside a hidden block, so the text after it is withheld |
| `TABLE_OVERWIDE` (`INFO`) | Info | A table row has more cells than its header, so the site widened the table |
| `MOMENT_KIND_UNKNOWN` | Warning | A moment's `#moment/` tag names no kind, so the card shows with none |
| `PROP_NOT_COPIED` | Warning | A prop's file, styled page, address or a file it links to is not on the site, or a prop sits outside its container |
| `CHAPTER_STATUS_UNKNOWN` | Warning | A chapter's Story page shows only its heading and sessions |
| `CHAPTER_NO_TEASER` | Warning | An active chapter's Story page shows no text |
| `CHAPTER_ACTIVE_MANY` | Warning | More than one chapter reads as the one being played |
| `CHAPTER_PLANNED_PLAYED` | Warning | Played sessions are missing from the Story |
| `CHAPTER_TITLE_SHARED` | Warning | Sessions of one chapter may be listed under the other |
| `SESSION_NO_CHAPTER` | Warning | A played session is missing from the Story |
| `CHAPTER_REF_UNSHOWN` | Warning | A played session is missing from the Story |

Three codes are walked in files of their own, in the `site-faults/`
folder beside this file. Read one only when a row of this run names its
code, before the first such row, and once a run:

- `NAMED_NO_PAGE`: `site-faults/named-no-page.md`
- `TOHIT_UNREAD`: `site-faults/tohit-unread.md`
- `PROP_NOT_COPIED`: `site-faults/prop-not-copied.md`

Every other code's section is below.

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
or the name of another page it links. Show the sentence and offer the
row's two fixes, reword or link it. In the title or a frontmatter field
rewording is the only fix.

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
row: the GM said never. Show the sentence and offer the row's fix. A
row ending "printed on the index or listing
page: …" comes from a frontmatter field: reword that field. If the GM
says the word no longer needs guarding, take it off the list on their
word: `gma publish settings remove player_site.never_show "<word>" --vault "<vault>"`.

## WITHHELD_IN_PROSE

A note marked `withheld: true` keeps its own name secret: its file
name, title and `aliases`. The row gives the page the name is on (an
attachment's path when the name is in a copied file's name), the name,
the withheld note, how often it is printed and the sentence. Offer the
row's fix, as for `ALIAS_IN_PROSE`; a linked withheld note prints a
neutral word in its name's place.
For an attachment, rename the file and the embeds that name it.

A name in plain text has no "leave it" answer, and `stays hidden:`
does not settle this row: the GM rewords the sentence, links the note
(the neutral word prints), or takes `withheld: true` off. When the fix
says the name is an everyday word, offer that fix. A rename:
`gma relink "<vault>" "<note>" "<new name>"` previews it, links included; on a yes,
again with `--apply`.

A row that says "in the address of a link" is a Markdown-style link
(`[x](Lord_Zorn.md)`): turn it into a `[[wiki-link]]` or plain words.
A row that says "link previews" or "search index" names a text the site
builds from the note's own fields: reword the field.

## WITHHELD_PUBLISHED

A note marked `withheld: true` is on the site under its name: the row
names its page and both fixes. Ask which was meant, and make that fix
on a yes; the publish-list one is `SITE manifest apply --exclude
"<note>"`.

## WITHHELD_NAME_PUBLIC

Offer the row's two fixes, and make the one the GM picks.

## WITHHELD_FLAG_UNREADABLE

Show the value (`tru`, a list) and ask the GM whether the note is
withheld; write `true` or `false` as they say.

## COMPANION_FLAG_UNREADABLE

A `companion:` value that is not true or false is read as not a
companion, so the NPC may be pictured on Story pages. Show the value and
propose `companion: true` or `companion: false` as the GM says.

## FENCE_UNCLOSED

A code fence opens and is never properly closed, so a hidden block
below it is published. The row gives the fence's line, the marker's,
and what a closing fence is. Read from the fence down, show the GM
where the code ends, and put a closing fence there on a yes.

## COMMENT_STRAY

A `%%` that is not a comment, or a comment (`%%`, `<!--`, a gm-only or
spoiler marker) left open in a frontmatter field. The row quotes the
line or the field and says what it hides. Read the line and propose
the part of the row's fix that fits what was meant (a percent sign, a
comment), any closing mark where the hidden words end. A `%%` in indented
text (four spaces or a tab) is a comment like any other. Only a fenced
code block shows one as written.

## NAMED_NO_PAGE

A published page names a note that has no page: an entity, a working
note, a note with no type, or a withheld note. Walked in
`site-faults/named-no-page.md`.

## TOHIT_UNREAD

A row of a GURPS PC's sheet that the to-hit calculator cannot fully
read. Walked in `site-faults/tohit-unread.md`.

## SKILL_BELOW_BASE

A Call of Cthulhu skill written lower than the base the PC's
characteristics give it (`Dancing | 05 | 10` with DEX 70, base 14).
Per PC, ask which of the row's two fixes the GM wants. On a raise, if
the Half and Fifth cells hold numbers, work them out again too. On
leave, log "left as written" and do not raise it again in the same
run.

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

A prop, its style, its address or a file its page links cannot go on
the site as written. Walked in `site-faults/prop-not-copied.md`.

## MOMENT_KIND_UNKNOWN

Per tag, ask the GM which of the five kinds the moment is, or whether to drop the tag; edit only on an answer.

## CHAPTER_STATUS_UNKNOWN

Ask whether the chapter is planned, active or complete; write that
word in `status:`. If the row's fix names `hide.fields` or
`publish_exclude_fields`, the note is fine: offer that fix once, for
all such rows.

## CHAPTER_NO_TEASER

The Teaser is the GM's own writing. Ask whether they want to write it
now; offer to help draft it from what players already know, but never
write one, or save a draft, without their words and their yes. Leaving
it for now is a fine answer. If the row says the Teaser is hidden, it
is written: offer the row's fix instead.

## CHAPTER_ACTIVE_MANY

The rows come together. Ask which chapter is being played; set each
other one to `complete` or `planned` as the GM says.

## CHAPTER_PLANNED_PLAYED

Show the sessions the row names; ask which fix fits and edit on the
answer.

## CHAPTER_TITLE_SHARED

Ask the GM for the new title; edit on the answer.

## SESSION_NO_CHAPTER

Ask the GM which chapter the session was played in, and write
`chapter: "[[<chapter note>]]"` on the answer.

## CHAPTER_REF_UNSHOWN

Rows naming one chapter come together. A misspelt link: propose the
chapter note it meant and fix the sessions' `chapter:` on a yes. A
chapter note kept off the site: ask whether it should publish.

## Reporting

Log each finding with its resolution: fixed, fixed differently, or
`stays hidden` with the reason. Findings left for next time are
skipped, not dismissed. `stays hidden:` on the publish list is this
check's record of a no; do not also add a `QA-DISMISSED` comment.
