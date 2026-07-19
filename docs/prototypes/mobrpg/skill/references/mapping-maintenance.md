# Mapping maintenance

The vault↔mobRPG mapping is a living artifact — it drifts as the campaign grows
and as the mobRPG world changes. Keep it healthy before pushing, or you push
mis-typed entities.

## 1. Vocab→type map (`<vault>/_meta/mobrpg-map.json`)

Run `mobrpg map check <world> --vault <path>` (read-only; `--map FILE` if the
map isn't at the default path). It prints one line per section — `locationRouting`
plus one per `classifiers.*` key — each with `total/bound/new/review/confirmed`
counts. Act on:
- **new vault vocab** not yet mapped (professions, location types, classifiers the
  campaign just introduced) — shows up as `new`,
- map entries whose vocab **no longer exists** in the vault — surfaces as a
  `stale` note the next time you `sync`,
- routes still at **`status:"review"`** — these need a human decision (see §2).

If anything drifted, run `mobrpg map sync <world> --vault <path>` (confirm
first — it writes the map file). `sync` also re-discovers the live world's
vocab via the API, so the map tracks changes made on the mobRPG side too, and
it non-destructively preserves any entry you've hand-confirmed. If no map
exists yet at all, use `mobrpg map init <world> --vault <path>` instead
(confirm first — it writes a new map file) — `sync` refuses to run without an
existing file.

## 2. Resolve `review` routes — one at a time

For each route at `status:"review"`, don't batch-guess. Show the GM:
- the vault vocab term and where it appears,
- the candidate mobRPG types (from `mobrpg catalog <world> <kind>` — e.g.
  `political/type` or `landfeature` for a location route, `person/profession`
  for a profession classifier),
- your recommendation and why.

Take their decision, record it in the map, move to the next. The map is "clean"
only when `map check` reports zero `review` routes. Judgment here is the point —
a wrong type mapping propagates into every suggestion built from it.

**What lands in `review`:** a *location* whose type embeds a natural-feature
word but isn't itself a clean feature (e.g. "River port and boatyard on the
Nile" — a landfeature, or a place named after one?); the entry carries both a
`politicalType` default and a `landFeatureType` hint. A *classifier* value that
is a close match to an existing mobRPG type but not exact (e.g. vault
"Archaeologist" vs existing "archeologist" — likely a variant of it, carrying
`nearExisting`/`nearId`). **Resolve** by editing the map entry: bind it (set
`mobrpgId` to reuse the existing type), or confirm it as genuinely new (set
`status: "confirmed"`) — both survive the next `sync`. An *unresolved* classifier
review is dropped at push time, never minted, so it can't silently create a
near-duplicate type; resolve it before pushing.

## 3. Identity links (vault entity ↔ mobRPG element)

The `mobrpg:` node's `element_id` is the source of truth for identity (populated
by `pull-canon`). `external_ref` is the vault-relative path.

**Rename/move guard:** if a note was renamed or moved, its `external_ref` no
longer matches its path — pushing it would create a *duplicate* element and
orphan the old link. When you detect a path that changed against the node's
recorded `external_ref`, stop and re-point the ref before any push. This is the
name-collision hazard the foundation audit flagged.

Use the `relink` verb (vault-only — no API call):

```
.venv/bin/mobrpg relink --vault <path> --to <new-vault-relative-path>
```

It reads the note now at `--to`, rewrites `external_ref` to that current path,
keeps `element_id`, and records the prior ref in `previous_ref`. Add
`--from <old-vault-relative-path>` as a guard — it refuses if the note's current
ref doesn't match, so you can't relink the wrong note. Dry-run first (no
`--execute`): it prints the `old → new` ref and the preserved `element_id`;
show that to the GM, get an explicit yes, then re-run with `--execute`. Same
dry-run → present → confirm → `--execute` discipline as the other vault
mutations.
