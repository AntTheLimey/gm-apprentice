# Cloudflare Pages — Setup and Deploy

This guide covers publishing a campaign site to **Cloudflare Pages**
instead of GitHub Pages. It is written for non-technical GMs — every
step is spelled out.

Cloudflare Pages is a free static-site host, like GitHub Pages. Pick it
if you want Cloudflare's features (fast global CDN, easy custom domains,
image optimization). The generated site is identical either way — only
where it's hosted and how it's deployed changes.

**You still build the site the same way** (`npm run build`). The only
difference is the final step: instead of `git push`, you run one
`wrangler` command to upload the built `docs/` folder.

---

## What you need first

1. A **free Cloudflare account** — sign up at https://dash.cloudflare.com/sign-up
2. **Node 22 or later** (same as for building the site).
3. `wrangler`, Cloudflare's command-line tool — you do **not** need to
   install it; every command below runs it with `npx wrangler@4`, which
   fetches it on demand. The `@4` pins the major version so a future
   wrangler release can't silently change the deploy behaviour; you can
   drop it once you've installed a specific version yourself.

---

## Step 1: Create an API token

An API token lets the deploy command publish on your behalf without a
browser login each time. Create one scoped to **only** what publishing
needs — nothing more.

1. Go to https://dash.cloudflare.com/profile/api-tokens
2. Click **Create Token**.
3. Scroll to **Create Custom Token** and click **Get started**.
4. Give it a name like `gm-apprentice-publish`.
5. Under **Permissions**, add one row:
   - **Account** · **Cloudflare Pages** · **Edit**
6. Under **Account Resources**, select your account.
7. Click **Continue to summary**, then **Create Token**.
8. **Copy the token now** — Cloudflare shows it only once. If you lose
   it, delete it and make a new one.

> **One optional tick now saves a trip later.** If you think you might
> ever want the live status bar or the at-table change-request inbox, add
> a **second** permission row while you're here — **Account** · **Workers
> KV Storage** · **Edit** — and you'll never need to touch this token
> again. If you only want a plain shareable site, the single **Cloudflare
> Pages** · **Edit** row is all you need.

Keeping the token to just "Cloudflare Pages: Edit" means that even if it
leaked, it could only touch your Pages sites — not billing, DNS, or
anything else.

---

## Step 2: Hand the token to the setup — it does the rest

That's the whole dance now: **create the token (Step 1) → hand it to the
setup, which saves it and figures out your Account ID for you → done.**
You never look up the Account ID by hand, and you never edit a shell
startup file yourself.

