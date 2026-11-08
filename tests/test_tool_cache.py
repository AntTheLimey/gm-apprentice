"""tool_cache: fetch the publish tool release into a per-user cache."""
import hashlib
import http.server
import io
import os
import shutil
import sys
import tarfile
import threading
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "skills" / "shared" / "scripts"))

import tool_cache  # noqa: E402
from tool_cache import FetchFailed, cached_tool, fetch  # noqa: E402

needs_node = pytest.mark.skipif(shutil.which("node") is None, reason="needs node")
TOOL_JS = b"console.log('tool');\n"


def make_tgz(members: list[tuple[str, bytes | None, str | None]]) -> bytes:
    """(name, data, symlink target) entries; data None with a target is a link."""
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for name, data, target in members:
            info = tarfile.TarInfo(name)
            if target is not None:
                info.type = tarfile.SYMTYPE
                info.linkname = target
                tar.addfile(info)
            else:
                assert data is not None
                info.size = len(data)
                tar.addfile(info, io.BytesIO(data))
    return buf.getvalue()


GOOD = [("package/bin/gm-publish.js", TOOL_JS, None),
        ("package/package.json", b'{"version": "1.2.3"}', None),
        ("package/schema/vault-config.schema.json", b"{}", None)]


class Release:
    """Files served under /publish-v<ver>/, and a request count."""

    def __init__(self) -> None:
        self.files: dict[str, bytes] = {}
        self.hits = 0

    def add(self, version: str, tgz: bytes, sums: bytes | None = None) -> None:
        name = f"gm-apprentice-publish-{version}.tgz"
        self.files[f"/publish-v{version}/{name}"] = tgz
        if sums is None:
            sums = f"{hashlib.sha256(tgz).hexdigest()}  {name}\n".encode()
        self.files[f"/publish-v{version}/SHA256SUMS"] = sums


@pytest.fixture
def release():
    rel = Release()

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            rel.hits += 1
            body = rel.files.get(self.path)
            if body is None:
                self.send_response(404)
                self.end_headers()
                return
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *a):
            pass

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    rel.base = f"http://127.0.0.1:{server.server_address[1]}"  # type: ignore[attr-defined]
    yield rel
    server.shutdown()


@pytest.fixture
def cache(tmp_path):
    d = tmp_path / "cache root"
    d.mkdir()
    return d


def _left(cache: Path) -> list[str]:
    pub = cache / "publish"
    return sorted(p.name for p in pub.iterdir()) if pub.is_dir() else []


@needs_node
def test_fetch_unpacks_and_returns_the_tool(release, cache):
    release.add("1.2.3", make_tgz(GOOD))
    tool = fetch("1.2.3", root=cache, base=release.base)
    assert tool == cache / "publish" / "1.2.3" / "package" / "bin" / "gm-publish.js"
    assert tool.read_bytes() == TOOL_JS
    assert cached_tool("1.2.3", root=cache) == tool


@needs_node
def test_fetch_is_a_no_op_when_cached(release, cache):
    release.add("1.2.3", make_tgz(GOOD))
    fetch("1.2.3", root=cache, base=release.base)
    hits = release.hits
    fetch("1.2.3", root=cache, base=release.base)
    assert release.hits == hits


@needs_node
def test_checksum_mismatch_leaves_nothing(release, cache):
    tgz = make_tgz(GOOD)
    release.add("1.2.3", tgz,
                sums=f"{'0' * 64}  gm-apprentice-publish-1.2.3.tgz\n".encode())
    with pytest.raises(FetchFailed, match="checksum"):
        fetch("1.2.3", root=cache, base=release.base)
    assert _left(cache) == []


@needs_node
def test_404_names_the_version(release, cache):
    with pytest.raises(FetchFailed) as e:
        fetch("9.9.9", root=cache, base=release.base)
    assert "publish-v9.9.9" in e.value.reason
    assert "404" in e.value.reason
    assert _left(cache) == []


@needs_node
@pytest.mark.parametrize("bad", [
    ("package/../../evil.js", b"x", None),
    ("/abs/evil.js", b"x", None),
    ("package/bin/link", None, "/etc/passwd"),
])
def test_member_escaping_the_tree_is_refused(release, cache, bad):
    release.add("1.2.3", make_tgz([*GOOD, bad]))
    with pytest.raises(FetchFailed):
        fetch("1.2.3", root=cache, base=release.base)
    assert _left(cache) == []
    assert not (cache.parent / "evil.js").exists()


@needs_node
def test_tarball_without_the_tool_is_refused(release, cache):
    release.add("1.2.3", make_tgz([m for m in GOOD if "gm-publish" not in m[0]]))
    with pytest.raises(FetchFailed, match="gm-publish.js"):
        fetch("1.2.3", root=cache, base=release.base)
    assert _left(cache) == []


