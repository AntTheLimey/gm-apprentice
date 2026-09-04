# publish-site — prose-to-procedure audit

Scope: `skills/publish-site/` (148 KB across SKILL.md + 9 references) against
`tools/publish/` (`gm-publish`, v1.11.27, ~5,400 LOC in `lib/`).

## The headline

`gm-publish` today exposes **7 subcommands**: `init`, `build`, `inbox`,
`flush`, `doctor`, `setup-status-bar`, `setup-inbox`
(`tools/publish/bin/gm-publish.js:13-22`). The skill's 148 KB of prose exists
largely to bridge the gaps *between* those seven — deriving values, patching
config files, choosing deploy forms, diagnosing failures, editing character
sheets, and running a polling loop. Almost none of that gap is judgment.

The tool already contains the hard parts of most of what the prose asks the
model to do by hand:

| Prose asks the model to… | Code that already does it | But no CLI reaches it |
|---|---|---|
| detect a stale `file:` pin and compute the new path (SKILL.md:99-129) | `lib/version-check.js:41` returns `{pinned, latest, drift, suggestedPath}` | ✔ warn-only; nothing applies it |
| align `wrangler.toml` `name`, pick the bare deploy form, deploy, report URL (SKILL.md:174-196) | `lib/setup-backend.js:94-126` does exactly this | ✔ only reachable via `setup-status-bar`/`setup-inbox` |
| find files present in the vault but missing from the manifest (SKILL.md:130-145) | `lib/build.js:204,225` warns both directions | ✔ warn-only, only for 3 types, only in player mode |
| find folders not in `folderMap` (SKILL.md:216-219, troubleshooting.md:120-166) | `lib/scanner.js:75` warns with the exact fix text | ✔ warn-only |
| parse a GURPS sheet's attributes/skills/unspent points (change-request-loop.md:126-165, 305-317) | `lib/templates/gurps/parse.js` → structured model incl. `points[].unspent` | ✔ render-only |
| write vitals back into a PC `.md` body in place, idempotently | `lib/flush/gurps-writeback.js`, `coc-writeback.js` | ✔ flush-only, HP/FP only |

Estimated split across the whole skill: **~55 % mechanizable (B)**, ~15 %
hybrid (C), ~20 % genuine judgment (D), ~10 % already-scripted (A).

---

## 1. Troubleshooting reference — is it a symptom→fix table `doctor` could encode?

**Yes — 8 of 9 failure modes are deterministic checks.** `troubleshooting.md`
is 13.2 KB; the nine `## Failure N` blocks are 12.4 KB of it, and every one
follows the same shape: *symptom → diagnosis steps that are file reads and
string comparisons → fix*. The model is being asked to hand-execute a
decision tree.

| # | Lines | Diagnosis the prose asks for | Class | Already detectable? |
|---|---|---|---|---|
| 1 Portraits | 13-55 | `attachmentsDir` folder exists (case-exact); every `portrait:` path resolves to a file | **B** | No — `schema-reference.md:327` says a missing portrait is *silently hidden* |
| 2 Build crashed | 59-117 | JSON parse error / `vaultPath` ENOENT / malformed vault YAML / node < 22 | **B** | Partly — `lib/scanner.js:63` names the bad-YAML file; `doctor` covers node |
| 3 Page missing | 120-166 | folder absent from `folderMap`; folder in `excludeDirs`; frontmatter has no `type` | **B** | Partly — `scanner.js:75` warns on folderMap; **`scanner.js:69` (`if (!frontmatter.type) continue`) skips untyped files with no warning at all** |
| 4 Broken links | 169-213 | find the link in built HTML, find the source note, find the target note, compare text to filename + `aliases` | **B** | No — unresolved wikilinks render as plain text, silently |
| 5 npm not found | 217-238 | node/npm on PATH | **A/B** | `doctor` covers it |
| 6 Old content live | 242-268 | `git status`, then check GitHub Actions | **B** (git) / **D** (Actions UI) | No |
| 7 Stale templates | 272-327 | compare `package.json` `file:` path + `node_modules/.../package.json` version against plugin version | **B** | Yes — `version-check.js` prints this warning already; the prose (272-297) restates it |
| 8 Cannot find module | 331-359 | missing vendored deps | **A** | Yes — `bin/gm-publish.js:77-103` prints this exact diagnosis and fix. **The prose is redundant.** |
| 9 Empty recap/Story | 363-400 | `Chapters/` in `folderMap` **and** a `type: session` published **and** a `type: chapter` published | **B** | Partly — `build.js:225` warns for unregistered session/chapter |

