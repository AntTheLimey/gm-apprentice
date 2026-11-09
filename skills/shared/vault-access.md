# Vault Access Reference

The vault is a folder of markdown. Access it with the filesystem
tools and the bundled scripts; nothing depends on the Obsidian app
being open.

## Tools

| Operation | Use |
|-----------|-----|
| Read / list / write / edit files and frontmatter | Read, Glob, Write, Edit |
| Exact-term search (names, dates, markers) | Grep |
| Ranked/prose search | `gma vault-search` |
| Backlinks, orphans, ambiguous links, dead ends | `gma graph-check` |
| Rename or move a note, rewriting every link to it (dry run first; `--apply` to do it) | `gma relink VAULT OLD NEW` |
| Broken links by kind, with the note each may mean; point a misspelt link at the right note, or turn a link into plain words, vault-wide or only on named pages (dry run first; `--write`) | `gma links VAULT`, `gma links VAULT retarget NAME NOTE`, `gma links VAULT unlink NAME... [--in NOTE] [--bare]` |
| Place text you wrote: start a Wrap-Up, add its sections, story entries, log lines, timeline lines (dry run first; `--write`) | `gma vault-write` |
| Entity schema validation, name similarity, index drift, stale drafts, changed-since listing | `gma vault-check` |
| Vault/plugin version gate | `gma vault-check VAULT version` |
| Session document chain status | `gma vault-check VAULT sessions` |
| Publish-safety scan (unfenced Keeper content, fence balance; + `--fix` re-nest) | `gma vault-check VAULT gm-leak` |
| PC body skeleton / Current Status placement / missing or unfilled Stat Sheet | `gma vault-check VAULT pc-body` |
| A PC's Current Status fields: print them, or rewrite the ones sent in place | `gma vault-write VAULT status PC --show` / `--write` |
| Threads: add one to the Campaign Overview's Open Threads, move a PC's onto it, close a shared or PC's one into the Wrap-Up's Resolved Threads (dry run first; `--write`) | `gma vault-write VAULT threads [--wrapup W]` |
| Wrap-Up conformance (+ `--fix` re-nest) | `gma vault-check VAULT wrapup` |
| Faults in the notes that change what the site shows (a named note with no page, a stray `%%`, an unclosed fence, a secret name in prose) | `gma vault-check VAULT site-faults` |
| What the site still hides in the notes a session touched | `gma reveal-scan VAULT INDEX [--also PATH]` |
| Publish what a session revealed, lift `withheld`, log it in `_meta/reveals.json` (dry run first; `--write`) | `gma reveal VAULT --session NAME` |
| Active PC roster | `gma vault-check VAULT active-pcs` |
| Session-prep context bundle (one call) | `gma session-context` |
| At-table plan brief | `gma session-context VAULT --play` |
| Thread ages / decay | `gma session-context VAULT --threads` |
| Prep bundle, brief form | `gma session-context VAULT --brief` |
| A prep run's opening read: version, brief bundle, reconcile scan, threads, arcs, scene queue, plans (Step 5) | `gma session-context VAULT --prep` |
| PC arc slice (Step 12) — replaces per-PC sheet reads | `gma session-context VAULT --arcs` |
| What the last Wrap-Up carries forward — replaces reading it | `gma session-context VAULT --carry --before INDEX` |
| Rebuild `_meta/index.md` | `gma index-build` |
| Session Plan conformance | `gma plan-check` |
| Write a session's Plan (or `--section`s of it), stamp its index, check it | `gma vault-write VAULT plan [options]` |
| File a new prop in its chapter's `Props/`, in its writer's hand, linked from its scene (dry run first; `--write`) | `gma vault-write VAULT prop-new [options]` |
| A scene that stopped part-way: its snapshot as `## Paused`, status and `played_in`; `--new` files one born at the table (dry run first; `--write`) | `gma vault-write VAULT scene-paused [options]` |
| Narrative-plan discovery (`Planning/` + `_midwife/`) | `gma plans-index` |
| Frontmatter writes (set/increment/promote/supersede/reconciled), legacy canon-key repair | `gma stamp-entities` |
| Ingest source classification manifest | `gma ingest-survey` |
| Ingest `_inbox/` archival (never deletes) | `gma ingest-survey VAULT --archive FILE ...` |
| Ingest image filing | `gma ingest-images` |
| Player-safe PC sheet view | `gma publish sheet show --player-safe` |
| Site rebuild (repoint, manifest, deploy+verify) | `gma publish update-pin` / `manifest diff` / `deploy --verify` |
| Site audit / why didn't this page publish / what the site holds of a note, read off its page as built | `gma publish doctor --site` / `explain PATH` / `explain PATH --shown` |

Use Grep when you know the term. Never hand-build a link map with
Grep — `gma graph-check` does it in one pass.

## Running the scripts

They live in `shared/scripts/` (stdlib Python 3); run them through `gma`:

```bash
gma graph-check \
  <vault-path> orphans --folder Characters
```

Run a command line a skill spells out as given. Use `--help` (or
`gma publish <subcommand> --help`) only for a flag or script the skill
doesn't spell out; flags, output rows and exit codes live there. Findings are `LEVEL<TAB>path<TAB>message`: fix every ERROR,
triage WARNINGs with the GM, treat INFO as context. Mutating scripts
are dry-run by default; `--write` / `--fix` / `--execute` applies.

After creating or updating entity files, run
`gma vault-check <vault-path> frontmatter --folder <dir>` on what you
touched and fix ERRORs before moving on.

## File format

YAML frontmatter with all schema fields; `[[wiki-links]]` for
cross-references; quoted `"[[Entity Name]]"` inside frontmatter.
Graph view, Smart Connections, Templater and Dataview work only in
the Obsidian app — write template and query text as plain markdown,
and search with `gma vault-search`.
