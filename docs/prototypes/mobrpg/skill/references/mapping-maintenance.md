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
exists yet at all, use `mobrpg map init <world> --vault <path>` instead —
`sync` refuses to run without an existing file.

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

> **Current CLI status:** today's `map` routing resolves every ambiguous vocab
> term automatically (location routing follows "Ant's rule": natural-feature
> words go to `landfeature`, everything else defaults to a `political` type;
> classifier routing binds-or-proposes with no ambiguity check) — so no route
> is ever actually parked at `status:"review"`, even though the schema and
> `map check`'s `review=N` column support it. This loop is the workflow the
> skill runs once the CLI is extended to flag genuinely ambiguous vocab as
> `review` instead of auto-resolving it (tracked as **G2** in
> `docs/prototypes/mobrpg/CLI-GAPS.md`). Until then, this section is dormant —
> skip straight to §3 if `map check` shows `review=0` everywhere, which it
> always will.

## 3. Identity links (vault entity ↔ mobRPG element)

The `mobrpg:` node's `element_id` is the source of truth for identity (populated
by `pull-canon`). `external_ref` is the vault-relative path.

**Rename/move guard:** if a note was renamed or moved, its `external_ref` no
longer matches its path — pushing it would create a *duplicate* element and
orphan the old link. When you detect a path that changed against the node's
recorded `external_ref`, stop and offer to re-point the ref (keeping the
`element_id`, recording the old path) rather than let a dup be created. This
is the name-collision hazard the foundation audit flagged.

There is no `mobrpg` verb that performs this re-point — no command reads an
existing node and rewrites just its `external_ref`. Treat it as a manual edit
of the note's `mobrpg:` frontmatter block: update `external_ref` to the note's
current vault-relative path, leave `element_id` untouched, and note the old
path (e.g. in `review_note`) so the change is traceable. Show the GM the
before/after of the block and get an explicit yes before writing — it's a
hand-edit, not a scripted mutation, so there's no dry-run flag to lean on;
your own preview of the diff is the confirmation step.
