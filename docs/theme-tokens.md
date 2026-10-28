# Theme tokens

A theme can be a small stylesheet of custom properties and a few fonts.
The tool's own styles read their colours, typefaces, sizes, spacing and
corner radii from the custom properties on this page, so setting one
changes every place it is used. This page lists them, with what each
sets and its default. It goes with [Theme hooks](theme-hooks.md), the
list of the markup a theme can rely on.

## The promise

The same promise as the hooks: before a token on this page changes or
goes, a heads-up issue is opened for the tools known to build on these
pages (GM-Scriptorium among them), naming the token, what replaces it
and the release that carries the change. The tables below are written
from the one list the tool keeps (`tools/publish/lib/theme-tokens.js`),
and a test builds a site and fails when a listed token is not declared
with the default this page gives, or when the tool's stylesheets read a
custom property that is neither listed here nor named private
(`tools/publish/test/theme-tokens.test.js`).

Every default is the value the tool's own rule used before the value was
named, so a site that sets none of these looks exactly as it did.

## Setting them

Set a token in `:root` of a stylesheet the site links after the tool's
own: one listed under `player_site.theme.stylesheets`, or
`css/overrides.css`.

```css
:root {
  --accent: #c9a55a;
  --font-label: "Share Tech Mono", ui-monospace, monospace;
  --on-accent: #1a1410;
  --status-alive: #6b8f3c;
}
@media (prefers-color-scheme: light) {
  :root { --accent: #896714; }
}
```

- **Light and dark.** The tool's palette is dark first. Set the light
  palette inside `@media (prefers-color-scheme: light)`; the build also
  makes the block answer the reader's light and dark switch, as it does
  for the tool's own light rules.
- **Genre presets** set the palette and typeface tokens in their own
  `:root` (`css/themes/*.css`): they are worked examples of a theme.
- **Sheet skins** set the palette, the GURPS `--gc-*` hues and the Call
  of Cthulhu inks on the skinned page's `main.content`
  (`css/skins/*.css`), so a value set in `:root` does not reach a
  skinned sheet. Style a skinned sheet through
  `main.content[data-skin="…"]`.
- **Unset tokens** are declared nowhere. Each rule that reads one falls
  back to what it used before, so setting one changes those rules and
  leaving it unset changes nothing. `--font-label` is one: until a
  theme or `player_site.theme.fonts.label` sets it, the menu, labels,
  table heads, badges and buttons keep the face they have, whether they
  inherit it (from the body, a sheet, a backstory or a face your own
  stylesheet sets on a container) or set their own.

## The tokens

<!-- theme-tokens:palette -->

The colours every page is built from. A genre preset, a custom palette (theme.css) and a sheet skin all set these.

| Token | What it sets | Default |
|-------|--------------|---------|
| `--bg` | The page background | `#1a1f25` |
| `--bg-card` | Cards, panels and boxes | `#232830` |
| `--bg-header` | The menu bar | `#0d1117` |
| `--bg-hero` | The landing title area, and the shade behind a full-bleed hero's words | `#0d1117` |
| `--text` | Body text | `#c9d1d9` |
| `--text-muted` | Secondary text: captions, labels, dates | `#8b949e` |
| `--accent` | Links, headings' rules, active controls | `#58a6ff` |
| `--accent-dim` | A faint wash of the accent: hovered rows, badges | `rgba(88, 166, 255, 0.15)` |
| `--border` | Lines and edges | `#30363d` |
| `--danger` | Warnings that matter, wounds, low numbers | `#f85149` |
| `--warning` | Cautions, stubs, the GM site's band | `#d29922` |
| `--success` | Good news, live markers | `#3fb950` |

<!-- /theme-tokens:palette -->

<!-- theme-tokens:header -->

The menu bar and the landing title area stay dark in both palettes, so their words have inks of their own.

