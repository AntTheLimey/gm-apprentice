# Publishing Your Campaign Vault

The `gm-apprentice-publish` tool turns your campaign vault into a
static website you can share with your players. It reads the structured
files that campaign-organizer creates and generates a set of HTML pages
with navigation, portraits, stat blocks, and cross-linked entities —
ready to host for free on **GitHub Pages** or **Cloudflare Pages**.

## What it produces

The generated site has one page per entity in your vault:

- **Characters** — NPC and PC pages with portrait images, occupation,
  status, and body content. Player character pages use collapsible
  accordion sections so you can organize stats, skills, and equipment
  without overwhelming the reader.
- **Locations** — Location pages with a parent-location breadcrumb so
  readers can orient themselves geographically.
- **Factions and organizations** — Faction pages that automatically
  list members by pulling `member_of` relationships from across the vault.
- **Creatures** — Compact stat block pages for quick encounter reference.
- **Items** — Item pages with damage, weight, cost, and current holder.
- **Events, clues, documents, and more** — A smart fallback template
  displays any other entity type with its frontmatter fields as badges
  followed by the body content.

Section headings marked as GM-only (such as `GM Notes`) are stripped
before the site builds, so private information stays private.

Wiki-links between vault files become live hyperlinks in the site.
Portrait images from your vault's attachments folder are copied across
automatically.

## When to use it

Use this tool after campaign-organizer has structured your vault. The
tool reads the `type` frontmatter field and folder layout that
campaign-organizer sets up — without that structure, most files will
be skipped.

A good time to publish is after each session, once you have updated
NPCs, locations, and clues and run a campaign-qa pass to catch broken
links and missing fields.

## Relationship to campaign-organizer

campaign-organizer is the tool that creates and maintains your vault
structure: classifying entities, writing frontmatter, managing
wiki-links, and keeping the knowledge graph consistent.
`gm-apprentice-publish` reads that structure and renders it as HTML.
The two tools are complementary — campaign-organizer creates the content,
publish turns it into a shareable website.

If pages are missing from your site, the most common cause is that
the vault files lack a `type` field or live in a folder that is not
mapped in `vault.config.json`. campaign-organizer can help you fix
frontmatter; the publish-site skill can help you update the folder map.

## Getting started

For a guided setup, use the `publish-site` skill. It will walk you
through installing the package, connecting your vault, choosing a host,
and publishing for the first time. It can also help with routine
rebuilds after you update your vault, troubleshooting build errors, and
adding new entity types.

To trigger it, say something like:

> "I want to publish my campaign as a website"
> "Set up a site for my campaign"
> "Help me share my campaign with my players"

## Choosing where to host it

You build the site the same way regardless of host (`npm run build`
produces a `docs/` folder). Only the final deploy step differs. Set the
`host` field in `vault.config.json` to pick one; if it's absent, GitHub
Pages is assumed.

| | **GitHub Pages** (`github-pages`) | **Cloudflare Pages** (`cloudflare-pages`) |
|---|---|---|
| Best if | You already use GitHub | You want Cloudflare's CDN, easy custom domains, image optimization |
| You need | A GitHub account | A free Cloudflare account + a one-time API token |
| Deploy step | `git push` (auto-builds the Pages site) | `wrangler pages deploy docs/` (one command) |
| Site URL | `<user>.github.io/<repo>/` (a subpath) | `<project>.pages.dev` (the root) |

The two can run side by side during a switch — the built `docs/` folder
is identical, so `git push` keeps GitHub Pages current while a wrangler
deploy updates Cloudflare.

**Credentials and step-by-step setup** live in the publish-site skill's
reference guides — the skill walks you through them, or you can read them
directly:

- **GitHub Pages** — [`references/github-pages.md`](../skills/publish-site/references/github-pages.md)
- **Cloudflare Pages** — [`references/cloudflare-pages.md`](../skills/publish-site/references/cloudflare-pages.md)
  (creating a least-privilege API token, saving it in `~/.zshenv`, the
  first deploy, and custom domains)

## Technical details

For the configuration file reference, CLI commands, and the library API,
see the [tool README](../tools/publish/README.md).

The tool requires Node 22 or later. It **ships inside the gm-apprentice
plugin** — it is not installed from the npm registry. The publish-site
skill drives it from the plugin cache and scaffolds sites that pin it
with a `file:` path into that cache, so every build uses the exact
version matching your installed plugin.

## Copyright note

Publishing your vault makes its content publicly accessible. Before
publishing, check that any licensed TTRPG material in your vault is
within the bounds of its license for public distribution. The
publish-site skill will remind you of this and flag any concerns it
spots. See [ATTRIBUTION.md](../ATTRIBUTION.md) for the licenses that
apply to this project.
