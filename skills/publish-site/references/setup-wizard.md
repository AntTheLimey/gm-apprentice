# Setup Wizard — First-Time Campaign Site

This file describes the full conversational flow for setting up a
new campaign site from scratch. Work through the phases in order.

The flow is **preflight-first**: before anything is scaffolded, built,
or deployed, an automated preflight (Phase A) confirms the GM has
everything the chosen host needs, so nothing is discovered missing at
the last step. It is also **resumable** — progress is recorded in the
vault, so an interrupted run can pick up where it left off — and it
**verifies the deployed site is actually reachable** before declaring
success.

The build tool is run from the plugin cache. `$TOOL` refers to the
`gm-publish.js` path set up at the top of the publish walkthrough (see
`SKILL.md` → "The build tool"):

```text
$TOOL = <plugin-cache-path>/gm-apprentice/<plugin-version>/tools/publish/bin/gm-publish.js
```

Do not skip ahead. Some steps depend on answers from earlier ones.

---

## Before you start

Setup runs an **automated preflight** first (Phase A below) — it checks
for you that every tool the site needs is installed and connected, and
walks the GM through fixing anything that's missing, all **before**
touching a single file. There is no manual checklist to tick off here;
the preflight is the checklist, and it's tailored to whichever host the
GM picks.

There are two free host options:

- **Cloudflare Pages — recommended.** Fast global CDN, easy custom
  domains, image optimization, and it's the smoothest path for the
  live status bar and at-table inbox if the GM ever wants them. The
  wizard writes `host: cloudflare-pages` into the config.
- **GitHub Pages — a fully-supported alternative.** A good fit if the
  GM already uses GitHub. Nothing about the site is worse; only how it's
  deployed differs.

The site itself is identical either way. The GM picks in Phase A, and
that choice tailors the preflight and forks the deploy at the end.

---

## Phase A — Preflight (runs first)

Nothing is created or changed in this phase except the small
`publish.setup_progress` block in the vault (see "Resume state" below).
Every red must be cleared before moving to Phase B.

### Step 1: Locate and validate the vault

Ask:

> "What is the path to your campaign vault? This is the folder you
> work in — the one with your character notes, session files,
> locations, and so on. If you're using Obsidian, it's your vault
> folder."

Validate the vault by checking for a `_meta/` directory inside it.
If `_meta/` is not present, the folder may not be a gm-apprentice
vault. Explain:

> "I don't see a `_meta/` folder inside that path. This folder
> may not be set up as a gm-apprentice vault yet. Run
> campaign-organizer first to set up your vault structure, then
> come back here."

The vault must exist before anything else, because the resume state
lives inside it. If `_meta/` exists, confirm:

> "Found your vault. Continuing."

Record `vault_path` (see "Resume state" below).

### Step 2: Resume check

Read the frontmatter of `_meta/vault-config.md`. If a
`publish.setup_progress` block exists with `tier1_complete: false`,
setup was interrupted on an earlier run. Tell the GM:

> "It looks like we started setting up your site before and didn't
> finish. I can pick up right where we left off — no need to
> re-answer anything you already told me."

Resume from `last_completed_step`, reusing every gathered answer
already recorded (vault path, title, tagline, project/repo name, site
directory). Skip any step whose answer is already present.

If `tier1_complete: true`, Tier 1 setup already succeeded on this vault
— this is not first-time setup. Point the GM at "update my site" for a
refresh, or the tiered close (Phase G) if they want the status bar or
inbox. If the block is absent, start fresh.

### Step 3: Node check (chicken-and-egg)

The build tool is itself a Node program, so it cannot detect its own
absence. Check for Node directly with a bare command:

```bash
node --version
```

If that errors or Node is absent, send the GM to <https://nodejs.org>
and ask them to install the **LTS** release, then **stop** — do not
proceed until Node is present. If it prints a version (22 or later),
continue.

### Step 4: Choose the host

This is just a question — it touches nothing on disk yet. Ask:

