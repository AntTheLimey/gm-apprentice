## Open Spoilers

Not gated behind any trigger — run this section during any full QA
pass, since spoilers carry no timestamp and there's no way to compute
staleness for them.

**Procedure:** search the whole vault for `<!-- spoiler -->` markers.
For each one found, list:
- The file it's in
- The first ~15 words of the spoiler text (enough to identify it, not
  the whole spoiler)
- Whether the file's `lastUpdated`/`asOfSession` suggests it's from an
  old session (informational only — not a hard staleness rule, since
  there's no per-spoiler timestamp)

Present as a single list for GM review: "Here are your N open
spoilers — anything here that got revealed in play and just never got
unwrapped? Anything that's dead because the plot moved on and should
just be deleted rather than left pending forever?"

- Severity: **Info** (this is a review prompt, not a defect)
- No automated fix — the GM decides per spoiler whether to leave it,
  manually strip the markers (revealed), or delete the content
  (dropped plot thread)
