# session-prep

## What It Does

Your between-sessions preparation assistant. session-prep helps you get ready for the next session by building on what session-wrapup established as canon. It reconciles what happened last time with what comes next, reviews PC arcs, scans for threads, and flags gaps in your prep.

## When to Use It

Reach for session-prep when you need to:

- Prepare for an upcoming session
- Reconcile what was planned vs what actually happened
- Figure out what was skipped and what carries forward
- Salvage unused prep for future sessions
- Review PC arcs and identify spotlight gaps

## What You Need

**Obsidian:** Recommended. session-prep works with Obsidian MCP tools or plain markdown folders. See `shared/filesystem-mode.md` for details.

## Example Prompts

- "Help me prep for next session — we play on Saturday"
- "What do I need to prepare for session 7?"
- "Summarize where we left off last session"
- "Which threads are dangling that I should pick up?"
- "What's the current status of each PC?"
- "Are there any NPCs I need to have ready for next session?"
- "What did we skip from my prep?"
- "Reconcile my session 6 prep with what actually happened"
- "Which clues did the players miss that they still need to find?"
- "Salvage the unused encounters from last session's prep"

## What to Expect

Claude reads the last session's wrap-up note first — this is the primary context source. It then reads the PC roster, scans for threads, checks NPC statuses, and builds a prep package. It identifies gaps in your prep and suggests what to create (handing off to ttrpg-expert for content generation).

If the last session doesn't have a wrap-up, Claude will let you know what you'd miss by skipping it (entity updates, carry-forward, etc.) and offer to run a full wrap-up first.

## Tips

- Always run session-wrapup before session-prep. The wrap-up creates the handoff material that prep relies on.
- Use reconcile to salvage good prep that didn't get used rather than rewriting from scratch.
- Always check the carry-forward section before prepping. It's your bridge between sessions.
