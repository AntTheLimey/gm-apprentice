# Graph Hygiene

Read this file during Weave, Validate, and the graph audit
step of Organize.

## Edge Principles

**Direct edges vs traversals.** Only create direct edges that
carry independent narrative meaning. If two NPCs share a location,
that's discoverable by traversal — don't add `associated_with`.

**Specificity.** `employs` > `associated_with`. Always use the
most specific relationship type. Flag generic types.

## Anti-patterns

- **Hub overload** — one entity connecting to everything.
- **Redundant edges** — same pair, same meaning, different
  type name.
- **Implied traversal edges** — redundant with short graph
  paths.
- **Orphaned entities** — zero relationships. Flag, don't
  delete.

## Required Relationships

| Entity Type | Required Relationship |
|-------------|----------------------|
| NPC / PC / creature | `located_at` |
| Faction / organization | `headquartered_at` |

Flag missing required relationships in every audit.

## Wiki-Link Conventions

**Frontmatter:** `"[[Entity Name]]"` (quoted, double brackets).
Juggl reads these as graph edges.

**Body text:** `[[Entity Name]]` on first mention per section.
Alias syntax: `[[Professor Albin Herzfeld|Herzfeld]]`.

**Scene entities:** The `entities:` frontmatter list is the
primary bridge between narrative and entity layers.
