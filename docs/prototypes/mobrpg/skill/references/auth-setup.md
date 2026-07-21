# mobRPG credential setup (`mobrpg auth`)

The `mobrpg` CLI needs a mobRPG token to talk to the API. Because the assistant
cannot log into the GM's account, the GM runs a couple of commands themselves and
pastes the output back. There are two paths — the one-URL download (preferred) and
a manual fallback. Both end at the same `mobrpg auth import` step. Give plain
"run this in your terminal" instructions; do not assume any assistant-specific
input syntax.

## Preferred — one-URL download

1. Open **https://www.mobrpg.com/me/tokens/download** in a browser. Log in if
   prompted (Google or email/password — the page returns to itself afterward).
   A `credentials.csv` downloads automatically (or click the **Download** button
   the page shows).
2. In a terminal, run (use the path where the file landed):
   - macOS / Linux: `mobrpg auth import ~/Downloads/credentials.csv`
   - Windows: `mobrpg auth import %USERPROFILE%\Downloads\credentials.csv`
   - If `mobrpg` isn't on PATH, use `python -m mobrpg.cli auth import <path>`.
3. Confirm: `mobrpg auth status` — it prints the logged-in email and config path.
4. Optional: delete the downloaded CSV (it still holds live tokens). Passing
   `--delete-source` on the import has the CLI remove it after a successful import.

## Manual fallback (works today, before the download page ships)

1. Log into mobrpg.com however you normally do.
2. Open the **App Token** page at `/me/tokens` and create a token (name it
   `gm-apprentice`).
3. In the reveal dialog, click **Download Credentials CSV** — the tokens are only
   shown this once.
4. Run `mobrpg auth import <path-to-credentials.csv>`, then `mobrpg auth status`.

## Notes

- The token is stored in a user-level config file (`~/.config/mobrpg` on POSIX,
  `%APPDATA%\mobrpg` on Windows), not in the vault, and is never printed.
- `MOBRPG_TOKEN` in the environment still overrides the stored credential.
- App tokens expire. If a command reports a 401, run `mobrpg auth refresh`.
- To remove the stored credential: `mobrpg auth logout`.
