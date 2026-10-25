# Prop styles, containers and the props page

A prop note (`shared/templates/prop.md`) gets a page on the site in one
of two ways. A hand-made page, PDF or picture: `prop_file`. A page the
site builds from the note's own words: `prop_style`. Use a style when
the words are the GM's and one of the styles fits; use `prop_file` for
anything laid out by hand. Not both: `prop_file` wins and the build
warns.

## The words

The styled page prints what the players read under `## The Text`, as
the note page shows it (gm-only parts cut). Text is set as prose; a
section written as one quote prints without the quote marks. When the
whole section is one fenced block, it keeps its lines exactly: spacing,
capitals, line breaks.

## Starter styles

Each reads the fields named on its line.

- **terminal**: green screen, printable; `prop_device`, `prop_plate`,
  `prop_envelope`, `prop_frank`, `prop_frank_amount`, `prop_font`
- **form**: official hardcopy with a stamp; `prop_accent`,
  `prop_stamp`, `prop_plate`
- **hand**: handwritten folded scrap; `prop_font`, `prop_paper`,
  `prop_plate`
- **letter**: period letter in ink (Pinyon Script unless `prop_font`
  says otherwise); `prop_font`, `prop_plate`
- **clipping**: newspaper column; `prop_masthead`, `prop_dateline`
- **ticket**: card ticket with a stub; `prop_line_name`,
  `prop_serial`, `prop_class`
- **passport**: open data page, holder's name is the title;
  `prop_issuer`, `prop_number`
- **scroll**: parchment on rods; `prop_font`
- **decree**: bordered proclamation with a seal; `prop_issuer`,
  `prop_seal`

Each style's `style.json` says what its fields take. Every style also
reads:

- `prop_title`: the title the page prints (the note's name if empty).
- `prop_breaks`: a line start, or a list of them, that begins a new
  sheet.
- `prop_shift`: in a fenced section, the line start from which the hand
  changes (the hand style presses harder).
- `prop_font`: a Google Fonts family, where the style uses one.

## Containers

A `prop_kind: container` prop (a bookshelf, a strongbox) gets a page
listing what it holds: each prop whose `prop_container` links it. An
item players have not found is left off, unless the container says
`show_sealed: titles`: then its title alone shows (its `prop_title`,
else its name), so give it a title players may read. A withheld item
never shows. A container's `prop_style` must have an `{{{items}}}`
place; otherwise its page uses the site's look and the build warns.

## The props page

One page lists every prop the players have, under its container, its
`prop_group`, else its chapter, each with its `prop_line`. Its title,
address, cover and intro are `player_site.props.*`;
`player_site.landing.latest_props` adds a box to the landing page. A
prop shows when its note publishes: never edit the publish list to show
a prop.

## A vault's own style

A folder `_meta/prop-styles/<name>/` inside the vault (no link out)
holds `layout.html` and `style.css`, and may add `sheet.html` (one
sheet of the text), `style.json` (`title`, `about`, `fonts`, `fields`),
`script.js` (runs in the reader's browser only) and `assets/`
(pictures and fonts; `style.css` reaches them as `assets/<file>`). A
vault style named like a plugin style replaces it whole; the build
says so. Never edit a plugin style.

The layout is a fragment of the page body:

- `{{prop_x}}` prints a field as text; `{{{body}}}` the sheets,
  `{{{text}}}` one sheet's words, `{{{items}}}` a container's list.
  Other tool names: `title`, `note_title`, `sheet_number`,
  `sheet_count`, `first`, `last`.
  Only `body`, `text` and `items` take three braces.
- `{{#prop_x}}…{{/prop_x}}` shows its part only when the field is set
  (false or empty skips it). Inside a tag, a section holds whole
  attributes.
- Filters: `{{prop_x|color}}` and `{{prop_x|font}}` only inside
  `style="…"`; `{{prop_x|class}}` only inside `class="…"`.
- A field may never sit inside a tag outside a quoted value, in an HTML
  comment, in `<script>` or `<style>`, or as the value of `href`,
  `src`, `srcset`, `srcdoc`, `action`, `formaction`, `xlink:href`,
  `poster`, `background`, `data`, `style` or any `on…` attribute.
- A layout may not use `meta`, `base`, `link`, `object`, `embed`,
  `frame`, `frameset`, `applet`, `form`, `title`, `textarea`, `xmp`,
  `iframe`, `noembed`, `noframes`, `noscript`, `plaintext`, `template`,
  `svg` or `math`, partials, or `<!` other than a comment.

A style that breaks a rule is refused: the build names the file and
line, and the note page publishes without its prop.
