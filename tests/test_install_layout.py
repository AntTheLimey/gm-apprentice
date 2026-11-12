"""install_layout: one function finds shared/ and the publish tool."""
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import install_layout  # noqa: E402
from install_layout import MISSING_TOOL, find_layout  # noqa: E402

TOOL = Path("tools/publish/bin/gm-publish.js")


@pytest.fixture
def t(tmp_path):
    d = tmp_path / "gm apprentice"
    d.mkdir()
    return d

TAIL = 'gma.py" tool install'   # a spaced copy has its own path
TOOL_INSTALL = install_layout.terminal_command("tool", "install")


def _touch(p: Path) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("x")


def test_plugin_layout(t):
    _touch(t / ".claude-plugin" / "plugin.json")
    _touch(t / TOOL)
    scripts = t / "skills" / "shared" / "scripts"
    scripts.mkdir(parents=True)
    got = find_layout(scripts)
    assert got.root == t
    assert got.publish_tool == t / TOOL
    assert got.shared == t / "skills" / "shared"


def test_repo_without_manifest_still_finds_tool(t):
    _touch(t / TOOL)
    scripts = t / "skills" / "shared" / "scripts"
    scripts.mkdir(parents=True)
    assert find_layout(scripts).root == t


def test_codex_manifest_marks_the_root(t):
    _touch(t / ".codex-plugin" / "plugin.json")
    scripts = t / "skills" / "shared" / "scripts"
    scripts.mkdir(parents=True)
    assert find_layout(scripts).root == t


def test_zip_layout(t):
    scripts = t / "session-wrapup" / "shared" / "scripts"
    scripts.mkdir(parents=True)
    got = find_layout(scripts)
    assert got.root is None
    assert got.publish_tool is None
    assert got.shared == t / "session-wrapup" / "shared"


def test_sibling_layout(t):
    scripts = t / ".agents" / "skills" / "shared" / "scripts"
    scripts.mkdir(parents=True)
    got = find_layout(scripts)
    assert got.root is None
    assert got.publish_tool is None


def test_live_layout_is_this_repo():
    assert install_layout.LAYOUT.root == ROOT
    assert install_layout.LAYOUT.publish_tool == ROOT / TOOL


def test_only_install_layout_climbs_parents():
    hits = [p.name for p in SCRIPTS.glob("*.py")
            if "parents[" in p.read_text(encoding="utf-8")]
    assert set(hits) <= {"install_layout.py"}


def _spaced_copy(t: Path) -> Path:
    shutil.copytree(ROOT / "skills" / "shared", t / "skills" / "shared",
                    ignore=shutil.ignore_patterns("__pycache__"))
    return t / "skills" / "shared" / "scripts" / "gma.py"


def test_gma_runs_from_a_spaced_copy(t):
    gma = _spaced_copy(t)
    done = subprocess.run([sys.executable, str(gma), "llms"],
                          capture_output=True, text=True)
    assert done.returncode == 0, done.stderr
    assert done.stdout.startswith("# gma")


def test_publish_without_tool_stops_plainly(t):
    gma = _spaced_copy(t)
    done = subprocess.run([sys.executable, str(gma), "publish", "build"],
                          capture_output=True, text=True)
    assert done.returncode == 1
    assert MISSING_TOOL.split("run `")[0] in done.stderr
    assert TAIL in done.stderr
    assert "Traceback" not in done.stderr


def test_publish_version_reads_the_stamp(t):
    (t / "PUBLISH_VERSION").write_text(" 1.2.3\r\n")
    assert install_layout.publish_version(t) == "1.2.3"


def test_publish_version_none_when_missing_or_empty(t):
    assert install_layout.publish_version(t) is None
    (t / "PUBLISH_VERSION").write_text("\n")
    assert install_layout.publish_version(t) is None


def test_broken_install_messages_say_stop():
    assert install_layout.MISSING_TOOL.endswith(install_layout.INSTALL_STOP)
    assert install_layout.VERSION_UNKNOWN.endswith(install_layout.INSTALL_STOP)


def test_stop_sentence_speaks_to_the_assistant():
    assert install_layout.INSTALL_STOP.startswith("Assistants: stop here")


