# Character Story Format

Reference for PC companion story files. Each active PC has a
story file that grows session by session — a rolling narrative
of that character's journey through the campaign.

## File Location

Story files live alongside their PC entity file:
`Characters/PCs/{Name}_Story.md`

Discovered by naming convention, not frontmatter pointer.

## Frontmatter

```yaml
---
type: character-story
character: "[[{Name}]]"
campaign: ""
source_confidence: DRAFT
lastUpdated: ""
asOfSession: ""
createdSession: ""
---
```

## Structure

Each session adds one entry at the bottom of the file:

```markdown
## Session {N} — {Session Title}

{2-4 paragraphs of narrative prose covering what this
character did, decided, learned, and how they were changed.}
```

## Narrative Voice by Campaign Genre

Voice is tied to the campaign's genre/tone, not the game
system. A GURPS horror campaign uses atmospheric horror voice;
a GURPS space opera uses something different.

| Genre | Voice |
|-------|-------|
| Horror | Atmospheric, building dread, psychological weight |
| Heroic Fantasy | Vivid action, consequence, wonder |
| Noir/Industrial | Terse, street-level, moral grey |
| Military/Tactical | Precise, competence-focused |
| Pulp Adventure | Breathless pace, larger-than-life |
| Mystery/Investigation | Observational, clue-driven, tension |
| Social/Intrigue | Relationship-focused, subtext |
| Generic | Neutral third-person, clear and direct |

## Writing Rules

- Character names, not player names
- Past tense for events, present for ongoing states
- Wiki-links (`[[Entity Name]]`) for every entity reference
- Focus on this character's perspective, not full session recap
- Include consequences: injuries, relationship shifts, new
  knowledge, emotional impact
- No bullet points — narrative prose only
- 2-4 paragraphs per session entry

## Append Protocol

1. Read existing story file (or create from template if none)
2. Append new `## Session {N} — {Title}` at the bottom
3. Write narrative prose for this session
4. Update `lastUpdated` and `asOfSession` in frontmatter
5. Never edit prior session entries (append-only)

## Story vs Wrap-Up Content

Story files capture a single character's narrative arc.
Session wrap-ups capture the full session for the whole party.

| Content | Story file | Wrap-up |
|---------|-----------|---------|
| What this PC did | Yes | PC Carry-Forward only |
| Full session narrative | No | Narrative Recap |
| Mechanical changes | No (stat sheet) | Entity updates |
| NPC relationship shifts | Yes, narratively | Carry-forward |
| World state changes | No | World State section |
