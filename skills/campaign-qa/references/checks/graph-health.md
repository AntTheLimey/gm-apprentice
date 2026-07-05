## Graph Health

The graph health check examines the structural integrity of
the entity relationship graph in the vault.

**Preferred procedure:** run the bundled graph utility once
and work from its output instead of hand-building a link map:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/graph_check.py" \
  <vault-path> all
```

It reports orphans, unresolved links, dead ends, and
ambiguous bare links in one pass (see
`shared/vault-access.md` for options such as `--folder`
and `--exclude`). Use the manual steps below only if Python
is unavailable, and flag that fallback in results.

### Step 1: Enumerate Entities and Links

Read all entity files in scope. For each, extract:
- Frontmatter relationships (wiki-links in frontmatter
  fields)
- Body wiki-links (inline references)
- Entity type and required relationships per schema

### Step 2: Structural Checks

**Orphaned entities:** Entities with zero inbound relationships
(what `graph_check.py orphans` reports). These are disconnected
from the graph and probably forgotten.

**Broken links:** Wiki-links that point to files that don't
exist. Search for `[[...]]` patterns across all files, then
verify each linked target file exists.

**Ambiguous links:** Wiki-links using a bare basename that
matches more than one file in the vault. Obsidian resolves these
silently to one of the matches — which one is unspecified and
can change as files are added — so this is not a broken link,
it's a wrong one waiting to happen. Build a basename → file-list
index across the whole vault, then flag every bare `[[...]]`
target whose basename maps to more than one file. Most common
cause: Session Wrap-Up files still on the pre-migration
`Session_NN_Wrap_Up.md` pattern (no chapter number) after a
second chapter reused a session number.

**Bidirectional consistency:** If entity A's frontmatter says
`ally_of: "[[B]]"`, does entity B's frontmatter acknowledge
entity A? Flag one-way relationships that should be mutual.

**Hub overload:** Entities with an unusually high number of
relationships (more than 2 standard deviations above the mean
for their type). These are often over-linked — some
connections are implied by traversal rather than direct.

**Un-fenced GM-only content:** Search every file for headings
(any level) and bold-paragraph lines (`**Text:**` with no `#`)
whose text contains one of: "keeper", "secret", "tactic",
"confidential", "gm-only", "dm notes" — case-insensitive. For
each match, check whether it sits inside a `## GM Notes` section
or a `<!-- gm-only -->`/`<!-- spoiler -->` fence. If it doesn't,
flag it — this is exactly the shape of content that silently
leaks to the published site (an NPC's tactical notes under a
bold-wrapped `### **Keeper Notes**` heading defeat exact-string
matching the same way a genuinely un-fenced heading does).
Skip files the publish pipeline would already exclude wholesale
(Session Plans and prep-status files, anything under
`exclude_dirs`, and — when the vault has `exclude_drafts`
configured — draft entities), so this check only flags content
that would actually reach the site.
Severity: Critical if the vault has `publish.site_dir`
configured (it's actually publishing); Warning otherwise.

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
most recent `type: session_wrap` file).

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
2. Assess severity (Critical for broken or ambiguous links that
   affect active content; Warning for orphans and schema
   violations; Info for quality improvements)
3. Propose a fix:
   - For orphans: suggest connections or mark for retirement
   - For broken links: suggest the correct target or flag
     for creation
   - For ambiguous links: identify which file the GM meant from
     context, then either fix that one link, or — if the
     collision is structural (e.g., unmigrated Wrap-Up
     filenames) — point to campaign-organizer's migration
     workflow to rename the colliding files and repair every
     reference vault-wide
   - For schema violations: suggest the missing fields
   - For quality issues: suggest specific improvements