> "Where would you like to host the site? Two free options:
> - **Cloudflare Pages** (recommended) — hosts on Cloudflare's
>   network, with a fast global CDN, easy custom domains, and image
>   optimization. It's also the smoothest path if you later want the
>   live status bar or the at-table change-request inbox.
> - **GitHub Pages** — hosts from a GitHub repository. A great fit if
>   you already use GitHub.
>
> The site itself is identical either way. I'd suggest Cloudflare
> Pages unless you already live in GitHub. Which would you like?"

Record the answer as `host` (`cloudflare-pages` or `github-pages`) in
`publish.setup_progress`. This choice parameterizes the preflight below
and forks the deploy in Phase E.

> Note: choosing Cloudflare means the wizard writes an explicit
> `host: cloudflare-pages` into `vault.config.json` later. This is a
> recommendation the wizard makes, not a change to how the build reads
> config: a site with **no** `host` field is still treated as GitHub
> Pages by the build. GitHub Pages remains a first-class, fully-supported
> choice.

### Step 5: Run the preflight doctor

With the host chosen, run the preflight check (it's host-parameterized,
so it must run after Step 4):

```bash
node "$TOOL" doctor --json --host <cloudflare-pages|github-pages>
```

It prints JSON describing each required tool, for example:

```text
{"node":{"ok":true,"version":"v22.3.0"},"git":{"ok":true},
 "gh":{"ok":false,"version":null,"authed":false},
 "wrangler":{"ok":true,"version":"4.x","authed":false,"accountId":null},
 "host":"cloudflare-pages","required":["node","git","wrangler"],"ok":false}
```

`ok: true` at the top level means every required tool is present **and**
the chosen host's deploy tool is authenticated. For Cloudflare it checks
`wrangler` (not `gh`); for GitHub it checks `gh` (not `wrangler`).

For each check that is `false`, apply the one-line fix and re-run
`doctor --json` until the relevant checks pass:

- **`git.ok: false`** → git isn't installed. Point the GM at the
  install line doctor prints for their OS, then re-run.
- **Cloudflare · `wrangler.authed: false`** → run the **token dance**:
  1. Point the GM at `references/cloudflare-pages.md` **Step 1** to
     create a Cloudflare API token scoped to **Cloudflare Pages · Edit**.
     Mention the optional one-tick **Workers KV Storage · Edit** row —
     if the GM might ever want the live status bar or the inbox, adding
     it now means never touching the token again.
  2. Save the token with the painless default (it writes the token to
     the right shell file, derives and saves the Account ID for you, and
     never prints the token back):

     ```bash
     node "$TOOL" doctor --set-cloudflare-creds
     ```

     A GM who'd rather the token never passes through the assistant can
     run the exact same command in their own terminal — see
     `cloudflare-pages.md` Step 2 for that one-line variant.
  3. Re-run `node "$TOOL" doctor --json --host cloudflare-pages` and
     confirm `wrangler.authed: true` with a non-null `accountId`.
- **GitHub · `gh.ok: false` or `gh.authed: false`** → offer
  `gh auth login` to install/authenticate the GitHub CLI, **or** record
  that the GM will use the manual repo-creation path in Phase E (that
  path creates the repo in a browser and does not require `gh`). GitHub
  is the only host allowed to proceed without its deploy tool authed,
  precisely because that manual fallback exists.

Proceed to Phase B only when `doctor` reports `ok: true` for the chosen
host — or, for GitHub specifically, the GM has explicitly accepted the
manual repo path.

---

## Resume state — `publish.setup_progress`

The wizard maintains a small block in the frontmatter of
`_meta/vault-config.md` so an interrupted run can resume. Add it under
the existing top-level `publish:` key — **do not** overwrite any other
`publish` settings already there (theme, four_oh_four, and so on); you
are adding a `setup_progress:` child alongside them.

