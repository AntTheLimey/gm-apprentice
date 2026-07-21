> **Historical.** The crosswalk/sidecar approach described below is retired. Per-note `mobrpg:` frontmatter nodes are the sole id source; unlinked vaults are established with `mobrpg adopt` (live name-match). This document is kept for provenance.

# Red-team prompt — audit the mobRPG CLI / Pillar 3 foundation before building the skill

> Paste the block below into a fresh session (after a context clear) to adversarially
> audit everything built so far, so the wrapping mobRPG skill is built on solid ground.
> Audit-only: it finds and reports flaws, it does not fix them.

```
Red-team the entire mobRPG CLI / Pillar 3 foundation on the gm-apprentice `mobrpg-cli`
branch BEFORE we build the wrapping mobRPG skill. Goal: find every correctness,
data-safety, security, and idempotency flaw now, so the skill is built on solid ground.
This is an adversarial audit, not a feature task — try to BREAK it.

FIRST, orient (do this before touching code):
- Read the memory `gm-apprentice-mobrpg-cli` for repo/branch context.
- This work lives in a SEPARATE repo (`~/PROJECTS/gm-apprentice`) on the unmerged
  `mobrpg-cli` branch, which is gitignored on main. Do NOT `git checkout mobrpg-cli` in
  the shared tree — use the worktree. Confirm with `git worktree list`; it should be at:
  /private/tmp/claude-501/-Users-antonypegg-PROJECTS-game/c5ee4301-1841-4c8f-9a52-77c066ffe518/scratchpad/gmapp-mobrpg-cli
  If gone, recreate with `git worktree add <that path> mobrpg-cli`. Invoke
  superpowers:using-git-worktrees.
- All CLI code is under docs/prototypes/mobrpg/ ; plugin schema under skills/shared/ +
  .claude-plugin/. Read docs/prototypes/mobrpg/CLI-HANDOFF.md and
  PILLAR3-WRITEBACK-DESIGN.md and COMPLETE-SUGGESTIONS-SPEC.md for design intent.
- Baseline: `.venv/bin/python -m pytest -q` from docs/prototypes/mobrpg must show 101
  passing before you start. Confirm it, then keep it green if you write any probe tests.

SCOPE — audit the WHOLE foundation, not just the last feature:
  node.py (round-trip + text-surgery), suggest.py (build_node / write_back /
  determined_for / element_spec / classifier resolution / relationship reification /
  chunker), pull_canon.py (apply_state 5-state authority rule / _fetch_live / scaffold /
  _scaffoldable guard), backfill.py, cli.py wiring, client.py (token handling, prod-write
  guard, _request), map_cmd.py, submit_batch, and the crosswalk data. Also the plugin
  schema (entity-schema.md node doc vs node.py reality; 1.8.23 migration).

ATTACK SURFACES to hammer (find inputs → wrong output / data loss / leak):
- Node round-trip contract: does read_node(write_node(text,node))==node hold on nasty
  real frontmatter? CRLF, tabs, trailing whitespace on fences, multi-doc `---`, a hand
  key literally named or containing "mobrpg", flow-style values, colons/`#`/quotes/emoji
  in values, empty/None/[] fields, a pre-existing malformed mobrpg block. Try to make it
  corrupt a NON-mobrpg byte.
- --execute / dry-run safety: prove NO write path (vault file OR API POST) escapes without
  --execute, and prod POSTs need MOBRPG_ALLOW_PROD_WRITES=1. Hunt for any leak.
- Idempotency: does re-running suggest --write-back / pull-canon / backfill converge, or
  can it thrash (rewrite unchanged files, flip review_state, duplicate elements)?
- The seam class that already bit us: pull-canon scaffolding junk files for refs that
  aren't notes. The `rel/` case was fixed via `_scaffoldable` — VERIFY that fix holds and
  hunt for SIBLINGS (other externalRef shapes suggest emits that pull-canon could
  mishandle: classifier refs `-`, land-feature refs, item refs, namespace edge cases).
- Data loss: write_back resets element_id→null on authored-content change; apply_state
  branches; deleted/dismissed handling. Can an accepted linkage be silently destroyed, or
  a real vault file overwritten/clobbered? Confirm the no-clobber guard is airtight.
- Security: is the user's prod API token ever logged, written to a file, put in an error
  message, or included in batch JSON / push_out artifacts? Check client.py error paths and
  every `print`/`json.dump`.
- Crosswalk + map correctness: unmapped kinds, missing worldId, name-collision in _key
  matching, backfill's unused `<world>` positional (mismatch risk).
- The KNOWN DEFERRED items — do NOT just re-report them; PRESSURE-TEST whether they're
  actually safe: (a) _fetch_live leaves determined/name/kind empty → authority rule is
  effectively 2-state and Tier-B scaffolds default to type:npc/Person/path-name; (b)
  write_back element_id→null on content change. Are these truly recoverable/harmless, or
  can a realistic GM workflow (suggest → accept → edit vault → re-suggest before
  pull-canon) produce duplicates or orphaned canon? Build the concrete failure sequence if
  one exists.

CONSTRAINTS:
- READ-ONLY / dry-run only. NO `--execute` against a real world without my explicit
  go-ahead. Live read-only smokes may use the token at
  ~/PROJECTS/gm-apprentice/docs/prototypes/mobrpg/credentials.csv
  (`grep '^AccessToken,' … | cut -d, -f2` → export MOBRPG_TOKEN). Live world = "Regency
  Cthulhu" 4b07d8dd-3da2-45fc-9ec5-6a45d21f1adb ; vault ~/Documents/CTHULHU/Canticle.
  Prove read-only (snapshot vault .md mtimes before/after).
- Any probe scripts go in scratchpad, not the repo. Don't push. Don't weaken existing
  tests.

APPROACH: this is a good fit for parallel adversarial agents — consider dispatching
several red-teamers with distinct lenses (round-trip/text-surgery, --execute-safety &
idempotency, security/token-leak, seam/scaffold correctness, deferred-item exploitation),
each trying to REFUTE "this is safe to build on," then verify each finding independently
before reporting. Use a workflow if you want the fan-out. (If you want the multi-agent
version, say "ultracode" / "use a workflow".)

DELIVERABLE: a prioritized findings report — each finding with file:line, a concrete
repro (inputs → wrong result), severity, and whether it's MUST-FIX-before-skill vs
safe-to-defer. End with an explicit GO / NO-GO verdict on whether the foundation is solid
enough to build the mobRPG skill on, and if NO-GO, the minimal fix set required. Do not
fix anything yet — audit first, then we decide the fix plan together.
```
