"""Packaging / wheel-install regressions (RELEASE-BLOCKERS B5 + --version)."""

import importlib

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


def test_cli_version_flag(capsys):
    rc = cli.main(["--version"])
    out = capsys.readouterr().out
    assert rc == 0
    assert out.startswith("mobrpg ")
    assert any(ch.isdigit() for ch in out)
