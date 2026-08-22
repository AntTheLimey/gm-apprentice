import json

from mobrpg import client
from mobrpg.commands import submit_batch


def _batch():
    return {
        "batchLabel": "compound",
        "suggestions": [
            {"ref": "t1", "operation": "CreateElement",
             "payload": {"operation": "CreateElement", "name": "Surgeon", "altNames": [],
                         "description": "<p>.</p>", "data": {"type": "Profession"}}},
            {"ref": "p1", "operation": "CreateElement",
             "payload": {"operation": "CreateElement", "name": "Dr X", "altNames": [],
                         "description": "<p>.</p>",
                         "data": {"type": "Person", "languages": [], "equipment": []}}},
            {"operation": "AddRelation",
             "payload": {"operation": "AddRelation", "sourceRef": "suggestion:t1",
                         "targetRef": "suggestion:p1", "type": "Attribute"},
             "dependsOn": ["t1", "p1"]},
        ],
    }


def test_dry_run_summarizes_no_call(tmp_path, monkeypatch, capsys):
    f = tmp_path / "b.json"
    f.write_text(json.dumps(_batch()))

    def boom(*a, **k):
        raise AssertionError("no API in dry-run")

    monkeypatch.setattr(client, "_request", boom)
    rc = submit_batch.run(["w1", str(f)])
    assert rc == 0
    out = capsys.readouterr().out
    assert "DRY-RUN" in out and "CreateElement" in out and "AddRelation" in out
    assert "Surgeon" in out and "suggestion:t1 -> suggestion:p1" in out


def test_execute_posts_body(tmp_path, monkeypatch, capsys):
    f = tmp_path / "b.json"
    f.write_text(json.dumps(_batch()))
    calls = {}

    def fake(method, path, *, token=None, body=None):
        calls["path"], calls["body"] = path, body
        return {"suggestions": [{"id": "s1", "operation": "CreateElement", "reviewState": "Pending",
                                 "payload": {"name": "Surgeon"}}],
                "resolvedRefs": {"t1": "existing-prof-id"}}

    monkeypatch.setattr(client, "get_access_token", lambda: "tok")
    monkeypatch.setattr(client, "_request", fake)
    rc = submit_batch.run(["w1", str(f), "--execute"])
    assert rc == 0
    assert calls["path"].endswith("/world/w1/suggestion")
    assert len(calls["body"]["suggestions"]) == 3
    out = capsys.readouterr().out
    assert "1 stored" in out and "resolvedRefs" in out


def test_bad_file_returns_2(monkeypatch):
    assert submit_batch.run(["w1", "/no/such/file.json"]) == 2


def test_submit_helper_execute_returns_response(monkeypatch):
    calls = {}
    def fake(method, path, *, token=None, body=None):
        calls["path"] = path
        return {"suggestions": [{"id": "s1", "operation": "CreateElement",
                                 "reviewState": "Pending", "payload": {"name": "X"}}],
                "resolvedRefs": {}}
    monkeypatch.setattr(client, "get_access_token", lambda: "tok")
    monkeypatch.setattr(client, "_request", fake)
    resp = submit_batch.submit("w1", {"batchLabel": "b", "suggestions": [{"ref": "e1"}]},
                               execute=True)
    assert calls["path"].endswith("/world/w1/suggestion")
    assert resp["suggestions"][0]["id"] == "s1"


def test_submit_helper_dry_run_no_call(monkeypatch, capsys):
    def boom(*a, **k):
        raise AssertionError("no API in dry-run")
    monkeypatch.setattr(client, "_request", boom)
    resp = submit_batch.submit("w1", {"batchLabel": "b", "suggestions": []}, execute=False)
    assert resp == {}
    assert "DRY-RUN" in capsys.readouterr().out


def test_submit_distinguishes_stored_corrected_claimed(monkeypatch, capsys):
    resp = {"suggestions": [
                {"id": "s1", "reviewState": "Pending", "operation": "UpdateElement",
                 "externalRef": "ns:A", "payload": {"name": "A"}},
                {"id": "s2", "reviewState": "Pending", "operation": "UpdateElement",
                 "externalRef": "ns:B", "payload": {"name": "B"}},
                {"id": "s3", "reviewState": "Accepted", "operation": "CreateElement",
                 "externalRef": "ns:C", "payload": {"name": "C"}},
                {"id": "s4", "reviewState": "Dismissed", "operation": "CreateElement",
                 "externalRef": "ns:D", "payload": {"name": "D"}}],
            "resolvedRefs": {}, "updatedIds": ["s2"]}
    monkeypatch.setattr(client, "get_access_token", lambda: "tok")
    monkeypatch.setattr(client, "_request", lambda m, p, **k: resp)
    out = submit_batch.submit("w1", {"suggestions": [{}] * 4}, execute=True)
    text = capsys.readouterr().out
    assert "1 stored" in text
    assert "1 corrected in place" in text
    assert "2 already claimed" in text
    assert "ns:C" in text and "ns:D" in text     # the refs the GM will never see
    assert out is resp                            # return value unchanged


def test_submit_plain_first_submit_reports_all_stored(monkeypatch, capsys):
    resp = {"suggestions": [{"id": "s1", "reviewState": "Pending",
                             "operation": "CreateElement", "externalRef": "ns:A",
                             "payload": {"name": "A"}}],
            "resolvedRefs": {}}                   # no updatedIds key at all
    monkeypatch.setattr(client, "get_access_token", lambda: "tok")
    monkeypatch.setattr(client, "_request", lambda m, p, **k: resp)
    submit_batch.submit("w1", {"suggestions": [{}]}, execute=True)
    text = capsys.readouterr().out
    assert "1 stored" in text
    assert "already claimed" not in text and "corrected" not in text
