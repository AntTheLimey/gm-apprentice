"""Place kept pictures: file them in the vault, link them, leave the rest.

`place` runs after `draw`, once the assistant has looked at every drawn
picture and given a verdict. A kept picture moves from the job folder to
its place under `_attachments/`; an entity note gets its `portrait` set, a
Wrap-Up gets an `![[embed]]` after its recap paragraph. A held picture
stays in the job folder. Without `write` nothing moves and nothing is
written. A picture that exists is never replaced unless the plan said
`replace`. Stdlib only.
"""

from __future__ import annotations

import glob
import shutil
from dataclasses import dataclass
from pathlib import Path

import image_jobs
import vault_write as vw
import vaultlib as vl
from image_jobs import Entry, Job, Stop


@dataclass
class Result:
    lines: list[str]
    ok: bool


@dataclass
class _Move:
    src: Path
    target: Path
    backup: Path | None = None


@dataclass
class _Action:
    entry: Entry
    move: _Move
    note: str
    embed: str | None
    old: list[str]          # vault-relative old picture files to retire


# --- the embed ---------------------------------------------------------------

def embed_after(text: str, after: str, filename: str) -> str | None:
    """The note's text with `![[filename]]` on its own line, a blank line
    each side, directly after the one recap paragraph that starts with
    `after`; the text unchanged when that line is already there; None when
    zero or several paragraphs match."""
    spans = image_jobs.recap_spans(text)
    if spans is None:
        return None
    hits = image_jobs.after_hits(spans, after)
    if len(hits) != 1:
        return None
    last = spans[hits[0]][1]
    lines = text.split("\n")
    embed = f"![[{filename}]]"
    nxt = next((ln for ln in lines[last + 1:] if ln.strip()), None)
    if nxt is not None and nxt.strip() == embed:
        return text
    cr = "\r" if lines[last].endswith("\r") else ""
    block = ["" + cr, embed + cr]
    if last + 1 < len(lines) and lines[last + 1].strip():
        block.append("" + cr)
    lines[last + 1:last + 1] = block
    return "\n".join(lines)


# --- finding things ------------------------------------------------------------

def _inside(vault: Path, rel: str) -> Path | None:
    """The file `rel` names, when it stays inside the vault."""
    full = vault / rel
    try:
        full.resolve().relative_to(vault.resolve())
    except (ValueError, OSError, RuntimeError):
        return None
    return full


def _pending(e: Entry) -> Path:
    return Path(e.pending + "." + (e.ext or ""))


def _linked(vault: Path, batch: vw.Batch, rel: str) -> bool:
    """Whether any note in the vault names the picture `rel`, as a path or
    by its file name (a `portrait:` value or an embed). A plain search of
    the notes' text, as the current text of notes this run changes."""
    name = Path(rel).name
    for note, text in vl.vault_files(batch.vault):
        text = batch.texts.get(note, text)
        if name in text or rel in text:
            return True
    return False


def _set_portrait(text: str, value: str) -> str | None:
    lines = text.splitlines(keepends=True)
    close, err = vl.frontmatter_span(lines)
    if err:
        return None
    eol = "\r\n" if lines[0].endswith("\r\n") else "\n"
    fm = lines[1:close]
    vl.set_key(fm, "portrait", vl.yaml_scalar(value), eol)
    lines[1:close] = fm
    return "".join(lines)


# --- planning one picture ---------------------------------------------------------

def _prepare(job: Job, vault: Path, batch: vw.Batch, e: Entry,
             lines: list[str]) -> _Action | None:
    """Everything one kept picture needs, worked out in memory; None (with
    a line saying why) when it cannot be placed."""
    def no(why: str) -> None:
        lines.append(why)

    src = _pending(e)
    if not src.is_file():
        no(f"picture {e.n}'s file is missing from the job; draw it again")
        return None
    rel_new = f"{e.dest}.{e.ext}"
    target = _inside(vault, rel_new)
    if target is None or not e.dest:
        no(f"picture {e.n} goes outside the vault; it was not placed")
        return None
    try:
        note = batch.resolve(e.note)
        text = batch.read(note)
    except vw.WriteError as err:
        no(f"{err}; picture {e.n} was not placed")
        return None
    # What is already at the destination, whatever its extension.
    here = sorted(Path(p).relative_to(vault).as_posix() for p in
                  glob.glob(glob.escape(str(vault / e.dest)) + ".*")
                  if Path(p).is_file())
    old = list(here)
    fm = vl.extract_frontmatter(text)
    portrait = image_jobs._portrait(fm)
    if e.kind != "scene" and portrait:
        if not e.replace:
            no(f"{note} has a portrait now; picture {e.n} was not placed")
            return None
        if _inside(vault, portrait) is not None and portrait not in old:
            old.append(portrait)
    if here and not e.replace:
        no(f"{e.dest} already has a picture; picture {e.n} was not placed")
        return None
    new_text: str | None
    embed: str | None = None
    if e.kind == "scene":
        embed = Path(rel_new).name
        for o in old:
            if Path(o).name != embed:
                text = text.replace(f"![[{Path(o).name}]]", f"![[{embed}]]")
        new_text = embed_after(text, e.after or "", embed)
        if new_text is None:
            no(f"the recap changed since the plan; picture {e.n} was not placed")
            return None
    else:
        new_text = _set_portrait(text, rel_new)
        if new_text is None:
            no(f"{note} has frontmatter that could not be read; "
               f"picture {e.n} was not placed")
            return None
    batch.put(note, new_text)
    retire = [o for o in old if o != rel_new]
    return _Action(e, _Move(src, target), note, embed, retire)


