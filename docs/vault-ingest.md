# vault-ingest

## What It Does

Your campaign archaeologist. vault-ingest takes old campaign materials — scattered notes, character sheets, play transcripts, images, spreadsheets, chat exports — and translates them into structured vault content. It classifies what you have, interviews you to recover what actually happened at the table, then synthesizes everything into proper session wrap-ups and entity files.

It's the bridge between "I have a folder of messy campaign notes" and a fully structured vault with timeline, entities, and relationships.

## When to Use It

Reach for vault-ingest when you need to:

- Bootstrap a new vault from old campaign notes
- Import notes from a campaign that predates your vault setup
- Process a batch of character sheets, maps, or handouts into the vault
- Reconstruct past sessions from archived transcripts or play logs
- Add a discovered document mid-campaign (a character sheet you found, old session notes, etc.)
- Bring in content from a different tool (Google Docs, Notion, Discord logs, VTT exports)

## What You Need

**An existing vault:** vault-ingest needs a campaign vault to write into. If you don't have one yet, it will offer to hand off to campaign-organizer to create one first.

**Obsidian:** Recommended but not required. Works on plain markdown folders; bundled utilities provide ranked search when needed.

**Source material:** Your old files. These can come from three places:
- **Staging folder** — drop files into `_inbox/` in your vault
- **External path** — point vault-ingest to a folder or file elsewhere on disk
- **Pasted content** — paste text directly into the conversation

Supported formats include markdown, plain text, Word documents, PDFs, images, spreadsheets (CSV/Excel), and chat or VTT exports.

## Example Prompts

### Bootstrapping a Vault

- "I have six months of campaign notes in a Google Doc — import them into my vault"
- "Here's a folder of everything from our old campaign. Process it all"
- "I've been running this campaign for a year without a vault — help me catch up"
- "We played twelve sessions before I set up Obsidian. Here are my notes"

### Adding Specific Materials

- "I found the character sheets from the first arc — add them to the vault"
- "Here's a map and some NPC sketches from the early sessions"
- "Process this spreadsheet of NPCs into individual vault files"
- "I have screenshots of our Discord session recaps — ingest them"

### Reconstructing Sessions

- "These are my raw play notes from sessions 1 through 5 — reconstruct what happened"
- "I have VTT chat logs from our last three sessions. Turn them into proper wrap-ups"
- "Here's a transcript of session 8 — extract the play events and create the entities"
- "My notes are really patchy for the middle sessions. Help me piece together what happened"

### Mid-Campaign Imports

- "A player just sent me their character backstory — add it to the vault"
- "I've got some prep notes from before we started the current arc"
- "Here are handouts I made for sessions 3 and 4 that never got filed"
- "I found old faction notes in my Google Drive — bring them in"

### Handling Images

- "I have portrait images for most of the NPCs — match them to the right entities"
- "There are maps and location photos mixed in with these files — sort them out"
- "Process this folder of character art and assign them to the right PCs and NPCs"

## What to Expect

vault-ingest works through six phases:

1. **Survey & Classify** — reads all your source material and classifies every document or section (prep notes, play records, character sheets, worldbuilding, etc.). It shows you a manifest and asks if the classifications look right.

2. **Sort into Buckets** — groups items by chapter, session, or time period based on dates, NPC clusters, and explicit references. Ambiguous items go into an "unsorted" bucket for you to clarify.

3. **Extract Play Events** — pulls confirmed events from the classified material. Distinguishes what definitely happened from what was merely planned. Produces a list of confirmed events and gaps.

4. **Keeper Interview** — the skill's core value. Asks you questions one at a time to fill gaps, recover context, and resolve ambiguities. It triggers your memory with scene context rather than asking in the abstract. Each answer opens new threads to follow.

5. **Synthesize & Hand Off** — turns everything into proper vault content: session wrap-ups, entity files, timeline entries, and character story updates. Hands off to campaign-organizer for filing and session-wrapup for wrap-up generation.

6. **Review** — walks you through the synthesized content for approval. Confirmed material gets promoted to AUTHORITATIVE status.

After all buckets are processed, it runs a cross-reference pass to deduplicate entities, validate timeline consistency, and identify relationship chains spanning sessions. It then offers a campaign-qa health check.

The process is thorough but conversational. vault-ingest never invents facts — if it can't confirm something from your sources or your memory, it flags it rather than guessing.

## Tips

- Start with a vault. If you don't have one, vault-ingest will prompt you to set one up first via campaign-organizer.
- Feed it everything you have. Mixed formats, messy folders, incomplete notes — it sorts and classifies before processing.
- Be honest during the keeper interview. "I don't remember" is a valid answer — it flags the gap and moves on rather than making you guess.
- Process in chronological order. Earlier sessions build vault context that helps classify later material more accurately.
- After a big ingestion, run campaign-qa to catch any issues that slipped through.
- Source files are never deleted. Staging folder files move to `_inbox/_processed/` with a date stamp. External files are read-only.
- Reconstructed sessions are marked with a "Reconstruction Note" callout so you always know which content was synthesized after the fact.