```yaml
---
publish:
  setup_progress:
    host: cloudflare-pages         # or github-pages
    last_completed_step: 4         # highest completed step number
    started: "2026-07-22"          # ISO date the run began
    tier1_complete: false          # flips true only after post-deploy verify
    # gathered answers (added as each is confirmed):
    vault_path: "/abs/path/to/vault"
    site_title: "The Iron Crown"
    tagline: "A GURPS Special Forces campaign set in 1990s Britain."
    project_name: "iron-crown"     # Cloudflare project (or repo_name for GitHub)
    github_username: "jsmith"      # GitHub path only
    site_dir: "/abs/path/to/site"
    deferred: []                   # e.g. [status-bar, inbox] after the tiered close
---
```

Update `last_completed_step` and append each gathered answer as it's
confirmed. Rules:

- This block is **transient setup progress**, not durable config. It
  exists so a later run knows where the GM stopped and what they already
  answered.
- **Durable config** — `host`, `siteUrl`, `cloudflarePagesProject` (or
  the GitHub repo), the `backend` block, and output paths — lives in the
  site's `vault.config.json`, written once the site directory exists
  (Phase C). Do not try to keep durable config in `setup_progress`.
- On a fresh successful finish, set `tier1_complete: true` after the
  post-deploy verify (Phase F) succeeds. **Keep the block** — a later
  run reads it to know Tier 1 is done and what (if anything) was
  deferred.

---

## Phase B — Gather creative inputs

These are the conversational, creative steps. Keep them exactly as
open-ended as they are today — do not turn them into a rigid form.
Record the resume-relevant answers into `publish.setup_progress` as each
is confirmed, and advance `last_completed_step`.

### Step 6: Campaign display name

Ask:

> "What would you like to call your campaign site? This is the
> title that appears in the browser tab and on the homepage.
> For example: 'The Crimson Company' or 'Shadows Over Arkham'."

If `_Campaign/Campaign Overview.md` exists in the vault, read its
`title` frontmatter field and suggest it as a default:

> "I found a title in your campaign overview: '[title]'. Would
> you like to use that, or something different?"

Store the confirmed name as `site_title` (it becomes `siteTitle` in
`vault.config.json`).

### Step 7: Landing page tagline

Ask:

> "Give me one sentence that describes the campaign — something
> evocative that could appear on the homepage. Think of it as a
> back-of-the-book hook. For example:
> 'A GURPS Special Forces campaign set in 1990s Britain.'
> or
> 'A Regency-era Call of Cthulhu investigation in Bath, 1814.'"

Store as `tagline` (it becomes `landingTagline` in `vault.config.json`).

### Step 8: Name the site (host-specific)

**Cloudflare Pages:** ask only for a **project name**:

> "What should we call your Cloudflare project? Use lowercase
> letters, numbers, and hyphens — for example `iron-crown`. Your
> site will live at `https://<project>.pages.dev`."

Validate it's lowercase letters, numbers, and hyphens only; suggest a
corrected version if not. Store as `project_name`. Compose
`siteUrl`: `https://<project_name>.pages.dev`.

**GitHub Pages:** ask for username and repo:

> "What is your GitHub username? And what would you like to call
> the repository? For example, if your username is 'jsmith' and
> you want a repo called 'iron-crown-campaign', your site would
> live at `https://jsmith.github.io/iron-crown-campaign/`"

Validate the repo name is URL-safe (lowercase letters, numbers, hyphens
only); suggest a correction if not. Store `github_username` and the repo
name as `project_name`. Compose
`siteUrl`: `https://<github_username>.github.io/<project_name>/`.

### Step 9: Choose the site directory

Ask:

> "Where should the site files live on your computer? This will
> be a new folder separate from your vault.
>
> Suggested: create a folder called `<project_name>` on your
> Desktop or in your Documents folder. Give me the full path when
> ready."

For GitHub Pages, note this folder becomes the GitHub repository. Store
the confirmed path as `site_dir`.

### Step 10: Campaign image

Ask:

