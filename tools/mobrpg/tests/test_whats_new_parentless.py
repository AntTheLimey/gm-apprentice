"""whats-new names the locations with no parent_location while the vault has a star system.

#309 asked for it; #353 left it. An orphan that matches no naming rule (a city, a
station, a base) is exactly such a location, so this is also what flags it."""
import json

from mobrpg.commands import whats_new


def _loc(root, name, text):
    p = root / "Locations" / f"{name}.md"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")


def _vault(tmp_path):
    _loc(tmp_path, "Corwin System", '---\ntype: location\nlocation_type: star system\nparent_location: ""\n---\n')
    _loc(tmp_path, "Corwin II", '---\ntype: location\nparent_location: "[[Corwin System]]"\n---\n')
    _loc(tmp_path, "Port Anselm", '---\ntype: location\nparent_location: ""\n---\n')
    _loc(tmp_path, "Outpost 9", '---\ntype: location\n---\n')
    _loc(tmp_path, "Gate Station", "---\ntype: location\nparent_location:\n---\n")


def test_locations_without_a_parent_are_listed_and_the_system_is_not(tmp_path):
    _vault(tmp_path)
    assert whats_new.parentless_locations(str(tmp_path)) == [
        "Gate Station", "Outpost 9", "Port Anselm"]


def test_a_vault_with_no_system_note_has_nothing_to_report(tmp_path):
    _loc(tmp_path, "Port Anselm", '---\ntype: location\nparent_location: ""\n---\n')
    assert whats_new.parentless_locations(str(tmp_path)) == []


def test_the_report_and_json_carry_them(tmp_path, capsys):
    _vault(tmp_path)
    ex = tmp_path / "extract.json"
    ex.write_text(json.dumps({"worldId": "w1", "types": {}, "entities": []}), encoding="utf-8")
    assert whats_new.run(["w1", "--vault", str(tmp_path), "--extract", str(ex)]) == 0
    out = capsys.readouterr().out
    assert "no parent_location" in out and "Port Anselm" in out and "Corwin II" not in out
    assert whats_new.run(["w1", "--vault", str(tmp_path), "--extract", str(ex), "--json"]) == 0
    assert json.loads(capsys.readouterr().out)["parentless_locations"] == [
        "Gate Station", "Outpost 9", "Port Anselm"]


def test_a_place_named_like_its_system_is_still_reported(tmp_path):
    # Corwin (a planet) shares the bare name of Corwin System; only the system note is left out.
    _loc(tmp_path, "Corwin System", '---\ntype: location\nlocation_type: star system\n---\n')
    _loc(tmp_path, "Corwin", '---\ntype: location\nparent_location: ""\n---\n')
    assert whats_new.parentless_locations(str(tmp_path)) == ["Corwin"]
