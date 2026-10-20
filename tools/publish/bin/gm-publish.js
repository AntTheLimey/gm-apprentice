#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const { NEW_FILE, OLD_FILE } = require('../lib/settings/layout');

// Exit once stdout and stderr have drained. On a pipe (macOS; Linux too for
// large writes) Node writes asynchronously, and a bare process.exit() right after
// a big console.log drops everything past the 64 KB pipe buffer: `explain --all
// --json | …` came back cut off at 65,529 bytes, so vault_check could not read it
// (#279). A write's callback runs after every write queued before it.
function exitAfterFlush(rc) {
  process.exitCode = rc;
  let pending = 2;
  const done = () => { if (--pending === 0) process.exit(rc); };
  process.stdout.write('', done);
  process.stderr.write('', done);
}

function failAfterFlush(err) {
  console.error(err.message);
  exitAfterFlush(1);
}

const args = process.argv.slice(2);
const command = args[0];

function printHelp() {
  console.log(`
gm-apprentice-publish - Static site generator for gm-apprentice campaign vaults

Usage:
  gm-apprentice-publish init [target-dir]    Scaffold a new site
  gm-apprentice-publish build [options]      Build the site (--site player|gm)
  gm-apprentice-publish serve [options]      Serve a built site to the home network (--site gm|player)
  gm-apprentice-publish inbox <cmd> [args]   Change-request queue (used by the loop)
  gm-apprentice-publish flush [options]      Write players' current KV live-state back into the vault sheets
  gm-apprentice-publish sheet show [options] Print one PC's sheet (--player-safe shows only what players see)
  gm-apprentice-publish update-pin [options] Repoint this site at the newest installed build tool
  gm-apprentice-publish manifest <cmd>       Compare the publish manifest with the vault, or update it
  gm-apprentice-publish leaks <cmd>          Check the built player site for hidden text (list, check, accept, prune, settle)
  gm-apprentice-publish relationships <cmd>  The relationship words, short (words); every relationship rule checked (check); the tones listed (list); the certain repairs (fix)
  gm-apprentice-publish deploy [options]     Build, deploy to the configured host, and verify the URL
  gm-apprentice-publish explain <path>       Say why one vault file does or does not publish
  gm-apprentice-publish lines                Answer what publishes, for text on stdin (used by vault_check)
  gm-apprentice-publish settings <cmd>       Read, set, describe and check any site setting
  gm-apprentice-publish doctor [options]     Preflight: check tools/auth (--site audits the vault)
  gm-apprentice-publish setup-status-bar     Enable live stats (KV + deploy)
  gm-apprentice-publish setup-inbox          Enable the inbox (KV + deploy)
  gm-apprentice-publish --version            Show version
  gm-apprentice-publish --help               Show this help

Build options:
  --config <path>    Path to vault.config.json (default: ./vault.config.json)

Flush options:
  --config <path>    Path to vault.config.json (default: ./vault.config.json)
  --dry-run, -n      Report what would change in each sheet without writing

Every subcommand accepts --help / -h.
`);
}

