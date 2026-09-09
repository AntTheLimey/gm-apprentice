# Classification Taxonomy

Reference for Phase 1 (Survey & Classify). Every document or
distinct section within a document gets one classification.

## Classifications

| Type | Description | Canon Value | Heuristic |
|---|---|---|---|
| Play transcript | Direct record of table play | AUTHORITATIVE | Contains dice rolls, PC actions with outcomes, specific NPC dialogue delivered at table |
| Play fragment | Actual play buried in larger document | AUTHORITATIVE (those lines only) | Same indicators as transcript but surrounded by non-play content |
| Scenario prep | NPC profiles, locations, handouts, skill checks | DRAFT — potential, not reality | Describes what *could* happen; uses conditional language, lists alternatives |
| Research/brainstorm | Worldbuilding Q&A, "what if" explorations | NOT CANON unless confirmed | Questions and answers about possibilities; no play indicators |
| Keeper recollection | GM's memory of what happened | AUTHORITATIVE | First person ("I remember", "the group did"), past tense, specific details |
| Character sheet | PC or NPC stats, inventory, backstory | DRAFT until placed in timeline | Structured data: attributes, skills, equipment lists |
| Image/map | Visual reference material — portraits, scene art, location shots, maps | Attachment — no canon status | Binary file (jpg, png, webp, gif, svg, heic, raw, tiff, bmp); classify then process per `image-handling.md` |
| Spreadsheet/data | Tracking sheets, encounter tables | DRAFT — classify by content | Tabular data, formulas, tracking columns |
| Session wrap-up | Existing Wrap-Up file from a prior session | AUTHORITATIVE | Contains Narrative Recap, PC Carry-Forward, World State sections; `type: session_wrap` frontmatter |
| Session export | A table assistant's summary of a played session (gmassistant.app and the like) — the source a Wrap-Up is adopted from | AUTHORITATIVE once the GM confirms it; hand to session-wrapup | No frontmatter; a `Date:` line near the top; `## Summary` plus at least two of `## Memorable Moments` / `## Scenes` / `## NPCs` / `## Locations` / `## Items` |
| Web page (saved) | A page saved from the browser — a campaign-site NPC record, a wiki article | Classify by content, as the text it carries | `.html` / `.htm`; scored from its text with tags, scripts and styles stripped. Its `<name>_files/` companion folder (scripts, stylesheets) is not source material — one row, never read |

## Key Heuristics

**Play indicators** (any of these = play record):
- Dice roll results ("rolled a 47", "failed her Spot Hidden")
- Specific PC actions with outcomes ("Georgiana picked the lock")
- NPC dialogue marked as delivered ("he said to the group")
- Skill check results with numbers
- Combat rounds with specific actions
- Sanity/health changes with values

**Prep indicators** (without play indicators = prep):
- "If the investigators..." (conditional)
- Multiple alternative outcomes listed
- NPC stat blocks without play context — three or more characteristics
  rows (a line of primary attributes, one per stat block) are a cast
  list (a published scenario's Dramatis Personae), not one character's
  sheet, however many sections a single sheet spreads its stats over
- "The GM should..." or "At this point..."
- Handout text not confirmed as found by players

A single play indicator inside a document that otherwise reads as prep
(one "rolled a 96" in a scenario's chase rules) is noise, not a play
fragment. Two or more make it a mixed document.

**Research indicators:**
- Q&A format about historical facts or worldbuilding
- "What would happen if..." speculative questions
- Multiple options being evaluated
- No connection to specific play session

## Mixed Documents

A single document often contains multiple types. Classify
each section independently. Common patterns:

- **Prep doc with embedded play fragments:** The prep sections
  are DRAFT; the play fragments are AUTHORITATIVE. Extract
  the play fragments separately.

- **ChatGPT research with play questions:** The research is
  NOT CANON. But questions like "Georgiana named three dead
  students and failed her Charm roll — how does Lang react?"
  contain a play event in the question. The event described
  is canon; the generated response is flavour that may or may
  not have been used.

- **Session notes mixed with planning:** Look for tense
  shifts — past tense descriptions of events are likely play;
  future tense or conditional descriptions are likely prep.

## Name Inconsistencies

Source material frequently uses inconsistent names for the
same character. During classification, flag all name variants
in the manifest for resolution during extraction (Phase 3):

- Full name vs surname only
- Title variations (Dr. / Professor / Mr.)
- Misspellings or AI-generated variants
- In-game aliases vs real names

Cross-reference against existing entity files. The vault's
canonical name (filename) is authoritative. Log corrections.
