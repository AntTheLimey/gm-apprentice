# session-lifecycle

## What It Does

Your between-sessions workhorse. session-lifecycle manages the full cycle of TTRPG play: preparing for upcoming sessions, supporting you during play, processing what happened into structured canon after the session, and reconciling planned content with what actually occurred.

It turns "we just finished playing" into organized campaign records and "we play next week" into solid prep.

## When to Use It

Reach for session-lifecycle when you need to:

- Prepare for an upcoming session
- Get quick reference help during play
- Process session notes into a structured recap
- Update entity files with what happened in play
- Figure out what was skipped and what carries forward
- Salvage unused prep for future sessions

## What You Need

**Obsidian:** Recommended. session-lifecycle works with Obsidian MCP tools or plain markdown folders. Entity creation hands off to campaign-organizer, which supports both modes. See `shared/filesystem-mode.md` for details.

**Obsidian plugins (optional):** Smart Connections, Templater, Local REST API, and MCP Tools provide faster vault operations. See the [README](../README.md) for setup instructions.

## Example Prompts

### Session Prep

- "Help me prep for next session — we play on Saturday"
- "What do I need to prepare for session 7?"
- "Summarize where we left off last session"
- "Which threads are dangling that I should pick up?"
- "What's the current status of each PC?"
- "Are there any NPCs I need to have ready for next session?"

### During Play

- "Quick — what's Inspector Barrow's current status?"
- "What did the investigators learn about the warehouse in session 4?"
- "Note: players decided to go to the docks instead of the library"
- "Flag this NPC — they just made up a shopkeeper named Mrs. Chen"

### Session Wrap-up

- "Session's over — here are my notes"
- "Process these play notes into a recap"
- "We just finished session 5, wrap it up"
- "Here's what happened today — [paste raw notes]"
- "Update all the entity files based on what happened"

### Reconciliation

- "What did we skip from my prep?"
- "Reconcile my session 6 prep with what actually happened"
- "Which clues did the players miss that they still need to find?"
- "Salvage the unused encounters from last session's prep"
- "What consequences should carry forward from tonight?"

## What to Expect

### During Prep

Claude reads your PC roster first, then reviews the last session's notes, scans for dangling threads, checks NPC statuses, and builds a prep package. It identifies gaps in your prep and suggests what to create (handing off to ttrpg-expert for content generation).

### During Play

Claude switches to speed mode — brief answers, essential facts only, no analysis. It acknowledges your notes for later processing. This isn't the time for long responses.

### During Wrap-up

Claude produces a structured package:
- A narrative recap (3-5 paragraphs of campaign prose with wiki-links)
- Per-PC carry-forward notes (what each character learned, did, and intends)
- New entity files for any NPCs, locations, or items that appeared during play
- Updates to existing entity files showing what changed
- A carry-forward summary (cliffhangers, consequences, ticking clocks)
- A keeper checklist of things to prepare for next time

All new entities are created as DRAFT in your vault. Claude shows you exactly what it created and changed as appendices.

### During Reconciliation

Claude compares your prep with the wrap-up notes, identifies what was used, skipped, or modified, and walks you through decisions one at a time — "This encounter was skipped. The clue in it is critical. How do you want the players to find it instead?"

## Tips

- Paste your raw session notes as-is. Fragments, shorthand, and abbreviations are fine. Claude extracts the structure.
- Run wrap-up as soon as possible after the session while details are fresh.
- Always check the carry-forward section before prepping the next session. It's your bridge between sessions.
- Use reconcile to salvage good prep that didn't get used rather than rewriting from scratch.
- During play, keep prompts short. Claude matches your energy in play mode — brief in, brief out.
- After wrap-up, consider running campaign-qa on the chapter to catch any new issues.