Run this from the site directory (the `$TOOL` path is the one you set at
the top of the publish walkthrough — the plugin's `gm-publish.js`):

```bash
node "$TOOL" doctor --set-cloudflare-creds
```

Paste your token when it asks. It then:

- **saves the token** to the right startup file for your shell
  automatically — zsh, bash, or Windows; you don't need to know which,
- **works out your Account ID from Cloudflare** and saves that too (this
  is why you're never sent hunting for it), and
- **confirms it worked** — all **without ever printing your token back**.

> **The old foot-gun is gone.** This guide used to warn that credentials
> put in `~/.zshrc` instead of `~/.zshenv` were the **#1 reason a deploy
> fails** ("not authenticated" even though the token is set) — because
> `~/.zshrc` is only read by *interactive* terminal windows, while the
> automated shells a deploy runs in skip it. `--set-cloudflare-creds`
> removes that trap entirely: it always writes the file **every** shell
> reads (`~/.zshenv` on zsh, `~/.bashrc` on bash, a user environment
> variable on Windows), so the credentials are always there.

**Prefer your token never passes through the assistant?** Run the same
command in **your own terminal window**, entering the token at the
hidden `read` prompt (you can paste it — it stays invisible) so it never
passes through the assistant — for example:

```bash
read -rs CF_TOKEN; printf '%s' "$CF_TOKEN" | node "$TOOL" doctor --set-cloudflare-creds; unset CF_TOKEN
```

Chain the three with `;` (not `&&`) so `unset CF_TOKEN` always runs and
clears the token even if the save step exits non-zero (for example when
`whoami` verification fails). `read -rs` doesn't echo what you type and
keeps the token out of your shell history; the tool never prints it back
either way.

### Only if you'd rather do it by hand

You can skip the command above and set the two variables yourself. On
macOS/Linux with zsh (the default on modern macOS) they must go in
**`~/.zshenv`**, not `~/.zshrc`.

> **Why `~/.zshenv` and not `~/.zshrc`?** `~/.zshrc` is only read by
> *interactive* terminal windows. Automated/non-interactive shells — the
> kind a deploy command or an assistant runs in — skip it. `~/.zshenv`
> is read by **every** shell, so the credentials are always available.
> Putting them only in `~/.zshrc` is the #1 reason a deploy says "not
> authenticated" even though the token is set.

Open the file in an editor (this keeps the token out of your shell
history), and add these two lines with your real values:

```bash
export CLOUDFLARE_API_TOKEN="paste-your-token-here"
export CLOUDFLARE_ACCOUNT_ID="paste-your-account-id-here"
```

- **zsh (macOS default):** put them in `~/.zshenv`, then run
  `source ~/.zshenv`.
- **Bash (most Linux):** if your shell is Bash rather than zsh (check
  with `echo $SHELL`), put the same two lines in `~/.bashrc` instead —
  Bash does not read `~/.zshenv`. On some setups a login shell reads
  `~/.bash_profile` rather than `~/.bashrc`; if verification below still
  fails, add the lines there too. Then run `source ~/.bashrc` (or open a
  new terminal).
- **Windows:** set the same two variables as user environment variables
  (System Settings → Environment Variables), then open a new terminal.

Doing it by hand means you *do* have to find your Account ID yourself:
go to https://dash.cloudflare.com, select your account, and copy the
**Account ID** from the right-hand sidebar (on the account home or the
**Workers & Pages** overview). Then verify:

```bash
npx wrangler@4 whoami
```

You should see your account name and Account ID, and a line noting the
token was read from `CLOUDFLARE_API_TOKEN`. This command prints your
account — never the token itself. If it says "not authenticated," the
variables aren't in `~/.zshenv`, or you need a new terminal / `source`.

---

## Step 3: Point the site config at Cloudflare

In the site's `vault.config.json`, set two fields:

```json
{
  "host": "cloudflare-pages",
  "siteUrl": "https://<project-name>.pages.dev"
}
```

- `host` tells the publish skill to deploy with wrangler instead of git.
- `siteUrl` **must** be your Cloudflare URL. Cloudflare serves the site
  at the root (`<project>.pages.dev/`), whereas GitHub Pages serves it
  under a subpath. If you leave a `github.io` URL here, the build prints
  a warning and the site's **404 page** will have broken styling (every
  other page still works, because internal links are relative).

Optional: set `"cloudflarePagesProject": "<name>"` to fix the project
name. If omitted, the site directory's folder name is used (e.g. a site
in `~/PROJECTS/iron-crown` deploys to the `iron-crown` project).

Project names must be lowercase letters, numbers, and hyphens.

---

## Step 4: First deploy

From the site directory:

```bash
npm run build                                   # generate docs/
npx wrangler@4 pages project create <project-name> --production-branch=main
npx wrangler@4 pages deploy
```

The scaffold ships a `wrangler.toml` with `pages_build_output_dir = "docs"`,
so the deploy is the **bare** `npx wrangler@4 pages deploy` — no `docs/`
argument; passing it positionally conflicts with the config and errors.
Only a site with no `wrangler.toml` (an older scaffold) uses the explicit
`pages deploy docs/ --project-name=<project-name> --branch=main --commit-dirty=true`
form instead.

