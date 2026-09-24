# Vault Access Reference

The vault is a folder of markdown. Access it with the filesystem
tools and the bundled scripts; nothing depends on the Obsidian app
being open.

## Tools

| Operation | Use |
|-----------|-----|
| Read / list / write / edit files and frontmatter | Read, Glob, Write, Edit |
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
| Prep bundle, brief form (Step 5 default) | `session_context.py --brief` |
| PC arc slice (Step 12) — replaces per-PC sheet reads | `session_context.py --arcs` |
| Rebuild `_meta/index.md` | `index_build.py` |
| Session Plan conformance | `plan_check.py` |
| Narrative-plan discovery (`Planning/` + `_midwife/`) | `plans_index.py` |
| Frontmatter writes (set/increment/promote/supersede/reconciled), legacy canon-key repair | `stamp_entities.py` |
| Ingest source classification manifest | `ingest_survey.py` |
| Ingest `_inbox/` archival (never deletes) | `ingest_survey.py --archive` |
| Ingest image filing | `ingest_images.py` |
| Player-safe PC sheet view | `gm-publish sheet show --player-safe` |
| Site rebuild (repoint, manifest, deploy+verify) | `gm-publish update-pin` / `manifest diff` / `deploy --verify` |
| Site audit / why didn't this page publish | `gm-publish doctor --site` / `explain PATH` |

Use Grep when you know the term. Never hand-build a link map with
Grep — `graph_check.py` does it in one pass.

## Running the scripts

They live in `skills/shared/scripts/` (stdlib Python 3). Invoke
via the plugin root:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/graph_check.py" \
  <vault-path> orphans --folder Characters
```

Run each script (or `gm-publish <subcommand>`) with `--help` before
its first use in a session; flags, output rows and exit codes live
there. Findings are `LEVEL<TAB>path<TAB>message`: fix every ERROR,
triage WARNINGs with the GM, treat INFO as context. Mutating scripts
are dry-run by default; `--write` / `--fix` / `--execute` applies.

After creating or updating entity files, run
`vault_check.py <vault-path> frontmatter --folder <dir>` on what you
touched and fix ERRORs before moving on.

## File format

YAML frontmatter with all schema fields; `[[wiki-links]]` for
cross-references; quoted `"[[Entity Name]]"` inside frontmatter.
Graph view, Smart Connections, Templater and Dataview work only in
the Obsidian app — write template and query text as plain markdown,
and search with `vault_search.py`.
