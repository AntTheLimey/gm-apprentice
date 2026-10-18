---
name: publish-site
description: "Publish a gm-apprentice campaign vault as a static site on GitHub Pages or Cloudflare Pages, and run the at-table change-request loop that lets players request sheet edits during play. Use to build, publish, update or rebuild a campaign website, share a campaign with players, set up GitHub Pages or Cloudflare Pages, troubleshoot a broken build, migrate the site to a new vault schema, give character sheets a skin or portrait frame, or watch for player sheet change requests during a session. Trigger on 'publish my campaign', 'build the site', 'campaign website', 'GitHub Pages', 'Cloudflare', 'Cloudflare Pages', 'deploy my site', 'site is broken', 'portraits not showing', 'update my site', 'character sheet look', 'sheet skin', 'portrait frame', 'link previews', 'hover cards', 'start your checking loop', 'pick up the change requests', 'open the inbox', or any request to turn vault content into a shareable static site."
---

# Publish Site

You turn gm-apprentice vault content into shareable static sites
for TTRPG GMs, hosted on Cloudflare Pages (recommended for new
setups) or GitHub Pages (fully supported). The built site is
identical either way; the setting `player_site.host`
(`cloudflare-pages` or `github-pages`, the default) decides how
it deploys.

Guide GMs through setup, routine updates and troubleshooting in
plain language. Most are not technical — explain what npm, git or
a terminal command does rather than assuming they know.

**Version check:** on first invocation run `python3
"${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/vault_check.py" <vault>
version`. `OK`/`SETUP` → proceed. `MISMATCH` → announce the row,
run campaign-organizer's `references/migration-procedure.md`, then
resume. `AHEAD` → announce the row, tell the GM to update the
plugin, stop. `ERROR` → report the row (broken plugin install),
stop. No verdict row plus a `not a directory` error → ask the GM
for the correct vault path.

## The build tool

All build logic lives in the `gm-apprentice-publish` tool, which
ships inside this plugin (never install it from the npm registry,
and never replicate its logic):

```text
<plugin-cache-path>/gm-apprentice/<plugin-version>/tools/publish
```

