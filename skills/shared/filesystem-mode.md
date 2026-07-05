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
| Entity schema validation, name similarity, index drift, stale drafts | `vault_check.py` |

Grep is the right tool when you know the term (an entity
name, a date, a marker like `<!-- spoiler -->`). The
utilities cover what Grep can't: relevance ranking and link
graph analysis. Never hand-build a link map with Grep — the
utility does it in one pass (benchmarked: under a second and
a few hundred tokens, versus 50–125s and ~50k tokens for
per-query approaches).

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
`stale-drafts`, `all`. Findings are
`LEVEL<TAB>path<TAB>message`; fix every ERROR, triage
WARNINGs with the GM, treat INFO as context.

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
backlinks, and manual schema checks. Flag the fallback in
any audit results — Grep approximations can miscount.

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
