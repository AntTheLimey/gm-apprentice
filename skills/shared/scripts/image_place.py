"""Place kept pictures: file them in the vault, link them, leave the rest.

`place` runs after `draw`, once the assistant has looked at every drawn
picture and given a verdict. A kept picture is copied from the job folder to
its place under `_attachments/` (the job keeps its copy); an entity note gets its `portrait` set, a
Wrap-Up gets an `![[embed]]` after its recap paragraph. A held picture
stays in the job folder. Without `write` nothing moves and nothing is
written. A picture that exists is never replaced unless the plan said
`replace`. Stdlib only.
"""

from __future__ import annotations

import os
import re
import secrets
import shutil
import unicodedata
from urllib.parse import quote
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import image_jobs
import ingest_images
import vault_write as vw
import vaultlib as vl
from image_jobs import Entry, Job, Stop


@dataclass
class Result:
    lines: list[str]
    ok: bool


@dataclass
class _Copy:
    """One picture going into the vault, recorded before it is touched."""
    src: Path
    target: Path
    existed: bool                 # a different picture sits at the target
    backup: Path | None = None    # its copy in the job folder, once made
    tmp: Path | None = None


@dataclass
class _Action:
    entry: Entry
    copy: _Copy
    note: str
    embed: str | None
    old: list[str]          # vault-relative old picture files to retire
    done: bool = False      # our own earlier copy is already at the target
    stage: Callable[[str], bool] | None = None   # (re)write the note edit
    rel: str = ""           # the vault path the picture is filed under


# --- the embed ---------------------------------------------------------------

_EMBED = re.compile(r"!\[\[([^\]\n|#]+)([^\]\n]*)\]\]")


def _names_the_file(named: str, filename: str, folder: Path | None) -> bool:
    """Whether an embed naming `named` points at the picture filed as
    `filename` in `folder`: the same name, or a name that differs in case
    only and that the disk says is the very same file."""
    if named == filename:
        return True
    return (folder is not None and _fold(named) == _fold(filename)
            and _same_file(folder / named, folder / filename))


def embed_after(text: str, after: str, filename: str,
                folder: Path | None = None) -> str | None:
    """The note's text with `![[filename]]` on its own line, a blank line
    each side, directly after the one recap paragraph that starts with
    `after`; the text unchanged when an embed of that picture (a display
    size or alias after the name does not matter) is already in the run of
    embeds there; None when zero or several paragraphs match. `folder` is
    where the picture is filed."""
    spans = image_jobs.recap_spans(text)
    if spans is None:
        return None
    hits = image_jobs.after_hits(spans, after)
    if len(hits) != 1:
        return None
    last = spans[hits[0]][1]
    lines = text.split("\n")
    embed = f"![[{filename}]]"
    for ln in lines[last + 1:]:
        if not ln.strip():
            continue
        if not ln.strip().startswith("![["):
            break
        m = _EMBED.fullmatch(ln.strip())
        if m and _names_the_file(m.group(1).strip(), filename, folder):
            return text
    cr = "\r" if lines[last].endswith("\r") else ""
    if last + 1 >= len(lines):
        block = ["" + cr, embed + cr, ""]
    else:
        block = ["" + cr, embed + cr]
        if lines[last + 1].strip():
            block.append("" + cr)
    lines[last + 1:last + 1] = block
    return "\n".join(lines)


def _retarget(text: str, old: str, new: str) -> str:
    """Every embed of the file `old` now names `new`; a size stays."""
    def swap(m: re.Match[str]) -> str:
        return f"![[{new}{m.group(2)}]]" if m.group(1).strip() == old else m.group(0)
    return _EMBED.sub(swap, text)


def exact_embed_names(text: str, filename: str, folder: Path) -> str:
    """The text with every embed in the recap that names the picture filed
    as `filename` in `folder` in other letter case now naming it exactly:
    the name on disk wins. An embed of a different file is left alone."""
    lines = text.split("\n")
    for title in ("Narrative Recap", "Recap"):
        found = vl.find_section_lines(lines, [title], first=True)
        if not isinstance(found, tuple):
            continue

        def fix(m: re.Match[str]) -> str:
            same = _names_the_file(m.group(1).strip(), filename, folder)
            return f"![[{filename}{m.group(2)}]]" if same else m.group(0)
        start, end = found
        for i in range(start + 1, end):
            lines[i] = _EMBED.sub(fix, lines[i])
        break
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


def _fold(s: str) -> str:
    return unicodedata.normalize("NFC", s).casefold()