// Per-subcommand usage. `gm-apprentice-publish <cmd> --help` prints the entry for
// <cmd> — never the top-level banner — so the CLI, not the skill prose, is the
// reference for what each command accepts.
const SUBCOMMAND_HELP = {
  init: `
gm-apprentice-publish init [target-dir] [--vault <dir>] [--title <text>] [--tagline <text>]

Scaffolds a new site in target-dir (default: the current directory):
package.json pinned to this tool, vault.config.json (the path to the
vault, nothing else), README.md, css/overrides.css, .gitignore, wrangler.toml,
and .nojekyll. Refuses to overwrite — if any of those files already
exists, nothing is written.

The campaign settings (site title, folder map, attachments folder,
hidden folders, callout rule) go in the vault's ${NEW_FILE}, for each
setting the file does not already set. A vault still on ${OLD_FILE}
is not touched: init stops and names the update to run first. The vault is ./vault beside the site unless
--vault names it. If the vault folder is not there yet, or its settings
file cannot be edited safely, the site is still scaffolded and the
settings to add are printed.
Follow with "build" to generate the site.

  --vault <dir>      The vault, read relative to where you run this. Recorded as
                     vaultPath (relative to the site if inside it, else absolute)
                     and given the settings
  --title <text>     The site title (player_site.title), instead of "My Campaign"
  --tagline <text>   The landing-page tagline (player_site.theme.tagline); other
                     theme keys are kept
                     Both are written only where the vault file leaves the key unset.
  --help, -h         Show this help
`,
  build: `
gm-apprentice-publish build [--site player|gm] [--config <path>] [--only sheets]

Generates the static site from the vault named in vault.config.json. On a
site with a backend enabled, re-syncs the plugin-owned Cloudflare Functions
first so a site scaffolded by an older plugin picks up new API routes.

Without --site it builds the player site, then the GM site while
gm_site.publish is on (the GM site alone when the player site is switched
off). The GM site is built into its own folder and never goes online.

  --site <name>      Build one site: player or gm
  --only sheets      Rebuild only the character pages, for use during play; nothing else is
                     written or deleted. Needs a full build first. A new character's page
                     is written, but the menu and the lists that link it wait for a full build.
                     Runs the vault's after_build steps, not its before_build steps.
  --config <path>    Path to vault.config.json (default: ./vault.config.json)
  --help, -h         Show this help
`,
  inbox: `
gm-apprentice-publish inbox <open|code|pull|watch|handled|flag|reply> [args]

Drives the at-table change-request queue (Cloudflare KV, via wrangler). Used
by the publish-site skill's checking loop; run it by hand to inspect the queue.

  inbox open <CODE> [--hours N]              Publish CODE as the session code players enter,
                                             forget the ids the last watch printed, and
                                             start the session clock in
                                             .watcher-session.json: the watcher runs N
                                             hours from now (default 5, 1-12)
  inbox code                                 Print the current session code
  inbox pull                                 Print pending requests as JSON
  inbox watch [--every N] [--remind-after N] [--exit-on-batch]
                                             Poll every N seconds (default 30, 1-300),
                                             writing the Unix time to .watcher-heartbeat
                                             each poll. Prints the pending batch as JSON
                                             when it holds an id not printed before (ids
                                             kept in .watcher-seen.json);
                                             "WATCHER: still pending: <id>..." when an id
                                             shown before is still pending --remind-after
                                             seconds later (default 300, 60-3600), and
                                             every N seconds after; and
                                             "WATCHER: inbox pull failed N times in a row"
                                             after 5 failed polls and every 5 more.
                                             Once the open's hours have passed it prints
                                             "WATCHER: session time is up" and exits 0.
                                             Otherwise runs until stopped; with
                                             --exit-on-batch it exits 0 after a batch or
                                             reminder line, 1 after a failure line. A
                                             usage error exits 2
  inbox handled <id> [<id>...]               Mark requests handled
  inbox flag <id> [<id>...]                  Mark requests flagged for the GM
  inbox reply <id> <applied|rejected|advice> "<text>"
                                             Store the reply the player sees
  --help, -h                                 Show this help
`,
  flush: `
gm-apprentice-publish flush [--config <path>] [--dry-run]

Writes each player's current KV live-state (HP, FP, conditions…) back into the
matching vault character sheet so the build-time seed stays fresh. Edits vault
source only — no rebuild, no deploy.

  --config <path>    Path to vault.config.json (default: ./vault.config.json)
  --dry-run, -n      Print the same per-PC "✓ Name — HP 10→13" lines, write nothing
  --help, -h         Show this help
`,
  sheet: `
gm-apprentice-publish sheet show --pc <name> [--player-safe] [--json] [--config <path>]

Prints one PC's character sheet from the vault. The default view is the raw
source file, exactly as it sits on disk. --player-safe prints the sheet with
everything the published site strips already gone — excluded sections (GM
Notes and friends), gm-only and spoiler blocks, HTML comments, excluded
callouts, gm_only relationship edges and excluded frontmatter fields — so it
is the sheet a player can see, not a reminder to look away. Prefer it over
reading the vault sheet directly whenever the audience is a player, not
the GM.

  --pc <name>        Which PC: file name, title, or frontmatter name
  --player-safe      Print only what a player can see
  --json             Emit { pc, sourcePath, playerSafe, frontmatter, markdown }
  --config <path>    Path to vault.config.json (default: ./vault.config.json)
  --help, -h         Show this help
`,
  relationships: `
gm-apprentice-publish relationships words [--vault <path>] [--json]
gm-apprentice-publish relationships check [--vault <path>] [--folder <sub>] [--file <rel>]... [--newer-than <rel>] [--json]
gm-apprentice-publish relationships list [--vault <path>] [--folder <sub>] [--file <rel>]... [--newer-than <rel>] [--skip <folder>]... [--json]
gm-apprentice-publish relationships fix [--vault <path>] [--folder <sub>] [--file <rel>]... [--newer-than <rel>] [--kind <kind>]... [--set <OLD=NEW>]... [--skip <folder>]... [--write] [--json]
gm-apprentice-publish relationships accept --at <note:line>... [--vault <path>] [--config <path>] [--write] [--json]

Prints the relationship types (each with its reverse name), the tone words and the
strength scale in a few lines. With --vault, a vault whose _meta/relationship-types.md
names only some types gets only those, and names the file holds that are not in the
vocabulary are listed on one line.

  relationships words        Print the words
  relationships check        Check every relationship rule; prints '# count: N' then one row per finding
                             (LEVEL<TAB>note:line<TAB>message), sorted by note then line
  relationships list         Every tone on a note's own relationships, one row each: note:line of the tone key, the tone as
                             written, the target as written, the description on one line; the header counts the notes whose
                             frontmatter does not read. --json gives { tones: [{ rel, line, tone, target, description, gmOnly }],
                             unread: [{ rel, message }] }
  relationships accept       Record hostile ties the GM reviewed and left (--at rows of tones.py shown); a tie stops being accepted when its
                             tone, target or description changes. Without --write it only says what it would record.
  relationships fix          The certain repairs. Without --write it lists them (WOULD-CHANGE and KEEP rows); with
                             --write it makes them in every note at once or in none (CHANGED rows). A tie it cannot move
                             or edit safely is a KEEP row with the reason.
  --kind <kind>              fix: only this kind (off-vocabulary, mirrored, bidirectional, place-missing-tie,
                             place-missing-field, visit-duplicate); repeatable
  --kind tone                fix: rewrite tone words instead; alone, with one or more --set. It keeps quotes, spacing, comments and
                             line endings, and a tone it cannot edit in place (a block scalar, a tag) is a KEEP row
  --set <OLD=NEW>            fix --kind tone: rewrite a tone written exactly OLD to the listed tone NEW (repeatable)
  --at <note:line>           accept: the tie whose tone key is on that line (repeatable)
  --skip <folder>            list, fix --kind tone: leave out the notes under this top-level folder (repeatable)
  --write                    fix, accept: make the changes
  --vault <path>             The vault folder (reads _meta/relationship-types.md; default: .)
  --folder <sub>             check, fix: only notes under this folder
  --file <rel>               check, fix: only this note (repeatable)
  --newer-than <rel>         check, fix: only notes modified at or after this vault file
                             (a flag the command does not take is refused)
  --json                     words: { subset, predicates, tones, strength, notInVocabulary }; check: the findings
  --help, -h                 Show this help
`,
  leaks: `
gm-apprentice-publish leaks <list|check|accept|prune|settle> [--config <path>] [--json]

The leak check reads the built player site (the folder deploy uploads) for
hidden text and secret names: any hidden sentence, list item or table cell of
four words or more, a gm_aliases name, a withheld note's name, and any word
player_site.never_show lists. deploy runs it and stops on a finding (unless
deploy --ignore-leaks); these commands run it without deploying.

  leaks list                 Print the findings, each with a short id
  leaks check                The same, and exit 1 on a finding; also names
                             accepted findings that are no longer needed
  leaks accept <page> <id-or-text>
                             Accept one finding: it is written to the publish
                             list and not asked about again while the page and
                             the sentence stay the same (its copies in the
                             site's data files, such as previews.json, too)
  leaks accept --page <page> Accept every finding on one page (a handout the
                             GM gave out on purpose)
  leaks accept --note <note> Accept every finding from one note, on every page
                             (each is still recorded as its page and sentence;
                             accepting needs the site's tool at 1.30.0 or later)
  leaks prune                Remove accepted findings that are no longer needed
  leaks settle <note> <heading>
                             Settle a Keeper-looking heading that vault_check
                             gm-leak flags and the GM means for players: it is
                             written to the accepted list and not flagged again
                             while the note's path and the heading stay the
                             same (needs no built site)
  --vault <dir>              settle: the vault (default: the one the config names)
  --config <path>            Path to vault.config.json (default: ./vault.config.json)
  --json                     Print the result as JSON
  --help, -h                 Show this help
`,
  manifest: `
gm-apprentice-publish manifest <diff|apply|publish-played|never-publish|rename|convert|list> [options]

Compares the publish list (_meta/publish-list.yaml) with what is actually
in the vault, and edits it. "diff" classifies every vault file with the same
decision the build makes, so a file it calls "publish" is a file the build
publishes. The tool only shows the drift — which files are correctly
excluded versus missing is the GM's call.

  manifest diff [--config <path>] [--vault <dir>] [--json]
                     List files the manifest does not mention (with the bucket,
                     code and reason for each), entries whose file is gone, and
                     the per-section unchanged counts. An entry for a note in a
                     folder the site leaves out is listed apart: its file is
                     there, and --prune keeps it.
  manifest apply [--publish <path>]... [--exclude "<path>=<reason>"]...
                 [--decide <path>]... [--prune] [--config <path>] [--vault <dir>]
                 [--json]
                     Move paths between the three sections and rewrite the file.
                     --prune drops entries with no file on disk. A path that
                     matches no vault file is an error and nothing is written.
                     --vault (diff and apply): read and write this vault's
                     manifest through the site's rules, as doctor --site --vault
                     audits it, so a fix lands in the vault that was audited.
  manifest convert --vault <dir> [--config <file>] [--check] [--site-tool-updated] [--json]
                     Move the publish list from _meta/publish-manifest.md to
                     _meta/publish-list.yaml, all or nothing: the new file is
                     read back and must hold every entry line and reason of
                     the old one before the old one is set aside as
                     _meta/publish-manifest.md.converted. --check changes
                     nothing. Without --config the site folder the vault's
                     settings name is asked whether the list must stay. Exit
                     1 when it cannot move the list; the old file is then
                     untouched. Only this and the update move a list: apply
                     and publish-played write the file the vault is on.
  manifest never-publish [--path <note>]... [--untyped] [--write] [--config <path>]
                         [--vault <dir>] [--json]
                     Put publish: false in a note's own frontmatter (a note with
                     none gets a block of that one line; the rest of the note is
                     not touched). --untyped names every note with no type: in
                     its frontmatter (the ones the build warns about), except a
                     root AGENTS.md or CLAUDE.md. Lists what it would mark and
                     writes nothing until --write. A note that publishes is
                     never touched.
  manifest list --vault <dir> [--json]
                     The three lists (publishing, excluded with reasons,
                     needs_decision) and their counts.
  manifest rename --vault <dir> --from <vault path> --to <vault path> --json
                 [--name <spelling>]... [--config <site vault.config.json>]
                     What renaming a note would change in the files this tool
                     owns, so the page stays published: prints
                     {"files": {<vault path>: <new full text>}, "pin": {"live_key"},
                     "companions": [{"from","to"}], "detaches": "<why>",
                     "owners": {<spelling>: <vault path or null>}}
                     and writes nothing. files: the manifest entries and the
                     settings that name the note (an overrides
                     path, a landing featured/quick-link name). pin: present
                     for a PC page, with the key its live state is stored
                     under now; the caller writes it as live_key before the
                     file moves. owners: where the build's link map sends each --name
                     spelling. companions: files paired to the note by
                     name (a PC's _Story.md) that move with it; detaches:
                     the note is one, and cannot move alone. Needs no site
                     config.
  manifest publish-played [--dry-run] [--config <path>] [--vault <dir>] [--json]
                          [--session <index> [--include-unreviewed] [--publish-body]]
                     Move every reviewed session to Publishing together
                     with its Wrap-Up, but only when that Wrap-Up is linked
                     (documents.wrap_up or its session:) and will publish,
                     so the session's body is withheld. Reviewed means the
                     index's status is reviewed or the Wrap-Up is
                     AUTHORITATIVE. Any other played session (status played,
                     wrap-up or reviewed) is listed as "unclear" with the
                     reason (no Wrap-Up, Wrap-Up not reviewed yet, Excluded
                     or not publishing, or a site pinned to a tool too old
                     to withhold the body) and not ticked: that is the GM's
                     call (manifest apply). Leaves Excluded entries alone.
                     Needs a publish list; without one it does
                     nothing. --session <index> (vault-relative) handles
                     just that session; --include-unreviewed (only with
                     --session) ticks it before reconcile, as session-wrapup's
                     "Publish now?" does. The pairing and site-pin checks
                     still apply: if either fails, the index is not ticked
                     and the reason is listed. --publish-body (only with
                     --session) is the GM's yes to publishing the index body
                     as written when no Wrap-Up pairs with it; a session
                     that pairs keeps the checks above. Excluded and
                     non-session paths are still refused.
  --help, -h         Show this help
`,
  lines: `
gm-apprentice-publish lines

Answers what the build would publish, for text handed in on stdin. One JSON
request per input line, one JSON answer per output line, until stdin closes.
vault_check uses it instead of keeping a copy of the build's filters.

  {"op":"published","text":"…","excludeSections":["GM Notes"],"publish":"all"}
      -> {"text":"…"}          the body the site renders
  {"op":"sections","text":"…","excludeSections":["GM Notes"]}
      -> {"withheldBy":[…]}    per line: the excluded section withholding it, or null
  {"op":"stub","text":"…","include":["Overview"],"excludeSections":["GM Notes"]}
      -> {"kept":[…]}          per line: whether a publish: stub page keeps it
  {"op":"site","vault":"/path/to/vault"}
      -> {"publishes":…,"site":…,"siteDir":…}  the vault's publish: block, whether its site is on, and the site folder
  {"op":"command","args":["settings","get","--vault","…","--json"],"cwd":"…","env":{…}}
      -> {"rc":…,"stdout":"…","stderr":"…"}  settings or explain --all, run as on its own

A request that cannot be answered gets {"error":"…"}.
`,
  explain: `
gm-apprentice-publish explain <vault-relative path> [--shown] [--config <path>] [--vault <dir>] [--json]
gm-apprentice-publish explain --all --json [--config <path>] [--vault <dir>]

Prints the chain the build walks for one file — directory, type, publish mode,
auto-exclusion, canon status, manifest section — and then the build's own
verdict: where it publishes, or which rule stopped it. Follows with the H2
sections stripped on publish and how many gm-only blocks the file carries.
Run it before "doctor --site" when the question is about one specific file
rather than the whole vault.

  gm-apprentice-publish explain "Sessions/Session 7.md"

With --shown, follows with what the site holds of the note, or would hold if
it published. The site is built in memory with the note given a page, and
the answer is read off that page: the text of the page as built (and of a
PC's story page), the image files that publish with it (a portrait, an
embed), its link-preview card, and what the search finds it by
(title, subtitle, aliases and every word of the body as published; a PC's
page prints only some of its sections, the search reads them all). Nothing
else of the note's body and fields is on the site; other pages that link it
still print its name. Use it to check a note before listing it under
Publishing. With --json it is "shown": { from: "page", page, story, images,
card, search: { title, subtitle, aliases, body } }. A note the build can make no
page of (no type, a folder not on the site) is shown as its frontmatter as
published and its body after every cut: { from: "note", frontmatter,
markdown }. A publish: false note: { from: "none" }.

--vault answers for that vault through the site's rules (a working copy,
or the vault doctor --site --vault audited).

With --all, prints one JSON object for every file the vault walk sees:
{ vaultPath, switches, excludeSections, pages: [{ path, type, publishes,
code, bodyWithheld, bodyPublishes }] }. switches is { characterSheets,
liveStats, inbox } as the build resolves them; excludeSections is the list of
H2 titles the build strips (the vault file's list, else the site file's, else
the built-in default). bodyWithheld marks a session index whose body the site
withholds because its Wrap-Up publishes.

  --config <path>    Path to vault.config.json (default: ./vault.config.json)
  --shown            Also print what the site holds of the note, read off
                     its page as built
  --json             Emit the whole chain as an object
  --all              Every file at once (needs --json)
  --vault <dir>      Read this vault through the site's rules instead of
                     the vault the config names
  --help, -h         Show this help
`,
  serve: `
gm-apprentice-publish serve [--site gm|player] [--port <n>] [--config <path>]

Serves an already-built site folder to your home network, read only, so the GM
site can be opened on a tablet or phone at the table. It builds nothing and
asks for no passphrase: run build first. It runs until you stop it (Ctrl+C)
and prints the addresses to open.

  --site <name>      The GM site (the default) or the player site
  --port <n>         A whole number from 1 to 65535 (default 4321)
  --config <path>    Path to vault.config.json (default: ./vault.config.json)
  --help, -h         Show this help
`,
  deploy: `
gm-apprentice-publish deploy [--config <path>] [--verify] [--no-build] [--dry-run] [--ignore-leaks] [--json]

Builds the site and publishes it to the host the vault names (player_site.host):
"cloudflare-pages" runs wrangler (checking authentication first, and aligning
wrangler.toml's project name), "github-pages" commits docs/ and pushes.

Before anything is uploaded, the leak check reads the built site for hidden text
and secret names (and the words player_site.never_show lists), and stops the
deploy on a finding (see leaks --help). --dry-run runs the check on the folder
as it stands.

  --verify          After deploying, fetch the site URL up to 3 times, 20s
                     apart. A site still propagating is reported, not failed.
  --no-build         Deploy whatever is already in the output directory
  --dry-run, -n      Print the commands that would run; run none of them
                     (exit 1 when the leak check would stop the deploy)
  --ignore-leaks     Deploy even when the leak check finds something, or
                     cannot run. Every finding is still printed. Only for
                     a deploy the GM chose to make; nothing is accepted
  --config <path>    Path to vault.config.json (default: ./vault.config.json)
  --json             Emit { host, built, deployed, url, verified, status,
                     attempts, commands, refused, leaks, leaksIgnored }
  --help, -h         Show this help
`,
  'update-pin': `
gm-apprentice-publish update-pin [--site <dir>] [--tag publish-vX.Y.Z] [--check] [--json]

Repoints this site's gm-apprentice-publish dependency at the newest version in
the plugin cache and runs npm install. A "/plugin update" installs a new version
alongside the old one but never touches the site's pin, so the site keeps
building with the old renderer until this runs. Pair it with "deploy".

  --site <dir>       The site directory holding package.json (default: the
                     directory of --config, i.e. the current directory)
  --config <path>    Path to vault.config.json — names the site directory
  --tag <tag>        Pin to the tarball of a tagged release (publish-vX.Y.Z)
                     instead of the plugin cache: downloads the .tgz and
                     SHA256SUMS from GitHub, verifies the checksum (a mismatch
                     aborts), vendors the .tgz under vendor/ and pins to it.
                     For sites outside the plugin.
  --check            Report the drift and exit 1; change nothing
  --json             Emit { pinnedBefore, pinnedAfter, installedBefore,
                     installedAfter, desired, changed, ok }
  --help, -h         Show this help
`,
  doctor: `
gm-apprentice-publish doctor [--host <host>] [--json] [--set-cloudflare-creds]
gm-apprentice-publish doctor --site [--config <path>] [--vault <dir>] [--json]

Preflight for publishing: checks Node, git, and the host CLI (wrangler for
Cloudflare Pages, gh for GitHub Pages) with its authentication, and prints a
fix for each failing row.

--site audits the vault instead of the machine: the stale build-tool pin,
folders missing from folderMap, files with no type:, frontmatter values of the
wrong type, portraits pointing at absent images, wikilinks that match no
published page, manifest entries whose file is gone, and played sessions in no
manifest section. It also finds faults in the notes themselves, the ones that
change what the site shows:
  NAMED_NO_PAGE   a note with no page, named on a published page, so its name
                  prints as plain words
  COMMENT_STRAY   a %% that is not a comment, or a comment never closed in a
                  frontmatter value
  FENCE_UNCLOSED  a code fence never properly closed, with a hidden marker
                  below it that the page prints
  ALIAS_IN_PROSE  a gm_aliases name printed on a page
  WITHHELD_IN_PROSE
                  the file name, title or alias of a note marked withheld: true,
                  printed on a page, in the address of a link, held by the
                  search index or the link previews, or carried in a copied
                  file's name
  NEVER_SHOW_IN_PROSE
                  a word listed under player_site.never_show printed on a
                  published page (deploy stops on it)
  WITHHELD_PUBLISHED
                  a note marked withheld: true that the site publishes (an
                  error; the build still builds)
  WITHHELD_NAME_PUBLIC
                  a withheld name a published page answers to as well, which so
                  cannot be looked for
  WITHHELD_FLAG_UNREADABLE
                  a withheld: value that is not true or false, read as not
                  withheld
  TOHIT_UNREAD    a row of a GURPS PC sheet the to-hit calculator cannot fully
                  read (a skill not in the Skills table, a bare number, a
                  technique that finds no skill); a row it reads but that is
                  written another way, or whose numbers do not add up, is a
                  note
  SKILL_BELOW_BASE
                  a skill of a Call of Cthulhu PC written below the base worked
                  out for it from the characteristics (a note; the sheet shows
                  the number written)
  HEADING_IN_HIDDEN_BLOCK
                  a withheld section's heading written inside a hidden block
                  (gm-only, a comment, a hidden callout), so the text after the
                  block is withheld with it (a note)
  TABLE_OVERWIDE  a table with a row wider than its header, which the site
                  widens so no cell is lost (a note)
To find them the site is built in memory, every page rendered and nothing
written, so the names are read off the pages as built and the list is the
build's own. That is every page: a note's own, a PC's story, the section
indexes, the timeline, the story and the landing page, and the names on a
page's Connections section. A name an index or listing page prints is counted
against the note it is taken from, and the finding names the page
("listings"). When a page cannot be rendered the list is not complete, and the
audit says so with an error (NOTE_FAULTS_UNCHECKED). The build prints a closing
warning for each code (one line each; a withheld: value that cannot be read gets
a line per note). A page that links a note marked withheld is an error, not a
warning (NAMED_NO_PAGE); it is still only a report, and the build goes on.
A note whose Excluded entry in the manifest begins "stays hidden:" is settled:
left out of the report, kept in --json with "settled": true. That answers the link
report (NAMED_NO_PAGE) only: a withheld name printed in text cannot be settled.
Each finding names
the edit that fixes it. Exits 1 only on an error, not on a warning. The human
report lists 20 rows per note-fault code; --json has them all.

  --host <host>              cloudflare-pages (default) or github-pages
  --site                     Audit the vault named by --config
  --config <path>            Path to vault.config.json, with --site
  --vault <dir>              With --site: audit this vault through the site's
                             rules instead of the vault the config names
  --json                     Machine-readable report instead of the checklist
  --set-cloudflare-creds     Read a Cloudflare API token from stdin, verify it,
                             and save it (plus the account id) to your shell env
  --help, -h                 Show this help
`,
  'setup-status-bar': `
gm-apprentice-publish setup-status-bar [--config <path>]

Enables live stats: creates the KV namespace, records its id in
wrangler.toml, turns on player_site.features.live_stats in the vault's
settings file (refusing first if that file cannot be edited),
then rebuilds and deploys the site. Requires wrangler auth ("doctor"
checks it).

  --config <path>    Path to vault.config.json (default: ./vault.config.json)
  --help, -h         Show this help
`,
  'setup-inbox': `
gm-apprentice-publish setup-inbox [--config <path>]

Enables the change-request inbox: creates the KV namespace, records its id
in wrangler.toml, turns on player_site.features.inbox in the vault's
settings file (refusing first if that file cannot be edited),
then rebuilds and deploys the site. Requires wrangler auth ("doctor"
checks it).

  --config <path>    Path to vault.config.json (default: ./vault.config.json)
  --help, -h         Show this help
`,
};

