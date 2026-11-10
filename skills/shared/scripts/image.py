#!/usr/bin/env python3
"""Draw a vault's pictures: set up a service key and see where things stand.

Usage:
  image.py status VAULT
  image.py key SERVICE
  image.py plan VAULT REQUESTS [--unprompted] [--source codex|service|self]
  image.py draw VAULT JOB [--redo N "what was wrong"]... [--picture N FILE]...
  image.py place VAULT JOB [--keep N...] [--hold N...] [--write]
  image.py missing VAULT [--pcs]
"""

from __future__ import annotations

import argparse
from datetime import date
import subprocess
import sys
from pathlib import Path

import image_codex
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
        help="what to do: status, key, plan, draw, place or missing")
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
    pl.add_argument("--source", choices=image_jobs.SOURCES,
                    help="who draws, for this job only, as the GM chose: codex "
                    "(an installed Codex on a ChatGPT plan, no money), service "
                    "(the vault's picture service and model, paid) or self "
                    "(you, with your own image tool). Left out: the vault's "
                    "vault.images.source")
    dr = sub.add_parser(
        "draw",
        help="draw the planned pictures (on a paid service this costs money)",
        epilog='Example: gma image draw "<vault>" 20261109-a1b2c3 '
               '--redo 2 "the cloak should be green"')
    dr.add_argument("vault", type=Path, help="the vault folder")
    dr.add_argument("job", help="the job number `plan` printed")
    dr.add_argument("--redo", nargs=2, action="append", default=[],
                    metavar=("N", "WHAT"),
                    help="draw picture N again, telling the service what was "
                    "wrong with it (up to 500 characters); can be given "
                    "more than once. On a paid service each attempt is paid "
                    "for. Pictures are "
                    "drawn one at a time; two gma image draw runs on one "
                    "vault at the same time can lose a spending count")
    dr.add_argument("--picture", nargs=2, action="append", default=[],
                    metavar=("N", "FILE"),
                    help="for a job planned with --source self: hand in the "
                    "picture you drew for picture N (a PNG or JPEG); again "
                    "for a redraw; can be given more than once")
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
    ms = sub.add_parser(
        "missing", help="list the notes that could have a picture and have "
        "none, for a fill",
        epilog='Example: gma image missing "<vault>"')
    ms.add_argument("vault", type=Path, help="the vault folder")
    ms.add_argument("--pcs", action="store_true",
                    help="list player characters too (only when the GM "
                    "includes them)")
    ap.epilog = 'Example: gma image status "<vault>"'
    return ap


def missing(vault: Path, pcs: bool) -> int:
    if not vault.is_dir():
        print(f"error: not a directory: {vault}", file=sys.stderr)
        return 2
    found = image_jobs.missing(vault, pcs)
    if not found:
        print("No notes are missing a picture.")
        return 0
    for kind, rel in found:
        print(f"{kind}\t{rel}")
    print(image_jobs.counted(len(found), "note") + " with no picture")
    return 0


def _today() -> date:
    return date.today()


def status(vault: Path) -> int:
    if not vault.is_dir():
        print(f"error: not a directory: {vault}", file=sys.stderr)
        return 2
    lim = image_money.limits(vault)
    print("unprompted drawing: " + ("on" if lim.auto else "off"))
    print("source: " + (lim.source or ("service (from the service setting)"
                                       if lim.service else "none chosen; the GM chooses")))
    state = image_codex.login()
    if state.state != "missing":
        print(f"codex: {state.line}"
              + (" (can draw with no money counted, if chosen)"
                 if state.state == "chatgpt" else ""))
    for w in image_jobs.waiting(vault):
        what = ", ".join(w.notes[:3]) + (
            f" and {len(w.notes) - 3} more" if len(w.notes) > 3 else "")
        print(f"waiting: {w.id} for {what}; {w.source}"
              f"{', unasked' if w.unprompted else ''} ({w.to_draw} to draw, "
              f"{w.to_place} to look at and place)")
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
    print(f"spent this month: {image_money.cents(month_spent)} of {lim.month:g} cents")
    if unpriced:
        print(f"pictures paid for this month at an unknown price: {unpriced}")
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


FREE_WORDS = {"codex": "by Codex (its built-in image tool) on the ChatGPT plan, no money counted",
              "self": "by you, with your own image tool, no money counted"}


