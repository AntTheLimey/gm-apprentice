# mobRPG CLI — release blockers & punch-list

**Status:** v1.9.0 was **pulled** on 2026-07-25. This tool is **not shippable** as
"graduated, native, installable" until the ship-blockers below are cleared.

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

The branch is **not pushed**. `origin/mobrpg-cli` is still at `84a3abb`.

---

## 🔴 Ship-blockers — corrupt a collaborator's production world, or crash

These push malformed data into Tim's shared mobRPG world, or abort a run. Fix
with TDD (add the failing case first).

### B1. `mobrpg/md.py:51` — underscore-italic mangles descriptions with `_`

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

The exact pattern `node.py`'s own comment warns against, on the read path. A note
starting with `---` and no closing fence raises `ValueError: not enough values to
unpack` and aborts the whole `suggest` run; `--- inline ---` notes are misparsed.

Repro: run `suggest._read` on a file whose content is `"---\nx\n\nbody\n"`.

Fix: reuse `node._split_frontmatter`, or guard the unpack length.

### B3. `mobrpg/commands/suggest.py:279` + `mobrpg/commands/map_cmd.py:474` — `sex` classifier bypasses the sanitizer

`build_map` stores `name: v.title()` and `classifier_items` pushes it verbatim,
skipping `classifier_name()` that every other classifier uses. Markup leaks
upstream and the vault `determined` block disagrees with the pushed name.

Repro: gender `"male [[note]]"` → pushed `CreateElement` name `"Male [[Note]]"`.

Fix: run `classifier_name(...).title()` on the sex name at build and push sites.

### B4. `mobrpg/node.py` (`_split_frontmatter`) — machine block spliced into prose

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

`cli.py` `FALLBACK` subprocesses legacy scripts for `write`, `merge`,
`link-orphans`, `push`, `types`, `links`, `images`. It's a mid-strangler. Either
finish the port or reword the release notes to match reality. Those 7 fallbacks
also inherit the B5 packaging break.

### B7. Two dead scripts shipping as ballast

`etl_extract.py` (superseded by `pull.py`) and `push_suggestions.py` (superseded by
`suggest.py`) are unreferenced by any verb or import. Delete them. (`smoketest.py`
is **not** dead — the 4 live fallback scripts do `import smoketest as api`.)

### B8. `tools/mobrpg/README.md` is the internal prototype scratch log

"START HERE / Spike work", private resume notes ("Don't PR the Hibernate fix",
"backend repro env: torn down"), and it self-contradicts ("rewire to the sidecar
crosswalk" vs "there is no sidecar crosswalk"). Rewrite as user-facing docs before
any release. Also `README.md`'s Auth section documents the retired
`import smoketest as api` model and a non-existent `python3 smoketest.py` check.

### B9. `skill/SKILL.md` (and every `skill/references/*.md`) hardcode `.venv/bin/mobrpg`

The documented install (`llms.txt:11`, `pip install -e`) never creates a `.venv/`,
so every command the skill emits fails for a fresh user. Reconcile the skill's run
convention with the actual install path.

---

## 🟡 Should-fix

- **Prod-write guard docs mismatch.** `MOBRPG_ALLOW_PROD_WRITES` exists only in
  legacy `smoketest.py`; native verbs gate on `--execute` alone (default env
  `prod`). The removal was intentional ("keep the banner") — so the fix is to
  **scrub the guard promise** from `README.md`, `skill/SKILL.md`,
  `skill/references/push.md`, or re-wire the guard if it's actually wanted.
- **HTTP transport has zero test coverage.** Every network test stubs
  `client._request`; the `Authorization: Bearer` header injection, `URLError`
  branch, and empty-200-body branch are uncovered. Add a test that patches
  `urllib.request.urlopen` and asserts the outgoing header, the `ApiError(0)`
  network-down path, and the empty-body → `None` decode.
- **`merge3` silently converts CRLF→LF** on the canon-merge path, undoing
  `section.py`'s CRLF preservation. Preserve the dominant line ending.
- **`md.py:78` table cells ignore escaped `\|`** → column-count mismatch in pushed
  tables. Split on unescaped `|`, unescape `\|` in cells.
- **`?size=500` hardcoded, no pagination** (`map_cmd.py:270`, `suggest.py:631`) — a
  world with >500 of a kind mints duplicate types. `adopt.py:42` already paginates;
  copy that. At minimum warn on a full page.

---

## ⚪ Minor

- `config.write()` truncates + writes into a pre-existing loose-perm
  `credentials.json` before `chmod` (brief world-readable window) and is
  non-atomic. Chmod/temp+rename before writing.
- `auth status` reads only the config, so it shows the imported identity while a
  stale exported `MOBRPG_TOKEN` is what commands actually use. Warn when
  `MOBRPG_TOKEN` is set.
- `pyproject.toml` `version = "0.1.0"` vs plugin `1.9.0` — document the decoupling
  or bump; no `--version` flag exists to disambiguate at runtime.
- `.gitignore` misses `extract.json` (the documented default `pull` output);
  the ignore list is full of hardcoded `space_*` author-specific names.
- Windows credential-write branch (`config.py` `os.name == "nt"`) is untested.
- `emit_node` joins with `\n`, so a `mobrpg:` block written into a CRLF file yields
  mixed EOLs (tolerated, not corrupting).

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
