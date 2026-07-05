## Canon Audit

The canon audit detects factual contradictions between vault
files. A contradiction is two or more files asserting
incompatible facts about the same entity or event.

**Incremental mode (recommended between full sweeps):** when
the last audit's session number is known, scope the audit to
what changed plus its graph neighborhood instead of the whole
vault:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/vault_check.py" \
  <vault-path> changed --since <last-audit-session + 1>
```

Audit the listed files, plus each one's backlinks
(`graph_check.py backlinks`) — contradictions live where
changes happened. Record the audited session number in the QA
report so the next run knows its starting point. Run the full
vault sweep periodically (e.g. every few chapters) or when no
prior audit point exists.

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

### Step 2b: PC Current Status Consistency

For each active PC entity (`type: pc`, not `status: dead`), read the
`## Current Status` block from `Characters/PCs/{Name}.md` and check, using
the latest sheet only (the block is cumulative — no history walk):

- **Missing / empty block.** Flag a PC with no `## Current Status`, or with
  an empty `Open threads`, when the PC has a live arc (recent session
  activity). Distinguish from a legitimately quiet PC — surface as a
  question, not a hard error.
- **Canon-contradicting Open thread.** Flag an `Open threads` item still
  listed open when the timeline or a session recap shows it resolved — e.g.
  a thread about an NPC the timeline records as dead, or whose payoff
  already occurred.

This is a consistency check, not an age-based decay meter: `Open threads`
carries no per-thread age stamp, so "how many sessions has this lingered"
is out of scope here. Detect only; Validate mode handles the fix.

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
