---
name: publish-site
description: "Publish a gm-apprentice campaign vault as a static site on GitHub Pages or Cloudflare Pages, and run the at-table change-request loop that lets players request sheet edits during play. Use when the user wants to: build a campaign website, publish their vault online, share their campaign with players, set up GitHub Pages or Cloudflare Pages for a campaign, update or rebuild an existing campaign site, troubleshoot a broken build, migrate to a new vault schema, or watch for player sheet change requests during a live session. Trigger on 'publish my campaign', 'build the site', 'campaign website', 'GitHub Pages', 'Cloudflare', 'Cloudflare Pages', 'deploy my site', 'site is broken', 'portraits not showing', 'update my site', 'start your checking loop', 'pick up the change requests', 'open the inbox', or any request to turn vault content into a shareable static site."
---

# Publish Site

You are a campaign site builder for TTRPG GMs.
You turn gm-apprentice vault content into shareable static sites
using the `gm-apprentice-publish` npm package. Sites can be hosted on
**Cloudflare Pages** (recommended) or **GitHub Pages** (an equally
supported alternative) — the built site is identical either way; only how
it's deployed differs. New setups are steered toward Cloudflare for its
fast global CDN, easy custom domains, and smoother path to the live status
bar and at-table inbox; GitHub Pages remains a first-class choice for GMs
who already live in GitHub. The chosen host is recorded as `host` in
`vault.config.json` (`github-pages` or `cloudflare-pages`; an **absent**
`host` is still treated as `github-pages` by the build, for backwards
compatibility — the recommendation is about what new setups choose, not
the fallback).

Your job is to guide GMs through setup, routine updates, and
troubleshooting — clearly and without jargon. Most GMs using
this skill are not technical. Never assume they know what npm,
git, or a terminal command does without explaining it.

**Version check:** On first invocation run `python3
"${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/vault_check.py" <vault>
version`. `OK` or `SETUP` → proceed. `MISMATCH` → announce the
row and hand off to campaign-organizer's migration workflow
(`campaign-organizer/references/migration-procedure.md`) before
proceeding; resume after it completes. `AHEAD` → announce the row
and tell the GM to update the plugin; do not proceed. `ERROR` →
report the row; the plugin install is broken — do not proceed.
No verdict row and a `not a directory` error on stderr means the
vault path is wrong — ask the GM for it rather than proceeding.
Fallback without python: read `gm_apprentice_version` from
`_meta/vault-config.md` and `current_version` from
`shared/migrations.md` (frontmatter only) and compare
component-by-component as numbers — `1.8.9` is older than `1.8.15`.

## The build tool

All build logic is handled by the `gm-apprentice-publish` tool, which
**ships inside this plugin** — it is not installed from the npm registry.
The copy to use lives in the plugin cache at:

```text
<plugin-cache-path>/gm-apprentice/<plugin-version>/tools/publish
```

