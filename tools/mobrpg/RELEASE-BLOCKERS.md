# mobRPG CLI — release blockers & punch-list

**All ship-blockers cleared as of 2026-07-25.** A second round of issues
(#140-#153, mostly found in `sync`/`suggest` after the LWW rework) was fixed
on `mobrpg-release-fixes` — see the dated disposition list below.

**Status:** v1.9.0 was **pulled** on 2026-07-25, then repaired. Every finding
below is now marked **FIXED** or **DEFERRED (with reason)**. The wheel installs
and runs, and the "graduated / native / installable" claims have been reworded
to the honest mid-strangler reality.

**Branch state (verified 2026-08-11):** `git rev-list --left-right --count
mobrpg-cli...origin/mobrpg-cli` → `0 0` — `mobrpg-cli` and `origin/mobrpg-cli`
are in sync; the "branch is unpushed" claim below is stale. The current work
(#140-#153) is on `mobrpg-release-fixes`, cut from `mobrpg-cli`, and is not yet
merged back or pushed. Awaiting a human GO to push/PR that branch.


**How this list was produced:** a four-way adversarial code review of the whole
`mobrpg-cli` branch (security, data-mutation core, test quality, packaging), with
every headline finding reproduced by hand against the source. Line numbers are as
of the review; re-confirm before fixing.

**What is already done on the branch (do not redo):**

- Merged `main` (publish-site onboarding Slices 1–5) into `mobrpg-cli`.
- Fixed 26 markdownlint violations in the prototype docs.
- Moved the package `docs/prototypes/mobrpg/` → `tools/mobrpg/` and updated every
  path reference.
- Added a pytest CI job (`.github/workflows/mobrpg-cli-ci.yml`, ubuntu+macos,
  py3.10/3.12) — verified green via a clean editable install.

---

## 🔴 Ship-blockers — corrupt a collaborator's production world, or crash

These push malformed data into Tim's shared mobRPG world, or abort a run. Fix
with TDD (add the failing case first).

### B1. `mobrpg/md.py:51` — underscore-italic mangles descriptions with `_`

**✅ FIXED** (78b1659) — `_` emphasis now requires flanking whitespace/punctuation
(CommonMark intraword rule); `snake_case`/`file_name`/URLs survive. Test in
`tests/test_md.py`.


`_ITALIC` matches `_(...)_` intraword, so `snake_case`, `file_name`, and URLs get
spurious `<em>`. `_description()` feeds this HTML straight into
`_create(description=...)` against the live world.

Repro:

```bash
python -c "from mobrpg import md; print(md.md_to_html('snake_case_ident'))"
# <p>snake<em>case</em>ident</p>
```

Fix: apply CommonMark intraword-underscore rules (require whitespace/punctuation
flanking for `_` emphasis), or only honor `_…_` when delimited.

### B2. `mobrpg/commands/suggest.py:29` (`_read`) — banned `str.split("---", 2)`

**✅ FIXED** (78b1659) — now reuses `node._split_frontmatter`; a note opening with
`---` and no closing fence no longer raises `ValueError`/aborts the run, and
`--- inline ---` notes parse. Test in `tests/test_suggest.py`.


The exact pattern `node.py`'s own comment warns against, on the read path. A note
starting with `---` and no closing fence raises `ValueError: not enough values to
unpack` and aborts the whole `suggest` run; `--- inline ---` notes are misparsed.

Repro: run `suggest._read` on a file whose content is `"---\nx\n\nbody\n"`.

Fix: reuse `node._split_frontmatter`, or guard the unpack length.

### B3. `mobrpg/commands/suggest.py:279` + `mobrpg/commands/map_cmd.py:474` — `sex` classifier bypasses the sanitizer

**✅ FIXED** (78b1659) — the sex name runs through `classifier_name(...)` at both
the build and push sites; markup can no longer leak into a pushed name. Tests in
`tests/test_suggest.py` and `tests/test_map.py`.


`build_map` stores `name: v.title()` and `classifier_items` pushes it verbatim,
skipping `classifier_name()` that every other classifier uses. Markup leaks
upstream and the vault `determined` block disagrees with the pushed name.

Repro: gender `"male [[note]]"` → pushed `CreateElement` name `"Male [[Note]]"`.

Fix: run `classifier_name(...).title()` on the sex name at build and push sites.

### B4. `mobrpg/node.py` (`_split_frontmatter`) — machine block spliced into prose

**✅ FIXED** (78b1659; hardened fa7e48b) — frontmatter is recognized only when the
opening line is exactly `---`/`---\r` and the note is not a lone leading thematic
break, so `write_node` no longer injects the `mobrpg:` block into prose. A related
fence-newline gluing bug (`---## Overview`) was also fixed. Tests in
`tests/test_node.py`.


A note with **no** YAML frontmatter whose body opens with a `---` thematic break
and has a later `---` is misclassified as having frontmatter; `write_node` then
injects the `mobrpg:` block into the prose region. Reachable via
`suggest --write-back --execute` and `pull-canon` (both collect untyped notes).

Repro: `node._split_frontmatter("---\n\nIntro.\n\n---\n\nBody.\n")` returns a
non-None span capturing `Intro.` as frontmatter.

Fix: only treat as frontmatter when the opening line is exactly `---`/`---\r` and
the note is not a lone leading thematic break.

---

## 🟠 Release-integrity — the "installable / native / graduated" claims are false

### B5. Wheel install breaks 100% of the CLI

**✅ FIXED** (c980a54) — `gm-apprentice-ontology.json` moved under `mobrpg/`, loaded
lazily via `importlib.resources`; `pyproject.toml` package-data updated. A missing
ontology now degrades only the `map` verb. Verified by `tests/test_packaging.py`
(builds/loads without a local source tree).


`map_cmd.py:50` runs `_ONTOLOGY = _load_ontology()` at **import time**, reading
`gm-apprentice-ontology.json` which lives *outside* the package and is excluded by
`pyproject.toml` `include = ["mobrpg*"]`. `cli.py:24` imports `map_cmd`
unconditionally, so **every** verb (`whoami`, `auth`, …) dies with
`FileNotFoundError` under a non-editable install. Only `pip install -e` hides it.

Repro: `python -m build --wheel`, install the wheel in a clean venv, run
`mobrpg whoami` from any directory without a local `mobrpg/` package.

Fix: ship the JSON as package data (move it under `mobrpg/` and load via
`importlib.resources`), and/or make the ontology load lazy so a missing file only
affects `map`, not the whole CLI.

### B6. CHANGELOG "verbs are native / crosswalk excised" oversells — 7 verbs still shell out

**✅ FIXED** (081a2f5 reword; 761d0dd relocate) — per the pre-baked decision the 7
fallbacks were **kept working, not ported**. The overclaim is reworded honestly in
README, `skill/SKILL.md`, and CHANGELOG ("native verbs plus documented legacy
fallbacks"). The fallback scripts were also moved into `mobrpg/_legacy/` so they no
longer inherit the B5 packaging break.


`cli.py` `FALLBACK` subprocesses legacy scripts for `write`, `merge`,
`link-orphans`, `push`, `types`, `links`, `images`. It's a mid-strangler. Either
finish the port or reword the release notes to match reality. Those 7 fallbacks
also inherit the B5 packaging break.

### B7. Two dead scripts shipping as ballast

**✅ FIXED** (de44872) — `etl_extract.py` and `push_suggestions.py` deleted.
`smoketest.py` kept (now `mobrpg/_legacy/smoketest.py`) because the 4 live fallback
scripts `import smoketest as api`.


`etl_extract.py` (superseded by `pull.py`) and `push_suggestions.py` (superseded by
`suggest.py`) are unreferenced by any verb or import. Delete them. (`smoketest.py`
is **not** dead — the 4 live fallback scripts do `import smoketest as api`.)

### B8. `tools/mobrpg/README.md` is the internal prototype scratch log

**✅ FIXED** (081a2f5) — README rewritten from scratch as user-facing docs in
solo-project voice ("I", never "we"); all private resume/spike notes removed; the
sidecar-crosswalk self-contradiction is gone. The retired `import smoketest as api`
/ `python3 smoketest.py` auth model is no longer documented.


"START HERE / Spike work", private resume notes ("Don't PR the Hibernate fix",
"backend repro env: torn down"), and it self-contradicts ("rewire to the sidecar
crosswalk" vs "there is no sidecar crosswalk"). Rewrite as user-facing docs before
any release. Also `README.md`'s Auth section documents the retired
`import smoketest as api` model and a non-existent `python3 smoketest.py` check.

### B9. `skill/SKILL.md` (and every `skill/references/*.md`) hardcode `.venv/bin/mobrpg`

**✅ FIXED** (081a2f5) — the skill docs now use the installed `mobrpg` command that
`pip install -e` puts on PATH; no `.venv/bin/mobrpg` references remain
(`grep -rn '\.venv/bin/mobrpg' skill/ README.md` → empty).

The documented install (`llms.txt:11`, `pip install -e`) never creates a `.venv/`,
so every command the skill emits fails for a fresh user. Reconcile the skill's run
convention with the actual install path.

---

## 🟡 Should-fix

- **✅ FIXED** (081a2f5) **Prod-write guard docs mismatch.** Per the pre-baked
  decision the guard was **not** re-added; the `MOBRPG_ALLOW_PROD_WRITES` promise is
  scrubbed from `README.md`, `skill/SKILL.md`, and `skill/references/push.md`
  (`grep -rn MOBRPG_ALLOW_PROD_WRITES README.md skill/` → empty). The safety banner
  stays.
- **✅ FIXED** (78b1659) **HTTP transport test coverage.** `tests/test_client.py`
  now patches `urllib.request.urlopen` and asserts the `Authorization: Bearer`
  header, the network-down `ApiError(0)` path, and the empty-200-body → `None`
  decode.
- **✅ FIXED** (78b1659) **`merge3` CRLF preservation** — the canon-merge path now
  preserves the dominant line ending instead of converting CRLF→LF. Test in
  `tests/test_merge3.py`.
- **✅ FIXED** (78b1659, ef6ba76) **`md.py` escaped `\|` in table cells** — cells
  split on unescaped pipes only. Test in `tests/test_md.py`.
- **✅ FIXED** (78b1659) **`?size=500` pagination** — `map` and `suggest` now fetch
  every page via a shared paginating fetcher instead of the old single `?size=500`
  call, so a world with >500 of a kind can no longer mint duplicate types.

---

## ⚪ Minor

- **✅ FIXED** (78b1659) `config.write()` now writes to a `0600` temp file via
  `mkstemp` and `os.replace`s it into place (atomic, no world-readable window).
- **✅ FIXED** (78b1659) `auth status` now warns when `MOBRPG_TOKEN` is set in the
  environment and overrides the imported identity it displays.
- **✅ FIXED** (c980a54) `pyproject.toml` `version = "0.1.0"` carries a comment that
  it is intentionally decoupled from the plugin version, and `mobrpg --version`
  reports it at runtime.
- **✅ FIXED** (de44872) `.gitignore` now ignores `extract.json` (and generic
  `*_out/`, `sync_reports/`). Two author-specific `space_*` entries were left in
  deliberately as belt-and-suspenders for existing local artifacts — harmless.
- **✅ FIXED** (de44872) Windows credential-write branch now tested
  (`tests/test_config.py::test_config_dir_windows_appdata`).
- **DEFERRED** — `emit_node` joins with `\n`, so a `mobrpg:` block written into a
  CRLF file yields mixed EOLs. Explicitly noted in the original review as
  **tolerated, not corrupting**; left as-is to keep the release scoped to the
  data-corruption blockers.

---

## ✅ Verified solid (don't re-litigate)

- `node`/`section` body preservation for **properly-fenced** notes — a body
  containing `---`, `| --- |`, `## Notes` survives verbatim.
- `section.canon_section` round-trip (`reinsert(region) == body`), CRLF tail
  preserved.
- `merge3` auto-merge / conflict resolution correctness (no drop/duplicate) — the
  only gap is CRLF (above) and toy-only unit tests.
- `chunk_groups_colocated` defers and **reports** oversized components (never
  silently drops); cross-group refs are `_needs`-tagged.
- `dedupe_type_creates` + `REVERSED_PREDICATES` container-first direction —
  consistent and behaviorally tested.
- `0600`/`0700` perm tests genuinely `os.stat`. TLS verification intact, 30s
  timeouts, tokens redacted from URLs, no token printed on traced paths, no
  `shell=True`/`eval`/`exec`, no secrets anywhere in branch history.

---

## 🔁 Sync-model rework — 2026-07-26 (supersedes the canon-boundary machinery)

The last-writer-wins sync rework of 2026-07-26 replaced the hash/baseline canon
boundary this punch-list was written against. Several entries above are now
**historical** — they describe a state the branch no longer occupies:

- **The mid-strangler framing is obsolete.** Every verb is now a native Python
  subcommand. The `FALLBACK` shell-out layer and all legacy prototype scripts
  (`smoketest.py`, `etl_extract.py`, `push_suggestions.py`, and the shelled-out
  `write`/`merge`/`link-orphans`/`push`/`types`/`links`/`images` scripts) are
  deleted. So the "native verbs plus documented legacy fallbacks" wording (B6),
  the retained-`smoketest.py` note (B7), and the top-of-file status block's
  "mid-strangler reality" / 373-test count no longer describe the branch —
  `link-orphans` in particular is now native and files suggestions rather than
  emitting a generated curl script.
- **The canon-boundary machinery is gone.** `merge3`, the canon fence,
  `content_hash` + the four `canon_*` node scalars, and the `pull-desc` /
  `suggest-desc` verbs were deleted. The `sync` verb replaces all of it with a
  timestamp last-writer-wins decision (skip / pull / push / tie) per note. Where
  entries above reference `merge3` (Should-fix CRLF item, Verified-solid
  auto-merge item) or `pull-desc` (Fixed frontmatter-hardening item), those
  subsystems no longer exist.
- **`SYNC-CANON-BOUNDARY-FINDINGS.md` is superseded.** Its diagnosis of the
  hash/baseline boundary is addressed by the design in
  `docs/plans/2026-07-25-mobrpg-sync-lww-design.md`, which the shipped `sync`
  verb implements. (Both files live in the author's main checkout, not this
  worktree — referenced by path only.)
- **GM Notes stay local by design.** Verification found the server's
  `NoteableService.getNote` has no hidden-note check, so `sync` never pushes the
  `## GM Notes` tail upstream until mobRPG enforces hidden-note access
  server-side.

---

## 🔧 Second fix round — 2026-08-11 (#140-#153, branch `mobrpg-release-fixes`)

A four-way adversarial review of the post-LWW-rework `sync`/`suggest` path
surfaced nine open GitHub issues. Each was fixed test-first on
`mobrpg-release-fixes` (cut from `mobrpg-cli` @ `2d1017b`). The full suite —
including these fixes' new tests — is green: `cd tools/mobrpg && python3 -m
pytest tests/ -q`. One line per issue:

- **#140 — already fixed pre-plan** (`36fc6c5`, before this plan started).
  `pull-canon`'s `_scaffoldable` rejects `rel/`/`desc/` refs and is fail-closed
  on unknown ref roots; this round added regression coverage confirming the
  guard, the NOT-SCAFFOLDED report, and correct kind/name on a scaffolded note.
- **#141 — moot.** `pull-desc` and the hash/baseline canon-boundary scalars are
  deleted; `grep -rn "canon_base_md\|canon_html_hash\|canon_synced_at\|content_hash" tools/mobrpg/mobrpg/`
  returns zero production hits.
- **#146 — fixed.** Vault-only sections generalize past `## GM Notes` to
  `## Notes`, `## Appearances`, and `## Source References` (session bookkeeping,
  not canon prose); configurable via a `vaultOnlySections` array in
  `_meta/mobrpg-map.json`; a `pull` row now prints the canon line-count it is
  about to trade so a `SHRINKS` row gets read before it's confirmed.
- **#147 — fixed.** A never-synced note (`last_synced` empty) has no LWW
  baseline, so it gets a new `baseline` verdict — content decides (match →
  stamp, empty scaffold → pull, else → stamp only) instead of manufacturing a
  push into the world owner's queue. Empty scaffold headings (`## Properties`
  with no body) are stripped from push candidates.
- **#148 — fixed.** `map sync` folds NFC/whitespace/case when matching vocab
  keys, so a casing or whitespace-only difference can no longer split one vault
  term into a stale map entry plus an unbound duplicate; collisions collapse
  with a documented priority, and `whats-new` distinguishes vocab that's
  recorded-but-unbound from genuinely new.
- **#150 — fixed.** `sync`/`suggest` send raw Markdown with
  `descriptionType: "Markdown"` instead of running every pushed description
  through the CLI's own lossy `md_to_html` converter; the drift compare still
  happens in HTML space to avoid false positives.
- **#151 — fixed.** Each filed `UpdateElement` gets its own
  `<namespace>:upd/<relpath>#<content-hash>` externalRef, separate from the
  note's create-time ref; `pull-canon` adjudicates only the row matching the
  node's `pending_ref`, so an accept→re-edit→re-push cycle no longer loses
  later updates to an already-terminal ref.
- **#152 — fixed.** `submit-batch` (shared by `suggest` and `sync`) reports
  stored / corrected-in-place / already-claimed distinctly instead of one
  aggregate "N stored" count, and names the externalRefs a terminal
  Accepted/Dismissed row silently swallowed.
- **#153 — fixed.** `pull-canon`'s main pass now checks the same live
  element-id set `--reconcile-deletions` uses and treats absence as
  authoritative, so a still-Accepted create can no longer re-stamp a dead
  `element_id` onto a node that was already correctly flagged deleted.

**Operational note before the first post-upgrade `sync --execute` against the
live world:** run dry-run first and read the pull canon-delta lines (#146
above) — confirm any `SHRINKS` row is expected before saying yes. Separately,
any description-update row filed *before* this upgrade carries the note's plain
create ref rather than an `upd/<relpath>#<hash>` one (#151). The next time that
note's push/tie decision fires, `sync` mints a fresh `upd/`-namespaced ref and
records it in the node's `pending_ref`, leaving the pre-upgrade row an orphaned,
permanent stale entry in the queue. `pull-canon` will not adjudicate the note
from that stale row: while a node holds a `pending_ref`, a row at the note's
plain create ref stands down rather than stamping a verdict the GM gave to
different content. The one exception is deletion — with the element gone no
update can ever land, so the node is still flagged `deleted`. It's a one-time
cost per such note, not an ongoing one — safe to leave, or dismiss by hand in
mobRPG.
