# Reconcile

Shared procedure for reviewing a Wrap-Up with the GM and promoting
canon status. Called by session-wrapup (after writing a Wrap-Up),
session-prep (when the last session is at `wrap-up`), vault-ingest
(after each ingested Wrap-Up), or standalone when the GM surfaces a
contradiction ("these notes contradict Session 3"). Skip when the
scan's `skip:` line gives a reason.

You need the Wrap-Up path, its related entity files and timeline
entries, and the session index.

All stamps below use `gma stamp-entities`:
dry-run first, `--write` on GM confirmation (see
`shared/vault-access.md`).

## Quick Scan — Fast Path

Session prep's `gma session-context <vault> --prep` output holds the scan;
otherwise run `gma reconcile-scan <vault> "<wrap-up>"` (reads only). The rule its `quick path:` line
applies: no UNVERIFIED marker (bar those tagged with another
session), no Plan file, and no DRAFT created this
session that contradicts AUTHORITATIVE canon (that last is yours to
judge).

If it passes, offer:

> "Straightforward session — no conflicts found, no unplayed
> prep. Settle the threads, then promote the Wrap-Up and {the DRAFTs
> created this session, by name} to AUTHORITATIVE? (y/n)"

On yes, step 5.5 first (a thread write that fails stops here: the
session stays at `wrap-up`), then:
- `gma stamp-entities <vault> "<wrap-up>" --promote --reconciled YYYY-MM-DD`
- `gma stamp-entities <vault> <entity files> --promote` — the
  scan's DRAFTs created this session, never its older ones
- `gma stamp-entities <vault> "<index>" --set status=reviewed`
- Do step 6.1, then go to step 6.5.

Otherwise run the full procedure.

## Procedure

### 1. Load the target

Read the Wrap-Up, related entity files, timeline entries and the
scene files its Plan links. Reads only — no writes yet.

### 2. Highlight uncertain areas

As a short inventory, not a wall of text: the scan's UNVERIFIED
markers, reconstruction notes and DRAFT entities, and timeline entries
with uncertain dates or ordering.

### 2.5. World fact review

If `## GM Notes` has a `### World Fact Findings` subsection, take each
finding one at a time and wait for the GM's call:

- **Canon** → create or update the `_World/` domain file and entities
  (e.g. new heritage → `Heritages/{Name}.md` from
  `shared/templates/heritage.md`, entry in `_World/heritages.md`,
  record in `_flags.md` canon section). If `_World/` doesn't exist,
  create `world-index.md` + `_flags.md` stubs from `shared/templates/`
  first.
- **Ignore** → `_flags.md` ignored section, with date and context;
  future flags on the topic are suppressed.
- **Defer** → `_flags.md` deferred section, with session number and
  context. For a re-surfaced item, show the sessions it came up in.

Record each resolution for step 7.

### 3. Walk through conflicts

One at a time: show both versions (Wrap-Up vs vault, or two
sources), explain the discrepancy in one sentence, propose a
resolution, and **wait for the GM's decision** before the next.

### 3.5. Spoiler reveal check

Spoilers are released at session-wrapup step 4d. Only when
`_meta/reveals.json` has no entry whose `session` is this session
index's title (file name without `.md`), for each block under the scan's `open spoilers:`
(and in any entity this run updated that the Wrap-Up does not link),
ask:

> "[[{Entity}]] has a pending spoiler: '{first ~10 words of the
> spoiler text}...' — was this revealed to the players this session?
> (y/n)"

Yes → remove the `<!-- spoiler -->` / `<!-- /spoiler -->` markers,
leaving the content as published prose. No → leave it for the next
wrap-up's step 4d, or campaign-qa (see
`publish-site/references/content-filtering.md`). None → skip
silently.

### 5. Salvageable prep triage

If the scan names a Plan file, ask about each unplayed element:

| Disposition | Meaning |
|-------------|---------|
| **drop** | No longer relevant, discard |
| **recycle** | Reuse in a future session |
| **must-still-happen** | Critical clue or event players still need |

Flag `must-still-happen` items prominently — they carry into the next
prep.

### 5.5. Threads: keep the lists true

Only for the **most recent** played session (as step 6.5), never an
older Wrap-Up that vault-ingest reconciles.

