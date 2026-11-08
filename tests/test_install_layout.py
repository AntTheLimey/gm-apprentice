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