def plan(vault: Path, requests: Path, unprompted: bool,
         source: str | None = None) -> int:
    if not vault.is_dir():
        print(f"error: not a directory: {vault}", file=sys.stderr)
        return 2
    try:
        job = image_jobs.plan(vault, image_jobs.read_requests(requests),
                              unprompted, _today(), source)
    except image_jobs.Stop as e:
        print(str(e), file=sys.stderr)
        return 2
    print(f"Job {job.id}")
    free = FREE_WORDS.get(job.service)
    if free:
        print(f"Drawn {free}.")
    else:
        print(f"Drawn by {job.service}, model {job.model}, on the GM's key: "
              "this costs money.")
    total = 0.0
    planned = 0
    for pic in job.entries:
        if pic.status == "planned":
            planned += 1
            total += pic.estimate or 0.0
            cost = ("" if free else
                    f", about {image_money.cents(pic.estimate)} cents"
                    if pic.estimate is not None
                    else ", price unknown")
            print(f"{pic.n}. {pic.note}: planned{cost}")
            for line in pic.said:
                print(f"   {line}")
            if job.service == "self":
                print(f"   shape: {pic.shape}")
                for ref in pic.refs:
                    print(f"   likeness: {ref}")
                print("   prompt: " + pic.prompt.replace("\n", "\n   "))
        else:
            print(f"{pic.n}. {pic.note}: {pic.status}")
            for line in pic.said:
                print(f"   {line}")
    if free:
        if job.service == "self" and planned:
            print(image_draw.SELF_HOW.format(job=job.id))
    elif job.priced:
        print(f"Estimated total: about {image_money.cents(total)} cents")
    else:
        print("Estimated total: unknown (the price of this model is not known)")
    where = image_jobs.job_file(job.id)
    print(f"Job file: {where}")
    if image_jobs.roots()[1] in where.parents:
        print("The job is in the temp folder (the cache folder could not be "
              "written); the system may clear it within days, so place or "
              "keep its pictures soon.")
    return 0 if planned else 1


def draw(vault: Path, job_id: str, redo: list[list[str]],
         pictures: list[list[str]] | None = None) -> int:
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
        handed: dict[int, Path] = {}
        for n_text, file in pictures or []:
            if not n_text.isdecimal():
                raise image_jobs.Stop(
                    f"--picture needs a picture number first, not {n_text!r}.")
            if int(n_text) in handed:
                raise image_jobs.Stop(
                    f"Picture {int(n_text)} has two --picture files; give one.")
            handed[int(n_text)] = Path(file)
        job = image_jobs.load(job_id)
        image_place.check_vault(job, vault)
        if handed and notes:
            raise image_jobs.Stop("--picture and --redo cannot go together: for "
                                  "a redraw of your own, hand in the new "
                                  "picture with --picture.")
        try:
            if handed:
                image_draw.hand_in(job, handed, result)
            else:
                image_draw.draw(job, notes, _today(), result)
        finally:
            # Whatever happens, what was already drawn and paid for is shown.
            for line in result.lines:
                print(line)
    except image_jobs.Stop as e:
        print(str(e), file=sys.stderr)
        return 2
    if job.service in FREE_WORDS:
        print(f"This run: {image_jobs.counted(result.drawn)} drawn "
              f"{FREE_WORDS[job.service]}")
        return 0 if result.ok else 1
    drawn = image_jobs.counted(result.drawn)
    if result.unknown and result.cents == 0:
        more = result.unknown - result.drawn   # paid for, but no picture came back
        if not result.drawn:
            print(f"This run: no pictures drawn, {result.unknown} paid for "
                  "at an unknown price")
        elif more > 0:
            print(f"This run: {drawn} drawn and {more} more paid for, "
                  "all at an unknown price")
        else:
            print(f"This run: {drawn} drawn at an unknown price")
    else:
        # A priced run counts every reply in cents, so none is unknown here.
        print(f"This run: {drawn} drawn, {image_money.cents(result.cents)} "
              f"cents (this job so far: {image_money.cents(result.job_cents)} cents)")
    try:
        month = image_money.spent(vault, _today())
        unpriced = image_money.unpriced_count(vault, _today())
        ceiling = image_money.limits(vault).month
    except (vaultlib.StateUnreadable, vaultlib.SettingsUnavailable) as e:
        print(str(e), file=sys.stderr)
        return 1
    print(f"This month: {image_money.cents(month)} of {ceiling:g} cents"
          + (f", and {image_jobs.counted(unpriced)} paid for at an unknown price"
             if unpriced else ""))
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
        return plan(args.vault, args.requests, args.unprompted, args.source)
    if args.command == "draw":
        return draw(args.vault, args.job, args.redo, args.picture)
    if args.command == "place":
        return place(args.vault, args.job, args.keep, args.hold, args.write)
    if args.command == "missing":
        return missing(args.vault, args.pcs)
    return key(args.service)


if __name__ == "__main__":
    sys.exit(main())
