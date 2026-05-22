# World-Rule Validation

When creating or modifying entities, campaign-organizer checks
the entity against active `_World/` rules. All validation is
advisory — never blocking.

## When to Validate

- During entity creation (Organize, Dissect modes)
- During entity updates (Weave mode)
- Only when `_World/` exists and relevant domain files have
  `status: active` with `rules` entries

## Validation Procedure

1. Read `_World/` domain files that could apply to this entity
   type:
   - NPCs/PCs → `heritages.md` (lifespan, heritage list)
   - Locations → `geography-climate.md`
   - Factions → `politics-governance.md`, `economics-trade.md`
   - Any entity → `magic-technology.md` (tech era constraints)

2. For each rule with a `check` object, evaluate:
   - `field` — does this entity have this field?
   - `max` / `min` — is the value within range?
   - `allowed_values` — is the value in the list?
   - `entity_type` — does this rule apply to this entity type?

3. For each violation, surface the finding:
   > "This NPC is 400 years old, but world rules say humans live
   > 60-85 years. Intentional?"

4. Present three-state prompt:
   - **Canon** — the exception is intentional. Note it on the
     entity (e.g., `age_note: "Unnaturally long-lived due to
     Mythos exposure"`). Optionally update the world rule.
   - **Ignore** — the violation doesn't matter. Add to
     `_flags.md` ignored section to suppress future flags.
   - **Defer** — not sure yet. Add to `_flags.md` deferred
     section. Continue with entity creation.

## Checks That Fire

| Domain File | Entity Types | What's Checked |
|-------------|-------------|----------------|
| heritages.md | npc, pc | Age vs lifespan range, heritage vs allowed list |
| geography-climate.md | location | Settlement rules (if defined) |
| politics-governance.md | faction, organization | Hierarchy depth, required relationships |
| economics-trade.md | faction, location | Economic base rules (if defined) |
| magic-technology.md | any | Tech era constraints (if defined) |

## Reading _flags.md

Before surfacing a finding, check `_flags.md`:
- If the topic is in **Ignored** → suppress silently
- If the topic is in **Deferred** → note the existing deferral
- If new → surface normally

## Ad-Hoc Bootstrap

If a validation finding requires a `_World/` file that doesn't
exist (e.g., the GM confirms a heritage but `heritages.md`
doesn't exist), create it:
1. Create `_World/` if it doesn't exist (with world-index.md
   and _flags.md stubs)
2. Create the domain file as a stub with the new content
3. Update world-index.md
