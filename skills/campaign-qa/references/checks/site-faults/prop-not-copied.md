## PROP_NOT_COPIED

Part of the Site Faults check. Read `site-faults.md` (the folder's
neighbour) first: it says what `SITE` means and how a fix is put to the
GM.

A prop note's file, its style, its address or a file its page links
cannot go on the site as written, its kind is unknown, or its container
cannot list it. The note's own page still publishes, without the link
to a prop that is not on the site; a misplaced item is listed on its
own. The row names the note and says what is wrong; after
the `—` it says the fix. Work one note at a time: show the row's words,
say what you would change, and edit on a yes. Styles and containers:
publish-site's `references/prop-styles.md`.

Offer each row's fix as it reads. Where the fix is not all of it:

- **The prop file is not there, or is outside the note's folder:** look
  for a file of that name in the vault (`find "<vault>" -iname
  "<name>"`). An accented letter can be stored two ways, so if `find`
  gives nothing, list the likely folders and compare the names as they
  read. Where it already sits in the note's folder or a folder under
  it, offer to correct `prop_file` to that path. Before a move,
  `grep -rlF "<name>" "<vault>"` for other notes that embed or link it;
  if any do, offer to copy it beside the note instead.
- **A kind the site does not copy:** where you can make a page, PDF or
  picture from the file (a text or Markdown handout as a page, say),
  offer to, and point `prop_file` at it on a yes. Ask the GM only for
  what only they have.
- **The address is taken:** offer a `prop_address` under `props/` that
  nothing else has, ending as the prop file does
  (`props/invitation.html`).
- **A file the prop's page links** (not there, outside its folder, a
  letter-case difference, an address starting with `/`): show the line
  of the page that links it. A folder under the page's will do as well
  as beside it. Where the file is already there (a letter-case
  difference, or the same file reached by another path), correct the
  link to match instead: moving it can break other notes. The page is
  the GM's own work: never edit it without saying exactly what changes.
- **A kind the page cannot link** (audio, video, a PDF, another page):
  show the line. To make a PDF a prop of its own: a prop note
  (`shared/templates/prop.md`) beside the file with `prop_file` naming
  it, linked from this prop's note, and the link taken out of the page.
  Say exactly what changes and edit on a yes. Before making the note,
  ask whether players see the PDF too. On a no, write `publish: false`
  in it. On a yes, make it and check with `SITE explain "<new note>"`:
  if something holds it back (not on the publish list, or drafts
  hidden and its `canon_status: DRAFT`), say what, and on a yes run
  `SITE manifest apply --publish "<new note>"` or change the status.
- **An unknown `prop_kind`:** offer the listed kind that fits what the
  note describes.
- **The style is unknown or cannot be used:** for a vault style, show
  the line of the file the row names (save it as UTF-8 on a yes, where
  that is the fault). A style not in the vault's `_meta/prop-styles/`
  is the plugin's: never edit it, whatever the row's fix says; tell the
  GM to reinstall the plugin.
- **The style leaves out assets** (the page is still built): show the
  line of `style.css` that wants each one, if any. Besides moving a
  picture or font out of a subfolder directly into `assets/`, a link to
  nothing can point at the real file, and an `assets` file can become a
  folder.
- **An unknown `prop_hand`, or a broken `_meta/prop-hands.json`:**
  offer to correct `prop_hand`, to add the hand with `gma vault-write "<vault>" prop-hand --hand <id> --hand-font "<family>"`, or to mend the
  entry or JSON the row names. Ask the GM for the font; never pick one
  for them.
- **Both a prop_file and a prop_style:** ask which the GM wants.
- **No ## The Text (or none players see):** offer to add the section
  with the words from the note; ask for any the GM has not written.
- **A link in the site folder:** that is the site folder, not the
  vault: a folder on the prop's address (or on a style file's), in a
  kept folder of the site, is a link, so nothing is written through it.
  Tell the GM.

Confirm each fix with `site-faults --file "<note>"`.