@needs_node
def test_versions_within_the_newest_three_are_kept(release, cache):
    for v in ("1.0.0", "1.2.3", "1.10.0"):
        release.add(v, make_tgz(GOOD))
    fetch("1.0.0", root=cache, base=release.base)
    fetch("1.10.0", root=cache, base=release.base)
    fetch("1.2.3", root=cache, base=release.base)
    assert _left(cache) == ["1.0.0", "1.10.0", "1.2.3"]


@needs_node
def test_no_node_fails_plainly(release, cache):
    release.add("1.2.3", make_tgz(GOOD))
    with pytest.raises(FetchFailed, match="node"):
        fetch("1.2.3", root=cache, base=release.base, node="")


def test_cache_root_honours_GMA_CACHE(monkeypatch, tmp_path):
    monkeypatch.setenv("GMA_CACHE", str(tmp_path / "x y"))
    assert tool_cache.cache_root() == tmp_path / "x y"


def test_cache_root_default_is_per_user(monkeypatch):
    monkeypatch.delenv("GMA_CACHE", raising=False)
    root = tool_cache.cache_root()
    assert root.name == "gm-apprentice" or root.parent.name == "gm-apprentice"


def test_release_base_override(monkeypatch):
    monkeypatch.setenv("GMA_RELEASE_BASE", "http://example.invalid/r")
    assert tool_cache.release_base() == "http://example.invalid/r"
    monkeypatch.delenv("GMA_RELEASE_BASE")
    assert tool_cache.release_base() == tool_cache.RELEASE_BASE


def test_release_base_matches_update_pin():
    js = (ROOT / "tools" / "publish" / "lib" / "update-pin.js").read_text(encoding="utf-8")
    assert f"'{tool_cache.RELEASE_BASE}'" in js


def test_cached_tool_none_when_absent(cache):
    assert cached_tool("1.2.3", root=cache) is None
    os.makedirs(cache / "publish" / "1.2.3")
    assert cached_tool("1.2.3", root=cache) is None


def test_download_honours_a_proxy(monkeypatch, tmp_path):
    # Sandboxes (Codex) reach the network through HTTPS_PROXY; Node's fetch
    # uses it only when NODE_USE_ENV_PROXY is set.
    seen = {}

    def run(cmd, **kw):
        seen.update(kw.get("env") or {})
        raise OSError("stop here")

    monkeypatch.setenv("HTTPS_PROXY", "http://127.0.0.1:3128")
    monkeypatch.setattr(tool_cache.subprocess, "run", run)
    with pytest.raises(FetchFailed):
        tool_cache._download("node", "https://x/y", tmp_path / "f", 30)
    assert seen.get("NODE_USE_ENV_PROXY") == "1"
    assert seen.get("HTTPS_PROXY") == "http://127.0.0.1:3128"


@needs_node
@pytest.mark.parametrize("bad", [("package/C:evil.js", b"x", None),
                                 ("package\\..\\evil.js", b"x", None)])
def test_windows_style_member_is_refused(release, cache, bad):
    release.add("1.2.3", make_tgz([*GOOD, bad]))
    with pytest.raises(FetchFailed):
        fetch("1.2.3", root=cache, base=release.base)


@needs_node
def test_the_three_newest_versions_are_kept(release, cache):
    for v in ("1.0.0", "1.1.0", "1.2.0", "1.3.0"):
        release.add(v, make_tgz(GOOD))
        fetch(v, root=cache, base=release.base)
    assert _left(cache) == ["1.1.0", "1.2.0", "1.3.0"]


def test_a_half_deleted_version_is_not_cached(cache):
    tool = cache / "publish" / "1.2.3" / "package" / "bin" / "gm-publish.js"
    tool.parent.mkdir(parents=True)
    tool.write_bytes(TOOL_JS)
    assert cached_tool("1.2.3", root=cache) is None
    (tool.parents[1] / "package.json").write_text("{}")
    assert cached_tool("1.2.3", root=cache) == tool


@needs_node
def test_old_temp_folders_are_swept(release, cache):
    stale = cache / "publish" / ".tmp-old"
    stale.mkdir(parents=True)
    os.utime(stale, (0, 0))
    fresh = cache / "publish" / ".tmp-new"
    fresh.mkdir()
    release.add("1.2.3", make_tgz(GOOD))
    fetch("1.2.3", root=cache, base=release.base)
    assert not stale.exists()
    assert fresh.exists()


def test_a_recent_failure_holds_off_the_automatic_fetch(cache):
    assert tool_cache.failed_recently("1.2.3", root=cache) is False
    tool_cache.note_failure("1.2.3", root=cache)
    assert tool_cache.failed_recently("1.2.3", root=cache) is True
    assert tool_cache.failed_recently("1.2.4", root=cache) is False
    marker = tool_cache.failure_marker("1.2.3", root=cache)
    os.utime(marker, (0, 0))
    assert tool_cache.failed_recently("1.2.3", root=cache) is False