def test_missing_tool_does_not_call_the_install_broken():
    # A zip or Codex install without the tool is correct until it ships there.
    assert "incomplete" not in install_layout.MISSING_TOOL


def test_version_unknown_names_every_cause():
    assert "missing, empty or unreadable" in install_layout.VERSION_UNKNOWN
    assert "This install is incomplete." in install_layout.VERSION_UNKNOWN


def test_gma_version_unknown_says_stop(t):
    gma = _spaced_copy(t)
    (gma.parents[1] / "VERSION").unlink()
    done = subprocess.run([sys.executable, str(gma), "--version"],
                          capture_output=True, text=True)
    assert done.returncode == 1
    assert "stop here, tell the GM" in done.stderr
    assert "incomplete" in done.stderr


def test_ordinary_refusals_do_not_say_stop(t):
    gma = _spaced_copy(t)
    done = subprocess.run([sys.executable, str(gma), "vault-check",
                           str(t / "nope"), "version"],
                          capture_output=True, text=True)
    assert "not a directory" in done.stderr
    assert "stop here" not in done.stderr


@pytest.mark.skipif(os.name == "nt", reason="exec is POSIX")
def test_publish_execs_node(tmp_path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    node = bin_dir / "node"
    node.write_text("#!/bin/sh\necho $$\ncat\n")
    node.chmod(0o755)
    env = dict(os.environ, PATH=f"{bin_dir}{os.pathsep}{os.environ['PATH']}")
    proc = subprocess.Popen(
        [sys.executable, str(SCRIPTS / "gma.py"), "publish", "x"],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, env=env)
    out, _ = proc.communicate("token\n")
    lines = out.splitlines()
    assert lines[0] == str(proc.pid)
    assert "token" in out


# ---- printed hints name `gma`, never a script file or the plugin root ----

import ast  # noqa: E402
import re  # noqa: E402

import gma as _gma  # noqa: E402

_MODULES = sorted({c.module for c in _gma.COMMANDS.values() if c.module})
_FILE_RE = re.compile(r"\b(" + "|".join(_MODULES) + r")\.py\b")
_BARE_FILE_RE = re.compile(r"[a-z_]+\.py")


def _printed_strings(tree: ast.AST):
    """String constants and f-string literal parts, docstrings skipped."""
    skip = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.FunctionDef,
                             ast.AsyncFunctionDef, ast.ClassDef)):
            body = node.body
            if (body and isinstance(body[0], ast.Expr)
                    and isinstance(body[0].value, ast.Constant)
                    and isinstance(body[0].value.value, str)):
                skip.add(id(body[0].value))
    for node in ast.walk(tree):
        if (isinstance(node, ast.Constant) and isinstance(node.value, str)
                and id(node) not in skip):
            yield node.lineno, node.value


def _flagged(path: Path):
    tree = ast.parse(path.read_text(encoding="utf-8"))
    out = []
    for line, s in _printed_strings(tree):
        if _BARE_FILE_RE.fullmatch(s):
            continue    # a filename the code runs, not a hint
        if "CLAUDE_PLUGIN_ROOT" in s or _FILE_RE.search(s):
            out.append(f"{path.name}:{line}: {s[:70]!r}")
    return out


def test_printed_hints_use_gma():
    bad = []
    for p in sorted(SCRIPTS.glob("*.py")):
        bad += _flagged(p)
    for p in _js_files():
        bad += _js_flagged(p)
    assert bad == []


def _js_files():
    pub = ROOT / "tools" / "publish"
    return sorted([*(pub / "lib").rglob("*.js"), *(pub / "bin").glob("*.js")])


def _js_flagged(path: Path):
    out = []
    text = path.read_text(encoding="utf-8")
    for n, line in enumerate(text.splitlines(), 1):
        if line.lstrip().startswith(("//", "*", "/*")):
            continue    # a comment, not printed
        if "CLAUDE_PLUGIN_ROOT" in line or _FILE_RE.search(line):
            out.append(f"{path.name}:{n}: {line.strip()[:70]!r}")
    return out


def test_printed_hints_gate_flags_a_planted_js_script_name(tmp_path):
    p = tmp_path / "planted.js"
    p.write_text("// vault_check.py in a comment is fine\n"
                 "console.warn(`run vault_check.py <vault> x`);\n")
    assert len(_js_flagged(p)) == 1


