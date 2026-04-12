# gm-apprentice-publish v1.0 — Design

**Target:** Extract the gurps-special-forces vault-to-GitHub-Pages converter into a reusable tool that works for any gm-apprentice-based campaign, regardless of game system.

**Target repo:** `/Users/antonypegg/PROJECTS/gm-apprentice` (lives inside the existing plugin repo)
**Published as:** `gm-apprentice-publish` on npm
**Prototype source:** `/Users/antonypegg/PROJECTS/gurps-special-forces`
**Brainstorm date:** 2026-04-12

## Purpose

The gurps-special-forces repo contains a working vault-to-static-site generator. It reads an Obsidian-compatible markdown vault organised per the gm-apprentice `campaign-organizer` schema and produces a mobile-friendly GitHub Pages site with character sheets, NPC pages, locations, factions, events, and more.

This spec extracts that generator into a reusable tool so any gm-apprentice user can publish their campaign vault as a static site with zero code changes. The tool must:

- Work for any game system (not just GURPS)
- Work for any entity type supported by campaign-organizer
- Be accessible to non-technical GMs (who are already using Claude via gm-apprentice)
- Be filesystem-only — no Obsidian runtime dependency, works on plain markdown + YAML
- Be cross-platform (Windows + macOS + Linux)
- Support schema evolution without breaking existing users

## Architecture

### Two-layer design

The tool ships as two coordinated layers, both inside the gm-apprentice repo:

**Layer 1: npm package** (`tools/publish/`)
- Pure Node.js build library with a thin CLI
- Published to npm as `gm-apprentice-publish`
- Two runtime dependencies, both mature and widely-used (`gray-matter`, `markdown-it`)
- Cross-platform, testable, deterministic

**Layer 2: gm-apprentice skill** (`skills/publish-site/`)
- User-facing conversational interface
- Drives the npm package via `npx gm-apprentice-publish ...`
- Handles setup, routine updates, troubleshooting, schema migrations
- Sibling to `campaign-organizer`, `ttrpg-expert`, `campaign-qa`, `session-lifecycle`

### Why this split

- **Schema changes are atomic.** When campaign-organizer adds a new entity type, `skills/publish-site/` and `tools/publish/` are updated in the same commit — no cross-repo coordination.
- **Skill handles UX, package handles logic.** Claude's conversational ability replaces a custom wizard UI. The npm package stays pure: no prompts, no interactive code, no TUI library.
- **Each layer is independently testable.** The npm package has a deterministic test suite. The skill is a set of markdown files validated by skill-creator.
- **Power users can bypass the skill.** Technical users can install the npm package standalone, use it in CI, or script multi-site workflows.

### Repository layout

```
gm-apprentice/
├── skills/
│   └── publish-site/              # NEW — orchestration skill
│       ├── SKILL.md
│       └── references/
│           ├── setup-wizard.md
│           ├── troubleshooting.md
│           ├── github-pages.md
│           └── schema-reference.md
└── tools/
    └── publish/                   # NEW — npm package
        ├── package.json           # "name": "gm-apprentice-publish"
        ├── README.md              # npm-facing docs
        ├── bin/
        │   └── gm-publish.js      # CLI entry point
        ├── lib/
        │   ├── index.js           # Public API re-exports
        │   ├── scanner.js         # Vault scanning, frontmatter, link map
        │   ├── processor.js       # Markdown to HTML, wiki-links, filters
        │   ├── templates/
        │   │   ├── index.js       # Template re-exports
        │   │   ├── base.js        # baseShell, path helpers
        │   │   ├── nav.js         # generateNav
        │   │   ├── pc.js          # PC character sheet
        │   │   ├── npc.js         # NPC page
        │   │   ├── location.js    # Location page
        │   │   ├── creature.js    # NEW — combat stat block
        │   │   ├── item.js        # NEW — item stat block
        │   │   ├── faction.js     # NEW — goals/leadership/territory
        │   │   ├── wiki.js        # Smart wiki fallback (Event/Clue/etc.)
        │   │   ├── index-page.js  # Directory listing
        │   │   └── landing.js     # Root landing page
        │   ├── build.js           # Main orchestration
        │   └── init.js            # Scaffold logic
        ├── templates-scaffold/    # Starter files copied into user sites
        │   ├── package.json.tmpl
        │   ├── vault.config.json.tmpl
        │   ├── css/overrides.css
        │   ├── README.md.tmpl
        │   └── .gitignore
        ├── css/
        │   └── style.css          # Canonical maritime theme
        └── test/
            ├── fixtures/          # 8 synthetic test vaults
            ├── unit/
            ├── integration/
            └── cli/
```

