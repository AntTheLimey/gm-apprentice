# ttrpg-expert

## What It Does

Your rules expert, content creator, and campaign consultant rolled into one. ttrpg-expert knows the mechanics of Call of Cthulhu 7e, GURPS 4e, Forged in the Dark, and D&D 5e (2024 Revision) and can generate game-ready content for any of them.

It operates in three modes: answering rules questions and validating mechanics, generating ready-to-use content (NPCs, locations, encounters, handouts), and checking your campaign for plot holes and continuity errors.

## When to Use It

Reach for ttrpg-expert when you need to:

- Look up or validate game mechanics
- Build a character or track a point budget
- Generate an NPC, location, faction, item, or creature
- Design an encounter or write a scenario
- Plan a session structure
- Write an in-game handout (letters, newspaper clippings, diary entries, telegrams)
- Check your campaign for plot holes or continuity errors
- Get a random table result or spark of inspiration

## What You Need

**Obsidian:** Optional. ttrpg-expert is fully functional without Obsidian. If you have a campaign vault set up, it can read your files for better continuity checking.

**Game system context:** Tell Claude which system you're working in. It won't assume.

## Example Prompts

### Rules and Mechanics

- "What are the chase rules in Call of Cthulhu 7e?"
- "How does the Position and Effect system work in Blades in the Dark?"
- "What's the point cost for Combat Reflexes in GURPS?"
- "How do weapon mastery properties work in D&D 5e 2024?"

### Character and NPC Generation

- "Build me a GURPS 4e character — a Victorian-era private detective, 150 points"
- "Make me a CoC 7e NPC — a corrupt harbour master who knows too much"
- "I need a D&D 5e 2024 bandit captain with a twist"
- "Generate a Blades in the Dark faction — a noble house that secretly runs a smuggling operation"

### Locations, Items, and Creatures

- "Create a location for my CoC campaign — an abandoned sanatorium in the Catskills"
- "Design a GURPS magic item — a compass that points toward danger"
- "I need a creature for a D&D 5e encounter in a flooded temple"

### Session Planning and Encounters

- "Help me prep my next CoC session — the investigators are heading to the docks to meet an informant"
- "Design a five-room dungeon for my D&D 5e party (level 5)"
- "I need three encounters for a Blades score at a noble's masquerade ball"

### Scenario Writing

- "Write a one-shot scenario for CoC 7e set in 1920s Arkham — something involving a missing professor"
- "Outline a three-session arc for Blades in the Dark involving a gang war"

### Handouts and Props

- "Write a newspaper article from the Arkham Advertiser about a mysterious disappearance"
- "Create a letter from a desperate NPC begging the investigators for help"
- "Write a telegram in period-appropriate style"

### Continuity Checking

- "Check my campaign for plot holes"
- "Are there any Chekhov's guns I've forgotten about?"
- "Review the timeline of events in Chapter 2 for contradictions"

## What to Expect

When you ask a rules question, Claude will cite the specific source (e.g., "Basic Set — Characters, p.14" for GURPS).

When generating content, Claude will ask clarifying questions first — game system, tone, constraints — then produce complete, template-based output with stat blocks, descriptions, and mechanical notes ready for the table.

For character builds, Claude tracks point budgets and validates choices against the system's rules as it goes.

For continuity checking, Claude looks for 11 categories of problems including timeline contradictions, knowledge violations, orphaned threads, and dead-end clues.

All generated content starts as DRAFT status. It becomes canon when you confirm it.

## Game System Data Sources

Each supported game system has its own subfolder under
`systems/` with core reference files: mechanics, character
generation, session procedures, and a character sheet
template. Most systems also have a rules reference file;
GURPS uses topic-based files for efficient lookup.

- **D&D 5e (2024)** — `systems/dnd-5e-2024/`. Content sourced
  from the SRD 5.2, licensed under CC-BY 4.0 by Wizards of
  the Coast. Built directly into the skill.

- **Forged in the Dark** — `systems/fitd/`. Content sourced
  from the Blades in the Dark SRD, licensed under CC-BY 3.0
  by John Harper / One Seven Design. Built directly into the
  skill.

- **Call of Cthulhu 7e** — `systems/coc-7e/`. Core mechanics
  sourced from the Basic Roleplaying SRD (ORC License,
  Chaosium). CoC-specific content (investigator skills,
  Sanity system) attributed to the official free character
  sheet. Built into the skill.

- **GURPS 4e** — `systems/gurps-4e/`. Uses topic-based
  reference files (traits, skills, equipment, spells, combat,
  magic, powers, social rules) instead of a single rules
  reference. All curated Basic Set content (point costs,
  tables, workflows) is distributed under the SJG Online
  Policy. Check `sources.md` for which books are currently
  integrated. Users with GURPS PDFs can add personal
  reference files to `systems/gurps-4e/personal/` for richer
  lookups.

- **Other systems** — `systems/generic/`. Universal RPG
  guidance for any system not listed above. Covers common
  resolution mechanics, character creation patterns, and
  session running principles.

All sources are credited in
[ATTRIBUTION.md](../ATTRIBUTION.md).

## Tips

- Always specify the game system upfront. Claude supports four systems and needs to know which one you're in.
- For GURPS characters, give a point budget and concept. Claude will track every point spent.
- If you have a campaign vault, mention it. Claude can cross-reference existing entities for consistency.
- Be specific about tone. "A friendly innkeeper" and "a friendly innkeeper hiding a dark secret" produce very different results.
- Ask for handouts in a specific format. Claude can write letters, newspaper articles, diary entries, telegrams, and other in-world documents.