def test_printed_hints_gate_flags_a_planted_script_name(tmp_path):
    p = tmp_path / "planted.py"
    p.write_text('def f(v):\n    return f"run `vault_check.py {v} x`"\n')
    assert _flagged(p)


def test_llms_names_its_own_path(capsys):
    assert _gma.main(["llms"]) == 0
    out = capsys.readouterr().out
    want = 'python3 "' + Path(_gma.__file__).resolve().as_posix() + '"'
    assert want in out
    assert "{gma}" not in out


def test_printed_hints_gate_catches_parenthesised_and_backticked(tmp_path):
    for body in ('"run the upgrade (migrate.py), done"',
                 '"first-time setup `vault_scaffold.py`"'):
        p = tmp_path / "planted.py"
        p.write_text(f"X = {body}\n")
        assert _flagged(p), body


def test_printed_hints_gate_skips_an_exact_filename(tmp_path):
    p = tmp_path / "planted.py"
    p.write_text('run_script("reconcile_scan.py", [])\n')
    assert _flagged(p) == []


# ---- the publish tool from the cache (installs without tools/publish) ----

import hashlib  # noqa: E402
import http.server  # noqa: E402
import io  # noqa: E402
import socket  # noqa: E402
import tarfile  # noqa: E402
import threading  # noqa: E402

needs_node = pytest.mark.skipif(shutil.which("node") is None, reason="needs node")
STAMP = (ROOT / "skills" / "shared" / "PUBLISH_VERSION").read_text().strip()
FAKE_TOOL = b"console.log('fake tool ' + process.argv.slice(2).join(' '));\n"


def _fake_release(version: str) -> dict[str, bytes]:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for name, data in (("package/bin/gm-publish.js", FAKE_TOOL),
                           ("package/package.json", b'{"version": "%s"}' % version.encode()),
                           ("package/schema/vault-config.schema.json", b"{}")):
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    tgz = buf.getvalue()
    name = f"gm-apprentice-publish-{version}.tgz"
    return {f"/publish-v{version}/{name}": tgz,
            f"/publish-v{version}/SHA256SUMS":
                f"{hashlib.sha256(tgz).hexdigest()}  {name}\n".encode()}


