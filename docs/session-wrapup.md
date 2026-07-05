# session-wrapup

## What It Does

Your post-session workhorse. session-wrapup turns raw play notes into organized campaign records: narrative recaps, entity updates, timeline entries, and a carry-forward package that session-prep will use next time.

## When to Use It

Reach for session-wrapup when you need to:

- Process session notes into a structured recap
- Update entity files with what happened in play
- Add events to the campaign timeline
- Identify what carries forward to the next session
- Create vault files for NPCs, locations, or items that appeared during play

## What You Need

**Obsidian:** Recommended. session-wrapup creates and updates vault files directly during wrap-up. Works on plain markdown folders; bundled utilities provide ranked search when needed. Use campaign-organizer afterward for additional filing or normalization when needed.

## GM-Assistant (gmassistant.app) Exports

session-wrapup natively supports [gmassistant.app](https://gmassistant.app) session exports as play notes. Detection is automatic — if your notes contain a `## Memorable Moments` heading, they're treated as a GM-Assistant export and wrap-up switches to a passthrough path:

- The export's `## Summary` is adopted as the narrative recap verbatim — no rewriting, no condensing, no tone changes. Wiki-links are added to entity references, nothing else is touched.
- The structured `## NPCs`, `## Locations`, and `## Items` sections drive entity creation and updates directly, instead of extracting entities from raw notes. Each entry is compared against your existing vault to decide new vs. update; if an export description conflicts with existing vault content, the entity is flagged CONFLICT for your review.
- The `## Scenes` breakdown serves as the session's scene-by-scene record, so quick bullets aren't regenerated.

Everything else works as normal: new entities are created as DRAFT, templates are respected, and the wrap-up file remains the single source of truth that session-prep reads later.

## Example Prompts

### Full Wrap-Up

- "Session's over — here are my notes"
- "Here's my GM-Assistant export from tonight's session"
- "Process these play notes into a recap"
- "We just finished session 5, wrap it up"
- "Here's what happened today — [paste raw notes]"

### Entity Updates

- "Update all the entity files based on what happened"
- "Inspector Barrow was killed this session — update his file"
- "The investigators gained a new ally — create an entity for Dr. Chen"
- "The cult relocated to the old lighthouse — update the faction file"

### Carry-Forward and Consequences

- "What carries forward to next session?"
- "List the consequences of what happened tonight"
- "What ticking clocks advanced this session?"
- "Which NPCs need to react to what the players did?"

### Recap and Timeline

- "Write me a narrative recap I can read to the players next session"
- "Add tonight's events to the campaign timeline"
- "Summarize each PC's arc progress this session"
- "What clues did the players uncover tonight?"

## What to Expect

Claude produces a structured package:
- A narrative recap (3-5 paragraphs of campaign prose with wiki-links)
- Per-PC carry-forward notes (what each character learned, did, and intends)
- New entity files for any NPCs, locations, or items that appeared during play
- Updates to existing entity files showing what changed
- A carry-forward summary (cliffhangers, consequences, ticking clocks)
- A keeper checklist of things to prepare for next time

New entities are created as DRAFT in your vault. Claude shows you exactly what it created and changed in the conversation so you can review — but the review appendices stay in the conversation, not in your session note file.

## Tips

- Paste your raw session notes as-is. Fragments, shorthand, and abbreviations are fine. Claude extracts the structure.
- Run wrap-up as soon as possible after the session while details are fresh.
- After wrap-up, consider running campaign-qa on the chapter to catch any new issues.
- The session note that wrap-up produces is the handoff to session-prep. It contains everything prep needs to get started.
