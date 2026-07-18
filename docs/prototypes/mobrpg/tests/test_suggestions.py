import json
import os

from mobrpg import client
from mobrpg.commands import suggestions


def _accepted_row(**over):
    row = {
        "id": "s1", "operation": "CreateElement", "reviewState": "Accepted",
        "externalRef": "canticle:Locations/Fourviere", "resultElementId": "el-9",
        "batchId": "b1", "payload": {"name": "Fourviere", "data": {"type": "Political"}},
    }
    row.update(over)
    return row


def test_resolve_vault_file(tmp_path):
    # build a fake vault with one file present, one missing
    (tmp_path / "Locations").mkdir()
    (tmp_path / "Locations" / "Fourviere.md").write_text("x")
    present = suggestions._resolve_vault_file("canticle:Locations/Fourviere", str(tmp_path))
    assert present.endswith("Locations/Fourviere.md") and "(MISSING)" not in present
    missing = suggestions._resolve_vault_file("canticle:Locations/Nope", str(tmp_path))
    assert missing.startswith("(MISSING)")
    # no vault, or no ref -> None
    assert suggestions._resolve_vault_file("canticle:Locations/Fourviere", None) is None
    assert suggestions._resolve_vault_file("", str(tmp_path)) is None


def test_list_default_pending(monkeypatch, capsys):
    calls = {}

    def fake(method, path, *, token=None, body=None):
        calls["path"] = path
        return [_accepted_row(reviewState="Pending", resultElementId="")]

    monkeypatch.setattr(client, "get_access_token", lambda: "tok")
    monkeypatch.setattr(client, "_request", fake)
    rc = suggestions.run(["world-1"])
    assert rc == 0
    assert "reviewState=Pending" in calls["path"]  # default state
    out = capsys.readouterr().out
    assert "Pending suggestions: 1" in out and "Fourviere" in out


def test_correlate_and_fetch_elements(monkeypatch, capsys, tmp_path):
    (tmp_path / "Locations").mkdir()
    (tmp_path / "Locations" / "Fourviere.md").write_text("x")

    def fake(method, path, *, token=None, body=None):
        if path.endswith("reviewState=Accepted"):
            return [_accepted_row()]
        # element fetch for resultElementId
        assert "/political/el-9" in path
        return {"id": "el-9", "name": "Fourviere"}

    monkeypatch.setattr(client, "get_access_token", lambda: "tok")
    monkeypatch.setattr(client, "_request", fake)
    rc = suggestions.run(["world-1", "--state", "Accepted", "--correlate",
                          "--vault", str(tmp_path), "--fetch-elements", "--json"])
    assert rc == 0
    report = json.loads(capsys.readouterr().out)
    assert report[0]["resultElementId"] == "el-9"
    assert report[0]["vaultFile"].endswith("Locations/Fourviere.md")
    assert report[0]["elementExists"] is True


def test_api_error_returns_1(monkeypatch, capsys):
    def boom(*a, **k):
        raise client.ApiError(403, "forbidden", "/world/world-1/suggestion")

    monkeypatch.setattr(client, "get_access_token", lambda: "tok")
    monkeypatch.setattr(client, "_request", boom)
    rc = suggestions.run(["world-1", "--state", "Accepted"])
    assert rc == 1
    assert "ReadWriteDelete" in capsys.readouterr().err
