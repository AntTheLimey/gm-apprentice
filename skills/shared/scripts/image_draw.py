"""Paid drawing: send the planned pictures to the service and count the money.

This is the only code that spends the GM's money, kept apart from planning so
it can be read alone. Stdlib only.
"""

from __future__ import annotations

import os
import secrets
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import NamedTuple

import dnd_ddb
import image_gemini
import image_jobs
import image_money
import vaultlib as vl
from image_jobs import (MAX_REF_BYTES, SIZE, THINKING_WHY, Entry, Job, Stop,
                        find_key)


# --- drawing --------------------------------------------------------------
#
# The one rule that governs this half: every call the service was paid for is
# counted at once, in the job and in the vault's month count, before anything
# else can fail; nothing paid for is sent twice; and no attempt is sent that
# would pass the limit for one attempt, the cap for the run or the month's
# ceiling. Pictures are sent one at a time, never in parallel: the month count
# is read, changed and written back with no lock.

REDO_CHARS = 500
FAILURES_IN_A_ROW = 3
SANDBOX = " If this AI runs in a sandbox, allow network access for gma image draw."
FORCED_THINKING_WHY = (" This model will not draw without thinking, which costs "
                       "more: raise the limit for one attempt to keep likenesses.")
NEEDS_THINKING = ("this model will not draw without thinking, and with it "
                  "this picture would pass the limit for one attempt")


@dataclass
class DrawResult:
    """What one `draw` did, ready to print."""
    lines: list[str] = field(default_factory=list)
    ok: bool = True
    drawn: int = 0          # pictures drawn this run
    cents: float = 0.0      # cents counted this run (refused and failed replies too)
    unknown: int = 0        # paid replies counted with no known price
    job_cents: float = 0.0  # cents the whole job has spent so far


class _No(NamedTuple):
    """An attempt that may not be sent. `stop` ends the whole run."""
    reason: str
    stop: bool


def _mime(data: bytes) -> str | None:
    return {"png": "image/png", "jpg": "image/jpeg"}.get(dnd_ddb.image_type(data) or "")


def _read_refs(e: Entry) -> tuple[list[tuple[str, bytes]], list[str]]:
    """The likeness pictures as they are now; one that has gone missing or
    changed since the plan is left out, with a line saying so."""
    found: list[tuple[str, bytes]] = []
    notes: list[str] = []
    for path in e.refs:
        name = Path(path).name
        try:
            if os.path.getsize(path) > MAX_REF_BYTES:
                notes.append(f"left out the reference picture {name}: it is over 5 MB")
                continue
            data = Path(path).read_bytes()
        except FileNotFoundError:
            notes.append(f"left out the reference picture {name}: the file is missing")
            continue
        except OSError:
            notes.append(f"left out the reference picture {name}: it could not be read")
            continue
        mime = _mime(data)
        if mime is None:
            notes.append(f"left out the reference picture {name}: it is not a PNG or JPEG")
            continue
        found.append((mime, data))
    return found, notes


