# mobrpg — CLI for syncing mobRPG worlds with gm-apprentice vaults

`mobrpg` is a command-line tool over the [mobRPG](https://www.mobrpg.com)
world-builder REST API. It moves campaign content both ways between a mobRPG
world and a gm-apprentice vault: importing a world into vault markdown, and
pushing (or suggesting) vault entities back up into a world.

I built it to keep my own vaults in sync with mobRPG worlds. It has no
third-party dependencies — the client is stdlib `urllib` only. Every verb is a
native Python subcommand sharing one client; there is no shell-out layer.

## Install

From the package directory (`tools/mobrpg/`), an editable install puts the
`mobrpg` command on your PATH:

```bash
python3 -m pip install -e path/to/tools/mobrpg
mobrpg --help
mobrpg --version
```

If `mobrpg` isn't on your PATH after install, run it as a module instead:
`python3 -m mobrpg.cli --help`.

Requires Python 3.10+.

## Auth

The CLI needs a mobRPG token. The simplest path is a one-URL download of a
credentials CSV, imported once into a managed config store.

1. Open **https://www.mobrpg.com/me/tokens/download** in a browser and log in
   if prompted. A `credentials.csv` downloads automatically.
2. Import it (use the path where the file landed):

   ```bash
   mobrpg auth import ~/Downloads/credentials.csv
   ```

   The import verifies the token with a `whoami` call, then stores it in a
   user-level config file — `~/.config/mobrpg` on POSIX, `%APPDATA%\mobrpg` on
   Windows. The token is written `0600` and is never printed.
3. Confirm it worked:

   ```bash
   mobrpg auth status
   ```

The downloaded CSV still holds live tokens after import — delete it, or pass
`--delete-source` on the import to have the CLI remove it for you.

Other `auth` subcommands:

- `mobrpg auth refresh` — renew an expired token (run this if a command reports
  HTTP 401).
- `mobrpg auth logout` — remove the stored credential.

### Token precedence

`get_access_token` resolves a bearer token in this order:

1. `MOBRPG_TOKEN` in the environment (overrides everything below).
2. The managed config from `mobrpg auth import`.
3. `MOBRPG_EMAIL` + `MOBRPG_PASSWORD` (email/password login, local-password
   accounts only).

If `MOBRPG_TOKEN` is set, it wins over the imported credential — `auth status`
warns you when that's the case.

## Environment & target

- `MOBRPG_ENV=dev|prod` picks which server to hit. **Default is `prod`.** The
  resolved target (env name + base URL) prints to stderr on every run, and a
  production run also prints a `⚠️ THIS IS PRODUCTION` banner — so there's never
  any ambiguity about which world a command is about to touch.
- Per-field overrides layer on top of the chosen preset: `MOBRPG_BASE`,
  `MOBRPG_CLIENT_ID`, `MOBRPG_REDIRECT_URI`.
- `MOBRPG_CONFIG_DIR` overrides where the credential is stored.

Exit codes: `0` ok, `1` API error, `2` bad args / no auth configured.

## Read-only vs mutating

Read-only verbs are safe to run anywhere: `whoami`, `worlds`, `pull`,
`whats-new`, `suggestions`, `catalog`, `map`.

Mutating verbs are **dry-run by default** — add `--execute` to actually write.
`suggest`, `sync`, and `submit-batch` only ever file *suggestions* — a
collaborator can run them with just Read access, and the world owner accepts or
dismisses each one, so none of them overwrites a live element directly. The
owner-side verbs `update` and `review` (and listing others' suggestions) need
write access on the world. The rest (`images`, `link-orphans`, `pull-canon`,
`adopt`, `relink`) only ever write local vault files; `pull-canon`, `adopt`,
and `images` read from mobRPG but write locally, and `relink` makes no API
calls at all.

`write` is the exception, twice over: it runs as soon as it is invoked (no
`--execute`, no dry-run), and with `--overwrite` it replaces existing notes
**wholesale** — hand-authored prose, `## GM Notes`, play bookkeeping, all of
it. Without `--overwrite` it skips notes that already exist and reports the
count, so the default is safe against a populated vault; to bring new entities
into one, filter the extract to just the new ids, or `write` into a scratch
directory and diff before copying in.

Entity and event IDs live in each note's `mobrpg:` frontmatter node — the single
source of truth. There is no sidecar crosswalk. A vault whose entities already
exist upstream but carry no node is linked with `adopt` (match live elements by
name, then stamp nodes).

## Verb overview

Run `mobrpg <command> --help` for a command's own options.

### Identity

- `auth` — manage credentials: `import` | `status` | `refresh` | `logout`.
- `whoami` — print the authenticated user and their worlds.
- `worlds` — list worlds visible to the authenticated user (same as `whoami`).

### Import (mobRPG → vault)

- `pull <world>` — import a world into a structured JSON extract
  (default `extract.json`); the entry point of the import pipeline.
- `write <extract.json> --out <out_dir>` — materialize an extract into vault
  markdown, one file per entity. **Skips notes that already exist** (and says
  so); `--overwrite` replaces them wholesale, hand-authored prose and
  `## GM Notes` included — intended for a fresh or scratch directory.
- `link-orphans <extract.json> --vault <path> --out <outdir>` — auto-link obvious
  orphan relationships after an import. Writes the derived `part_of`/`created`
  edge into `relationships:` and fills an empty `parent_location:` scalar to
  match; no other frontmatter fields are populated.
- `images <world> --vault <path>` — pull entity images into the vault.
  **Pull-only**: there is no upload path, so a vault-side image reaches mobRPG
  only through the web UI.

### Reconcile (keep a vault current)

- `whats-new <world> --vault <path>` — read-only report of what's new upstream
  and which vault notes have gone missing upstream.
- `pull-canon <world> --vault <path>` — pull ratified mobRPG canon down into
  vault `mobrpg:` nodes.
- `pull-canon <world> --vault <path> --reconcile-deletions` — flag linked notes
  whose element has gone from mobRPG. This is the write side of `whats-new`'s
  GONE list: the review-queue pass only learns about deletions of elements that
  came through review, so an element deleted directly upstream leaves its note
  reading as linked forever. Aborts rather than act on an unreadable or empty
  world, since either is indistinguishable from "canon deleted everything".
- `sync <world> --vault <path>` — timestamp last-writer-wins sync of each linked
  note's description prose (see "How sync decides" below).
- `adopt <world> --vault <path>` — stamp `mobrpg:` nodes onto vault notes that
  already exist upstream but carry no node, matched by name.
- `relink --vault <path> --to <new-rel-path>` — re-point a moved or renamed
  note's external ref so a re-push won't mint a duplicate (vault-only).

### Push (vault → mobRPG)

- `suggest <world> --vault <path>` — build the full datatype graph per vault
  entity (element + classifier Types via `Attribute` edges + reified
  relationship Events) and submit it as review suggestions. The owner accepts or
  dismisses each one, so this never creates a live element directly.
- `submit-batch <world> <batch.json>` — submit a pre-built compound batch
  (classifier types + attribute edges + reified event/link relationships).

### Review & catalog

- `suggestions <world>` — list suggestions by review state; `--correlate` joins
  each accepted suggestion back to its vault file and the element it produced.
- `catalog <world> <kind>` — list the elements of one kind (e.g. `political/type`,
  `person`) to see what already exists before pushing.
- `review <world> <suggestionId> <accept|dismiss|reinstate>` — GM review action
  on one suggestion (needs write access).
- `update <world> <suggestionId> <update.json>` — replace a pending suggestion's
  payload (inline fields only).
- `map <init|sync|check> <world> --vault <path>` — generate and maintain the
  per-vault type mapping (read-only on mobRPG).

## How sync decides

`mobrpg sync` keeps a linked note's description prose and its mobRPG element in
step with a last-writer-wins rule — no content hashes, no frozen baselines, no
merges. For each linked note it looks at three timestamps: the note file's
mtime, the node's recorded `last_synced`, and the server element's
`lastModified`. From those it decides, per note, inside a ±120s skew window
(tune with `--skew`):

- **skip** — neither side changed since the last sync. Nothing to do.
- **pull** — only mobRPG changed. I overwrite the note's canon prose wholesale
  with the converted server description, preserving the `## GM Notes` tail
  verbatim, and stamp `last_synced`.
- **push** — only the vault changed. I don't write upstream directly: I file one
  reviewable `UpdateElement` suggestion and mark the node `review_state:
  pending`. You adjudicate it in mobRPG — accept and the vault becomes canon,
  dismiss and mobRPG stays canon.
- **tie** — both sides changed within the skew window. Treated as a push (a
  suggestion), because a human should decide.

A note already `review_state: pending` is held — it's awaiting your decision
upstream, so `sync` won't touch it. `sync` is dry-run by default and prints the
per-note decision table; `--execute` gates every file write and suggestion
submit.

**GM Notes stay local to the vault by design** — the `## GM Notes` tail of a
note is never pushed to mobRPG, and remains vault-local until mobRPG enforces
hidden-note access server-side.

## Typical workflows

Import a world into a vault (read-only against mobRPG, so prod is fine):

```bash
export MOBRPG_TOKEN=...
mobrpg pull <worldId> --out extract.json
mobrpg write extract.json --out /path/to/vault
mobrpg link-orphans extract.json --vault /path/to/vault --out ./orphan_out
```

Propose a vault chapter to a world as suggestions (dry-run first):

```bash
mobrpg suggest <worldId> --vault /path/to/vault --chapter chapter-2            # dry-run
mobrpg suggest <worldId> --vault /path/to/vault --chapter chapter-2 --execute
```

Keep a linked note's description prose in sync going forward (dry-run first):

```bash
mobrpg sync <worldId> --vault /path/to/vault            # dry-run: shows the decision table
mobrpg sync <worldId> --vault /path/to/vault --execute  # pulls newer canon, files suggestions for newer vault edits
```

Confirm the round-trip after the owner accepts them (read-only):

```bash
mobrpg catalog <worldId> political/type
mobrpg suggestions <worldId> --state Accepted --correlate --vault /path/to/vault
```

## Versioning

`mobrpg --version` reports the package's own version. That version is
independent of the gm-apprentice marketplace plugin version — the two are not
kept in sync.

## For AI agents

`llms.txt` (next to this package) is the agent-facing command guide: the full
command model, auth precedence, and safe-write rules in one file.
