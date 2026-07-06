# Troubleshooting — Common Build Failures

This file covers the most common failure modes GMs encounter
when building or maintaining a campaign site. For each, it
describes the symptom, the likely cause, how to diagnose it,
and how to fix it.

Always run the build with a fresh terminal before diagnosing.
Many "failures" are stale state from a previous aborted run.

---

## Failure 1: "Portraits not showing"

### Symptom

Character or NPC pages load, but the portrait image area is empty
or shows a broken image icon.

### Cause

One of two things:

- The `attachmentsDir` in `vault.config.json` does not match
  the actual folder name in the vault.
- The portrait file referenced in the entity's frontmatter does
  not exist at the expected path.

### Diagnosis steps

1. Open `vault.config.json` and find the `attachmentsDir` value.
   The default is `_attachments`.
2. Open the vault folder and confirm a folder with that exact
   name exists. Check capitalisation — `_Attachments` and
   `_attachments` are different on Linux and macOS.
3. Open the entity's markdown file (e.g. the character note).
   Check the `portrait` frontmatter field. It should be a path
   relative to the vault root, such as:
   ```yaml
   portrait: "_attachments/characters/alice-morgan.jpg"
   ```
4. Navigate to that path inside the vault folder and confirm the
   image file exists with that exact filename.

### Fix

- If `attachmentsDir` is wrong: update the value in
  `vault.config.json` to match the actual folder name.
- If the image file is missing: add the image to the vault, or
  remove the `portrait` field from the entity's frontmatter
  (the page will render cleanly without it).
- If the filename casing is wrong: rename the file or update the
  frontmatter to match exactly.

After fixing, run `npm run build` and check the page again.

---

## Failure 2: "Build crashed"

### Symptom

Running `npm run build` exits with an error. The terminal shows
a stack trace or an error message before the build completes.

### Cause

Usually one of:

- `vault.config.json` has a syntax error (missing comma, unclosed
  bracket, stray quote)
- The `vaultPath` in the config points to a folder that does not
  exist or that the current user cannot read
- A vault file has malformed YAML in its frontmatter block
- Node.js version is below 22

### Diagnosis steps

1. Read the error message. If it says "Unexpected token" or
   "SyntaxError" near a JSON file, the config is malformed.
2. If it says "ENOENT" (no such file or directory), the
   `vaultPath` is wrong.
3. If it names a specific vault file, that file's frontmatter
   has bad YAML.
4. Run `node --version` — if it prints a version below 22,
   that is the cause.

### Fix

**Config syntax error:**
Open `vault.config.json` and look for the problem near the line
number the error mentions. Common mistakes:
- Missing comma between two fields
- A Windows path using single backslashes: use `/` instead
- A trailing comma after the last field in an object

Use a JSON validator (search "JSON validator" online) if unsure.

**Wrong vaultPath:**
Update `vaultPath` in `vault.config.json` to the correct absolute
path to your vault. On Windows, use forward slashes:
```json
"vaultPath": "C:/CampaignVaults/MyVault"
```

**Malformed vault YAML:**
Open the file named in the error. Look for the frontmatter block
between the `---` markers at the top. Common YAML mistakes:
- A colon in a value without quotes: `title: Chapter: One`
  should be `title: "Chapter: One"`
- Inconsistent indentation under a list item
- A tab character instead of spaces

**Node version too low:**
Install Node 22 LTS from https://nodejs.org and restart your
terminal.

---

## Failure 3: "Page is missing"

### Symptom

An entity (a character, location, faction, etc.) exists in the
vault but does not appear anywhere on the built site.

### Cause

One of:

- The entity's vault folder is not listed in `folderMap` in
  `vault.config.json`
- The entity's vault folder name is listed in `excludeDirs`
- The entity's markdown file does not have a `type` frontmatter
  field

### Diagnosis steps

1. Open `vault.config.json` and find `folderMap`. Check that
   the folder your entity lives in appears as a key.
2. Check `excludeDirs` — if the folder is listed there, it is
   being intentionally skipped.
