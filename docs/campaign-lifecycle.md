# Campaign Lifecycle

How the four gm-apprentice skills work together across the
life of a TTRPG campaign.

## The Four Skills

| Skill | Role |
|-------|------|
| **ttrpg-expert** | Content generation, rules reference, session planning, GM frameworks |
| **campaign-organizer** | Vault structure, entity filing, graph relationships, Obsidian integration |
| **session-lifecycle** | Prep → Play → Wrap-up cycle, entity creation from play notes |
| **campaign-qa** | Validation, contradiction detection, integrity checking |

## Campaign Flow

### Starting a Campaign

1. **Scaffold the vault** — `/gm-apprentice:campaign-organizer`
   Create the campaign folder structure, world overview,
   initial factions, and key locations.

2. **Session 0 / Table prep** — `/gm-apprentice:ttrpg-expert`
   Help players create characters, teach the system, establish
   safety tools, build party cohesion. File new PCs with
   campaign-organizer.

### Each Session Cycle

3. **Session prep** — `/gm-apprentice:ttrpg-expert`
   Use session-planner.md for the full 7-step workflow:
   PC Roster Review → Arc Check → Touchpoints → Scenes →
   Connection Audit → Spotlight Forecast → Canon Grounding.
   Generate NPCs, encounters, handouts as needed.

4. **Pre-session validation** — `/gm-apprentice:campaign-qa`
   Run a continuity check to catch contradictions before
   they reach the table.

5. **Active play** — Both skills available:
   - `/gm-apprentice:ttrpg-expert` for quick rules lookups,
     stat blocks, improv NPCs, fail-forward guidance
   - `/gm-apprentice:session-lifecycle` (Play mode) for
     table dynamics and note-taking

6. **Post-session wrap-up** — `/gm-apprentice:session-lifecycle`
   Process play notes, capture what actually happened,
   identify new entities (NPCs, locations, items) created
   during play.

7. **File new entities** — `/gm-apprentice:campaign-organizer`
   Organise newly created NPCs, locations, items, and
   factions into the vault with proper linking.

8. **Post-session validation** — `/gm-apprentice:campaign-qa`
   Check for contradictions introduced by improvisation.
   Verify thread states and flag stale plot hooks.

### Between Sessions

9. **Advance the world** — `/gm-apprentice:ttrpg-expert`
   Update faction states, advance clocks, surface
   consequences from player actions. Prep the next session
   starting from step 3.

## Common Handoff Patterns

**"I just created an NPC"**
→ ttrpg-expert generated it → campaign-organizer files it

**"Session prep is done"**
→ ttrpg-expert planned it → campaign-qa validates →
  session-lifecycle enters Prep mode

**"Session just ended"**
→ session-lifecycle wraps up → campaign-organizer files
  new entities → campaign-qa checks for contradictions

**"I need to check continuity"**
→ For a full audit: campaign-qa
→ For a quick thread/canon check: ttrpg-expert
  (continuity-engine.md)

**"I need content for my campaign"**
→ ttrpg-expert generates → campaign-organizer files

**"I want to review my whole campaign"**
→ campaign-qa runs a full audit across all categories
