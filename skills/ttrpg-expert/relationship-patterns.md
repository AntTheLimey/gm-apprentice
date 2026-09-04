# Relationship Patterns

How to model entity relationships in a vault: which predicate to
write, which direction to store it, and how the common shapes
(families, hierarchies, triangles) come out in the sanctioned
vocabulary.

**The vocabulary is fixed.** Every `relationships[].type` must be
one of the 77 predicates in the table below — the same table as
`shared/entity-schema.md` ("Relationship Types") and the
machine-readable `shared/gm-apprentice-ontology.json` that
`vault_check.py relationships` enforces. A vault's
`_meta/relationship-types.md` is a genre-filtered subset of it.
Never invent a type; when a play note gives you a narrative verb
("reports to", "guards", "lives in"), map it with
`shared/relationship-normalization.md`.

## The Edge

```yaml
relationships:
  - target: "[[Target Entity Name]]"
    type: member_of         # a predicate from the table below
    tone: respectful        # optional — see Tones
    strength: 7             # optional — 1-10, see Strength
    bidirectional: false    # true only for symmetric predicates
    description: "Serves as lieutenant"
```

`target` is a quoted wiki-link. `source` is the file the block
lives in. There are no IDs.

## Direction and Storage

**Storage is single-direction.** Each predicate has an inverse
name (right-hand column below) that is *implied* by the stored
edge and must never be written as its own edge. Record
`A --[employs]--> B` on A's file; do not also record
`B --[employed_by]--> A` on B's — `employed_by` is off-vocabulary
and the audit flags it.

**Symmetric predicates** (`knows`, `sibling_of`, `spouse_of`,
`betrothed_to`, `friend_of`, `rival_of`, `enemy_of`,
`allied_with`, `at_war_with`, `borders`, `trades_with`,
`negotiated_with`, `alter_ego_of`, `nemesis_of`) are stored
**once**, on either endpoint, with `bidirectional: true`.
Storing them on both endpoints is a duplicate edge, not
"consistency".

**Asymmetric predicates** are stored on the endpoint that is the
*subject* of the verb: the employer `employs`, the contained place
is `part_of` its container, the member is `member_of` the faction,
the liege has a `vassal_of` recorded on the vassal's file.

## Predicate Table

Generated from `shared/gm-apprentice-ontology.json`; a test keeps
this table and the export in step.

### Kinship

| Type | Inverse (implied, never stored) | Genre |
|------|--------------------------------|-------|
| `parent_of` | `child_of` | universal |
| `ancestor_of` | `descendant_of` | universal |
| `sibling_of` | — (symmetric) | universal |
| `spouse_of` | — (symmetric) | universal |
| `betrothed_to` | — (symmetric) | universal |

### Social

| Type | Inverse (implied, never stored) | Genre |
|------|--------------------------------|-------|
| `knows` | — (symmetric) | universal |
| `friend_of` | — (symmetric) | universal |
| `rival_of` | — (symmetric) | universal |
| `mentors` | `mentored_by` | universal |
| `trusts` | `trusted_by` | universal |
| `betrayed` | `betrayed_by` | universal |

### Power

| Type | Inverse (implied, never stored) | Genre |
|------|--------------------------------|-------|
| `rules` | `ruled_by` | universal |
| `employs` | `employed_by` | universal |
| `commands` | `commanded_by` | universal |
| `serves` | `served_by` | universal |
| `vassal_of` | `liege_of` | universal |
| `imprisons` | `imprisoned_by` | universal |

### Spatial

| Type | Inverse (implied, never stored) | Genre |
|------|--------------------------------|-------|
| `located_at` | `location_of` | universal |
| `headquartered_at` | `headquarters_of` | universal |
| `part_of` | `has_part` | universal |
| `borders` | — (symmetric) | universal |
| `haunts` | `haunted_by` | universal |

### Possession

| Type | Inverse (implied, never stored) | Genre |
|------|--------------------------------|-------|
| `owns` | `owned_by` | universal |
| `created` | `created_by` | universal |
| `wields` | `wielded_by` | universal |
| `seeks` | `sought_by` | universal |

### Knowledge

| Type | Inverse (implied, never stored) | Genre |
|------|--------------------------------|-------|
| `discovered` | `discovered_by` | universal |
| `conceals` | `concealed_by` | universal |
| `recorded_in` | `records` | universal |
| `studies` | `studied_by` | universal |

### Conflict