> "Do you have an existing campaign image you'd like to use on
> the site? This appears on the homepage and the 404 page. It
> could be a logo, a piece of art, or anything that represents
> your campaign."

**If the GM has an image:** ask for the vault-relative path (e.g.
`_attachments/campaign-image.svg`), validate the file exists, and store
it in `_meta/vault-config.md` under `publish.theme.campaign_image`.

**If the GM does not have an image:** offer to generate a procedural SVG:

> "I can generate a simple campaign image using your theme
> colours and genre-appropriate motifs. Want me to create one?"

If yes, generate the SVG, save it to `_attachments/campaign-image.svg`
in the vault, and store the path. If no, skip — the site works without
a campaign image.

### Step 11: 404 message

Ask:

> "When players follow a link to content that's been filtered
> out (GM-only pages), they'll see a themed 404 page. What
> message should it show? Here are some ideas:"

Suggest 2-3 genre-appropriate options based on the campaign's system or
tags. Examples:

- Horror: "The stars are not yet right for this knowledge..."
- Military: "CLASSIFIED — CLEARANCE LEVEL INSUFFICIENT"
- Fantasy: "This page has been lost to the mists..."
- Generic: "This content is not available."

Accept a custom message if the GM prefers. Store it in
`_meta/vault-config.md` under `publish.four_oh_four.message`.

### Step 12: Theme confirmation

Read genre tags from the vault's `_Campaign/Campaign Overview.md` or
`vault-config.md` if available. Propose a colour palette and font
pairing based on the genre:

> "Based on your campaign's genre, I'd suggest this theme:
> - Primary: [colour] / Accent: [colour] / Background: [colour]
> - Heading font: [font] / Body font: [font]
> Does that look right, or would you like to adjust?"

Store confirmed values in `_meta/vault-config.md` under
`publish.theme.palette` and `publish.theme.fonts`. If the GM wants to
skip theming, use the defaults (system-ui fonts, neutral blue-grey
palette).

---

## Phase C — Scaffold and configure

### Step 13: Scaffold the site

The build tool ships **inside the plugin** — never install it from the
npm registry. Run its `init` from the plugin cache so the scaffold pins
itself to the exact version the GM has installed:

```bash
node "$TOOL" init "<site_dir>"
```

Use the plugin cache path for the GM's OS (e.g.
`~/.claude/plugins/cache/gm-apprentice` on macOS/Linux). This creates
the following structure inside `<site_dir>`:

```text
<site_dir>/
├── package.json
├── vault.config.json
├── wrangler.toml        # minimal: pages_build_output_dir, no KV binding
├── css/
│   └── overrides.css
├── README.md
├── .gitignore
└── .nojekyll
```

The scaffold is intentionally minimal — no `functions/` directory and no KV
binding in `wrangler.toml`. Those are added only if the GM opts into the
at-table inbox or live status bar later (Phase G).

If the command fails with "command not found", explain:

> "That command needs Node.js. If you see 'command not found', your
> Node.js installation may not be on your PATH. Try restarting your
> terminal and running `node --version` first."

(In the normal flow Node was already confirmed in Phase A, so this is a
rare fallback.)

### Step 14: Confirm the build tool pin

`init` auto-pins the scaffold's `package.json` to the exact tool it ran
from — the plugin cache version — so there is no `"latest"` to replace
and no manual edit in the normal case:

```json
{
  "dependencies": {
    "gm-apprentice-publish": "file:<plugin-cache-path>/gm-apprentice/<plugin-version>/tools/publish"
  }
}
```

Open `package.json` and confirm the `gm-apprentice-publish` value is a
`file:` path ending in `/<plugin-version>/tools/publish`. If it shows
anything else (e.g. `"latest"` from an older scaffold, or an
out-of-date version), correct it to the path above — `<plugin-version>`
is the current gm-apprentice plugin version from
`.claude-plugin/plugin.json`.

This ensures the site always builds with the exact version of the
publish tool that matches the installed plugin.