**The test.** A thread is active when it is a question or an
obligation that can plausibly bear on the sessions ahead, given where
the party is at the end of this session. A thread from a place or arc
the party has left is **dormant**: it goes on the dormant list, kept
for when the party comes back that way or the GM wants something to
bring back to bite them, unless something shows it following them now
(a pursuer, a debt being called in, someone who has turned up again),
which keeps it active. These are not threads at all:

- **finished or overtaken**: done, settled, or made moot by later play;
- **an event**: something that happened, or something a character
  knows. "Ghosh showed his hand at his own dinner table" is an event,
  even as the only line naming the chapter's threat;
- **colour**: roleplay with no stake;
- **one session's business**;
- **a copy** of another line (keep one);
- **on the wrong sheet**: a PC's line about another PC's matter goes
  to that PC, or to the shared list.

Old is not dead. A PC's defining secret or hunted status, an enemy
the notes show is still looking, a debt someone can still call in,
and the mystery the current chapter is about stay active, however
old. When the notes don't let you tell, propose the change and mark
it `?`: the GM would rather add one back than prune a long list.

1. Read `gma session-context <vault> --threads` (prep's bundle has
   it) and this Wrap-Up's recap, What Carries Forward and Handoff.
   Say in one sentence where the party is now.
2. Test every line on every list, and every Wrap-Up line on no list,
   against where the party is now, whenever it was written. Age, or
   no note since, is no reason to keep a line or to pass it over.
   Skip `(hidden)` ones: the tool refuses them.
3. Propose one numbered list of changes only, grouped, `?` on the
   less sure ones:
   - **Ended**: each with the line that ended it.
   - **Dormant**: left behind, each with where or what was left.
   - **Wake**: dormant threads this session came back to, each with
     the name that matched.
   - **Not a thread**: each with its reason in a few words.
   - **Move**: a matter on the wrong sheet, or carried by 2+ PCs; a
     live Wrap-Up line on no list goes onto the shared list.
   - **New this session**: what wrap-up added, so the GM can strike
     one that is not a thread.
   - **Answered**: Keeper Checklist items and open questions this
     reconcile settled, each with the ruling.
   - Last line: "Everything else stays (N threads)." Never list the
     keeps; never ask the GM to review the whole list.
4. The GM strikes by number ("keep 4 and 7") or says ok. A struck
   line stays as it is; a struck New is closed as not a thread.
5. Write in two calls, each a dry run, then the same with `--write`;
   an ERROR row writes nothing. First `gma vault-write <vault> threads
   --wrapup "<wrap-up>"`, TAB rows (LEAD: bold lead or whole text;
   LIST: `shared`, a PC's note name, `dormant`, or `wrapup` for a line
   on no list):

   ```text
   add    shared  SINCE  WHO  TEXT   a live line on no list
   close  LIST  LEAD  EVIDENCE   the quoted line, or "not a thread: {reason}"
   rest   LIST  LEAD  WHY        where or what was left
   wake   LEAD  WHO              one PC: their list; PCs or party: shared
   move   LEAD  SINCE  WHO       holders and PCs involved; "Session N" or -
   hand   FROM  LEAD  TO         one PC's line to another PC's list
   ```

   WHO: the PCs it bears on, or `party`. Copy an `add`'s TEXT exactly:
   that claims the Wrap-Up line. Then `gma vault-write <vault>
   wrapup-settle "<wrap-up>"`, rows `SECTION  LEAD  RULING`, for the
   Answered.
6. A tidy vault after a quiet session: a short list, or "Threads:
   nothing settled". The first run on a vault never tidied is a long
   list; that is expected.

### 6. Promote canon status

