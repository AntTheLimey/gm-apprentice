# Making a Prop

A prop is a note in its chapter's `Props/` that the site turns into a
page players can read and print. Write the words first
(`handouts-and-props.md`), then make the page.

## 1. Style or hand-made page

Use a style when the words are the GM's and one fits; the GM's own
styles in `_meta/prop-styles/` count. The starter styles:

- **terminal**: green-phosphor screen, prints as paper; can come with
  its envelope
- **form**: official hardcopy with a filing bar and rubber stamp
- **hand**: a handwritten scrap, folded, printed to cut out
- **letter**: a period letter in ink, one sheet per page
- **clipping**: a newspaper column with masthead and dateline
- **ticket**: a card ticket with serial number and stub
- **passport**: an open data page; the holder's name is the title
- **scroll**: parchment on rods in an old hand
- **decree**: a bordered proclamation with a wax seal

Anything laid out by hand is a hand-made page: an HTML page you write
beside the note (`--file`; step 5).

## 2. File it

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/vault_write.py" \
  <vault> prop-new --chapter "<chapter>" --title "<title>" \
  --style <style> --hand <id> --scene "<scene>"
```

`--file <page>.html` in place of `--style`; `--kind` when it is not a
document (object, diagram, supplied, container); `--container "<note>"`
when it sits in one. Show the dry run; `--write` on the GM's yes.

## 3. The words

The players' words go under `## The Text`. Where the lines must stay
exactly as written (a terminal, a form, a hand, a ticket), make the
whole section one fenced block. What only the GM knows goes under
`## GM Notes`; inside a hand-made page, between `<!-- gm-only -->` and
`<!-- /gm-only -->`.

## 4. One hand per writer

Read `_meta/prop-hands.json` (`{"hands": {"<id>": {"font", "who"}}}`).
A writer who has a hand reuses it. A new writer gets a new id with
`--hand-font "<Google Fonts family>"` and `--hand-who "<who wrote it>"`;
`who` is never published. An id never names a writer the players must
not learn (`unsigned-1`, not the culprit's name). The same hand on two
props tells a careful reader one person wrote both.

## 5. A hand-made page

Print rules, in its `<style>`:

```css
@page { size: auto; margin: 0; }
.sheet { break-after: page; print-color-adjust: exact; }
```

One `.sheet` per printed page. Furniture that sells it: a rubber stamp,
a wax seal, a pinned note, a margin note in another hand, `<del>` for a
struck word, fold marks, a small inline SVG sketch. Files the page
links (pictures, fonts) sit beside it or in a folder under it.

## 6. Check

Build the site, then:

```bash
npx gm-apprentice-publish props pages \
  --config <site>/vault.config.json props/<name>.html
```

The count should equal the sheets the GM meant. Until the note
publishes, it says `not built`: check again once it is on the site.

## 7. Publishing

Never edit the publish list. Wrap-up's reveal step publishes the prop
when the players get it.