| Type | Inverse (implied, never stored) | Genre |
|------|--------------------------------|-------|
| `enemy_of` | — (symmetric) | universal |
| `at_war_with` | — (symmetric) | universal |
| `conspires_against` | `conspired_against_by` | universal |
| `allied_with` | — (symmetric) | universal |

### Affiliation

| Type | Inverse (implied, never stored) | Genre |
|------|--------------------------------|-------|
| `member_of` | `has_member` | universal |
| `founded` | `founded_by` | universal |
| `leads` | `led_by` | universal |
| `defected_from` | `lost_member` | universal |
| `infiltrates` | `infiltrated_by` | universal |

### Supernatural

| Type | Inverse (implied, never stored) | Genre |
|------|--------------------------------|-------|
| `bound_to` | `binds` | fantasy, horror |
| `cursed_by` | `cursed` | fantasy, horror |
| `summoned` | `summoned_by` | fantasy, horror |
| `worships` | `worshipped_by` | fantasy, horror |
| `corrupted_by` | `corrupted` | fantasy, horror |

### Temporal

| Type | Inverse (implied, never stored) | Genre |
|------|--------------------------------|-------|
| `caused` | `caused_by` | universal |
| `triggered` | `triggered_by` | universal |
| `participated_in` | `had_participant` | universal |
| `witnessed` | `witnessed_by` | universal |

### Economic

| Type | Inverse (implied, never stored) | Genre |
|------|--------------------------------|-------|
| `trades_with` | — (symmetric) | universal |
| `supplies` | `supplied_by` | universal |
| `finances` | `financed_by` | universal |
| `indebted_to` | `creditor_of` | universal |

### Event

| Type | Inverse (implied, never stored) | Genre |
|------|--------------------------------|-------|
| `murdered` | `murdered_by` | universal |
| `poisoned` | `poisoned_by` | universal |
| `wounded` | `wounded_by` | universal |
| `rescued` | `rescued_by` | universal |
| `captured` | `captured_by` | universal |
| `deceived` | `deceived_by` | universal |

### Horror

| Type | Inverse (implied, never stored) | Genre |
|------|--------------------------------|-------|
| `possessed_by` | `possesses` | horror |
| `infected_by` | `infected` | horror |
| `fears` | `feared_by` | horror |
| `feeds_on` | `fed_upon_by` | horror |

### Romance

| Type | Inverse (implied, never stored) | Genre |
|------|--------------------------------|-------|
| `courts` | `courted_by` | romance |
| `rejected` | `rejected_by` | romance |
| `disguised_as` | `disguise_of` | romance |
| `blackmails` | `blackmailed_by` | romance |

### Historical

| Type | Inverse (implied, never stored) | Genre |
|------|--------------------------------|-------|
| `conquered` | `conquered_by` | historical |
| `exiled_from` | `exiled` | historical |
| `succeeded` | `preceded` | historical |
| `negotiated_with` | — (symmetric) | historical |

### Sci-Fi

| Type | Inverse (implied, never stored) | Genre |
|------|--------------------------------|-------|
| `uploaded_to` | `upload_source_of` | scifi |
| `augmented_by` | `augments` | scifi |
| `cloned_from` | `clone_source_of` | scifi |
| `hacked` | `hacked_by` | scifi |

### Superhero

| Type | Inverse (implied, never stored) | Genre |
|------|--------------------------------|-------|
| `alter_ego_of` | — (symmetric) | superhero |
| `empowered_by` | `empowers` | superhero |
| `nemesis_of` | — (symmetric) | superhero |

## Tones

Optional emotional colour on any edge. One of:

| Positive | Negative | Neutral |
|----------|----------|---------|
| friendly, romantic, respectful, professional | hostile, fearful, distrustful, contemptuous | neutral, unknown, complicated |

Tone is how the *source* feels about the *target*. A `rival_of`
edge can be `respectful` (honourable competition) or `hostile`;
a `serves` edge can be `professional` or `fearful`. Default to
`neutral` when the source text is ambiguous.

## Strength

Optional 1-10 intensity, defaulting to 5 when unknown:

| Strength | Meaning |
|----------|---------|
| 1-2 | Weak, casual |
| 3-4 | Moderate |
| 5-6 | Significant |
| 7-8 | Strong |
| 9-10 | Defining |

## Required Relationships

Every audit flags these when missing:

| Entity type | Must have |
|-------------|-----------|
| NPC, PC, creature | `located_at` |
| Faction, organization | `headquartered_at` |

A location's containment is written twice — the
`parent_location:` scalar (site listing) *and* a `part_of` edge
(the graph) — and the two must agree. See
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
