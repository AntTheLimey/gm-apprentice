# campaign-organizer

## What It Does

Your campaign librarian. campaign-organizer takes your campaign content — scattered notes, session logs, character sheets, worldbuilding docs — and structures it into a clean, interlinked Obsidian vault with knowledge graph metadata.

It classifies entities (NPCs, locations, factions, items), creates structured notes with YAML frontmatter and wiki-links, builds relationship graphs compatible with Juggl, and organizes your narrative into a chapter/session/scene hierarchy.

## When to Use It

Reach for campaign-organizer when you need to:

- Set up a new campaign vault from scratch
- Import existing campaign notes into a structured vault
- Extract entities from a large document into individual linked notes
- Add relationship metadata and wiki-links to existing notes
- Organize sessions into chapters and scenes
- Set up graph visualization for your campaign
- Clean up vault structure after a period of messy note-taking

## What You Need

**Obsidian:** Mandatory. This skill creates and manages Obsidian vault files. It cannot function without one.

**Obsidian plugins:** Smart Connections, Templater, Local REST API, and MCP Tools. See the [README](../README.md) for setup instructions.

## Example Prompts

### New Campaign Setup

- "Set up a new Obsidian vault for my Call of Cthulhu campaign set in 1920s New York"
- "Initialize a campaign vault for a Blades in the Dark game in Doskvol"
- "I'm starting a new D&D 5e campaign — create the vault structure"

### Importing Existing Content

- "I have a Google Doc with all my campaign notes — organize it into the vault"
- "Here are my session notes from the last six sessions — extract the entities and file them"
- "I've got a big worldbuilding document — break it into individual entity notes"

### Enriching and Linking

- "Go through my NPC files and add any missing relationship links"
- "Link all the entity references in my session notes with wiki-links"
- "Check my vault for entities that should be connected but aren't"

### Vault Structure

- "Organize Chapter 3 into scenes based on my session notes"
- "I've added a bunch of notes without structure — clean up the vault"
- "Create stub notes for any entities mentioned in my session notes that don't have their own file yet"

### Graph and Relationships

- "Set up the relationship metadata so Juggl can visualize my faction network"
- "Show me which NPCs have no location assigned"
- "Run a graph hygiene check on my vault"

## What to Expect

When scaffolding a new vault, Claude creates the `_meta/` schema layer (entity types, relationship types, vault config, index), the folder structure for entity types, and template files. It will ask which game system you're using.

When processing existing content, Claude reads your documents, identifies entities, classifies them by type, and creates individual notes with frontmatter, wiki-links, and relationship blocks. It never deletes your original content.

For entities it can't fully populate, Claude creates stub notes marked with `canon_status: STUB` and a `## Needs` section listing what's missing.

Claude will ask before making changes to existing files. New entities start as DRAFT status.

## Tips

- Start with vault scaffolding before importing content. The schema layer needs to exist first.
- Feed it one document at a time for imports rather than everything at once. Better extraction results.
- After a big import, run campaign-qa to catch any issues.
- Don't worry about perfect organization upfront. You can always run the "weave" workflow later to enrich links.
- If you have entities that don't fit the standard types (NPCs, locations, factions, etc.), tell Claude. It can create custom entity types.
