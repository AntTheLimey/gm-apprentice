# Session Note Templates

Defaults for the documents session-prep writes; the vault's `_meta/`
files are authoritative once initialized. Frontmatter for every
document in the chain is in `shared/session-document-chain.md`.

## Session Index

Create it from `_Templates/_Template_Session.md` (else
`shared/templates/session.md`; frontmatter per
`shared/session-document-chain.md` §1) when the GM first plans a
session. `in_game_date` may be an array for a multi-day session.

The body is the H1 title and nothing else outside an optional
fenced `## GM Notes`. Plan and Play Notes links go in `documents:`;
the Scene Index, prep states, key prep, image prompts and any
pre-play premise go in the Plan. A played session's
hub publishes its body until the Wrap-Up does, so prep written there
reaches the players.

## Reading the last Wrap-Up

Structure: `shared/templates/session-wrap.md`. Read
`### Handoff to session-prep` first, then `### What Carries Forward`
and `### World State` (all under the fenced `## GM Notes`). The
`## Narrative Recap` is the player-facing record — use it, never
regenerate it.

## Session Plan

Its shape is the skill's **Plan shape**; the GM-facing blank is
`shared/templates/session-plan.md` (provisioned as
`_Templates/_Template_Session_Plan.md`). Archived after play, never
deleted.