## Skill capabilities

Five capabilities exposed by `skills/publish-site/`:

### 1. First-time setup (conversational)

Triggered by phrases like "publish my campaign site" or "set up a site for my vault."

Flow:
1. Ask for vault path; validate it's a gm-apprentice vault (check for `_meta/entity-types.md`)
2. Ask for campaign display name (default from `_Campaign/Campaign Overview.md` if present)
3. Ask for GitHub username and desired repo name
4. Ask for landing page tagline
5. Run `npx gm-apprentice-publish init <target-dir>` to scaffold the site repo
6. Run `git init`, stage files, initial commit
7. Run initial build to confirm vault reads cleanly
8. Detect `gh` CLI; if available and authenticated, offer to create the GitHub repo and push; otherwise print numbered manual instructions
9. Print clear steps for the GitHub Pages enablement (manual in v1.0)

### 2. Routine updates

Triggered by "update my site," "rebuild the site," etc.

Flow: `npm run build` → stage `docs/` → commit → push → confirm.

### 3. Troubleshooting

Triggered by error reports ("portraits not showing," "build crashed," "page missing").

Flow: run build with verbose output → parse common failure modes → explain the fix → optionally apply it with user approval.

### 4. Schema migrations

Triggered by "new entity type in gm-apprentice, update my site(s)."

Flow: read the site's `vault.config.json` → update folder mapping → rebuild → explain what changed.

### 5. Multi-site management

Power-user capability: remember multiple campaign sites (via skill references or memory) and offer to update all of them at once.

### Explicitly NOT in the skill

- Build logic (always calls the npm package)
- Custom CSS authoring (point users at `css/overrides.css`)
- GitHub Pages enablement automation (requires Pages API; keep manual for v1.0)

## npm package

### CLI surface

```bash
gm-apprentice-publish init [target-dir]
# Scaffolds a new site repo. Creates package.json (with this package as dep),
# vault.config.json, css/overrides.css, README stub, .gitignore, .nojekyll.
# Does NOT run npm install or git init — the skill handles those.

gm-apprentice-publish build [--config path/to/vault.config.json]
# Reads config, scans vault, generates docs/ output.
# Default config: ./vault.config.json in cwd.

gm-apprentice-publish --version
gm-apprentice-publish --help
```

### Library API

```js
const { build, scanVault, scanAttachments, buildLinkMap,
        processContent, templates } = require('gm-apprentice-publish');

// High-level
await build({ configPath: './vault.config.json' });

// Low-level
const pages = scanVault(config);
const linkMap = buildLinkMap(pages);
const imageMap = scanAttachments(config);
const html = templates.pcTemplate(page, processed, sections, navFor, config, imageMap);
```

### Dependencies

Runtime (production):
- `gray-matter` — YAML frontmatter parsing
- `markdown-it` — Markdown to HTML

Dev (testing only):
- None. Uses Node 22+ built-in `node:test` and `node:assert`.

### Engine requirement

```json
{
  "engines": { "node": ">=22" }
}
```

Tested against Node 22 only. Older versions will warn during `npm install`.

### Configuration file (`vault.config.json`)

```json
{
  "vaultPath": "/path/to/vault",
  "outputDir": "./docs",
  "attachmentsDir": "_attachments",
  "siteTitle": "My Campaign",
  "siteUrl": "https://username.github.io/my-campaign",
  "landingTagline": "A short hook for the homepage.",
  "landingParams": "Game system • Character build notes",
  "footer": "Optional footer text (e.g. trademark disclaimer)",
  "excludeDirs": ["_meta", "_Templates", "_resources"],
  "excludeSections": ["Player Notes", "Source References", "Relationships"],
  "folderMap": {
    "_Campaign": "campaign",
    "Characters/PCs": "characters/pcs",
    "Characters/NPCs": "characters/npcs",
    "Factions & Organizations": "factions",
    "Events": "events",
    "Locations": "locations",
    "Items & Artifacts": "items",
    "Creatures": "creatures",
    "Documents": "documents",
    "Clues": "clues",
    "Chapters": "chapters"
  }
}
```

New fields relative to the gurps-special-forces prototype: `landingTagline`, `landingParams`, `footer`, `attachmentsDir`, and `creatures` in the folder map. These decouple the tool from GSF-specific content.

## Templates

### Dedicated templates (v1.0)

Six entity types get dedicated templates with structured layouts:

