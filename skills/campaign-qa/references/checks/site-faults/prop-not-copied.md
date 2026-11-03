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
- **An unknown `prop_kind`** (the prop is read as a document): offer
  the listed kind that fits what the note describes.
- **The style is unknown or cannot be used** (not a style name, not
  one there is, a file missing, outside its folder, refused, unreadable
  or not UTF-8, `_meta/prop-styles` not a readable folder, or a
  container's style with no `{{{items}}}` place): the row names the
  style and the file; offer one of the styles the row lists, or show
  the line of the vault style it names and offer the fix (save a vault
  style file as UTF-8 on a yes), or, for a container, remove
  `prop_style`; never edit a plugin style. A plugin style that cannot
  be read: tell the GM to reinstall the plugin.
- **The style leaves out assets** (the page is still built): for each
  one the row names, offer to move a picture or font out of a subfolder
  directly into `assets/`, point a link to nothing at the real file,
  make an `assets` file a folder, or remove a kind a style does not
  copy; show the line of `style.css` that wants it, if any.
- **An unknown `prop_hand`, or a broken `_meta/prop-hands.json`:**
  offer to correct `prop_hand`, to add the hand with `vault_write.py
  "<vault>" prop-hand --hand <id> --hand-font "<family>"`, or to mend the
  entry or JSON the row names. Ask the GM for the font; never pick one
  for them.
- **Both a prop_file and a prop_style:** ask which the GM wants; remove
  the other on a yes.
- **No ## The Text (or none players see), or a prop_container that is
  not a container:** offer to add the section with the words from the
  note (ask for any the GM has not written), or to correct
  `prop_container` / make the named note a container.
- **A prop that names itself as its container:** offer to correct or
  remove `prop_container`.
- **A link in the site folder:** a folder on the prop's address (or on
  a style file's), in a kept folder of the site, is a link, so nothing
  is written through it. That is the site folder, not the vault. Tell
  the GM, and offer another `prop_address`, or for a style file to
  replace the link with a real folder.

Confirm each fix with `site-faults --file "<note>"`.