function printSubcommandHelp(cmd) {
  // The settings help is built from the list of settings, so it is not typed out here.
  console.log(cmd === 'settings' ? require('../lib/settings/cli.js').helpText() : SUBCOMMAND_HELP[cmd]);
}

const { parseSubcommandArgs } = require('../lib/subcommand-args');

function printVersion() {
  const pkg = require('../package.json');
  console.log(pkg.version);
}

// The tool ships its deps vendored under node_modules/; if that copy didn't make it
// (e.g. a broken install), surface the cause instead of a raw "Cannot find module" trace.
function missingDepsMessage(detail) {
  const toolDir = path.join(__dirname, '..');
  return (
    `Error: gm-apprentice-publish is missing runtime dependencies${detail ? `: ${detail}` : ''}.\n` +
    `This usually means the plugin install is incomplete. Reinstall/update the\n` +
    `gm-apprentice plugin (/plugin), then ask the publish-site skill to "update my site",\n` +
    `or run "npm install" inside ${toolDir}.`
  );
}

// Fast, friendly preflight on the declared (direct) dependencies.
function assertRuntimeDeps() {
  const pkg = require('../package.json');
  const toolDir = path.join(__dirname, '..');
  const missing = [];
  for (const dep of Object.keys(pkg.dependencies || {})) {
    try {
      require.resolve(dep, { paths: [toolDir] });
    } catch {
      missing.push(dep);
    }
  }
  if (missing.length > 0) {
    console.error(missingDepsMessage(missing.join(', ')));
    process.exit(1);
  }
}

