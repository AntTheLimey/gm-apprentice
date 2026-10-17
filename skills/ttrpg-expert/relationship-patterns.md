# Relationship Patterns

How to model entity relationships in a vault: which predicate to
write, which direction to store it, and how the common shapes
(families, hierarchies, triangles) come out in the sanctioned
vocabulary.

**The vocabulary is fixed.** Every `relationships[].type` must be
one of the sanctioned predicates, which `shared/gm-apprentice-ontology.json`
holds and `vault_check.py relationships` enforces. A new vault's
`_meta/relationship-types.md` starts with the full list; older
vaults may hold a genre subset.
Never invent a type; when a play note gives you a narrative verb
("reports to", "guards", "lives in"), map it with
`shared/relationship-normalization.md`.

For the words (types, their reverse names, tones, strength), run
`node "${CLAUDE_PLUGIN_ROOT}/tools/publish/bin/gm-publish.js" relationships words --vault <vault>`;
it prints only what this vault uses.

## The Edge

```yaml
relationships:
  - target: "[[Target Entity Name]]"
    type: member_of         # a predicate from `relationships words`
    tone: respectful        # optional — see below
    strength: 7             # optional — 1-10, 5 when unknown
    bidirectional: false    # true only for symmetric predicates
    description: "Serves as lieutenant"
```

`target` is a quoted wiki-link. `source` is the file the block
lives in. There are no IDs.

Tone is how the *source* feels about the *target*. A `rival_of`
edge can be `respectful` (honourable competition) or `hostile`;
a `serves` edge can be `professional` or `fearful`. Default to
`neutral` when the source text is ambiguous.

## Direction and Storage

**Storage is single-direction.** Each predicate has an inverse
name (after the `>` in `relationships words`) that is *implied* by the stored
edge and must never be written as its own edge. Record
`A --[employs]--> B` on A's file; do not also record
`B --[employed_by]--> A` on B's — `employed_by` is off-vocabulary
and the audit flags it.

**Symmetric predicates** (marked `=` in the `relationships words`
list) are stored **once**, on either endpoint, with
`bidirectional: true`. Storing them on both endpoints is a duplicate edge, not
"consistency".

**Asymmetric predicates** are stored on the endpoint that is the
*subject* of the verb: the employer `employs`, the contained place
is `part_of` its container, the member is `member_of` the faction,
the liege has a `vassal_of` recorded on the vassal's file.

A location's containment is written twice: the `parent_location:`
field and a `part_of` tie. The two must agree; see
`shared/relationship-normalization.md`.

## Modeling Patterns

### Family Network

```text
Grandfather ─┬─ Grandmother
             │
             ├─ Father ─┬─ Mother
             │          │
             │          ├─ Player Character
             │          └─ Sibling
             │
             └─ Uncle ─── Cousin
```

- Grandfather → Grandmother: `spouse_of`, `bidirectional: true`
  (stored once)
- Grandfather → Father, Grandfather → Uncle: `parent_of`
- Father → Mother: `spouse_of`, `bidirectional: true`
- Father → PC, Father → Sibling, Uncle → Cousin: `parent_of`
- PC → Sibling: `sibling_of`, `bidirectional: true`
- Cousins, aunts, in-laws: not first-class predicates — they are
  *implied by traversal* (two `parent_of` hops). Do not add an
  edge for a relationship the graph already expresses; note it in
  `description` on the nearest real edge if it matters at the
  table.

### Faction Hierarchy

```text
Faction Leader
     │
     ├── Lieutenant 1
     │      ├── Member A
     │      └── Member B
     │
     └── Lieutenant 2
            └── Member C
```

- Leader → Faction: `leads`, strength 9-10
- Every person → Faction: `member_of`
- Leader → Lieutenant: `commands` (or `employs` for a payroll
  relationship, `rules` for a sovereign)
- Lieutenant → Member: `commands`
- "Reports to" is the inverse view of `commands`; store it on the
  commander's file, never as `reports_to`.

### Love Triangle

```text
    Character A
      /     \
     /       \
Character B ─ Character C
```

- A → B: `courts` (asymmetric — A is pursuing B); if mutual, a
  second `courts` from B → A is a *different* edge, not a
  duplicate
- A → C: `courts`
- B → C: `rival_of`, `bidirectional: true`, tone `hostile` or
  `complicated`
- A married to B while courting C: B → A `spouse_of`
  (`bidirectional: true`), plus A → C `courts` — the graph now
  carries the affair without a `romantic` type that doesn't exist.

### Patron and Client

- Patron → Client: `finances` (money) or `employs` (labour) or
  `mentors` (craft)
- Client → Patron: `serves` (loyalty) or `indebted_to` (obligation)
- These are two different facts and may both be true; two edges
  in opposite directions with *different* predicates are not a
  duplicate.

### Haunting and Possession

- Ghost → Place: `haunts`
- Victim → Entity: `possessed_by` (stored on the victim's file)
- Cult → Deity: `worships`; Cultist → Deity: `corrupted_by` (on
  the cultist's file)

## Best Practices

1. **Most specific predicate that fits.** Vague types like
   `associated_with` / `related_to` are not in the vocabulary, on purpose.
2. **One edge per fact.** If two entities share a fact, it lives
   on one file. Do not mirror it "for completeness".
3. **Description carries the nuance.** Predicate + tone +
   strength is the queryable part; the *why* goes in
   `description`, traceable to a source.
4. **Update, don't accumulate.** When a relationship changes,
   edit the edge (and `tone`/`strength`); do not leave the old
   one beside the new one.
5. **Graph edges are entity-to-entity.** "Appears in Session 3"
   is a log reference, not a relationship — leave it out of
   `relationships:`.
6. **Sequencing is not a relationship.** "This clue leads to that
   scene" goes in the `leads_to` frontmatter field on Clue and
   Plan entities, never as an edge. There is no `precedes` or `alternative_to` predicate
   (see `shared/entity-schema.md`).

### Visualization Hints

- Node size: entity importance (hub degree)
- Edge thickness: `strength`
- Edge colour: `tone`
- Edge style: symmetric (no arrowhead) vs directed (arrow from
  the stored source)