**Why a `file:` cache pin (and not the npm registry or "auto-updating")?**
The tool is distributed with the plugin, not published as a live npm
package, so pinning to the cache is what keeps the renderer in lockstep
with the skill that drives it. A floating pin (like `"latest"`) would
resolve from the npm registry — which lags the plugin — and is how sites
silently went stale before. The build tool prints a loud
**version-drift warning** at the start of any build when a newer version
is installed in the cache, and routine updates (capability 2) repoint
the path and re-run `npm install` whenever the plugin version changes.
The tool ships its runtime dependencies **vendored**, so a freshly-pinned
cache version builds with no download step — `npm install` only re-links
the package.

### Step 15: Fill in vault.config.json

Open `vault.config.json` in `<site_dir>` and update these fields with
the values gathered in Phase B. From here on, durable config lives in
this file; `setup_progress` continues only to track `last_completed_step`
for resume.

**Cloudflare Pages (recommended):**

```json
{
  "vaultPath": "<vault_path from Step 1>",
  "siteTitle": "<site_title from Step 6>",
  "landingTagline": "<tagline from Step 7>",
  "host": "cloudflare-pages",
  "cloudflarePagesProject": "<project_name>",
  "siteUrl": "https://<project_name>.pages.dev",
  "outputDir": "./docs",
  "backend": { "statusBar": false, "inbox": false }
}
```

**GitHub Pages:**

```json
{
  "vaultPath": "<vault_path from Step 1>",
  "siteTitle": "<site_title from Step 6>",
  "landingTagline": "<tagline from Step 7>",
  "host": "github-pages",
  "siteUrl": "https://<github_username>.github.io/<project_name>/",
  "outputDir": "./docs",
  "backend": { "statusBar": false, "inbox": false }
}
```

**Verify the Tier-1 backend default is present.** `init` writes
`"backend": { "statusBar": false, "inbox": false }` into
`vault.config.json` for you. Confirm that block is present and leave it
as-is — do **not** remove it or flip either value. This keeps the live
status bar and the at-table inbox off until the GM explicitly opts in
(Phase G); flipping them on here would surface backend UI on a site
that has no KV namespace behind it.

The other fields (`folderMap`, `excludeDirs`, `excludeSections`,
`attachmentsDir`) are pre-filled with sensible defaults. Leave them
as-is unless the vault uses non-standard folder names. Apply these
changes directly to the file — do not ask the GM to edit JSON by hand
unless they prefer to.

---

## Phase D — Build and filter

### Step 16: Link the build tool

In the terminal, navigate to `<site_dir>` and run:

```bash
npm install
```

This links the `gm-apprentice-publish` build tool from the plugin cache
(the `file:` pin from Step 14). The tool ships its dependencies vendored,
so this just creates the link — it downloads nothing and works offline.

### Step 17: Initial build

Run:

```bash
npm run build
```

Watch the output. A successful build ends with a summary line like:

```text
Built N pages → docs/
```

If the build fails, switch to the troubleshooting flow (see
`troubleshooting.md`). Common causes: wrong `vaultPath` in the config,
unreadable YAML in a vault file, or a path with backslashes (Windows
users should use forward slashes or double backslashes in the config).

Note: the build tool automatically excludes prep files
(`status: planned|prepped`, `stage: outline|draft|ready`,
`source: "prep"`) even without a manifest. The page count shown here
reflects only publishable content.

### Step 18: Review the initial build

Tell the GM:

> "The build produced N pages. Before we publish, let's review
> what will be visible to your players and make sure no GM-only
> content slips through."

Open `<site_dir>/docs/index.html` in a browser for a quick visual check.
If anything looks wrong (wrong pages, missing content, broken layout),
troubleshoot before continuing.

### Step 19: Create the publish manifest

Run the content-filtering workflow from `references/content-filtering.md`:

1. Scan the vault and categorize every file using the rules in
   `content-filtering.md` (always exclude, always include, ambiguous).
2. Present a summary to the GM: how many files are publishing, how many
   are excluded, how many need a decision.
