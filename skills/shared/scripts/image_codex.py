"""Drawing through an installed Codex signed in with a ChatGPT plan.

No money is spent: the picture comes out of the plan the GM already pays for.
Codex runs headless and read-only, once per picture, and draws with its own
image tool. It keeps the picture under `$CODEX_HOME/generated_images/<thread>/`
(`~/.codex` by default) and this module copies it from there, leaving Codex's
copy alone. The shapes read here are from real runs on 2026-11-10
(tests/fixtures/image/codex-*). Stdlib only.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any, NamedTuple

import dnd_ddb
from image_gemini import Picture

SUBSCRIPTION = "Logged in using ChatGPT"
TIMEOUT = 600            # seconds for one picture; a real one took 55 to 109
LOGIN_TIMEOUT = 30
MAX_BYTES = 50 * 1024 * 1024
SAID_CHARS = 300

RUN = subprocess.run     # tests replace this
WHICH = shutil.which     # tests replace this

SHAPE_WORDS = {"3:4": "Portrait format, 3:4.", "16:9": "Landscape format, 16:9.",
               "1:1": "Square format, 1:1."}

# Words in Codex's own errors that mean no later picture will fare better.
_STOPPING = re.compile(r"usage limit|rate limit|not logged in|log ?in again|"
                       r"unauthori[sz]ed|\b401\b|credits", re.IGNORECASE)
_THREAD = re.compile(r"[A-Za-z0-9-]{1,100}")


class Login(NamedTuple):
    """How Codex is signed in: `chatgpt` (free to draw with), `other` (an API
    key or another paid sign-in), `none`, `missing` (not installed) or
    `unknown` (it did not answer). `line` says it for the GM."""
    state: str
    line: str


class Failed(Exception):
    """Codex ran and gave no picture. `stop` when no later picture in the
    run will fare better (out of plan, signed out, not installed)."""

    def __init__(self, message: str, stop: bool = False) -> None:
        super().__init__(message)
        self.message = message
        self.stop = stop


class Refused(Exception):
    """Codex said it would not draw this picture."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def _exe() -> str | None:
    return WHICH("codex")


def login() -> Login:
    exe = _exe()
    if exe is None:
        return Login("missing", "Codex is not installed")
    try:
        done = RUN([exe, "login", "status"], capture_output=True, text=True,
                   timeout=LOGIN_TIMEOUT, stdin=subprocess.DEVNULL)
    except (OSError, subprocess.TimeoutExpired):
        return Login("unknown", "Codex did not say how it is signed in")
    lines = [ln.strip() for ln in f"{done.stdout}\n{done.stderr}".splitlines()]
    if SUBSCRIPTION in lines:
        return Login("chatgpt", "Codex is signed in with a ChatGPT plan")
    if any(ln.startswith("Not logged in") for ln in lines):
        return Login("none", "Codex is installed but not signed in")
    if any(ln.startswith("Logged in") for ln in lines):
        return Login("other", "Codex is signed in with an API key or another "
                     "paid sign-in, so its pictures would be charged")
    return Login("unknown", "Codex did not say how it is signed in")


def why_not(state: Login) -> str:
    """The line a plan that wanted Codex stops with."""
    fix = {"none": " Sign it in with a ChatGPT plan: codex login",
           "missing": "",
           "other": " Sign it in with a ChatGPT plan to draw for free: codex login",
           }.get(state.state, "")
    return f"Codex cannot draw these pictures: {state.line}.{fix}"


def prompt_for(prompt: str, refs: int, shape: str) -> str:
    """The whole message Codex is sent for one picture."""
    likeness = ("The attached pictures are likeness references: keep the "
                "people and things in them recognisably the same.\n\n" if refs else "")
    return ("Use your built-in image generation tool to draw ONE picture. Do not "
            "run shell commands, do not write code, do not save or copy any "
            "file: the picture is collected from where the tool keeps it.\n\n"
            f"{likeness}The picture: {prompt}\n\n{SHAPE_WORDS.get(shape, '')}\n\n"
            "When done, reply with one word: DONE. If you cannot draw it, reply "
            "with REFUSED: and the reason.")


