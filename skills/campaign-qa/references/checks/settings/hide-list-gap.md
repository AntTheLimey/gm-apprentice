## hide-list-gap

This one comes from the `settings` check (`gma vault-check "<vault>"
settings`, JSON `fault: "hide-list-gap"`), not from a note. It is a
`WARN` row that reads "`player_site.hide.sections` (or `.fields`) is
your own list and lacks ...". The GM's own list replaces the built-in
one, so each built-in entry it lacks shows on the site on any page that
has it, and nothing else warns. The row names each entry and what it is
for. A vault with no list of its own (it uses the built-in one) gets no
row; an empty list of its own does get one.

Report the row as High: GM-only text can reach players.

One row per list. Say it plainly: "your list of hidden details lacks
`voice` and `reliability`, so the site shows them on any page that has
them". Then ask, for each entry, one of two answers:

- **Add it to the list.** One `settings add` per list, with all the
  entries (it takes several):
  `gma publish settings add player_site.hide.fields "<entry>" "<entry>" --vault "<vault>"`
  (`player_site.hide.sections` for headings).
- **Record it as declined.** The GM means to leave it out of their own
  list. Naming it does not show it; it only stops this warning:
  `gma publish settings add player_site.hide.declined "<entry>" --vault "<vault>"`.

The GM can mix: add some, decline the rest.

Run `settings` again to confirm the row is gone. A second row,
"`player_site.hide.declined` holds ... in neither built-in list", is a
misspelling: show the GM the name and the built-in entry it is nearest
to, and `remove` it or replace it on their word.
