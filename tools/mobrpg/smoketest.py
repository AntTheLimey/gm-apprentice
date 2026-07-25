#!/usr/bin/env python3
"""
mobRPG API smoke test — proves we can authenticate and read/write against
Tim's world-builder API, and doubles as the shared config/transport module
every other script in this directory imports (`import smoketest as api`).

Reverse-engineered from the public OpenAPI spec
(https://www.mobrpg.com/docs/api-docs) and the site's JS bundle.

Auth flow:
    POST /api/user/login?clientId=<CLIENT_ID>&redirectUri=<REDIRECT_URI>
        body: {"email": ..., "password": ...}
        -> 200 {accessToken, refreshToken, user}
    then send  Authorization: Bearer <accessToken>  on every other call.

## Environment selection (prod vs dev)

BASE/CLIENT_ID/REDIRECT_URI are resolved once, at import time, from:

  1. `MOBRPG_ENV=dev|prod` — picks a built-in preset (default: `prod`, to
     preserve this tool's long-standing default of talking to the real site
     unless you deliberately ask for local dev).
  2. `MOBRPG_BASE` / `MOBRPG_CLIENT_ID` / `MOBRPG_REDIRECT_URI` — explicit
     per-field overrides, applied on top of whichever preset `MOBRPG_ENV`
     picked. Handy for a one-off custom BASE without adding a new preset.

The resolved environment + BASE is always printed loudly to stderr on import,
so it's never ambiguous which server a script is about to hit.

  Dev example:
      export MOBRPG_ENV=dev
      export MOBRPG_EMAIL='suggester@localhost'
      export MOBRPG_PASSWORD='local'
      python3 smoketest.py

⚠️  Safety: mutating calls (creates, suggestion submits, etc.) must call
`assert_writes_allowed()` first. Against `prod` that raises unless
`MOBRPG_ALLOW_PROD_WRITES=1` is also set — writing to production is never
the accidental default.

Two ways to authenticate (see `get_access_token()`):

  A. Bearer token (recommended — works for Google-SSO accounts, no password):
       Log into mobrpg.com, open the "App Tokens" settings page, create a
       token, copy its Access Token. Or grab the live session token from the
       browser console: localStorage.getItem('accessToken')
         export MOBRPG_TOKEN='<accessToken>'
         python3 smoketest.py

  B. Email + password (only works for accounts with a local password set):
         export MOBRPG_EMAIL='you@example.com'
         export MOBRPG_PASSWORD='...'
         python3 smoketest.py

  Add  --app-token "gm-apprentice"  to also mint a durable app token.

No third-party dependencies — stdlib urllib only.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

# Built-in per-environment presets. Values lifted from mobRPG's own web
# frontend (public JS bundle) for prod; dev values verified against the
# locally-running dev stack (see project CLAUDE.md).
ENVIRONMENTS = {
    "prod": {
        "base": "https://www.mobrpg.com/api",
        "client_id": "d415e4f0-92e9-4d05-a8b2-2566931b3d01",
        "redirect_uri": "https://www.mobrpg.com/auth/complete",
    },
    "dev": {
        "base": "http://localhost:8080/api",
        # Same client id works in dev — it's the frontend's public OAuth
        # client id, not environment-specific.
        "client_id": "d415e4f0-92e9-4d05-a8b2-2566931b3d01",
        "redirect_uri": "http://localhost:5173/auth/complete",
    },
}


def _resolve_environment() -> tuple[str, str, str, str]:
    """Resolve (env_name, base, client_id, redirect_uri) from MOBRPG_ENV plus
    optional MOBRPG_BASE / MOBRPG_CLIENT_ID / MOBRPG_REDIRECT_URI overrides."""
    env_name = os.environ.get("MOBRPG_ENV", "prod").strip().lower()
    if env_name not in ENVIRONMENTS:
        print(f"WARNING: unknown MOBRPG_ENV={env_name!r}; falling back to 'prod'. "
              f"Valid values: {', '.join(ENVIRONMENTS)}", file=sys.stderr)
        env_name = "prod"
    preset = ENVIRONMENTS[env_name]
    base = os.environ.get("MOBRPG_BASE") or preset["base"]
    client_id = os.environ.get("MOBRPG_CLIENT_ID") or preset["client_id"]
    redirect_uri = os.environ.get("MOBRPG_REDIRECT_URI") or preset["redirect_uri"]
    return env_name, base, client_id, redirect_uri


MOBRPG_ENV, BASE, CLIENT_ID, REDIRECT_URI = _resolve_environment()

print(f"┌─ mobRPG target: {MOBRPG_ENV.upper()}  (BASE={BASE})", file=sys.stderr)
if MOBRPG_ENV == "prod":
    print("└─ ⚠️  THIS IS PRODUCTION. Mutating calls need MOBRPG_ALLOW_PROD_WRITES=1 "
          "(see assert_writes_allowed()). Set MOBRPG_ENV=dev to target local dev instead.",
          file=sys.stderr)
else:
    print(f"└─ client_id={CLIENT_ID}  redirect_uri={REDIRECT_URI}", file=sys.stderr)


def assert_writes_allowed() -> None:
    """Call this before issuing any mutating request (create, submit, etc.).
    Refuses to proceed against `prod` unless MOBRPG_ALLOW_PROD_WRITES=1 is set,
    so a script can never write to production by accident — only by a second,
    deliberate opt-in on top of MOBRPG_ENV."""
    if MOBRPG_ENV == "prod" and os.environ.get("MOBRPG_ALLOW_PROD_WRITES") != "1":
        print("ERROR: refusing to write to PRODUCTION.", file=sys.stderr)
        print("  Set MOBRPG_ENV=dev to target the local dev stack instead, or",
              file=sys.stderr)
        print("  set MOBRPG_ALLOW_PROD_WRITES=1 if you really mean to write to prod.",
              file=sys.stderr)
        raise SystemExit(3)


class ApiError(Exception):
    def __init__(self, status: int, body: str, url: str):
        self.status = status
        self.body = body
        self.url = url
        super().__init__(f"HTTP {status} on {url}\n{body}")


def _request(method: str, path: str, *, token: str | None = None,
             query: dict | None = None, body: dict | None = None) -> dict | list | None:
    """Make a JSON request to the mobRPG API and return the parsed body."""
    url = f"{BASE}{path}"
    if query:
        url += "?" + urllib.parse.urlencode(query)

    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Accept", "application/json")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode()
    except urllib.error.HTTPError as e:
        raise ApiError(e.code, e.read().decode(errors="replace"), url) from None
    except urllib.error.URLError as e:
        raise ApiError(0, str(e.reason), url) from None

    return json.loads(raw) if raw.strip() else None


def login(email: str, password: str) -> dict:
    """Exchange email+password for {accessToken, refreshToken, user}."""
    return _request(
        "POST", "/user/login",
        query={"clientId": CLIENT_ID, "redirectUri": REDIRECT_URI},
        body={"email": email, "password": password},
    )


def whoami(token: str) -> dict:
    return _request("GET", "/user/me", token=token)


def list_worlds(token: str) -> object:
    """GET /api/world. Spring pageable params; request filter left empty."""
    return _request("GET", "/world", token=token,
                    query={"request": "", "page": 0, "size": 25})


def create_app_token(token: str, name: str) -> dict:
    """Mint a durable app token (long-lived access/refresh) for automation."""
    return _request("POST", "/app/token", token=token, body={"name": name})


def get_access_token() -> str:
    """Resolve an access token the same way every script in this directory
    should: MOBRPG_TOKEN (bearer) if set, else MOBRPG_EMAIL/MOBRPG_PASSWORD
    (logs in against whichever environment MOBRPG_ENV selected). Exits the
    process with code 2 if neither is set."""
    token = os.environ.get("MOBRPG_TOKEN")
    if token:
        print("→ Using MOBRPG_TOKEN (bearer) ...")
        return token

    email = os.environ.get("MOBRPG_EMAIL")
    password = os.environ.get("MOBRPG_PASSWORD")
    if email and password:
        print(f"→ Logging in as {email} against {MOBRPG_ENV} ({BASE}) ...")
        session = login(email, password)
        user = session.get("user", {})
        print(f"  ✓ logged in. user id={user.get('id')} "
              f"email={user.get('email')} name={user.get('firstName')} {user.get('lastName')}")
        return session["accessToken"]

    print("ERROR: set MOBRPG_TOKEN, or MOBRPG_EMAIL + MOBRPG_PASSWORD.", file=sys.stderr)
    raise SystemExit(2)


def main() -> int:
    ap = argparse.ArgumentParser(description="mobRPG API smoke test")
    ap.add_argument("--app-token", metavar="NAME",
                    help="also create a durable app token with this name")
    args = ap.parse_args()

    try:
        access = get_access_token()

        print("→ GET /user/me ...")
        me = whoami(access)
        print("  ✓ " + json.dumps({k: me.get(k) for k in ("id", "email", "firstName", "lastName")}))

        print("→ GET /world ...")
        worlds = list_worlds(access)
        content = worlds.get("content", worlds) if isinstance(worlds, dict) else worlds
        n = len(content) if isinstance(content, list) else "?"
        print(f"  ✓ {n} world(s):")
        for w in (content or [])[:25]:
            if isinstance(w, dict):
                print(f"      - {w.get('name')!r:30} id={w.get('id')} "
                      f"system={w.get('gameSystemType')}")

        if args.app_token:
            assert_writes_allowed()
            print(f"→ POST /app/token name={args.app_token!r} ...")
            tok = create_app_token(access, args.app_token)
            print("  ✓ durable app token created. SAVE THESE (shown once):")
            print(f"      id           = {tok.get('id')}")
            print(f"      accessToken  = {tok.get('accessToken')}")
            print(f"      refreshToken = {tok.get('refreshToken')}")

        print("\nSMOKE TEST PASSED ✓")
        return 0

    except ApiError as e:
        print(f"\nSMOKE TEST FAILED ✗\n{e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
