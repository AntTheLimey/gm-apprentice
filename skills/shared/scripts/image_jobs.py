"""Picture jobs: plan which pictures to draw, draw them, keep it all on disk.

`plan` resolves each requested note, builds the whole prompt from the
vault's Image Guidance note, finds likeness reference pictures, applies the
vault's spending limits and saves a job in the machine's cache folder. It
makes no network call and writes nothing into the vault. `draw` sends the
planned pictures one at a time to the paid service and counts every paid reply
in the job and in the vault's month count at once. The job file holds
everything `draw` and `place` need and nothing secret. Stdlib only.
"""

from __future__ import annotations

import glob
import json
import os
import re
import secrets
import shutil
import unicodedata
from dataclasses import asdict, dataclass, field
from datetime import date
from pathlib import Path
from typing import Any, NamedTuple

import dnd_ddb
import image_gemini
import image_guidance
import image_keys
import image_money
import ingest_images
import section
import tool_cache
import vault_write as vw
import vaultlib as vl

SHAPES = {"pc": "3:4", "npc": "3:4", "creature": "3:4", "heritage": "3:4",
          "document": "3:4", "location": "16:9", "scene": "16:9",
          "faction": "1:1", "organization": "1:1", "item": "1:1"}
SIZE = "1K"
JOB_DAYS = 14
MAX_REF_BYTES = 5 * 1024 * 1024
THINKING_WHY = (" Thinking is on, which costs more: raise the limit for one "
                "attempt or turn thinking off to keep likenesses.")
STATUSES = ("planned", "refused", "trimmed", "drawn", "failed", "kept", "held")


class Stop(Exception):
    """Planning cannot go on; the message is for the GM, in plain words."""


@dataclass
class Entry:
    n: int
    note: str
    kind: str
    prompt: str
    refs: list[str]
    shape: str
    pending: str
    dest: str
    after: str | None
    replace: bool
    estimate: float | None
    status: str
    attempts: int = 0
    cost: float | None = None
    said: list[str] = field(default_factory=list)
    ext: str | None = None


@dataclass
class Job:
    id: str
    vault: str
    service: str
    model: str
    priced: bool
    unprompted: bool
    spent: float                    # cents this job has spent (draw adds to it)
    entries: list[Entry]
    needs_thinking: bool = False    # the model refused to draw without thinking


# --- the job on disk ------------------------------------------------------

def folder(job_id: str) -> Path:
    return tool_cache.cache_root() / "images" / job_id


def job_file(job_id: str) -> Path:
    return folder(job_id) / "job.json"


def save(job: Job) -> Path:
    """Write the job whole or not at all (temp file, then rename)."""
    where = job_file(job.id)
    where.parent.mkdir(parents=True, exist_ok=True)
    tmp = where.with_name(f"job.json.{secrets.token_hex(4)}.tmp")
    try:
        tmp.write_text(json.dumps(asdict(job), indent=2, ensure_ascii=False),
                       encoding="utf-8")
        os.replace(tmp, where)
    finally:
        tmp.unlink(missing_ok=True)
    return where


def load(job_id: str) -> Job:
    if (not job_id or job_id in (".", "..") or "/" in job_id
            or "\\" in job_id or os.sep in job_id or ".." in job_id):
        raise Stop(f"No picture job {job_id} on this machine.")
    try:
        data = json.loads(job_file(job_id).read_text(encoding="utf-8"))
        entries = [Entry(**e) for e in data.pop("entries")]
        return Job(**data, entries=entries)
    except FileNotFoundError:
        raise Stop(f"No picture job {job_id} on this machine.") from None
    except (OSError, ValueError, TypeError, KeyError, AttributeError):
        raise Stop(f"Picture job {job_id} could not be read.") from None


_ID_DATE = re.compile(r"^(\d{4})(\d{2})(\d{2})")


def _age_dates(path: Path) -> list[date]:
    """The dates a job folder counts as made on: the one in its name, and
    when it and its job file were last changed. The oldest decides."""
    found: list[date] = []
    m = _ID_DATE.match(path.name)
    if m:
        try:
            found.append(date(*(int(g) for g in m.groups())))
        except ValueError:
            pass
    for p in (path, path / "job.json"):
        try:
            found.append(date.fromtimestamp(p.stat().st_mtime))
        except OSError:
            pass
    return found


