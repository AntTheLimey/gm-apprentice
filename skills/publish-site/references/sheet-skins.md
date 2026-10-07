# Sheet skins and frames

A **skin** is the dress of a PC page: colours, lettering, edging and
the shape of its marks. A **frame** is the ornament round the
portrait. Neither changes a sheet's layout, on any of the five systems.

| Where | Key | Values | Absent means |
|-------|-----|--------|--------------|
| `_meta/vault-config.md`, under `publish:` | `sheet_skin` | a skin id | `plain` |
| same | `sheet_frame` | a frame id, or `none` | the skin's own frame |
| a `type: pc` note's frontmatter | `sheet_skin` | a skin id | the campaign's |
| same | `sheet_frame` | a frame id, or `none` | the campaign's, else the skin's own |

Skin and frame are settled separately, so a PC note may set either
key alone: `sheet_frame: cracked` keeps the campaign's skin.

## Skins

Plain is the default: a site that sets nothing builds as before.
Every other skin has a light and a dark look and follows the reader's
light or dark choice. Describe both; the GM may be seeing either.

| Skin id | What it looks like | Suits | Its own frame |
|---------|--------------------|-------|---------------|
| `plain` | The sheet as it has always been, in the site's own colours and fonts | Any game | `none` |
| `parchment` | An old manuscript: double-ruled boxes, old book lettering, a coloured first letter. Light: cream vellum, dark ink, deep red. Dark: dark brown, pale ink, soft terracotta | Fantasy, myth and medieval games | `laurel` |
| `case-file` | A folder of typed pages: typewriter lettering, folder tabs, a red stamp. Light: off-white pages on manila, navy accents. Dark: brown-grey pages on a darker folder, pale ink, pale blue accents | Investigation, horror, espionage and modern games | `corners` |
| `console` | An instrument panel on a faint grid: boxes with cut corners and a lit top edge, squared lettering, bar-shaped marks. Dark: near-black with cyan, and the marks glow. Light: pale grey with teal, no glow | Science fiction, cyberpunk and near-future games | `hex` |
| `ledger` | An account book: brass corners on every box, a ruled margin down the D&D, Pathfinder and FitD boxes, small-capital serif lettering. Light: cream pages on brown leather. Dark: dark brown pages on near-black leather, pale ink, brass-gold accents | Heists, intrigue, trade and period drama | `gilt` |

A skin's typefaces are downloaded once, by the first build that uses
it, and served from the site (readers never contact Google). With no
network that build uses fallback lettering and warns once; rebuild
with network to put it right. The typefaces are kept in the vault's
`_meta/font-cache/` folder (about 1.4 MB for all four skins), so a
vault held in git or a sync service will show them as new files.

## Frames

Any frame goes with any skin, Plain included, and takes its colours
from it.

| Frame id | Picture shape | What it looks like |
|----------|---------------|--------------------|
| `ring` | Circle | Two plain rings |
| `laurel` | Circle | A wreath of leaves |
| `thorns` | Circle | A ring of spikes |
| `gilt` | Circle | A beaded ring with four jewels |
| `steel` | Octagon | A riveted plate |
| `corners` | Square | A thin rule with solid corner pieces |
| `hex` | Hexagon | A double hexagon with tick marks |
| `cracked` | Circle | A broken, cracked ring |
| `none` | As today | No frame; it turns off a skin's own frame |

A framed portrait is cropped square on every system; with no portrait
the frame holds the PC's initials. `none` leaves the portrait as it
was, CoC's tall photograph included.

## Setting it

The GM asks in their own words ("give the sheets a parchment look").
You set the value and rebuild; the GM is never asked to edit a file or
run a command. If they are unsure, offer the skin that suits the game.
For the campaign, from the site directory:

```bash
npx gm-apprentice-publish vault-setting --set sheet_skin='"parchment"'
npx gm-apprentice-publish vault-setting --set sheet_frame='"thorns"'
```

The command writes only its own line, and takes only the exact
lower-case id. To go back to the skin's own frame, remove the
`sheet_frame` line. For one character, set the two lines in that PC
note's frontmatter. Then `npm run build` and deploy as usual.

A value that is not a known id is ignored: the build prints one
warning naming the note (or the config) and the value, and that
setting falls back one step (a PC's to the campaign's, the campaign's
to the default). The build ignores case and surrounding spaces.

## Known limits

Tell the GM the one that applies when they choose:

- A skin dresses PC pages only, on screen only. NPC pages, the roster,
  the party board, the nav and footer keep the site's theme. On paper
  a sheet prints as it always has, and a framed portrait prints
  without its ornament, as the plain portrait.
- A dialog opened from the site's own controls (History) keeps the
  site's theme, so it can open light over a dark skin.
- A rule in the GM's own `overrides.css` that restyles a sheet box may
  lose to a skin on a dressed page.
- Console cuts the corners off each box; anything hanging over a
  corner is clipped.
- CoC's corner and flourish ornaments are hidden under Console and
  Case file, kept under Parchment and Ledger.
- GURPS's eight category colours are muted to suit each skin: still
  distinct, but closer together than in Plain.
- The set is fixed: no GM-made skins, no per-character colour.
