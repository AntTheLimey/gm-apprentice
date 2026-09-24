# Reconcile

Shared procedure for reviewing a Wrap-Up with the GM and promoting
canon status. Called by session-wrapup (after writing a Wrap-Up),
session-prep (when the last session is at `wrap-up`), vault-ingest
(after each ingested Wrap-Up), or standalone when the GM surfaces a
contradiction ("these notes contradict Session 3"). Skip for first
sessions or when status is already `reviewed`.

You need the Wrap-Up path, its related entity files and timeline
entries, and the session index.

All stamps below use `python3
"${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/stamp_entities.py"`:
dry-run first, `--write` on GM confirmation (see
`shared/vault-access.md`).

## Quick Scan — Fast Path

Check three conditions:

1. Zero `<!-- UNVERIFIED: … -->` markers (or bare
   `<!-- UNVERIFIED -->`) in the Wrap-Up
2. Zero DRAFT entities contradicting AUTHORITATIVE ones on the same
   facts
3. No Plan file for this session (no unplayed prep to triage)

If all pass, offer:

> "Straightforward session — no conflicts found, no unplayed
> prep. Promote all new entities to AUTHORITATIVE? (y/n)"

On yes:
- `stamp_entities.py <vault> "<wrap-up>" --promote --reconciled YYYY-MM-DD`
- `stamp_entities.py <vault> <entity files> --promote` — this
  session's DRAFT entities
- `stamp_entities.py <vault> "<index>" --set status=reviewed`
- Go to step 6.5.

Otherwise run the full procedure.

## Procedure

### 1. Load the target

Read the Wrap-Up, related entity files, timeline entries and linked
scene notes. Reads only — no writes yet.

### 2. Highlight uncertain areas

As a short inventory, not a wall of text:
- `<!-- UNVERIFIED: … -->` markers (or bare `<!-- UNVERIFIED -->`)
- Reconstruction notes (`> [!info] Reconstruction Note`)
- DRAFT entities and any `canon_status: DRAFT` content tied to this
  session
- Timeline entries with uncertain dates or ordering

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
  context. For a re-surfaced item, show the accumulated context ("The
  Old Empire has come up in 3 sessions now — should we flesh this
  out?").

Record each resolution for step 7.

### 3. Walk through conflicts

One at a time: show both versions (Wrap-Up vs vault, or two
sources), explain the discrepancy in one sentence, propose a
resolution, and **wait for the GM's decision** before the next.

### 3.5. Spoiler reveal check

For each entity this Wrap-Up created or updated (the set in
session-wrapup's receipt) that holds an open `<!-- spoiler -->`
block, ask:

> "[[{Entity}]] has a pending spoiler: '{first ~10 words of the
> spoiler text}...' — was this revealed to the players this session?
> (y/n)"

Yes → remove the `<!-- spoiler -->` / `<!-- /spoiler -->` markers,
leaving the content as published prose. No → leave it; it is asked
again next time the entity is touched, or caught by campaign-qa (see
`publish-site/references/content-filtering.md`). No spoiler blocks →
skip silently.

### 5. Salvageable prep triage

If a Plan file exists for this session, ask about each unplayed
element:

| Disposition | Meaning |
|-------------|---------|
| **drop** | No longer relevant, discard |
| **recycle** | Reuse in a future session |
| **must-still-happen** | Critical clue or event players still need |

Flag `must-still-happen` items prominently — they carry into the next
prep.

### 6. Promote canon status

On GM approval:
1. `stamp_entities.py <vault> "<wrap-up>" --promote --reconciled YYYY-MM-DD`
2. `stamp_entities.py <vault> "<index>" --set status=reviewed`
3. `stamp_entities.py <vault> <entity files> --promote` for confirmed
   content. First, if `_World/` exists, check each entity against its
   rules; on a violation ask ("This NPC is 400 years old, but world
   rules say humans live 60-85 years. Is that intentional?"):
   - **Intentional** → promote with a note explaining the exception
   - **Correct it** → update the entity, then promote; a replaced
     GM ruling is struck through and marked `superseded YYYY-MM-DD`
   - **Defer** → promote and set `needs_review: true`
4. `stamp_entities.py <vault> "<loser>" --supersede-by "[[Winner]]"`
   for contradicted content

Do the bookkeeping now rather than leaving the GM a list. Hand off to
campaign-organizer if entity filing is needed.

### 6.5. World evolution (conditional)

Offer only for the **most recent** session, and skip if the index's
`world_evolved` already names this session.

> "Session is settled. Want to evolve the world — faction
> turns, consequence surfacing, foreshadowing review? This
> updates how the world responds to what just happened. (y/n)"

Declined → step 7. Accepted → follow `ttrpg-expert/world-evolution.md`
(skip its Storage Checkpoint): thread states, faction turns,
consequences, foreshadowing, discovery state, world state — one item
at a time, GM approves each. Then:
- `stamp_entities.py <vault> "<index>" --set world_evolved="Session_NN"`
- `stamp_entities.py <vault> <entity files> --set source=world-evolution --session N --date D`
  on entities this pass created or updated

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
  can see), surfaced consequences (trigger, manifestation),
  foreshadowing changes, per-PC discovery shifts, world state changes

Session-prep reads this instead of re-gathering context.

**Where:** always in the Wrap-Up, as a `###` under its `## GM Notes`.
Nest it there rather than as a top-level `## Reconciliation Context`,
and never add it to an `exclude_sections` list instead — every item is
Keeper-facing, and `## GM Notes` is already hidden in every vault's
config. If the file has no `## GM Notes`, create one wrapped in its
own `<!-- gm-only -->`/`<!-- /gm-only -->` fence. If the block is
fenced, insert **before** the `<!-- /gm-only -->` closer. A Plan file
may get a one-line pointer (`See Wrap-Up for reconciliation context`).

Then run `vault_check.py <vault> wrapup --file "<wrap-up>"`. A missing
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