def _same_bytes(a: Path, b: Path) -> bool:
    try:
        return a.stat().st_size == b.stat().st_size and a.read_bytes() == b.read_bytes()
    except OSError:
        return False


def _same_file(a: Path, b: Path) -> bool:
    try:
        return os.path.samefile(a, b)
    except OSError:
        return False


def _linked(vault: Path, batch: vw.Batch, rel: str) -> bool:
    """Whether anything in the vault might use the picture `rel`: any note
    or canvas outside hidden folders (templates and the inbox included)
    that holds its file name or path, plain or URL-encoded, ignoring case.
    A note this run changes counts as it will be left; one that cannot be
    read, and a folder that cannot be listed, count as a use. When in
    doubt: yes."""
    seen = {_fold(Path(rel).name), _fold(rel),
            _fold(quote(Path(rel).name)), _fold(quote(rel))}
    unlistable: list[OSError] = []
    for top, dirs, files in os.walk(vault, onerror=unlistable.append):
        dirs[:] = [d for d in dirs if not d.startswith(".")]
        for name in files:
            if name.startswith(".") or Path(name).suffix.lower() not in (
                    ".md", ".canvas"):
                continue
            path = Path(top) / name
            key = path.relative_to(vault).as_posix()
            text = batch.texts.get(key)
            if text is None:
                try:
                    text = path.read_text(encoding="utf-8")
                except (OSError, UnicodeDecodeError):
                    return True     # cannot tell, so it may use the picture
            text = _fold(text)
            if any(w in text for w in seen):
                return True
    return bool(unlistable)     # a folder that cannot be listed may hold a use


def _disk_rel(vault: Path, target: Path, planned: str) -> str:
    """The vault path of the file at `target` under the name the folder
    listing gives it (the disk may keep an existing name that differs from
    the planned one only in case); the planned path when nothing is there."""
    try:
        names = sorted(os.listdir(target.parent))
    except OSError:
        return planned
    same = [n for n in names if _same_file(target.parent / n, target)]
    if not same:
        return planned
    n = target.name if target.name in same else same[0]
    return (Path(planned).parent / n).as_posix()


def _existing(vault: Path, dest: str) -> list[str]:
    """Pictures at `dest` under any extension, names compared case-folded."""
    folder = _inside(vault, dest)
    if folder is None:
        return []
    want = _fold(Path(dest).name)
    try:
        names = sorted(os.listdir(folder.parent))
    except OSError:
        return []
    return [(Path(dest).parent / n).as_posix() for n in names
            if (folder.parent / n).is_file()
            and _fold(Path(n).stem) == want]


def _portrait_of(lines: list[str], close: int) -> tuple[str, bool]:
    """The note's portrait as (path, odd): odd when the field is a list or
    has child lines, which is never blank."""
    for i in range(1, close):
        m = re.match(r"portrait:(.*)$", lines[i].rstrip("\r\n"))
        if not m:
            continue
        raw = m.group(1).strip()
        nxt = lines[i + 1] if i + 1 < close else ""
        if raw[:1] in ("[", "{", "|", ">") or (
                raw in ("", "#") and nxt[:1] in (" ", "\t", "-")):
            return "", True
        value = vl.scalar_value(raw) if raw else ""
        return ("" if value.casefold() in ("null", "~") else value), False
    return "", False


def _set_portrait(lines: list[str], close: int, value: str) -> str:
    eol = "\r\n" if lines[0].endswith("\r\n") else "\n"
    fm = lines[1:close]
    vl.set_key(fm, "portrait", vl.yaml_scalar(value), eol)
    return "".join([lines[0], *fm, *lines[close:]])


# --- planning one picture ---------------------------------------------------------