def prune(today: date) -> None:
    """Remove job folders older than JOB_DAYS."""
    root = tool_cache.cache_root() / "images"
    try:
        found = sorted(root.iterdir()) if root.is_dir() else []
    except OSError:
        return
    for d in found:
        if not d.is_dir():
            continue
        dates = _age_dates(d)
        if dates and (today - min(dates)).days > JOB_DAYS:
            shutil.rmtree(d, ignore_errors=True)


# --- the requests file ----------------------------------------------------

def read_requests(path: Path) -> list[dict[str, Any]]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise Stop(f"The requests file {path} was not found.") from None
    except (OSError, UnicodeDecodeError, ValueError) as e:
        raise Stop(f"The requests file {path} could not be read as JSON "
                   f"({e.__class__.__name__}).") from None
    return check_requests(data)


def check_requests(data: Any) -> list[dict[str, Any]]:
    if not isinstance(data, list) or not all(isinstance(r, dict) for r in data):
        raise Stop("The requests must be a JSON list of objects, one per picture.")
    for i, r in enumerate(data, 1):
        for key in ("for", "subject"):
            if not isinstance(r.get(key), str) or not r[key].strip():
                raise Stop(f"Request {i} needs a {key!r} (words).")
        for key in ("blocks", "shows"):
            v = r.get(key, [])
            if not isinstance(v, list) or not all(isinstance(x, str) for x in v):
                raise Stop(f"Request {i}: {key!r} must be a list of words.")
        for key in ("after", "name"):
            if key in r and not isinstance(r[key], str):
                raise Stop(f"Request {i}: {key!r} must be words.")
    return data


# --- planning -------------------------------------------------------------

def find_key(service: str) -> str:
    """The service's key, or a `Stop` saying in plain words why there is none."""
    try:
        found = image_keys.find(service)
    except image_keys.StoreUnavailable as busy:
        raise Stop(str(busy)) from None
    except ValueError:
        raise Stop(f"There is no drawing service called {service}.") from None
    if found is None:
        raise Stop(f"No key found for {service}. Run in your own "
                   f"terminal: gma image key {service}")
    return found[0]


def _unpriced_message(model: str) -> str:
    return (f"The apprentice does not know what {model} costs, so it cannot "
            "limit spending on it: the limit per attempt, the cap per run and "
            "the month's ceiling will not apply. To draw anyway: gma publish "
            "settings set vault.images.unpriced on. To keep the limits, state "
            "the price: gma publish settings set vault.images.price <cents>")


def _slug(stem: str) -> str:
    return ingest_images.slugify(unicodedata.normalize("NFC", stem))


_WRAP_TAIL = re.compile(r"[\s_-]*wrap[\s_-]*up$", re.IGNORECASE)


def _dest(kind: str, rel: str, name: str | None) -> str:
    stem = Path(rel).stem
    if kind == "scene":
        base = _WRAP_TAIL.sub("", unicodedata.normalize("NFC", stem)) or stem
        return f"_attachments/scenes/{_slug(base)}-{_slug(name or '')}"
    return f"_attachments/{ingest_images.FOLDER[kind]}/{_slug(stem)}"


def _file_at(vault: Path, dest: str) -> bool:
    """Whether any file sits at `dest` whatever its extension."""
    return any(Path(p).is_file()
               for p in glob.glob(glob.escape(str(vault / dest)) + ".*"))


def _portrait(fm: dict[str, Any] | None) -> str:
    """The `portrait` field, read the way ingest_images reads it."""
    raw = (fm or {}).get("portrait")
    return vl.scalar_value(raw) if isinstance(raw, str) else ""


def recap_spans(text: str) -> list[tuple[str, int]] | None:
    """The paragraphs of the Narrative Recap (or Recap) section, each with
    the index of its last line (text split on "\n"), or None when the note
    has neither. Code fences and headings are not paragraphs."""
    lines = text.split("\n")
    for title in ("Narrative Recap", "Recap"):
        found = vl.find_section_lines(lines, [title], first=True)
        if not isinstance(found, tuple):
            continue
        start, end = found
        paras: list[tuple[str, int]] = []
        cur: list[str] = []
        fence: str | None = None
        for i in range(start + 1, end):
            ln = lines[i]
            fence, is_fence_line = vl.fence_step(ln, fence)
            if (is_fence_line or fence is not None
                    or vl.SECTION_HEADING_RE.match(ln) or not ln.strip()):
                if cur:
                    paras.append((" ".join(cur), i - 1))
                    cur = []
                continue
            cur.append(ln.strip())
        if cur:
            paras.append((" ".join(cur), end - 1))
        return paras
    return None