The `project create` step is a one-time setup per site. When it finishes,
the deploy prints two URLs:

- A per-deploy snapshot: `https://<hash>.<project>.pages.dev` (a frozen
  copy of this exact upload)
- The live site: `https://<project>.pages.dev` — this is the one to
  share; it always points at the latest deploy.

---

## Updating the site later

After the first deploy, publishing an update is just build + deploy —
no `project create`, no git, no browser:

```bash
npm run build
npx wrangler@4 pages deploy
```

wrangler only uploads files that changed, so repeat deploys are fast.

---

## Change-request inbox (one-time setup)

The change-request inbox lets players submit sheet edits from their phones. It
needs a KV namespace bound to your Pages project. Do this once per site.

A fresh Tier-1 site scaffolds a **minimal** `wrangler.toml` — it has
`pages_build_output_dir` (so the bare `npx wrangler@4 pages deploy` keeps
working) but **no** `[[kv_namespaces]]` block — and **no** `functions/`
directory. The KV binding and the `functions/` are added only when you opt
into the inbox or the live status bar: either the streamlined
`gm-publish setup-inbox` / `setup-status-bar` commands below, or the manual
steps further down in this section. Already-deployed inbox sites are
unaffected — this only changes what a brand-new site ships.

> **The PC roster already renders as a static initiative table at Tier 1** —
> with no backend at all. Setting up the live status bar (`setup-status-bar`,
> below) is what turns that static table into a live, phone-updatable board;
> the inbox reuses the same KV namespace.

### The fast way — `setup-status-bar` / `setup-inbox`

These do everything the manual steps below do — create/reuse the `INBOX` KV
namespace, align `wrangler.toml`'s `name` to the Cloudflare project, patch in
the `[[kv_namespaces]]` block, flip the backend flag, rebuild, and deploy —
in one command. Run from the site directory:

```bash
node "$TOOL" setup-status-bar   # live status bar (Tier 2a)
node "$TOOL" setup-inbox        # change-request inbox (Tier 2b)
```

Each defaults to `./vault.config.json`; pass `--config <path>` if you're
running from elsewhere. Both are:

