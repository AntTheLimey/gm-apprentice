# Canon Management

Guidelines for maintaining narrative consistency across a vault.
The states themselves are defined in `shared/canon-status.md`;
this file is the *why* and the conflict workflow.

## Core Principles

### 1. Canon Integrity is Primary

The most important goal is consistent, trustworthy campaign data.
Conflicting information must be detected and surfaced, never
silently resolved.

### 2. Human Resolution Required

Only the Game Master decides which version of events is canon.
Skills and scripts detect conflicts; the GM resolves them, one at
a time, in conversation (`shared/reconcile.md`).

### 3. Source Tracking

Every fact should be traceable to where it came from — a session
wrap-up, a handout, a prep document, a GM ruling. `source_document`
in frontmatter and a source note in an edge's `description` are
what make a conflict *decidable* later.

## Canon Status Levels

`canon_status` is a frontmatter field on every entity. Four values:

### DRAFT

Initial entry, not yet confirmed as canon.

**When to use:** first import of content; anything a skill
generated; unverified information from play notes; work in
progress.

**Behavior:** freely editable; may be superseded without a
conflict; the published site treats it as unconfirmed.

### AUTHORITATIVE

Confirmed as official canon.

**When to use:** GM-verified information; published source
material the GM has adopted; established in play and reconciled;
the winner of a conflict resolution.

**Behavior:** a change to an AUTHORITATIVE fact is a conflict
until the GM confirms it — never overwrite one silently.

### SUPERSEDED

Replaced by newer information.

**When to use:** a retcon; an outdated version after a correction;
the loser of a conflict resolution.

**Behavior:** kept, not deleted; carries `superseded_by` pointing
at the replacement; excluded from current views and the site.

### STUB

Mentioned but not yet described — a placeholder file so links
resolve. Promote it by writing it, then treating it as DRAFT.

## Conflict Detection

### What Triggers Conflicts

1. **Same entity, different values**

   ```text
   Entity "Dr. Smith"
   Source A: "Age: 45"
   Source B: "Age: 52"
   → Conflict
   ```

2. **Contradicting relationships**

   ```text
   Entity "John"
   Source A: spouse_of "[[Mary]]"
   Source B: "Single"
   → Conflict
   ```

3. **Timeline inconsistencies**

   ```text
   Event A: "Smith died in 1925"
   Event B: "Smith attended meeting in 1926"
   → Conflict
   ```

4. **Entity duplication**

   ```text
   Entity "Dr. John Smith"
   Entity "John Smith, M.D."
   → Potential duplicate
   ```

### Where Conflicts Are Surfaced

There is no conflict database. Conflicts live in the vault, in
the places a GM already reads:

| Detector | Where the finding lands |
|----------|-------------------------|
| session-wrapup, while processing play notes | The wrap-up's `### Name Conflicts` and `### Cross-Entity Claims` sections; a claim about another entity gets an `<!-- UNVERIFIED -->` marker on the file it was written to |
| `vault_check.py names` | Duplicate / near-duplicate / sound-alike name pairs |
| campaign-qa canon audit (`checks/canon-audit.md`) | Contradictions between files, incrementally since the last audited session |
| campaign-qa timeline validation | Dated events that cannot both be true |
| any skill editing an AUTHORITATIVE file | Stops and asks before changing the fact |

## Conflict Resolution Workflow

### 1. Detection

A skill or script finds two incompatible claims and records both,
with their sources, in one of the places above. It does **not**
pick a winner.

### 2. Review

The GM sees both versions, their sources, and the context — one
conflict at a time, as a conversation, never a dump
(`shared/reconcile.md`).

### 3. Decision

The GM chooses the authoritative version and says why. "Both are
true, here's how" is a valid answer and usually produces a new
fact.

### 4. Update

- The winning file (or field) is marked `AUTHORITATIVE`.
- The losing one is marked `SUPERSEDED` with `superseded_by`
  pointing at the winner — never deleted.
- The `<!-- UNVERIFIED -->` marker, if any, is removed.
- The decision and its rationale go in the wrap-up's
  Reconciliation Context so the next session-prep does not
  re-open it.

## Best Practices

### For Game Masters

1. **Review conflicts promptly.** They compound: a plan written
   against an unresolved conflict mints a third version.
2. **Document resolutions.** One line of rationale beside the
   decision saves re-litigating it three sessions later.
3. **Promote deliberately.** DRAFT → AUTHORITATIVE is a review,
   not a timeout.
4. **Use GM Notes.** Reasoning for a ruling belongs under
   `## GM Notes`, fenced, where players will not see it.

### When Writing Into the Vault

- **Search before creating.** Run `vault_search.py` (or
  `vault_check.py names`) for the name and its aliases; a near
  miss is a duplicate until the GM says otherwise.
- **Start as DRAFT.** Every new file and every skill-generated
  fact.
- **Reference, don't copy.** Point at the entity's live file
  rather than transcribing a snapshot that will rot.
- **Note the source session** on any fact taken from play.
- **Flag uncertainties** with `<!-- UNVERIFIED -->` rather than
  choosing quietly.
