#!/usr/bin/env python3
"""Draw a vault's pictures: set up a service key and see where things stand.

Usage:
  image.py status VAULT
  image.py key SERVICE
  image.py plan VAULT REQUESTS [--unprompted]
  image.py draw VAULT JOB [--redo N "what was wrong"]...
  image.py place VAULT JOB [--keep N...] [--hold N...] [--write]
"""

from __future__ import annotations

import argparse
from datetime import date
import subprocess
import sys
from pathlib import Path

import image_draw
import image_jobs
import image_keys
import image_money
import image_place
import vaultlib


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(
        dest="command", required=True,
        help="what to do: status, key, plan, draw or place")
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
    dr = sub.add_parser(
        "draw",
        help="send the planned pictures to the drawing service (this costs money)",
        epilog='Example: gma image draw "<vault>" 20261109-a1b2c3 '
               '--redo 2 "the cloak should be green"')
    dr.add_argument("vault", type=Path, help="the vault folder")
    dr.add_argument("job", help="the job number `plan` printed")
    dr.add_argument("--redo", nargs=2, action="append", default=[],
                    metavar=("N", "WHAT"),
                    help="draw picture N again, telling the service what was "
                    "wrong with it (up to 500 characters); can be given "
                    "more than once. Each attempt is paid for. Pictures are "
                    "drawn one at a time; two gma image draw runs on one "
                    "vault at the same time can lose a spending count")
    pc = sub.add_parser(
        "place", help="file the pictures you kept and link them in the vault",
        epilog='Example: gma image place "<vault>" 20261109-a1b2c3 '
               '--keep 1 2 --hold 3 --write')
    pc.add_argument("vault", type=Path, help="the vault folder")
    pc.add_argument("job", help="the job number `plan` printed")
    pc.add_argument("--keep", type=int, nargs="+", default=[], metavar="N",
                    help="numbers of the pictures to file in the vault")
    pc.add_argument("--hold", type=int, nargs="+", default=[], metavar="N",
                    help="numbers of the pictures to leave out of the vault "
                    "(they stay in the job folder)")
    pc.add_argument("--write", action="store_true",
                    help="do it; without this, only say what would happen")
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
    if lim.service and lim.service not in image_keys.ENV:
        print(f"key: this version cannot store a key for {lim.service}")
    else:
        # With no service chosen yet, a key for any known service is worth saying.
        names = [lim.service] if lim.service else sorted(image_keys.ENV)
        try:
            found = next((f for f in (image_keys.find(n) for n in names) if f), None)
        except image_keys.StoreUnavailable as e:
            print(f"key: {e}")
        else:
            if found:
                print(f"key: found ({found[1]})")
            else:
                print("key: none found")
    today = _today()
    month_spent = image_money.spent(vault, today)
    unpriced = image_money.unpriced_count(vault, today)
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
    except subprocess.CalledProcessError:
        print("The key was not stored. If the two entries did not match, "
              "run the command again.", file=sys.stderr)
        return 1
    except (ValueError, OSError) as e:
        print(f"error: the key was not stored ({e})", file=sys.stderr)
        return 1
    print(f"Stored the {service} key in the {where}"
          + ("" if where.endswith(".") else "."))
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


def draw(vault: Path, job_id: str, redo: list[list[str]]) -> int:
    if not vault.is_dir():
        print(f"error: not a directory: {vault}", file=sys.stderr)
        return 2
    notes: dict[int, str] = {}
    result = image_draw.DrawResult()
    try:
        for n_text, what in redo:
            if not n_text.isdecimal():
                raise image_jobs.Stop(
                    f"--redo needs a picture number first, not {n_text!r}.")
            if int(n_text) in notes:
                raise image_jobs.Stop(
                    f"Picture {int(n_text)} has two --redo notes; give one.")
            notes[int(n_text)] = what
        job = image_jobs.load(job_id)
        image_place.check_vault(job, vault)
        try:
            image_draw.draw(job, notes, _today(), result)
        finally:
            # Whatever happens, what was already drawn and paid for is shown.
            for line in result.lines:
                print(line)
    except image_jobs.Stop as e:
        print(str(e), file=sys.stderr)
        return 2
    pictures = image_jobs.counted(result.drawn)
    if result.unknown and result.cents == 0:
        more = result.unknown - result.drawn   # paid for, but no picture came back
        if not result.drawn:
            print(f"This run: no pictures drawn, {result.unknown} paid for "
                  "at an unknown price")
        elif more > 0:
            print(f"This run: {pictures} drawn and {more} more paid for, "
                  "all at an unknown price")
        else:
            print(f"This run: {pictures} drawn at an unknown price")
    else:
        drawn = (f"This run: {pictures} drawn, {result.cents:.2f} cents")
        if result.unknown:
            drawn += f", and {result.unknown} paid for at an unknown price"
        print(drawn + f" (this job so far: {result.job_cents:.2f} cents)")
    try:
        month = image_money.spent(vault, _today())
        unpriced = image_money.unpriced_count(vault, _today())
        ceiling = image_money.limits(vault).month
    except (vaultlib.StateUnreadable, vaultlib.SettingsUnavailable) as e:
        print(str(e), file=sys.stderr)
        return 1
    print(f"This month: {month:.2f} of {ceiling:g} cents"
          + (f", and {image_jobs.counted(unpriced)} at an unknown price" if unpriced else ""))
    return 0 if result.ok else 1


def place(vault: Path, job_id: str, keep: list[int], hold: list[int],
          write: bool) -> int:
    if not vault.is_dir():
        print(f"error: not a directory: {vault}", file=sys.stderr)
        return 2
    try:
        job = image_jobs.load(job_id)
        image_place.check_vault(job, vault)
        result = image_place.run(job, set(keep), set(hold), write)
    except image_jobs.Stop as e:
        print(str(e), file=sys.stderr)
        return 2
    for line in result.lines:
        print(line)
    if not write:
        print("Nothing was changed. Add --write to do it." if result.ok else
              "Some pictures cannot be placed (see above). Nothing was changed.")
    return 0 if result.ok else 1


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return _dispatch(args)
    except (vaultlib.SettingsUnavailable, vaultlib.StateUnreadable) as e:
        print(str(e), file=sys.stderr)
        return 2
    except OSError as e:
        # Last resort: anything not already wrapped must not be a traceback.
        reason = (f"{e.filename}: {e.strerror}" if e.filename and e.strerror
                  else str(e))
        print(f"Could not read or write {reason}.", file=sys.stderr)
        return 1


def _dispatch(args: argparse.Namespace) -> int:
    if args.command == "status":
        return status(args.vault)
    if args.command == "plan":
        return plan(args.vault, args.requests, args.unprompted)
    if args.command == "draw":
        return draw(args.vault, args.job, args.redo)
    if args.command == "place":
        return place(args.vault, args.job, args.keep, args.hold, args.write)
    return key(args.service)


if __name__ == "__main__":
    sys.exit(main())
