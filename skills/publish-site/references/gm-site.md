# A GM Site for the Table

When the GM wants a copy of the site for themselves (every note and the
hidden parts, each marked with why players don't see it), run `gma publish settings set gm_site.publish=on --vault <vault>`: it
makes the GM site's folder beside the site folder, named after it with
`-gm` added, and from then on every build makes both sites. Build it now
with `gma publish build --site gm --config vault.config.json`, then run
`gma publish serve --background --config vault.config.json` as an
ordinary command (not one of your own background tasks): it starts the
server as a process of its own and returns. Give the GM the addresses it
prints to open on a phone or tablet at home. It keeps running when your
session or the terminal closes, until the GM asks you to stop it:
`gma publish serve --stop --config vault.config.json` stops it and says
the port is free. `serve --status` says whether it is running and where;
a second `--background` reports the running one. Never start it with a
plain `serve` in one of your background tasks: a host limit on those
stops the server mid-session. If `--background` refuses because one is
running "from a terminal or task", run `serve --stop`, then
`--background` again. On Windows, if `--status` later finds it gone
after your session ended, your host ends what its commands start: tell
the GM, and offer to start it again. Tell them it never goes online (`deploy` refuses
its folder) and that the site's build steps don't run for it: any it
needs go under `gm_site.before_build` or `gm_site.after_build`.
A session's Story page shows its wrap-up's Memorable Moments as cards
after the story, and on the GM site GM Notes follow the cards, with the
other hidden parts in place, marked. `player_site.story.moments` off
keeps the cards from players; the GM page still shows them, marked. A
session's Play Notes, Export and Table Log always get a page on the GM site.
