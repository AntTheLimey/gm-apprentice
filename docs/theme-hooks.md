# Theme hooks

A theme built on top of the published pages needs to know which parts of
the markup it can rely on. This page lists them. Anything a page carries
that is not listed here is incidental: it may be renamed, moved or
dropped in any release, with no warning.

## The promise

Before a hook on this page changes or goes, a heads-up issue is opened
for the tools known to build on these pages (GM-Scriptorium among them),
naming the hook, what replaces it and the release that carries the
change. The list below is kept true by a test that builds a site and
fails when any listed hook leaves the output
(`tools/publish/test/theme-hooks.test.js`), and its tables are written
from the same list the test reads (`tools/publish/lib/theme-hooks.js`).

## Adding your own stylesheets

`player_site.theme.stylesheets` links your own stylesheets on every page
of the player site and the GM site, after the tool's own and before
`css/overrides.css`, in the order you list them. `css/overrides.css`
stays the site's last word. See [Site settings](site-settings.md#theme).

```yaml
player_site:
  theme:
    stylesheets:
      - _meta/theme/paper.css
    hooks: on
```

## On every site

These classes are on every site's pages, with nothing to turn on.

<!-- theme-hooks:always -->

| Hook | What it marks | Example |
|------|---------------|---------|
| `main.content` | The page's main column, on every page | `main.content { max-width: 52rem; }` |
| `header.top-nav` | The site's menu bar at the top of every page | `header.top-nav { border-bottom: 1px solid currentColor; }` |
| `nav.breadcrumbs` | The trail of links above a note's title | `nav.breadcrumbs { font-size: 0.85rem; }` |
| `.page-title` | The title of a section list, a story page or a plain note page (an `<h1>`) | `h1.page-title { letter-spacing: 0.05em; }` |
| `.metadata-badge[data-field]` | One fact in a note's header; `data-field` names the field it shows (`event_type`, `in_game_date`, `session_number` ...) | `.metadata-badge[data-field="in_game_date"] { font-style: italic; }` |
| `.landing-hero` | The landing page's title area: the campaign picture, title, tagline and dates | `.landing-hero h1 { font-size: 3rem; }` |

<!-- /theme-hooks:always -->

## With `player_site.theme.hooks` on

These attributes are written only when `player_site.theme.hooks` is on.
They sit on markup the tool already writes: no wrapper is added, so
nothing on the page moves. They are off by default because a tool that
reads the pages as text, matching `<h2>` or `<h1 class="page-title">`
exactly, would stop matching once an attribute is added; with the switch
off, every page is byte for byte what it was. A downstream tool turns it
on once its own matchers are ready for the attributes. The GM site
follows the player site's switch unless `gm_site.theme.hooks` sets its
own.

<!-- theme-hooks:switch -->

| Hook | What it marks | Example |
|------|---------------|---------|
| `main[data-page-type]` | The kind of page: a note's own `type` (`npc`, `pc`, `location`, `session` ...), or `landing`, `index` (a section's list), `story`, `timeline`, `props`, `prop-container` or `not-found` for a page the tool makes; `page` for a note with no type | `main[data-page-type="npc"] { --accent: #7a3b2e; }` |
| `[data-title-block]` | The block that holds the page's title and the facts beside it (a note's header card or banner, the landing title area); on a page with no such block, the title itself | `[data-title-block] { margin-bottom: 2rem; }` |
| `h1[data-page-title]` | The page's title | `h1[data-page-title] { font-variant: small-caps; }` |
| `p[data-first-paragraph]` | The first paragraph of a note's own text (not on a character page, which is laid out as a sheet) | `p[data-first-paragraph]::first-letter { font-size: 3em; float: left; }` |
| `h2[data-section]` | Each section heading; `data-section` is a key made from the heading's words, lower case, joined by hyphens (`## Current Status` is `current-status`) | `h2[data-section="gm-notes"] { color: #900; }` |

<!-- /theme-hooks:switch -->

A section is not wrapped in an element of its own, so a rule that styles
a section's text reaches it from its heading, for example
`h2[data-section="rumours"] + p`.

## What is not safe to style

- Any class or attribute not listed above. Layout classes such as
  `hero-cinematic`, `char-header`, `pc-tab` or `cx` exist to lay the page
  out and change when the layout does.
- The order and nesting of elements inside a listed block, beyond what
  the table says.
- The character sheets' inner markup (`coc-sheet-root`, `gurps-sheet` and
  the rest), and the styled prop pages, which carry their own
  stylesheets and none of the site's.
- Anything the page's own scripts add or change after it loads.
