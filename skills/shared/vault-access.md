# Vault Access Reference

Read this file to determine how to access the campaign vault.
Vault access is plain filesystem tools plus bundled
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
| At-table plan brief | `session_context.py --play` |
| Thread ages / decay | `session_context.py --threads` |
| Rebuild `_meta/index.md` from a vault scan | `index_build.py` |
| Session Plan conformance | `plan_check.py` |
| Narrative-plan discovery (`Planning/` + `_midwife/`) | `plans_index.py` |
| Frontmatter writes (set/increment/promote/supersede/reconciled) and legacy canon-key repair | `stamp_entities.py` |
| Ingest source classification manifest (zero-read where extension/frontmatter settles it, indicator-scored otherwise) | `ingest_survey.py` |
| Ingest `_inbox/` processed-file archival (date-stamped, never deletes) | `ingest_survey.py --archive` |
| Ingest image filing (slug match, convert non-web-safe, portrait/embed) | `ingest_images.py` |
| Player-safe PC sheet view | `gm-publish sheet show --player-safe` |
| Site rebuild (repoint, manifest, deploy+verify) | `gm-publish update-pin` / `manifest diff` / `deploy --verify` |
| Site audit / why didn't this page publish | `gm-publish doctor --site` / `explain PATH` |

Grep is the right tool when you know the term (an entity
name, a date, a marker like `<!-- spoiler -->`). The
utilities cover what Grep can't: relevance ranking and link
graph analysis. Never hand-build a link map with Grep — the
utility does it in one pass (benchmarked: under a second and
a few hundred tokens, versus 50–125s and ~50k tokens for
per-query approaches).

## Bundled Utilities

All live in `skills/shared/scripts/`, stdlib-only Python 3.
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

Every utility documents itself: run it with `--help` before its first
use in a session — the flags, output rows, and exit codes live there,
not in this file. Findings are `LEVEL<TAB>path<TAB>message`; fix every
ERROR, triage WARNINGs with the GM, treat INFO as context. Mutating
scripts are dry-run by default; `--write` / `--fix` / `--execute`
applies. `gm-publish <subcommand> --help` does the same for the
publish tool's subcommands.

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/vault_check.py" \
  <vault-path> frontmatter --folder Characters
```

**After creating or updating entity files** (session-wrapup,
vault-ingest, campaign-organizer), run
`vault_check.py frontmatter --folder <dir>` on what you
touched and fix ERRORs before moving on — one deterministic
call replaces re-reading files to self-check.

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
