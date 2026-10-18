# GitHub Pages — First Deploy and Manual Enablement

## First deploy

Step 21b of the set-up guide. `<project_name>` and the GitHub user
come from `node "$TOOL" settings setup-note get --vault <vault>`;
`$TOOL` is set up in `SKILL.md` → "The build tool".

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

**Create the repository.** If `gh` is available and authenticated (from the
set-up guide's Phase A), ask:

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
   node "$TOOL" deploy --config vault.config.json
   ```

   `deploy` builds, commits, and pushes, setting the upstream tracking
   branch on this first push. Do **not** pass `--verify` here — Pages
   isn't enabled yet, so a live-URL probe now would just report a
   miss. Verification happens in Step 22, after Pages is turned on
   below.

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
available, walk the GM through the numbered steps under
Enabling Pages by hand.

---

## Enabling Pages by hand

If you used the setup wizard with the `gh` CLI, Pages was
enabled automatically — you can skip this guide. These steps
are for cases where `gh` is not available or the API call
failed.

---

## Step 1: Open the repository settings

1. Go to https://github.com and sign in.
2. Navigate to the campaign site repository. The URL will be:
   `https://github.com/<username>/<repo-name>`
3. Click the **Settings** tab along the top of the repository
   page. (If you do not see Settings, you may not have owner
   access to the repo.)

---

## Step 2: Open the Pages section

In the left sidebar of Settings, scroll down to the **Code and
automation** section and click **Pages**.

---

## Step 3: Set the source branch and folder

Under **Build and deployment**, find the **Source** dropdown.

1. If the source shows "None" or "Deploy from a GitHub Action",
   change it to **Deploy from a branch**.
2. In the **Branch** dropdown, select **main** (or whichever
   branch your site lives on — this is almost always `main`).
3. In the **Folder** dropdown that appears next to the branch,
   select **/docs**.
4. Click **Save**.

The page will reload. You should see a banner that says
"GitHub Pages source saved."

---

## Step 4: Wait for the first deployment

GitHub will start building your site immediately. Deployment
takes one to three minutes for a new site.

To monitor the progress:

1. Click the **Actions** tab at the top of the repository.
2. You will see a workflow run called "pages build and deployment"
   (or similar). It will show a yellow spinning icon while
   running and a green checkmark when complete.
3. If it shows a red X, click into the run to see the error.
   Common causes: the `docs/` folder is empty, or the repository
   is private.

---

## Step 5: Find your site URL

Once the deployment is green, return to **Settings → Pages**.

At the top of the page you will see:

> Your site is live at https://<username>.github.io/<repo-name>/

Click the **Visit site** button to confirm it loads correctly.

---

## Troubleshooting Pages enablement

**"Pages is not available for private repositories"**
GitHub Pages requires a public repository on the free plan.
Go to **Settings → General → Danger Zone → Change visibility**
and set the repository to Public.

**"The site shows a 404 after deployment"**
The `docs/` folder may be empty. Rebuild from the site directory
with `npm run build`, confirm it populates a `docs/index.html`
file, then push the updated `docs/` folder.

**"The Actions tab shows no workflows"**
GitHub Pages workflows are created automatically when you enable
Pages. If you see nothing in Actions, the Pages source may not
have been saved. Return to Settings → Pages and confirm the
source is set to **Deploy from a branch → main → /docs**.

**"The deployment succeeded but my site is blank"**
Check that `docs/index.html` was committed and pushed. Run
`git log --oneline` and confirm the most recent commit includes
changes to the `docs/` folder.

---

## Optional: Custom domain

If you want the site to use a domain you own (e.g.
`campaign.example.com`) instead of the default GitHub Pages URL:

1. In your domain registrar's DNS settings, add a CNAME record:
   - Name: `campaign` (or whatever subdomain you want)
   - Value: `<username>.github.io`
2. In **Settings → Pages**, scroll to **Custom domain** and
   enter your full domain: `campaign.example.com`.
3. Click **Save**. GitHub will verify the DNS record. This can
   take a few minutes to a few hours depending on your registrar.
4. Once verified, enable **Enforce HTTPS** (recommended).

Then `settings set player_site.url=https://campaign.example.com`,
rebuild and push, so the site's links point to the new address.

---

## Subsequent deployments

After the initial setup, deployments happen automatically
whenever you push to the `main` branch (as long as the `docs/`
folder was updated). You do not need to return to Settings.

The routine update flow (from SKILL.md capability 2) handles
all subsequent builds and pushes.
