# Benchmark Questions — document chain

**Skill:** session-prep, session-play, session-wrapup (cross-skill)
**Purpose:** Establish baseline for the session document chain standard
**Runs:** 3 per variant (Sonnet agent), blind evaluation (Opus)
**Campaign data:** `tests/benchmark-campaign/`
**Models:** claude-sonnet-4-6 (agents), claude-opus-4-6 (evaluator)

Note: these questions test behaviour that does not yet exist in the
campaign data. Agents working against the control (monolith) prompt will
use the old single-file format. Agents working against the test prompt
will use the new document chain format (Session Index + Plan + Play Notes
+ Wrap-Up as separate files). Score the test prompt on whether it
correctly applies the chain conventions, not on whether the files exist.

## Questions

### Q1 — Plan file output

session-prep has finished preparing Session 3. What frontmatter fields
must appear in the Plan file
`Session 03 - The Inner Sanctum - Plan.md`, and what is the correct
status value at the point session-prep writes it?

### Q2 — Play Notes capture

We are mid-session playing Session 3. The investigators have just
broken into the Silver Twilight Lodge and found a ledger entry that
reads "preparations at the St. Anselm's site". Record this as a
raw play note in the Play Notes file. What file does session-play
write to, and what frontmatter status should that file carry?

### Q3 — Wrap-Up reads Play Notes

Session 3 has ended. session-wrapup needs to produce the Wrap-Up
file. Walk through the steps: which source file does it read, what
file does it write, and what fields in the Wrap-Up frontmatter
distinguish it from the Play Notes file?

### Q4 — Session index status tracking

Show the full expected frontmatter for the Session 3 Index file
`Session 03 - The Inner Sanctum.md` at each of the four status
stages: planned, prepped, played, wrap-up.

### Q5 — Reconcile promotes to reviewed

The wrap-up for Session 3 is complete. The reconcile procedure
runs. What change does reconcile make to the Session Index file,
and what condition must be true before it can promote status to
reviewed?

### Q6 — Missing documents are valid

session-prep is about to prep Session 4, but Session 3 only has
an Index file and a Wrap-Up file — no Plan file and no Play Notes
file exist. Is this state valid? What should session-prep do
before starting its prep work?

### Q7 — Skill ownership boundaries

A GM asks: "Can session-play update the Session Wrap-Up file
during the session?" Answer correctly according to the document
chain ownership rules, and explain what session-play should do
instead with content that belongs in the Wrap-Up.

### Q8 — Status fallback before prep

session-prep is about to prep Session 4. Session 3's Index file
has status "played" but no Wrap-Up file exists. Describe the
correct fallback behaviour: what does session-prep tell the GM,
and does it block or continue with prep?

## Agent Prompts

### Control prompt (monolith — extracted from main via `git show`)

```text
You are a TTRPG session workflow assistant. Read the skill entry point:
skills/session-lifecycle/SKILL.md
Follow routing to find the right files for each question.
Answer each question concisely (under 150 words each).

Also read the campaign files at:
tests/benchmark-campaign/
Start with the index at _meta/index.md, then read session notes,
PC roster, and entity files as needed for each question.

The campaign uses a single session file per session located at:
tests/benchmark-campaign/Chapters/Chapter 1/Sessions/

Questions:

Q1: session-prep has finished preparing Session 3. What frontmatter
fields must appear in the prep output for Session 3, and what is
the correct status value at the point session-prep writes it?

Q2: We are mid-session playing Session 3. The investigators have just
broken into the Silver Twilight Lodge and found a ledger entry that
reads "preparations at the St. Anselm's site". Record this as a raw
play note. What section of the session file does session-play write
to, and what status should the file carry during play?

Q3: Session 3 has ended. session-wrapup needs to produce the final
record. Walk through the steps: which source does it read, what does
it write, and what fields in the output distinguish it from raw play
notes?

Q4: Show the full expected frontmatter for the Session 3 session file
at each of the four stages in its lifecycle: planned, prepped,
played, and wrap-up complete.

Q5: The wrap-up for Session 3 is complete. The reconcile procedure
runs. What change does reconcile make to the session file, and what
condition must be true before it can promote status to reviewed?

Q6: session-prep is about to prep Session 4, but Session 3 only has
a session file with status "played" and no narrative recap section.
Is this state valid? What should session-prep do before starting its
prep work?

Q7: A GM asks: "Can session-play add wrap-up content directly into
the session file during the session?" Answer correctly according to
the session lifecycle ownership rules, and explain what session-play
should do instead with content that belongs in the wrap-up.

Q8: session-prep is about to prep Session 4. Session 3's session file
has status "played" but no narrative recap or carry-forward sections.
Describe the correct fallback behaviour: what does session-prep tell
the GM, and does it block or continue with prep?
```