// Load lib/build, converting a missing transitive dependency (which assertRuntimeDeps
// can't see) from a raw stack trace into the same actionable message.
function loadBuild() {
  try {
    return require('../lib/build');
  } catch (err) {
    // MODULE_NOT_FOUND also fires for a broken relative/absolute import inside the tool
    // (a real code bug). Only a missing *package* (a bare specifier) means absent deps —
    // rewrite those to the friendly message and let everything else surface as itself.
    if (err && err.code === 'MODULE_NOT_FOUND') {
      const m = /Cannot find module '([^']+)'/.exec(err.message || '');
      const name = m && m[1];
      const isBareSpecifier = name && !name.startsWith('.') && !path.isAbsolute(name);
      if (isBareSpecifier) {
        console.error(missingDepsMessage(`'${name}'`));
        process.exit(1);
      }
    }
    throw err;
  }
}

// Warn (non-fatal) if a newer build tool is installed than the one this site is pinned to.
function warnIfVersionDrift() {
  try {
    const { detectVersionDrift } = require('../lib/version-check');
    const result = detectVersionDrift();
    if (result && result.drift) {
      console.error(`\n${result.message}\n`);
    }
  } catch {
    // Version checking is best-effort; never block a build on it.
  }
}

if (command === '--help' || command === '-h' || !command) {
  printHelp();
  exitAfterFlush(0);
  return;
}

