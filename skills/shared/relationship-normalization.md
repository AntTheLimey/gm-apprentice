# Relationship Normalization

The single narrative-verb → sanctioned-predicate map, shared by the
skills that **write** `relationships:` blocks (session-wrapup,
session-play, the-midwife, vault-ingest) and by the skills that **audit**
them (campaign-qa graph-health). Prevention and repair read the same
table, so drift can't reopen.

The authoritative vocabulary is the predicate table in
`shared/entity-schema.md`; a vault's `_meta/relationship-types.md` is its
genre-filtered subset. **Only ever write a `type:` that is in that
vocabulary.** When a play note gives you a narrative verb, do one of three
things, in order:

1. **Map it** to the nearest sanctioned predicate (below).
2. **Normalize its direction** if it is an inverse (below) — storage is
   single-direction.
3. **Drop it** if it is not an entity-to-entity edge (below).

## Normalize inverses to the base direction

Storage is single-direction: record the base predicate on the opposite
endpoint, never the inverse as its own edge.

| Written as (inverse/synonym) | Store as |
|------------------------------|----------|
| `owned_by A → B` | `owns B → A` |
| `employed_by` / `works_for A → B` | `employs B → A` |
| `led_by A → B` | `leads B → A` |
| `ruled_by A → B` | `rules B → A` |
| `commanded_by A → B` | `commands B → A` |
| `located_in` / `hosted_by A → B` | `located_at A → B` |
| `member A → B` (of a group) | `member_of A → B` |

For symmetric predicates (`knows`, `allied_with`, `borders`, `enemy_of`,
`rival_of`, `trades_with`, `sibling_of`, `spouse_of`, …) store once with
`bidirectional: true`, either direction.

## Map narrative verbs to sanctioned predicates

Non-exhaustive — extend by category, never by inventing a new `type:`.

| Narrative verb(s) | Sanctioned predicate |
|-------------------|----------------------|
| hosts, contains, part of, inside, within | `part_of` (child → parent) |
| adjacent to, next to, connects to | `borders` |
| stationed at, lives at, based at, appears at *(a place)* | `located_at` |
| HQ'd at, operates from | `headquartered_at` |
| carved by, forged by, built by, wrote, authored | `created` |
| carries, holds, bears, piloted by *(→ owner)* | `owns` / `wields` |
| serves under, reports to, assigned by | `serves` / `commands` (base direction) |
| raided, assaulted, attacked, besieged | `at_war_with` / `conquered` |
| deceives, misled, tricked, lied to | `deceived` |
| investigated by, questioned, interrogated | *usually not an edge — see below* |
| has intelligence on, spies on, watches | `infiltrates` / `studies` |

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
- **Sequencing** (`leads_to`, `precedes`, `alternative_to`) — clue-to-clue
  flow lives in the Clue's `leads_to` **frontmatter field**, never a
  `relationships:` block (see `entity-schema.md`).

When in doubt, a fact is an edge only if a graph query would want to
traverse it. Otherwise it is prose.
