# Vault Access Reference

Read this file to determine how to access the campaign vault.
Vault access is plain filesystem tools plus two bundled
utilities. There is no server, no app dependency, and no
separate "Obsidian mode" — the vault is a folder of markdown,
and Obsidian is a viewer the user may or may not have open.

## Tools

| Operation | Use |
|-----------|-----|
| Read files | Read tool |
| List files | Glob tool |
| Write/edit files, frontmatter | Write/Edit tools |
| Exact-term search (names, dates, markers) | Grep |
| Ranked/prose search | `vault_search.py` |
| Backlinks, orphans, unresolved/ambiguous links, dead ends | `graph_check.py` |
| Entity schema validation, name similarity, index drift, stale drafts, changed-since listing | `vault_check.py` |
| Vault/plugin version gate | `vault_check.py version` |
| Session document chain status | `vault_check.py sessions` |
| Publish-safety scan (unfenced Keeper content, fence balance) | `vault_check.py gm-leak` |
| PC body skeleton / Current Status placement | `vault_check.py pc-body` |
| Wrap-Up conformance (+ `--fix` re-nest) | `vault_check.py wrapup` |
| Active PC roster | `vault_check.py active-pcs` |
| Session-prep context bundle (one call) | `session_context.py` |
| Frontmatter writes (set/increment/promote/supersede/reconciled) and legacy canon-key repair | `stamp_entities.py` |
| Player-safe PC sheet view | `gm-publish sheet show --player-safe` |

Grep is the right tool when you know the term (an entity
name, a date, a marker like `<!-- spoiler -->`). The
utilities cover what Grep can't: relevance ranking and link
graph analysis. Never hand-build a link map with Grep — the
utility does it in one pass (benchmarked: under a second and
a few hundred tokens, versus 50–125s and ~50k tokens for
per-query approaches).

`gm-publish sheet show --pc <name> --player-safe` is the
player-safe data boundary for answering a player's question
about their own sheet: it prints the sheet with everything the
published site strips already gone (excluded sections,
gm-only/spoiler blocks, HTML comments, excluded callouts,
gm_only relationship edges, excluded frontmatter fields).
Prefer it over reading the vault sheet directly whenever the
audience is a player, not the GM.

## Bundled Utilities

Both live in `skills/shared/scripts/`, stdlib-only Python 3.
From a plugin install, invoke via the plugin root:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/graph_check.py" \
  <vault-path> orphans --folder Characters
python3 "${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/graph_check.py" \
  <vault-path> backlinks "Entity Name"
python3 "${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/graph_check.py" \
  <vault-path> all
python3 "${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/vault_search.py" \
  <vault-path> "what happened after the duel" --limit 5 --context
```

`graph_check.py` commands: `orphans`, `unresolved`,
`deadends`, `backlinks NAME`, `ambiguous`, `all`; options
`--folder SUB` and repeatable `--exclude GLOB`. Output is a
`# count: N` header then one vault-relative path per line.
It handles aliases, `[[Name|alias]]`, `[[Name#heading]]`,
embeds, quoted frontmatter links, and space/underscore/case
variants.

`vault_search.py` is index-free BM25 — no index to build or
go stale. `--context` prints the best-matching line per hit.
Use it for prose queries; plain Grep is cheaper for exact
terms.

