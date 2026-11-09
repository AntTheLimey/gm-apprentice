"""The update floor follows the release: for X.Y.Z it is X.(Y-1).0, the hop
is the newest release of that minor, and no check dated at or below the
floor is left. A vault below the floor is told which release to update with
first, and how to run it from its download."""

import json
import shutil
import sys
import tempfile
from pathlib import Path
from unittest import mock

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "skills" / "shared" / "scripts"))

import migrate  # noqa: E402
import vault_check as vc  # noqa: E402
import vaultlib  # noqa: E402
from vaultlib import parse_version  # noqa: E402

REAL_FLOOR_TESTS = True   # conftest leaves the update floor at its real value
VERSION = (ROOT / "skills" / "shared" / "VERSION").read_text(encoding="utf-8").strip()


def test_floor_is_the_first_release_of_the_minor_before():
    x, y, _ = parse_version(VERSION)
    if y == 0:
        pytest.skip("a major release sets its floor by hand")
    assert vc.MOVED_FLOOR == f"{x}.{y - 1}.0", (
        f"VERSION {VERSION} needs MOVED_FLOOR {x}.{y - 1}.0 and FLOOR_HOP the "
        f"newest {x}.{y - 1} tag (vault_check.py); then delete the checks "
        f"dated at or below it (vault_check.dead_checks) and run "
        f"scripts/template_history.py")


def test_hop_is_in_the_floors_minor_and_already_released():
    assert parse_version(vc.FLOOR_HOP)[:2] == parse_version(vc.MOVED_FLOOR)[:2]
    assert parse_version(vc.FLOOR_HOP) < parse_version(VERSION)


def test_no_check_is_dated_at_or_below_the_floor():
    assert vc.dead_checks(migrate.CHECKS, vc.MOVED_FLOOR) == []


def test_dead_checks_names_those_at_or_below_the_floor_in_order():
    checks = [migrate.Check("a", "1.10.5", 3, "a", lambda v: []),
              migrate.Check("b", None, 3, "b", lambda v: []),
              migrate.Check("c", "1.11.0", 3, "c", lambda v: []),
              migrate.Check("d", "1.11.1", 3, "d", lambda v: [])]
    assert vc.dead_checks(checks, "1.11.0") == ["a", "c"]


@pytest.fixture
def vault():
    root = Path(tempfile.mkdtemp(prefix="floor-"))
    v = root / "vault"
    (v / "_meta").mkdir(parents=True)
    (v / "_meta" / "vault-config.yaml").write_text("version: 1\n", encoding="utf-8")
    yield v
    shutil.rmtree(root, ignore_errors=True)


def stamp(v, version):
    (v / "_meta" / "vault-state.json").write_text(
        json.dumps({"gm_apprentice_version": version}) + "\n", encoding="utf-8")
    vaultlib.forget_settings(v)


def no_tool():
    return mock.patch.object(vc, "settings", side_effect=vaultlib.SettingsUnavailable(
        "could not read the vault's settings: node is not on PATH"))


def test_stamp_below_floor_names_the_hop_and_how_to_run_it(vault):
    stamp(vault, "1.10.90")
    with no_tool():
        line = vc.refusal(vc.unmoved(vault, "1.10.90"), "1.12.2")
    assert (f"update stamp of 1.10.90 (_meta/vault-state.json), older than "
            f"{vc.MOVED_FLOOR}") in line
    assert f"v{vc.FLOOR_HOP}.tar.gz" in line
    assert "skills/shared/scripts/gma.py update" in line
    assert "1.10.134" not in line   # a moved vault needs no 1.10 bridge
    assert line.endswith("Then run this update again.")


def test_unmoved_and_below_floor_says_the_bridge_first_then_the_hop(vault):
    stamp(vault, "1.10.90")
    (vault / "_meta" / "publish-manifest.md").write_text("old\n", encoding="utf-8")
    with no_tool():
        line = vc.refusal(vc.unmoved(vault, "1.10.90"), "1.12.2")
    assert line.index(vc.BRIDGE) < line.index(f"v{vc.FLOOR_HOP}.tar.gz")


def test_no_stamp_still_goes_to_the_bridge(vault):
    vaultlib.forget_settings(vault)
    with no_tool():
        left = vc.unmoved(vault, None)
    assert [x.bridge for x in left] == [True]
    assert vc.BRIDGE in vc.refusal(left, "1.12.2")


def test_a_stamp_at_the_floor_is_not_refused_for_its_stamp(vault):
    stamp(vault, vc.MOVED_FLOOR)
    with no_tool():
        assert vc.unmoved(vault, vc.MOVED_FLOOR) == []
