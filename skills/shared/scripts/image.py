#!/usr/bin/env python3
"""Draw a vault's pictures: set up a service key and see where things stand.

Usage:
  image.py status VAULT
  image.py key SERVICE
"""

from __future__ import annotations

import argparse
from datetime import date
import subprocess
import sys
from pathlib import Path

import image_keys
import image_money
import vaultlib


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="command", required=True)
    st = sub.add_parser("status", help="where picture drawing stands for a vault",
                        epilog='Example: gma image status "<vault>"')
    st.add_argument("vault", type=Path, help="the vault folder")
    key = sub.add_parser("key", help="store a service key (in your own terminal)",
                         epilog="Example: gma image key gemini")
    key.add_argument("service", help="the drawing service the key is for "
                     "(" + ", ".join(sorted(image_keys.ENV)) + ")")
    ap.epilog = 'Example: gma image status "<vault>"'
    return ap


def status(vault: Path) -> int:
    if not vault.is_dir():
        print(f"error: not a directory: {vault}", file=sys.stderr)
        return 2
    lim = image_money.limits(vault)
    print("unprompted drawing: " + ("on" if lim.auto else "off"))
    if lim.service:
        print(f"service: {lim.service}, model: {lim.model or 'none chosen'}")
    else:
        print("service: none chosen")
    # With no service chosen yet, a key for any known service is worth saying.
    found = next((f for f in (image_keys.find(n) for n in
                              ([lim.service] if lim.service else sorted(image_keys.ENV)))
                  if f), None)
    if found:
        print(f"key: found ({found[1]})")
    else:
        print("key: none found")
    today = date.today()
    try:
        month_spent = image_money.spent(vault, today)
        unpriced = image_money.unpriced_count(vault, today)
    except vaultlib.StateUnreadable as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    print(f"spent this month: {month_spent:g} of {lim.month:g} cents")
    if unpriced:
        print(f"pictures drawn this month at an unknown price: {unpriced}")
    note = vault / lim.guidance
    print(f"guidance note: {lim.guidance}"
          + ("" if note.is_file() else " (not written yet)"))
    return 0


def key(service: str) -> int:
    if service not in image_keys.ENV:
        print(f"error: no drawing service called {service!r}; try: "
              + ", ".join(sorted(image_keys.ENV)), file=sys.stderr)
        return 2
    try:
        where = image_keys.store(service)
    except image_keys.NeedsTerminal:
        print("Run this in your own terminal window: "
              f"gma image key {service}")
        return 2
    except (subprocess.CalledProcessError, ValueError, OSError) as e:
        print(f"error: the key was not stored ({e})", file=sys.stderr)
        return 1
    print(f"Stored the {service} key in the {where}.")
    return 0


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "status":
        return status(args.vault)
    return key(args.service)


if __name__ == "__main__":
    sys.exit(main())
