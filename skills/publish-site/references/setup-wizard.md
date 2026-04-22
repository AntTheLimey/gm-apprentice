# Setup Wizard — First-Time Campaign Site

This file describes the full conversational flow for setting up a
new campaign site from scratch. Follow these steps in order.
Do not skip ahead. Some steps depend on answers from earlier ones.

---

## Before you start

Check that the GM has the following:

- A terminal or command prompt (Terminal on macOS, Command Prompt
  or PowerShell on Windows, any shell on Linux)
- Node.js 22 or later installed — check with `node --version`
- Git installed — check with `git --version`
- A GitHub account

If any of these are missing, address them before continuing. For
Node.js, send the GM to https://nodejs.org and ask them to install
the **LTS** release.

---

## Step 1: Locate the vault

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

If `_meta/` exists, confirm:

> "Found your vault. Continuing."

---

## Step 2: Campaign display name

Ask:

> "What would you like to call your campaign site? This is the
> title that appears in the browser tab and on the homepage.
> For example: 'The Crimson Company' or 'Shadows Over Arkham'."

If `_Campaign/Campaign Overview.md` exists in the vault, read
its `title` frontmatter field and suggest it as a default:

> "I found a title in your campaign overview: '[title]'. Would
> you like to use that, or something different?"

Store the confirmed name as `siteTitle`.

---

## Step 3: Landing page tagline

Ask:

> "Give me one sentence that describes the campaign — something
> evocative that could appear on the homepage. Think of it as a
> back-of-the-book hook. For example:
> 'A GURPS Special Forces campaign set in 1990s Britain.'
> or
> 'A Regency-era Call of Cthulhu investigation in Bath, 1814.'"

This becomes the `landingTagline` in `vault.config.json`.

---

## Step 4: GitHub username and repo name

Ask:

> "What is your GitHub username? And what would you like to call
> the repository? For example, if your username is 'jsmith' and
> you want a repo called 'iron-crown-campaign', your site would
> live at https://jsmith.github.io/iron-crown-campaign/"

Validate that the repo name is URL-safe: lowercase letters,
numbers, and hyphens only. If not, suggest a corrected version.

Store `githubUsername` and `repoName`. Compose:

- `siteUrl`: `https://<githubUsername>.github.io/<repoName>/`

---

## Step 5: Choose the site directory

Ask:

> "Where should the site files live on your computer? This will
> be a new folder separate from your vault. It will become the
> GitHub repository.
>
> Suggested: create a folder called `<repoName>` on your Desktop
> or in your Documents folder. Give me the full path when ready."

Once confirmed, store as `targetDir`.

---

## Step 6: Scaffold the site

Run:

```bash
npx gm-apprentice-publish init "<targetDir>"
```

This creates the following structure inside `<targetDir>`:

```text
<targetDir>/
├── package.json
├── vault.config.json
├── css/
│   └── overrides.css
├── README.md
├── .gitignore
└── .nojekyll
```

If the command fails with "command not found", explain:

> "npx is part of Node.js. If you see 'command not found', your
> Node.js installation may not be on your PATH. Try restarting
> your terminal and running `node --version` first."

---

## Step 7: Fill in vault.config.json

Open `vault.config.json` in `<targetDir>` and update these fields
with the values gathered above:

```json
{
  "vaultPath": "<vault path from Step 1>",
  "siteTitle": "<campaign display name from Step 2>",
  "landingTagline": "<tagline from Step 3>",
  "siteUrl": "https://<githubUsername>.github.io/<repoName>/",
  "outputDir": "./docs"
}
```

The other fields in the file (`folderMap`, `excludeDirs`,
`attachmentsDir`) are pre-filled with sensible defaults. Leave
them as-is for now unless the vault uses non-standard folder names.

Apply these changes directly to the file. Do not ask the GM to
edit the JSON manually unless they prefer to.

---

## Step 8: Install dependencies

