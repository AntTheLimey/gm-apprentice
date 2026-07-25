# mobrpg — CLI for syncing mobRPG worlds with gm-apprentice vaults

`mobrpg` is a command-line tool over the [mobRPG](https://www.mobrpg.com)
world-builder REST API. It moves campaign content both ways between a mobRPG
world and a gm-apprentice vault: importing a world into vault markdown, and
pushing (or suggesting) vault entities back up into a world.

I built it to keep my own vaults in sync with mobRPG worlds. It has no
third-party dependencies — the client is stdlib `urllib` only.

> **Native verbs plus documented fallbacks.** Most verbs are native Python
> subcommands. Seven verbs (`write`, `merge`, `link-orphans`, `push`, `types`,
> `links`, `images`) still shell out to the original prototype scripts that ship
> alongside the package; they work exactly like the native verbs from the user's
> point of view. This is a mid-migration state, not a finished port.

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
`whats-new`, `suggestions`, `catalog`, `map`, `images`.

Mutating verbs are **dry-run by default** — add `--execute` to actually write.
The API-mutating verbs (`push`, `suggest`, `suggest-desc`, `submit-batch`,
`update`, `types`, `links`, `review`) need write access on the world. The rest
(`write`, `merge`, `link-orphans`, `pull-canon`, `pull-desc`, `adopt`, `relink`)
only ever write local vault files; `pull-canon`, `pull-desc`, and `adopt` read
from mobRPG but write locally, and `relink` makes no API calls at all.

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
- `write <extract.json> <out_dir>` — render an extract into vault markdown.
- `merge <extract.json> <vault>` — non-destructive merge for entities present in
  both the extract and the vault.
- `link-orphans <extract.json> <vault> <outdir>` — auto-link obvious orphan
  relationships after an import.
- `images <world> <vault>` — pull entity images into the vault.

### Reconcile (keep a vault current)

- `whats-new <world> --vault <path>` — read-only report of what's new upstream
  and which vault notes have gone missing upstream.
- `pull-canon <world> --vault <path>` — pull ratified mobRPG canon down into
  vault `mobrpg:` nodes.
- `pull-desc <world> --vault <path>` — reconcile note description prose with
  mobRPG canon (report by default; `--resolve` applies a chosen outcome).
- `adopt <world> --vault <path>` — stamp `mobrpg:` nodes onto vault notes that
  already exist upstream but carry no node, matched by name.
- `relink --vault <path> --to <new-rel-path>` — re-point a moved or renamed
  note's external ref so a re-push won't mint a duplicate (vault-only).

### Push (vault → mobRPG)

- `push <world> --chapter <ch>` — direct-create vault entities in a world
  (needs write access; immediately live).
- `suggest <world> --chapter <ch>` — submit vault entities as review suggestions
  (only needs Read access — a collaborator proposes content for the owner to
  accept or dismiss).
- `suggest-desc <world> --vault <path>` — suggest a linked note's authored
  description up to mobRPG as an `UpdateElement` suggestion.
- `submit-batch <world> <batch.json>` — submit a pre-built compound batch
  (classifier types + attribute edges + reified event/link relationships).
- `types <world>` — set entity types via `Attribute` edges.
- `links <world> --chapter <ch>` — push vault relationships as mobRPG events.

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

## Typical workflows

Import a world into a vault (read-only against mobRPG, so prod is fine):

```bash
export MOBRPG_TOKEN=...
mobrpg pull <worldId> --out extract.json
mobrpg write extract.json /path/to/vault
mobrpg merge extract.json /path/to/vault
mobrpg link-orphans extract.json /path/to/vault ./orphan_out
```

Propose a vault chapter to a world as suggestions (safe — only needs Read
access; dry-run first):

```bash
mobrpg suggest <worldId> --chapter chapter-2            # dry-run
mobrpg suggest <worldId> --chapter chapter-2 --execute
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
