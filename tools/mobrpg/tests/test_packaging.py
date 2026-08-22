"""Packaging / wheel-install regressions (RELEASE-BLOCKERS B5 + --version)."""

import importlib
import os
import pathlib
import shutil
import subprocess
import sys
import zipfile

import pytest

from mobrpg import cli
from mobrpg.commands import map_cmd


def test_ontology_ships_inside_package():
    """The ontology JSON must live under the mobrpg package so it ships in the
    wheel and loads via importlib.resources (not from outside the package)."""
    ref = importlib.resources.files("mobrpg").joinpath("gm-apprentice-ontology.json")
    assert ref.is_file()


def test_map_cmd_import_does_not_read_ontology():
    """Importing map_cmd must not touch the ontology file — a missing file may
    only affect `map`, never the whole CLI. The load is memoized and lazy, so a
    fresh (re)import leaves the cache empty until something actually needs it."""
    importlib.reload(map_cmd)
    assert map_cmd._load_ontology.cache_info().currsize == 0
    # …and the derived vocab loads on demand the first time it is used.
    assert map_cmd.predicate_type("part_of") == "Link"
    assert map_cmd._load_ontology.cache_info().currsize == 1


def test_lazy_module_attributes_still_resolve():
    """The public derived constants remain reachable as module attributes."""
    assert "part_of" in map_cmd.REVERSED_PREDICATES
    assert "Parent" in map_cmd.RELATION_TYPES
    assert map_cmd.KINDS["location"] == "political"
    assert "part_of" in map_cmd.PREDICATE_RELATION


def test_no_legacy_package_or_fallback_dispatch():
    """Task 14: the shell-out layer is gone — no _legacy package dir, no
    FALLBACK dict, no _shellout helper left on the cli module."""
    assert not hasattr(cli, "FALLBACK")
    assert not hasattr(cli, "_shellout")
    base = importlib.resources.files("mobrpg")
    assert not base.joinpath("_legacy").is_dir()


def test_wheel_contains_no_legacy_files(tmp_path):
    """Task 14: build the real wheel and inspect its file list directly —
    a package-data or MANIFEST regression could resurrect _legacy without
    any in-process check noticing, since importlib.resources only sees
    what's on disk in this checkout, not what setuptools decides to ship."""
    project_root = pathlib.Path(__file__).resolve().parents[1]
    # setuptools' build_py caches copies in build/lib and doesn't prune files
    # that were deleted from source between builds, which would leak stale
    # _legacy/* into this wheel even after the source dir is clean. Both dirs
    # are gitignored scratch output, safe to blow away before a fresh build.
    for stale in ("build", "mobrpg_cli.egg-info"):
        stale_path = project_root / stale
        if stale_path.exists():
            shutil.rmtree(stale_path)
    result = subprocess.run(
        [sys.executable, "-m", "build", "--wheel", "--no-isolation",
         "--outdir", str(tmp_path)],
        cwd=project_root, capture_output=True, text=True,
    )
    assert result.returncode == 0, f"wheel build failed:\n{result.stderr}"
    wheels = list(tmp_path.glob("*.whl"))
    assert len(wheels) == 1, f"expected exactly one wheel, got {wheels}"
    with zipfile.ZipFile(wheels[0]) as zf:
        names = zf.namelist()
    assert names, "wheel appears empty"
    legacy_entries = [n for n in names if "_legacy" in n]
    assert not legacy_entries, f"_legacy files leaked into the wheel: {legacy_entries}"


def test_cli_version_flag(capsys):
    rc = cli.main(["--version"])
    out = capsys.readouterr().out
    assert rc == 0
    assert out.startswith("mobrpg ")
    assert any(ch.isdigit() for ch in out)
