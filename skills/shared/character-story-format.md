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

The label follows the file's last entry (`Session 9`, `Chapter 4,
Session 2`). An entry that opens with its own `## ` heading keeps
it.

## Narrative Voice by Campaign Genre

Voice follows the campaign's genre/tone (campaign overview or world
file), not the game system (a GURPS horror campaign uses horror
voice).

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
- Narrative prose by default; a letter, a list or a `###` break is
  fine when the story calls for it

## Appending

Write the entries, then place them all in one call, on stdin
(`<<'EOF'`), each under a `# [[PC Name]]` line:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/vault_write.py" \
  <vault> story --wrapup "<wrap-up>" --as-of "<asOfSession value>" \
  --date YYYY-MM-DD --write
```

It creates a missing story file, appends at the bottom, stamps the
frontmatter and refuses a second entry for the same session.
Earlier entries are never edited.