def command(exe: str, refs: list[str]) -> list[str]:
    # `--image=` keeps each picture to one value, so the `-` (prompt on
    # stdin) is never taken for another picture.
    return [exe, "exec", "--json", "--sandbox", "read-only",
            "--skip-git-repo-check", "--ephemeral",
            *[f"--image={r}" for r in refs], "-"]


class Events(NamedTuple):
    thread: str | None
    said: str            # Codex's last message
    errors: list[str]   # the last is the one that ended the turn


def read_events(stdout: str) -> Events:
    """The thread, the last message and any errors from `codex exec --json`."""
    thread: str | None = None
    said = ""
    errors: list[str] = []
    for line in stdout.splitlines():
        try:
            ev: Any = json.loads(line)
        except ValueError:
            continue
        if not isinstance(ev, dict):
            continue
        kind = ev.get("type")
        if kind == "thread.started" and isinstance(ev.get("thread_id"), str):
            thread = ev["thread_id"]
        elif kind == "item.completed":
            item = ev.get("item")
            if (isinstance(item, dict) and item.get("type") == "agent_message"
                    and isinstance(item.get("text"), str)):
                said = item["text"].strip()
        elif (kind == "error" and isinstance(ev.get("message"), str)
              and not ev["message"].startswith("Reconnecting")):
            errors.append(ev["message"])
        elif kind == "turn.failed":
            err = ev.get("error")
            if isinstance(err, dict) and isinstance(err.get("message"), str):
                errors.append(err["message"])
    return Events(thread, said, errors)


def pictures_home() -> Path:
    home = os.environ.get("CODEX_HOME")
    return (Path(home) if home else Path.home() / ".codex") / "generated_images"


def _newest_picture(thread: str | None) -> Picture | None:
    if thread is None or not _THREAD.fullmatch(thread):
        return None
    folder = pictures_home() / thread
    try:
        found = sorted((p for p in folder.iterdir() if p.is_file()),
                       key=lambda p: p.stat().st_mtime, reverse=True)
    except OSError:
        return None
    for p in found:
        try:
            if p.stat().st_size > MAX_BYTES:
                continue
            data = p.read_bytes()
        except OSError:
            continue
        ext = dnd_ddb.image_type(data[:16])
        if ext in ("png", "jpg"):
            return Picture(data, ext, None)
    return None


def _cut(text: str) -> str:
    text = " ".join(text.split())
    return text if len(text) <= SAID_CHARS else text[:SAID_CHARS - 1] + "…"


def draw(prompt: str, refs: list[str], shape: str, workdir: Path) -> Picture:
    """One picture from Codex, or `Failed` / `Refused`. `refs` are paths of
    likeness pictures; `workdir` is where Codex runs (it writes nothing)."""
    exe = _exe()
    if exe is None:
        raise Failed("Codex is not installed", stop=True)
    try:
        done = RUN(command(exe, refs), input=prompt_for(prompt, len(refs), shape),
                   capture_output=True, text=True, timeout=TIMEOUT, cwd=workdir)
    except subprocess.TimeoutExpired:
        raise Failed(f"Codex took longer than {TIMEOUT // 60} minutes") from None
    except OSError as e:
        raise Failed(f"Codex could not be started ({e.__class__.__name__})",
                     stop=True) from None
    ev = read_events(done.stdout or "")
    pic = _newest_picture(ev.thread)
    if pic is not None:
        return pic
    if ev.said.upper().startswith("REFUSED"):
        reason = ev.said.split(":", 1)[1] if ":" in ev.said else ev.said
        raise Refused(_cut(reason) or "no reason given")
    stderr = "\n".join(ln for ln in (done.stderr or "").splitlines()
                       if not ln.startswith("Reading prompt from stdin")).strip()
    problem = (ev.errors[-1] if ev.errors else "") or ev.said or stderr
    stop = bool(_STOPPING.search(problem))
    if problem:
        raise Failed(f"Codex gave no picture: {_cut(problem)}", stop=stop)
    raise Failed(f"Codex gave no picture (it exited with {done.returncode})")
