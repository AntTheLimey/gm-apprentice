## Graph Health

The graph health check examines the structural integrity of
the entity relationship graph in the vault.

**Preferred procedure:** run the bundled utilities once and
work from their output instead of hand-building checks by eye
— `graph_check.py` for the link graph, `vault_check.py` for
schema, GM-leak, and relationship checks:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/graph_check.py" \
  <vault-path> all
```

It reports orphans, dead ends, and
ambiguous bare links in one pass (`graph_check.py --help`
for `--folder` and `--exclude`).

### Step 1: Enumerate Entities and Links

Read all entity files in scope. For each, extract:
- Frontmatter relationships (wiki-links in frontmatter
  fields)
- Body wiki-links (inline references)
- Entity type per schema

### Step 2: Structural Checks

**Orphaned entities:** Entities with zero inbound relationships
(what `graph_check.py orphans` reports). These are disconnected
from the graph and probably forgotten.

**Broken links:** run `links.py <vault-path>`. It lists every link
with no note behind it, already sorted, and skips old QA reports and
archives. Work from its rows:

- `NEAR` rows name the note the link may mean. `same` candidates
  (the names differ only in case, punctuation, accents or emoji) are
  safe: propose them all as one batch and fix them on a single yes.
  A row that offers more than one candidate is never batched: ask
  which note is meant.
  `close` (a likely typo) and `part` (extra words before or after)
  are guesses: ask about each, and say what the two names are.
- `UNWRITTEN` rows are links to things never written. These are the
  GM's to-do list, not defects. List them once under a "Not yet
  written" heading, most-linked first. Do not ask a fix-or-dismiss
  question for each and do not raise their severity.
- `FILE` rows are links to an attached file (an image, a PDF) that is
  not in the vault. Neither fix applies: say which note holds the
  link and ask whether the GM will restore the file or wants the link
  removed, then edit the note yourself.

To fix, run `links.py <vault-path> retarget "<name>" "<note>"` (add
`--keep-text` when the words on the page should stay as written and
only the link should change, as with a variant spelling in a
player-facing recap). One run covers every spelling shown in the row.
Read the preview, then run it again with `--write`. To remove a
link the GM does not want (a rules term, a passing mention), run
`links.py <vault-path> unlink "<name>" ...` the same way. An
unwritten name that deserves a note is created with the
organizer's entity workflow, not here.

**Ambiguous links:** what `graph_check.py ambiguous` reports —
wiki-links using a bare basename that matches more than one
file in the vault. Obsidian resolves these silently to one of
the matches — which one is unspecified and can change as files
are added — so this is not a broken link, it's a wrong one
waiting to happen. Most common cause: Session Wrap-Up files
still on the pre-migration `Session_NN_Wrap_Up.md` pattern (no
chapter number) after a second chapter reused a session
number.

**Index drift:** what `vault_check.py index` reports — files
not referenced from `_meta/index.md`, and index entries whose
target file no longer exists. The fix is `index_build.py
<vault> --write`, never a hand edit to `_meta/index.md`.

**Un-fenced GM-only content:** `vault_check.py gm-leak` produces
the findings — ERROR for an orphan `<!-- /gm-only -->` closer
(everything above it publishes); WARNING for an unclosed opener
or a published heading whose title contains an exclude-list
entry or Keeper keyword; INFO for a Keeper-facing bold label or
callout. The keyword list ("secret", "tactic", "confidential",
"gm-only", …) and the reading of "Keeper" (the GM, not a job like
"Innkeeper" or "Lighthouse Keeper") live in the script, not here. This is exactly the shape of content that silently
leaks to the published site (an NPC's tactical notes under a
heading that is not on the exclude list). A heading on the list is
hidden however it is dressed (`### **GM Notes**`, `### GM Notes:`), so it is
not a finding.
The script skips notes the site does not publish, so it only flags
content that would actually reach the site. A keyword heading the GM
says is for players: run `vault_check.py <vault> gm-leak --settle
"<note:line from the row>"`, and it is not flagged again.
That settles every heading with the same text in that note.
Severity: Critical. With no site the script says so in one INFO row.

### Step 3: Schema Compliance

**Preferred procedure:**

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/vault_check.py" \
  <vault-path> frontmatter