3. Open the entity's markdown file and check its frontmatter
   for a `type` field. If missing, the scanner skips it.
   Unknown `type` values still render via the smart wiki fallback.

### Fix

**Folder not in folderMap:**
Add the folder to `folderMap` with an appropriate URL slug. For
example, if your creatures live in a folder called `Bestiary`:
```json
"folderMap": {
  ...
  "Bestiary": "creatures"
}
```

**Folder in excludeDirs:**
Remove it from the `excludeDirs` list, or move the entity to a
different folder.

**Missing type field:**
Add `type: npc` (or the appropriate type) to the entity's
frontmatter. See `schema-reference.md` for the list of known types.

---

## Failure 4: "Links are broken"

### Symptom

A link on a page either goes to a 404 page or points to the
wrong entity.

### Cause

Wiki-link resolution is case-sensitive and matches the exact
title of the target note. If the `[[wiki-link]]` text in a vault
file does not match the target file's title or its `aliases`
frontmatter exactly, the link will not resolve.

### Diagnosis steps

1. Find the broken link in the built HTML — look at the URL it
   points to and compare it to the expected page.
2. Find the source file in the vault that contains the
   `[[wiki-link]]`.
3. Find the target file in the vault that the link is supposed
   to point to.
4. Compare the link text to the target file's filename (without
   the `.md` extension) and its `aliases` frontmatter. They must
   match exactly (including capitalisation).

### Fix

**Link text is wrong:**
Update the `[[wiki-link]]` in the source file to match the
target file's filename exactly.

**Target file is known by another name:**
Rename the target file to match what the links use, or add the
alternate spelling to the target file's `aliases` list:
```yaml
aliases:
  - The Crimson Duke
  - Duke Maedalor
```

**File has been renamed:**
If the vault file was renamed but the links were not updated,
either rename the file back or do a find-and-replace in the
vault to update all references to the new name.

---

## Failure 5: "npm: command not found" or "npx: command not found"

### Symptom

Running `npm run build` or `npx gm-apprentice-publish` produces
"command not found" or a similar error.

### Cause

Node.js is not installed, or it was installed but is not on
the system PATH.

### Fix

1. Install Node.js 22 LTS from https://nodejs.org
2. Close and reopen your terminal
3. Run `node --version` to confirm it is installed
4. Run `npm --version` to confirm npm is available

On macOS, if you used a package manager like Homebrew or nvm,
check that it added Node to your PATH (the installer should
prompt you to do this).

---

## Failure 6: Build succeeds but site shows old content

### Symptom

`npm run build` completes without errors, but the live site
still shows outdated content after pushing.

### Cause

The `docs/` folder was built, but either:
- The changes were not committed and pushed, or
- GitHub Pages has not finished redeploying yet

### Fix

1. Run `git status` in the site directory. If `docs/` appears
   as modified or untracked, stage and commit it:
   ```bash
   git add docs/
   git commit -m "Rebuild site"
   git push
   ```
2. Go to your repository on GitHub and click the **Actions** tab.
   Wait for the Pages deployment workflow to show a green
   checkmark. This usually takes one to two minutes.
3. If the Actions tab shows a failure, the deployment failed on
   GitHub's side. Check the log for details.

---

## Failure 7: Build uses old templates or missing features

### Symptom

The build completes without errors, but the output does not
reflect recent plugin updates. Pages may use old templates,
missing layout improvements, or lack new features that should
be available.

### Cause

The site repo's `package.json` still points at an old version
of the `gm-apprentice-publish` package in the plugin cache. When
the plugin updates (new version installed), the cache path changes
but existing site repos keep their old `file:` dependency, so
builds continue using the stale code.

This can also happen if the dependency was set to `"latest"` —
npm resolves that to whatever version is already installed locally,
which may be outdated.

The build tool detects this itself: at the start of a build it
compares the version it is running as against the newest version
installed in the plugin cache, and prints a **version-drift
warning** naming the exact `file:` path to switch to. If you see
that warning, this is the failure — follow the fix below.

### Diagnosis steps