In the terminal, navigate to `<targetDir>` and run:

```bash
npm install
```

This installs the `gm-apprentice-publish` package and its
dependencies. It will take a moment on first run.

---

## Step 9: Initial build

Run:

```bash
npm run build
```

Watch the output. A successful build ends with a summary line like:

```text
Built N pages → docs/
```

If the build fails, switch to the troubleshooting flow
(see `troubleshooting.md`). Common causes: wrong `vaultPath` in
the config, unreadable YAML in a vault file, or a path that
contains backslashes (Windows users should use forward slashes
or double backslashes in the config).

Note: The build tool automatically excludes prep files
(`status: planned|prepped`, `stage: outline|draft|ready`,
`source: "prep"`) even without a manifest. The page count
shown here reflects only publishable content.

---

## Step 10: Review initial build

Tell the GM:

> "The build produced N pages. Before we publish, let's review
> what will be visible to your players and make sure no GM-only
> content slips through."

Open `<targetDir>/docs/index.html` in a browser for a quick
visual check. If anything looks wrong (wrong pages, missing
content, broken layout), troubleshoot before continuing.

---

## Step 11: Create publish manifest

Run the content-filtering workflow from `references/content-filtering.md`:

1. Scan the vault and categorize every file using the rules in
   `content-filtering.md` (always exclude, always include,
   ambiguous).
2. Present a summary to the GM: how many files are publishing,
   how many are excluded, how many need a decision.
3. Walk through ambiguous files one at a time. For each one,
   ask the GM: publish or exclude?
4. Write the manifest to `_meta/publish-manifest.md`.

Tell the GM:

> "I've created a publish manifest — it controls exactly which
> files appear on your site. You can edit it any time to add or
> remove pages."

---

## Step 12: Filtered rebuild

Rebuild with the manifest in place:

```bash
npm run build
```

Confirm the page count dropped to player-safe content:

> "Rebuilt with filtering: N pages (down from M). Only
> player-visible content will be published."

If the GM wants to adjust, edit the manifest and rebuild again.

---

## Step 13: Initialise git

In the terminal, inside `<targetDir>`, run:

```bash
git init
git branch -M main
git add .
git commit -m "Initial site scaffold"
```

---

## Step 14: Create the GitHub repository

Check whether the `gh` CLI is available:

```bash
gh --version
```

**If `gh` is available and authenticated:**

Ask:

> "I can create the GitHub repository and push everything for you.
> Shall I go ahead? The repo will be called `<repoName>` and
> will be public (required for free GitHub Pages)."

After confirmation, run:

```bash
gh repo create <repoName> --public --source . --remote origin --push
```

**If `gh` is not available or not authenticated:**

Provide numbered manual steps:

1. Go to https://github.com/new
2. Set the repository name to `<repoName>`
3. Set visibility to **Public** (required for free GitHub Pages)
4. Do **not** initialise with a README — you already have one
5. Click **Create repository**
6. Copy the remote URL shown on the next page (it will look like
   `https://github.com/<githubUsername>/<repoName>.git`)
7. In your terminal, run:
   ```bash
   git remote add origin https://github.com/<githubUsername>/<repoName>.git
   git push -u origin main
   ```

---

## Step 15: Enable GitHub Pages

After the push is complete, direct the GM to `references/github-pages.md`
for the manual Pages enablement steps.

Summarise:

> "Your code is on GitHub. The last step is to turn on GitHub Pages
> in the repository settings. See the github-pages guide for
> step-by-step instructions — it takes about two minutes."

---

## Step 16: Confirm

Once GitHub Pages is enabled and the first deployment finishes,
the site will be live at:

```text
https://<githubUsername>.github.io/<repoName>/
```

Tell the GM:

> "Your campaign site is live. Share that URL with your players.
>
> Whenever you update your vault and want to refresh the site,
> tell me 'update my site' and I'll rebuild and push for you."
