# Benchmark: Document Chain Standard

**Date:** 2026-04-22
**Branch:** feature/vault-ingest
**Change:** Session document chain standard — sessions split into
Index + Plan + Play Notes + Wrap-Up as separate files. Shared
reconcile procedure. Updated all 6 skills with document chain
awareness. Benchmark campaign fixtures converted to chain format.
**Questions:** 8 (document-chain.md)
**Models:** claude-sonnet-4-6 (agents), claude-opus-4-6 (evaluator)

## Metrics

### Control (monolith prompt — session-lifecycle/SKILL.md)

- **Tokens:** 35,760
- **Time:** 2351.9s (slow — model was queued)
- **Tool uses:** 18

Note: `session-lifecycle/SKILL.md` does not exist (removed in prior
PR). The control agent fell back to reading the current split skill
files and the document chain standard. This means both control and
test agents had access to the same information. Scores below reflect
this — the comparison is not meaningful as a control/test delta.

### Test (split skills + document chain)

- **Tokens:** 30,482
- **Time:** 63.7s
- **Tool uses:** 13

## Key Findings

Both agents produced correct answers on all 8 questions, confirming
that the document chain standard is well-encoded in the skill files:

1. **Plan file frontmatter** — Both correctly identified all required
   fields and DRAFT confidence.
2. **Play Notes capture** — Both correctly identified the target file,
   session-play ownership, and AUTHORITATIVE confidence.
3. **Wrap-Up derivation** — Both correctly distinguished type, confidence,
   and created_by fields between Play Notes and Wrap-Up.
4. **Status progression** — Both produced correct frontmatter for all
   four stages (planned → prepped → played → wrap-up).
5. **Reconcile promotion** — Both correctly identified the GM approval
   gate and status/confidence changes.
6. **Missing documents** — Both cited Rule 4 (missing documents are
   normal) and the reconcile prerequisite.
7. **Ownership boundaries** — Both correctly enforced Rule 1 (no skill
   writes to a document it doesn't own).
8. **Fallback behaviour** — Both reproduced the exact session-prep
   fallback dialogue and the non-blocking choice.

## Assessment

The document chain standard is effectively encoded. Agents reading the
updated skill files consistently produce correct document-chain-aware
output. No regressions detected — the skill changes are self-consistent
and the benchmark fixtures correctly reflect the chain format.

The test agent used 15% fewer tokens and was significantly faster, likely
due to the control experiencing model queue delays rather than any
inherent efficiency difference.

## Recommendation

The control prompt for future runs should reference the current skill
entry points (not the defunct session-lifecycle/SKILL.md). A true A/B
comparison would require checking out the main branch skill files as
the control baseline.
