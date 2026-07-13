# mobrpg CLI — resume here (handoff for the next session)

**Branch:** `mobrpg-cli` (pushed to origin, **unmerged**). `main` keeps this whole
directory gitignored; on this branch the whole dir is tracked so the CLI and the
legacy scripts it falls back to are version-controlled together. Nothing merges to
`main` — and no plugin users are affected — until you deliberately merge.

**What this is:** a strangler-pattern port of the ~11 standalone mobRPG scripts into
one installable `mobrpg` command with subcommands over a shared client. Native verbs
call `mobrpg.commands.*`; every not-yet-ported verb shells out to its legacy `.py`
with argv passed through verbatim, so the full surface works at every step.

Design spec: `docs/superpowers/specs/2026-07-12-mobrpg-cli-design.md` (gitignored).
Implementation plan: `docs/superpowers/plans/2026-07-12-mobrpg-cli.md` (gitignored) —
it contains the full, exact code for every remaining verb port.

## Current state (as of 2026-07-12)

Commits on the branch (base `8776e85`):

```
1126302 Add llms.txt agent guide for the mobrpg CLI
2afc068 Make pull surface API errors and cover extract branches
0a796cf Port pull (world->JSON extract) to native mobrpg subcommand
aaa84b2 Port whoami/worlds to native mobrpg subcommand
f02a942 Add mobrpg CLI router with shell-out fallback and import pull_images
4488ba9 Track full mobRPG prototype dir on mobrpg-cli branch
f3bdaa4 Scaffold mobrpg package with shared client ported from smoketest
```

Package layout: `mobrpg/client.py` (was `smoketest.py`), `mobrpg/cli.py` (the
manual dispatcher), `mobrpg/commands/{whoami,pull}.py`, `llms.txt`, `pyproject.toml`,
`tests/`. Legacy scripts (`etl_extract.py`, `push_to_mobrpg.py`, …) are untouched and
remain the fallback targets.

| Verb | Status |
|---|---|
| `whoami` / `worlds` | ✅ native (`mobrpg/commands/whoami.py`) |
| `pull` | ✅ native (`mobrpg/commands/pull.py`) |
| `write`, `merge`, `link-orphans`, `sync`, `push`, `suggest`, `types`, `links`, `images` | ⏳ fallback → legacy script |

Verified: 28 tests pass; `mobrpg --help` lists all 12 verbs + the `llms.txt` pointer;
**live read-only prod check passed** — `whoami` (9 worlds) and `pull` of the Space
world (`a254e424-6a9e-493c-aa8e-4e76e4824fc2`) → 138 entities / 37 events, valid JSON,
relationship-resolution confirmed on real data.

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

## To port the next verb (the repeating pattern)

Highest-value-first is a good order (e.g. `suggest`, then `push`, then `sync`,
`images`, `types`, `links`, then the local-only `write`/`merge`/`link-orphans`).
For each:

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

- **Final whole-branch review NOT run** (push happened without it). Run it before any
  merge. Deferred Minor findings to feed into it:
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