class _Run:
    def __init__(self, job: Job, vault: Path, today: date,
                 lim: image_money.Limits, key: str, priced: bool,
                 result: DrawResult) -> None:
        self.job, self.vault, self.today = job, vault, today
        self.lim, self.key, self.priced = lim, key, priced
        self.result = result
        self.stop: str | None = None       # why no later picture is attempted
        self.streak = 0                    # pictures in a row that did not come

    # -- plain helpers --

    def clean(self, text: str) -> str:
        return text.replace(self.key, "<key>") if self.key else text

    def say(self, e: Entry, text: str) -> None:
        self.result.lines.append(f"{e.n}. {e.note}: {text}")

    def remember(self, e: Entry, text: str) -> None:
        """Add to the entry's `said` unless that line is already there."""
        if text not in e.said:
            e.said.append(text)

    def note(self, e: Entry, text: str) -> None:
        self.remember(e, text)
        self.result.lines.append(f"   {text}")

    def halt(self, why: str) -> None:
        if self.stop is None:
            self.stop = why

    def save(self, e: Entry | None = None) -> bool:
        """Save the job. A failure after a paid picture is said plainly."""
        try:
            image_jobs.save(self.job)
            return True
        except OSError:
            where = (f" at {e.pending}.{e.ext}" if e is not None and e.ext
                     and Path(f"{e.pending}.{e.ext}").is_file() else "")
            n = f" {e.n}" if e is not None else ""
            self.result.lines.append(
                f"Picture{n}{where} was paid for but could not be recorded "
                "in the job.")
            self.result.ok = False
            self.halt("the job could not be saved")
            return False

    # -- before the call --

    def prepare(self, e: Entry, prompt: str, refs: int,
                thinking: bool) -> tuple[int, float | None] | _No:
        """How many references to send and what the attempt may cost, after
        the limit for one attempt and the run and month caps. When the price
        cannot be worked out (the GM allowed that) no limit applies."""
        job, lim = self.job, self.lim
        if not self.priced:
            return refs, None
        pbytes = len(prompt.encode("utf-8"))

        def cost(k: int) -> float:
            if lim.price is not None:
                return lim.price
            got = image_gemini.estimate(job.model, SIZE, k, pbytes, thinking)
            if got is None:
                raise LookupError
            return got
        try:
            fitted = image_money.fit(cost, refs, lim.attempt)
        except LookupError:
            return _No(f"the price of {job.model} is no longer known; plan "
                       "the pictures again", True)
        if fitted is None:
            return _No("this picture would pass the limit for one attempt "
                       f"({lim.attempt:g} cents)", False)
        keep, est = fitted
        try:
            why = image_money.room(
                lim, job.spent, image_money.spent(self.vault, self.today), est)
        except vl.StateUnreadable as bad:
            return _No(f"the month's count could not be read: {bad}", True)
        except ValueError:
            return _No("a figure for the spending limits was not a number", True)
        return _No(why, True) if why else (keep, est)

    # -- after the call --

    def count(self, e: Entry, usage: dict[str, int] | None,
              est: float | None) -> float | None:
        """Count one reply the service charged for (or may have) in the job
        (memory), in the month (disk) and then in the job file. Nothing may
        come between the reply and this."""
        lim = self.lim
        cents: float | None = None
        if lim.price is not None:
            cents = lim.price
        elif usage is not None:
            try:
                cents = image_gemini.cost(self.job.model, usage)
            except ValueError:
                cents = None
        if cents is None:
            cents = est
        e.attempts += 1
        e.cost = cents
        if cents is None:
            self.result.unknown += 1
        else:
            self.job.spent = round(self.job.spent + cents, image_money.PLACES)
            self.result.cents += cents
        try:
            image_money.record(self.vault, self.today, cents)
        except (vl.StateUnreadable, OSError, ValueError) as bad:
            self.result.ok = False
            self.result.lines.append(
                f"Picture {e.n} was paid for but this month's count could not "
                f"be updated ({bad.__class__.__name__}).")
            self.halt("the month's count could not be updated")
        self.save(e)    # the attempt and spend are on disk before anything else
        return cents

    def keep_picture(self, e: Entry, pic: image_gemini.Picture) -> bool:
        """Write the bytes whole or not at all; an earlier attempt's file
        (of any extension) is replaced."""
        target = Path(f"{e.pending}.{pic.ext}")
        tmp = target.with_name(f"{target.name}.{secrets.token_hex(4)}.tmp")
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            tmp.write_bytes(pic.data)
            os.replace(tmp, target)
        except OSError:
            return False
        finally:
            tmp.unlink(missing_ok=True)
        if e.ext and e.ext != pic.ext:
            Path(f"{e.pending}.{e.ext}").unlink(missing_ok=True)
        e.ext = pic.ext
        return True

    def money_words(self, cents: float | None) -> str:
        return "cost unknown" if cents is None else f"{cents:.2f} cents"

    def attempt(self, e: Entry, redo: str | None) -> None:
        job, lim = self.job, self.lim
        refs_all, notes = _read_refs(e)
        for text in notes:
            self.note(e, text)
        prompt = e.prompt + (
            f"\n\nThe last attempt was wrong: {redo}. Correct it." if redo else "")
        thinking = lim.thinking or job.needs_thinking
        while True:
            forced = thinking and not lim.thinking   # the model needs it, not the GM
            got = self.prepare(e, prompt, len(refs_all), thinking)
            if isinstance(got, _No):
                why = NEEDS_THINKING if forced and not got.stop else got.reason
                self.remember(e, why)
                self.say(e, f"not drawn, {why}")
                self.result.ok = False
                if got.stop:
                    self.halt(got.reason)
                return
            if forced:
                job.needs_thinking = True
            keep, est = got
            if est is not None:
                e.estimate = est
            if keep < len(refs_all):
                self.note(e, f"dropped {len(refs_all) - keep} reference pictures "
                          "to stay within the limit for one attempt"
                          + (FORCED_THINKING_WHY if forced
                             else THINKING_WHY if thinking else ""))
            try:
                pic = image_gemini.draw(job.model, self.key, prompt,
                                        refs_all[:keep], e.shape, SIZE, thinking)
            except image_gemini.NeedsThinking:
                # Nothing was charged. Work it out again with thinking on.
                thinking = True
                continue
            except image_gemini.Refused as refusal:
                self.refused(e, refusal, est)
                return
            except image_gemini.ServiceError as err:
                self.service_error(e, err, est)
                return
            self.picture(e, pic, est)
            return

    def picture(self, e: Entry, pic: image_gemini.Picture, est: float | None) -> None:
        redo = e.status == "drawn"
        cents = self.count(e, pic.usage, est)
        if self.keep_picture(e, pic):
            e.status = "drawn"
            self.result.drawn += 1
            self.streak = 0
            self.say(e, f"drawn, {e.pending}.{e.ext}, {self.money_words(cents)}")
        elif redo:
            self.lost_redraw(e, "the new picture could not be saved")
            self.say(e, "the new picture was paid for but could not be saved; "
                     f"{self.money_words(cents)} counted; the earlier picture "
                     "is kept")
            self.result.ok = False
            self.halt("the picture could not be saved")
        else:
            e.status = "failed"
            self.remember(e, "the picture was paid for but could not be saved")
            self.say(e, "the picture was paid for but could not be saved to "
                     f"{e.pending}.{pic.ext}; {self.money_words(cents)} counted")
            self.result.ok = False
            self.halt("the picture could not be saved")
        self.save(e)

    def lost_redraw(self, e: Entry, reason: str) -> None:
        """A redraw failed: the earlier picture, still drawn, is kept."""
        self.remember(e, f"the redraw failed ({reason}); the earlier picture is kept")

    def refused(self, e: Entry, refusal: image_gemini.Refused, est: float | None) -> None:
        redo = e.status == "drawn"
        cents = self.count(e, refusal.usage, est)
        why = f"the service declined: {self.clean(refusal.reason)}"
        self.streak = 0
        self.result.ok = False
        if redo:
            self.lost_redraw(e, why)
            self.say(e, f"redraw failed, {why}; the earlier picture is kept "
                     f"({self.money_words(cents)} counted)")
        else:
            e.status = "refused"
            self.remember(e, why)
            self.remember(e, "plan it again with a different description")
            self.say(e, f"refused, {why}; plan it again with a different "
                     f"description ({self.money_words(cents)} counted)")
        self.save(e)

    def service_error(self, e: Entry, err: image_gemini.ServiceError,
                      est: float | None) -> None:
        redo = e.status == "drawn"
        message = self.clean(err.message)
        self.result.ok = False
        if err.billed or err.maybe_billed:
            cents = self.count(e, err.usage, est)
            counted = (f"{self.money_words(cents)} counted" if err.billed else
                       "the reply was lost; it may have been charged, so it is "
                       + (f"counted at {cents:.2f} cents to be safe"
                          if cents is not None else
                          "counted as one picture at an unknown price"))
            if err.kind == "network":
                message = message.rstrip(".") + "." + SANDBOX
            if redo:
                self.lost_redraw(e, message)
                self.say(e, f"redraw failed, {message} ({counted}); the earlier "
                         "picture is kept")
            else:
                e.status = "failed"
                self.remember(e, message)
                self.say(e, f"failed, {message} ({counted})")
            self.fail_once()
            self.save(e)
            return
        if err.kind == "auth":
            self.say(e, f"not drawn, {message} Check the key: gma image key "
                     f"{self.job.service}")
            self.halt(message)
            return
        if err.kind == "quota":
            self.say(e, f"not drawn, {message} Check the account's limit or "
                     "balance with the service.")
            self.halt(message)
            return
        if err.kind == "network":
            message = message.rstrip(".") + "." + SANDBOX
        # No attempt is used. A picture already drawn (a redo) stays as it was.
        if not redo:
            e.status = "failed"
            self.remember(e, message)
        self.say(e, f"not drawn, {message}")
        self.fail_once()
        if not redo:
            self.save(e)

    def fail_once(self) -> None:
        self.streak += 1
        if self.streak >= FAILURES_IN_A_ROW:
            self.halt(f"{FAILURES_IN_A_ROW} pictures in a row could not be "
                      "drawn, so the run stopped")


