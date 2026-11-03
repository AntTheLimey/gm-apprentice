## NAMED_NO_PAGE

Part of the Site Faults check. Read `site-faults.md` (the folder's
neighbour) first: it says what `SITE` means and how a fix is put to the
GM.

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
print a neutral word. Offer to turn them into words the GM agrees, with
the row's command. If the neutral word will do, that is a
"stays hidden" for this row only, recorded as under "On no" below: it
settles the link report and nothing else. Skip steps 1 to 4 below.

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
   previews every link to the note on that page, one `WOULD-CHANGE`
   row each. Only the telling ones change: run it again with
   `--pick N` for each of those rows (counted from 1, in the order
   printed) and `--write`, so a harmless link keeps its destination.
   Where two notes share the name, give the note's vault path as the
   name. A link that gives no path then prints as `KEPT`: read each
   line, and when it means this note add `--bare`.
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

- **Plain words.** The row's command turns the links on the pages that
  name it into their words (`--in` again for each page). A link with
  its own wording keeps it. Where a link has none and the
  note's name would read as a file name (`Scene 02 Quay`), add
  `--as "<words>"` with wording the GM agrees. Where two notes share
  the name, a link with no path prints as `KEPT`, and `--bare` turns
  it once the GM has agreed it means this note. It
  changes every link to the note on those pages, hidden parts
  included; where the GM wants a link kept, add `--pick N` for each
  row to change instead.
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