1. **PC** — full interactive character sheet (accordions, section nav, skill chains). Migrated from gurps-special-forces unchanged.
2. **NPC** — header card, metadata badges, body content. Migrated unchanged.
3. **Location** — metadata badges (type, security, atmosphere), parent breadcrumb, body content. Migrated unchanged.
4. **Creature** (NEW) — combat stat block with HP/DR/speed, abilities list, weaknesses list, portrait if present. Purpose: in-game reference during encounters.
5. **Item** (NEW) — stat block for damage/DR/weight/cost/TL, current holder link, origin link, history section. Purpose: quick weapon/artifact lookup.
6. **Faction** (NEW) — goals list, leadership link, territory link, resources section, reverse-lookup of members (entities with `member_of` or `assigned_to` relationships pointing here).

### Smart wiki fallback (v1.0, dedicated versions deferred)

Six entity types fall through to the smart wiki template, which reads frontmatter and auto-renders metadata badges:

- **Event** — badges for `event_type`, `date`, `location`
- **Clue** — badges for `clue_type`, `reliability`, `found_by`
- **Document** — badges for `document_type`, `author`, `classification`, `date_written`
- **Chapter** — `sort_order` badge (flat, no session-listing yet)
- **Session** — badges for `session_number`, `actual_date`, `status`, `stage`
- **Scene** — badges for `scene_type`, `status`

These get dedicated templates in v1.1+. The smart wiki template is documented as the intentional fallback for v1.0.

### Template interface

Every template function has the signature:

```js
function xxxTemplate(page, processedContent, navFor, config, imageMap) => htmlString
```

Plus `pcTemplate` takes an additional `sections` parameter (for accordion rendering).

Each template handles missing frontmatter fields gracefully — missing sections are hidden, not rendered as empty.

## Testing strategy

### Framework

Node 22's built-in test runner (`node --test`). Zero external test dependencies. Uses `node:test` and `node:assert`.

### Four test layers

**Layer 1: Unit tests (pure functions, no filesystem)**

Every exported function in `lib/scanner.js`, `lib/processor.js`, and template helpers gets at least a happy-path test and one edge-case test. Covered functions:

- `slugify`, `mapFolder`, `buildLinkMap`, `scanAttachments`
- `resolveWikiLinks`, `filterSections`, `stripDataview`, `stripLeadingH1`, `resolveImageEmbeds`, `renderRelationships`, `metadataBadgesFor`
- `escapeHtml`, `relativePath`, `stubBadge`, `portraitImg`

**Layer 2: Template tests (isolated)**

Each template function gets unit-tested by feeding it a fake page object and fake processed content, asserting the HTML output contains expected elements.

**Layer 3: Integration tests (fixtures)**

Eleven synthetic test vaults under `test/fixtures/`. Eight are created in Phase 4, three more in Phase 5 when the new dedicated templates land.

Created in Phase 4:
1. `minimal/` — one entity of each type, smallest viable vault
2. `clean-schema/` — gurps-special-forces-style folder structure
3. `unusual-schema/` — files at vault root, unusual folder names, chapter nesting (formerly "legacy-schema"; renamed to make intent clear — this tests flexibility, not backwards compatibility)
4. `with-portraits/` — entities with portraits + body image embeds
5. `wiki-collisions/` — aliases colliding with canonical titles
6. `superseded-entities/` — SUPERSEDED entity with `superseded_by` redirect
7. `empty/` — empty vault, edge case
8. `malformed/` — bad YAML and unresolvable links, validates per-page error isolation

Created in Phase 5 (alongside the new dedicated templates):
9. `with-creature/` — exercises the Creature template (stat block, abilities, weaknesses)
10. `with-item/` — exercises the Item template (stat block, current holder, history)
11. `with-faction/` — exercises the Faction template (goals, leadership, territory, member rollup)

Each fixture is ~5-10 small markdown files, committed to the repo. Tests build into `os.tmpdir()` so CI doesn't leave artefacts.

**Layer 4: CLI tests**

Shell out to `bin/gm-publish.js` and verify:
- `init` creates expected scaffold files
- `build` produces expected output
- `--version`, `--help` print correctly
- Error handling produces clean messages, not stack traces

### CI workflow

`.github/workflows/publish-tool-ci.yml`:

- Triggers: push to main or PR, only when `tools/publish/**` changes
- Matrix: Ubuntu, macOS, Windows (3 jobs, single Node version 22)
- Steps: `npm ci`, `npm test`
- Working directory: `tools/publish/`

Cross-OS testing catches path separator issues, line endings, case sensitivity, and temp dir location bugs that wouldn't show up on any single OS.

### Release workflow

`.github/workflows/publish-tool-release.yml`:

- Triggers on git tag matching `publish-v*` (e.g., `publish-v0.3.0`)
- Runs tests one more time before publishing
- `npm publish` with `NODE_AUTH_TOKEN` from secrets
- Gated on git tag — no accidental publishes

## Documentation

Docs live in three places, each with a distinct audience:

### `tools/publish/README.md` (npm package README)

Audience: developers discovering the package on npm. Contents: description, install, quick start, config reference, CLI reference, library API, link to skill.

Style: terse, reference, assumes technical competence. ~200 lines.

### `skills/publish-site/SKILL.md` + `references/` (user-facing walkthrough)

Audience: GMs using Claude, possibly non-technical.

- `SKILL.md` (~80 lines): routing rules, capabilities, copyright reminders
- `references/setup-wizard.md` (~150 lines): step-by-step conversational flow
- `references/troubleshooting.md` (~150 lines): common failure modes with diagnosis and fix
- `references/github-pages.md` (~100 lines): screenshots for manual Pages enablement
- `references/schema-reference.md` (~100 lines): which frontmatter fields the tool reads per entity type

### `docs/publish-tool.md` (gm-apprentice docs overview)

Audience: plugin users wanting high-level understanding.

Contents: what the tool does, when to use it, relationship to campaign-organizer, example output, links to the other two doc locations. ~100 lines.

### Cross-linking updates

- `gm-apprentice/README.md` — add a row for `publish-site` to the skills table, mention `tools/publish/` in structure section
- `gm-apprentice/CLAUDE.md` — add a note about the tool under the existing structure section
- `gm-apprentice/ROADMAP.md` — already updated with deferred publish-tool work

### What documentation does NOT include

- Tutorials on using Obsidian or gm-apprentice broadly (`docs/quickstart.md` handles that)
- Architecture explanation (lives in this spec)
- Contributor guide (YAGNI for v1.0)

Total new documentation: ~900 lines across the package and skill.

## Cross-platform concerns

The tool must work identically on Windows, macOS, and Linux. Specific concerns:

- **Path separators**: always use `path.join` / `path.sep`, never hardcoded `/` or `\`
- **Line endings**: handle both `\n` and `\r\n` (git's autocrlf produces CRLF on Windows checkouts)
- **Case sensitivity**: tests avoid filesystem-case reliance (macOS is case-insensitive by default, Linux is case-sensitive)
- **Temp directories**: use `os.tmpdir()`, not hardcoded `/tmp`
- **File URLs**: use `url.pathToFileURL()` for any dynamic imports

The cross-OS CI matrix catches all of these.

## Implementation phasing

Six phases, each ending in a shippable milestone. Execution can pause cleanly between any two phases.

### Phase 0: Migration prep (~1 hour)

- Branch: `feat/publish-tool-v1` in gm-apprentice
- Scaffold `tools/publish/` directory structure
- Copy `lib/scanner.js`, `lib/processor.js`, `lib/templates.js`, `build.js`, `css/style.css`, `vault.config.json` from gurps-special-forces as a starting point
- Create `tools/publish/package.json` with name, version 0.1.0, current dependencies
- Verify `cd tools/publish && node build.js` still works against the GSF vault

Milestone: GSF build works from inside gm-apprentice repo.

### Phase 1: Decouple from GSF specifics (~1 hour)

- Extract hardcoded `landingTagline`, `landingParams`, `footer` into config fields with sensible defaults
- Update scaffold-init to generate valid placeholders

Milestone: Identical output for GSF with GSF config; works for any vault with different config.

### Phase 2: Split templates into one-file-per-template (~1 hour)

- Break `lib/templates.js` into `lib/templates/base.js`, `nav.js`, `pc.js`, `npc.js`, `location.js`, `wiki.js`, `index-page.js`, `landing.js`
- `lib/templates/index.js` re-exports for API stability
- Update `build.js` imports
- Verify byte-for-byte identical output

Milestone: Cleaner layout, easier to add new templates.

### Phase 3: Unit test suite + CI (~3-4 hours)

- `test/unit/` with tests for all pure functions
- `package.json` test script: `node --test test/`
- `.github/workflows/publish-tool-ci.yml` with cross-OS matrix
- Run locally → push → verify CI green

Milestone: Red/green tests on every push across three OSes.

### Phase 4: Integration tests with fixtures (~3-4 hours)

- Create 8 fixtures: `minimal`, `clean-schema`, `unusual-schema`, `with-portraits`, `wiki-collisions`, `superseded-entities`, `empty`, `malformed`
- Each ~5-10 small markdown files
- Integration tests build each into temp dir, assert on output
- Verify `malformed/` confirms per-page error isolation

Milestone: End-to-end confidence. Synthetic test coverage for every scenario.

### Phase 5: New dedicated templates (~6-8 hours)

- Build `creature.js`, `item.js`, `faction.js` following the NPC template pattern
- Add CSS for stat-block and member-rollup classes
- Add to template selection switch in `build.js`
- Fixtures for `with-creature/`, `with-item/`, `with-faction/`
- Verify against the gurps-special-forces vault with real entities

Milestone: All six dedicated templates render structured layouts. The remaining six types fall through to smart wiki.

### Phase 6: `init` command + skill + documentation (~6-8 hours)

- `lib/init.js` — scaffold logic
- `bin/gm-publish.js` — CLI entry point
- `skills/publish-site/SKILL.md` + four reference files
- `tools/publish/README.md`
- `docs/publish-tool.md`
- Update `README.md`, `CLAUDE.md`, `ROADMAP.md` in gm-apprentice root
- Test full first-time setup flow end-to-end against a throwaway directory
- Publish v0.1.0 to npm via release workflow

Milestone: Tool is installable, documented, invokable via the skill, published to npm.

### Phase 7 (post-v1.0): gurps-special-forces migration

- Delete vendored `lib/`, `build.js`, `css/style.css` from gurps-special-forces
- Update `package.json` to depend on `gm-apprentice-publish`
- Replace `build.js` with a shim: `require('gm-apprentice-publish').build()`
- Verify byte-for-byte identical output
- Commit, push, verify GitHub Pages rebuild

Handled in a separate session alongside gurps-special-forces documentation work.

Milestone: gurps-special-forces becomes a consumer of the published tool, validating the dependency model.

### Total effort estimate

**Phases 0-6 = v1.0 release:** 20-25 hours, split across six sessions of 3-4 hours each.

**Phase 7 = post-v1.0 consumer migration:** 1-2 hours, handled in a separate session in the gurps-special-forces repo alongside the GSF documentation work.

Each phase ends in a committable milestone, so execution can pause cleanly between sessions.

## What v1.0 does NOT include

The following items are documented in `gm-apprentice/ROADMAP.md` as deferred work:

- Event dedicated template (score 4.0 — first to build post-v1.0)
- Timeline auto-generation from events and sessions (3.5)
- Full-text client-side search using lunr.js (3.5)
- Chapter/Session/Scene templates + hierarchy navigation (2.7)
- Clue dedicated template (2.5)
- Document dedicated template (2.5)
- Tag-based browsing (2.5)
- Relationship graph visualisation (2.3)

These are captured with force-ranked scores so the next backlog pick is deterministic.

## Open questions and risks

**npm publishing:** Requires a free npm account and `NPM_TOKEN` secret in the gm-apprentice repo. Minor setup cost.

**GitHub Pages automation:** Not included in v1.0. Users manually enable Pages via the GitHub web UI. A future capability could use `gh api` to enable it automatically, but that requires `gh` CLI to be installed and authenticated.

**Schema evolution:** Handled by the folder map being configurable and the scanner being type-based rather than folder-based. When campaign-organizer adds new entity types, users update their `vault.config.json` (or the skill does it for them via the "schema migration" capability) and rebuild. No breaking changes required.

**Relationship graph scope:** Deferred to post-v1.0 because it needs a JS graphing library, which adds runtime dependencies to the output HTML. Worth evaluating alternatives (e.g., SVG server-side render) when this item is picked up.

**Canticle migration:** The Canticle vault uses older folder conventions. Migration to the current campaign-organizer schema is a separate project, driven by Canticle's own needs, not by this tool's testing strategy. The `unusual-schema/` fixture covers the flexibility features; Canticle doesn't need to be a test dependency.

## Success criteria

v1.0 is "done" when:

1. `npx gm-apprentice-publish init my-site` in an empty directory produces a working scaffold
2. `npm run build` from that scaffold against any gm-apprentice vault produces a valid static site
3. The site renders PCs, NPCs, Locations, Creatures, Items, and Factions with dedicated templates
4. The site renders Events, Clues, Documents, Chapters, Sessions, Scenes via the smart wiki fallback
5. Cross-OS CI passes on Ubuntu, macOS, Windows
6. The published npm package is installable and usable
7. `skills/publish-site/` walks a non-technical GM through first-time setup without requiring them to touch a CLI directly
8. `gurps-special-forces` still builds identically after Phase 7 migration
9. Documentation in all three locations is complete and cross-linked