# --- doing it -----------------------------------------------------------------

def _do(m: _Move, spare: Path) -> None:
    m.target.parent.mkdir(parents=True, exist_ok=True)
    if m.target.exists():
        shutil.move(str(m.target), str(spare))
        m.backup = spare
    shutil.move(str(m.src), str(m.target))


def _undo(done: list[_Move]) -> None:
    for m in reversed(done):
        if m.target.exists() and not m.src.exists():
            shutil.move(str(m.target), str(m.src))
        if m.backup is not None and m.backup.exists():
            shutil.move(str(m.backup), str(m.target))


def _check_verdicts(job: Job, keep: set[int], hold: set[int]) -> None:
    both = sorted(keep & hold)
    if both:
        raise Stop(f"picture {both[0]} is in both --keep and --hold; "
                   "it can only be one")
    by_n = {e.n: e for e in job.entries}
    for n in sorted(keep | hold):
        e = by_n.get(n)
        if e is None:
            raise Stop(f"this job has no picture {n}")
        ok = ({"drawn", "held", "kept"} if n in keep else {"drawn", "held"})
        if e.status not in ok:
            raise Stop(f"picture {n} is {e.status}, not drawn; "
                       "there is nothing to place")
    for e in job.entries:
        if e.status == "drawn" and e.n not in keep | hold:
            raise Stop(f"picture {e.n} has no verdict: look at it, "
                       "then keep or hold it")


def run(job: Job, keep: set[int], hold: set[int], write: bool) -> Result:
    """Place the kept pictures and hold the held ones. Raises Stop for
    input that is wrong; everything else is in the report."""
    _check_verdicts(job, keep, hold)
    vault = Path(job.vault)
    batch = vw.Batch(vault)
    lines: list[str] = []
    ok = True
    actions: list[_Action] = []
    held: list[Entry] = []
    for e in sorted(job.entries, key=lambda x: x.n):
        if e.n in hold:
            f = _pending(e)
            if not f.is_file():
                lines.append(f"picture {e.n}'s file is missing from the job; "
                             "draw it again")
                ok = False
            else:
                held.append(e)
                lines.append(f"{'Held' if write else 'Would hold'} picture "
                             f"{e.n}; the file stays at {f}")
        elif e.n in keep and e.status == "kept":
            lines.append(f"Picture {e.n} is already placed at "
                         f"{e.dest}.{e.ext}")
        elif e.n in keep:
            act = _prepare(job, vault, batch, e, lines)
            if act is None:
                ok = False
            else:
                actions.append(act)
    for a in actions:
        e = a.entry
        where = f"{e.dest}.{e.ext}"
        verb = (("embed", "embedded") if a.embed else ("set", "set"))[write]
        what = f"it in {a.note}" if a.embed else f"the portrait of {a.note}"
        lead = "Filed" if write else "Would file"
        lines.append(f"{lead} picture {e.n} at {where} and {verb} {what}.")
        for o in a.old:
            lines.append(f"  {'Retiring' if write else 'Would retire'} "
                         f"the old picture {o} if nothing else links it")
    if not write:
        return Result(lines, ok)

    done: list[_Move] = []
    spare = image_jobs.folder(job.id)
    try:
        for a in actions:
            _do(a.move, spare / f"replaced-{a.entry.n:02d}.{a.entry.ext}")
            done.append(a.move)
        vw.apply(batch)
    except BaseException as err:
        _undo(done)
        if not isinstance(err, Exception):
            raise
        why = str(err) or err.__class__.__name__
        lines = [ln for ln in lines if not ln.startswith("Filed ")]
        lines.append(f"The notes could not be written ({why}); "
                     "the pictures were put back.")
        return Result(lines, False)
    for a in actions:
        for o in a.old:
            if o == f"{a.entry.dest}.{a.entry.ext}":
                continue
            if _linked(vault, batch, o):
                lines.append(f"  Kept the old picture {o}; another note "
                             "links it.")
                continue
            target = _inside(vault, o)
            if target is not None:
                target.unlink(missing_ok=True)
                lines.append(f"  Removed the old picture {o}.")
        if a.move.backup is not None:
            a.move.backup.unlink(missing_ok=True)
        a.entry.status = "kept"
    for e in held:
        e.status = "held"
    image_jobs.save(job)
    return Result(lines, ok)


def place(job: Job, keep: set[int], hold: set[int], write: bool) -> list[str]:
    """The report lines for placing a job's pictures."""
    return run(job, keep, hold, write).lines


def check_vault(job: Job, vault: Path) -> None:
    try:
        same = Path(job.vault).resolve() == vault.resolve()
    except (OSError, RuntimeError):
        same = False
    if not same:
        raise Stop("that job belongs to another vault")