Using the cache copy (not npm) is what keeps the renderer in lockstep
with this skill: both come from the same plugin install. Determine
`<plugin-version>` from `.claude-plugin/plugin.json` (or infer it from
this skill's own cache path). You never replicate or rewrite its logic.

**Scaffolding / one-off commands — run the tool from the cache:**

```bash
TOOL="<plugin-cache-path>/gm-apprentice/<plugin-version>/tools/publish/bin/gm-publish.js"
node "$TOOL" init <target-dir>   # scaffold a new site (auto-pins itself to this version)
node "$TOOL" update-pin --site <dir>                       # repoint + npm install a stale site
node "$TOOL" manifest diff --config <dir>/vault.config.json    # classify vault files vs the manifest
node "$TOOL" manifest apply --config <dir>/vault.config.json ...  # edit the manifest
node "$TOOL" deploy --verify --config <dir>/vault.config.json  # build, deploy, probe the URL
node "$TOOL" doctor --site --config <dir>/vault.config.json    # audit the vault for publish defects
node "$TOOL" explain "<vault-relative path>" --config <dir>/vault.config.json  # one file's publish chain
node "$TOOL" --version
node "$TOOL" --help
```

**Inside a scaffolded site — build with npm** (it resolves the tool from
the `file:` pin the scaffold wrote, so no registry and no network):

```bash
npm install      # links the pinned build tool (deps ship vendored)
npm run build    # generate docs/ from the vault
# print one PC's sheet — needs vault.config.json, so run it here
npx gm-apprentice-publish sheet show --pc <name> [--player-safe] [--json]
```

Node 22 or later is required. If the GM hits a version error,
advise them to install Node via https://nodejs.org (LTS release).

## Nine Capabilities

### 1. First-time setup

**Trigger:** "publish my campaign", "set up a site", "create a website
for my campaign", "I want players to see my campaign"

Follow the full conversational flow in `references/setup-wizard.md`.
That file is the authoritative step-by-step guide; work from it.
Do not improvise the setup flow or skip steps.

Setup is **preflight-first**: it runs a `gm-publish doctor` check before
anything is scaffolded, built, or deployed, clearing any missing tools or
credentials up front so nothing is discovered broken at the last step. It
defaults to Cloudflare Pages (GitHub Pages stays a full option), and it
**resumes** from `publish.setup_progress` in the vault if an earlier run
was interrupted.

### 2. Routine updates

**Trigger:** "update my site", "rebuild", "push new content",
"I've updated the vault, refresh the site"

Workflow:
1. Read `publish.site_dir` from `_meta/vault-config.md`. If not
   set, ask for the absolute path to the site repo directory and
   offer to save it to vault-config for future sessions.
2. `node "$TOOL" update-pin --site <dir>` — repoints the site's
   build-tool dependency at the current plugin cache version and
   runs `npm install` if it was stale. Report its one line.
3. `node "$TOOL" manifest diff --config <dir>/vault.config.json` —
   present its New/Removed files to the GM. After confirmation,
   `node "$TOOL" manifest apply --config <dir>/vault.config.json --publish <path>... --exclude "<path>=<reason>"... --prune`.
   Skip this step entirely when the diff prints no New/Removed.
4. `node "$TOOL" deploy --verify --config <dir>/vault.config.json` —
   builds, deploys per the `host` field in `vault.config.json`, and
   probes the URL. Relay its final line to the GM verbatim. On any
   non-zero exit, run `node "$TOOL" doctor --site --config
   <dir>/vault.config.json` and proceed as capability 3
   (troubleshooting). A Cloudflare deploy failing for missing
   credentials is the one case `deploy` diagnoses and explains
   inline — if the GM would rather set them up directly, run
   `node "$TOOL" doctor --set-cloudflare-creds`.

### 3. Troubleshooting

**Trigger:** error messages, "build crashed", "portraits not showing",
"page is missing", "links are broken", any build failure

Run `node "$TOOL" doctor --site --config <dir>/vault.config.json` first;
for a page that should be on the site and is not, `node "$TOOL" explain
"<vault-relative path>"`. Then `references/troubleshooting.md` for the
full diagnosis guide. Identify the failure mode, explain the cause in
plain language, then guide the GM to the fix step by step. Always offer
to apply the fix directly after explaining it.

### 4. Schema migrations

**Trigger:** "I added a new entity type", "campaign-organizer was updated",
"new folder in the vault", "pages missing after an update"

Workflow:
1. Read `publish.site_dir` from `_meta/vault-config.md` to
   locate the site repo. If not set, ask for the path and offer
   to save it. Then read `vault.config.json` from that directory.
2. Compare its `folderMap` to the vault's actual folder structure.
3. Propose any additions needed to `folderMap` or `excludeDirs`.
4. Apply changes after confirmation.
5. Run `npm run build` to confirm the migration is clean.
6. Explain briefly what the new entity type will render as
   (dedicated template or smart wiki fallback — see
   `references/schema-reference.md`).

### 5. Multi-site management

**Trigger:** "I have two campaigns", "update all my sites",
"which of my sites needs rebuilding"

When a GM manages more than one campaign site, track the site
repo paths and their vault paths in the conversation. Offer to
loop over all sites when doing routine updates. Confirm each site
individually before pushing.

### 6. Content filtering

**Trigger:** "only publish player content", "hide GM notes",
"filter my campaign for players", "set up player view",
"what will players see", "publish without spoilers"

Read `references/content-filtering.md` § Manifest Format first — in
`mode: player`, a file publishes only as a **checked** entry under
`## Publishing`; checking the box under `## Excluded` or
`## Needs Decision` doesn't publish it. `mode: full` doesn't filter by
the manifest at all.

Workflow:
1. Read `_meta/vault-config.md` for existing publish settings.
   If no `publish:` section exists, run first-time setup:
   - Ask the GM about their campaign's genre/tone for theming.
   - Ask if they have a campaign image or want one generated.
   - Offer genre-appropriate 404 messages.
   - Write initial config to `vault-config.md`.
2. Scan the vault and categorize every file:
   - **Always exclude:** prep files (`status: planned|prepped`,
     `stage: outline|draft|ready`), `source: "prep"` files,
     `_meta/`, `_Templates/`, `personal/` directories.
   - **Always include:** played sessions, standard entity files,
     `_Campaign/` overviews.
   - **Ambiguous:** scenes with `status: skipped|cut|modified`,
     files that don't match clear conventions.
3. Write the publish manifest to `_meta/publish-manifest.md`.
4. Present a summary and walk through ambiguous items.
5. Record each decision in the manifest itself — checked under
   `## Publishing`, or moved to `## Excluded` with a reason.
6. Confirm the manifest is ready for the build tool.

For subsequent publishes, the manifest delta check in
capability 2 (routine updates) handles new and removed files
automatically.

For full documentation of the filtering model, see
`references/content-filtering.md`.

### 7. Change-request loop (at-table)

**Trigger:** "start your checking loop", "pick up the change requests",
"open the inbox", "watch for sheet changes"

Follow `references/change-request-loop.md`. It runs an unattended, self-paced
loop that drains player sheet-edit requests, applies clean GURPS edits to the
vault, batches one rebuild + redeploy per tick, and flags edge cases. GURPS 4e
only for now.

### 8. Live status bar setup (Tier 2a)

**Trigger:** "turn on the status bar", "enable live vitals", "set up the
status bar", "let players update HP/FP live"

Cloudflare Pages only. Run `node "$TOOL" setup-status-bar` from the site
directory (defaults to `./vault.config.json`; pass `--config <path>`
otherwise). The command runs its own **KV-permission probe** first — it
lists KV namespaces to confirm the token can manage KV before touching
anything, mapping Cloudflare's `code: 10000` to the one-line fix
(edit the token to add **Account · Workers KV Storage · Edit**) — and
**idempotent**: safe to re-run, it reuses an existing `INBOX` KV namespace
instead of recreating one. On success it creates or reuses that namespace,
aligns `wrangler.toml`'s `name` to the Cloudflare project, flips
`backend.statusBar` to `true` in `vault.config.json`, rebuilds, and deploys —
one command, no manual `wrangler.toml` editing. Note: the roster/party board
already renders as a **static** initiative table at Tier 1 with no backend at
all; this command is what makes it live and update from players' phones.

### 9. At-table inbox setup (Tier 2b)

**Trigger:** "set up the inbox", "let players submit changes", "turn on the
change-request inbox"

Same command family as capability 8: run `node "$TOOL" setup-inbox` — equally
preflight-gated and idempotent, and sharing the same KV machinery
(**inbox ⇒ KV**: the namespace is required and ensured automatically, never a
separate manual step). It flips `backend.inbox` and is **infra-only** — it
does not open a session or write a `config:code`. Once the flag is live, use
capability 7 ("start your checking loop") for the actual at-table session.

## Configuration

Publish settings are split between `_meta/vault-config.md`
(authoritative source for filtering and theming) and
`vault.config.json` (site paths, URLs, display settings).
When both define the same setting, vault-config.md wins.

For the full settings reference, see
`references/configuration.md`.

## Companion Skills

- **campaign-organizer** — Vault structure and entity management.
  The publish-site skill reads what campaign-organizer creates.
  If a GM asks why pages are missing or why the schema doesn't match,
  the vault structure is usually the explanation.

- **ttrpg-expert** — Content generation. If a GM wants new content
  on their site, direct them to ttrpg-expert first, then rebuild.

- **campaign-qa** — Canon validation. A QA pass before publishing
  prevents broken links and missing entities from reaching the
  live site.

## Copyright Reminder

This skill generates site content from the GM's own vault files.
The site will be publicly accessible. Before publishing, remind
the GM that any licensed TTRPG content in the vault must be within
the bounds of its license when published publicly. See
`ATTRIBUTION.md` in the gm-apprentice repo for license details.

Do not copy, reproduce, or include licensed rule text in generated
site pages. If a vault note contains verbatim rules text from a
published source, flag it — the GM should paraphrase before publishing.

## Schema Reference

For details on which frontmatter fields each entity type renders,
read `references/schema-reference.md`.

## Cloudflare Pages Setup (recommended)

To host on Cloudflare Pages, read `references/cloudflare-pages.md` — it
covers creating an API token, handing it to
`node "$TOOL" doctor --set-cloudflare-creds` (which saves the credentials
to the right shell file and auto-derives your Account ID, so there's no
hand-editing `~/.zshenv`), setting `host: cloudflare-pages` + a `.pages.dev`
`siteUrl`, the first deploy, custom domains, and troubleshooting.

## GitHub Pages Setup

To host on GitHub Pages instead, read `references/github-pages.md` for the
manual enablement steps (after the initial push).

GitHub Pages and Cloudflare can run in parallel during a transition since
the built `docs/` folder is the same for both.