### Proposed contract

`gm-publish doctor --site [--config <path>] [--json]` — extend the existing
`doctor` (currently tool/auth preflight only, `lib/doctor.js:17`) with a
**content/config audit** pass:

- inputs: `vault.config.json` (+ the vault it names)
- outputs (JSON): `{configJson:{parsed,errors[]}, vaultPath:{exists,readable},
  folderMap:{unmapped:[{dir,typedFileCount,suggestedSlug}]},
  untyped:[path], portraits:{missing:[{page,portrait}]},
  links:{unresolved:[{source,linkText,nearest[]}]},
  manifest:{missing:[],orphaned:[]}, recap:{sessionPublished,chapterPublished,
  wrapPublished}, versionPin:{...}}` — each finding carrying a stable
  `code` (e.g. `PORTRAIT_MISSING`) and a one-line `fix`, the way
  `lib/doctor-cli.js:6-11`'s `FIXES` table already does for tools.
- **New:** `gm-publish explain <vault-relative-path>` — "why did/didn't this
  page publish?" Walks the same pipeline for one file and prints the verdict
  (not in folderMap / no `type` / excluded by manifest / `publish: false` /
  DRAFT excluded / published at `docs/x/y.html`). This single command
  subsumes Failures 3 and 9 and half of 1.

**What goes wrong by hand today:** the model pattern-matches an error string
against nine prose blocks and picks one. Failure 4 in particular asks it to
grep built HTML and eyeball filename-vs-link-text casing across a vault —
unreliable at any vault size, and unfalsifiable when it guesses wrong.
Failures 7 and 8 are already printed by the tool, so the model may
"diagnose" from prose what the terminal already said.

**Size:** M for `doctor --site` (the checks are individually small; the
plumbing is a new pass over the scan output). M for `explain`.
**Type:** extension of `doctor` + one new subcommand.
**Prose saved:** ~11 KB of 13.2 KB.

---

## 2. Change-request loop — mechanical vs judgment

`references/change-request-loop.md` (17.7 KB, 317 lines). This is the file
where prose is doing the most work that code should do.

### B — mechanical

**a) The watcher itself (lines 16-114, 5.3 KB).**
The prose specifies a program in English: poll `inbox pull`, clamp a
GM-supplied interval to 1-300s (55-63), count a 5-failure streak and emit a
loud line (70-75), dedup by request id across relaunches (101-114), write a
Unix timestamp heartbeat every tick (69), and back off ×2 capped at 300s when
the same ids reappear. It then admits the fallback "has no memory of its own —
dedup here is **your** job, not the script's" (101-104), i.e. the model is
being used as the loop's state variable.

- Contract: `gm-publish inbox watch [--interval 30] [--fail-streak 5] [--heartbeat <path>] [--ndjson]`
  → long-running; emits one NDJSON event per *new* batch (`{event:"batch",
  ids:[…], entries:[…]}`), per failure streak (`{event:"degraded",
  consecutiveFailures:N}`), and maintains the heartbeat and the id-dedup set
  itself. `gm-publish inbox watch --status` reads the heartbeat and answers
  "alive/stale" against the interval **it** knows, removing the
  judge-staleness-against-the-currently-active-interval reasoning at 258-270.
- Goes wrong by hand: a mis-transcribed clamp polls Cloudflare flat out; a
  dropped dedup re-runs a full classify-and-apply pass on an already-applied
  batch; the model's own context is the dedup memory, so a compaction loses it
  mid-session.
- Size M. New `inbox` sub-subcommand.

**b) Point-cost quoting (lines 132-165).**
"Validate spends against GURPS costs… Attributes: ST/HT 10/level, DX/IQ
20/level" — arithmetic against a parsed sheet. `lib/templates/gurps/parse.js`
already returns attributes (with a Cost column, `parse.js:449-467`) and a
`points[]` array with `unspent`/`total` flags.

