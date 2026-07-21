"""mobrpg auth — manage the CLI's mobRPG credentials.

Subcommands: import | status | refresh | logout. Import ingests the
website-issued credentials.csv (Type,Token rows), verifies it with whoami,
and writes it to the managed config store. The token is never printed.
"""

from __future__ import annotations

import argparse
import csv
import io
import sys
from datetime import datetime, timezone
from pathlib import Path

from mobrpg import client, config


def _display_name(me: dict) -> str:
    return f"{me.get('firstName', '')} {me.get('lastName', '')}".strip()


def _user_from_whoami(me: dict) -> dict:
    return {"id": me.get("id"), "email": me.get("email"), "name": _display_name(me)}


def _parse_credentials_csv(text: str) -> dict:
    """Pull AccessToken / RefreshToken from a Type,Token CSV (tolerates CRLF)."""
    out: dict[str, str] = {}
    for row in csv.reader(io.StringIO(text)):
        if len(row) < 2:
            continue
        key, val = row[0].strip(), row[1].strip()
        if key in ("AccessToken", "RefreshToken"):
            out[key] = val
    if "AccessToken" not in out:
        raise ValueError("no AccessToken row found in credentials CSV")
    return out


def _cmd_import(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(prog="mobrpg auth import")
    ap.add_argument("source", nargs="?",
                    help="path to credentials.csv, or - for stdin")
    ap.add_argument("--access-token")
    ap.add_argument("--refresh-token")
    ap.add_argument("--delete-source", action="store_true",
                    help="delete the source CSV after a successful import")
    args = ap.parse_args(argv)

    if args.access_token:
        access, refresh = args.access_token, args.refresh_token
    elif args.source:
        text = sys.stdin.read() if args.source == "-" else Path(args.source).read_text()
        try:
            parsed = _parse_credentials_csv(text)
        except ValueError as e:
            print(f"ERROR: {e}", file=sys.stderr)
            return 2
        access, refresh = parsed["AccessToken"], parsed.get("RefreshToken")
    else:
        print("ERROR: provide a credentials.csv path, - for stdin, "
              "or --access-token.", file=sys.stderr)
        return 2

    try:
        me = client.whoami(access)
    except client.ApiError as e:
        print(f"ERROR: token verification failed: {e}", file=sys.stderr)
        return 1

    config.write({
        "access_token": access,
        "refresh_token": refresh,
        "user": _user_from_whoami(me),
        "created_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "source": "import",
    })
    print(f"✓ logged in as {me.get('email')}")
    print(f"  credentials stored at {config.credentials_path()}")

    from_file = args.source and args.source != "-" and not args.access_token
    if from_file:
        if args.delete_source:
            Path(args.source).unlink(missing_ok=True)
            print(f"  removed source file {args.source}")
        else:
            print(f"  NOTE: {args.source} still holds live tokens — "
                  f"delete it (rm/del {args.source}).")
    return 0


def _cmd_status(argv: list[str]) -> int:
    argparse.ArgumentParser(prog="mobrpg auth status").parse_args(argv)
    cred = config.read()
    if not cred or not cred.get("access_token"):
        print("not configured. Run `mobrpg auth import <credentials.csv>`.",
              file=sys.stderr)
        return 1
    user = cred.get("user") or {}
    print(f"configured: {user.get('email') or user.get('id') or 'unknown user'}")
    print(f"  source:     {cred.get('source')}")
    print(f"  created_at: {cred.get('created_at')}")
    print(f"  config:     {config.credentials_path()}")
    return 0


def _cmd_refresh(argv: list[str]) -> int:
    argparse.ArgumentParser(prog="mobrpg auth refresh").parse_args(argv)
    cred = config.read()
    if not cred or not cred.get("refresh_token"):
        print("ERROR: no refresh token stored. Re-run `mobrpg auth import`.",
              file=sys.stderr)
        return 1
    try:
        fresh = client.refresh_app_token(cred["refresh_token"])
        access = fresh["accessToken"]
        me = client.whoami(access)
    except client.ApiError as e:
        print(f"ERROR: refresh failed: {e}", file=sys.stderr)
        return 1
    cred["access_token"] = access
    cred["refresh_token"] = fresh.get("refreshToken", cred["refresh_token"])
    cred["user"] = _user_from_whoami(me)
    config.write(cred)
    print(f"✓ refreshed. logged in as {me.get('email')}")
    return 0


def _cmd_logout(argv: list[str]) -> int:
    argparse.ArgumentParser(prog="mobrpg auth logout").parse_args(argv)
    if config.clear():
        print("✓ logged out (credentials removed).")
    else:
        print("nothing to do (no stored credentials).")
    return 0


_SUB = {
    "import": _cmd_import,
    "status": _cmd_status,
    "refresh": _cmd_refresh,
    "logout": _cmd_logout,
}

_USAGE = "usage: mobrpg auth <import|status|refresh|logout> [args]"


def run(argv: list[str]) -> int:
    if not argv:
        print(_USAGE, file=sys.stderr)
        return 2
    if argv[0] in ("-h", "--help"):
        print(_USAGE)
        return 0
    sub, rest = argv[0], argv[1:]
    if sub not in _SUB:
        print(f"unknown auth subcommand: {sub}\n{_USAGE}", file=sys.stderr)
        return 2
    return _SUB[sub](rest)
