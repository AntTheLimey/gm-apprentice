# Campaign Lifecycle

How the nine gm-apprentice skills work together across the
life of a TTRPG campaign.

## The Skills

| Skill | Role |
|-------|------|
| **the-midwife** | Adventure conception — guided creative conversation from vague idea to adventure brief and vault scaffold |
| **ttrpg-expert** | Content generation, rules reference, session planning, GM frameworks |
| **campaign-organizer** | Vault structure, entity filing, graph relationships, Obsidian integration |
| **vault-ingest** | Bringing old campaign materials (notes, sheets, transcripts) into the vault |
| **session-prep** | Between-session preparation, reconciliation, thread scanning |
| **session-play** | At-the-table lookups, generation, note capture |
| **session-wrapup** | Post-session recaps, entity creation, carry-forward |
| **campaign-qa** | Validation, contradiction detection, integrity checking |
| **publish-site** | Publishing the vault as a shareable static site for players |

## Campaign Flow

### Starting a Campaign

1. **Conceive the adventure** — `/gm-apprentice:the-midwife`
   Develop the campaign concept, one-shot, or arc through
   guided creative conversation. Produces an adventure brief
   and scaffolds the vault for Session 0. If you're building
   on an existing campaign, it mines your canon for
   unresolved threads and creative opportunities.

2. **Ingest old materials** — `/gm-apprentice:vault-ingest`
   (If you have them.) Bring existing notes, character
   sheets, and transcripts into the vault before play
   continues, so downstream skills see your real history.

3. **Scaffold the vault** — `/gm-apprentice:campaign-organizer`
   Create or extend the campaign folder structure, world
   overview, initial factions, and key locations.

4. **Session 0 / Table prep** — `/gm-apprentice:ttrpg-expert`
   Help players create characters, teach the system, establish
   safety tools, build party cohesion. File new PCs with
   campaign-organizer.

### Each Session Cycle

5. **Session prep** — `/gm-apprentice:session-prep`
   Full prep workflow: Reconcile → Gather → Plan → Verify →
   Handoff. References `arc-spotlight-reference.md` for arc
   and spotlight frameworks. Generate content via ttrpg-expert.

6. **Pre-session validation** — `/gm-apprentice:campaign-qa`
   Run a continuity check to catch contradictions before
   they reach the table.

7. **Active play** — Both skills available:
   - `/gm-apprentice:ttrpg-expert` for quick rules lookups,
     stat blocks, improv NPCs, fail-forward guidance
   - `/gm-apprentice:session-play` for quick lookups,
     generation, and note-taking

8. **Post-session wrap-up** — `/gm-apprentice:session-wrapup`
   Process play notes, capture what actually happened,
   identify new entities (NPCs, locations, items) created
   during play. Accepts raw shorthand notes or a
   gmassistant.app session export (detected automatically).

9. **File new entities** — `/gm-apprentice:campaign-organizer`
   Organise newly created NPCs, locations, items, and
   factions into the vault with proper linking.

10. **Post-session validation** — `/gm-apprentice:campaign-qa`
    Check for contradictions introduced by improvisation.
    Verify thread states and flag stale plot hooks.

11. **Publish for players** — `/gm-apprentice:publish-site`
    (Optional.) Rebuild the campaign site so players see the
    latest recaps, NPCs, and locations — GM-only content
    stays hidden.

### Between Sessions

12. **Advance the world** — `/gm-apprentice:ttrpg-expert`
    Update faction states, advance clocks, surface
    consequences from player actions. Prep the next session
    starting from step 5.

### Starting the Next Chapter

When an arc wraps and you need what comes next, return to
`/gm-apprentice:the-midwife` — it reads the vault you've
built and develops the next adventure from your established
canon.

## Common Handoff Patterns

**"I want to start a new campaign"**
→ the-midwife develops the concept and scaffolds the vault
  → session-prep plans Session 0 → ttrpg-expert helps at
  the table

**"I have old campaign notes"**
→ vault-ingest sorts and synthesizes → campaign-organizer
  files entities → campaign-qa validates the result

**"I just created an NPC"**
→ ttrpg-expert generated it → campaign-organizer files it

**"Session prep is done"**
→ ttrpg-expert planned it → campaign-qa validates →
  session-prep handles preparation

**"Session just ended"**
→ session-wrapup wraps up → campaign-organizer files
  new entities → campaign-qa checks for contradictions

**"I need to check continuity"**
→ For a full audit: campaign-qa
→ For a quick thread/canon check: ttrpg-expert
  (continuity-engine.md)

**"I need content for my campaign"**
→ ttrpg-expert generates → campaign-organizer files

**"I want to review my whole campaign"**
→ campaign-qa runs a full audit across all categories

**"I want to share the campaign with my players"**
→ publish-site builds and deploys the static site

**"I don't know what to run next"**
→ the-midwife mines the vault for dormant threads and
  develops the next arc
