// mobRPG CLI — autonomous release-blocker fix workflow.
// Run from a fresh session with: Workflow({ scriptPath: "<this file>" })
// DEV ARTIFACT — the Finalize phase notes it should be deleted before release.
//
// Structure: parallel EDIT agents own disjoint files (no git races) -> a
// sequential INTEGRATE agent verifies the full suite and commits each phase ->
// an adversarial RE-REVIEW loop runs until two consecutive clean passes.
// Hard stops (no push, no prod writes, no Fable) are in RULES, given to every agent.

export const meta = {
  name: 'mobrpg-fix-release-blockers',
  description: 'Fix every finding in tools/mobrpg/RELEASE-BLOCKERS.md and get the mobrpg-cli branch shippable (verified + re-reviewed clean). Never pushes.',
  phases: [
    { title: 'Setup', detail: 'verify worktree+venv, confirm 321 baseline, read the punch-list' },
    { title: 'Fix-blockers', detail: '5 opus agents, TDD, file-disjoint ownership' },
    { title: 'Integrate-1', detail: 'full suite green + commit phase 1' },
    { title: 'Packaging', detail: 'ontology into package + lazy load + wheel smoke test', model: 'opus' },
    { title: 'Mechanical', detail: 'dead scripts, gitignore, windows test (cheap models)' },
    { title: 'Docs', detail: 'README/SKILL/CHANGELOG rewrite + prod-guard doc scrub' },
    { title: 'Verify', detail: 'all CI gates + skill-creator if skills changed' },
    { title: 'Re-review', detail: '4 hostile opus reviewers, loop until clean (cap 3)' },
    { title: 'Finalize', detail: 'statuses, version bump, memory, summary — NO push' },
  ],
}

const WT = '/private/tmp/claude-501/-Users-antonypegg-PROJECTS-game/c5ee4301-1841-4c8f-9a52-77c066ffe518/scratchpad/gmapp-mobrpg-cli'
const MP = WT + '/tools/mobrpg'

const RULES = `You are a subagent working on the gm-apprentice mobRPG CLI, branch \`mobrpg-cli\`.
WORKTREE: ${WT}
PACKAGE:  ${MP}
Authoritative work list: ${MP}/RELEASE-BLOCKERS.md (read it; every finding has a repro command).

HARD STOPS (never violate):
- NEVER \`git push\` or open a PR.
- NEVER make a live write to Tim's mobRPG world. All work is code; all tests are mocked/dry-run.
  Never set MOBRPG_ALLOW_PROD_WRITES, never run a verb with --execute against prod.
- NEVER force-push or rewrite history. Origin/mobrpg-cli is at 84a3abb; local is a fast-forward.

ENV:
- Run tests: cd ${MP} && PYTHONPATH=. .venv/bin/python -m pytest -q  (321 pass baseline).
- If git says "not a git repository": printf 'gitdir: /Users/antonypegg/PROJECTS/gm-apprentice/.git/worktrees/gmapp-mobrpg-cli\\n' > ${WT}/.git ; then git -C ${WT} restore .
- If the venv is broken (missing pyvenv.cfg / pytest): python3.14 -m venv ${MP}/.venv && ${MP}/.venv/bin/python -m pip install "pytest>=7".

PRE-BAKED DECISIONS (do not deviate, do not ask):
- "verbs are native" overclaim -> REWORD honestly (native verbs + documented legacy fallbacks). Do NOT port the 7 fallback verbs; just keep them working.
- Prod-write guard was intentionally removed -> SCRUB the MOBRPG_ALLOW_PROD_WRITES promise from docs (README/SKILL/push.md). Keep the banner. Do not re-add the guard.
- Packaging: move gm-apprentice-ontology.json INTO the mobrpg/ package, load via importlib.resources, make the load LAZY (a missing file affects only \`map\`, not the whole CLI). Update pyproject package-data.
- pyproject version stays the package's own; add a comment it's independent of the marketplace plugin version; add a \`--version\` flag.
- README rewrite = user docs from scratch. Solo-project voice ("I", never "we"). Delete all private resume notes.

STYLE: TDD every code fix (write the failing test first, confirm it fails, then fix, confirm it passes). Commits (only where instructed) are terse sentence-case, no AI/Claude mentions, no Co-Authored-By. Keep the branch a clean fast-forward.`

