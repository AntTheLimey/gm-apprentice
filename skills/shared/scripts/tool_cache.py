"""The publish tool for installs that don't carry it: one release, fetched
once into a per-user cache, checked against the release's SHA256SUMS.

The plugin and the repo have `tools/publish` beside the skills and never
come here. Everything else (zips, `npx skills`, a portal import) fetches
the release named by `shared/PUBLISH_VERSION` on first use.
"""
from __future__ import annotations

import hashlib
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path, PurePosixPath

# The same address update-pin.js pins a site to (`--tag`).
RELEASE_BASE = "https://github.com/AntTheLimey/gm-apprentice/releases/download"
_TOOL_IN_PACKAGE = Path("package") / "bin" / "gm-publish.js"
_DOWNLOAD = Path(__file__).resolve().parent / "download.mjs"
DOWNLOAD_TIMEOUT = 300


class FetchFailed(Exception):
    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def cache_root() -> Path:
    """Where fetched tools live: $GMA_CACHE, else the platform's user cache."""
    override = os.environ.get("GMA_CACHE")
    if override:
        return Path(override)
    if os.name == "nt":
        base = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
        return Path(base) / "gm-apprentice" / "cache"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Caches" / "gm-apprentice"
    xdg = os.environ.get("XDG_CACHE_HOME")
    return (Path(xdg) if xdg else Path.home() / ".cache") / "gm-apprentice"


def release_base() -> str:
    return os.environ.get("GMA_RELEASE_BASE") or RELEASE_BASE


def cached_tool(version: str, root: Path | None = None) -> Path | None:
    tool = (root or cache_root()) / "publish" / version / _TOOL_IN_PACKAGE
    return tool if tool.is_file() else None


def _download(node: str, url: str, dest: Path) -> None:
    try:
        done = subprocess.run([node, str(_DOWNLOAD), url, str(dest)],
                              capture_output=True, text=True,
                              timeout=DOWNLOAD_TIMEOUT)
    except (OSError, subprocess.TimeoutExpired) as e:
        raise FetchFailed(f"could not download {url}: {e}") from e
    if done.returncode != 0:
        said = done.stderr.strip().splitlines()
        raise FetchFailed(f"could not download: {said[-1] if said else url}")


def _expected_sum(sums: str, name: str) -> str:
    for line in sums.splitlines():
        parts = line.split()
        if len(parts) == 2 and parts[1].lstrip("*") == name:
            return parts[0].lower()
    raise FetchFailed(f"SHA256SUMS has no line for {name}")


def _safe_extract(tgz: Path, dest: Path) -> None:
    """Unpack regular files and folders only, each inside `dest`."""
    try:
        with tarfile.open(tgz, "r:gz") as tar:
            members = tar.getmembers()
            for m in members:
                p = PurePosixPath(m.name)
                if (p.is_absolute() or ".." in p.parts
                        or not (m.isfile() or m.isdir())):
                    raise FetchFailed(f"the tarball holds an unsafe entry: {m.name}")
            for m in members:
                target = dest.joinpath(*PurePosixPath(m.name).parts)
                if m.isdir():
                    target.mkdir(parents=True, exist_ok=True)
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                src = tar.extractfile(m)
                if src is None:
                    raise FetchFailed(f"the tarball entry {m.name} is unreadable")
                with src, open(target, "wb") as out:
                    shutil.copyfileobj(src, out)
    except (tarfile.TarError, OSError, EOFError) as e:
        raise FetchFailed(f"could not unpack the tool: {e}") from e


def _key(name: str) -> tuple[int, ...] | None:
    try:
        return tuple(int(x) for x in name.split("."))
    except ValueError:
        return None


def _clear_older(publish: Path, version: str) -> None:
    mine = _key(version)
    if mine is None:
        return
    for d in publish.iterdir():
        k = _key(d.name)
        if k is not None and k < mine and d.is_dir():
            shutil.rmtree(d, ignore_errors=True)


def fetch(version: str, *, root: Path | None = None, base: str | None = None,
          node: str | None = None) -> Path:
    """The tool for `version`, fetched and unpacked if not cached yet."""
    found = cached_tool(version, root)
    if found is not None:
        return found
    node = shutil.which("node") if node is None else node
    if not node:
        raise FetchFailed("node is not on the PATH, and the publish tool needs Node 22")
    publish = (root or cache_root()) / "publish"
    tag = f"publish-v{version}"
    name = f"gm-apprentice-publish-{version}.tgz"
    url = f"{(base or release_base()).rstrip('/')}/{tag}"
    try:
        publish.mkdir(parents=True, exist_ok=True)
        work = Path(tempfile.mkdtemp(prefix=".tmp-", dir=publish))
    except OSError as e:
        raise FetchFailed(f"cannot write the cache at {publish}: {e}") from e
    try:
        tgz, sums = work / name, work / "SHA256SUMS"
        _download(node, f"{url}/SHA256SUMS", sums)
        _download(node, f"{url}/{name}", tgz)
        want = _expected_sum(sums.read_text(encoding="utf-8", errors="replace"), name)
        got = hashlib.sha256(tgz.read_bytes()).hexdigest()
        if got != want:
            raise FetchFailed(f"{tag}: the checksum does not match SHA256SUMS")
        unpacked = work / "unpacked"
        _safe_extract(tgz, unpacked)
        if not (unpacked / _TOOL_IN_PACKAGE).is_file():
            raise FetchFailed(f"{tag}: the tarball has no package/bin/gm-publish.js")
        final = publish / version
        try:
            os.replace(unpacked, final)
        except OSError:
            # Another install unpacked it first; use theirs.
            if cached_tool(version, root) is None:
                raise
    except FetchFailed as e:
        if tag not in e.reason:
            e.reason = f"{tag}: {e.reason}"
            e.args = (e.reason,)
        raise
    except OSError as e:
        raise FetchFailed(f"{tag}: could not install into {publish}: {e}") from e
    finally:
        shutil.rmtree(work, ignore_errors=True)
    _clear_older(publish, version)
    tool = cached_tool(version, root)
    assert tool is not None
    return tool
