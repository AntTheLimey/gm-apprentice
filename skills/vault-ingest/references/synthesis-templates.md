# Synthesis Templates

Reference for Phase 5. Vault-ingest's adapter layer — transforms
confirmed play events and GM answers into formats that downstream
skills expect.

## Play Notes Equivalent

The primary output. Must be processable by `session-wrapup` as
if a session just ended. Uses the document chain standard:
`type: session-play-notes` per `shared/session-document-chain.md`.

### Frontmatter

```yaml
---
type: session-play-notes
session: "[[Session NN - Title]]"
chapter: "[[Chapter N - Title]]"
campaign: "Campaign Name"
source_confidence: AUTHORITATIVE
created_by: vault-ingest
---
```

### Required Body Sections

```markdown
> [!info] Reconstruction Note
> Reconstructed from [list source documents with classifications]
> on [date]. Keeper interview filled [N] gaps. [N] items remain
> unresolved.

## Play Events

[Chronological account of confirmed play events, organized by
scene or time period. Each event cites its source.]

### [Scene or Event Title]

- **Source:** [play fragment in X / keeper interview / timeline]
- **What happened:** [factual account]
- **Entities involved:** [[NPC]], [[Location]], [[Item]]
- **PC actions:** [specific player decisions and outcomes]
- **Mechanical events:** [dice rolls, skill checks, if known]

## Entity Flags

[Entity extraction markers for session-wrapup to process]

- NEW-NPC: [[Name]] — [brief description, source]
- NEW-LOC: [[Name]] — [brief description, source]
- NEW-ITEM: [[Name]] — [brief description, source]
- UPDATE: [[Existing Entity]] — [what changed, source]

## Unresolved Items

- [ ] [Item 1 — what we don't know and why]
- [ ] [Item 2]

## Source Material Index

| Source | Classification | Canon Value |
|---|---|---|
| [filename] | [type] | [AUTHORITATIVE/DRAFT/NOT CANON] |
```

## Reconstruction Note Format

Always include at the top of synthesized Play Notes. This tells
session-wrapup (and future readers) that this is reconstructed
content, not live capture.

```markdown
> [!info] Reconstruction Note
> Reconstructed from:
> - old-session-notes.md (play fragments, scenario prep)
> - keeper interview (5 questions, 3 follow-ups)
> on 2026-04-22.
>
> Limitations: No play transcript exists. Events reconstructed
> from prep documents and keeper memory. 2 items remain
> unresolved (see Unresolved Items below).
```

## Synthesis Rules

1. **Only confirmed events.** Nothing from DRAFT or NOT CANON
   sources unless the keeper confirmed it in Phase 4.

2. **Cite everything.** Every play event must be traceable to
   a source: "play fragment in old-notes.md", "keeper interview
   Q3", "existing timeline entry".

3. **Preserve uncertainty.** If the keeper said "I think so,"
   include the event but mark with `<!-- UNVERIFIED -->`.

4. **Entity flags are for session-wrapup.** Use the extraction
   shorthand from `session-wrapup/references/recap-formats.md`
   (NEW-NPC, NEW-LOC, UPDATE, etc.) so wrapup knows what to
   create and update.

5. **Chronological order.** Events within a scene are ordered
   as they happened. Scenes are ordered as they played.

6. **Scene-by-scene when possible.** If the source material or
   keeper interview reveals a scene structure, use it. If not,
   organize by topic or entity cluster.
