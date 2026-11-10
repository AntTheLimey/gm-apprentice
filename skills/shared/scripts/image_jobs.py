"""Picture jobs: plan which pictures to draw, and keep the plan on disk.

`plan` resolves each requested note, builds the whole prompt from the
vault's Image Guidance note, finds likeness reference pictures, applies the
vault's spending limits and saves a job in the machine's cache folder. It
makes no network call and writes nothing into the vault. The job file holds
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
    spent: float
    entries: list[Entry]


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
    model, price, chars = lim.model, lim.price, len(e.prompt.encode("utf-8"))

    def cost(k: int) -> float:
        if price is not None:
            return price
        got = image_gemini.estimate(model, SIZE, k, chars, lim.thinking)
        assert got is not None
        return got
    fitted = image_money.fit(cost, len(refs), lim.attempt)
    if fitted is None:
        _refuse(e, "over the limit for one attempt")
        return None
    keep, e.estimate = fitted
    if keep < len(refs):
        e.said.append(f"dropped {len(refs) - keep} reference pictures "
                      "to stay within the limit for one attempt")
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
    try:
        key = image_keys.find(lim.service)
    except image_keys.StoreUnavailable as busy:
        raise Stop(str(busy)) from None
    except ValueError:
        raise Stop(f"There is no drawing service called {lim.service}.") from None
    if key is None:
        raise Stop(f"No key found for {lim.service}. Run in your own "
                   f"terminal: gma image key {lim.service}")
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
              spent=month_spent, entries=entries)
    try:
        save(job)
    except OSError as err:
        raise Stop("The picture job could not be saved "
                   f"({err.__class__.__name__}).") from None
    return job
