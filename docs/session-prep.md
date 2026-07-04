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

**Obsidian:** Optional. session-prep works on plain markdown folders; bundled utilities provide ranked search and graph queries. See `shared/filesystem-mode.md` for details.

## Example Prompts

### Full Session Prep

- "Help me prep for next session — we play on Saturday"
- "What do I need to prepare for session 7?"
- "Prep me for the next session of our CoC campaign"
- "Walk me through what I need to have ready for next week"

### Reviewing Where Things Stand

- "Summarize where we left off last session"
- "What's the current status of each PC?"
- "Which threads are dangling that I should pick up?"
- "What NPCs are the players likely to encounter next?"
- "What ticking clocks are about to go off?"

### Reconciling Prep vs Reality

- "Reconcile my session 6 prep with what actually happened"
- "What did we skip from my prep?"
- "Salvage the unused encounters from last session's prep"
- "The players went completely off-script — what planned content can I reuse?"

### Thread and Clue Management

- "Which clues did the players miss that they still need to find?"
- "Are there any Chekhov's guns I've planted that need to fire soon?"
- "What plot threads have been dormant for more than two sessions?"
- "Which NPCs have unfinished business with the PCs?"

### Spotlight and Arc Planning

- "Which PC hasn't had the spotlight recently?"
- "What's the current arc stage for each PC?"
- "One PC is stuck in the same arc stage — help me plan a catalyst"
- "How do I balance spotlight between five PCs next session?"

## What to Expect

Claude reads the last session's wrap-up note first — this is the primary context source. It then reads the PC roster, scans for threads, checks NPC statuses, and builds a prep package. It identifies gaps in your prep and suggests what to create (handing off to ttrpg-expert for content generation).

If the last session doesn't have a wrap-up, Claude will let you know what you'd miss by skipping it (entity updates, carry-forward, etc.) and offer to run a full wrap-up first.

## Tips

- Always run session-wrapup before session-prep. The wrap-up creates the handoff material that prep relies on.
- Use reconcile to salvage good prep that didn't get used rather than rewriting from scratch.
- Always check the carry-forward section before prepping. It's your bridge between sessions.
