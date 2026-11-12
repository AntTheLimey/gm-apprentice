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
import image_codex
import image_gemini
import image_jobs
import image_money
import vaultlib as vl
from image_jobs import (MAX_REF_BYTES, SIZE, Entry, Job, Stop,
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
NEEDS_THINKING = ("this model will not draw without thinking, and with it "
                  "this picture would pass the limit for one attempt")
FORCED_THINKING = ("This model will not draw without thinking, so pictures in "
                   "this batch cost more and their cost varies.")


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


class _Ref(NamedTuple):
    path: Path
    mime: str
    data: bytes


def _read_refs(e: Entry, vault: Path) -> tuple[list[_Ref], list[str]]:
    """The likeness pictures as they are now; one that has gone missing or
    changed since the plan, or that is not inside the vault (a job file is
    plain text anyone can edit), is left out, with a line saying so."""
    found: list[_Ref] = []
    notes: list[str] = []
    for raw in e.refs:
        name = Path(raw).name
        try:
            path = Path(raw).resolve()
            if not path.is_relative_to(vault.resolve()):
                notes.append(f"left out the reference picture {name}: it is "
                             "outside the vault")
                continue
        except (OSError, RuntimeError):
            notes.append(f"left out the reference picture {name}: it could not be read")
            continue
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
        found.append(_Ref(path, mime, data))
    return found, notes


def _write_picture(e: Entry, pic: image_gemini.Picture) -> bool:
    """Write the bytes whole or not at all; an earlier attempt's file (of
    any extension) is replaced."""
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
            got = image_jobs.estimate(job.model, lim.price, k, pbytes, thinking)
            assert got is not None      # priced: `draw` checked it
            return got
        fitted = image_money.fit(cost, refs, lim.attempt)
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
        cents = image_jobs.stated_price(self.job.model, self.lim.price)
        if cents is None and usage is not None:
            try:
                cents = image_gemini.cost(self.job.model, usage)
            except ValueError:
                cents = None
        if cents is None:
            cents = est
        e.attempts += 1
        e.cost = cents
        # Evidence for later estimates; never printed. Always this attempt's.
        e.usage = dict(usage) if usage is not None else None
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
        return _write_picture(e, pic)

    def money_words(self, cents: float | None) -> str:
        return "cost unknown" if cents is None else f"{image_money.cents(cents)} cents"

    def attempt(self, e: Entry, redo: str | None) -> None:
        job, lim = self.job, self.lim
        refs_all, notes = _read_refs(e, self.vault)
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
                if thinking and not forced and not got.stop:
                    why += "." + image_jobs.thinking_why(likenesses=False)
                self.remember(e, why)
                self.say(e, f"not drawn, {why}")
                self.result.ok = False
                if got.stop:
                    self.halt(got.reason)
                return
            if forced and not job.needs_thinking:
                job.needs_thinking = True
                self.note(e, FORCED_THINKING)
            keep, est = got
            if est is not None:
                e.estimate = est
            if keep < len(refs_all):
                self.note(e, f"dropped {image_jobs.counted(len(refs_all) - keep, 'reference picture')} "
                          "to stay within the limit for one attempt"
                          + (image_jobs.thinking_why(forced) if thinking else ""))
            try:
                pic = image_gemini.draw(job.model, self.key, prompt,
                                        [(r.mime, r.data) for r in refs_all[:keep]],
                                        e.shape, SIZE, thinking)
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
            except Exception:
                raise
            except BaseException:
                # Ctrl-C (or the like) while the request was out: the service
                # has usually had it and charged, so it is counted as a lost
                # reply, and then the program stops as asked.
                self.service_error(e, image_gemini.ServiceError(
                    "interrupted", "the request was interrupted",
                    maybe_billed=True), est)
                raise
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
                       + (f"counted at {image_money.cents(cents)} cents to be safe"
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
            self.say(e, f"not drawn, {message} Check the key: "
                     + vl.terminal_command("image", "key", self.job.service))
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
    if job.service == "codex":
        # Checked again now: a Codex signed in another way since the plan
        # would be charged for every picture, outside the vault's limits.
        state = image_codex.login()
        if state.state != "chatgpt":
            raise Stop(image_codex.why_not(state) + SERVICE_HINT)
        return _draw_free(job, redo, result, _CodexRun)
    if job.service == "self":
        raise Stop(SELF_HOW.format(job=job.id))
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


# --- free sources: Codex on a ChatGPT plan, and the agent's own tool --------
#
# No money is spent or counted. The redraw limit still holds, a picture
# already drawn is never drawn again unasked, and a redraw that fails keeps
# the earlier picture, as on the paid service.

SELF_HOW = ("Job {job} is drawn by you: draw each planned picture with your "
            "own image tool, save it anywhere, then hand it in with "
            "gma image draw \"<vault>\" {job} --picture N FILE (once per "
            "picture; again for a redraw).")
SERVICE_HINT = (" Run this draw again later to retry with Codex at no cost. "
                "Only if the GM agrees to pay: plan the pictures not drawn "
                "again with --source service.")


class _FreeRun:
    """What one free run shares: the report, the stop and the streak."""

    def __init__(self, job: Job, result: DrawResult) -> None:
        self.job, self.result = job, result
        self.stop: str | None = None
        self.streak = 0

    def say(self, e: Entry, text: str) -> None:
        self.result.lines.append(f"{e.n}. {e.note}: {text}")

    def remember(self, e: Entry, text: str) -> None:
        if text not in e.said:
            e.said.append(text)

    def save(self) -> None:
        try:
            image_jobs.save(self.job)
        except OSError:
            self.result.ok = False
            if self.stop is None:
                self.stop = "the job could not be saved"

    def failed(self, e: Entry, why: str, redo: bool) -> None:
        self.result.ok = False
        if redo:
            self.remember(e, f"the redraw failed ({why}); the earlier picture is kept")
            self.say(e, f"redraw failed, {why}; the earlier picture is kept")
        else:
            e.status = "failed"
            self.remember(e, why)
            self.say(e, f"not drawn, {why}")

    def got(self, e: Entry, pic: image_gemini.Picture, how: str) -> None:
        redo = e.status == "drawn"
        e.attempts += 1
        if _write_picture(e, pic):
            e.status = "drawn"
            self.result.drawn += 1
            self.streak = 0
            self.say(e, f"drawn {how}, {e.pending}.{e.ext}")
        else:
            self.failed(e, "the picture could not be saved", redo)
            self.stop = "the picture could not be saved"
        self.save()

    def attempt(self, e: Entry, redo: str | None, vault: Path) -> None:
        raise NotImplementedError


class _CodexRun(_FreeRun):
    def attempt(self, e: Entry, redo: str | None, vault: Path) -> None:
        refs, notes = _read_refs(e, vault)
        for text in notes:
            self.remember(e, text)
            self.result.lines.append(f"   {text}")
        prompt = e.prompt + (
            f"\n\nThe last attempt was wrong: {redo}. Correct it." if redo else "")
        was_drawn = e.status == "drawn"
        try:
            pic = image_codex.draw(prompt, [str(r.path) for r in refs], e.shape,
                                   Path(e.pending).parent)
        except image_codex.Refused as no:
            e.attempts += 1
            self.streak = 0
            if was_drawn:
                self.failed(e, f"Codex declined: {no.reason}", True)
            else:
                e.status = "refused"
                self.remember(e, f"Codex declined: {no.reason}")
                self.remember(e, "plan it again with a different description")
                self.result.ok = False
                self.say(e, f"refused, Codex declined: {no.reason}; plan it "
                         "again with a different description")
            self.save()
            return
        except image_codex.Failed as bad:
            self.failed(e, bad.message, was_drawn)
            self.streak += 1
            if bad.stop:
                self.stop = bad.message
            elif self.streak >= FAILURES_IN_A_ROW:
                self.stop = (f"{FAILURES_IN_A_ROW} pictures in a row could "
                             "not be drawn, so the run stopped")
            self.save()
            return
        self.got(e, pic, "by Codex on the ChatGPT plan")


def _draw_free(job: Job, redo: dict[int, str], result: DrawResult,
               kind: type[_FreeRun]) -> DrawResult:
    vault = Path(job.vault)
    redo, cut = _check_redo(job, redo)
    lim = image_money.limits(vault)
    for n in cut:
        result.lines.append(
            f"Your note on picture {n} was cut to {REDO_CHARS} characters.")
    run = kind(job, result)
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
                run.say(e, "not drawn, no redraws left (the vault allows "
                        f"{lim.redraws})" if is_redo else
                        f"picture {e.n} has used all its attempts (the vault "
                        f"allows {allowed})")
                continue
            run.attempt(e, redo.get(e.n), vault)
    finally:
        if run.stop is not None and job.service == "codex" and any(
                e.status in ("planned", "failed") for e in job.entries):
            result.lines.append(f"Stopped: {run.stop}.{SERVICE_HINT}")
        run.save()
    return result


MAX_HANDED_IN = 50 * 1024 * 1024


def hand_in(job: Job, pictures: dict[int, Path],
            result: DrawResult | None = None) -> DrawResult:
    """Pictures the agent drew with its own tool, copied into the job: each
    is an attempt, under the vault's redraw limit. Checked before any is
    taken: a number that is not in the job or a file that is not a PNG or
    JPEG stops the lot."""
    result = result if result is not None else DrawResult()
    if job.service != "self":
        raise Stop(f"Job {job.id} is drawn by {job.service}, not by you: "
                   "run gma image draw without --picture.")
    by_n = {e.n: e for e in job.entries}
    read: dict[int, image_gemini.Picture] = {}
    for n, path in pictures.items():
        e = by_n.get(n)
        if e is None:
            raise Stop(f"There is no picture {n} in job {job.id}.")
        if e.status not in ("planned", "failed", "drawn"):
            raise Stop(f"Picture {n} is {e.status}, so no picture is taken for it.")
        try:
            if path.stat().st_size > MAX_HANDED_IN:
                raise Stop(f"{path} is over 50 MB.")
            data = path.read_bytes()
        except OSError:
            raise Stop(f"{path} could not be read.") from None
        ext = dnd_ddb.image_type(data[:16])
        if ext not in ("png", "jpg"):
            raise Stop(f"{path} is not a PNG or JPEG picture.")
        read[n] = image_gemini.Picture(data, ext, None)
    lim = image_money.limits(Path(job.vault))
    allowed = 1 + lim.redraws
    run = _FreeRun(job, result)
    for n in sorted(read):
        e = by_n[n]
        if e.attempts >= allowed:
            result.ok = False
            run.say(e, "not taken, no redraws left (the vault allows "
                    f"{lim.redraws})")
            continue
        run.got(e, read[n], "by you")
    run.save()
    return result
