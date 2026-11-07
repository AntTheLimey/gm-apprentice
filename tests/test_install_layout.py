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
    assert MISSING_TOOL in done.stderr
    assert "Traceback" not in done.stderr


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
