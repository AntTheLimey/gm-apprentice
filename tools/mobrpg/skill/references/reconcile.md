# Reconcile — mobRPG canon → vault

Entered when suggestions have gone out and are awaiting pull-back:

```bash
mobrpg suggestions <world> --state Accepted --correlate --vault <path>
```

shows accepted review states not yet reflected in the vault's `mobrpg:`
nodes. `--state` takes one value per run — bare `mobrpg suggestions <world>`
defaults to `--state Pending`, which is not what this phase is about, so
accepted and dismissed are two separate queries (swap `--state Dismissed` for
the second). The phase's per-entity outcomes below are built from both lists
together. `--correlate --vault <path>` is what joins each suggestion back to
its originating vault note. Every write here is a
`mobrpg pull-canon ...` invocation — never `python -m mobrpg`.

## Node authority rule (via `pull-canon`)

mobRPG is canon; the vault is the working surface. Run

```bash
mobrpg pull-canon --vault <path> <world>
```

**dry-run first** (no `--execute` — this is the default; the CLI prints
`pull-canon: N node(s) updated` plus `[dry-run — no files changed]`). Present
the per-entity outcomes to the GM before writing anything:

- **accepted** → fill `element_id` (`review_state: "accepted"`).
- **edited** (accepted-with-drift) → canon overwrites the vault's
  `determined` classifiers (`review_state: "edited"`).
- **dismissed** → record the `review_note`, preserve the vault copy as-is.
- **deleted** → flag it (`review_state: "deleted"`, `element_id` cleared).
- **pending** → leave the vault alone; nothing to reconcile yet.

Get an explicit yes on the presented outcomes, then re-run the same command
with `--execute` to write.

All five outcomes are live. To surface **edited** (drift) and **deleted**,
`pull-canon` verifies each accepted suggestion's ratified element: a live
element supplies the canon `determined` (so drift is detected against the
vault's), and a deleted one (element GET 404) flags the node. That verification
pass is on by default; `--no-verify` skips it (faster/offline, but only
accepted/dismissed will then surface). **pending** is queried too but is a
no-op on the vault — it just means "still under review, nothing to reconcile."

There is no `--crosswalk` flag anywhere — sidecar crosswalks are retired and
untrusted. `pull-canon` reconciles against each note's `mobrpg:` node, the
single source of truth.

**Deletions outside the review queue.** The verification pass above only covers
elements that came *through* review. When the world owner deletes an element
directly, `whats-new` lists it under GONE and nothing ever flags its node — the
note keeps a dangling `element_id` and reads as linked forever. Close that with:

```bash
mobrpg pull-canon --vault <path> --reconcile-deletions <world>
```

Same dry-run → present → confirm → `--execute` sequence; vault-only. The pass
aborts if the world reads as unreadable or empty rather than flagging every
linked node deleted off a failed read, so an abort means "try again", not "the
world is gone". Run it whenever `whats-new` reports a non-zero GONE count.

**Sequencing (from the foundation audit):** always run `pull-canon` after any
re-`suggest`, so relationship `event_id`s heal and no duplicate-suggestion
window stays open. If a push report flagged a `pending`-state node before
re-suggesting, this is the follow-up that closes it out.

## Executing

Only after the GM has read the presented outcomes and given an explicit yes:

```bash
mobrpg pull-canon --vault <path> --execute <world>
```

`pull-canon --execute` writes local vault files only — it never calls the
mobRPG API, so it carries no live-world write risk regardless of the PROD/DEV
target. It is still a vault mutation, though, so it follows the same
dry-run → present → confirm → `--execute` sequence as every other mutating
verb in this skill. Don't skip the confirm step just because nothing leaves
the vault.

## Description content — reconcile via `sync`

`pull-canon` reconciles the machine `mobrpg:` node; it does **not** touch the
note's *description* prose. That is `sync`'s job. Run it after `pull-canon`.

`sync` is a single timestamp last-writer-wins verb — no content hashes, no
frozen baselines, no merges. For each linked note it compares three timestamps:
the note file's mtime, the node's recorded `last_synced`, and the server
element's `lastModified`. From those it decides, per note, inside a ±120s skew
window (tune with `--skew`):

- **skip** → neither side changed since the last sync. Nothing to do.
- **pull** → only mobRPG changed. `sync` overwrites the note's canon prose
  wholesale with the converted server description, preserving the vault-only
  tail verbatim, and stamps `last_synced`.
- **push** → only the vault changed. `sync` does **not** write upstream. It files
  one reviewable `UpdateElement` suggestion and marks the node
  `review_state: pending`. The GM adjudicates it in mobRPG — accept and the vault
  becomes canon, dismiss and mobRPG stays canon.
- **tie** → both sides changed within the skew window. Treated as a push (a
  suggestion), because a human should decide.
- **baseline** → the note has never synced (`last_synced` empty), so there is no
  baseline and timestamps decide nothing. Content decides instead: prose that
  already matches is stamped in sync; an empty scaffold stub takes the server's
  prose (a pull); anything else keeps the authored body untouched and just adopts
  a `last_synced` stamp. A never-synced note never manufactures a push — real
  drift surfaces on the next edit of either side.

A note already `review_state: pending` is held — it's awaiting adjudication
upstream, so `sync` won't touch it (it isn't even fetched).

