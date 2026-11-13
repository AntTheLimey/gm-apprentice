## hide-list-gap

Part of the Site Faults check. Read `site-faults.md` (the folder's
neighbour) first: it says how a fix is put to the GM.

This one comes from the `settings` check (`gma vault-check "<vault>"
settings`, JSON `fault: "hide-list-gap"`), not from a note. It is a
`WARN` row that reads "`player_site.hide.sections` (or `.fields`) is
your own list and lacks …". The GM's own list replaces the built-in
one, so each built-in entry it lacks shows on the site wherever a page
names it, and nothing else warns. The row names each entry and what it
is for. A list with no entries of its own gets no row.

One row per list. Say it plainly: "your list of hidden details lacks
`voice` and `reliability`, so a page that names them shows them". Then
ask, per list:

- **Add them all.** One yes, then run once per entry:
  `gma publish settings add player_site.hide.fields "<entry>" --vault "<vault>"`
  (`player_site.hide.sections` for headings).
- **Show one on purpose.** For each entry the GM wants shown, name it
  in `player_site.hide.keep_showing`:
  `gma publish settings add player_site.hide.keep_showing "<entry>" --vault "<vault>"`.
  The GM can mix: add some, keep some. Add the rest.

Run `settings` again to confirm the row is gone. A second row, "`player_site.hide.keep_showing` holds … in neither built-in list", is a
misspelling: show the GM the name and the built-in entry it is nearest
to, and `remove` it or replace it on their word.