if (command === '--version' || command === '-v') {
  printVersion();
  exitAfterFlush(0);
  return;
}

// `--help` on any subcommand prints usage and exits 0 with no side effects (#178).
const wantsHelp = args.slice(1).some((a) => a === '--help' || a === '-h');
if (wantsHelp) {
  if (command === 'settings' || Object.prototype.hasOwnProperty.call(SUBCOMMAND_HELP, command)) printSubcommandHelp(command); else printHelp();
  exitAfterFlush(0);
  return;
}


if (command === 'init') {
  const rest = args.slice(1);
  // --title / --tagline seed player_site.title / player_site.theme.tagline in the vault file.
  const textOption = (flag) => {
    const i = rest.indexOf(flag);
    if (i === -1) return undefined;
    const value = rest[i + 1];
    if (!value || !value.trim() || value.startsWith('--')) return null;
    rest.splice(i, 2);
    return value.trim();
  };
  const siteTitle = textOption('--title');
  const tagline = textOption('--tagline');
  if (siteTitle === null || tagline === null) {
    console.error(`Init failed: ${siteTitle === null ? '--title' : '--tagline'} needs some text`);
    exitAfterFlush(2);
    return;
  }
  let vaultPath;
  const vi = rest.indexOf('--vault');
  if (vi !== -1) {
    vaultPath = rest[vi + 1];
    if (!vaultPath) {
      console.error('Init failed: --vault needs a directory');
      exitAfterFlush(2);
      return;
    }
    rest.splice(vi, 2);
    // Typed relative to where the user is; vaultPath is read relative to the site folder.
    // Inside the site folder it is recorded relative (forward slashes), else absolute.
    const vaultAbs = path.resolve(vaultPath);
    const rel = path.relative(path.resolve(rest[0] || '.'), vaultAbs);
    vaultPath = rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? `./${rel.split(path.sep).join('/')}` : vaultAbs;
  }
  // Only the target folder is left: an option init does not know must not be taken for a folder to scaffold in.
  if (rest[0] !== undefined && rest[0].startsWith('-')) refuseUnknownArgument('init', rest[0]);
  if (rest.length > 1) refuseUnknownArgument('init', rest[1]);
  const targetDir = rest[0] || '.';
  const { init } = require('../lib/init');
  init(targetDir, { verbose: true, vaultPath, siteTitle, tagline }).then(() => {
    exitAfterFlush(0);
  }).catch((err) => {
    console.error(`Init failed: ${err.message}`);
    exitAfterFlush(1);
  });
  return;
}