3. Walk through ambiguous files one at a time. For each one, ask the GM:
   publish or exclude?
4. Write the manifest to `_meta/publish-manifest.md`.

Tell the GM:

> "I've created a publish manifest — it controls exactly which
> files appear on your site. You can edit it any time to add or
> remove pages."

### Step 20: Filtered rebuild

Rebuild with the manifest in place:

```bash
npm run build
```

Confirm the page count dropped to player-safe content:

> "Rebuilt with filtering: N pages (down from M). Only
> player-visible content will be published."

If the GM wants to adjust, edit the manifest and rebuild again.

---

## Phase E — Deploy (host-branched)

The deploy differs by host. Follow the branch that matches the GM's
Phase A choice. A failed deploy routes to `troubleshooting.md` (and, for
Cloudflare, `cloudflare-pages.md` → "Troubleshooting") — never a raw
error dump.

### Step 21a: Deploy to Cloudflare Pages (recommended)

The Tier-1 scaffold ships a `wrangler.toml` with
`pages_build_output_dir = "docs"`, so the deploy uses the **bare** form
(no `docs/` argument — passing the directory positionally conflicts with
the config and errors). The bare form deploys to whichever project is
named in `wrangler.toml`'s `name` field, not to `cloudflarePagesProject`
— so before deploying, make sure that field matches `<project_name>`
(edit it if the GM chose a different Cloudflare project name than the
one the scaffold started with). Skipping this fails the deploy with
"The Pages project '<name>' does not exist." Create the project once,
then deploy:

```bash
npx wrangler@4 pages project create <project_name> --production-branch=main   # once per site
npx wrangler@4 pages deploy                                                   # wrangler.toml present → no docs/ arg
```

> **Confirm the deploy form before running it.** If a `wrangler.toml`
> with `pages_build_output_dir` exists in the site root (the scaffold
> ships one, so it should), use the **bare** `pages deploy` above. If
> that file is somehow absent, use the explicit form instead:
>
> ```bash
> npx wrangler@4 pages deploy docs/ --project-name=<project_name> --branch=main --commit-dirty=true
> ```

The deploy prints two URLs: a per-deploy snapshot
(`https://<hash>.<project>.pages.dev`) and the live site
(`https://<project>.pages.dev`) — the live one is what you verify and
share. If `project create` reports "a project with this name already
exists," skip it and run `deploy` directly. If the deploy fails on
authentication, re-check the token dance (Phase A, Step 5) — almost
always the credentials need `node "$TOOL" doctor --set-cloudflare-creds`
re-run. Then continue to Phase F.

### Step 21b: Deploy to GitHub Pages

Initialise git, commit, and push, then enable Pages.

The scaffold's `.gitignore` already keeps `vault.config.json` (which holds
the absolute `vaultPath` on the GM's machine) out of the repo, so no manual
edit is needed before committing:

```bash
git init
git branch -M main
git add .
git commit -m "Initial site scaffold"
```

