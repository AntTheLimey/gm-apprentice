# Quickstart: Your First Campaign

This guide walks you through setting up a new TTRPG campaign with gm-apprentice, from installation to prepping your first session. It assumes you know your way around a tabletop RPG but are new to using Claude as a GM tool.

## How Claude Skills Work

Claude Code uses "skills" — specialized instructions that activate automatically based on what you ask Claude to do. You don't need to select a skill manually. When you say "build me an NPC," Claude recognizes this as a ttrpg-expert task and uses that skill's knowledge to respond.

gm-apprentice installs four skills:

| Skill | What it does |
|-------|-------------|
| **ttrpg-expert** | Rules, content generation, continuity |
| **campaign-organizer** | Vault structure and knowledge graphs |
| **campaign-qa** | Campaign quality auditing |
| **session-lifecycle** | Session prep, play, and wrap-up |

You talk to Claude normally. The skills handle the rest.

## Step 1: Install gm-apprentice

In Claude Code, run:

```
/plugin marketplace add AntTheLimey/gm-apprentice
/plugin install gm-apprentice
```

Then reload:

```
/reload-plugins
```

## Step 2: Pick Your Game System

gm-apprentice supports four systems:

- **Call of Cthulhu 7th Edition** (CoC 7e) — percentile-based investigation and cosmic horror
- **GURPS 4th Edition** — point-buy, any-genre, 3d6 roll-under. Includes curated Basic Set content built in with topic-based reference files (traits, skills, equipment, spells, combat, powers, magic, social rules). Check `sources.md` for book coverage.
- **Forged in the Dark** (Blades in the Dark) — d6 dice pool, position and effect
- **D&D 5th Edition, 2024 Revision** — d20 core, classes and spell slots

Tell Claude which system you're using when you start. It won't assume.

## Step 3: Set Up Obsidian (Recommended)

Obsidian gives you the best experience — clickable wiki-links, graph visualization, semantic search — but it's not required. The campaign-organizer skill can work directly on a folder of markdown files, producing Obsidian-compatible content you can open in Obsidian later.

**To set up Obsidian now:** Follow the [Obsidian Setup](../README.md#obsidian-setup) instructions in the README, then come back here.

**To skip Obsidian for now:** Continue to Step 4. Claude will ask you for a folder path and work with the filesystem directly. You can switch to Obsidian anytime by opening that folder as a vault.

## Step 4: Scaffold Your Campaign

Ask Claude to create your campaign structure:

> "Set up a new campaign for Call of Cthulhu. It's set in 1920s New York, called 'Shadows Over Manhattan'."

If you have Obsidian set up, Claude uses it automatically. If not, it will ask where to create the campaign folder:

> "Where should I work? Give me the path to your campaign folder, or tell me where to create a new one."

Either way, Claude creates the folder structure, schema files, and templates. You'll see directories for Characters, Locations, Factions, Items, and a narrative hierarchy for Chapters, Sessions, and Scenes.

If you have existing campaign notes (Google Docs, text files, PDFs), feed them in:

> "Here are my campaign notes from the first three sessions — organize them into the vault."

Claude will extract entities, classify them, create individual notes, and link them together.

## Step 5: Build Your World

Now use ttrpg-expert to generate content:

> "Make me the campaign's main antagonist — a wealthy industrialist who's funding occult research. CoC 7e."

> "Create three locations in Manhattan that the investigators might visit: a speakeasy, a university library, and a waterfront warehouse."

> "I need a faction — a secret society operating out of a brownstone in the Upper East Side."

Each piece of generated content starts as DRAFT. Review it, and it becomes part of your canon.

After generating several entities, organize them:

> "File these new entities into the vault and link them to existing notes."

## Step 6: Prep Your First Session

With your world taking shape, prep for play:

> "Help me prep session 1. The investigators are hired by a missing professor's daughter to find her father. Last known location: his office at Columbia University."

Claude will review your PC roster, identify the entities involved, suggest a session structure, and flag any gaps in your prep (NPCs you need, locations you haven't fleshed out, clues you should plant).

If it identifies gaps, hand off to ttrpg-expert:

> "Create the professor's office as a location — include three clues the investigators might find there."

## Step 7: After Your First Session

When the session ends, process what happened:

> "Session's over. Here are my notes:
> - Players explored the office, found the diary and the strange symbol but missed the locked drawer
> - Met Mrs. Chen at the front desk, she was helpful
> - Went to the speakeasy to meet the informant
> - Combat with two thugs in the alley behind the bar
> - Ended with the informant dead and a cryptic note"

Claude will produce a narrative recap, create entity files for any new NPCs (Mrs. Chen, the informant, the thugs), update existing entities, and tell you what carries forward.

Then run a quick health check:

> "Run a QA check on Chapter 1"

Claude will look for contradictions, timeline issues, and missing connections introduced by the session.

## What's Next

You now have a working campaign vault with structured content, linked entities, and a session under your belt. From here:

- **Before each session:** Use session-lifecycle's prep mode to review threads and prepare.
- **After each session:** Use wrap-up to process notes, then reconcile to handle what was skipped.
- **Periodically:** Run campaign-qa to keep your vault clean.
- **Anytime:** Use ttrpg-expert to generate new content, look up rules, or check continuity.

For detailed guidance on each skill, see the individual skill guides:

- [ttrpg-expert](ttrpg-expert.md)
- [campaign-organizer](campaign-organizer.md)
- [campaign-qa](campaign-qa.md)
- [session-lifecycle](session-lifecycle.md)