- **KV-permission probe first** — the command lists KV namespaces to
  confirm the token can manage KV before touching anything (this is the
  command's own check, not a `doctor` run). If the token can't manage KV, it stops with the fix
  rather than half-applying anything: edit the token (My Profile → API
  Tokens → your token → Edit) to add **Account · Workers KV Storage · Edit**
  (Cloudflare returns `Authentication error [code: 10000]` for this case),
  then re-run — no undo needed.
- **Idempotent** — safe to re-run. A namespace id already in `wrangler.toml`
  (or an existing `INBOX` namespace) is reused rather than recreated.

`setup-inbox` requires and ensures the same KV namespace as the status bar
(**inbox ⇒ KV** — you never create it separately) and is **infra-only**: it
flips `backend.inbox` to `true` but does not open a session or set a
`config:code`. Opening a live session is still the `inbox open <CODE>` loop
(Part 3 / `references/change-request-loop.md`) — run that once the flag is
live.

If you'd rather see each step yourself, or the command isn't available on
your setup, the manual path below does the same thing by hand.

### Or by hand

**You do not hand-copy the Functions.** Once a backend flag (`backend.inbox` or
`backend.statusBar`) is `true` in `vault.config.json`, the next `npm run build`
copies the plugin's Cloudflare Functions into the site's `functions/` for you (a
Tier-1 site with both flags off gets none — they live beside `vault.config.json`,
not in `docs/`). The manual steps below do exactly that: create the namespace,
bind it in `wrangler.toml`, flip the flag, rebuild, deploy.

The at-table **loadout** endpoint (`/api/loadout`) ships in the same
`functions/api/` directory and **reuses this same `INBOX` KV namespace**
(under a `loadout:` key prefix) — no new namespace, binding, or
`wrangler.toml` change. Once the inbox is set up, the loadout endpoint is
already alongside it. Existing sites that set up the inbox before the loadout
existed: copy `functions/api/loadout.js` and
`functions/api/loadout-core.mjs` from the scaffold alongside the inbox
files, then redeploy.

### `/api/loadout-list` (GM party dashboard — read only)

`GET /api/loadout-list?campaign=<campaignId>` returns every party member's live
state (`{ "<key>": {v,items,hp,fp,updatedAt}, … }`) for the roster-page party
board. It is **read-only** — it exposes only `onRequestGet`, never a write. Bound
to the same `INBOX` KV namespace as `/api/loadout`; no new namespace or binding is
needed. On the flag-based flow below it ships with the rebuild; a legacy site
that hand-manages `functions/` must copy `functions/api/loadout-list.js` **and
its `functions/api/loadout-core.mjs` dependency** (`loadout-list.js` imports it —
skip it only if the loadout endpoint already put it there), then re-deploy.

> **KV list-quota fix — existing sites must refresh the loadout + inbox Functions
> and redeploy.** Early builds had the party board poll the list endpoint every 5
> seconds, and both that endpoint and the change-request inbox used `kv.list()` on
> every poll. Cloudflare's free tier allows only **1,000 list operations per
> day**, so one party-board tab left open exhausted the day's quota in about
> 1h23m (after which the board stops updating until the quota resets at UTC
> midnight); a long inbox-loop session added to the same burn. The fix removes
> `kv.list()` from both hot paths — the party board maintains a per-campaign
> `roster:<campaignId>` index (written on save, read with plain gets) and the
> inbox maintains a `config:req-index` key — and slows the board to a 60-second
> poll that only runs while a game is actually in progress. To adopt it, re-copy
> from the scaffold: `functions/api/loadout-core.mjs`, `functions/api/loadout.js`,
> `functions/api/loadout-list.js`, `functions/api/inbox-core.mjs`, and the roster
> page's `js/gurps-party.js`, then redeploy. A site still running the **old**
> Functions keeps burning the list quota until it is updated; the two versions do
> not need to match across deploys, but the old one is not fixed until you
> redeploy the new files. **Migration is automatic and needs no backfill:** the
> party roster starts empty and each member is added the first time they save
> (which happens seconds into any session), the roster key's TTL is refreshed on
> every save so it never expires under an active party, and every pre-existing
> per-player key stays valid. The inbox index is seeded once from a single
> `kv.list()` the first time it is missing, so any in-flight pending requests on
> an upgraded site are recovered rather than lost, and it never lists again after
> that. **Immediate mitigation while you wait to redeploy:** closing the
> party-board tab stops the burn right away, and the quota resets at UTC midnight.

> **Existing sites — set the project name first.** Open `wrangler.toml` and set
> `name` to your **existing** Cloudflare Pages project name (the one you first
> ran `pages project create` with, e.g. `dead-end`). The scaffold fills `name`
> from the site title, which may not match — and a mismatched `name` deploys to
> a *different* project. If unsure, run `npx wrangler@4 pages project list`.

> **Your API token needs KV permission too.** If you took the optional
> **Account · Workers KV Storage · Edit** tick when you created the token
> (Step 1), you're already done here — skip to creating the namespace. Otherwise:
> the token from Step 1 of this
> guide is scoped to *Cloudflare Pages* only — enough to deploy, but **not** to
> create or use a KV namespace. Before the steps below, edit that token (or
> create a new one) so it also has **Account · Workers KV Storage · Edit**. In
> the Cloudflare dashboard: **My Profile → API Tokens →** your token **→ Edit →**
> add the permission row **→ Save**. Editing keeps the same token value, so you
> do not need to change `CLOUDFLARE_API_TOKEN`. Without this, `kv namespace
> create` fails with `Authentication error [code: 10000]`.

1. **Create the KV namespace:**

   ```bash
   npx wrangler@4 kv namespace create INBOX
   ```

   It prints an `id`.

2. **Bind it in `wrangler.toml`.** A minimal Tier-1 `wrangler.toml` has no KV
   block yet — add one, pasting the id from step 1:

   ```toml
   [[kv_namespaces]]
   binding = "INBOX"
   id = "<paste the id from step 1>"
   ```

   (If yours is an older scaffold that still has an
   `id = "PUT-YOUR-KV-NAMESPACE-ID-HERE"` line, replace that id instead of
   adding a second block.)

3. **Turn on the inbox flag.** In `vault.config.json`, set `inbox` to `true`:

   ```json
   "backend": { "statusBar": false, "inbox": true }
   ```

   (For the live status bar / party board, set `"statusBar": true` too — it
   reuses the same namespace.) This is what makes the next build ship the inbox
   chatbox **and** copy the inbox Functions into `functions/`.

4. **Build and deploy.** The build copies the Functions in because a backend
   flag is now on:

   ```bash
   npm run build
   npx wrangler@4 pages deploy
   ```

   > **Note — same deploy command as the rest of this guide.** This is the
   > same bare `npx wrangler@4 pages deploy` used throughout this guide — no
   > `docs/` argument. The `wrangler.toml` (`pages_build_output_dir = "docs"`)
   > is what makes the bare form required; there is nothing inbox-specific
   > about it.

5. **Verify the endpoint** — with no session code set yet, a submit must be
   rejected:

   ```bash
   curl -s -X POST https://<project>.pages.dev/api/request \
     -H 'content-type: application/json' \
     -d '{"code":"TEST","character":"x","text":"hello"}'
   # → {"error":"code"}   (no session open yet — expected)
   ```

   Setting a live session code and draining the queue are covered by the loop
   (Part 3).

---

## Custom domain (optional)

If you own a domain and want the site at `campaign.example.com` instead
of `<project>.pages.dev`:

1. In the Cloudflare dashboard: **Workers & Pages** → your project →
   **Custom domains** → **Set up a domain**.
2. Enter the domain. If the domain's DNS is already on Cloudflare, it's
   configured automatically. Otherwise Cloudflare shows the DNS record
   to add at your registrar.
3. Update `siteUrl` in `vault.config.json` to the custom domain and
   rebuild, so the 404 page's links resolve correctly.

---

## Troubleshooting

**"You are not authenticated. Please run `wrangler login`."**
The token isn't reaching the command. Almost always the variables are in
`~/.zshrc` instead of `~/.zshenv` (see Step 2), or you're in a terminal
opened before you added them — open a new one or run `source ~/.zshenv`.
Re-running `node "$TOOL" doctor --set-cloudflare-creds` fixes this by
writing the file every shell reads.
Confirm with `npx wrangler@4 whoami`.

**A wrong path (e.g. `/nope`) returns a Cloudflare 5xx instead of the
themed 404 page.** On a **brand-new** project this is normal for the
first few minutes — asset routes go live before the not-found handler
propagates. Recheck after a few minutes. If it persists, confirm
`docs/404.html` exists in the build output.

**The 404 page loads but is unstyled / links are broken.** `siteUrl` is
still a `github.io` URL. Set it to your `.pages.dev` (or custom) URL and
rebuild — see Step 3.

**"A project with this name already exists."** The `project create` step
only runs once per site. Skip it and run the `deploy` command directly.

**Deploy is slow the first time.** The first deploy uploads every file;
later deploys upload only what changed. Large vaults (hundreds of pages)
can take a minute or two on the first run — that's expected.

---

## Running alongside GitHub Pages

Because the built `docs/` folder is the same for both hosts, you can keep
publishing to GitHub Pages *and* Cloudflare during a transition. Deploy
to Cloudflare with the command above; GitHub Pages keeps updating on
`git push` as before. When you're ready to make Cloudflare the only home,
just stop pushing (or leave both running — they don't conflict).