On GM approval:
1. `gma stamp-entities <vault> "<wrap-up>" --promote --reconciled YYYY-MM-DD`
2. `gma stamp-entities <vault> "<index>" --set status=reviewed`
3. `gma stamp-entities <vault> <entity files> --promote` for confirmed
   content. First, if `_World/` exists, check each entity against its
   rules; on a violation ask ("This NPC is 400 years old, but world
   rules say humans live 60-85 years. Is that intentional?"):
   - **Intentional** → promote with a note explaining the exception
   - **Correct it** → update the entity, then promote; a replaced
     GM ruling is struck through and marked `superseded YYYY-MM-DD`
   - **Defer** → promote and set `needs_review: true`
4. `gma stamp-entities <vault> "<loser>" --supersede-by "[[Winner]]"`
   for contradicted content

Do the bookkeeping now rather than leaving the GM a list. Hand off to
campaign-organizer if entity filing is needed.

### 6.1. Publish registration (conditional)

Only if the vault has a publish list (`gma publish manifest list --json --vault <vault>` says `listed: true`) and `gma publish settings get player_site.publish player_site.folder --vault <vault>` gives
`true` and a folder; otherwise skip. A relative folder is relative to the
vault. A played session left in the publish list's `needs_decision`
never reaches the player site (#277). Run it yourself,
unconditionally, and report the paths it ticked:

```bash
gma publish manifest publish-played --config <site_dir>/vault.config.json
```

The verb registers a reviewed session index only together with a Wrap-Up that is linked to
it (`documents.wrap_up` or the Wrap-Up's `session:`) and will publish.
Then the site withholds the hub body and builds the session page from
its frontmatter and the Wrap-Up. Any other played session is listed
as "unclear", with the reason (no Wrap-Up, Wrap-Up not reviewed yet,
Excluded or won't publish, or a stale site pin), and is not ticked.
Report the unclear list as it stands. Don't ask about it and don't
tick anything yourself: publish-site asks the GM. Excluded entries are
left alone.

### 6.5. World evolution (conditional)

Offer only for the **most recent** session, and skip if the index's
`world_evolved` already names this session.

> "Session is settled. Want to evolve the world — faction
> turns, NPC reactions, consequence surfacing, foreshadowing
> review? This updates how the world responds to what just
> happened. (y/n)"

Declined → step 7. Accepted → follow `ttrpg-expert/world-evolution.md`
(skip its Storage Checkpoint): thread states, faction turns,
NPC reactions, consequences, foreshadowing, discovery state, world
state — presented together, GM approves each item. Then:
- `gma stamp-entities <vault> "<index>" --set world_evolved="Session_NN"`
- `gma stamp-entities <vault> <new entity files> --set source=world-evolution --session S --date D`
  on entities this pass created
- `gma stamp-entities <vault> <changed entity files> --session S --date D`
  on entities it updated (their `source` stays); S is the session being
  reconciled, in the vault's asOfSession shape (`9` or `"Session 9"`)

### 7. Record decisions

Write `### Reconciliation Context`, opening with
`**Reconciled:** YYYY-MM-DD` (the date stamped into `reconciled:`):
- **Consequences** — what this session established, forward-looking,
  every claim traceable to vault or play notes
- **Promotion** — every entity moved DRAFT → AUTHORITATIVE, by name
- **Salvageable prep** — disposition of each unplayed item
- **GM decisions** — each conflict resolution with rationale
- **World evolution** (if 6.5 ran) — a `#### World Evolution`
  sub-section: one line per faction turn (action, impact, what PCs
  can see), one per NPC reaction (pressure, trait, reaction, the link
  that set it off, and the GM's pick, or the open hinge, where it
  forked), surfaced consequences (trigger, manifestation),
  foreshadowing changes, per-PC discovery shifts, world state changes

Session-prep reads this instead of re-gathering context.

**Where:** always in the Wrap-Up, under its `## GM Notes` — every
item is Keeper-facing. Pass the section, heading first, on stdin
(`<<'EOF'`) to `gma vault-write <vault> wrapup-add "<wrap-up>" --write`; a later reconcile adds its
decisions to the section with `--append`. Never a top-level
`## Reconciliation Context`, and never a `player_site.hide.sections` entry
instead. A Plan file may get a one-line pointer (`See Wrap-Up for
reconciliation context`).

Then run `gma vault-check <vault> wrapup --file "<wrap-up>"`. A missing
or wrong-case path exits 2 with a stderr error; the `no wrap-up with
that path` INFO row (exit 0) now means only that the path resolved but
the file's `type:` isn't a wrap-up. Confirmation is no row naming the
Reconciliation Context heading.

**Reading it back:** accept `###` under `## GM Notes` or a top-level
`## Reconciliation Context` (unmigrated vaults).

## Rules

- **One conflict at a time.** Conversation, not report.
- **Confirm before writing**, even obvious corrections.
- **Record each resolution as soon as the GM confirms.**
- **Stop when the GM says "good enough."** Partial review beats none.

Full conflict detection and resolution: `ttrpg-expert/canon-management.md`.