(Only the built `docs/` folder and the scaffold's public files are
published; the local build config stays on the GM's machine.)

**Create the repository.** If `gh` is available and authenticated (from
Phase A), ask:

> "I can create the GitHub repository and push everything for you.
> Shall I go ahead? The repo will be called `<project_name>` and
> will be public (required for free GitHub Pages)."

After confirmation:

```bash
gh repo create <project_name> --public --source . --remote origin --push
```

**If the GM chose the manual path in Phase A** (no `gh`):

1. Go to <https://github.com/new>
2. Set the repository name to `<project_name>`
3. Set visibility to **Public** (required for free GitHub Pages)
4. Do **not** initialise with a README — you already have one
5. Click **Create repository**
6. Copy the remote URL shown next (it looks like
   `https://github.com/<github_username>/<project_name>.git`)
7. In the terminal, run:

   ```bash
   git remote add origin https://github.com/<github_username>/<project_name>.git
   git push -u origin main
   ```

**Enable GitHub Pages.** If `gh` was used, offer to enable it
programmatically:

```bash
gh api repos/<github_username>/<project_name>/pages \
  -X POST \
  -f "build_type=legacy" \
  -f "source[branch]=main" \
  -f "source[path]=/docs"
```

If that command fails (permissions, Pages already enabled) or `gh` isn't
available, direct the GM to `references/github-pages.md` for the manual
two-minute enablement steps. Then continue to Phase F.

---

## Phase F — Verify the site is live

### Step 22: Verify the site is live

Do not declare victory blind. After the deploy reports success, confirm
the site is actually reachable by probing the **root** URL with a bounded
request that follows redirects and prints the final status code:

```bash
curl -sS -L --connect-timeout 5 --max-time 15 -o /dev/null -w '%{http_code}\n' "<siteUrl>"
# expect a 2xx (normally 200) on the root URL
```

- This is a bounded `GET` (`--max-time 15`), not a bare `HEAD` — some
  hosts serve the root fine on `GET` but reject `HEAD`, and `--location`
  (`-L`) follows any redirect to the canonical URL. Treat any 2xx
  (200–299) as live.
- Retry with a small bound — up to 3 attempts, roughly 20 seconds apart
  — to allow for first-deploy propagation.
- **On a 2xx:** tell the GM the site **is live** at `<siteUrl>`
  and to share that URL with their players.
- **If it never returns 2xx within the retries:** give the honest
  status rather than claiming it's live —

  > "The deploy uploaded successfully, but the host is still building
  > and propagating your site. Give it a minute, then open
  > `<siteUrl>` — it should come up shortly."

  For a brand-new Cloudflare project the custom **404 route** can take a
  few minutes to propagate, which is why we probe the root URL (a real
  page that goes live first), not a missing path.

Only after a confirmed 2xx — or the GM acknowledging the "still
building" state — set `tier1_complete: true` in
`publish.setup_progress`. Keep the block.

---

## Phase G — Tiered close

### Step 23: Tier 1 done, then offer the upgrades

**Tier 1 is complete:** the GM has a live, shareable campaign site. Give
them the URL and the refresh line:

> "Your campaign site is live at `<siteUrl>`. Share that URL with your
> players.
>
> Whenever you update your vault and want to refresh the site, just tell
> me 'update my site' and I'll rebuild and re-deploy for you."

**Then offer the two optional backend upgrades** — as **separate,
named, independent** opt-ins. Neither is required for a working site,
and each can be set up later:

- **Live status bar** — players see and update their HP/FP (and similar
  live stats) from their phones during play, in real time.
- **At-table change-request inbox** — players submit sheet edits and
  questions from their phones during a session; you review and apply
  them.

> "Your site works great as-is. Two optional add-ons you can turn on now
> or any time later — they're independent, so you can take one, both, or
> neither:
> - a **live status bar** so players can update HP/FP from their phones,
>   and
> - an **at-table change-request inbox** for sheet edits during play.
> Want to set up either now?"

**Honesty constraint — do not promise a one-command setup that doesn't
exist yet.** The streamlined `setup-status-bar` / `setup-inbox` commands
are not built yet. So:

- **If the GM wants one now:** record it in `setup_progress.deferred`
  (e.g. `deferred: [status-bar]`, `deferred: [inbox]`, or both), and
  point them at the current manual path:
  - **Inbox:** follow `references/cloudflare-pages.md` →
    "Change-request inbox" (create the KV namespace, paste its id into
    `wrangler.toml`, redeploy).
  - **Status bar:** it reuses the **same KV namespace** as the inbox —
    so if the inbox is set up (or the token already has the
    **Workers KV Storage · Edit** permission from Phase A), the
    groundwork is shared.

  Tell them a one-command setup for these is coming, but this manual
  path works today.
- **If the GM defers both:** leave `deferred: []` and tell them:

  > "No problem — whenever you're ready, just say 'set up the status
  > bar' or 'set up the inbox' and I'll walk you through it."

Setup is complete.