const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    newFindings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          severity: { type: 'string', enum: ['blocker', 'integrity', 'should-fix', 'minor'] },
          file: { type: 'string' },
          line: { type: 'integer' },
          summary: { type: 'string' },
          repro: { type: 'string' },
          confirmed: { type: 'boolean' },
        },
        required: ['severity', 'file', 'summary', 'confirmed'],
      },
    },
    note: { type: 'string' },
  },
  required: ['newFindings'],
}

// ---------- Phase 0: Setup ----------
phase('Setup')
const setup = await agent(RULES + `
PHASE 0 — SETUP. Do exactly this and report:
1. Confirm the worktree + venv are healthy (restore per RULES if not).
2. Run the full test suite; confirm 321 pass (report the actual number).
3. Read ${MP}/RELEASE-BLOCKERS.md and list the finding IDs you see (B1..B9 + should-fix + minor).
Make NO code changes. Return a short status: venv ok?, baseline test count, finding IDs present.`,
  { label: 'setup', phase: 'Setup', model: 'opus' })
log('Setup: ' + String(setup).slice(0, 400))

// ---------- Phase 1: Fix blockers (parallel, file-disjoint, opus, NO git) ----------
phase('Fix-blockers')
const OWNERS = [
  { k: 'md', files: 'mobrpg/md.py + tests/test_md.py',
    task: 'B1: underscore-italic (_..._) matches intraword; apply CommonMark intraword-underscore rules so snake_case / file_name / URLs are NOT italicized (only whitespace/punctuation-flanked _ emphasize). Also fix table cells to honor escaped \\| (split on unescaped |, unescape \\| in cells).' },
  { k: 'node', files: 'mobrpg/node.py + tests/test_node.py',
    task: 'B4: _split_frontmatter misclassifies a no-frontmatter note that opens with a --- thematic break and has a later --- (it splices the mobrpg: block into prose). Only treat as frontmatter when the opening line is exactly ---/---\\r AND the note is not a lone leading thematic break. Also make emit_node match the file dominant line ending (avoid mixed EOLs).' },
  { k: 'suggest', files: 'mobrpg/commands/suggest.py, mobrpg/commands/map_cmd.py + tests/test_suggest*.py, tests/test_map.py',
    task: 'B2: suggest._read uses banned str.split("---",2) -> ValueError; replace with node._split_frontmatter (or length-guarded). B3: the sex classifier name bypasses classifier_name() at suggest.py build/push and map_cmd build_map (~line 474) -> run classifier_name(...).title() at BOTH sites so markup cannot leak upstream. Pagination: discover / discover_race_id hardcode ?size=500 with no totalPages handling -> paginate like adopt.py:42 (or at least warn on a full page). Do NOT touch the ontology-load code (that is the Packaging phase).' },
  { k: 'merge3', files: 'mobrpg/merge3.py (+ a pull_desc integration test) + tests/test_merge3.py',
    task: 'merge3 uses splitlines()+"\\n".join which silently converts CRLF->LF on the canon-merge path (section.py preserves CRLF; merge3 throws it away). Preserve the dominant line ending through the merge. Add CRLF base/ours/theirs tests, plus a one-sided multi-line deletion and a both-sides multi-line conflict test.' },
  { k: 'client', files: 'mobrpg/client.py, mobrpg/config.py, mobrpg/commands/auth.py + tests/test_client*.py, tests/test_config.py, tests/test_auth.py',
    task: 'Transport has ZERO coverage: add tests that patch urllib.request.urlopen and assert (a) the outgoing Request carries Authorization: Bearer <tok>, (b) URLError -> ApiError(status=0), (c) empty 200 body decodes to None. config.write(): make it atomic and set 0600 BEFORE writing (temp+rename, or chmod pre-write) so a pre-existing loose-perm file has no world-readable window. auth status: warn when MOBRPG_TOKEN is set (it overrides the config the status reads).' },
]
await parallel(OWNERS.map((o) => () => agent(RULES + `
PHASE 1 — FIX (TDD). You EXCLUSIVELY own these files: ${o.files}. Touch NOTHING else.
${o.task}
Write the failing test(s) first, confirm they fail, implement the fix, confirm they pass by running ONLY your own test file(s) (e.g. .venv/bin/python -m pytest tests/test_${o.k}*.py -q).
Do NOT run git add/commit (a later step commits). Do NOT run the full suite. Return: files changed, tests added, and your test result.`,
  { label: 'fix:' + o.k, phase: 'Fix-blockers', model: 'opus' })))