def _prepare(vault: Path, batch: vw.Batch, e: Entry,
             lines: list[str]) -> _Action | None:
    """Every check for one kept picture, and its note change worked out in
    memory; nothing is touched. None (with a line saying why) when it
    cannot be placed."""
    def no(why: str) -> None:
        lines.append(f"{why}; picture {e.n} was not placed")

    src = _pending(e)
    if not src.is_file():
        lines.append(f"picture {e.n}'s file is missing from the job; "
                     "draw it again")
        return None
    rel_new = f"{e.dest}.{e.ext}"
    target = _inside(vault, rel_new)
    if target is None or not e.dest:
        no("it goes outside the vault")
        return None
    try:
        note = batch.resolve(e.note)
        text = batch.read(note)
    except vw.WriteError as bad:
        no(str(bad))
        return None
    # Pictures already at the destination, whatever the extension or case.
    here = _existing(vault, e.dest)
    done = False
    for h in list(here):
        full = vault / h
        # "Already filed" needs the very file at the target; the wider
        # case-folded match above only ever blocks.
        if (_same_file(full, target) or h == rel_new) and _same_bytes(full, src):
            done = True
            here.remove(h)
    old = list(here)
    tl = text.split("\n")
    tlk = [ln + "\n" for ln in tl[:-1]] + ([tl[-1]] if tl[-1] else [])
    close, err = vl.frontmatter_span(tlk)
    portrait, odd = "", False
    if err:
        if e.kind != "scene":
            no(f"{note} has no frontmatter to hold a picture"
               if err.startswith("no frontmatter")
               else f"{note} has frontmatter that could not be read")
            return None
    elif e.kind != "scene":
        portrait, odd = _portrait_of(tlk, close)
    if odd:
        no(f"{note} already has a picture (its portrait is not a single path)")
        return None
    if e.kind != "scene" and portrait and _fold(portrait) != _fold(rel_new):
        if not e.replace:
            no(f"{note} already has a portrait")
            return None
        if portrait not in old:
            old.append(portrait)
    if old and not e.replace:
        no(f"{e.dest} already has a picture")
        return None
    base = text

    def stage(rel: str) -> bool:
        """Put the note edit for a picture filed at `rel` into the batch."""
        if e.kind == "scene":
            name = Path(rel).name
            body = base
            for o in old:
                # An old picture that is not the very file filed has its
                # embed pointed at the new one; the very file is only a
                # spelling, which exact_embed_names settles.
                if Path(o).name != name and not _same_file(vault / o, vault / rel):
                    body = _retarget(body, Path(o).name, name)
            filed = (vault / rel).parent
            body = exact_embed_names(body, name, filed)
            new_text = embed_after(body, e.after or "", name, filed)
        else:
            new_text = _set_portrait(tlk, close, rel)
        if new_text is None:
            return False
        batch.put(note, new_text)
        return True

    rel_now = _disk_rel(vault, target, rel_new)
    if not stage(rel_now):
        no("the recap changed since the plan")
        return None
    existed = target.exists() and not done
    return _Action(e, _Copy(src, target, existed), note,
                   Path(rel_now).name if e.kind == "scene" else None,
                   old, done, stage, rel_now)


# --- doing it -----------------------------------------------------------------

class _Late(Exception):
    """A file appeared at a picture's target after the checks."""


def _copy_in(c: _Copy, spare: Path, dest: str, n: int) -> None:
    """Copy the picture in beside its target, then swap it into place. The
    picture it replaces is copied to the job folder first. A file the checks
    did not see (cloud sync, say) is never overwritten, nor removed by an
    undo: the same bytes count as placed, other bytes raise `_Late`."""
    c.target.parent.mkdir(parents=True, exist_ok=True)
    if not c.existed and (c.target.exists() or c.target.is_symlink()):
        c.existed = True                    # not ours: an undo leaves it
        if _same_bytes(c.target, c.src):
            return
        raise _Late(f"{dest} already has a picture; picture {n} was not placed")
    if c.existed:
        shutil.copyfile(c.target, spare)
        c.backup = spare
    c.tmp = c.target.with_name(f".{c.target.name}.{secrets.token_hex(4)}.tmp")
    shutil.copyfile(c.src, c.tmp)
    os.replace(c.tmp, c.target)
    c.tmp = None


def _undo(copies: list[_Copy]) -> list[str]:
    """Put every recorded copy back as it was; say exactly what failed."""
    stuck: list[str] = []
    for c in reversed(copies):
        try:
            if c.tmp is not None:
                c.tmp.unlink(missing_ok=True)
            if c.existed:
                if c.backup is not None and c.backup.exists() \
                        and not _same_bytes(c.backup, c.target):
                    back = c.target.with_name(
                        f".{c.target.name}.{secrets.token_hex(4)}.tmp")
                    shutil.copyfile(c.backup, back)
                    os.replace(back, c.target)
            else:
                c.target.unlink(missing_ok=True)
        except OSError:
            where = f" (the original is at {c.backup})" if c.backup else ""
            stuck.append(f"{c.target}{where}")
    return stuck


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