def after_hits(spans: list[tuple[str, int]], after: str) -> list[int]:
    """Which recap paragraphs open with the words `after` (runs of
    whitespace as one space, case ignored): the indexes into `spans`. The
    one rule `plan` and `place` both find a scene's paragraph by."""
    want = _squash(after)
    return [i for i, (p, _) in enumerate(spans) if _squash(p).startswith(want)]


def _squash(s: str) -> str:
    return " ".join(unicodedata.normalize("NFC", s).split()).casefold()


CHARACTER_KINDS = ("pc", "npc", "creature")


class _Ref(NamedTuple):
    note: str
    path: str
    character: bool


def _reference(ctx: _Ctx, raw: str) -> tuple[_Ref | None, str | None]:
    """A usable likeness picture, else the plain line saying why not."""
    def skip(why: str) -> tuple[None, str]:
        return None, f"left out the reference picture for {raw}: {why}"
    try:
        rel = section.resolve_note(ctx.batch, raw, ctx.names)
        fm = vl.extract_frontmatter(ctx.batch.read(rel))
    except vw.WriteError:
        return skip("no such note")
    portrait = _portrait(fm)
    if not portrait:
        return skip("it has no portrait")
    root = ctx.vault.resolve()
    try:
        path = (ctx.vault / portrait).resolve()
        if not path.is_relative_to(root):
            return None, (f"{raw}'s picture is outside the vault; "
                          "not used as a reference")
        if path.stat().st_size > MAX_REF_BYTES:
            return skip("it is over 5 MB")
        head = path.read_bytes()[:8]
    except FileNotFoundError:
        return skip("the file is missing")
    except (OSError, ValueError, RuntimeError):
        return skip("it could not be read")
    if not (head.startswith(b"\x89PNG\r\n\x1a\n") or head.startswith(b"\xff\xd8\xff")):
        return skip("it is not a PNG or JPEG")
    return _Ref(rel, str(path), vl.entity_type(fm) in CHARACTER_KINDS), None


def _gather_refs(ctx: _Ctx, e: Entry, shows: list[str]) -> list[str]:
    """Rule 7: the likeness pictures, in order, within the service's caps."""
    accepts = image_gemini.ACCEPTS
    found: list[_Ref] = []
    seen: set[str] = set()
    for raw in shows:
        ref, why = _reference(ctx, raw)
        if why:
            if why not in e.said:
                e.said.append(why)
        elif ref and ref.note not in seen:
            seen.add(ref.note)
            found.append(ref)
    kept: list[str] = []
    characters = 0
    for ref in found:
        if ref.character and characters >= accepts.characters:
            e.said.append(f"only {accepts.characters} character likenesses "
                          f"can be sent with one picture; {ref.note} was left out")
        elif len(kept) >= accepts.references:
            e.said.append(f"only {accepts.references} reference pictures can "
                          f"be sent with one picture; {ref.note} was left out")
        else:
            kept.append(ref.path)
            characters += ref.character
    return kept


@dataclass
class _Ctx:
    vault: Path
    lim: image_money.Limits
    guidance: image_guidance.Guidance
    batch: vw.Batch
    names: dict[str, list[str]]
    priced: bool
    unprompted: bool


def _refuse(e: Entry, why: str) -> None:
    e.status = "refused"
    e.said.append(why)


def _read_note(ctx: _Ctx, e: Entry, raw: str) -> tuple[str, dict[str, Any] | None] | None:
    """Find the note and its kind; refuse when it is not one we can draw."""
    try:
        rel = section.resolve_note(ctx.batch, raw, ctx.names)
        text = ctx.batch.read(rel)
    except vw.WriteError as err:
        _refuse(e, str(err))
        return None
    e.note = rel
    fm = vl.extract_frontmatter(text)
    etype = vl.entity_type(fm)
    e.kind = "scene" if etype in vl.WRAP_UP_TYPES else etype
    if e.kind not in SHAPES:
        _refuse(e, f"pictures for a {e.kind or 'plain'} note are not supported yet")
        return None
    e.shape = SHAPES[e.kind]
    return text, fm