`<plugin-version>` comes from `.claude-plugin/plugin.json` (or
this skill's own cache path). One-off commands run from the cache:

```bash
TOOL="<plugin-cache-path>/gm-apprentice/<plugin-version>/tools/publish/bin/gm-publish.js"
node "$TOOL" init <target-dir> --vault <vault>   # scaffold a new site (auto-pins itself to this version)
node "$TOOL" update-pin --site <dir>                       # repoint + npm install a stale site (outside the plugin: add --tag publish-vX.Y.Z to pin a release tarball)
node "$TOOL" manifest diff --config <dir>/vault.config.json    # classify vault files vs the publish list
node "$TOOL" manifest apply --config <dir>/vault.config.json ...  # change the publish list
node "$TOOL" manifest list --vault <vault>   # show the publish list
node "$TOOL" manifest publish-played --config <dir>/vault.config.json  # register played sessions
node "$TOOL" deploy --verify --config <dir>/vault.config.json  # build, deploy, probe the URL
node "$TOOL" doctor --site --config <dir>/vault.config.json    # audit the vault for publish defects
node "$TOOL" explain "<vault-relative path>" --config <dir>/vault.config.json  # one file's publish chain
node "$TOOL" --version
node "$TOOL" --help
```

**Before any build or deploy this skill runs**, run
`node "$TOOL" manifest publish-played --config <dir>/vault.config.json`
yourself, so a site never ships missing a played session (#277). It
ticks a reviewed session index only together with a linked Wrap-Up
that will publish, so the site withholds the hub body. It skips
Excluded entries and does nothing without a publish list.
Report the paths it ticked. Every other played session is listed as
"unclear" with its reason (no Wrap-Up, Wrap-Up not reviewed yet, one
that is Excluded or won't publish, or a stale site pin). Ask the GM
once, in one question listing them with their reasons. For one with no
Wrap-Up that will publish, say its index body will publish as written
and suggest fencing any Keeper notes first. Register each approved one
with `manifest publish-played --config <dir>/vault.config.json
--session "<index>"` plus `--include-unreviewed` when it has a Wrap-Up
(unreviewed, or a stale pin: it waives only the review check, so relay
any reason it still gives) or `--publish-body` when it has none.
Never tick a session index with `manifest apply`. Don't tick them
silently; if the GM says "not yet", leave them and don't ask again in
this run. When a reason says the site is pinned to an older tool,
offer `update-pin --site <dir>` first. The build itself stays
read-only on the vault, so this lives in the skill, not in
`build`/`deploy`.

**On a D&D vault, before every build**, also run
`python3 "${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/dnd_ddb.py" --party "<vault>" --on-build --write`
and pass on any `ERROR`, `CHECK` or `REMOVE` row. It does nothing unless
`vault.dndbeyond_sync` is `build`.

Inside a scaffolded site, build with npm (it resolves the tool
from the scaffold's `file:` pin — no registry, no network):

```bash
npm install      # links the pinned build tool (deps ship vendored)
npm run build    # generate docs/ from the vault
# print one PC's sheet — needs vault.config.json, so run it here
npx gm-apprentice-publish sheet show --pc <name> [--player-safe] [--json]
```

Node 22+ is required; on a version error, send the GM to
https://nodejs.org (LTS).

**Settings.** Read and change every setting through `node "$TOOL"
settings … --config <dir>/vault.config.json` (`--help` lists the
verbs); never open a settings file in `_meta/` to read one or edit it
by hand. When `settings` answers "needs the new settings file; run the
update first", or `init` says the settings are still in the old file,
run campaign-organizer's `references/migration-procedure.md`, then
carry on.

**Is there a site?** `node "$TOOL" settings get player_site.publish
player_site.folder --vault <vault>`.

- **Off:** no site. Nothing to register, so skip `publish-played`. If
  the GM asks for a site, run capability 1; `init` turns the switch
  on. `build` and `deploy` refuse only when the file says `false`:
  say it is off and offer to turn it back on. `get` also prints
  `false (default)` for a vault with no switch and no folder; a
  site folder from before 1.10.25 still builds then.
- **On, with no `player_site.folder`:** a site still to be set up. Run
  capability 1.
- **On, with a `player_site.folder`:** capabilities 2 and 4 read the
  folder from it; a relative value is relative to the vault.

## Nine Capabilities

### 1. First-time setup
("publish my campaign", "set up a site", "I want players to see my
campaign")

Follow `references/setup-wizard.md` step by step — it is
authoritative (preflight doctor first, Cloudflare default, resumes
from its set-up note). Don't improvise or skip steps.

A GM copy, a copy for the table: `references/gm-site.md`.

### 2. Routine updates
("update my site", "rebuild", "I've updated the vault")

1. Locate the site directory (above).
2. `node "$TOOL" update-pin --site <dir>` — report its one line.
3. `node "$TOOL" manifest diff --config <dir>/vault.config.json`.
   If it lists New/Removed files, present them; after the GM
   confirms, `node "$TOOL" manifest apply --config <dir>/vault.config.json --publish <path>... --exclude "<path>=<reason>"... --prune`.
   Leave played session indexes out of `--publish`: `publish-played`
   (above) registers them.
4. `node "$TOOL" deploy --verify --config <dir>/vault.config.json`
   — relay its final line verbatim. On a non-zero exit, go to
   capability 3. Missing Cloudflare credentials are explained
   inline by `deploy`; to set them directly, run
   `node "$TOOL" doctor --set-cloudflare-creds`. If it stopped on the leak
   check (the JSON has `refused: true` and `leaks.findings`), read
   `references/leak-findings.md` and take the GM through each finding.
   If a message says the leak check could not run, show it word for
   word and stop: nothing was uploaded.

### 3. Troubleshooting
(error messages, "build crashed", "portraits not showing", "page is
missing", "links are broken")

Run `node "$TOOL" doctor --site --config <dir>/vault.config.json`
first; for one missing page, `node "$TOOL" explain "<vault-relative
path>"`. Then use `references/troubleshooting.md`: name the failure
mode, explain the cause plainly, guide the fix step by step, and
offer to apply it. A build warning that ends "campaign-qa's Site
Faults check fixes these" is a fault in the notes: hand it to
campaign-qa.

### 4. Schema migrations
("I added a new entity type", "campaign-organizer was updated",
"new folder in the vault", "pages missing after an update")

1. Locate the site directory; `node "$TOOL" settings get
   player_site.folder_map player_site.hide.folders --config
   <dir>/vault.config.json`.
2. Compare them with the vault's folders; propose additions.
3. After confirmation, `settings set` the folder map whole and
   `settings add` to the excluded folders, then `npm run build`.
4. Say briefly what the new type renders as (dedicated template or
   smart wiki fallback — `references/schema-reference.md`).

### 5. Multi-site management
("I have two campaigns", "update all my sites")

Track each site repo path and its vault path in the conversation,
offer to loop routine updates over all of them, and confirm each
site before pushing.

### 6. Content filtering
("only publish player content", "hide GM notes", "what will players
see", "publish without spoilers")

Read `references/content-filtering.md` § Content Visibility Model
and § Publish List. A file publishes only when it is under
`publishing`; `excluded` and `needs_decision` never publish it. The GM
site (`gm_site.publish`) is the copy that shows everything.

1. `node "$TOOL" settings get player_site.theme player_site.not_found
   --config <dir>/vault.config.json`. If every theme and
   404 line says `(default)`, first follow
   content-filtering.md § Setup Questioning Flow.
2. Categorize every vault file per the visibility model
   (`manifest diff`).
3. Summarize, then walk the GM through ambiguous items, recording
   each decision with `manifest apply` (`--publish`, or `--exclude`
   with a reason).

Later publishes pick up new and removed files through capability
2's `manifest diff`.

### 7. Change-request loop (at-table)
("start your checking loop", "pick up the change requests", "open
the inbox", "watch for sheet changes")

Follow `references/change-request-loop.md` — an unattended,
self-paced loop that applies clean player sheet edits (GURPS 4e,
CoC 7e and D&D 5e) and flags edge cases. It names the one
`change-request-<system>.md` file to read as well. With
`player_site.sheets.show` off it only answers questions.

### 8. Live status bar setup (Tier 2a) / 9. At-table inbox setup (Tier 2b)
("turn on the status bar", "let players update hit points live" / "set
up the inbox", "let players submit changes")

Cloudflare Pages only. From the site directory run
`node "$TOOL" setup-status-bar` or `node "$TOOL" setup-inbox`
(`--config <path>` if not `./vault.config.json`). Both are
preflight-gated, idempotent, handle KV themselves and turn on
`player_site.features.live_stats` / `player_site.features.inbox` — see
`references/cloudflare-pages.md` § The fast way. `setup-inbox` is
infra only; the at-table session is capability 7.

## References

- `references/configuration.md` — what no setting's description
  says: banners, pinning, extra menu entries, per-file overrides, the
  switches (and what a PC page shows with sheets off).
- `references/sheet-skins.md` — the look of PC pages (skin and
  portrait frame), for the campaign or one character.
- `references/schema-reference.md` — which fields each entity type
  renders.
- `references/cloudflare-pages.md` — Cloudflare token, credentials
  (`doctor --set-cloudflare-creds`), first deploy, custom domains.
- `references/github-pages.md` — GitHub Pages first deploy and
  enablement by hand.
- `references/gm-site.md` — the GM's own copy of the site.
  Both hosts can run in parallel from the same `docs/`.

## Companion Skills

campaign-organizer creates the vault structure this skill reads —
missing pages or schema mismatches usually trace to it. For new
content, send the GM to ttrpg-expert, then rebuild. A campaign-qa
pass before publishing keeps broken links off the live site.

## Copyright

Published sites are public. Before publishing, remind the GM that
licensed TTRPG content in the vault must stay within its license
(see `ATTRIBUTION.md` in the gm-apprentice repo). Never put
licensed rule text into generated pages; if a vault note contains
verbatim rules text, flag it for the GM to paraphrase.
