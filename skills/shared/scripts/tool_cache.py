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
import time
from pathlib import Path, PurePosixPath

# The same address update-pin.js pins a site to (`--tag`).
RELEASE_BASE = "https://github.com/AntTheLimey/gm-apprentice/releases/download"
_TOOL_IN_PACKAGE = Path("package") / "bin" / "gm-publish.js"
# A release must carry these beside the tool: the schema is what the vault
# scripts read the settings' defaults from.
_NEEDED = (_TOOL_IN_PACKAGE, Path("package") / "package.json",
           Path("package") / "schema" / "vault-config.schema.json")
# Node's fetch takes a sandbox's HTTPS_PROXY (with NODE_USE_ENV_PROXY) from
# 22.21 and 24.0 on; older Nodes are told to upgrade, not worked around.
NODE_FLOOR = "22.21"
_DOWNLOAD = Path(__file__).resolve().parent / "download.mjs"
DOWNLOAD_TIMEOUT = 300
KEEP_VERSIONS = 3          # another install on the machine may use an older one
STALE_TEMP = 24 * 3600     # a .tmp-* folder this old was left by a killed fetch
FAILURE_HOLD = 15 * 60     # after a failed automatic fetch, wait this long


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
    here = (root or cache_root()) / "publish" / version
    tool = here / _TOOL_IN_PACKAGE
    # Both ends of the package: a folder half deleted is not a tool.
    whole = tool.is_file() and (here / "package" / "package.json").is_file()
    return tool if whole else None


def failure_marker(version: str, root: Path | None = None) -> Path:
    return (root or cache_root()) / "publish" / f".failed-{version}"


def note_failure(version: str, root: Path | None = None) -> None:
    """Remember a failed automatic fetch, so the next commands don't each
    wait on the network again. Best effort: an unwritable cache just
    means the next command tries again."""
    marker = failure_marker(version, root)
    try:
        marker.parent.mkdir(parents=True, exist_ok=True)
        marker.touch()
    except OSError:
        pass


def failed_recently(version: str, root: Path | None = None) -> bool:
    try:
        age = time.time() - failure_marker(version, root).stat().st_mtime
    except OSError:
        return False
    return age < FAILURE_HOLD


def node_too_old(node: str) -> str | None:
    """`node --version` when it is below the floor, else None. A version
    that cannot be read is not called old: the step that needs Node says
    what is wrong instead."""
    try:
        said = subprocess.run([node, "--version"], capture_output=True,
                              text=True, timeout=30).stdout.strip()
        major, minor = (int(x) for x in said.lstrip("v").split(".")[:2])
    except (OSError, subprocess.TimeoutExpired, ValueError):
        return None
    ok = major >= 24 or (major == 22 and minor >= 21)
    return None if ok else said


def node_upgrade(version: str) -> str:
    return (f"the publish tool needs Node {NODE_FLOOR} or newer (this is "
            f"{version}): upgrade Node from https://nodejs.org")


def _download(node: str, url: str, dest: Path, timeout: int) -> None:
    # Node's fetch goes through HTTPS_PROXY (a sandbox's way out) only when
    # asked to.
    env = {**os.environ, "NODE_USE_ENV_PROXY": "1"}
    try:
        done = subprocess.run([node, str(_DOWNLOAD), url, str(dest)],
                              capture_output=True, text=True, env=env,
                              timeout=timeout)
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
                # ":" and "\\" would leave the folder on Windows.
                if (p.is_absolute() or ".." in p.parts
                        or any(":" in s or "\\" in s for s in p.parts)
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


def _tidy(publish: Path, keep: str) -> None:
    """Keep the newest KEEP_VERSIONS versions and `keep`, and sweep temp
    folders a killed fetch left behind."""
    versions = sorted(((k, d) for d in publish.iterdir()
                       if d.is_dir() and d.name != keep
                       and (k := _key(d.name)) is not None),
                      reverse=True)
    for _, d in versions[KEEP_VERSIONS - 1:]:
        shutil.rmtree(d, ignore_errors=True)
    now = time.time()
    for d in publish.glob(".tmp-*"):
        try:
            if now - d.stat().st_mtime > STALE_TEMP:
                shutil.rmtree(d, ignore_errors=True)
        except OSError:
            pass


def fetch(version: str, *, root: Path | None = None, base: str | None = None,
          node: str | None = None, timeout: int | None = None) -> Path:
    """The tool for `version`, fetched and unpacked if not cached yet.
    `timeout` bounds each download (default DOWNLOAD_TIMEOUT)."""
    wait = DOWNLOAD_TIMEOUT if timeout is None else timeout
    found = cached_tool(version, root)
    if found is not None:
        return found
    node = shutil.which("node") if node is None else node
    if not node:
        raise FetchFailed(f"node is not on the PATH, and the publish tool needs "
                          f"Node {NODE_FLOOR} or newer")
    old = node_too_old(node)
    if old is not None:
        raise FetchFailed(node_upgrade(old))
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
        _download(node, f"{url}/SHA256SUMS", sums, wait)
        _download(node, f"{url}/{name}", tgz, wait)
        want = _expected_sum(sums.read_text(encoding="utf-8", errors="replace"), name)
        got = hashlib.sha256(tgz.read_bytes()).hexdigest()
        if got != want:
            raise FetchFailed(f"{tag}: the checksum does not match SHA256SUMS")
        unpacked = work / "unpacked"
        _safe_extract(tgz, unpacked)
        for needed in _NEEDED:
            if not (unpacked / needed).is_file():
                raise FetchFailed(f"{tag}: the tarball has no {needed.as_posix()}")
        final = publish / version
        if final.exists() and cached_tool(version, root) is None:
            # Half deleted (a tidy or a user stopped part way): move it
            # aside, so the fresh copy can take its place.
            try:
                os.replace(final, work / "broken")
            except OSError:
                pass
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
    try:
        # Housekeeping: the tool is installed whether or not this works.
        _tidy(publish, version)
        failure_marker(version, root).unlink(missing_ok=True)
    except OSError:
        pass
    tool = cached_tool(version, root)
    assert tool is not None
    return tool
