# Character Story Format

Each active PC has a story file that grows session by session — a
rolling narrative of that character's journey.

## File Location

`Characters/PCs/{Name}_Story.md`, beside the PC entity file.
Discovered by naming convention, not a frontmatter pointer.

## Frontmatter

```yaml
---
type: character-story
character: "[[{Name}]]"
campaign: ""
canon_status: DRAFT
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

Voice follows the campaign's genre/tone, not the game system (a
GURPS horror campaign uses horror voice).

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
- This character's perspective, not a full session recap — the
  party-wide narrative, mechanical changes and world state belong
  in the Wrap-Up and entity files
- Include consequences: injuries, relationship shifts, new
  knowledge, emotional impact
- Narrative prose only, no bullet points

## Append Protocol

1. Read the existing story file (or create it from
   `shared/templates/character-story.md`)
2. Append `## Session {N} — {Title}` at the bottom
3. Write narrative prose for this session
4. Update `lastUpdated` and `asOfSession` in frontmatter
5. Never edit prior session entries (append-only)