// The message for an argument a command does not take, shared by the commands that run steps or write files and
// had no list of their own. `build` has no dry form (`deploy --dry-run` is the one that prints what would run).
function refuseUnknownArgument(cmd, bad) {
  const why = bad === '--dry-run' || bad === '-n'
    ? (cmd === 'build' ? ' build has no dry run: it always writes the site and runs the vault\'s build steps.' : ` ${cmd} has no dry run.`)
    : '';
  console.error(`Error: Unknown ${bad.startsWith('-') ? 'option' : 'argument'}: ${bad}.${why} See \`gm-apprentice-publish ${cmd} --help\`.`);
  process.exit(1);
}

if (command === 'build') {
  // Sites scaffolded before the watch script was dropped still have `build --watch` in package.json; it never
  // watched, so it builds once and says so. Every other unknown option is refused below.
  const buildArgs = args.slice(1).filter((a) => a !== '--watch');
  const sawWatch = buildArgs.length !== args.length - 1;
  const parsed = parseSubcommandArgs(buildArgs, {}, { '--site': 'site', '--only': 'only' });
  if (parsed.error) {
    const bad = /^Unknown argument: (.*)$/.exec(parsed.error);
    if (bad) refuseUnknownArgument('build', bad[1]);
    console.error(`Error: ${parsed.error}`);
    process.exit(1);
  }
  const configPath = parsed.configPath;
  const siteFlag = parsed.flags.site;
  if (siteFlag !== undefined && siteFlag !== 'player' && siteFlag !== 'gm') {
    console.error(`Unknown site: ${siteFlag}. Use --site player or --site gm.`);
    process.exit(1);
  }

  const onlyFlag = parsed.flags.only;
  if (onlyFlag !== undefined && onlyFlag !== 'sheets') {
    console.error(`Unknown --only value: ${onlyFlag}. The only one is sheets.`);
    process.exit(1);
  }

  if (!fs.existsSync(configPath)) {
    console.error(`Error: Config file not found: ${configPath}`);
    process.exit(1);
  }

  // Surface a stale version pin and missing deps before doing any work.
  warnIfVersionDrift();
  assertRuntimeDeps();

  // A site the GM turned off (player_site.publish) is not built, and its functions are left alone.
  // Which sites to build: --site names one; without it the player site, then the GM site while gm_site.publish is on.
  // With the player site off and the GM site on, the GM site is built alone.
  const configLib = require('../lib/config');
  const off = configLib.siteOffFor(configPath);
  let gmOn;
  try { gmOn = configLib.gmSiteOnFor(configPath); } catch (err) {
    console.error(`Build failed: could not read the GM site's settings: ${String(err.message).split('\n')[0].trim()}`);
    process.exit(1);
  }
  if (siteFlag === 'gm' && !gmOn) {
    console.error('The GM site is off for this vault (gm_site.publish); nothing was built.');
    process.exit(1);
  }
  const sites = siteFlag ? [siteFlag] : (off && gmOn ? ['gm'] : (gmOn ? ['player', 'gm'] : ['player']));
  if (sites.includes('player') && off) {
    console.error(`Build failed: ${off}${gmOn ? ' The GM site is on: build it with --site gm, or leave out --site.' : ''}`);
    process.exit(1);
  }

  // A hiding-side settings fault stops the build before anything is written: the function
  // sync and the font download below both write. The message is plain lines, no prefix.
  try {
    for (const site of sites) configLib.assertNoStopsFor(configPath, 'build', site);
  } catch (err) {
    console.error(err.message);
    exitAfterFlush(1);
    return;
  }

  // Bring plugin-owned Cloudflare Functions up to date on every build so API routes
  // added or fixed in a newer plugin version reach flagged sites scaffolded before they
  // existed. Each feature's files follow its own switch: on copies them, an explicit off
  // removes them, unset does neither (a Tier-1 static site gets no Functions re-added).
  if (sites.includes('player') && !onlyFlag) require('../lib/sync-functions').syncSiteFunctionsOrWarn(configPath);

  const { build } = loadBuild();
  (async () => {
    try {
      // theme.fonts.source: self-host fills the vault's font cache first (network); the
      // build itself only reads the cache (#270).
      if (!onlyFlag) await require('../lib/fonts').prefetchForConfig(configPath);
      // A failed build stops here: the next site is not built.
      for (const site of sites) build({ configPath, runSteps: true, site, only: onlyFlag });
      if (sawWatch) console.log('build has no watch mode; built once.');
    } catch (err) {
      console.error(`Build failed: ${err.message}`);
      exitAfterFlush(1);
      return;
    }
    exitAfterFlush(0);
  })();
  return;
}

if (command === 'serve') {
  const parsed = parseSubcommandArgs(args.slice(1), {}, { '--site': 'site', '--port': 'port' });
  if (parsed.error) {
    const bad = /^Unknown argument: (.*)$/.exec(parsed.error);
    if (bad) refuseUnknownArgument('serve', bad[1]);
    console.error(`Error: ${parsed.error}`);
    process.exit(1);
  }
  const site = parsed.flags.site === undefined ? 'gm' : parsed.flags.site;
  if (site !== 'gm' && site !== 'player') {
    console.error(`Unknown site: ${site}. Use --site player or --site gm.`);
    process.exit(1);
  }
  // The server keeps the process alive; it stops on Ctrl+C. A refusal exits with the reason.
  require('../lib/serve.js').runServe({
    configPath: parsed.configPath,
    site,
    ...(parsed.flags.port === undefined ? {} : { port: parsed.flags.port }),
  }).catch(failAfterFlush);
  return;
}

if (command === 'inbox') {
  const { runInbox } = require('../lib/inbox-cli.js');
  runInbox(args.slice(1))
    .then(exitAfterFlush)
    .catch(failAfterFlush);
  return;
}

if (command === 'flush') {
  const parsed = parseSubcommandArgs(args.slice(1), { '--dry-run': 'dryRun', '-n': 'dryRun' });
  if (parsed.error) {
    console.error(`Error: ${parsed.error}`);
    printSubcommandHelp('flush');
    process.exit(1);
  }
  const { runFlush } = require('../lib/flush-cli.js');
  runFlush({ configPath: parsed.configPath, dryRun: !!parsed.flags.dryRun })
    .then(exitAfterFlush)
    .catch(failAfterFlush);
  return;
}