| Token | What it sets | Default |
|-------|--------------|---------|
| `--accent-on-header` | The accent on the dark menu bar and landing title area | `var(--accent)` |
| `--text-on-header` | Words on the menu bar and landing title area | Unset: `var(--text)` |
| `--text-muted-on-header` | Quieter words there: the menu's group names, the search button | Unset: `var(--text-muted)` |

<!-- /theme-tokens:header -->

<!-- theme-tokens:fonts -->

`player_site.theme.fonts.heading`, `body` and `label` write the first three into theme.css.

| Token | What it sets | Default |
|-------|--------------|---------|
| `--font-heading` | Headings and the site's name | `system-ui, -apple-system, sans-serif` |
| `--font-body` | Body text | `system-ui, -apple-system, sans-serif` |
| `--font-label` | The menu, labels, table heads, badges, buttons, meta lines and date labels | Unset: each element keeps the face it has: the one it inherits (the body face, or a sheet's, a backstory's or a site's own), or its own where a rule sets one |
| `--font-mono` | Numbers and code | `ui-monospace, "Cascadia Mono", "Segoe UI Mono", Menlo, Monaco, Consolas, monospace` |
| `--font-serif` | A story page's prose | `Georgia, "Times New Roman", serif` |
| `--font-reading` | A character's backstory and hook | `Georgia, 'Iowan Old Style', 'Times New Roman', serif` |

<!-- /theme-tokens:fonts -->

<!-- theme-tokens:size -->

Sizes that recur exactly in the site's own rules. The number is the size in thousandths of a rem: `--font-size-875` is 0.875rem. The character sheets keep their own sizes.

| Token | What it sets | Default |
|-------|--------------|---------|
| `--font-size-650` | Type size | `0.65rem` |
| `--font-size-700` | Type size | `0.7rem` |
| `--font-size-750` | Type size | `0.75rem` |
| `--font-size-800` | Type size | `0.8rem` |
| `--font-size-850` | Type size | `0.85rem` |
| `--font-size-875` | Type size | `0.875rem` |
| `--font-size-900` | Type size | `0.9rem` |
| `--font-size-950` | Type size | `0.95rem` |
| `--font-size-1000` | Type size | `1rem` |
| `--font-size-1100` | Type size | `1.1rem` |

<!-- /theme-tokens:size -->

<!-- theme-tokens:space -->

Margins, padding and gaps on a quarter-rem scale, in the site's own rules (not the sheets). The number is thousandths of a rem.

| Token | What it sets | Default |
|-------|--------------|---------|
| `--space-250` | Margin, padding or gap | `0.25rem` |
| `--space-500` | Margin, padding or gap | `0.5rem` |
| `--space-750` | Margin, padding or gap | `0.75rem` |
| `--space-1000` | Margin, padding or gap | `1rem` |
| `--space-1250` | Margin, padding or gap | `1.25rem` |
| `--space-1500` | Margin, padding or gap | `1.5rem` |
| `--space-2000` | Margin, padding or gap | `2rem` |

<!-- /theme-tokens:space -->

<!-- theme-tokens:radius -->

Corner radii that recur in the site's own rules. The number is thousandths of a rem.

| Token | What it sets | Default |
|-------|--------------|---------|
| `--radius-200` | Corner radius | `0.2rem` |
| `--radius-250` | Corner radius | `0.25rem` |
| `--radius-375` | Corner radius | `0.375rem` |
| `--radius-500` | Corner radius | `0.5rem` |
| `--radius-750` | Corner radius | `0.75rem` |

<!-- /theme-tokens:radius -->

<!-- theme-tokens:surface -->

| Token | What it sets | Default |
|-------|--------------|---------|
| `--on-accent` | Words on a control filled with the accent (a hovered pill, menu link or prop button, Begin, Send, back to top) | Unset: white on the story page's Begin button and the change-request Send button; `var(--bg)` on the other accent-filled controls |
| `--text-on-image` | Words laid over a picture: an entity page's banner, the lightbox | `#fff` |
| `--on-warning` | Words on the GM site's band | `#1a1a1a` |
| `--badge-draft` | The DRAFT badge | `#e8b84d` |
| `--story-muted` | The story page's small labels (read through `--muted` when that is set) | `#888` |
| `--quick-link-border` | The edge of a landing quick link (read through `--color-border` when that is set) | `rgba(0, 0, 0, 0.15)` |
| `--search-mark-bg` | The words a search matched | `rgba(88, 166, 255, 0.2)` |
| `--needs-dev-bg` | A "needs development" box | `rgba(210, 153, 34, 0.1)` |

<!-- /theme-tokens:surface -->

<!-- theme-tokens:state -->

The badges that say how a character, chapter or session stands.

| Token | What it sets | Default |
|-------|--------------|---------|
| `--status-alive` | The words of a status badge (alive) | `#3fb950` |
| `--status-alive-bg` | Its background | `rgba(46,160,67,0.2)` |
| `--status-dead` | The words of a status badge (dead) | `#f85149` |
| `--status-dead-bg` | Its background | `rgba(218,54,51,0.2)` |
| `--status-missing` | The words of a status badge (missing) | `#d29922` |
| `--status-missing-bg` | Its background | `rgba(210,153,34,0.2)` |
| `--status-captured` | The words of a status badge (captured) | `#a371f7` |
| `--status-captured-bg` | Its background | `rgba(130,80,223,0.2)` |
| `--status-presumed-dead` | The words of a status badge (presumed dead) | `#da6d6a` |
| `--status-presumed-dead-bg` | Its background | `rgba(218,54,51,0.15)` |
| `--status-retired` | The words of a status badge (retired) | `#8b949e` |
| `--status-retired-bg` | Its background | `rgba(110,118,129,0.2)` |
| `--status-kia-bg` | A KIA badge's background (its words are `--danger`) | `rgba(248, 81, 73, 0.15)` |
| `--status-mia-bg` | An MIA badge's background (its words are `--warning`) | `rgba(210, 153, 34, 0.15)` |
| `--chapter-complete` | A finished chapter's badge, and a played session's tick | `#50c878` |
| `--chapter-complete-bg` | A finished chapter's badge background | `rgba(80, 200, 120, 0.15)` |
| `--chapter-active-bg` | The current chapter's badge background | `rgba(184, 150, 46, 0.15)` |
| `--chapter-upcoming-bg` | A chapter to come: its badge background | `rgba(150, 150, 150, 0.15)` |
| `--tl-session` | A session's label on the timeline | `#3fb950` |
| `--tl-session-bg` | Its background | `rgba(46,160,67,0.2)` |

<!-- /theme-tokens:state -->

<!-- theme-tokens:lists -->

| Token | What it sets | Default |
|-------|--------------|---------|
| `--bestiary-edge` | The edge of a bestiary card | `#c0392b` |
| `--threat-extreme` | A "extreme" threat badge's words | `#e74c3c` |
| `--threat-extreme-bg` | Its background | `rgba(192, 57, 43, 0.2)` |
| `--threat-extreme-border` | Its edge | `rgba(192, 57, 43, 0.4)` |
| `--threat-high` | A "high" threat badge's words | `#e67e22` |
| `--threat-high-bg` | Its background | `rgba(230, 126, 34, 0.2)` |
| `--threat-high-border` | Its edge | `rgba(230, 126, 34, 0.4)` |
| `--threat-moderate` | A "moderate" threat badge's words | `#f1c40f` |
| `--threat-moderate-bg` | Its background | `rgba(241, 196, 15, 0.2)` |
| `--threat-moderate-border` | Its edge | `rgba(241, 196, 15, 0.4)` |
| `--threat-unknown-bg` | An unknown threat badge's background | `rgba(150, 150, 150, 0.15)` |
| `--creature-killed` | A "killed" creature badge's words | `#50c878` |
| `--creature-killed-bg` | Its background | `rgba(80, 200, 120, 0.15)` |
| `--creature-killed-border` | Its edge | `rgba(80, 200, 120, 0.3)` |
| `--creature-active` | An "active" creature badge's words | `#e74c3c` |
| `--creature-active-bg` | Its background | `rgba(192, 57, 43, 0.15)` |
| `--creature-active-border` | Its edge | `rgba(192, 57, 43, 0.3)` |
| `--creature-unknown-bg` | An unknown creature badge's background | `rgba(150, 150, 150, 0.1)` |
| `--bestiary-ability-bg` | A creature's ability pill | `rgba(184, 150, 46, 0.12)` |
| `--bestiary-ability-border` | Its edge | `rgba(184, 150, 46, 0.3)` |
| `--bestiary-weakness` | A creature's weakness pill: its words | `#50c878` |
| `--bestiary-weakness-bg` | Its background | `rgba(80, 200, 120, 0.1)` |
| `--bestiary-weakness-border` | Its edge | `rgba(80, 200, 120, 0.25)` |
| `--loc-type-bg` | A location's type badge | `rgba(184, 150, 46, 0.12)` |
| `--loc-type-border` | Its edge | `rgba(184, 150, 46, 0.25)` |
| `--intel-military` | A military faction's type badge: its words | `#9ab856` |
| `--intel-military-bg` | Its background | `rgba(107, 142, 35, 0.2)` |
| `--intel-corporation` | A corporation faction's type badge: its words | `#7ab4d9` |
| `--intel-corporation-bg` | Its background | `rgba(70, 130, 180, 0.2)` |
| `--intel-government` | A government faction's type badge: its words | `#a0b0c0` |
| `--intel-government-bg` | Its background | `rgba(112, 128, 144, 0.2)` |
| `--intel-other-bg` | Any other faction's type badge | `rgba(139, 148, 158, 0.15)` |
| `--intel-canon-bg` | A faction's leadership tag | `rgba(139, 148, 158, 0.1)` |
| `--armory-tl` | An item's tech-level tag: its words | `#9ab856` |
| `--armory-tl-bg` | Its background | `rgba(107, 142, 35, 0.2)` |

<!-- /theme-tokens:lists -->

<!-- theme-tokens:notfound -->

Its styles are written into the page itself, after every stylesheet, so a theme reaches its Home button through these two names rather than `--on-accent`.

| Token | What it sets | Default |
|-------|--------------|---------|
| `--theme-accent` | The page-not-found message and its Home button's fill | Unset: `var(--accent)` |
| `--white` | The words on the page-not-found Home button (the story page's Begin button reads it too, after `--on-accent`) | Unset: white (`#fff`) |

<!-- /theme-tokens:notfound -->

<!-- theme-tokens:hero -->

A full-bleed hero's words sit on a shade of `--bg-hero` and take a light ink. The two focus values are written by the build from `player_site.landing.hero.*`; a theme may set them instead.

| Token | What it sets | Default |
|-------|--------------|---------|
| `--hero-title` | A full-bleed hero's title, tagline and dates, over the shade behind them | Unset: `var(--text-on-image)` |
| `--hero-focus` | The part of the picture a full-bleed hero keeps in view | Unset: `center` |
| `--hero-focus-narrow` | The same, on a screen narrower than 768 pixels | Unset: `var(--hero-focus, center)` |

<!-- /theme-tokens:hero -->

<!-- theme-tokens:gurps -->

Each part of the sheet has its own hue, and a tint of it for row backgrounds. A sheet skin sets these.

| Token | What it sets | Default |
|-------|--------------|---------|
| `--gc-attr` | Attributes: headings, labels and edges | `#4ade80`; light `#15803d` |
| `--gc-attr-bg` | Attributes: row tint | `rgba(22, 163, 74, 0.14)`; light `#eafaf0` |
| `--gc-social` | Social traits: headings, labels and edges | `#fbbf24`; light `#b45309` |
| `--gc-social-bg` | Social traits: row tint | `rgba(217, 119, 6, 0.14)`; light `#fdf4e7` |
| `--gc-trait` | Advantages and disadvantages: headings, labels and edges | `#fb923c`; light `#c2410c` |
| `--gc-trait-bg` | Advantages and disadvantages: row tint | `rgba(234, 115, 23, 0.14)`; light `#fdf1e7` |
| `--gc-skill` | Skills: headings, labels and edges | `#818cf8`; light `#4f46e5` |
| `--gc-skill-bg` | Skills: row tint | `rgba(99, 102, 241, 0.14)`; light `#eef0fe` |
| `--gc-spell` | Spells: headings, labels and edges | `#a78bfa`; light `#7c3aed` |
| `--gc-spell-bg` | Spells: row tint | `rgba(139, 92, 246, 0.14)`; light `#f3eefe` |
| `--gc-table` | Weapon and equipment tables: headings, labels and edges | `#38bdf8`; light `#0369a1` |
| `--gc-table-bg` | Weapon and equipment tables: row tint | `rgba(2, 132, 199, 0.14)`; light `#e8f5fc` |
| `--gc-points` | The points summary: headings, labels and edges | `#94a3b8`; light `#475569` |
| `--gc-points-bg` | The points summary: row tint | `rgba(100, 116, 139, 0.12)`; light `#eef1f5` |
| `--gc-def` | Defences: headings, labels and edges | `#f87171`; light `#b91c1c` |
| `--gc-def-bg` | Defences: row tint | `rgba(220, 38, 38, 0.14)`; light `#fdecec` |
| `--gc-enc-0` | Encumbrance level 0 (level 1 has no tint) | `rgba(22, 163, 74, 0.10)`; light `#eafaf0` |
| `--gc-enc-2` | Encumbrance level 2 | `rgba(217, 119, 6, 0.10)`; light `#fdf4e7` |
| `--gc-enc-3` | Encumbrance level 3 | `rgba(234, 115, 23, 0.12)`; light `#fdf1e7` |
| `--gc-enc-4` | Encumbrance level 4 | `rgba(220, 38, 38, 0.14)`; light `#fdecec` |
| `--gc-dmg-bg` | The damage column of a weapon table | `rgba(2, 132, 199, 0.10)`; light `rgba(2, 132, 199, 0.08)` |
| `--gc-reeling` | The live panel's Reeling badge | `#f85149` |
| `--gc-reeling-bg` | Its background | `rgba(218,54,51,0.18)` |
| `--gc-tired` | The live panel's Tired badge | `#d29922` |
| `--gc-tired-bg` | Its background | `rgba(210,153,34,0.2)` |

<!-- /theme-tokens:gurps -->

<!-- theme-tokens:live -->

The GURPS and Call of Cthulhu party boards and their status badges.

| Token | What it sets | Default |
|-------|--------------|---------|
| `--live-reeling` | A Reeling badge on the party board | `#ef7c3a` |
| `--live-reeling-bg` | Its background, and the tint of a reeling row | `rgba(239,124,58,0.14)` |
| `--live-tired` | A Tired badge on the party board | `#5b9bd5` |
| `--live-tired-bg` | Its background, and the tint of a tired row | `rgba(91,155,213,0.15)` |
| `--live-bar-bg` | The track behind a points bar | `rgba(128,128,128,0.2)` |
| `--live-bar-third` | The one-third mark on a points bar | `rgba(255,255,255,0.3)` |
| `--live-bar-fp` | The fatigue bar | `#5b9bd5` |
| `--live-bar-san` | The Sanity bar | `#9d7bd8` |
| `--live-bar-mp` | The magic points bar | `#4ba3c7` |
| `--live-insanity` | A Call of Cthulhu "insanity" badge | `#b98be0` |
| `--live-insanity-bg` | Its background | `rgba(157,123,216,0.16)` |
| `--live-wound` | A Call of Cthulhu "wound" badge | `#e06b5c` |
| `--live-wound-bg` | Its background | `rgba(192,57,43,0.18)` |
| `--live-unconscious` | A Call of Cthulhu "unconscious" badge | `#d4a017` |
| `--live-unconscious-bg` | Its background | `rgba(212,160,23,0.18)` |
| `--live-dying` | A Call of Cthulhu "dying" badge | `#ff6b6b` |
| `--live-dying-bg` | Its background | `rgba(192,57,43,0.28)` |
| `--live-row-mad` | The tint of an insane investigator's row | `rgba(157,123,216,0.14)` |
| `--live-row-hurt` | The tint of a wounded investigator's row | `rgba(192,57,43,0.15)` |

<!-- /theme-tokens:live -->

<!-- theme-tokens:coc -->

The parchment sheet's inks and faces, declared on the sheet itself (`.coc-sheet-root`), so no other page sees them. A sheet skin sets the first ten.

| Token | What it sets | Default |
|-------|--------------|---------|
| `--paper` | The sheet's paper | `#e7ddc3` |
| `--paper-2` | Lighter paper | `#f3ecd8` |
| `--ink` | The ink | `#241d13` |
| `--ink-soft` | Softer ink | `#5a4b36` |
| `--ink-mid` | Faded ink: hints, small numbers | `#6f5c40` |
| `--rule` | Ruled lines and boxes | `#7c6a4d` |
| `--rule-soft` | Fainter rules | `#b6a483` |
| `--oxblood` | The red ink: headings, labels, filled marks | `#6e2318` |
| `--oxblood-2` | A second red | `#8a3222` |
| `--box` | Boxes and panels | `#fbf6e7` |
| `--didone` | The display face | `"Didot","Bodoni 72","Bodoni MT","Playfair Display","Hoefler Text","Georgia",serif` |
| `--body` | The text face | `"Baskerville","Libre Baskerville","Hoefler Text","Georgia","Times New Roman",serif` |
| `--on-oxblood` | Words on the red: the insane badge, Send, a lit condition, the open tab | `#f3e6df` |
| `--sheet-edge` | The sheet's and its dialog's outer edge | `#100c06` |
| `--portrait-mat` | The mat round the portrait | `#fbf6e7` |
| `--input-paper` | The change-request text box | `#fffdf6` |
| `--ink-live` | A change request the board has taken | `#3d6b3a` |
| `--oxblood-3` | The second stripe of the Sanity bar's fill | `#7c2a1e` |
| `--sanbar-from` | The Sanity bar's track, left | `#8a3b2c22` |
| `--sanbar-to` | The Sanity bar's track, right | `#8a3b2c0a` |
| `--tab-paper` | A closed folio tab, top | `#dccfae` |
| `--tab-paper-2` | A closed folio tab, bottom | `#d0c3a0` |

<!-- /theme-tokens:coc -->

## Not a token

These stay as written, and a theme that wants to change them restyles
the rule:

- **Print.** A printed page is black on white whatever the theme, and
  the GURPS sheet prints its light row tints.
- **Shadows and dark overlays**: drop shadows, the search and lightbox
  backdrops, the dark gradient under an entity page's banner title, and
  the plain dark shade a full-bleed hero falls back to in a browser
  without `color-mix()`. They are black at a strength, not a colour.
- **The Call of Cthulhu sheet's glazes**: the cream washes and inset
  highlights on its paper, drawn over whatever `--paper` is.
- **The party board's pulse**, an animation of the live marker.
- **A fallback after a token that is always declared**, such as the
  `#ccc` in `var(--border, #ccc)`: it is never used.
- **Sizes, spacing and radii off the scale**, and every size inside the
  character sheets, which keep their own.
- **Custom properties named private** in the list (the connections web's
  worked-out inks, a GURPS block's copied hue, a skin's workings, and
  older names a rule still reads before its listed token): any of them
  may change in any release.
