# Worldbuilding Mode

The Midwife's standalone worldbuilding procedure. Extracted
from SKILL.md (which keeps the mode trigger). File paths are
relative to the skill root, as in SKILL.md.

### Standalone Worldbuilding Conversation

1. **Read the target domain file** in `_World/` (or create a
   stub from `shared/templates/world-domain.md` if none exists).
   If `_World/` doesn't exist, create it with `world-index.md`
   and `_flags.md` stubs first.
2. **Read related domain files** for cross-domain context.
   Consult `references/cross-domain-implications.md` to identify
   which domains connect to the target.
3. **Run a why-chain conversation.** Use questions from
   `references/worldbuilding-questions.md` for the target domain.
   One question at a time. Drill into causes and consequences
   for 2-3 turns per thread before moving to the next question.
4. **Update the domain file** — narrative body and any
   machine-checkable rules that emerged from the conversation.
   Rules use the `{ id, rule, check }` format.
5. **Surface cross-domain implications.** After the
   conversation, check `references/cross-domain-implications.md`
   and offer to update related domain files.
6. **Record Second-Order Notes** in relevant entity or domain
   files under `## Second-Order Notes` — non-obvious insights
   from why-chain conversations.

### Key Principles

- Ask questions the world needs to be answered, not questions a
  template needs to be filled
- Follow `references/worldbuilding-principles.md` — spiral
  method, iceberg principle, pitfall avoidance
- Read `_World/_flags.md` for deferred items related to the
  target domain — offer to resolve them during the conversation
- One question at a time. Wait for the GM's answer before
  asking the next question.
