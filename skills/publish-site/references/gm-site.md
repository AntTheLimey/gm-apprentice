# A GM Site for the Table

When the GM wants a copy of the site for themselves (every note and every
hidden part, each marked with why players don't see it), run `node
"$TOOL" settings set gm_site.publish=on --vault <vault>`: it
makes the GM site's folder beside the site folder, named after it with
`-gm` added, and from then on every build makes both sites. Build it now
with `node "$TOOL" build --site gm --config vault.config.json`, start
`node "$TOOL" serve --config vault.config.json` in the background, and
give the GM the addresses it prints to open on a phone or tablet at home
(it runs until stopped). Tell them it never goes online (`deploy` refuses
its folder) and that the site's build steps don't run for it: any it
needs go under `gm_site.before_build` or `gm_site.after_build`.
