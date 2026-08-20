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

The same pairing applies to a Faction's `territory:` / `headquartered_at`
and an Item's `current_holder:` / `owns`.

## Interposing a new container — re-point its children

Creating an entity that sits **between** an existing parent and its
existing children is only half the job. A district between a station and
its venues, a wing between a manor and its rooms, a cell between a faction
and its members: unless the children are re-pointed at the new container,
it lands as a childless leaf sitting at the same level as the things it is
supposed to contain, and the hierarchy is flatter than before it existed.

Nothing about creating the container surfaces this — the children's own
files are untouched and still say what they said yesterday. So make it an
explicit step:

1. **List the candidates.** Everything currently pointing at the *old*
   parent (or at nothing) that the new container's own prose, its
   `points_of_interest`, or the play notes place inside it.
2. **Present them to the GM for a yes/no each.** Never re-parent silently
   — "inside the district" is a canon claim, and some siblings genuinely
   stay siblings.
3. **For each confirmed child, update the pair that matches the
   containment's kind** — on the **child's** file, never the container's.
   Containment is stored child → parent, single-direction, so the
   container itself gains nothing but its own edge to *its* parent.

   | What is being contained | Scalar field | Edge |
   |---|---|---|
   | A place inside a place (venue in a district, room in a wing) | `parent_location` | `part_of` |
   | A faction inside a faction (a cell under its parent body) | *(none)* | `part_of` |
   | A **person in a faction** (a member moved to a new cell) | *(none)* | `member_of` |
   | A faction's seat of operations | `territory` | `headquartered_at` |

   `parent_location` is a **Location** field and exists for location
   containment only. There is no membership scalar — a person's place in
   a faction lives entirely on the `member_of` edge, which mobRPG reifies
   as a Membership event. Do not write `parent_location` onto a person
   because their cell changed, and do not use `part_of` for membership:
   it is off-vocabulary there and pushes as a junk Generic node.

Do this at creation time. A container that has been childless for a few
sessions reads as deliberate, and by then nobody remembers which venues
were meant to be on the strip.

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
- **Sequencing / branching** (`leads_to`, `precedes`, `alternative_to`) —
  node-based narrative flow lives in the **`leads_to` frontmatter field** on
  Clue and Plan entities (an array of wiki-links; two or more targets is a
  branch), never a `relationships:` block. `precedes` folds into `leads_to`;
  `alternative_to` is emergent from multiple targets (see `entity-schema.md`).

When in doubt, a fact is an edge only if a graph query would want to
traverse it. Otherwise it is prose.
