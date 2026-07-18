import json

from mobrpg import client
from mobrpg.commands import update


def _payload_file(tmp_path):
    f = tmp_path / "u.json"
    f.write_text(json.dumps({"payload": {"operation": "CreateElement", "name": "Abbe Ferrant",
                                         "description": "<p>x</p>", "altNames": [],
                                         "data": {"type": "Person", "languages": [], "equipment": []}}}))
    return f


def test_dry_run_no_call(tmp_path, monkeypatch, capsys):
    f = _payload_file(tmp_path)

    def boom(*a, **k):
        raise AssertionError("no API in dry-run")

    monkeypatch.setattr(client, "_request", boom)
    monkeypatch.setattr(client, "assert_writes_allowed", boom)
    rc = update.run(["w1", "s1", str(f)])
    assert rc == 0
    assert "DRY-RUN" in capsys.readouterr().out


def test_execute_puts_body(tmp_path, monkeypatch, capsys):
    f = _payload_file(tmp_path)
    calls = {}

    def fake(method, path, *, token=None, body=None):
        calls["method"], calls["path"], calls["body"] = method, path, body
        return {"id": "s1", "reviewState": "Pending"}

    monkeypatch.setattr(client, "assert_writes_allowed", lambda: None)
    monkeypatch.setattr(client, "get_access_token", lambda: "tok")
    monkeypatch.setattr(client, "_request", fake)
    rc = update.run(["w1", "s1", str(f), "--execute"])
    assert rc == 0
    assert calls["method"] == "PUT"
    assert calls["path"].endswith("/world/w1/suggestion/s1")
    assert calls["body"]["payload"]["name"] == "Abbe Ferrant"


def test_rejects_non_payload_file(tmp_path, monkeypatch):
    f = tmp_path / "bad.json"
    f.write_text(json.dumps({"nope": 1}))
    assert update.run(["w1", "s1", str(f)]) == 2


def test_missing_file(monkeypatch):
    assert update.run(["w1", "s1", "/no/such.json"]) == 2