// ---------- Phase 1 integrate: full suite + commit ----------
phase('Integrate-1')
const integ1 = await agent(RULES + `
PHASE 1 INTEGRATE. All five fix agents have edited their files. Now:
1. Run the FULL suite (PYTHONPATH=. .venv/bin/python -m pytest -q). If anything fails due to cross-file interaction, fix it minimally.
2. When green, git add the changed source+test files and commit: "Fix mobRPG data-corruption and transport blockers (B1-B4 + transport/merge3/config)".
Return the pass count and the commit sha.`,
  { label: 'integrate-1', phase: 'Integrate-1', model: 'opus' })
log('Integrate-1: ' + String(integ1).slice(0, 300))

// ---------- Phase 2: Packaging (sequential, opus) ----------
phase('Packaging')
const pkg = await agent(RULES + `
PHASE 2 — PACKAGING (B5). The CLI breaks on a wheel install because map_cmd loads gm-apprentice-ontology.json (outside the package) at import time and cli.py imports map_cmd unconditionally.
1. Move gm-apprentice-ontology.json (and the export .md if loaded at runtime — check) INTO the mobrpg/ package; load via importlib.resources; make the load LAZY (module import must not read the file; only \`map\` and callers that need it do). A missing file may raise only when \`map\` runs, not at import.
2. Update pyproject.toml package-data/MANIFEST so the JSON ships in the wheel. Add a pyproject comment that its version is the package's own (independent of the 1.9.0 marketplace plugin). Add a \`--version\` flag to the CLI (mobrpg --version).
3. VERIFY: build a wheel (python -m build --wheel), install it into a fresh clean venv, and from /tmp run \`mobrpg whoami\` and \`mobrpg map --help\` — both must NOT FileNotFoundError. Confirm all 7 fallback verbs still resolve their scripts.
4. Run the full test suite green, then commit: "Package ontology as package-data + lazy load; fix wheel install; add --version".
Return the wheel smoke-test result and the commit sha.`,
  { label: 'packaging', phase: 'Packaging', model: 'opus' })
log('Packaging: ' + String(pkg).slice(0, 300))

// ---------- Phase 3: Mechanical (parallel, cheap models, NO git) ----------
phase('Mechanical')
const MECH = [
  { k: 'deadcode', model: 'sonnet',
    task: 'B7: delete the dead scripts mobrpg-relative etl_extract.py and push_suggestions.py (unreferenced by any verb/import). KEEP smoketest.py (the live fallback scripts do `import smoketest as api`). Verify nothing imports the deleted files.' },
  { k: 'gitignore', model: 'haiku',
    task: 'Add extract.json (the documented default `pull` output) to tools/mobrpg/.gitignore. Leave the existing entries.' },
  { k: 'wintest', model: 'sonnet',
    task: 'Add a test for the config.py os.name=="nt" credential-write branch (monkeypatch os.name / or skipif) so the Windows path is exercised. Owns only tests/test_config.py additions — coordinate: if the client-phase already changed test_config.py, ADD a new test function, do not rewrite.' },
]
await parallel(MECH.map((m) => () => agent(RULES + `
PHASE 3 — MECHANICAL. ${m.task}
Do NOT run git add/commit. Return what you changed.`,
  { label: 'mech:' + m.k, phase: 'Mechanical', model: m.model })))