**Update suggestions carry a synthetic ref.** Each filed `UpdateElement` gets its
own `<namespace>:upd/<note-path>#<content-hash>` externalRef rather than the
note's plain `<namespace>:<note-path>`, because a ref is claimed for good once
its suggestion is accepted or dismissed — reusing the note's ref meant only the
first update ever reached the GM. Re-pushing identical prose mints the identical
ref (so it corrects an open proposal in place instead of duplicating it), and
edited prose mints a new one. `suggestions --correlate` and `pull-canon` both
strip the `upd/` wrapper, so an update still resolves to the note it came from.

The push also records that ref on the node as `pending_ref`, alongside
`review_state: pending`. Accepted and dismissed rows stay in the review queue
forever, so after an accept → re-edit → re-push cycle several rows answer for the
same note; `pull-canon` adjudicates only the row whose ref matches the note's
`pending_ref`, and clears it once the verdict lands. A note whose update ref no
longer resolves to any file (renamed, moved or deleted since the push) is
reported as a skipped update suggestion — `relink` re-points a moved note.

**You are the interactive UI.** Run the dry-run, present the per-note decision
table to the GM, get an explicit yes, then `--execute`. Never `--execute` a
decision table the GM hasn't seen.

**Step 1 — decision table (read-only):**

```bash
mobrpg sync <world> --vault <path>
```

This prints one row per linked note with its verdict (skip / pull / push / tie /
baseline) and the timestamps behind it. Restrict to a subset with `--only <substring>`.

**Step 2 — present, confirm, execute:**

```bash
mobrpg sync <world> --vault <path> --execute
```

`--execute` gates every file write and every suggestion submit. The **pull**
rows write local vault files only (no live-world risk regardless of the PROD/DEV
target). The **push/tie** rows file `UpdateElement` suggestions against the live
world — so on a PROD target, heed the production banner and get the GM's explicit
yes first, or switch to `MOBRPG_ENV=dev`.

**Vault-only sections are never pushed and never pulled over.** `## GM Notes`
stays local by design (until mobRPG enforces hidden-note access server-side), and
so do the play-log sections `## Notes`, `## Appearances` and
`## Source References` — session bookkeeping, not canon prose, and pushing them
buried the world owner's review queue in churn. Both directions treat them as the
vault's own: a push strips them, a pull preserves them verbatim. A vault can
replace that list with a top-level `"vaultOnlySections": ["...", ...]` array in
`_meta/mobrpg-map.json`. The array **replaces** the default rather than adding to
it, so a list that omits `GM Notes` opts GM secrets into the push — `sync` obeys
the config but prints a `WARNING: vaultOnlySections does not include "GM Notes"`
line to stderr when it does. Headings left with no body (empty scaffold prompts
like a bare `## Properties`) are dropped from the push candidate too — they're
writing prompts for the vault, not description content.

**Before the first `--execute` after upgrading, look for canon H2s below a
vault-only section.** A vault-only section now ends at the next `##` heading
rather than at end-of-file, so an authored heading that happens to sit *after*
`## GM Notes` (a `## Timeline`, say) is canon-facing — earlier versions preserved
everything below `## GM Notes` on a pull, and those sections are now overwritten
by one. Grep the vault for headings following a vault-only section, move any that
are real canon above it, and always read the dry-run table first: every **pull**
row prints the canon line count it is about to trade, e.g.
`pull  ns:People/marsh-hag  (canon -8/+1 lines, SHRINKS)`. A `SHRINKS` row is the
one to open before you say yes.

*Why it's safe:* a pull overwrites only the canon-prose region, never the
vault-only tail; a push never mutates a live element — it only proposes a
suggestion the GM ratifies. Nothing is merged and no authored prose is clobbered
by a guess.