- Contract: `gm-publish sheet quote --pc <name> --change "<text or structured>" --json`
  → `{target:"DX", from:13, to:14, cost:20, unspent:15, affordable:false, shortfall:5}`.
- Size M. New `sheet` subcommand family.

**c) Applying the edit (lines 179-194, 305-317).**
Locate the Identity block, bump the attribute/skill line, decrement Unspent
Points (allowing negative under override, 140-147), re-check idempotency
("first check whether its change is already present… treat the apply as a
no-op", 310-315). This is exactly the class of in-place body editing
`lib/flush/gurps-writeback.js` already performs safely.

- Contract: `gm-publish sheet apply --pc <name> --set "DX=14" --spend 20 [--allow-negative] [--dry-run] --json`
  → `{applied:true|false, noop:bool, unspentBefore, unspentAfter, diff}`.
  Idempotent by construction; atomic write.
- Goes wrong by hand: the model free-edits a markdown table under time
  pressure at a live table. Point totals silently desync; the
  "is it already applied?" check is a re-read the model may skip.
- Size **L** — the single biggest win in the skill.

**d) The player-safe scope rule (lines 166-172).** Currently a *discipline*
instruction: never read `GM Notes`, `DM Notes`, `Source References`,
`Reconciliation Context`, `<!-- gm-only -->`, other PCs' data. A rule the
model must remember, whose violation is silent and is a real spoiler leak.

- Contract: `gm-publish sheet show --pc <name> --player-safe [--json]` — reuse
  `lib/processor.js`'s existing section/field/gm-only filtering so the model
  is **handed** a pre-filtered document instead of being told not to look.
- **This is the highest-value C→B in the file:** it converts a
  remember-not-to rule into a data boundary. Size S (the filter exists).

**e) Batch commit (lines 179-194).** "Publish the applied batch once… on
deploy success finalize each applied id; on deploy failure do **not** reply."
Deterministic transactional orchestration.

- Contract: `gm-publish inbox commit --applied <id>=<msg> [--applied …] [--rejected <id>=<msg>] --json`
  → builds, deploys, and only then posts replies; on deploy failure exits
  non-zero having posted nothing.
- Size M. Extension of `inbox`.

**f) The terminal log format (246-254)** should be CLI output, not a format
the model renders from memory. Size S.

**g) Stop sequence (282-299):** `flush` (already A), kill watcher, `rm
.watcher-heartbeat` — fold into `inbox watch --stop`. Size S.

### C — hybrid

- **Classify change vs question (126-131).** The imperative-verb set is
  enumerable (`spend/add/set/raise/remove/note`), so the CLI can attach a
  `guess` + confidence; the "if genuinely unsure, treat it as a question"
  rule stays with the model.