def _check_redo(job: Job, redo: dict[int, str]) -> tuple[dict[int, str], list[int]]:
    """The redo notes, tidied and cut to REDO_CHARS (the numbers cut are
    returned too), or a `Stop` before anything is sent."""
    by_n = {e.n: e for e in job.entries}
    out: dict[int, str] = {}
    cut: list[int] = []
    for n, what in redo.items():
        e = by_n.get(n)
        if e is None:
            raise Stop(f"There is no picture {n} in job {job.id}.")
        if e.status == "refused":
            raise Stop(f"Picture {n} was declined by the service and cannot "
                       "be redone: plan it again with a different description.")
        if e.status != "drawn":
            raise Stop(f"Picture {n} has not been drawn yet, so it cannot be "
                       "redone. Draw it first.")
        what = what.strip().rstrip(".").strip()
        if not what:
            raise Stop(f"Say what was wrong with picture {n}.")
        if len(what) > REDO_CHARS:
            cut.append(n)
        out[n] = what[:REDO_CHARS]
    return out, sorted(cut)


def draw(job: Job, redo: dict[int, str], today: date,
         result: DrawResult | None = None) -> DrawResult:
    """Send every planned or failed picture, and every drawn picture named in
    `redo` (picture number -> what was wrong), one at a time. See the note at
    the head of this section for the rules every paid call keeps. `result`
    may be given so a caller still holds the report if something escapes."""
    result = result if result is not None else DrawResult()
    if job.service != "gemini":
        raise Stop(f"There is no drawing service called {job.service}.")
    vault = Path(job.vault)
    redo, cut = _check_redo(job, redo)
    lim = image_money.limits(vault)
    # Whether a picture can be priced is decided now, as `plan` decides it, not
    # read from the plan: the GM may have changed the price settings since.
    priced = image_jobs.is_priced(job.model, lim.price)
    if not priced and not lim.unpriced:
        raise Stop(image_jobs.unpriced_message(job.model))
    job.priced = priced
    run = _Run(job, vault, today, lim, find_key(job.service), priced, result)
    for n in cut:
        result.lines.append(
            f"Your note on picture {n} was cut to {REDO_CHARS} characters.")
    allowed = 1 + lim.redraws
    try:
        for e in job.entries:
            is_redo = e.n in redo
            if not (is_redo or e.status in ("planned", "failed")):
                run.say(e, "already drawn, nothing sent" if e.status == "drawn"
                        else e.status)
                continue
            if run.stop is not None:
                run.say(e, f"not drawn, {run.stop}")
                result.ok = False
                continue
            if e.attempts >= allowed:
                result.ok = False
                if is_redo:
                    run.say(e, "not drawn, no redraws left (the vault allows "
                            f"{lim.redraws})")
                else:
                    run.say(e, f"picture {e.n} has used all its attempts "
                            f"(the vault allows {allowed})")
                continue
            run.attempt(e, redo.get(e.n))
    finally:
        result.job_cents = job.spent
        try:
            image_jobs.save(job)
        except OSError:
            if result.ok:
                result.lines.append("The job could not be saved.")
            result.ok = False
    return result
