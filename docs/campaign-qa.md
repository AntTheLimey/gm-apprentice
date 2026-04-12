# campaign-qa

## What It Does

Your campaign's quality inspector. campaign-qa reads your Obsidian vault and systematically finds problems — contradictions, timeline errors, confusingly similar names, missing clues, broken links, and orphaned entities.

It runs six audit modes, then walks you through each finding one at a time so you can fix or dismiss it. Nothing gets changed without your approval.

## When to Use It

Reach for campaign-qa when you need to:

- Check for contradictions in your campaign canon
- Validate that your timeline makes sense
- Find NPCs or locations with confusingly similar names
- Verify that your clues follow the Three Clue Rule
- Audit your vault's structural health (orphans, broken links, stale stubs)
- Run a full health check after a big session or import

## What You Need

**Obsidian:** Recommended. campaign-qa works with Obsidian MCP tools or plain markdown folders. Without Obsidian, it uses Glob/Grep/Read tools for the same audits — same procedures, different tools. See `shared/filesystem-mode.md` for details.

**Obsidian plugins (optional):** Smart Connections, Templater, Local REST API, and MCP Tools provide faster vault search. See the [README](../README.md) for setup instructions.

## Example Prompts

### Canon Audit

- "Run a canon check on my campaign"
- "Check for contradictions in Chapter 2"
- "Are there any conflicting facts about Inspector Barrow?"
- "Find any places where my NPCs' stories don't line up"

### Timeline Validation

- "Check my timeline for impossible sequences"
- "Validate the dates in my session notes"
- "Are there any events that happen in the wrong order?"
- "Check if any dead NPCs show up alive later"

### Name Similarity

- "Check for confusingly similar NPC names"
- "Are any of my entity names too close together?"
- "Find duplicate or near-duplicate entries in my vault"

### Clue Redundancy

- "Check my clue coverage — am I following the Three Clue Rule?"
- "Are there enough paths to discover the cult's identity?"
- "Find any clues that lead nowhere"
- "Which major conclusions have fewer than three clue paths?"

### Graph Health

- "Check my vault for orphaned entities"
- "Find broken links in my campaign notes"
- "Which NPCs have no relationships defined?"
- "Are there any stale stubs I should fill in?"

### Full Audit

- "Run a full QA pass on my campaign"
- "Audit everything — canon, timeline, names, clues, graph"
- "Campaign health check"

## What to Expect

Claude will first ask about scope — full vault, current chapter, or specific files. It never assumes you want a full audit.

For each finding, Claude shows you the evidence (which files, which fields), explains the problem and its impact at the table, and proposes a fix. You decide: fix it, dismiss it, or skip it for now.

Dismissed findings get marked with a comment in the vault file so they don't get re-flagged in future audits.

Findings are categorized by severity:
- **Critical** — will cause problems at the table
- **Warning** — worth fixing but not urgent
- **Info** — nice to know, fix at your leisure

After the audit, Claude saves a QA report to `_QA/` in your vault.

## Tips

- Run a full audit after importing a lot of content or finishing a major chapter.
- Scope your audits. Checking the whole vault every time is slow — focus on what changed recently.
- Don't dismiss findings without reading them. Context matters — an NPC appearing after death might be a plot hole or might be intentional (ghosts, flashbacks, unreliable narrators).
- DRAFT entities are expected to have gaps. campaign-qa knows this and adjusts its expectations.
- After fixing issues, use campaign-organizer to update any affected links or relationships.
