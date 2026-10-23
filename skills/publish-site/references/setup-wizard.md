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

## Where the answers are kept

Nothing is held in your head between steps: each answer is written
down as the GM gives it, so an interrupted run loses nothing.

- **An answer that is a setting** (the title, tagline, image, 404
  message, palette, fonts, and at Step 8 the site's host and address)
  is written at once with
  `node "$TOOL" settings set <name>=<value> --vault <vault>` and read
  back with `settings get <name> --vault <vault>`. To change a hiding
  list use `settings add` or `remove`: `set` replaces the whole list,
  built-in entries included.
- **Everything else** (the project name, the site folder, how far the
  run got, and the host until Step 8 writes it) goes in the set-up
  note:

  ```bash
  node "$TOOL" settings setup-note set last_completed_step=4 host=cloudflare-pages --vault <vault>
  node "$TOOL" settings setup-note get --vault <vault>
  ```

  `set` keeps the keys already there; `get` prints one `key: value`
  line each, or `No set-up note.`

After each step, `setup-note set last_completed_step=<N>` with any
answer the step names. Never open or edit a file in `_meta/` for any
of this.

---

## Phase A — Preflight (runs first)

Nothing is created or changed in this phase except the set-up note.
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

The vault must exist before anything else, because the set-up note
lives inside it. If `_meta/` exists, confirm:

> "Found your vault. Continuing."

This path is `<vault>` in every command below.

### Step 2: Resume check

Run `node "$TOOL" settings setup-note get --vault <vault>`. (If the
shell cannot find `node`, do Step 3 and come back.)

- **`No set-up note.`** Start fresh: `setup-note set started=<today>
  last_completed_step=1`.
- **A note with `tier1_complete: true`.** The site was already set up:
  this is not first-time setup. Point the GM at "update my site" for a
  refresh, or the tiered close (Phase G) if they want the status bar or
  inbox.
- **Any other note.** Setup was interrupted on an earlier run. Tell the
  GM:

  > "It looks like we started setting up your site before and didn't
  > finish. I can pick up right where we left off — no need to
  > re-answer anything you already told me."

  Carry on from the step after `last_completed_step`. The note holds
  the host, project name and site folder; `settings get player_site
  --vault <vault>` shows the settings already given (the lines not
  marked `(default)`). Skip a step whose answer is there. If the run
  is past Step 8 and `player_site.host` or `player_site.url` still
  reads `(default)`, run Step 8's command now from the note; when the
  note has no project name, ask the GM for it before going on. A note begun
  before plugin 1.10.54 may hold `site_title` or `tagline`: write each
  to its setting now (Steps 6 and 7).

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

Record the answer in the set-up note as `host` (`cloudflare-pages` or
`github-pages`). This choice parameterizes the preflight below and
forks the deploy in Phase E.

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

## Phase B — Gather creative inputs

These are the conversational, creative steps. Keep them exactly as
open-ended as they are today — do not turn them into a rigid form.
Write each answer down as it is confirmed (see "Where the answers are
kept") and advance `last_completed_step`.

### Step 6: Campaign display name

Ask:

> "What would you like to call your campaign site? This is the
> title that appears in the browser tab and on the homepage.
> For example: 'The Crimson Company' or 'Shadows Over Arkham'."

If `_Campaign/Campaign Overview.md` exists in the vault, read its
`title` frontmatter field and suggest it as a default:

> "I found a title in your campaign overview: '[title]'. Would
> you like to use that, or something different?"

Write the confirmed name:

```bash
node "$TOOL" settings set player_site.title="<title>" --vault <vault>
```

If it answers that the vault has no settings file yet, run it again
with `--create`. Later steps name the setting only; the command is
the same.

### Step 7: Landing page tagline

Ask:

> "Give me one sentence that describes the campaign — something
> evocative that could appear on the homepage. Think of it as a
> back-of-the-book hook. For example:
> 'A GURPS Special Forces campaign set in 1990s Britain.'
> or
> 'A Regency-era Call of Cthulhu investigation in Bath, 1814.'"

Write it: `settings set player_site.theme.tagline="<tagline>"`.

### Step 8: Name the site (host-specific)

**Cloudflare Pages:** ask only for a **project name**:

> "What should we call your Cloudflare project? Use lowercase
> letters, numbers, and hyphens — for example `iron-crown`. Your
> site will live at `https://<project>.pages.dev`."

Validate it's lowercase letters, numbers, and hyphens only; suggest a
corrected version if not, then `setup-note set project_name=<name>`
and write the host, the project and the site's address:

```bash
node "$TOOL" settings set player_site.host=cloudflare-pages player_site.cloudflare_project=<project_name> player_site.url=https://<project_name>.pages.dev --vault <vault>
```

**GitHub Pages:** ask for username and repo:

> "What is your GitHub username? And what would you like to call
> the repository? For example, if your username is 'jsmith' and
> you want a repo called 'iron-crown-campaign', your site would
> live at `https://jsmith.github.io/iron-crown-campaign/`"

Validate the repo name is URL-safe (lowercase letters, numbers, hyphens
only); suggest a correction if not, then `setup-note set
github_username=<user> project_name=<repo>` and write the host and
the site's address:

```bash
node "$TOOL" settings set player_site.host=github-pages player_site.url=https://<github_username>.github.io/<project_name>/ --vault <vault>
```

### Step 9: Choose the site directory

Ask:

> "Where should the site files live on your computer? This will
> be a new folder separate from your vault.
>
> Suggested: create a folder called `<project_name>` on your
> Desktop or in your Documents folder. Give me the full path when
> ready."

For GitHub Pages, say that this folder becomes the GitHub repository.
Then `setup-note set site_dir="<path>"`.

### Step 10: Campaign image

Ask:

> "Do you have an existing campaign image you'd like to use on
> the site? This appears on the homepage and the 404 page. It
> could be a logo, a piece of art, or anything that represents
> your campaign."

**If the GM has an image:** ask for the vault-relative path (e.g.
`_attachments/campaign-image.svg`), validate the file exists, and
`settings set player_site.theme.campaign_image=<path>`.

**If the GM does not have an image:** offer to generate a procedural SVG:

> "I can generate a simple campaign image using your theme
> colours and genre-appropriate motifs. Want me to create one?"

If yes, generate the SVG, save it to `_attachments/campaign-image.svg`
in the vault, and set the same setting to that path. If no, skip — the
site works without a campaign image.

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

Accept a custom message if the GM prefers, then
`settings set player_site.not_found="<message>"`.

### Step 12: Theme confirmation

Read the genre from the vault's `_Campaign/Campaign Overview.md`, or
judge it from `settings get vault.system`. Propose a colour palette and
font pairing based on the genre:

> "Based on your campaign's genre, I'd suggest this theme:
> - Primary: [colour] / Accent: [colour] / Background: [colour]
> - Heading font: [font] / Body font: [font]
> Does that look right, or would you like to adjust?"

Write the confirmed values in one command:

```bash
node "$TOOL" settings set player_site.theme.palette.primary=#2b1d0e player_site.theme.palette.accent=#8a5a2b player_site.theme.palette.background=#f4ecd8 player_site.theme.fonts.heading="Cormorant Garamond" player_site.theme.fonts.body="EB Garamond" player_site.theme.fonts.source=self-host --vault <vault>
```

Always include `player_site.theme.fonts.source=self-host` when fonts
are chosen: the build downloads them once into the vault's
`_meta/font-cache/` and serves them from the site, so players' browsers
never contact Google (an IP-address and GDPR concern). If the GM wants
to skip theming, set nothing.

---

## Phase C — Scaffold and configure

### Step 13: Scaffold the site

The build tool ships **inside the plugin** — never install it from the
npm registry. Run its `init` from the plugin cache so the scaffold pins
itself to the exact version the GM has installed:

```bash
node "$TOOL" init "<site_dir>" --vault "<vault>"
```

Use the plugin cache path for the GM's OS (e.g.
`~/.claude/plugins/cache/gm-apprentice` on macOS/Linux). `<site_dir>`
is the set-up note's `site_dir`. Pass the absolute vault path from
Step 1: `--vault` records it as `vaultPath` in the site file and tells
`init` which vault's settings to write (without it `init` assumes
`./vault` inside the site directory). This creates the following
structure inside `<site_dir>`:

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

