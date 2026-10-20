# Relationship Normalization

The single narrative-verb → sanctioned-predicate map, shared by the
skills that **write** `relationships:` blocks (session-wrapup,
session-play, the-midwife, vault-ingest) and by the skills that **audit**
them (campaign-qa graph-health). Prevention and repair read the same
table, so drift can't reopen.

The vocabulary is `shared/gm-apprentice-ontology.json` (the predicate
table in `shared/entity-schema.md` is generated from it); a new vault's `_meta/relationship-types.md`
starts with the full list, and older vaults may hold a genre subset.
**Only ever write a `type:` that is in that vocabulary.** When a play note
gives you a narrative verb, do one of three things, in order:

1. **Map it** to the nearest sanctioned predicate (below).
2. **Normalize its direction** if it is an inverse (below) — storage is
   single-direction.
3. **Drop it** if it is not an entity-to-entity edge (below).

## Normalize inverses to the base direction

Storage is single-direction: record the base predicate on the opposite
endpoint, never the inverse as its own edge.

<!-- generated:synonyms (scripts/gen_ontology_docs.py) -->
| Written as (inverse/synonym) | Store as |
|------------------------------|----------|
| `owned_by A → B` | `owns B → A` |
| `employed_by` / `works_for A → B` | `employs B → A` |
| `led_by A → B` | `leads B → A` |
| `ruled_by A → B` | `rules B → A` |
| `commanded_by A → B` | `commands B → A` |
| `located_in` / `hosted_by A → B` | `located_at A → B` |
| `member A → B` (of a group) | `member_of A → B` |
<!-- /generated:synonyms -->

For symmetric predicates (the ones `relationships words` marks with `=`)
store once with `bidirectional: true`, either direction.

## Containment is two fields, and they must agree

A location's containment is recorded twice, for two different consumers:

- `parent_location:` — a frontmatter scalar. Groups the published Locations
  listing. Read by the site build.
- a `part_of` edge in `relationships:` — the graph edge. Read by every graph
  query, by campaign-qa, and by the mobRPG sync.

Neither implies the other. **Write both, or the containment only half
exists.** A note carrying only the scalar looks correctly nested on the
site while being an orphan in the graph and invisible to a push — which is
exactly what happened to the Dead End vault's Entertainment District
venues.

An item's `current_holder:` pairs the same way with an `owns` tie on the holder's note.

## Interposing a new container — re-point its children

A container created between a parent and its children (a district
between a station and its venues, a cell between a faction and its
members) lands childless unless the children are re-pointed at it.
The relationships check reports it as a `childless-container` INFO
row: the container is `part_of` a parent and lists, under
`points_of_interest`, notes of its own type that are `part_of` the
same parent or unplaced.

To answer the row, or when creating the container:

1. **Ask the GM yes or no for each candidate.** Never re-parent
   silently: "inside the district" is a canon claim, and some
   siblings stay siblings.
2. **For each yes, update the child's file**, never the
   container's (containment is stored child → parent):

   | What is being contained | Scalar field | Edge |
   |---|---|---|
   | A place inside a place (venue in a district, room in a wing) | `parent_location` | `part_of` |
   | A faction inside a faction (a cell under its parent body) | `part_of` | `part_of` |
   | A **person in a faction** (a member moved to a new cell) | *(none)* | `member_of` |
   | A faction's seat of operations | *(none)* | `headquartered_at` |

   The edge is authoritative; a scalar left behind is the
   divergence to fix. Never write `parent_location` onto a person,
   and never use `part_of` for membership.

## Map narrative verbs to sanctioned predicates

Non-exhaustive — extend by category, never by inventing a new `type:`.

<!-- generated:verbs (scripts/gen_ontology_docs.py) -->
| Narrative verb(s) | Sanctioned predicate |
|-------------------|----------------------|
| hosts, contains | `part_of` *(on the other note)* |
| inside, within | `part_of` |
| adjacent to, next to, connects to | `borders` |
| stationed at, lives at, based at, appears at | `located_at` |
| HQ'd at, operates from | `headquartered_at` |
| carved by, forged by, built by | `created` *(on the other note)* |
| wrote, authored | `created` |
| carries, holds, bears | `owns` / `wields` |
| piloted by | `owns` *(on the other note)* |
| serves under | `serves` |
| reports to, assigned by | `commands` *(on the other note)* |
| raided, assaulted, attacked, besieged | `at_war_with` / `conquered` |
| deceives, misled, tricked, lied to | `deceived` |
| has intelligence on, spies on, watches | `infiltrates` / `studies` |
| visited by | `located_at` *(on the other note)* / `participated_in` *(on the other note)* |
| affiliated with | `member_of` / `allied_with` |
| investigated by, questioned, interrogated, appears in | *not an edge, see below* |
<!-- /generated:verbs -->

If no predicate is close, prefer the most general in the right category
over inventing one, and leave a `description:` that keeps the specific
verb for a human reader.

## Not graph edges — drop them

Some play-note facts are narrative, not entity-to-entity relationships.
Do not force them into the graph:

- **`appears_in <session_*>`** and any edge whose target is a session /
  scene / play-notes file — that is a log reference, not an entity edge.
- **One-off actions** with no lasting structural meaning (`threatened`,
  `marked`, `released_in`, `encountered_by`) — capture them in the
  entity's prose or a timeline event, not as an edge.
- **Sequencing / branching** (`leads_to`, `precedes`, `alternative_to`) —
  node-based narrative flow lives in the **`leads_to` frontmatter field** on
  Clue and Plan entities (an array of wiki-links; two or more targets is a
  branch), never a `relationships:` block. `precedes` folds into `leads_to`;
  `alternative_to` is emergent from multiple targets (see `entity-schema.md`).

When in doubt, a fact is an edge only if a graph query would want to
traverse it. Otherwise it is prose.
