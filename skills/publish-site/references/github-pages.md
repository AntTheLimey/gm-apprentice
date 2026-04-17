# GitHub Pages — Manual Enablement

This guide walks through enabling GitHub Pages on a campaign
site repository after the initial push. This is a one-time setup.

GitHub does not allow automatic Pages enablement via the `gh` CLI
without additional API permissions, so this step is always done
manually in the browser.

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

Update the `siteUrl` field in `vault.config.json` to your
custom domain, then rebuild and push so all internal links
in the generated HTML point to the right URL.

---

## Subsequent deployments

After the initial setup, deployments happen automatically
whenever you push to the `main` branch (as long as the `docs/`
folder was updated). You do not need to return to Settings.

The routine update flow (from SKILL.md capability 2) handles
all subsequent builds and pushes.