`init` also writes the vault's starting settings and prints their
names on its last line (`wrote player_site.publish,
player_site.folder, …`, each as the vault's own file writes it): that
the vault has a site and where,
which folders publish, and the folders, headings and fields players
never see. A setting already there, such as the Step 6 title, is left
alone.

If `init` prints `Campaign settings were not written: …`, the site
folder was made but the vault's settings could not be changed, and
without them no folder publishes. The message says why. Mend that
(`settings check --vault <vault>` names a fault in the file; for a
file that is not valid YAML see campaign-qa's
`references/checks/settings.md`, last paragraph), delete the files
`init` just listed as created, and run `init` again.

If the command fails with "command not found", explain:

> "That command needs Node.js. If you see 'command not found', your
> Node.js installation may not be on your PATH. Try restarting your
> terminal and running `node --version` first."

(In the normal flow Node was already confirmed in Phase A, so this is a
rare fallback.)

### Step 14: Confirm the build tool pin

Run `node "$TOOL" update-pin --site <site_dir>` and report what it
prints. It points the site's `package.json` at the installed plugin's
copy of the tool when it names any other copy. If it prints `could
not record` or `npm install left`, show the GM those lines and stop.

### Step 15: Check the settings

The site folder's `vault.config.json` holds only where the vault is,
and `init` wrote that. Everything else is a setting in the vault:

```bash
node "$TOOL" settings check --config <site_dir>/vault.config.json
node "$TOOL" settings get player_site --config <site_dir>/vault.config.json
```

`check` says `Every setting in the file reads cleanly.` or lists the
faults; for a fault, see `configuration.md` § When a setting stops the
build. `get` lists every site setting; the lines not marked
`(default)` are this vault's, and should show the Phase B answers,
the Step 8 address among them.

Ask whether the vault has GM-only headings or frontmatter fields of
its own, and add each: `settings add player_site.hide.sections "<heading>"`
(or `player_site.hide.fields`). `add` keeps the entries already there.
Leave the folder map and the hidden folders as written unless the
vault uses non-standard folder names. Leave the live status bar and
inbox switches alone until the GM opts in (Phase G), and the character
sheets switch too unless the GM asks to keep sheets off the site — see
`configuration.md` § Switches. Make these changes yourself; do not ask
the GM to edit a file.

---

## Phase D — Build and filter

### Step 16: Link the build tool

From `<site_dir>` run `npm install`. It links the tool Step 14
pinned; the tool's dependencies ship with it, so nothing downloads.

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
(`status: planned|prepped`, `source: "prep"`) even without a manifest. The page count shown here
reflects only publishable content.

### Step 18: Review the initial build

Tell the GM:

> "The build produced N pages. Before we publish, let's review
> what will be visible to your players and make sure no GM-only
> content slips through."

Open `<site_dir>/docs/index.html` in a browser for a quick visual check.
If anything looks wrong (wrong pages, missing content, broken layout),
troubleshoot before continuing.

### Step 19: Create the publish list

Run the content-filtering workflow from `references/content-filtering.md`:

1. Scan the vault and categorize every file using the rules in
   `content-filtering.md` (always exclude, always include, ambiguous).
2. Present a summary to the GM: how many files are publishing, how many
   are excluded, how many need a decision.
3. Walk through ambiguous files one at a time. For each one, ask the GM:
   publish or exclude?
4. Record the decisions with `node "$TOOL" manifest apply --config <dir>/vault.config.json --publish <path>... --exclude "<path>=<reason>"...`.

Tell the GM:

> "I've made a publish list — it controls exactly which files
> appear on your site. Ask me any time to add or remove pages."

### Step 20: Filtered rebuild

Rebuild with the publish list in place:

```bash
npm run build
```

Confirm the page count dropped to player-safe content:

> "Rebuilt with filtering: N pages (down from M). Only
> player-visible content will be published."

If the GM wants to adjust, change the list with `manifest apply` and rebuild again.

---

## Phase E — Deploy (host-branched)

The deploy differs by host. Follow the branch that matches the GM's
Phase A choice. A failed deploy routes to `troubleshooting.md` (and, for
Cloudflare, `cloudflare-pages.md` → "Troubleshooting") — never a raw
error dump.

### Step 21a: Deploy to Cloudflare Pages (recommended)

Create the Cloudflare Pages project once, then deploy:

```bash
npx wrangler@4 pages project create <project_name> --production-branch=main   # once per site
node "$TOOL" deploy --verify --config vault.config.json
```

If `project create` reports "a project with this name already exists,"
skip it and run `deploy` directly. `deploy --verify` builds, deploys, and
probes the deployment wrangler printed in one step (exit 1 when it
cannot tell which build is served) — relay its final line to the GM
verbatim. If it fails on authentication, re-check the token dance
(Phase A, Step 5): `node "$TOOL" doctor --set-cloudflare-creds`. A
deploy failure otherwise routes to `troubleshooting.md` (and
`cloudflare-pages.md` → "Troubleshooting"). Then continue to Phase F.

### Step 21b: Deploy to GitHub Pages

Follow `github-pages.md` § First deploy, then go on to Phase F.

---

## Phase F — Verify the site is live

### Step 22: Verify the site is live

Do not declare victory blind. **Cloudflare (Step 21a):** `deploy
--verify` already probed the URL and its final line said whether it
came back live — relay that line. **GitHub Pages (Step 21b), either
path:** neither the manual `deploy` push nor the `gh repo create
--push` push ran with `--verify` (Pages wasn't enabled yet at that
point), so run the probe now:

```bash
node "$TOOL" deploy --verify --no-build --config vault.config.json
```

- **On a 2xx / "live at `<url>`":** tell the GM the site **is live** at
  `<url>` and to share that URL with their players.
- **If it reported not-yet-live:** give the honest status rather than
  claiming it's live —

  > "The deploy uploaded successfully, but the host is still building
  > and propagating your site. Give it a minute, then open
  > `<url>` — it should come up shortly."

  Retry the same `deploy --verify --no-build` command in a minute
  rather than rebuilding again. For a brand-new Cloudflare project the
  custom **404 route** can take a few minutes to propagate, which is
  why the probe hits the root URL (a real page that goes live first),
  not a missing path.

Only after a confirmed live result — or the GM acknowledging the "still
building" state — run `setup-note set tier1_complete=true`. Keep the
note: Step 2 of a later run reads it.

---

## Phase G — Tiered close

### Step 23: Tier 1 done, then offer the upgrades

**Tier 1 is complete:** the GM has a live, shareable campaign site. Give
them the URL and the refresh line:

> "Your campaign site is live at `<url>`. Share that URL with your
> players.
>
> Whenever you update your vault and want to refresh the site, just tell
> me 'update my site' and I'll rebuild and re-deploy for you."

**Then offer the two optional backend upgrades** — as **separate,
named, independent** opt-ins. Neither is required for a working site,
and each can be set up later:

- **Live status bar** — players see and update their hit points and the
  like (HP and FP in GURPS; hit points, Sanity and Luck in Call of Cthulhu;
  hit points, spell slots and uses in D&D) from their phones during play,
  in real time. (The roster page already shows a static party table at
  Tier 1 — this is what makes it live.)
- **At-table change-request inbox** — players submit sheet edits and
  questions from their phones during a session; you review and apply
  them.

> "Your site works great as-is. Two optional add-ons you can turn on now
> or any time later — they're independent, so you can take one, both, or
> neither:
> - a **live status bar** so players can update their hit points and the
>   like from their phones, and
> - an **at-table change-request inbox** for sheet edits during play.
> Want to set up either now?"

**If the GM wants one now**, run it from the site directory
(Cloudflare only; `--config <path>` if not `./vault.config.json`):

```bash
node "$TOOL" setup-status-bar   # Tier 2a — live status bar
node "$TOOL" setup-inbox        # Tier 2b — at-table change-request inbox
```

Each checks first, is safe to re-run, turns its switch on, rebuilds
and deploys. If it stops with the KV-permission fix, walk the GM
through it (`cloudflare-pages.md` § The fast way), then re-run.
`setup-inbox` opens no session: that is "start your checking loop"
(capability 7).

Nothing records which add-on was put off: the two switches say what
is on (`settings get player_site.features`). If the GM puts one off,
tell them:

> "No problem — whenever you're ready, just say 'set up the status
> bar' or 'set up the inbox' and I'll set it up with one command."

Setup is complete.
