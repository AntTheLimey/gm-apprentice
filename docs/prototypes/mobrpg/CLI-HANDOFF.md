# mobrpg CLI — resume here (handoff for the next session)

**Branch:** `mobrpg-cli` (pushed to origin, **unmerged**). `main` keeps this whole
directory gitignored; on this branch the whole dir is tracked so the CLI and the
legacy scripts it falls back to are version-controlled together. Nothing merges to
`main` — and no plugin users are affected — until you deliberately merge.

**What this is:** a strangler-pattern port of the ~11 standalone mobRPG scripts into
one installable `mobrpg` command with subcommands over a shared client. Native verbs
call `mobrpg.commands.*`; every not-yet-ported verb shells out to its legacy `.py`
with argv passed through verbatim, so the full surface works at every step.

Durable mapping spec (tracked on this branch): `COMPLETE-SUGGESTIONS-SPEC.md` — its
"Implementation order" carries the ✅/⏳ status for the mapping/suggest/writeback work.
The original CLI design spec + plan (`docs/superpowers/{specs,plans}/2026-07-12-mobrpg-cli*.md`)
are **gitignored and were never tracked/pushed** — they exist only on local disk, and the
verb-port pattern they describe is captured in "To port the next verb" below.

## Current state (as of 2026-07-18)

Commits on the branch (base `8776e85`, newest first):

```
12b78d2 suggestions: don't crash --fetch-elements on non-JSON endpoints
268470b map: default locations to Political unless clearly a land feature
7c3432a map: tolerate non-JSON catalog responses during discovery
c3abd63 Add map command (init/sync/check) for per-vault mapping generation
0a0fd7c Wire push + pull to the shared GFM converter
458223b Spec: add map command family (init/sync/check) for mapping upkeep
94707a8 Add GFM<->HTML converter (tables, lists, links) replacing lossy md_to_html
349484f Add update verb for editing a Pending suggestion's payload (PUT)
2ee8c5b Spec: codify classifier delivery mechanisms incl. inline-by-UUID Language
231e6cc Spec: complete suggestions (discover, map-build, vault-writeback)
7e1475f Cover all element kinds in suggestions --fetch-elements map
2e6e558 Add submit-batch verb for compound suggestion batches
56e6831 Add review verb for suggestion accept/dismiss/reinstate
869d388 Add native suggestions and catalog read verbs
6a047bf Add CLI-HANDOFF resume doc and README pointer for the mobrpg-cli branch
1126302 Add llms.txt agent guide for the mobrpg CLI
2afc068 Make pull surface API errors and cover extract branches
0a796cf Port pull (world->JSON extract) to native mobrpg subcommand
aaa84b2 Port whoami/worlds to native mobrpg subcommand
f02a942 Add mobrpg CLI router with shell-out fallback and import pull_images
4488ba9 Track full mobRPG prototype dir on mobrpg-cli branch
f3bdaa4 Scaffold mobrpg package with shared client ported from smoketest
```

Package layout: `mobrpg/client.py` (was `smoketest.py`), `mobrpg/cli.py` (the manual
dispatcher), `mobrpg/md.py` (GFM↔HTML converter), `mobrpg/commands/{whoami,pull,
suggestions,catalog,review,submit_batch,update,map_cmd}.py`, `llms.txt`, `pyproject.toml`,
`tests/` (13 test modules). Legacy scripts (`etl_extract.py`, `push_to_mobrpg.py`,
`push_suggestions.py`, …) are untouched and remain the fallback targets.

| Verb | Status |
|---|---|
| `whoami` / `worlds` | ✅ native (`mobrpg/commands/whoami.py`) |
| `pull` | ✅ native (`mobrpg/commands/pull.py`) |
| `suggestions` | ✅ native — list by review state; `--correlate` maps accepted back to the vault |
| `catalog` | ✅ native — read classifier vocab (types/races/professions/languages/…) |
| `review` | ✅ native — accept / dismiss / reinstate (GM, needs write) |
| `submit-batch` | ✅ native — submit a pre-built compound batch (types+edges+relations) from JSON |
| `update` | ✅ native — replace a Pending suggestion's payload (PUT) |
| `map` | ✅ native — per-vault vocab→type map (`init` / `sync` / `check`) |
| `suggest` | ✅ native — builds the full datatype graph (Types + Attribute edges + reified events) from the map + crosswalk, chunked ≤100, via the shared submit transport + `--write-back` writes pending `mobrpg:` nodes |
| `pull-canon` | ✅ native — pull ratified mobRPG canon into vault `mobrpg:` nodes (authority rule) |
| `backfill` | ✅ native — one-time crosswalk → `mobrpg:` node migration |
| `write`, `merge`, `link-orphans`, `sync`, `push`, `types`, `links`, `images` | ⏳ fallback → legacy script |

Verified (2026-07-18): **60 tests pass** (`pytest -q`); `mobrpg --help` lists all verbs +
the `llms.txt` pointer. Earlier live read-only prod check (2026-07-12) passed — `whoami`
(9 worlds) and `pull` of the Space world (`a254e424-6a9e-493c-aa8e-4e76e4824fc2`) → 138
entities / 37 events, valid JSON, relationship-resolution confirmed on real data.

## Environment (do this first when you resume)

System Python 3.14 is PEP668 externally-managed — do **not** `pip install` into it.
A venv already exists at `docs/prototypes/mobrpg/.venv` (gitignored). If it's gone
(fresh clone / `git clean`), recreate:

```bash
cd docs/prototypes/mobrpg
python3 -m venv .venv
.venv/bin/python -m pip install -e ".[test]"
```

Run tests / the CLI from `docs/prototypes/mobrpg`:

```bash
.venv/bin/python -m pytest -q          # 28 tests
.venv/bin/mobrpg --help
```

Live check (read-only, safe — the prod-write guard blocks writes):

```bash
export MOBRPG_TOKEN="$(grep '^AccessToken,' ~/Downloads/credentials.csv | cut -d, -f2)"
.venv/bin/mobrpg whoami
.venv/bin/mobrpg pull <worldId> --out /tmp/extract.json
```

Auth/env model lives in `llms.txt` and `mobrpg/client.py`: `MOBRPG_ENV=dev|prod`
(default prod, printed to stderr), `MOBRPG_TOKEN` or `MOBRPG_EMAIL`+`MOBRPG_PASSWORD`,
and `MOBRPG_ALLOW_PROD_WRITES=1` required for any write against prod.

## What's next (two tracks)

**Track A — the mapping/suggest/writeback work (the real remaining value).** See
`COMPLETE-SUGGESTIONS-SPEC.md` "Implementation order": steps 1–4 (GFM converter, the `map`
scaffolder, compound `suggest`, **Pillar 3 vault-writeback**) are ✅ done; the remaining
**⏳** work is step 5:
- ✅ **Pillar 3 vault-writeback** — done. Landed as `mobrpg/node.py` (the `mobrpg:` node),
  `suggest --write-back`, `pull-canon` (authority rule: vault wins until mobRPG returns an
  edited version, then mobRPG wins), `backfill` (crosswalk retirement), and the 1.8.23 plugin
  schema migration.
- ⏳ **the mobRPG skill** — wraps map-curation + writeback with judgment (resolves `map`'s
  `review:true` routes). This is the "skill work" — a new gm-apprentice skill, not more CLI.

**Track B — mechanical fallback ports (low-value, do as needed).** `write`, `merge`,
`link-orphans`, `sync`, `push`, `types`, `links`, `images` still shell out to their legacy
scripts. Each follows the repeating pattern below; the full surface already works via fallback,
so port only when a verb needs native behavior.

For each fallback port:

1. Create `mobrpg/commands/<verb>.py` with a `run(argv: list[str]) -> int` that
   parses its own args (see `pull.py`/`whoami.py` for the shape) and calls
   `mobrpg.client` — do **not** re-implement auth or transport. Port the logic from
   the matching legacy script; thread `world`/`token` explicitly (no module globals).
   Write verbs must call `client.assert_writes_allowed()` before mutating.
2. In `mobrpg/cli.py`: add `from mobrpg.commands import <verb> as _<verb>`, add
   `"<verb>": _<verb>.run` to `NATIVE`, and remove the verb from `FALLBACK`. Leave
   `VERB_HELP` as-is (the verb stays listed in `--help`).
3. TDD: write `tests/test_<verb>.py` mocking `client._request` (see `test_pull.py`'s
   fixture pattern). Cover the real branches, not just mock plumbing. Run the full
   suite — the `test_cli.py` fallback tests use `push`/`images`, so keep at least one
   fallback verb unported while those tests reference it, or update them.
4. Commit (terse sentence-case subject, no `Co-Authored-By`, no AI mentions).

## Not yet done / open items

- **Mapping-pass follow-ups** (from `integration-log.md` / `schema-map.md`, surfaced 2026-07-18):
  - Rewire `push_relationships.py` (and add entity `mobrpg_id` capture) to read/write the **sidecar
    crosswalk**, not vault frontmatter; remove the writeback-to-frontmatter code.
  - Only `location → Political` has been submitted live; npc/faction/item/creature minimal-data
    payloads are derived from the backend `*Data.java` but **not yet exercised for real**.
  - Add an `api-import` / `mobrpg` value to the vault `source` enum; item `itemType` via
    `UpdateItemRequest` is deferred/unimplemented; ~250 Canticle entities across chapters
    0/0.5/2/3/4 still unloaded (Ch.2 Lyon 60-entity dry-run is ready).
- **Final whole-branch review NOT run** (push happened without it). Run it before any
  merge. Deferred Minor findings below were recorded 2026-07-12 and **predate the
  suggestions/catalog/review/submit-batch/update/map/GFM commits** — re-verify each against the
  current tree during the review:
  - `mobrpg/client.py:1` — leftover `#!/usr/bin/env python3` shebang on a library module.
  - `mobrpg/cli.py` — `NATIVE` typed as bare `dict` (brief specified `dict[str, callable]`).
  - `tests/test_cli.py` — unused `import subprocess` (uses `cli.subprocess`).
  - `mobrpg/commands/whoami.py` — `prog="mobrpg whoami"` hardcoded, so `mobrpg worlds -h`
    shows the wrong program name.
  - `tests/test_pull.py` — two near-duplicate fixture builders (`_fake_request_factory`
    and `_make_fake`); collapse into one.
- **Re-sync the vault copy:** `~/Documents/space_game/_meta/tooling/mobrpg/` holds an
  older fork (stale `smoketest.py`/`push_to_mobrpg.py`, no `push_suggestions.py`).
  Replace it with an editable install of this package (or a symlink) once ported far
  enough.
- **Possible promotion** to `tools/mobrpg/` once the port is complete (out of scope so far).
- The SDD progress ledger (`.superpowers/sdd/progress.md`) is **gitignored** and local
  only — this file is the durable handoff; the ledger may not survive.