def _retire(vault: Path, batch: vw.Batch, a: _Action, lines: list[str]) -> None:
    """Remove the picture a replace left behind, when that is safe. Never
    raises: a problem is one line."""
    new_rel = a.rel
    for o in a.old:
        try:
            old = _inside(vault, o)
            if old is None:
                lines.append(f"  Left {o} alone; it is not inside the vault.")
            elif Path(o).suffix.lower() not in ingest_images.WEB_SAFE_EXTS:
                lines.append(f"  The old portrait value {o} is not a picture "
                             "file; left alone.")
            elif not old.is_file():
                lines.append(f"  Left {o} alone; it is not a picture file "
                             "in the vault.")
            elif a.copy.backup is not None and _same_file(old, a.copy.target):
                lines.append(f"  Replaced {new_rel}; the picture that was there "
                             f"is kept at {a.copy.backup} until this job is "
                             f"tidied away ({image_jobs.JOB_DAYS} days).")
            elif _same_file(old, a.copy.target) or _fold(o) == _fold(new_rel):
                lines.append(f"  The old picture {o} is the new picture's "
                             "own file (or differs only in case); left as it is.")
            elif _linked(vault, batch, o):
                lines.append(f"  Kept the old picture {o}; something else "
                             "links it.")
            else:
                old.unlink()
                lines.append(f"  Removed the old picture {o}.")
        except Exception as err:  # noqa: BLE001 - clean-up never fails the run
            lines.append(f"  Could not remove the old picture {o} "
                         f"({err.__class__.__name__}); it was left.")


def _is_target(vault: Path, a: _Action, o: str) -> bool:
    """Whether the old picture `o` is the very file the new one goes to."""
    old = _inside(vault, o)
    return (old is not None and _same_file(old, a.copy.target)) \
        or _fold(o) == _fold(a.rel)


def _filed(a: _Action, wrote: bool) -> str:
    verb = (("embed", "embedded") if a.embed else ("set", "set"))[wrote]
    what = f"it in {a.note}" if a.embed else f"the portrait of {a.note}"
    lead = "Filed" if wrote else "Would file"
    return f"{lead} picture {a.entry.n} at {a.rel} and {verb} {what}."


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
            planned = f"{e.dest}.{e.ext}"
            here = _inside(vault, planned)
            shown = _disk_rel(vault, here, planned) if here else planned
            lines.append(f"Picture {e.n} is already placed at {shown}")
        elif e.n in keep:
            act = _prepare(vault, batch, e, lines)
            if act is None:
                ok = False
            else:
                actions.append(act)
    if not write:
        for a in actions:
            lines.append(_filed(a, False))
            for o in a.old:
                if _is_target(vault, a, o):
                    lines.append(f"  The picture replaces the existing file {o}.")
                else:
                    lines.append(f"  Would retire the old picture {o} if "
                                 "nothing else links it")
    if not write:
        return Result(lines, ok)

    done: list[_Copy] = []
    spare = image_jobs.folder(job.id)
    try:
        for a in actions:
            if a.done:
                continue
            done.append(a.copy)          # recorded before it is touched
            _copy_in(a.copy, spare / f"replaced-{a.entry.n:02d}"
                     f".{a.entry.ext}", a.entry.dest, a.entry.n)
        for a in actions:
            # The disk decides the name: an existing file keeps its own.
            a.rel = _disk_rel(vault, a.copy.target,
                              f"{a.entry.dest}.{a.entry.ext}")
            if a.stage is None or not a.stage(a.rel):
                raise OSError("the recap changed while placing")
        vw.apply(batch)
    except BaseException as err:
        stuck = _undo(done)
        if not isinstance(err, Exception):
            raise
        why = str(err) or err.__class__.__name__
        if isinstance(err, _Late):
            lines.append(why)
            lines.append("Nothing was placed: run place again to file the others."
                         if not stuck else "These files could not be put back: "
                         + "; ".join(stuck))
        elif stuck:
            lines.append(f"The notes could not be written ({why}), and these "
                         "files could not be put back: " + "; ".join(stuck))
        else:
            lines.append(f"The notes could not be written ({why}); "
                         "the pictures were put back.")
        return Result(lines, False)
    lines.extend(_filed(a, True) for a in actions)
    for a in actions:
        a.entry.status = "kept"
    for e in held:
        e.status = "held"
    try:
        image_jobs.save(job)
    except Exception as err:  # noqa: BLE001 - the vault is changed; say so
        ok = False
        lines.append("The vault WAS changed: the pictures are in place and "
                     "linked, but the job could not be saved "
                     f"({err.__class__.__name__}). Run place again to "
                     "finish; nothing needs drawing again.")
    for a in actions:
        _retire(vault, batch, a, lines)
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
