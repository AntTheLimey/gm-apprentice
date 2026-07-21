#!/usr/bin/env python3
"""
mobRPG API client — env resolution, auth, and JSON transport over Tim's
world-builder API. Relocated from the prototype's smoketest.py so every
mobrpg subcommand shares one transport layer (`from mobrpg import client`).

Auth flow:
    POST /api/user/login?clientId=<CLIENT_ID>&redirectUri=<REDIRECT_URI>
        body: {"email": ..., "password": ...}
        -> 200 {accessToken, refreshToken, user}
    then send  Authorization: Bearer <accessToken>  on every other call.

Environment (prod vs dev) is resolved once at import from MOBRPG_ENV plus
optional MOBRPG_BASE / MOBRPG_CLIENT_ID / MOBRPG_REDIRECT_URI overrides, and
the resolved target is printed to stderr so a run is never ambiguous about
which server it hits.

No third-party dependencies — stdlib urllib only.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

# Built-in per-environment presets. prod values lifted from mobRPG's own web
# frontend (public JS bundle); dev values verified against the local dev stack.
ENVIRONMENTS = {
    "prod": {
        "base": "https://www.mobrpg.com/api",
        "client_id": "d415e4f0-92e9-4d05-a8b2-2566931b3d01",
        "redirect_uri": "https://www.mobrpg.com/auth/complete",
    },
    "dev": {
        "base": "http://localhost:8080/api",
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
    print("└─ ⚠️  THIS IS PRODUCTION. Set MOBRPG_ENV=dev to target local dev instead.",
          file=sys.stderr)
else:
    print(f"└─ client_id={CLIENT_ID}  redirect_uri={REDIRECT_URI}", file=sys.stderr)


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


def refresh_app_token(refresh_token: str) -> dict:
    """Exchange a refresh token for a fresh {accessToken, refreshToken}."""
    return _request("GET", "/app/token/refresh",
                    query={"refreshToken": refresh_token})


def get_access_token() -> str:
    """Resolve a bearer token by precedence:
    MOBRPG_TOKEN env → managed config → MOBRPG_EMAIL/MOBRPG_PASSWORD login.
    Exits the process with code 2 if none is configured. Never prints the token."""
    token = os.environ.get("MOBRPG_TOKEN")
    if token:
        print("→ Using MOBRPG_TOKEN (bearer) ...")
        return token

    from mobrpg import config  # lazy import avoids an import cycle
    cred = config.read()
    if cred and cred.get("access_token"):
        who = (cred.get("user") or {}).get("email") or "stored credentials"
        print(f"→ Using managed credentials ({config.credentials_path()}) — {who}")
        return cred["access_token"]

    email = os.environ.get("MOBRPG_EMAIL")
    password = os.environ.get("MOBRPG_PASSWORD")
    if email and password:
        print(f"→ Logging in as {email} against {MOBRPG_ENV} ({BASE}) ...")
        session = login(email, password)
        user = session.get("user", {})
        print(f"  ✓ logged in. user id={user.get('id')} "
              f"email={user.get('email')} name={user.get('firstName')} {user.get('lastName')}")
        return session["accessToken"]

    print("ERROR: no credentials. Run `mobrpg auth import <credentials.csv>`, "
          "or set MOBRPG_TOKEN, or MOBRPG_EMAIL + MOBRPG_PASSWORD.", file=sys.stderr)
    raise SystemExit(2)
