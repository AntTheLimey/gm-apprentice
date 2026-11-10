#!/usr/bin/env python3
"""Draw a vault's pictures: set up a service key and see where things stand.

Usage:
  image.py status VAULT
  image.py key SERVICE
  image.py plan VAULT REQUESTS [--unprompted]
"""

from __future__ import annotations

import argparse
from datetime import date
import subprocess
import sys
from pathlib import Path

import image_jobs
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
    pl = sub.add_parser(
        "plan", help="work out which pictures to draw, and what they cost",
        epilog='Example: gma image plan "<vault>" requests.json')
    pl.add_argument("vault", type=Path, help="the vault folder")
    pl.add_argument("requests", type=Path, help="a JSON file: a list with one "
                    "object per picture (for, subject, and optionally blocks, "
                    "shows, replace, after, name)")
    pl.add_argument("--unprompted", action="store_true",
                    help="the GM did not ask for these pictures: apply the "
                    "vault's rules for drawing without asking")
    ap.epilog = 'Example: gma image status "<vault>"'
    return ap


def _today() -> date:
    return date.today()


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
    today = _today()
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


def plan(vault: Path, requests: Path, unprompted: bool) -> int:
    if not vault.is_dir():
        print(f"error: not a directory: {vault}", file=sys.stderr)
        return 2
    try:
        job = image_jobs.plan(vault, image_jobs.read_requests(requests),
                              unprompted, _today())
    except image_jobs.Stop as e:
        print(str(e), file=sys.stderr)
        return 2
    except (vaultlib.StateUnreadable, vaultlib.SettingsUnavailable) as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    except OSError as e:
        print(f"error: could not save the job ({e.__class__.__name__})",
              file=sys.stderr)
        return 2
    print(f"Job {job.id}")
    total = 0.0
    planned = 0
    for pic in job.entries:
        if pic.status == "planned":
            planned += 1
            total += pic.estimate or 0.0
            cost = (f", about {pic.estimate:.2f} cents" if pic.estimate is not None
                    else ", price unknown")
            print(f"{pic.n}. {pic.note}: planned{cost}")
            for line in pic.said:
                print(f"   {line}")
        else:
            print(f"{pic.n}. {pic.note}: {pic.status}")
            for line in pic.said:
                print(f"   {line}")
    if job.priced:
        print(f"Estimated total: about {total:.2f} cents")
    else:
        print("Estimated total: unknown (the price of this model is not known)")
    print(f"Job file: {image_jobs.job_file(job.id)}")
    return 0 if planned else 1


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "status":
        return status(args.vault)
    if args.command == "plan":
        return plan(args.vault, args.requests, args.unprompted)
    return key(args.service)


if __name__ == "__main__":
    sys.exit(main())
