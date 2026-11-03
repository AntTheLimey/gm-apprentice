"""Tests leave nothing in the system temp folder (#565).

conftest.py removes every folder `tempfile.mkdtemp` makes in the temp folder
when the test process exits; scripts/temp_guard.py fails a CI job that left
anything behind anyway.
"""

import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GUARD = ROOT / "scripts" / "temp_guard.py"


def _env_with_tmp(tmp: Path) -> dict:
    return {**os.environ, "TMPDIR": str(tmp), "TMP": str(tmp), "TEMP": str(tmp)}


def test_temp_folders_made_in_a_test_process_are_gone_when_it_exits(tmp_path):
    temp = tmp_path / "temp"
    temp.mkdir()
    fixture = tmp_path / "fixture"
    fixture.mkdir()
    script = (
        "import json, os, sys, tempfile\n"
        f"sys.path.insert(0, {str(ROOT / 'tests')!r})\n"
        "import conftest\n"
        "a = tempfile.mkdtemp(prefix='a-')\n"
        "open(os.path.join(a, 'inside.txt'), 'w').write('x')\n"
        "b = tempfile.mkdtemp(prefix=b'b-')\n"
        f"c = tempfile.mkdtemp(dir={str(fixture)!r})\n"
        "print(json.dumps([a, os.fsdecode(b), c]))\n"
    )
    run = subprocess.run([sys.executable, "-c", script], capture_output=True,
                         text=True, env=_env_with_tmp(temp), check=True)
    a, b, c = json.loads(run.stdout)
    assert not os.path.exists(a)
    assert not os.path.exists(b), "a bytes prefix is noted too"
    assert os.listdir(temp) == []
    assert os.path.exists(c), "a folder made inside a fixture is the test's own"


def _guard(mode: str, snapshot: Path, temp: Path) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, str(GUARD), mode, str(snapshot)],
                          capture_output=True, text=True, env=_env_with_tmp(temp))


def test_the_guard_names_what_the_tests_left_and_fails(tmp_path):
    temp = tmp_path / "temp"
    temp.mkdir()
    (temp / "was-here").mkdir()
    snapshot = tmp_path / "before.txt"
    assert _guard("snapshot", snapshot, temp).returncode == 0
    clean = _guard("check", snapshot, temp)
    assert clean.returncode == 0, clean.stdout
    (temp / "left-behind-abc123").mkdir()
    (temp / "node-compile-cache").mkdir()
    (temp / "pytest-of-runner").mkdir()
    dirty = _guard("check", snapshot, temp)
    assert dirty.returncode == 1
    assert "left-behind-abc123" in dirty.stdout
    assert "was-here" not in dirty.stdout
    assert "node-compile-cache" not in dirty.stdout
    assert "pytest-of-runner" not in dirty.stdout


def test_the_guard_explains_itself_when_called_wrongly(tmp_path):
    run = _guard("count", tmp_path / "x", tmp_path)
    assert run.returncode == 2
    assert "snapshot" in run.stderr