`vault_check.py` commands: `frontmatter` (schema validation:
required fields, enums, legacy fields, unquoted frontmatter
links), `names` (duplicate and confusable entity names and
aliases), `index` (`_meta/index.md` drift, both directions),
`stale-drafts`, `changed --since N` (entities touched at or
after session N — the incremental-audit scope),
`relationships` (every `relationships[].type` checked against
the sanctioned predicate vocabulary), `sessions` (each
session index's plan/play-notes/wrap-up document chain,
declared vs. derived status), `gm-leak [--folder SUB]`
(publish-safety scan of every publishable file's body — the
skip is by frontmatter, not by path: a `type:` of
`session-plan`, `session-play-notes`, `plan` or `meta` is
skipped as never-published, so an `_meta/` page carrying some
other type is still scanned; `publish: none` pages are
skipped and `publish: stub` pages are scanned only over the
sections they ship: ERROR
for an orphan `<!-- /gm-only -->` closer — everything above it
publishes — or a bold-wrapped excluded heading like `###
**GM Notes**`; WARNING for an unclosed opener or a published
heading whose title contains an exclude-list entry or Keeper
keyword; INFO for a Keeper-facing bold label or callout),
`pc-body [--folder SUB]` (for every `type: pc` sheet except
`*_Story.md` companions and `publish: none` pages;
fence-balance rows are reported here too: ERROR when `##
Current Status` sits inside a gm-only/spoiler fence; WARNING
when it comes after `## Notes`/`## GM Notes`, is not an H2, or
an H2 is duplicated; INFO when the block is missing, has no
labelled fields, or the first H2 isn't `## Stat Sheet`),
`wrapup [--file REL] [--fix]` (Wrap-Up conformance against
`shared/templates/session-wrap.md`: frontmatter backfills,
ERROR on a Keeper-facing sibling H2 that would publish, the
single `<!-- gm-only -->` fence around `## GM Notes`, recap-
heading and template-heading variants, filename pattern —
`--fix` applies the mechanical set including the re-nest;
dry-run rows print `WOULD-FIX`, `--fix` prints `FIXED`,
`UNCHANGED` means the repaired text is byte-identical to what
is on disk; a file whose gm-only fence is unbalanced or crosses
a player-facing section boundary gets its frontmatter
backfilled and its body left alone, for the GM to fix by hand;
filename renames are never automatic), `all`. `all` runs
`sessions`, `gm-leak`, `pc-body`, and `wrapup` (without
`--fix`) alongside the rest — never `version` or `active-pcs`,
which are gates, not reports, and sit outside it: `version`
prints one row whose first column is a verdict token (OK /
MISMATCH / AHEAD / SETUP / ERROR) and exits 1 on
MISMATCH/AHEAD/ERROR — run it on the first invocation of any
vault-aware skill; `active-pcs` emits the session skills'
opening roster read.
Findings are `LEVEL<TAB>path<TAB>message`; fix every ERROR,
triage WARNINGs with the GM, treat INFO as context.

`session_context.py <vault>` emits the session-prep read-set
in one call: latest Wrap-Up, active PC `## Current Status`
blocks, the upcoming session's Plan, deferred world flags,
campaign overview — each section tagged with its source path.
Drill into individual files only where the digest shows the
need.

Which session counts as "just played" comes from the campaign
overview's `last_session`, falling back to the most recent
`play_date` — not the highest `session_number`, which is not a
campaign-wide ordinal in a vault whose numbering restarts each
chapter. The session-anchored lookups — the wrap-up and the
upcoming plan — are then scoped to that session's chapter. The
rest of the bundle stays vault-wide, as it should: active PCs,
deferred flags, and the campaign overview are not per-chapter.

**A `Note:` line in the header means read before trusting.** It
appears when the choice was ambiguous (a `last_session` pointer
that resolves to nothing or to several files, a session number
present in more than one chapter) and when later session
indexes were ignored as unplayed. Confirm it with the GM: a
wrong bundle reads exactly as authoritative as a right one.

`stamp_entities.py <vault> FILE... [--session SESSION]
[--date YYYY-MM-DD] [--retag OLD=NEW]` batch-stamps
`asOfSession`, `lastUpdated`, and a chapter-tag swap across
files — `--session` and `--date` are now independent, so
either can be given alone. SESSION is written verbatim — a
label (`"Chapter 4, Session 9"`) or a bare number — and a file
already using the other shape is refused unless
`--force-shape`. It also takes `--set KEY=VALUE` (repeatable;
any other top-level or one-level dotted field — the fields
with their own flags below are refused, dotted forms
included), `--increment
KEY` (repeatable; +1 on an integer counter, and refused on
those same fields), `--promote`
(canon_status DRAFT/absent → AUTHORITATIVE; STUB and
SUPERSEDED are refused), `--reconciled YYYY-MM-DD`, and
`--supersede-by "[[Winner]]"` (canon_status → SUPERSEDED plus
`superseded_by`, mutually exclusive with `--promote`).
`--repair-canon [FILE...] [--write]` applies the legacy
canon-key repair from `shared/canon-status.md`: renames a lone
`source_confidence`/`confidence` to `canon_status`, deletes it
when it agrees, and on disagreement keeps `canon_status`,
drops the legacy line, and reports a CONFLICT for the GM to
confirm; with no FILE it sweeps the whole vault, `_Templates/`
and `_meta/` included, and runs on its own — never combined
with a stamping action in the same call. Dry-run by default —
review the plan, then re-run with `--write`. It touches only
the targeted frontmatter lines; everything else is preserved
byte-for-byte.

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/vault_check.py" \
  <vault-path> frontmatter --folder Characters
```

**After creating or updating entity files** (session-wrapup,
vault-ingest, campaign-organizer), run
`vault_check.py frontmatter --folder <dir>` on what you
touched and fix ERRORs before moving on — one deterministic
call replaces re-reading files to self-check.

If `python3` is not on PATH, try `python` (common on
Windows; install from python.org or `winget install python`
— the utilities are standard-library only). If neither
exists, say so and fall back to Grep: literal search with
synonyms for prose queries, `[[Name]]`-variant matching for
backlinks, and manual schema checks. For the newer checks
(`gm-leak`, `pc-body`, `wrapup`) the fallback is the prose
procedure in the owning skill instead — read it and apply the
same checks by eye. Flag the fallback in any audit results —
Grep approximations can miscount.

## File Format

All files use:

- YAML frontmatter with all schema fields
- `[[wiki-links]]` for entity cross-references
- Quoted `"[[Entity Name]]"` in frontmatter (Juggl format)
- Same folder structure, `_meta/` schema, naming conventions

Every campaign folder is a valid Obsidian vault — the user
can open it in Obsidian at any time with zero migration.

## Obsidian-App-Only Features

These render only inside the Obsidian app; skills never
depend on them:

- **Graph view / Juggl visualization** — metadata is written
  either way and visualizes when opened in Obsidian.
- **Smart Connections** — in-app semantic search for the
  user's own browsing; skills use `vault_search.py` instead.
- **Templater auto-application and Dataview queries** —
  template and query text is written as plain markdown.