if (command === 'sheet') {
  const verb = args[1];
  if (verb !== 'show') {
    console.error(verb ? `Error: Unknown sheet command: ${verb}` : 'Error: sheet needs a command (show)');
    printSubcommandHelp('sheet');
    process.exit(1);
  }
  const parsed = parseSubcommandArgs(
    args.slice(2),
    { '--player-safe': 'playerSafe', '--json': 'json' },
    { '--pc': 'pc' },
  );
  if (parsed.error) {
    console.error(`Error: ${parsed.error}`);
    printSubcommandHelp('sheet');
    process.exit(1);
  }
  if (!parsed.flags.pc) {
    console.error('Error: sheet show needs --pc <name>');
    printSubcommandHelp('sheet');
    process.exit(1);
  }
  const { runSheetShow } = require('../lib/sheet-cli.js');
  runSheetShow({
    configPath: parsed.configPath,
    pc: parsed.flags.pc,
    playerSafe: !!parsed.flags.playerSafe,
    json: !!parsed.flags.json,
  })
    .then(exitAfterFlush)
    .catch(failAfterFlush);
  return;
}

if (command === 'lines') {
  if (args.length > 1) {
    console.error(`Error: lines takes no arguments (got ${args[1]})`);
    printSubcommandHelp('lines');
    process.exit(1);
  }
  const { runLines } = require('../lib/lines-cli.js');
  runLines().then(exitAfterFlush).catch(failAfterFlush);
  return;
}

if (command === 'explain' && args[1] === '--all') {
  const { runExplainAll, explainAllOptions } = require('../lib/explain-cli.js');
  const parsed = explainAllOptions(args.slice(2));
  if (parsed.error) {
    console.error(`Error: ${parsed.error}`);
    printSubcommandHelp('explain');
    process.exit(1);
  }
  runExplainAll(parsed.options)
    .then(exitAfterFlush)
    .catch(failAfterFlush);
  return;
}

if (command === 'settings') {
  const { runSettings, settingsOptions } = require('../lib/settings/cli.js');
  const parsed = settingsOptions(args.slice(1));
  if (parsed.error) {
    console.error(`Error: ${parsed.error}`);
    printSubcommandHelp('settings');
    process.exit(1);
  }
  exitAfterFlush(runSettings(parsed.options));
  return;
}

if (command === 'explain') {
  const target = args[1];
  if (!target || target.startsWith('-')) {
    console.error('Error: explain needs a vault-relative path');
    printSubcommandHelp('explain');
    process.exit(1);
  }
  // --vault: answer for this vault through the site's rules, as `doctor --site --vault` audits it.
  const parsed = parseSubcommandArgs(args.slice(2), { '--json': 'json', '--shown': 'shown' }, { '--vault': 'vault' });
  if (parsed.error) {
    console.error(`Error: ${parsed.error}`);
    printSubcommandHelp('explain');
    process.exit(1);
  }
  const { runExplain } = require('../lib/explain-cli.js');
  runExplain({ configPath: parsed.configPath, vaultPath: parsed.flags.vault, target, json: !!parsed.flags.json, shown: !!parsed.flags.shown })
    .then(exitAfterFlush)
    .catch(failAfterFlush);
  return;
}

if (command === 'deploy') {
  const parsed = parseSubcommandArgs(args.slice(1), {
    '--verify': 'verify',
    '--no-build': 'noBuild',
    '--dry-run': 'dryRun',
    '-n': 'dryRun',
    '--json': 'json',
    '--ignore-leaks': 'ignoreLeaks',
  });
  if (parsed.error) {
    console.error(`Error: ${parsed.error}`);
    printSubcommandHelp('deploy');
    process.exit(1);
  }
  const { runDeploy } = require('../lib/deploy-cli.js');
  runDeploy({
    configPath: parsed.configPath,
    verify: !!parsed.flags.verify,
    noBuild: !!parsed.flags.noBuild,
    dryRun: !!parsed.flags.dryRun,
    json: !!parsed.flags.json,
    ignoreLeaks: !!parsed.flags.ignoreLeaks,
  })
    .then(exitAfterFlush)
    .catch(failAfterFlush);
  return;
}

if (command === 'manifest') {
  const verb = args[1];
  if (verb !== 'diff' && verb !== 'apply' && verb !== 'publish-played' && verb !== 'never-publish' && verb !== 'rename' && verb !== 'convert' && verb !== 'list') {
    console.error(verb ? `Error: Unknown manifest command: ${verb}` : 'Error: manifest needs a command (diff, apply, publish-played, never-publish, rename, convert or list)');
    printSubcommandHelp('manifest');
    process.exit(1);
  }
  // --publish/--exclude/--decide move an entry between manifest sections, which
  // only "apply" does — registering them for "diff" too meant `manifest diff
  // --publish X` was accepted and silently did nothing (#M8).
  const parsed = parseSubcommandArgs(
    args.slice(2),
    Object.assign({ '--prune': 'prune', '--json': 'json' },
      verb === 'publish-played' ? { '--dry-run': 'dryRun', '-n': 'dryRun', '--include-unreviewed': 'includeUnreviewed', '--publish-body': 'publishBody' } : {},
      verb === 'convert' ? { '--check': 'check', '--site-tool-updated': 'siteToolUpdated' } : {},
      verb === 'never-publish' ? { '--untyped': 'untyped', '--write': 'write' } : {}),
    // --vault: vault_check asks about the vault it is checking, which need not be the
    // one the site's vaultPath names (explain --all takes it for the same reason).
    verb === 'publish-played' ? { '--vault': 'vault', '--session': 'session' }
      : verb === 'rename' ? { '--vault': 'vault', '--from': 'from', '--to': 'to' } : { '--vault': 'vault' },
    verb === 'apply' ? { '--publish': 'publish', '--exclude': 'exclude', '--decide': 'decide' }
      : verb === 'rename' ? { '--name': 'names' }
        : verb === 'never-publish' ? { '--path': 'paths' } : {},
  );
  if (parsed.error) {
    console.error(`Error: ${parsed.error}`);
    if (verb !== 'rename') printSubcommandHelp('manifest');
    process.exit(1);
  }
  const { runManifest } = require('../lib/manifest-cli.js');
  runManifest({
    verb,
    // For rename, only a --config the caller typed: the default is a path in the working folder.
    configPath: (verb === 'rename' || verb === 'convert') && !args.includes('--config') ? null : parsed.configPath,
    vaultPath: parsed.flags.vault,
    session: parsed.flags.session,
    from: parsed.flags.from,
    to: parsed.flags.to,
    names: parsed.flags.names,
    includeUnreviewed: !!parsed.flags.includeUnreviewed,
    publishBody: !!parsed.flags.publishBody,
    publish: parsed.flags.publish,
    exclude: parsed.flags.exclude,
    decide: parsed.flags.decide,
    paths: parsed.flags.paths,
    untyped: !!parsed.flags.untyped,
    write: !!parsed.flags.write,
    prune: !!parsed.flags.prune,
    dryRun: !!parsed.flags.dryRun,
    check: !!parsed.flags.check,
    siteToolUpdated: !!parsed.flags.siteToolUpdated,
    json: !!parsed.flags.json,
  })
    .then(exitAfterFlush)
    .catch(failAfterFlush);
  return;
}

