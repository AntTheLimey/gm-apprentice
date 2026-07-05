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