@pytest.fixture
def server():
    files = _fake_release(STAMP)
    hits: list[str] = []

    class H(http.server.BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            hits.append(self.path)
            body = files.get(self.path)
            self.send_response(200 if body else 404)
            self.end_headers()
            if body:
                self.wfile.write(body)

        def log_message(self, *a):
            pass

    s = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{s.server_address[1]}", hits
    s.shutdown()


def _dead_base() -> str:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return f"http://127.0.0.1:{s.getsockname()[1]}"


def _env(t: Path, base: str, **extra: str) -> dict[str, str]:
    return {**os.environ, "GMA_CACHE": str(t / "the cache"),
            "GMA_RELEASE_BASE": base, "PYTHONIOENCODING": "utf-8", **extra}


def _run_gma(gma: Path, args: list[str], env: dict[str, str]):
    return subprocess.run([sys.executable, str(gma), *args],
                          capture_output=True, text=True, env=env)


def test_cached_tool_is_found_when_none_sits_beside(t, monkeypatch):
    scripts = t / "x" / "shared" / "scripts"
    scripts.mkdir(parents=True)
    (scripts.parent / "PUBLISH_VERSION").write_text("1.2.3\n")
    tool = t / "c" / "publish" / "1.2.3" / "package" / "bin" / "gm-publish.js"
    _touch(tool)
    _touch(t / "c" / "publish" / "1.2.3" / "package" / "package.json")
    monkeypatch.setenv("GMA_CACHE", str(t / "c"))
    got = find_layout(scripts)
    assert got.publish_tool == tool
    assert got.door_owns_tool is False


def test_an_unreadable_stamp_counts_as_missing(t):
    (t / "PUBLISH_VERSION").write_bytes(b"\xff\xfe1.2.3")
    assert install_layout.publish_version(t) is None


def test_plugin_layout_owns_its_tool():
    assert install_layout.LAYOUT.door_owns_tool is True


def test_missing_tool_names_the_install_command():
    assert install_layout.terminal_command("tool", "install") in MISSING_TOOL


def test_plugin_layout_never_fetches(t, server):
    base, hits = server
    vault = t / "vault"
    vault.mkdir()
    done = _run_gma(SCRIPTS / "gma.py", ["vault-check", str(vault), "version"],
                _env(t, base))
    assert hits == []
    assert "tool" not in done.stderr
    assert not (t / "the cache").exists()


@needs_node
def test_spaced_copy_fetches_on_first_command(t, server):
    base, hits = server
    gma = _spaced_copy(t)
    env = _env(t, base)
    assert _run_gma(gma, ["llms"], env).returncode == 0
    assert hits == []
    done = _run_gma(gma, ["publish", "hello"], env)
    assert done.returncode == 0, done.stderr
    assert "fake tool hello" in done.stdout
    assert len(hits) == 2
    again = _run_gma(gma, ["publish", "again"], env)
    assert "fake tool again" in again.stdout
    assert len(hits) == 2


@needs_node
def test_fetch_failure_warns_once_and_runs(t):
    gma = _spaced_copy(t)
    vault = t / "vault"
    vault.mkdir()
    done = _run_gma(gma, ["vault-check", str(vault), "version"], _env(t, _dead_base()))
    warned = [x for x in done.stderr.splitlines() if TAIL in x]
    assert len(warned) == 1, done.stderr
    assert "Traceback" not in done.stderr


@needs_node
def test_tool_install_reports_failure(t):
    gma = _spaced_copy(t)
    done = _run_gma(gma, ["tool", "install"], _env(t, _dead_base()))
    assert done.returncode == 1
    assert f"publish-v{STAMP}" in done.stderr
    assert install_layout.INSTALL_STOP in done.stderr


@needs_node
def test_tool_install_then_path_names_the_cache(t, server):
    base, _ = server
    gma = _spaced_copy(t)
    env = _env(t, base)
    done = _run_gma(gma, ["tool", "install"], env)
    assert done.returncode == 0, done.stderr
    path = _run_gma(gma, ["tool", "path"], env)
    assert path.returncode == 0
    assert path.stdout.strip() == str(
        t / "the cache" / "publish" / STAMP / "package" / "bin" / "gm-publish.js")


def test_tool_path_in_the_plugin_is_beside_the_skills():
    done = subprocess.run([sys.executable, str(SCRIPTS / "gma.py"), "tool", "path"],
                          capture_output=True, text=True)
    assert done.stdout.strip() == str(ROOT / TOOL)


def test_tool_path_without_a_tool_says_so(t):
    gma = _spaced_copy(t)
    done = _run_gma(gma, ["tool", "path"], _env(t, _dead_base()))
    assert done.returncode == 1
    assert TAIL in done.stderr


def test_no_node_skips_fetch(t, server):
    base, hits = server
    gma = _spaced_copy(t)
    vault = t / "vault"
    vault.mkdir()
    bare = t / "bin"
    bare.mkdir()
    env = _env(t, base, PATH=str(bare))
    _run_gma(gma, ["vault-check", str(vault), "version"], env)
    assert hits == []


def test_update_pin_on_a_cache_install_pins_the_stamped_release(monkeypatch):
    import gma as g
    seen = []
    monkeypatch.setattr(g, "_run_tool", lambda tool, args: seen.append(args) or 0)
    monkeypatch.setattr(g.vaultlib, "PUBLISH_TOOL", Path("/c/gm-publish.js"))
    monkeypatch.setattr(g.install_layout, "LAYOUT",
                        g.install_layout.LAYOUT._replace(door_owns_tool=False))
    g._publish(["update-pin", "--site", "s"])
    g._publish(["update-pin", "--site", "s", "--tag", "publish-v1.0.0"])
    g._publish(["update-pin", "--help"])
    g._publish(["build"])
    assert seen == [["update-pin", "--site", "s", "--tag", f"publish-v{STAMP}"],
                    ["update-pin", "--site", "s", "--tag", "publish-v1.0.0"],
                    ["update-pin", "--help"],
                    ["build"]]


def test_update_pin_in_the_plugin_is_unchanged(monkeypatch):
    import gma as g
    seen = []
    monkeypatch.setattr(g, "_run_tool", lambda tool, args: seen.append(args) or 0)
    g._publish(["update-pin", "--site", "s"])
    assert seen == [["update-pin", "--site", "s"]]


def test_update_pin_on_the_plugin_follows_a_tarball_site(monkeypatch):
    import gma as g
    seen = []
    monkeypatch.setattr(g, "_run_tool", lambda tool, args: seen.append(args) or 0)
    monkeypatch.setattr(g, "_site_pin_spec", lambda tool, args:
                        "file:vendor/gm-apprentice-publish-1.60.0.tgz")
    g._publish(["update-pin", "--site", "s"])
    monkeypatch.setattr(g, "_site_pin_spec", lambda tool, args:
                        "file:/plugin/cache/1.11.7/tools/publish")
    g._publish(["update-pin", "--site", "s"])
    g._publish(["update-pin", "--site", "s", "--check"])
    assert seen == [["update-pin", "--site", "s", "--tag", f"publish-v{STAMP}"],
                    ["update-pin", "--site", "s"],
                    ["update-pin", "--site", "s", "--check"]]


def test_a_check_asks_about_the_release_a_run_would_pin(monkeypatch):
    import gma as g
    seen = []
    monkeypatch.setattr(g, "_run_tool", lambda tool, args: seen.append(args) or 0)
    ran = []

    class Done:
        stdout = '{"spec": "file:vendor/gm-apprentice-publish-1.60.0.tgz"}'
    monkeypatch.setattr(g.subprocess, "run", lambda cmd, **kw: ran.append(cmd) or Done)
    g._publish(["update-pin", "--site", "s", "--check", "--json"])
    assert seen == [["update-pin", "--site", "s", "--check", "--json",
                     "--tag", f"publish-v{STAMP}"]]
    assert ran[0][2:] == ["update-pin", "--site", "s", "--check", "--json"]
    monkeypatch.setattr(g.install_layout, "LAYOUT",
                        g.install_layout.LAYOUT._replace(door_owns_tool=False))
    g._publish(["update-pin", "--check"])
    assert seen[-1] == ["update-pin", "--check", "--tag", f"publish-v{STAMP}"]


@pytest.mark.parametrize("owns", [True, False])
def test_a_repin_without_the_stamp_stops_plainly(monkeypatch, tmp_path, capsys, owns):
    import gma as g
    seen = []
    monkeypatch.setattr(g, "_run_tool", lambda tool, args: seen.append(args) or 0)
    monkeypatch.setattr(g, "_site_pin_spec", lambda tool, args:
                        "file:vendor/gm-apprentice-publish-1.60.0.tgz")
    monkeypatch.setattr(g.install_layout, "LAYOUT", g.install_layout.LAYOUT._replace(
        shared=tmp_path, door_owns_tool=owns))
    assert g._publish(["update-pin", "--site", "s"]) == 1
    assert seen == []
    err = capsys.readouterr().err
    assert "PUBLISH_VERSION" in err and g.install_layout.INSTALL_STOP in err


def test_a_repin_on_too_old_a_node_says_upgrade(monkeypatch, capsys):
    import gma as g
    seen = []
    monkeypatch.setattr(g, "_run_tool", lambda tool, args: seen.append(args) or 0)
    monkeypatch.setattr(g.tool_cache, "node_too_old", lambda node: "v22.5.0")
    monkeypatch.setattr(g.install_layout, "LAYOUT",
                        g.install_layout.LAYOUT._replace(door_owns_tool=False))
    assert g._publish(["update-pin", "--site", "s"]) == 1
    assert "Node 22.21 or newer" in capsys.readouterr().err
    g._publish(["update-pin", "--site", "s", "--check"])
    g._publish(["build"])
    assert seen == [["update-pin", "--site", "s", "--check",
                     "--tag", f"publish-v{STAMP}"], ["build"]]


def test_python_command_help_does_not_wait_on_a_download(monkeypatch, capsys):
    import gma as g
    monkeypatch.setattr(g, "_ensure_tool", lambda: (_ for _ in ()).throw(
        AssertionError("fetched for --help")))
    with pytest.raises(SystemExit):
        g.main(["vault-check", "--help"])
    assert "usage" in capsys.readouterr().out


def test_node_children_use_a_sandbox_proxy(monkeypatch):
    import gma as g
    monkeypatch.delenv("NODE_USE_ENV_PROXY", raising=False)
    g.main(["llms", "tool"])
    assert os.environ.get("NODE_USE_ENV_PROXY") == "1"


def _broken_door(monkeypatch, tmp_path, reason):
    import gma as g
    calls = []

    def fail(version, **kw):
        calls.append(kw)
        raise g.tool_cache.FetchFailed(reason)
    monkeypatch.setenv("GMA_CACHE", str(tmp_path))
    monkeypatch.setattr(g.vaultlib, "PUBLISH_TOOL", None)
    monkeypatch.setattr(g.tool_cache, "fetch", fail)
    monkeypatch.setattr(g.shutil, "which", lambda name: "/usr/bin/node")
    return g, calls


def test_a_failed_automatic_fetch_is_not_retried_at_once(monkeypatch, tmp_path, capsys):
    g, calls = _broken_door(monkeypatch, tmp_path,
                            "publish-v1.0.0: could not download: fetch failed")
    g._ensure_tool()
    g._ensure_tool()
    assert len(calls) == 1
    err = capsys.readouterr().err
    assert err.count(TOOL_INSTALL) == 1
    assert "network access" in err
    assert calls[0].get("timeout") == g.AUTO_FETCH_TIMEOUT


def test_a_checksum_failure_does_not_blame_the_network(monkeypatch, tmp_path, capsys):
    g, _ = _broken_door(monkeypatch, tmp_path,
                        "publish-v1.0.0: the checksum does not match SHA256SUMS")
    g._ensure_tool()
    err = capsys.readouterr().err
    assert "checksum" in err
    assert "network" not in err


def test_tool_install_ignores_a_recent_failure(monkeypatch, tmp_path):
    g, calls = _broken_door(monkeypatch, tmp_path, "x: could not download: y")
    g._ensure_tool()
    assert g._tool(["install"]) == 1
    assert len(calls) == 2
    assert calls[1].get("timeout") is None


def _blocked_cache(monkeypatch, tmp_path):
    import gma as g
    calls = []

    def fail(version, **kw):
        calls.append(kw)
        raise g.tool_cache.FetchFailed(
            "cannot write the cache at /x/publish: denied", outside=True)
    monkeypatch.setenv("GMA_CACHE", str(tmp_path))
    monkeypatch.setattr(g.vaultlib, "PUBLISH_TOOL", None)
    monkeypatch.setattr(g.tool_cache, "fetch", fail)
    monkeypatch.setattr(g.shutil, "which", lambda name: "/usr/bin/node")
    return g


def test_a_blocked_cache_before_a_command_warns_without_stopping(monkeypatch, tmp_path, capsys):
    # The automatic fetch runs before every command, maybe at the table:
    # the command carries on, so its warning must not tell the agent to stop.
    g = _blocked_cache(monkeypatch, tmp_path)
    g._ensure_tool()
    err = capsys.readouterr().err
    assert "Assistants: stop" not in err
    assert f"allow `{TOOL_INSTALL}` outside the sandbox" in err


def test_tool_install_with_a_blocked_cache_stops_once(monkeypatch, tmp_path, capsys):
    g = _blocked_cache(monkeypatch, tmp_path)
    assert g._tool(["install"]) == 1
    err = capsys.readouterr().err
    assert err.count("Assistants: stop here") == 1
    assert "outside the project folder" in err
    assert "could not download" not in err
    assert ".." not in err


def test_missing_tool_names_node():
    assert "Node 22" in MISSING_TOOL


def test_update_step_on_a_plugin_keeps_its_words(t):
    _touch(t / ".claude-plugin" / "plugin.json")
    scripts = t / "skills" / "shared" / "scripts"
    scripts.mkdir(parents=True)
    layout = find_layout(scripts)
    assert install_layout.update_step("update the plugin", layout) == "update the plugin"


def test_update_step_elsewhere_names_npx_skills(t):
    scripts = t / ".agents" / "skills" / "shared" / "scripts"
    scripts.mkdir(parents=True)
    step = install_layout.update_step("update the plugin", find_layout(scripts))
    assert "npx skills update -g" in step
    assert "npx skills add" in step   # a pinned install re-runs add