1. Open the site repo's `package.json`. Find the
   `gm-apprentice-publish` dependency. It should be a `file:` path
   like:
   ```json
   "gm-apprentice-publish": "file:~/.claude/plugins/cache/gm-apprentice/gm-apprentice/1.4.21/tools/publish"
   ```
2. Check the version number in that path against the current plugin
   version (readable from `.claude-plugin/plugin.json` in the
   gm-apprentice plugin directory). If they differ, the dependency
   is stale.
3. Also check `node_modules/gm-apprentice-publish/package.json` in
   the site repo — its `version` field shows what is actually
   installed.

### Fix

Run the routine update workflow ("update my site"). Step 2 of
that workflow automatically detects version mismatches and updates
the dependency.

To fix manually:

1. Update the `file:` path in the site repo's `package.json` to
   point at the current plugin cache version.
2. Run `npm install` in the site repo directory to pull in the
   updated package.
3. Rebuild with `npm run build`.

---

## Failure 8: "Cannot find module" / missing runtime dependencies

### Symptom

`npm run build` fails immediately with either:

- `Error: Cannot find module 'gray-matter'` (or `lunr`,
  `markdown-it`), or
- `Error: gm-apprentice-publish is missing runtime dependencies:
  ...` followed by reinstall guidance.

### Cause

The build tool resolves its own dependencies from wherever the
plugin cache placed it (a site's `file:` pin symlinks the tool out
of the cache). The tool ships those dependencies **vendored**
(committed alongside its code) so they always travel with it. If
they are missing, the plugin copy in the cache is incomplete —
usually a broken or interrupted plugin install/update.

### Fix

1. Update or reinstall the gm-apprentice plugin with `/plugin`.
2. Ask the publish-site skill to "update my site" — capability 2
   repoints the `file:` dependency at the freshly-installed cache
   version and re-runs `npm install` (which only re-links the
   package; the vendored deps need no download).
3. As a manual fallback, run `npm install` inside the cache's
   `.../tools/publish` directory the site points at, then rebuild.

---

## Failure 9: Session recap and Story page are empty

### Symptom

The build succeeds, but the landing "Latest Session" recap, the Story
page's Campaign Saga, and the "NPCs/Locations in Play" widgets are all
empty — even though `session-wrapup` ran and wrap-up files exist.

### Cause

Recap surfacing keys off *published* `type: session` and `type: chapter`
pages. The wrap-up (`type: session_wrap`) supplies the recap text, but it
only surfaces when its paired session index — and for the Campaign Saga,
a chapter page — are published too. Two common breakdowns:

1. The vault's `Chapters/` folder is missing from `folderMap` in
   `vault.config.json`, so every chapter, session, scene, and wrap-up
   file is skipped. Builds from tool 1.6.0 print a
   `scanner: skipping "<dir>" — not in folderMap` warning; older builds
   skip silently. (Scaffolds from 1.6.0 include the mapping by default.)
2. The session index or chapter page exists but is unpublished — held
   back by the manifest, `DRAFT` status, or player-mode auto-exclusion.

### Diagnosis steps

1. Run the build and check for `not in folderMap` scanner warnings.
2. Confirm `folderMap` maps the folder holding chapters/sessions
   (default vault layout: `"Chapters": "chapters"`).
3. Confirm a `type: session` page for the played session and a
   `type: chapter` page are in the published set (check the manifest
   and canon status).

### Fix

Add the missing `folderMap` entry, publish the session index and a
player-safe chapter page alongside the wrap-up, and rebuild. To show a
recap, all three must publish: the session index (`type: session`), its
chapter (`type: chapter`), and the wrap-up (`type: session_wrap`).

---

## Getting more information from the build

If none of the above explains the problem, run the build and
capture the full output:

```bash
npm run build 2>&1 | tee build-log.txt
```

**On Windows (PowerShell):**
```powershell
npm run build 2>&1 | Tee-Object -FilePath build-log.txt
```

Share the contents of `build-log.txt`. The build log includes
per-page processing notes, skipped files, and any per-page errors
that did not abort the full build.