def _check_unprompted(ctx: _Ctx, e: Entry) -> bool:
    """Rule 4 (per picture): a PC, or a kind not listed, is not drawn unasked."""
    if not ctx.unprompted:
        return True
    if e.kind == "pc":
        _refuse(e, "a player's character is drawn only when asked for")
    elif e.kind not in ctx.lim.kinds:
        _refuse(e, f"{e.kind} pictures are not drawn without being asked for")
    else:
        return True
    return False


def _set_dest(e: Entry, req: dict[str, Any]) -> bool:
    """The destination; refuse a scene missing its words or a name with
    nothing left of it once made into a file name."""
    name = str(req.get("name", "")).strip()
    after = (e.after or "").strip()
    if e.kind == "scene" and (not name or not after):
        _refuse(e, "a scene picture needs both `after` (the opening words "
                   "of the recap paragraph) and `name`")
        return False
    stem = _slug(Path(e.note).stem)
    if not (_slug(name) if e.kind == "scene" else stem):
        _refuse(e, "that name leaves nothing to call the picture file")
        return False
    e.dest = _dest(e.kind, e.note, name if e.kind == "scene" else None)
    return True


def _check_existing(ctx: _Ctx, e: Entry, fm: dict[str, Any] | None) -> bool:
    """Rule 5: an existing picture stays unless the request says replace."""
    if e.replace:
        return True
    if _file_at(ctx.vault, e.dest) or (e.kind != "scene" and _portrait(fm)):
        _refuse(e, "it already has a picture")
        return False
    return True


def _check_scene_place(e: Entry, text: str) -> bool:
    """Rule 6: `after` must open exactly one paragraph of the recap."""
    spans = recap_spans(text)
    if spans is None:
        _refuse(e, "this Wrap-Up has no Narrative Recap section")
        return False
    hits = after_hits(spans, e.after or "")
    if len(hits) != 1:
        _refuse(e, f"the opening words {e.after!r} match "
                + ("no paragraph" if not hits else f"{len(hits)} paragraphs")
                + " of the Narrative Recap; they must match exactly one")
        return False
    return True


def _fit_cost(ctx: _Ctx, e: Entry, refs: list[str]) -> list[str] | None:
    """Rule 8: the estimate, dropping references to fit one attempt."""
    if not ctx.priced:
        return refs
    lim = ctx.lim
    assert lim.model
    model, price = lim.model, lim.price
    prompt_bytes = len(e.prompt.encode("utf-8"))

    def cost(k: int) -> float:
        if price is not None:
            return price
        got = image_gemini.estimate(model, SIZE, k, prompt_bytes, lim.thinking)
        assert got is not None
        return got
    fitted = image_money.fit(cost, len(refs), lim.attempt)
    if fitted is None:
        _refuse(e, "over the limit for one attempt")
        return None
    keep, e.estimate = fitted
    if keep < len(refs):
        e.said.append(f"dropped {len(refs) - keep} reference pictures "
                      "to stay within the limit for one attempt"
                      + (THINKING_WHY if lim.thinking else ""))
    return refs[:keep]


def _plan_one(ctx: _Ctx, e: Entry, req: dict[str, Any]) -> None:
    """Rules 4 to 8 for one picture, in the brief's order."""
    got = _read_note(ctx, e, req["for"])
    if got is None or not _check_unprompted(ctx, e):
        return
    text, fm = got
    if not _set_dest(e, req) or not _check_existing(ctx, e, fm):
        return
    if e.kind == "scene" and not _check_scene_place(e, text):
        return
    refs = _gather_refs(ctx, e, req.get("shows", []))
    e.prompt, missing = image_guidance.compose(
        ctx.guidance, req.get("blocks", []), req["subject"])
    for m in missing:
        e.said.append(f"no block called {m!r} in the Image Guidance note")
    kept = _fit_cost(ctx, e, refs)
    if kept is None:
        return
    e.refs = kept
    e.status = "planned"


