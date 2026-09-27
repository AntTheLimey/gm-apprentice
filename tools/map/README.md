# Map builder (work in progress)

An interactive 3D campaign map built from a vault's location notes. This is
the start of issue #250. It is space-only for now: star systems, gates, lanes
and orbits.

It began as the reference build for one GURPS space campaign, which is live
as a player build. What changed on the way in:
- Campaign secrets and campaign-specific wording were taken out.
- The runner route, the Keeper keyword and the page wording now come from
  config.
- The builder takes `--vault`, `--layout` and `--out` options.

## Run it

```bash
python3 tools/map/build_map.py --vault VAULT            # GM copy, Keeper layer behind a keyword
python3 tools/map/build_map.py --vault VAULT --player   # player-safe copy
```

- **Dependencies:** Python 3 and PyYAML. Pillow is optional: without it,
  portrait art and palettes are skipped.
- **Network:** the page loads three.js from jsDelivr and fonts from Google
  Fonts, so it needs a connection when opened.
- **Output:** by default the builder writes `VAULT/_meta/map/star-map.html`
  (or `star-map-player.html`) and caches processed art in
  `VAULT/_meta/map/.cache/`.
- **Layout:** it reads `VAULT/_meta/map/layout.json`. Start from
  `layout.example.json`.
- **Debug:** add `?debug` to the page URL to expose `window.__map`, which
  includes `simStep` and `populate` for driving the traffic sim by hand.

## Inputs

- **`Locations/*.md`:**
  - `location_type` and `parent_location` for containment;
  - `portrait`;
  - `## Overview` prose, which drives the surface traits;
  - `## Appearances` "Session N" lines;
  - Keeper callouts, `secrets:` and `<!-- gm-only -->` blocks, all of which
    are removed by `--player`.
- **Session notes:** `route: ["[[Place]]", ...]`, the places the party went,
  in order.
- **The crew-ship note named in the layout:** `current_location`,
  `arriving_from` and `destination`.
- **`_meta/publish-manifest.md`:** Locations listed under `## Excluded` are
  dropped from the player build.

## Files

| File | Role |
|---|---|
| `build_map.py` | Reads the vault and writes a self-contained HTML page |
| `star-map.template.html` | Three.js page: three skins, traffic sim, Keeper layer, UI |
| `layout.example.json` | What the vault has no field for: positions, inferred lanes, anchors, page wording, Keeper overlay |
| `site-postbuild.mjs` | Stopgap site postbuild that publishes the player map at `docs/map/`. `deploy` skips it (#248) |
| `tests/fixture-vault/` | Small fictional vault: three systems, a hidden gate, Keeper and gm-only text, a `publish: false` note |

## Not done yet

The full list is in #250. The main gaps:
- No automated tests yet. Wanted:
  - trait parsing, including the false positives listed in #250;
  - gate pairing;
  - a player-build leak scan;
  - manifest exclusion.
- Space-only hierarchy. Other genres need a region and road model, and skins
  to match.
- Region positions are hand-tuned in the layout.
- Traffic profiles and faction names are space-flavoured.
- Sessions are sorted by `session_number` alone (one chapter).
- Map building belongs inside `tools/publish`, not in a site postbuild.
- session-wrapup should write `route:` and the vehicle's position fields.
- campaign-organizer should document both fields, with a migration entry.
- The Keeper layer is base64, so it keeps casual readers out and nothing
  more. The `--player` build is the real protection.