const integ3 = await agent(RULES + `
PHASE 3 INTEGRATE. Run the full suite green, then git add + commit the mechanical changes: "Remove dead scripts, ignore coverage/extract artifacts, cover Windows cred path". Return pass count + sha.`,
  { label: 'integrate-3', phase: 'Mechanical', model: 'sonnet' })
log('Mechanical: ' + String(integ3).slice(0, 200))

// ---------- Phase 4: Docs (parallel; opus prose, sonnet edits, NO git) ----------
phase('Docs')
const DOCS = [
  { k: 'readme', model: 'opus',
    task: 'B8: rewrite tools/mobrpg/README.md as user-facing docs from scratch — Install (pip install -e), Auth (mobrpg auth import <credentials.csv>, one-URL download), a verb overview, and env/target notes. Solo-project voice ("I", never "we"). Remove ALL private resume notes and the self-contradictory crosswalk lines. It must match the shipped CLI (cli.py NATIVE/FALLBACK verbs), not the prototype.' },
  { k: 'skill', model: 'opus',
    task: 'B9: reconcile skill/SKILL.md + skill/references/*.md — they hardcode .venv/bin/mobrpg which the documented install never creates. Make the run convention match the real install (bare `mobrpg` after `pip install -e`, or document creating the venv). Also scrub the MOBRPG_ALLOW_PROD_WRITES guard promise from SKILL.md and references/push.md (guard was intentionally removed; keep the banner).' },
  { k: 'changelog', model: 'sonnet',
    task: 'Reframe the CHANGELOG [1.9.0] section to be HONEST: it is a partial strangler (native verbs PLUS documented legacy fallbacks), not "all verbs native". Remove any "installable"/"native/excised" overclaim that the fixes did not make true. Do not touch other versions. Also scrub the prod-write-guard promise from README auth section if present.' },
]
await parallel(DOCS.map((d) => () => agent(RULES + `
PHASE 4 — DOCS. ${d.task}
Do NOT run git add/commit. Return what you changed.`,
  { label: 'docs:' + d.k, phase: 'Docs', model: d.model })))
const integ4 = await agent(RULES + `
PHASE 4 INTEGRATE. Run markdownlint on the CI globs (see .github/workflows/lint.yml) over the changed docs and fix any violations, then git add + commit: "Rewrite mobRPG README/skill docs as user-facing; honest CHANGELOG; scrub removed prod-guard". Return sha.`,
  { label: 'integrate-4', phase: 'Docs', model: 'opus' })
log('Docs: ' + String(integ4).slice(0, 200))

// ---------- Phase 5: Verify all gates ----------
phase('Verify')
const verify = await agent(RULES + `
PHASE 5 — VERIFY EVERYTHING. Run and report each gate pass/fail with the actual output tail:
1. Full pytest (PYTHONPATH=. .venv/bin/python -m pytest -q).
2. CI-exact: in a fresh clean venv, pip install -e ".[test]" && python -m pytest -q.
3. Wheel smoke: build wheel, install clean, run mobrpg whoami + map --help from /tmp (must not error).
4. schema: python3 ${WT}/scripts/validate_schema.py.
5. markdownlint over the CI globs (.github/workflows/lint.yml).
6. If ANY file under skills/ changed on this branch, run skill-creator validation (CI cannot — never skip it).
If any gate fails, fix it, re-run, and commit the fix. Return a gate matrix (each gate: PASS/FAIL).`,
  { label: 'verify', phase: 'Verify', model: 'opus' })
log('Verify: ' + String(verify).slice(0, 400))