def _settle(entries: list[Entry], lim: image_money.Limits,
            month_spent: float, priced: bool) -> None:
    """Rules 9 and 3: go through the planned pictures in order. A picture
    for a place an earlier survivor already holds is refused; otherwise it
    is trimmed when a cap says so, or it survives and holds its place. A
    picture that was refused or trimmed never blocks a later one."""
    run_spent = 0.0
    stopped: str | None = None
    claimed: set[str] = set()
    for e in entries:
        if e.status != "planned":
            continue
        if e.dest.casefold() in claimed:
            _refuse(e, "another picture in this plan goes to the same place")
            e.prompt, e.refs, e.estimate = "", [], None
            continue
        if priced:
            assert e.estimate is not None
            why = stopped or image_money.room(
                lim, run_spent, month_spent + run_spent, e.estimate)
            if why:
                stopped = why
                e.status = "trimmed"
                e.said.append(why)
                continue
            run_spent += e.estimate
        claimed.add(e.dest.casefold())


def plan(vault: Path, requests: list[dict[str, Any]], unprompted: bool,
         today: date) -> Job:
    requests = check_requests(requests)
    lim = image_money.limits(vault)
    if not lim.service or not lim.model:
        raise Stop("Choose a picture service and model first: gma publish "
                   "settings set vault.images.service gemini …")
    find_key(lim.service)
    priced = (lim.price is not None
              or image_gemini.estimate(lim.model, SIZE, 0, 0) is not None)
    if not priced and not lim.unpriced:
        raise Stop(_unpriced_message(lim.model))
    if unprompted and not lim.auto:
        raise Stop("Drawing without asking is off for this vault.")
    try:
        guidance = image_guidance.read(vault, lim.guidance)
    except (OSError, UnicodeDecodeError):
        raise Stop(f"The Image Guidance note at {lim.guidance} could not "
                   "be read.") from None
    month_spent = image_money.spent(vault, today)
    prune(today)

    job_id = f"{today:%Y%m%d}-{secrets.token_hex(3)}"
    ctx = _Ctx(vault, lim, guidance, vw.Batch(vault),
               section.name_index(vl.vault_files(vault)), priced, unprompted)
    entries: list[Entry] = []
    for n, req in enumerate(requests, 1):
        e = Entry(n=n, note=req["for"], kind="", prompt="", refs=[],
                  shape="", pending=str(folder(job_id) / f"{n:02d}"), dest="",
                  after=req.get("after"), replace=req.get("replace") is True,
                  estimate=None, status="refused")
        if n == 1 and not guidance.found:
            e.said.append("No Image Guidance note yet; pictures are drawn "
                          "with no campaign style.")
        entries.append(e)
        _plan_one(ctx, e, req)
    _settle(entries, lim, month_spent, priced)

    job = Job(id=job_id, vault=str(vault), service=lim.service,
              model=lim.model, priced=priced, unprompted=unprompted,
              spent=0.0, entries=entries)
    try:
        save(job)
    except OSError as err:
        raise Stop("The picture job could not be saved "
                   f"({err.__class__.__name__}).") from None
    return job


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


