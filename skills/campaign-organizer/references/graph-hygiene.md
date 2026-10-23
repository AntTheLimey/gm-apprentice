# Graph Hygiene

Read this file during Weave, Validate, and the graph audit
step of Organize.

## Edge Principles

**Vocabulary.** Every `type:` must be a predicate in
`_meta/relationship-types.md` (see `shared/entity-schema.md`).
To place an edge from a narrative verb, map it and normalize its
direction with `shared/relationship-normalization.md`.

**The check.** `vault_check.py <vault> relationships` checks every
relationship rule (vocabulary, direction, ties stored twice, the
two-way flag, containment, ties to session notes, hubs); never
check those by eye. Then run `node
"${CLAUDE_PLUGIN_ROOT}/tools/publish/bin/gm-publish.js" relationships
fix --vault <vault> --json`: it lists the certain repairs (`changes`,
each with its `kind`) and the ties it will not touch (`kept`, each
with its reason), and changes nothing. Show them to the GM by kind,
take one yes for all of the changes, run it again with `--write`
instead of `--json`, then walk the rows left with the GM by kind
(`gm-publish.js relationships check --vault <vault> --json` gives
each finding its `kind`), ERROR first, then WARNING. List INFO rows
once.

**What the check cannot judge.** Only create a direct edge that
carries its own narrative meaning: two NPCs who share a location
need no direct tie, the traversal shows it. Use the most specific
type that says what the tie means. Two ties on one pair that
mean the same thing are one too many. Orphans
(`graph_check.py orphans`): flag, don't delete.

## Wiki-Link Conventions

**Frontmatter:** `"[[Entity Name]]"` (quoted, double brackets).
Juggl reads these as graph edges. `vault_check.py frontmatter`
(see `shared/vault-access.md`) flags unquoted frontmatter links.

**Body text:** `[[Entity Name]]` on first mention per section.
Alias syntax: `[[Professor Albin Herzfeld|Herzfeld]]`.

**Scene entities:** A scene's `entities:` list is the primary
bridge between narrative and entity layers. Its sessions go in
`played_in`, never an edge.