// ---------- Phase 6: Adversarial re-review loop ----------
phase('Re-review')
const REVIEWERS = [
  { k: 'security', focus: 'token leakage, 0600/0700 enforcement + atomicity, credential precedence, TLS, and whether any doc still promises a prod-write guard that the code lacks. Files: config.py, commands/auth.py, client.py, cli.py.' },
  { k: 'core', focus: 'vault-file corruption and data pushed to the shared world: md.py (underscore-italic, table pipes), node.py (frontmatter splice, EOL), section.py, merge3.py (CRLF), suggest.py + map_cmd.py (classifier sanitizer, direction, pagination, the _read parse). Reproduce each claim.' },
  { k: 'tests', focus: 'whether the new fixes are actually covered or just asserted; transport coverage; merge3 edge cases; any tautology/skip/xfail hiding a bug.' },
  { k: 'packaging', focus: 'wheel install now works for every verb (build+install+run from /tmp), no dead code left, no docs↔reality mismatch (README/SKILL/CHANGELOG/llms.txt), pyproject correctness, no secrets/junk tracked.' },
]
let cleanPasses = 0
let iter = 0
while (cleanPasses < 2 && iter < 3) {
  iter++
  const reviews = await parallel(REVIEWERS.map((r) => () => agent(RULES + `
PHASE 6 — HOSTILE RE-REVIEW (iteration ${iter}). Assume the author is sloppy and PROVE it, but every finding must be REPRODUCED against the current code — no fabrication, drop anything the code disproves. Review the net diff of this branch vs origin/main.
Focus: ${r.focus}
Return NEW findings not already resolved (JSON per schema). severity one of blocker|integrity|should-fix|minor; confirmed=true only if you reproduced it. Empty array if the area is clean now.`,
    { label: 'review:' + r.k + ':' + iter, phase: 'Re-review', model: 'opus', schema: REVIEW_SCHEMA })))
  const findings = reviews.filter(Boolean).flatMap((r) => r.newFindings || [])
  const serious = findings.filter((f) => f.confirmed && (f.severity === 'blocker' || f.severity === 'integrity'))
  log(`Re-review iter ${iter}: ${findings.length} findings, ${serious.length} confirmed blocker/integrity`)
  if (serious.length === 0) { cleanPasses++; continue }
  cleanPasses = 0
  await agent(RULES + `
PHASE 6 FIX. The re-review reproduced these confirmed blocker/integrity findings. Fix ALL of them TDD (failing test first), run the full suite green, and commit: "Address re-review findings (iteration ${iter})". Findings:
${JSON.stringify(serious, null, 2)}`,
    { label: 'refix:' + iter, phase: 'Re-review', model: 'opus' })
}

// ---------- Phase 7: Finalize (NO push) ----------
phase('Finalize')
const finalize = await agent(RULES + `
PHASE 7 — FINALIZE. Do NOT push. Then:
1. Update ${MP}/RELEASE-BLOCKERS.md: mark each finding fixed or (with reason) deferred; add a top line "All ship-blockers cleared as of <today's date via \`date +%F\`>".
2. Bump ${WT}/.claude-plugin/plugin.json version and finalize the CHANGELOG [1.9.0] section to reflect the actually-shipped, honest state (patch/minor as fits; keep it accurate). Commit these.
3. Append a dated block to the project memory file (~/.claude/projects/-Users-antonypegg-PROJECTS-gm-apprentice/memory/project_mobrpg_integration.md) recording what was fixed and that the branch is shippable-but-unpushed. Update MEMORY.md if needed.
4. Note in RELEASE-BLOCKERS.md that this workflow file (tools/mobrpg/RELEASE-FIX-WORKFLOW.js) is a dev artifact to delete before the actual release.
5. Produce a FINAL SUMMARY for the human: every finding and its resolution, the full gate matrix, the re-review verdict (clean after N iterations), the commit list (git log origin/mobrpg-cli..mobrpg-cli), and an explicit "AWAITING GO to push/PR" line.
Return that summary.`,
  { label: 'finalize', phase: 'Finalize', model: 'opus' })

return { summary: finalize, setup: String(setup).slice(0, 200) }
