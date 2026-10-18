# World-Rule Validation

When creating or modifying entities, campaign-organizer checks
the entity against active `_World/` rules. All validation is
advisory — never blocking.

## When to Validate

- During entity creation (Organize, Dissect modes)
- During entity updates (Weave mode)
- Only when `_World/` exists and a domain file that could apply
  has `status: active` and `rules`

## Validation Procedure

1. Read the domain files that could apply to this entity type:

   | Domain File | Entity Types |
   |-------------|-------------|
   | heritages.md | npc, pc |
   | history-timeline.md | event, any with a date or era |
   | geography-climate.md | location |
   | politics-governance.md | faction, organization |
   | economics-trade.md | faction, location |
   | magic-technology.md | any |

   A vault may name its domain files differently; go by each
   file's `domain` and `summary`.

2. Read each rule (a sentence, or the `rule` of an
   `{ id, rule, check }` entry) and ask whether the entity
   contradicts it. A rule describes the world; an entity that
   bends it may be the point.

3. For each contradiction, surface the finding:
   > "This NPC is 400 years old, but world rules say humans live
   > 60-85 years. Intentional?"

4. Present three-state prompt:
   - **Canon** — the exception is intentional. Note it on the
     entity (e.g., `age_note: "Unnaturally long-lived due to
     Mythos exposure"`). Optionally update the world rule.
   - **Ignore** — the contradiction doesn't matter. Add to
     `_flags.md` ignored section to suppress future flags.
   - **Defer** — not sure yet. Add to `_flags.md` deferred
     section. Continue with entity creation.

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