if (command === 'leaks') {
  const verb = args[1];
  if (!['list', 'check', 'accept', 'prune', 'settle'].includes(verb)) {
    console.error(verb ? `Error: Unknown leaks command: ${verb}` : 'Error: leaks needs a command (list, check, accept, prune or settle)');
    printSubcommandHelp('leaks');
    process.exit(1);
  }
  const rest = args.slice(2);
  const positional = [];
  if (verb === 'accept' || verb === 'settle') { while (rest.length && !rest[0].startsWith('--')) positional.push(rest.shift()); }
  const parsed = parseSubcommandArgs(rest, { '--json': 'json' }, verb === 'accept' ? { '--page': 'page', '--note': 'note' } : verb === 'settle' ? { '--vault': 'vault' } : {});
  if (verb === 'settle' && (parsed.error || positional.length !== 2)) {
    console.error(`Error: ${parsed.error || 'leaks settle needs a note and its heading'}`);
    printSubcommandHelp('leaks');
    process.exit(1);
  }
  // accept takes one finding (a page and its id or sentence), or every finding on a page (--page), or from a note (--note).
  const several = parsed.flags ? [parsed.flags.page, parsed.flags.note].filter(Boolean).length : 0;
  const acceptForm = several === 1 ? positional.length === 0 : several === 0 && positional.length === 2;
  if (parsed.error || (verb === 'accept' && !acceptForm)) {
    console.error(`Error: ${parsed.error || 'leaks accept needs a page and the finding\'s id or sentence, or one of --page <page> or --note <note>'}`);
    printSubcommandHelp('leaks');
    process.exit(1);
  }
  const { runLeaks } = require('../lib/leaks-cli.js');
  runLeaks({ verb, configPath: parsed.configPath, json: !!parsed.flags.json, page: positional[0], text: positional[1], allOnPage: parsed.flags.page, note: parsed.flags.note, vault: parsed.flags.vault })
    .then(exitAfterFlush)
    .catch(failAfterFlush);
  return;
}

if (command === 'relationships') {
  const { runRelationships, VERBS } = require('../lib/relationships/cli.js');
  const verb = args[1];
  if (!VERBS.includes(verb)) {
    console.error(verb ? `Error: Unknown relationships command: ${verb}` : `Error: relationships needs a command (${VERBS.join(', ')})`);
    printSubcommandHelp('relationships');
    process.exit(1);
  }
  const parsed = parseSubcommandArgs(
    args.slice(2),
    { '--json': 'json', '--write': 'write' },
    { '--vault': 'vault', '--folder': 'folder', '--newer-than': 'newerThan' },
    { '--file': 'files', '--kind': 'kinds', '--set': 'sets', '--skip': 'skip', '--at': 'at' },
  );
  if (parsed.error) {
    console.error(`Error: ${parsed.error}`);
    printSubcommandHelp('relationships');
    process.exit(1);
  }
  const TAKES = {
    words: { '--vault': 'vault', '--json': 'json' },
    check: { '--vault': 'vault', '--json': 'json', '--folder': 'folder', '--file': 'files', '--newer-than': 'newerThan' },
    list: { '--vault': 'vault', '--json': 'json', '--folder': 'folder', '--file': 'files', '--newer-than': 'newerThan', '--skip': 'skip' },
    fix: { '--vault': 'vault', '--json': 'json', '--folder': 'folder', '--file': 'files', '--newer-than': 'newerThan', '--kind': 'kinds', '--set': 'sets', '--skip': 'skip', '--write': 'write' },
    accept: { '--vault': 'vault', '--json': 'json', '--at': 'at', '--write': 'write' },
  };
  const ALL = { ...TAKES.fix, ...TAKES.accept };
  for (const [flag, key] of Object.entries(ALL)) {
    const given = Array.isArray(parsed.flags[key]) ? parsed.flags[key].length > 0 : parsed.flags[key] !== undefined;
    if (given && !Object.prototype.hasOwnProperty.call(TAKES[verb], flag)) {
      console.error(`Error: relationships ${verb} does not take ${flag}; its flags are ${Object.keys(TAKES[verb]).join(', ')}`);
      process.exit(1);
    }
  }
  const { vault, json, folder, files, newerThan, kinds, write, sets, skip, at } = parsed.flags;
  // With --vault and no --config, the site is the one the vault names, never one that happens to be in this folder.
  const config = vault && !parsed.configGiven ? undefined : parsed.configPath;
  runRelationships({ verb, vault, json: !!json, folder, files, newerThan, kinds, write: !!write, sets, skip, at, config })
    .then(exitAfterFlush)
    .catch(failAfterFlush);
  return;
}

if (command === 'update-pin') {
  const parsed = parseSubcommandArgs(
    args.slice(1),
    { '--check': 'check', '--json': 'json' },
    { '--site': 'site', '--tag': 'tag' },
  );
  if (parsed.error) {
    console.error(`Error: ${parsed.error}`);
    printSubcommandHelp('update-pin');
    process.exit(1);
  }
  const siteDir = parsed.flags.site || path.dirname(path.resolve(parsed.configPath));
  const { runUpdatePin } = require('../lib/update-pin.js');
  runUpdatePin({ siteDir, tag: parsed.flags.tag, check: !!parsed.flags.check, json: !!parsed.flags.json })
    .then(exitAfterFlush)
    .catch(failAfterFlush);
  return;
}

if (command === 'doctor') {
  const { runDoctor } = require('../lib/doctor-cli.js');
  runDoctor(args.slice(1))
    .then(exitAfterFlush)
    .catch(failAfterFlush);
  return;
}

if (command === 'setup-status-bar' || command === 'setup-inbox') {
  // Also mutating (KV namespace + deploy): reject unknown arguments (#178).
  const parsed = parseSubcommandArgs(args.slice(1), {});
  if (parsed.error) {
    console.error(`Error: ${parsed.error}`);
    printSubcommandHelp(command);
    process.exit(1);
  }
  const configPath = parsed.configPath;
  const feature = command === 'setup-status-bar' ? 'status-bar' : 'inbox';
  const { runSetupBackend } = require('../lib/setup-backend.js');
  runSetupBackend(feature, { configPath })
    .then(exitAfterFlush)
    .catch(failAfterFlush);
  return;
}

console.error(`Unknown command: ${command}`);
printHelp();
process.exit(1);
