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
from typing import Any

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
    data = json.loads(job_file(job_id).read_text(encoding="utf-8"))
    entries = [Entry(**e) for e in data.pop("entries")]
    return Job(**data, entries=entries)


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
    if not root.is_dir():
        return
    for d in sorted(root.iterdir()):
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
    raw = (fm or {}).get("portrait")
    if not isinstance(raw, str):
        return ""
    text = raw.strip()
    if text.startswith("[[") and text.endswith("]]"):
        text = re.split(r"[|#]", text[2:-2], maxsplit=1)[0].strip()
    return text


def _recap_paragraphs(text: str) -> list[str] | None:
    lines = text.split("\n")
    for title in ("Narrative Recap", "Recap"):
        found = vl.find_section_lines(lines, [title], first=True)
        if isinstance(found, tuple):
            start, end = found
            paras: list[str] = []
            cur: list[str] = []
            for ln in lines[start + 1:end]:
                if ln.strip() and not vl.SECTION_HEADING_RE.match(ln):
                    cur.append(ln.strip())
                elif cur:
                    paras.append(" ".join(cur))
                    cur = []
            if cur:
                paras.append(" ".join(cur))
            return paras
    return None


def _squash(s: str) -> str:
    return " ".join(unicodedata.normalize("NFC", s).split()).casefold()


def _reference(vault: Path, batch: vw.Batch, names: dict[str, list[str]],
               raw: str) -> tuple[str | None, str | None]:
    """(absolute path, None) for a usable likeness picture, else (None, why)."""
    try:
        rel = section.resolve_note(batch, raw, names)
        fm = vl.extract_frontmatter(batch.read(rel))
    except vw.WriteError:
        return None, f"left out the reference picture for {raw}: no such note"
    portrait = _portrait(fm)
    if not portrait:
        return None, f"left out the reference picture for {raw}: it has no portrait"
    path = vault / portrait
    try:
        if path.stat().st_size > MAX_REF_BYTES:
            return None, (f"left out the reference picture for {raw}: "
                          "it is over 5 MB")
        head = path.read_bytes()[:8]
    except FileNotFoundError:
        return None, f"left out the reference picture for {raw}: the file is missing"
    except OSError:
        return None, f"left out the reference picture for {raw}: it could not be read"
    if not (head.startswith(b"\x89PNG\r\n\x1a\n") or head.startswith(b"\xff\xd8\xff")):
        return None, (f"left out the reference picture for {raw}: "
                      "it is not a PNG or JPEG")
    return str(path.resolve()), None


def plan(vault: Path, requests: list[dict[str, Any]], unprompted: bool,
         today: date) -> Job:
    requests = check_requests(requests)
    lim = image_money.limits(vault)
    if not lim.service or not lim.model:
        raise Stop("Choose a picture service and model first: gma publish "
                   "settings set vault.images.service gemini …")
    if image_keys.find(lim.service) is None:
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
    batch = vw.Batch(vault)
    names = section.name_index(vl.vault_files(vault))
    entries: list[Entry] = []

    for n, req in enumerate(requests, 1):
        said: list[str] = []
        if n == 1 and not guidance.found:
            said.append("No Image Guidance note yet; pictures are drawn "
                        "with no campaign style.")
        e = Entry(n=n, note=req["for"], kind="", prompt="", refs=[],
                  shape="", pending=str(folder(job_id) / f"{n:02d}"), dest="",
                  after=req.get("after"), replace=req.get("replace") is True,
                  estimate=None, status="refused", said=said)
        entries.append(e)

        def refuse(why: str, e: Entry = e) -> None:
            e.status = "refused"
            e.said.append(why)

        try:
            rel = section.resolve_note(batch, req["for"], names)
            text = batch.read(rel)
        except vw.WriteError as err:
            refuse(str(err))
            continue
        e.note = rel
        fm = vl.extract_frontmatter(text)
        etype = vl.entity_type(fm)
        kind = "scene" if etype in vl.WRAP_UP_TYPES else etype
        e.kind = kind
        if kind not in SHAPES:
            refuse(f"pictures for a {kind or 'plain'} note are not supported yet")
            continue
        e.shape = SHAPES[kind]
        if unprompted:
            if kind == "pc":
                refuse("a player's character is drawn only when asked for")
                continue
            if kind not in lim.kinds:
                refuse(f"{kind} pictures are not drawn without being asked for")
                continue
        if kind == "scene":
            name = req.get("name", "").strip()
            after = (e.after or "").strip()
            if not name or not after:
                refuse("a scene picture needs both `after` (the opening words "
                       "of the recap paragraph) and `name`")
                continue
            e.dest = _dest(kind, rel, name)
        else:
            e.dest = _dest(kind, rel, None)
        if not e.replace:
            has = _file_at(vault, e.dest) or (
                kind != "scene" and bool(_portrait(fm)))
            if has:
                refuse("it already has a picture")
                continue
        if kind == "scene":
            paras = _recap_paragraphs(text)
            want = _squash(e.after or "")
            hits = [p for p in (paras or []) if _squash(p).startswith(want)]
            if len(hits) != 1:
                refuse(f"the opening words {e.after!r} match "
                       + ("no paragraph" if not hits
                          else f"{len(hits)} paragraphs")
                       + " of the Narrative Recap; they must match exactly one")
                continue
        # References, most important first.
        refs: list[str] = []
        for raw in req.get("shows", []):
            path, why = _reference(vault, batch, names, raw)
            if why:
                said.append(why)
            elif path:
                refs.append(path)
        room_for = image_gemini.ACCEPTS.references
        if len(refs) > room_for:
            said.append(f"left out {len(refs) - room_for} reference pictures: "
                        f"the service takes {room_for}")
            refs = refs[:room_for]
        prompt, missing = image_guidance.compose(
            guidance, req.get("blocks", []), req["subject"])
        for m in missing:
            said.append(f"no block called {m!r} in the Image Guidance note")
        e.prompt = prompt
        if priced:
            model = lim.model
            price = lim.price

            def cost(k: int, model: str = model, price: float | None = price,
                     chars: int = len(prompt)) -> float:
                if price is not None:
                    return price
                got = image_gemini.estimate(model, SIZE, k, chars)
                assert got is not None
                return got
            fitted = image_money.fit(cost, len(refs), lim.attempt)
            if fitted is None:
                refuse("over the limit for one attempt")
                continue
            keep, e.estimate = fitted
            if keep < len(refs):
                said.append(f"dropped {len(refs) - keep} reference pictures "
                            "to stay within the limit for one attempt")
                refs = refs[:keep]
        e.refs = refs
        e.status = "planned"

    if priced:
        run_spent = 0.0
        stopped: str | None = None
        for e in entries:
            if e.status != "planned":
                continue
            assert e.estimate is not None
            why = stopped or image_money.room(lim, run_spent, month_spent,
                                              e.estimate)
            if why:
                stopped = why
                e.status = "trimmed"
                e.said.append(why)
            else:
                run_spent += e.estimate

    job = Job(id=job_id, vault=str(vault), service=lim.service,
              model=lim.model, priced=priced, unprompted=unprompted,
              spent=month_spent, entries=entries)
    save(job)
    return job