@needs_node
def test_a_successful_fetch_clears_the_failure_note(release, cache):
    tool_cache.note_failure("1.2.3", root=cache)
    release.add("1.2.3", make_tgz(GOOD))
    fetch("1.2.3", root=cache, base=release.base)
    assert tool_cache.failed_recently("1.2.3", root=cache) is False


def test_fetch_passes_its_timeout_to_each_download(monkeypatch, tmp_path):
    seen = []
    monkeypatch.setattr(tool_cache, "_download",
                        lambda node, url, dest, timeout: seen.append(timeout)
                        or (_ for _ in ()).throw(FetchFailed("x")))
    with pytest.raises(FetchFailed):
        fetch("1.2.3", root=tmp_path, base="http://x", node="node", timeout=30)
    assert seen == [30]


@needs_node
def test_an_older_fetch_keeps_its_own_version(release, cache):
    for v in ("1.1.0", "1.2.0", "1.3.0", "1.0.0"):
        release.add(v, make_tgz(GOOD))
        fetch(v, root=cache, base=release.base)
    assert cached_tool("1.0.0", root=cache) is not None


@needs_node
@pytest.mark.parametrize("left_out", ["package.json", "vault-config.schema.json"])
def test_tarball_missing_a_needed_file_is_refused(release, cache, left_out):
    release.add("1.2.3", make_tgz([m for m in GOOD if not m[0].endswith(left_out)]))
    with pytest.raises(FetchFailed, match=left_out):
        fetch("1.2.3", root=cache, base=release.base)
    assert _left(cache) == []


@needs_node
def test_a_half_deleted_version_is_repaired(release, cache):
    broken = cache / "publish" / "1.2.3" / "package" / "bin" / "gm-publish.js"
    broken.parent.mkdir(parents=True)
    broken.write_bytes(b"old")
    release.add("1.2.3", make_tgz(GOOD))
    tool = fetch("1.2.3", root=cache, base=release.base)
    assert tool.read_bytes() == TOOL_JS
    assert _left(cache) == ["1.2.3"]


@needs_node
def test_a_tidy_failure_does_not_fail_the_fetch(release, cache, monkeypatch):
    def boom(*a):
        raise OSError("locked")
    monkeypatch.setattr(tool_cache, "_tidy", boom)
    release.add("1.2.3", make_tgz(GOOD))
    assert fetch("1.2.3", root=cache, base=release.base).is_file()


def _node_says(monkeypatch, version):
    class Done:
        returncode = 0
        stdout = version + "\n"
    monkeypatch.setattr(tool_cache.subprocess, "run", lambda *a, **kw: Done)


@pytest.mark.parametrize("version,old", [
    ("v20.18.0", True), ("v22.20.0", True), ("v23.11.1", True),
    ("v22.21.0", False), ("v22.23.4", False), ("v24.0.0", False),
    ("v26.12.1", False), ("v100.0.0", False)])
def test_the_node_floor_is_22_21(monkeypatch, version, old):
    # Node's fetch takes a sandbox's proxy from 22.21 and 24.0 on.
    _node_says(monkeypatch, version)
    assert tool_cache.node_too_old("node") == (version if old else None)


def test_an_unreadable_node_version_is_not_called_old(monkeypatch):
    _node_says(monkeypatch, "garbage")
    assert tool_cache.node_too_old("node") is None


def test_too_old_a_node_stops_before_any_download(release, cache, monkeypatch):
    monkeypatch.setattr(tool_cache, "node_too_old", lambda node: "v22.5.0")
    release.add("1.2.3", make_tgz(GOOD))
    with pytest.raises(FetchFailed, match=r"Node 22\.21 or newer.*v22\.5\.0"):
        fetch("1.2.3", root=cache, base=release.base, node="node")
    assert release.hits == 0



@needs_node
@pytest.mark.skipif(os.name != "posix" or os.geteuid() == 0,
                    reason="chmod only blocks writes for non-root POSIX")
def test_a_cache_it_cannot_write_is_marked_outside(release, cache):
    # An agent's sandbox often allows writes only in the project folder.
    cache.mkdir(parents=True, exist_ok=True)
    cache.chmod(0o500)
    try:
        with pytest.raises(FetchFailed) as e:
            fetch("1.2.3", root=cache, base=release.base)
    finally:
        cache.chmod(0o755)
    # The caller adds the stop line: only `gma tool install` should stop.
    assert e.value.outside
    assert "cannot write the cache" in e.value.reason
    assert "Assistants" not in e.value.reason