```

`vault_check.py frontmatter` checks required fields, enum
values, legacy field names, and unquoted frontmatter links in
one pass. On a vault that publishes it also asks the publish
tool which notes the site's build cannot parse: an ERROR row,
"the site's build cannot parse this frontmatter", means the build
skips the note, so it has no page. Fix the YAML near the line it
names (for an unclosed quote, the parser names the end of the
block): quote a value that holds a colon, and keep one of a key
written twice, asking the GM only when the two values differ. Read `_meta/entity-types.md` for the type hierarchy
and interpret its findings against it:
- Verify the entity's `type` field matches a known type
- Flag entities still marked as STUB that have been
  referenced in played sessions (they need fleshing out)

### Step 4: Character Story Validation

Run `vault_check.py <vault-path> stories`. Each WARNING row is a
living PC with no story file (create it from
`shared/templates/character-story.md`), or a story file more than
one Wrap-Up behind (the row names the fix). A story whose
`asOfSession` names no session is also a WARNING: ask the GM which
session it is current to.

### Step 5: Relationship Quality

Every relationship rule is a check in the publish tool, so never
read ties by eye for one. Run:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/vault_check.py" \
  <vault-path> relationships
```

Each row is `LEVEL  note:line  message`. The rows cover types off
the vocabulary (inverses, verbs and near misses included), ties
stored on both notes, one fact written from both sides, the
two-way flag, strength, ties to session notes, the two containment
fields, containers whose points of interest were never re-pointed,
types the vault's own `_meta/relationship-types.md` leaves out, and
hubs. One `ERROR  (vault)  could not check the relationships` row
means the tool did not run: say why (the row names it) and skip
this step. Tone WARNING rows belong to the Tone Words check
(`tone-words.md`): change nothing for them here, and in a Full
Audit do not report them twice.

Then make the repairs yourself:

1. Run the fix preview. It changes nothing:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/tools/publish/bin/gm-publish.js" \
     relationships fix --vault <vault-path> --json
   ```

   `changes` are the certain repairs, each with its `kind`; `kept`
   are ties it will not touch, each with the reason.
2. Show the GM the changes in one table by kind (count and an
   example or two each), then the `kept` ties each with its reason,
   and ask one yes for all of the changes. On yes, run the same
   command with `--write` instead of `--json`: every note changes or
   none does.
3. Run the check again and walk what is left with the GM by kind,
   ERROR rows first, then WARNING:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/tools/publish/bin/gm-publish.js" \
     relationships check --vault <vault-path> --json
   ```

   Each finding has a `kind` and a message that names its choices (a
   near type, `one of:`, store it on the other note, drop it, keep one
   copy). Ask once per type word, not per tie: list each word with its
   count and an example, take one answer, and apply it wherever that
   word appears. Ask about a single tie only when the GM wants it
   handled differently. Edit the notes on the GM's answers.
4. List the INFO rows once, without a question each. A
   `childless-container` row is answered per
   `shared/relationship-normalization.md` § Interposing a new
   container, if the GM wants it.

**What the check cannot judge.** Raise these as Info, with the
tie and your reason: a tie that adds nothing a short traversal
does not already show (two NPCs who share a location need no
direct tie: the shared place is the relationship), two ties on one
pair that mean the same thing, and a type vaguer than one that
fits. Offer the most specific type in
`_meta/relationship-types.md` that says what the tie means.

### Step 6: Compile Findings

For each issue:
1. Note the entity/entities and files involved
2. Assess severity (Critical for broken or ambiguous links that
   affect active content; Warning for orphans and schema
   violations; Info for quality improvements)
3. Propose a fix:
   - For orphans: suggest connections or mark for retirement
   - For broken links: the `links.py` fix for the row's kind (see
     Step 2); an unwritten name is a to-do, not a finding
   - For ambiguous links: identify which file the GM meant from
     context, then either fix that one link, or — if the
     collision is structural (e.g., unmigrated Wrap-Up
     filenames) — rename the colliding
     files with `relink.py`, which rewrites every reference
     vault-wide; a link it cannot place is listed as UNSURE for
     the GM to settle
   - For schema violations: suggest the missing fields
   - For quality issues: suggest specific improvements