- **Trust-signal / override detection (140-147).** The listed phrases ("GM
  said it's OK", "do it anyway", "override") are regex-able, but this is
  natural language and false negatives cost a player a spend. Keep the
  decision with the model; make the *consequence* a flag (`--allow-negative`).

### D — genuine judgment

- Answering a rules question (166-178) — needs the model (and the RAG server).
- Disambiguating "which skill did you mean" (156-164).
- Choosing the session code word (line 18).

**Split:** roughly 200 of 317 lines describe mechanism. Post-mechanization
this reference should be ~4-5 KB: classify, decide, call three commands.

---

## 3. Setup wizard — how much is transcription?

`references/setup-wizard.md`, 30.6 KB / 809 lines — the largest file in the
skill. 23 numbered steps.

| Step | Lines | What it asks | Class |
|---|---|---|---|
| 1 Locate vault | 56-79 | check `_meta/` exists | **B** (S) |
| 2 Resume check | 81-98 + 199-239 | read/write a `publish.setup_progress` YAML block **without clobbering sibling `publish:` keys** (206); branch on `last_completed_step`/`tier1_complete` | **B** (M) — a state machine specified in prose, persisted by hand-editing frontmatter |
| 3 Node check | 100-112 | `node --version` | **A** (chicken-and-egg justifies the bare command) |
| 4 Host choice | 114-138 | ask | **D** + B (record) |
| 5 Doctor | 140-195 | run `doctor --json`, then map each `false` to a fix and re-run | **A** + **C** (the fix map already exists at `doctor-cli.js:6-11`) |
| 6-7 Title, tagline | 250-278 | creative | **D** |
| 8 Name the site | 280-302 | validate lowercase/digits/hyphens, suggest a correction, compose `siteUrl` from a template | **B** (S) |
| 9 Site dir | 304-316 | ask | **D** + B |
| 10 Campaign image | 318-338 | ask (D), validate path exists (B), generate SVG (D) | **C** |
| 11 404 message | 340-357 | creative | **D** |
| 12 Theme | 359-373 | propose a palette from genre | **C** — presets live in `lib/theme.js`; proposing is data, choosing is D |
| 13 Scaffold | 379-416 | `init` | **A** |
| 14 Confirm pin | 418-453 | re-open `package.json` and verify the `file:` path `init` *just wrote* (420-422), correct it if wrong | **B** (S) — mostly dead weight; `init --json` should assert it |
| **15 Fill `vault.config.json`** | **455-503** | hand-write a JSON file from two templates with 7-8 substituted values, then verify a `backend` block `init` already wrote | **B (S) — the purest transcription in the skill** |
| 16-17 install/build | 509-543 | | **A** |
| 18 Review | 545-555 | eyeball | **D** |
| 19 Manifest | 557-573 | delegates to content-filtering | **B**+**C** (see §5) |
| 20 Filtered rebuild | 575-588 | rebuild, report "N pages (down from M)" | **B** (S) — build should print the delta |
| 21a CF deploy | 599-633 | project-create idempotency, `wrangler.toml` name alignment, bare-vs-explicit deploy form | **B** (M) — `setup-backend.js:94-126` already does it |
| 21b GH deploy | 635-695 | `git init`/commit/`gh repo create`/`gh api …/pages` | **B** for the scripted path, **D** for the browser fallback |
| 22 Verify live | 699-733 | `curl -sSL --connect-timeout 5 --max-time 15 -w '%{http_code}'`, 2xx, ≤3 retries ~20s apart | **B** (S) |
| 23 Tiered close | 737-809 | offer (D), run `setup-*` (A), maintain `deferred` (B) |

### Proposed contract

```
gm-publish init <dir> --vault <path> --title <s> --tagline <s>
                --host cloudflare-pages|github-pages
                --project <name> [--github-user <u>] [--json]
```
writes a complete, valid `vault.config.json` (name validation and `siteUrl`
composition included) instead of the model transcribing two JSON templates.
Collapses Steps 8, 14, 15 and half of 21a. **Size S** (extension of `init`,
`lib/init.js` is 124 lines).

```
gm-publish setup progress [--vault <path>] [--set key=value] [--json]
```
owns the `publish.setup_progress` block — read, merge-write, never clobber
siblings. Collapses Step 2 + the 41-line "Resume state" spec. **Size S.**

```
gm-publish deploy [--config <path>] [--verify] [--json]
```
branches on `host`, derives the project name, checks auth, aligns
`wrangler.toml`, picks the deploy form, deploys, then probes the URL with the
retry policy. Collapses Steps 21a/21b/22 **and** SKILL.md:149-196 (the same
procedure written a second time). **Size M**, mostly extraction from
`lib/setup-backend.js`.

**Verdict:** ~30 % of the wizard is genuine conversation (host, title,
tagline, image, 404, theme, go/no-go confirmations). ~70 % is validation,
transcription, and orchestration. The creative steps are worth keeping in
prose exactly as they are (setup-wizard.md:245-247 is right about that); the
rest is a shell script with a chat wrapper.

---

## 4. Schema and configuration references — docs the model loads to know fields

### `references/configuration.md` (14.8 KB)

Two settings tables (lines 14-39 and 219-234) plus a precedence section
(236-274). **This is a hand-maintained mirror of `lib/config.js`.**
`PUBLISH_DEFAULTS` (`config.js:6-76`) *is* the schema; `unionExcludeList`
(`config.js:82`) and the `merged` block (`config.js:195-273`) *are* the
precedence rules. The mirror is known-fragile — `config.test.js` already
carries a sync check for the `exclude_sections` default
(`config.js:10-15`), and `config.js:19-23` records a bug where a whole
`landing` block was silently ignored for months.

Proposed:
- `gm-publish config schema [--json]` — emit `PUBLISH_DEFAULTS` annotated with
  per-key owner (`vault-config.md` only / JSON fallback / unioned) and
  default. **Size S** — the data already exists; it needs an owner annotation
  per key.
- `gm-publish config validate [--config <path>] [--json]` — report unknown
  keys, **misplaced keys** (a `vault-config.md`-only setting written into
  `vault.config.json`, which configuration.md:251-256 says "does nothing" —
  a silent no-op the tool warns about today only for `publish.overrides.*`,
  `config.js:154-175`), malformed shapes, and the effective merged value per
  key. **Size M.**

That lets configuration.md drop both tables (~6 KB) and keep only the
conceptual prose (why the split exists, the union rule, worked examples).

### `references/schema-reference.md` (12.7 KB)

Consumed for two questions: *"what does `type: X` render as"* (SKILL.md:222,
352-355) and *"is `type: X` known"* (troubleshooting.md:165).

- The **type registry** is derivable — `lib/templates/index.js` +
  `lib/templates/pc-registry.js` own it. `gm-publish schema types [--json]`
  answers the second question in ~200 bytes instead of a 12.7 KB read.
  **Size S.**
- The **per-type field tables** are *not* fully derivable: they carry
  rendering semantics (badge colours at lines 289-304, the story-companion
  discovery convention at 41-50, layout switching at 31-39) that no template
  registry exposes without annotating each template. Realistic outcome: keep
  a slimmed doc, extract the type list. **B (partial), size S; the rest stays D/doc.**

---

## 5. Content filtering (the manifest) — SKILL.md capabilities 2 and 6

**Prose:** SKILL.md:130-145 (freshness delta) and SKILL.md:241-273
(first-time categorization), backed by `content-filtering.md:5-64`.

The classification rules are stated as literal frontmatter predicates —
`status: planned|prepped`, `stage: outline|draft|ready`, `source: "prep"`,
`_meta/`/`_Templates/`/`personal/`, scenes `status: cut|skipped`, ambiguous =
no `type` / non-standard dir / `canon_status: SUPERSEDED` without
`superseded_by` (content-filtering.md:7-64). That is a pure function from
frontmatter to a bucket. The build already computes half of it
(`build.js:204` orphaned entries, `build.js:225` unregistered
session/chapter) but only warns, only for 3 types, and only in `mode: player`.

Proposed:
- `gm-publish manifest diff [--config] [--json]` →
  `{new:[{path,type,bucket:"publish"|"exclude"|"decide",reason}],
    removed:[path], orphaned:[path], counts:{…}}`
- `gm-publish manifest apply --publish <path>… --exclude <path>=<reason>… [--prune]`
  → rewrites `_meta/publish-manifest.md` in the documented format
  (content-filtering.md:183-254), which `lib/manifest.js` already parses.

**B** for scan/diff/write, **C** for the ambiguous walkthrough (the model
still asks the GM), **D** for genre/tone/404/image (SKILL.md:249-252).
**Size M.** New subcommand family. Removes the need to load
content-filtering.md at all for a routine rebuild.

---

## 6. SKILL.md — remaining items

| Lines | Prose asks | Class | Contract | Size |
|---|---|---|---|---|
| 27-35 | read `gm_apprentice_version` from `_meta/vault-config.md` and `current_version` from `shared/migrations.md`, compare, hand off to migration | **B** | `gm-publish doctor --vault <path> --json` → `{vaultVersion, requiredVersion, needsMigration}` | S |
| 41-59 | derive `<plugin-cache-path>/<plugin-version>/tools/publish/bin/gm-publish.js` by hand | **B** | `version-check.js:41` already knows `versionsRoot`/`latest`; ship a resolver line or a `gm-publish where` | S |
| 96-98 | read `publish.site_dir` from vault-config, else ask | **C** | fold into `doctor --vault` output | S |
| **99-129** | read plugin.json → read site `package.json` → read `node_modules/gm-apprentice-publish/package.json` → compare → rewrite the `file:` dep → `npm install` → re-read to confirm → report old→new | **B** | **`gm-publish update-pin [--site <dir>] [--json]`** using `detectVersionDrift()`; `--check` for read-only | S-M |
| 130-145 | manifest freshness delta | **B**/C | §5 | M |
| 149-196 | host-branched deploy + auth degrade + wrangler.toml alignment + form selection + curl verify | **B** | `gm-publish deploy --verify` | M |
| 208-224 | compare `folderMap` to actual vault folders, propose additions | **B** detect / **C** apply | `doctor --site` `folderMap.unmapped[]` (`scanner.js:75` already knows) | S |
| 226-234 | multi-site: "track the site repo paths in the conversation" | **B** | a registry file + `gm-publish sites list/update-all`; conversation-as-database is not durable | S |
| 288-314 | Tier 2a/2b setup | **A** | already `setup-status-bar` / `setup-inbox` | — |
| 340-350 | flag verbatim licensed text before publishing | **D** | genuine judgment | — |

`bin/gm-publish.js:151-155` is also worth noting: **`--help` on a subcommand
prints the top-level help for everything except `flush`**, so
`gm-publish inbox --help` and `doctor --help` teach nothing. Per-subcommand
help is a prerequisite for shrinking the prose — the skill currently *is* the
help text.

---

## 7. Token cost for "rebuild my site"

Whole skill: 147,647 B ≈ **36,900 tokens** if fully loaded.

A typical routine-update invocation loads:

| File | Bytes | ~Tokens | Why |
|---|---|---|---|
| `SKILL.md` | 18,238 | 4,560 | always |
| `references/content-filtering.md` | 11,808 | 2,950 | **mandated** by SKILL.md:133-136 before the freshness check |
| **Total** | **30,046** | **~7,500** | before a single vault file is read |

Plus the four file reads the version check demands (`_meta/vault-config.md`,
plugin `plugin.json`, site `package.json`, `node_modules/.../package.json` —
SKILL.md:107-113) at ~90 tokens fixed overhead each, and
`references/troubleshooting.md` (+3,300 tokens) the moment the build prints
anything unexpected.

**What is actually needed to route a rebuild:** "run `gm-publish update
--deploy` from the site dir; report the summary" — under 1 KB.

If `update-pin`, `manifest diff`, and `deploy --verify` exist, SKILL.md
capability 2 (lines 90-196, 5,988 B) collapses to ~600 B, and
content-filtering.md stops loading for rebuilds entirely — **a ~7,500 →
~1,200 token routine-update path (≈84 % reduction)**, with the behaviour
becoming testable in `tools/publish/test/` rather than re-derived per session.

---

## 8. Recommended order

1. **`gm-publish deploy [--verify]`** — B, M. Extraction from
   `setup-backend.js:94-126`. Kills SKILL.md:149-196 *and* setup-wizard
   Steps 21a/21b/22, which today specify the same procedure twice.
2. **`gm-publish update-pin`** — B, S. `version-check.js` already computes
   everything; only the apply step is missing. Kills SKILL.md:99-129 and
   troubleshooting Failure 7.
3. **`gm-publish sheet quote|apply|show --player-safe`** — B, L. The at-table
   correctness and spoiler-safety win; also the only place where a hand-edit
   corrupts the GM's source data.
4. **`gm-publish doctor --site` + `explain <path>`** — B, M. Retires ~11 KB of
   troubleshooting prose and converts three currently-silent failures
   (untyped file, missing portrait, unresolved wikilink) into reported ones.
5. **`gm-publish manifest diff|apply`** — B/C, M. Removes content-filtering.md
   from the rebuild path.
6. **`gm-publish inbox watch|commit`** — B, M. Stops using model context as a
   polling loop's state variable.
7. **`gm-publish init --vault --title …` + `setup progress`** — B, S. Ends the
   JSON transcription steps.
8. **`gm-publish config schema|validate` + `schema types`** — B, S/M. Lets
   configuration.md and schema-reference.md stop mirroring `lib/config.js`.

Nothing above touches the parts that should stay prose: the creative setup
questions, the rules answers, the ambiguity calls, and the copyright judgment
at SKILL.md:340-350.
