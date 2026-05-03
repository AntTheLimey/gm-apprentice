# Check Procedures

**Tool note:** These procedures use generic operation names —
"enumerate files," "search for [pattern]," "read [file]." See
`shared/filesystem-mode.md` for which specific tool to use in
your environment (Obsidian MCP tools or filesystem Glob/Grep/Read).

Detailed step-by-step procedures for each QA mode. The SKILL.md
describes what each mode checks; this file describes how to
perform each check systematically.

## Table of Contents

1. [Canon Audit](#canon-audit)
2. [Timeline Validation](#timeline-validation)
3. [Name Similarity](#name-similarity)
4. [Clue Redundancy](#clue-redundancy)
5. [Graph Health](#graph-health)

---

## Canon Audit

The canon audit detects factual contradictions between vault
files. A contradiction is two or more files asserting
incompatible facts about the same entity or event.

### Step 1: Build the Entity Index

Read `_meta/index.md` (or scan the vault if no index exists)
to get a complete list of entities. For each entity, note:
- Canonical name and aliases
- Type (NPC, location, item, etc.)
- Canon status (DRAFT, AUTHORITATIVE, SUPERSEDED)
- Primary file path

Enumerate all entity files in scope. Search for entity names
across all files in scope.

### Step 2: Cross-Reference Entity Facts

For each entity in scope, search for every mention across
the vault. Compare facts stated in:
- The entity's own profile file
- Session notes (prep plans and play notes)
- The campaign overview
- Other entities' files (relationship descriptions)
- The timeline

**What constitutes a contradiction:**
- Different values for the same field (age, nationality,
  occupation stated differently in two places)
- Status conflicts (entity described as alive in one file,
  dead in another, without a timeline explanation)
- Relationship conflicts (A says they employ B, but B's file
  says they work for C)
- Location conflicts (entity placed in two locations at the
  same time)

**What does NOT constitute a contradiction:**
- Deliberate in-fiction unreliability (clearly marked as
  such with GM notes or callouts)
- DRAFT vs AUTHORITATIVE disagreement (AUTHORITATIVE wins;
  flag the DRAFT for update rather than calling it a
  contradiction)
- SUPERSEDED entries (these are expected to conflict with
  their replacements)

### Step 3: Check PC Roster Consistency

Read `player_characters.md`. For each entry, verify:
- The player/character mapping matches references in session
  notes
- Character status (active, retired, dead, NPC) is consistent
  across all files
- No session plan references a retired PC as active or vice
  versa
- Character names are spelled consistently (check known
  problem names from CLAUDE.md if available)

### Step 4: Canon Fabrication Scan

Search session plans and generated content for factual claims
about NPCs, locations, and resources. For each claim, verify
it traces to a source file. Flag any claim that:
- Gives an NPC a property not in their profile (family home,
  skill, relationship, title)
- References a contact or resource the PCs haven't
  established access to yet (check session play notes for
  when the PCs actually met the NPC or discovered the
  resource)
- Places an entity in a location not established in canon

This check specifically targets AI hallucination in generated
session plans — the most common source of canon fabrication.

### Step 5: Compile Findings

For each contradiction found:
1. Note both files and the specific conflicting facts
2. Assess severity (Critical if it would be visible at the
   table; Warning if it's internal inconsistency; Info if
   it's a DRAFT that needs updating)
3. Propose a fix (which value is likely correct, based on
   canon status and recency)

---

## Timeline Validation

The timeline check verifies chronological consistency across
all vault files.

### Step 1: Build the Event Timeline

Read the master timeline (`_Campaign/Timeline.md` or
equivalent). Then scan session notes for dated events.
Build a unified chronological list:

```text
[In-game date] — [Event] — [Source file] — [Entities involved]
```

Search for date patterns and event keywords across all vault
files.

### Step 2: Entity Lifecycle Check

For each entity with a status change (alive → dead,
active → retired, intact → destroyed):
1. Find the session/date where the status changed
2. Search for any reference to the entity after that date
   that assumes the old status
3. Flag references to dead entities as alive, destroyed
   locations as intact, etc.

### Step 3: Travel Time Validation

For the campaign's historical setting, verify that entity
movements between locations respect realistic travel times.

**Reference travel times (1814 Regency era):**
- Coach travel: ~50 miles/day on good roads
- Horse (fast): ~80 miles/day, exhausting
- Ship (channel crossing): weather-dependent, 1-3 days
- Walking: ~20 miles/day
- London to Lyon: ~2-3 weeks by coach
- Lyon to Vienna: ~2 weeks by coach
- Vienna to Calcutta: ~4-6 months by ship

Flag any entity that appears in two locations closer together
in time than travel allows. Note: this check is calibrated
per campaign setting. For modern or fantasy settings with
fast travel, adjust thresholds accordingly.

### Step 4: Date Reference Consistency

Search for in-game date references across session notes.
Verify:
- The same event isn't dated differently in different files
- Session notes' in-game dates progress forward (no
  accidental time reversals between sessions)
- Ticking clocks and deadlines are tracked (if a deadline
  was set for "August 15" and the in-game date is now
  August 10, is the clock reflected in current prep?)

### Step 5: Compile Findings

For each violation:
1. Note the specific dates, files, and entities involved
2. Assess severity (Critical for visible-at-table paradoxes;
   Warning for internal date conflicts; Info for minor
   inconsistencies in unused content)
3. Propose a fix (which date is likely correct, or flag for
   GM decision)

---

## Name Similarity

The name similarity check identifies entity names that are
duplicates, near-duplicates, or confusingly similar.

### Step 1: Collect All Names

Build a complete list of entity names and aliases from the
vault. For each, record:
- Canonical name
- All aliases (from frontmatter `aliases` field)
- File path
- Entity type

Enumerate all entity files and read frontmatter from each to
build this list.

### Step 2: Exact Duplicate Check

Look for entities that share a canonical name or where one
entity's alias matches another's canonical name. These are
likely the same entity with two files.

### Step 3: Edit Distance Check

Compare all name pairs. Flag pairs where:
- Levenshtein distance ≤ 2 (e.g., "Herzfeld" vs "Herzberg")
- Names differ only in common variations (Dr./Doctor,
  von/Van, -burg/-berg, -feld/-stein)
- First or last name matches but the other differs slightly

For large entity sets, limit comparisons to entities of
the same type to avoid false positives (an NPC named
"Vienna" vs the location "Vienna" is expected overlap, not
a duplicate).

### Step 4: Phonetic Similarity Check

At the table, players hear names spoken aloud. Flag names
that sound similar even if spelled differently:
- Same consonant skeleton (remove vowels and compare)
- Rhyming names
- Names sharing first syllable and similar length
- Names differing only in a sound that's easy to mishear
  (b/d, m/n, s/z, f/v)

This check is especially important for NPCs who might appear
in the same scene. Two NPCs named "Adler" and "Adlar" in
different factions is a problem; "Adler" in Vienna and
"Adley" in Calcutta is less so.

### Step 5: Compile Findings

For each similarity found:
1. Note both entities, their types, and their files
2. Assess severity (Critical if they could appear in the
   same scene; Warning if same chapter; Info if different
   chapters/locations)
3. Propose a fix:
   - For true duplicates: merge into one file
   - For confusingly similar: suggest a rename for the less
     established entity
   - For acceptable similarities: dismiss with note

---

## Clue Redundancy

The clue redundancy check verifies that the campaign's
information architecture follows the Three Clue Rule
(ref: Justin Alexander, "Three Clue Rule") and that clue
paths are robust.

### Step 1: Identify Conclusions

A "conclusion" is something the PCs need to figure out to
advance the story. Read session plans, scenario outlines,
and the campaign overview to build a list of conclusions:
- Major revelations (cult identity, ritual location, etc.)
- Required next steps (where to go next, who to talk to)
- Mystery solutions
- Threat identifications

### Step 2: Map Clues to Conclusions

For each conclusion, search the vault for clues that point
toward it. A clue is any piece of information, observation,
or evidence that, when interpreted, leads toward the
conclusion. Clues may be:
- Explicit (a letter naming the cult leader)
- Inferential (two NPCs seen together who shouldn't be)
- Environmental (strange sounds from the basement)

Track where each clue is found (which scene, NPC, location,
or handout) and whether it's been discovered in play.

### Step 3: Three Clue Rule Verification

For each conclusion:
1. Count independent clues pointing to it
2. Count distinct nodes/scenes where clues are available
3. Flag if fewer than 3 clues exist
4. Flag if all clues are in the same scene (single point of
   failure)
5. Flag if all clues require the same skill check type
   (what if no PC has Library Use?)

### Step 4: Dead-End and Orphan Detection

- **Dead-end clues:** Clues that point to a conclusion,
  NPC, or location that doesn't exist in the vault or has
  been cut from the scenario. A player who finds this clue
  has nowhere to go with it.
- **Orphaned conclusions:** Conclusions that no clue path
  leads to. The PCs cannot reach this revelation through
  investigation.
- **Bottleneck clues:** A single clue that is the only
  connection between two parts of the scenario graph. If
  the PCs miss it, the entire path is severed.

### Step 5: Compile Findings

For each issue:
1. Note the conclusion, its clues, and their locations
2. Assess severity (Critical if a required conclusion has
   <3 clues; Warning if clues are concentrated in one
   scene; Info if the issue is in future/unplayed content)
3. Propose a fix:
   - For insufficient clues: suggest additional clue
     locations and types (hand off to ttrpg-expert for
     content generation)
   - For dead-ends: identify the broken link
   - For bottlenecks: suggest redundant paths

---

## Graph Health

The graph health check examines the structural integrity of
the entity relationship graph in the vault.

### Step 1: Enumerate Entities and Links

Read all entity files in scope. For each, extract:
- Frontmatter relationships (wiki-links in frontmatter
  fields)
- Body wiki-links (inline references)
- Entity type and required relationships per schema

### Step 2: Structural Checks

**Orphaned entities:** Entities with zero inbound or outbound
relationships. These are disconnected from the graph and
probably forgotten.

**Broken links:** Wiki-links that point to files that don't
exist. Search for `[[...]]` patterns across all files, then
verify each linked target file exists.

**Bidirectional consistency:** If entity A's frontmatter says
`ally_of: "[[B]]"`, does entity B's frontmatter acknowledge
entity A? Flag one-way relationships that should be mutual.

**Hub overload:** Entities with an unusually high number of
relationships (more than 2 standard deviations above the mean
for their type). These are often over-linked — some
connections are implied by traversal rather than direct.

### Step 3: Schema Compliance

Read `_meta/entity-types.md` for the type hierarchy and
required fields. For each entity:
- Verify all required frontmatter fields are present
- Verify field values match expected types
- Verify the entity's `type` field matches a known type
- Flag entities still marked as STUB that have been
  referenced in played sessions (they need fleshing out)

### Step 4: Character Story Validation

**Story file existence:** For every PC entity where `status`
is not `dead` or `retired`, verify that a companion story file
exists at `Characters/PCs/{Name}_Story.md`.

- Severity: **Warning**
- Proposed fix: "Create story file from template for
  [[{Name}]]" — use `shared/templates/character-story.md`

**Story file recency:** For every story file that exists,
read its `asOfSession` frontmatter field. Compare to the
latest wrap-up's session number (from the session index or
most recent `type: session-wrap-up` file).

- If the story file is more than 1 session behind, flag it
- Severity: **Warning**
- Proposed fix: "Story file for [[{Name}]] is current to
  session {X} but latest wrap-up is session {Y} — run
  vault-ingest on the intervening wrap-ups to catch up"

### Step 5: Relationship Quality

**Generic types:** Flag uses of `associated_with` or similar
vague relationship types where a more specific type exists
in `_meta/relationship-types.md`.

**Redundant edges:** Two entities connected by multiple
relationship types that mean essentially the same thing.

**Traversal edges:** Direct relationships that add no
information beyond what's discoverable by a short graph
traversal. Two NPCs who share a location don't need a direct
`associated_with` edge — the shared location is the
relationship.

### Step 6: Compile Findings

For each issue:
1. Note the entity/entities and files involved
2. Assess severity (Critical for broken links that affect
   active content; Warning for orphans and schema violations;
   Info for quality improvements)
3. Propose a fix:
   - For orphans: suggest connections or mark for retirement
   - For broken links: suggest the correct target or flag
     for creation
   - For schema violations: suggest the missing fields
   - For quality issues: suggest specific improvements

---

## Stale DRAFT Detection

### Stale DRAFT Detection

**Severity:** WARNING
**Trigger:** Entity has `source_confidence: DRAFT` and has been
DRAFT for 3 or more sessions.

**Procedure:**

1. Determine the current session number — the highest
   `session_number` value across all session-index entities in
   the vault
2. For each entity with `source_confidence: DRAFT`:
   - Extract the session number from `createdSession` (e.g.
     "Session 1" → 1)
   - Calculate age: `current_session - created_session`
   - If age >= 3: flag as WARNING
3. Entities without `createdSession` that are DRAFT: flag as
   WARNING with different message

**Messages:**

- With age: "Stale DRAFT (created session N, now session M) —
  promote to AUTHORITATIVE or delete. Entity has been
  unconfirmed for 3+ sessions."
- Without createdSession: "DRAFT entity missing createdSession —
  cannot determine staleness. Add createdSession or promote."

**Rationale:** DRAFT entities are meant to be temporary — they
represent unconfirmed content awaiting GM review. After 3
sessions, the GM has had ample opportunity to confirm or reject.
Lingering DRAFTs indicate either forgotten content or content
that should have been deleted.

**Not flagged:** DRAFT entities less than 3 sessions old are
normal and expected (Info level at most). Prep content
(session-plan type) is always DRAFT and is exempt from this
check.