@dataclass
class DrawResult:
    """What one `draw` did, ready to print."""
    lines: list[str] = field(default_factory=list)
    ok: bool = True
    drawn: int = 0          # pictures drawn this run
    cents: float = 0.0      # cents counted this run (refused and failed replies too)
    unknown: int = 0        # paid replies counted with no known price


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
                 lim: image_money.Limits, key: str) -> None:
        self.job, self.vault, self.today = job, vault, today
        self.lim, self.key = lim, key
        self.result = DrawResult()
        self.stop: str | None = None       # why no later picture is attempted
        self.streak = 0                    # pictures in a row that did not come

    # -- plain helpers --

    def clean(self, text: str) -> str:
        return text.replace(self.key, "<key>") if self.key else text

    def say(self, e: Entry, text: str) -> None:
        self.result.lines.append(f"{e.n}. {e.note}: {text}")

    def note(self, e: Entry, text: str) -> None:
        e.said.append(text)
        self.result.lines.append(f"   {text}")

    def halt(self, why: str) -> None:
        if self.stop is None:
            self.stop = why

    def save(self, e: Entry | None = None) -> bool:
        """Save the job. A failure after a paid picture is said plainly."""
        try:
            save(self.job)
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
        the limit for one attempt and the run and month caps. Unpriced jobs
        have no figures, so no limit applies."""
        job, lim = self.job, self.lim
        if not job.priced:
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
        """Count one paid reply in the job (memory) and the month (disk).
        Nothing may come between the reply and this."""
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
        forced = False      # the service has just said it needs thinking
        while True:
            got = self.prepare(e, prompt, len(refs_all), thinking)
            if isinstance(got, _No):
                why = NEEDS_THINKING if forced and not got.stop else got.reason
                if why not in e.said:
                    e.said.append(why)
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
                          + (THINKING_WHY if thinking else ""))
            try:
                pic = image_gemini.draw(job.model, self.key, prompt,
                                        refs_all[:keep], e.shape, SIZE, thinking)
            except image_gemini.NeedsThinking:
                # Nothing was charged. Work it out again with thinking on.
                thinking, forced = True, True
                continue
            except image_gemini.Refused as refusal:
                self.refused(e, refusal, est)
                return
            except image_gemini.ServiceError as err:
                self.service_error(e, err, est, redo is not None)
                return
            self.picture(e, pic, est)
            return

    def picture(self, e: Entry, pic: image_gemini.Picture, est: float | None) -> None:
        cents = self.count(e, pic.usage, est)
        if self.keep_picture(e, pic):
            e.status = "drawn"
            self.result.drawn += 1
            self.streak = 0
            self.say(e, f"drawn, {e.pending}.{e.ext}, {self.money_words(cents)}")
        else:
            e.status = "failed"
            e.said.append("the picture was paid for but could not be saved")
            self.say(e, "the picture was paid for but could not be saved to "
                     f"{e.pending}.{pic.ext}; {self.money_words(cents)} counted")
            self.result.ok = False
            self.halt("the picture could not be saved")
        self.save(e)

    def refused(self, e: Entry, refusal: image_gemini.Refused, est: float | None) -> None:
        cents = self.count(e, refusal.usage, est)
        why = f"the service declined: {self.clean(refusal.reason)}"
        e.status = "refused"
        e.said.append(why)
        self.streak = 0
        self.result.ok = False
        self.say(e, f"refused, {why} ({self.money_words(cents)} counted)")
        self.save(e)

    def service_error(self, e: Entry, err: image_gemini.ServiceError,
                      est: float | None, is_redo: bool) -> None:
        message = self.clean(err.message)
        self.result.ok = False
        if err.billed:
            cents = self.count(e, err.usage, est)
            e.status = "failed"
            e.said.append(message)
            self.say(e, f"failed, {message} ({self.money_words(cents)} counted)")
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
            message += SANDBOX
        # Nothing was charged and no attempt is used. A picture already drawn
        # (a redo) stays as it was.
        if not is_redo:
            e.status = "failed"
            e.said.append(message)
        self.say(e, f"not drawn, {message} (nothing was charged)")
        self.fail_once()
        if not is_redo:
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


def draw(job: Job, redo: dict[int, str], today: date) -> DrawResult:
    """Send every planned or failed picture, and every drawn picture named in
    `redo` (picture number -> what was wrong), one at a time. See the note at
    the head of this section for the rules every paid call keeps."""
    if job.service != "gemini":
        raise Stop(f"There is no drawing service called {job.service}.")
    vault = Path(job.vault)
    redo, cut = _check_redo(job, redo)
    lim = image_money.limits(vault)
    run = _Run(job, vault, today, lim, find_key(job.service))
    for n in cut:
        run.result.lines.append(
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
                run.result.ok = False
                continue
            if e.attempts >= allowed:
                run.result.ok = False
                if is_redo:
                    run.say(e, "not drawn, no redraws left (the vault allows "
                            f"{lim.redraws})")
                else:
                    run.say(e, f"picture {e.n} has used all its attempts "
                            f"(the vault allows {allowed})")
                continue
            run.attempt(e, redo.get(e.n))
    finally:
        try:
            save(job)
        except OSError:
            if run.result.ok:
                run.result.lines.append("The job could not be saved.")
            run.result.ok = False
    return run.result