### Test prompt (split skills + document chain — feature branch)

```text
You are a TTRPG session workflow assistant. Read the skill entry points:
skills/session-prep/SKILL.md
skills/session-play/SKILL.md
skills/session-wrapup/SKILL.md
Also read: skills/shared/session-document-chain.md
Follow routing to find the right files for each question.
Answer each question concisely (under 150 words each).

The session document chain standard splits session records into four
separate files per session:
- Session Index  : Session {NN} - {Title}.md            (hub + status)
- Session Plan   : Session {NN} - {Title} - Plan.md     (session-prep writes)
- Play Notes     : Session {NN} - {Title} - Play Notes.md (session-play writes)
- Session Wrap-Up: Session {NN} - {Title} - Wrap-Up.md  (session-wrapup writes)

Status progression: planned → prepped → played → wrap-up → reviewed

Also read the campaign files at:
tests/benchmark-campaign/
Start with the index at _meta/index.md, then read session files,
PC roster, and entity files as needed for each question.

Questions:

Q1: session-prep has finished preparing Session 3. What frontmatter
fields must appear in the Plan file
"Session 03 - The Inner Sanctum - Plan.md", and what is the correct
status value at the point session-prep writes it?

Q2: We are mid-session playing Session 3. The investigators have just
broken into the Silver Twilight Lodge and found a ledger entry that
reads "preparations at the St. Anselm's site". Record this as a raw
play note. What file does session-play write to, and what frontmatter
status should that file carry?

Q3: Session 3 has ended. session-wrapup needs to produce the Wrap-Up
file. Walk through the steps: which source file does it read, what
file does it write, and what fields in the Wrap-Up frontmatter
distinguish it from the Play Notes file?

Q4: Show the full expected frontmatter for the Session 3 Index file
"Session 03 - The Inner Sanctum.md" at each of the four status
stages: planned, prepped, played, wrap-up.

Q5: The wrap-up for Session 3 is complete. The reconcile procedure
runs. What change does reconcile make to the Session Index file, and
what condition must be true before it can promote status to reviewed?

Q6: session-prep is about to prep Session 4, but Session 3 only has
an Index file and a Wrap-Up file — no Plan file and no Play Notes
file exist. Is this state valid? What should session-prep do before
starting its prep work?

Q7: A GM asks: "Can session-play update the Session Wrap-Up file
during the session?" Answer correctly according to the document chain
ownership rules, and explain what session-play should do instead with
content that belongs in the Wrap-Up.

Q8: session-prep is about to prep Session 4. Session 3's Index file
has status "played" but no Wrap-Up file exists. Describe the correct
fallback behaviour: what does session-prep tell the GM, and does it
block or continue with prep?
```

### Evaluator prompt (blind scoring)

```text
You are evaluating two TTRPG GM assistant responses. One is
labelled A, one B. You do not know which is control or test.

These questions test how well the assistant understands session
document lifecycle conventions — file ownership, status progression,
and correct fallback behaviour when documents are missing.

Score each answer on 5 dimensions (1-3 each, 15 max per question):

| Dimension | 1 (Poor) | 2 (Partial) | 3 (Nailed it) |
|-----------|----------|-------------|----------------|
| Factual accuracy | Wrong fields, wrong status values, hallucinated filenames | Mostly correct, minor errors | All fields, filenames, and status values correct |
| Document chain precision | Conflates files or ignores split-file structure | Identifies correct file but misses a field or step | Names the exact file, correct frontmatter, correct ownership |
| Actionability | Needs significant rework | Usable with GM effort | Drop-in ready, use as-is |
| Status lifecycle correctness | Wrong stage or transition described | Right stages but transition condition unclear | Correct stage, correct transition condition, correct gate |
| Fallback / edge-case handling | Ignores missing files or invalid state | Notices problem but advice is vague | Precise advice with clear block-or-continue decision |

Questions for context:

Q1: Plan file output — frontmatter fields and status after session-prep
Q2: Play Notes capture — target file and status during live play
Q3: Wrap-Up derivation — source file, output file, distinguishing fields
Q4: Session Index status tracking — frontmatter at each of four stages
Q5: Reconcile promotion — what changes, what gate must pass
Q6: Missing documents valid state — Plan + Play Notes absent before prep
Q7: Skill ownership boundary — session-play and Wrap-Up file
Q8: Status fallback — played index but no Wrap-Up file before next prep

For each question, output:
- Scores for A and B on each dimension
- Brief justification (1 sentence per dimension)
- Total per question and overall total

Do NOT reveal which you think is control or test.
```
