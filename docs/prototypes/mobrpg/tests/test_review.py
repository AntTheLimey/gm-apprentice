from mobrpg import client
from mobrpg.commands import review


def test_dry_run_makes_no_call(monkeypatch, capsys):
    def boom(*a, **k):
        raise AssertionError("must not call the API in dry-run")

    monkeypatch.setattr(client, "_request", boom)
    monkeypatch.setattr(client, "assert_writes_allowed", boom)
    rc = review.run(["w1", "s1", "dismiss", "--note", "needs a type"])
    assert rc == 0
    out = capsys.readouterr().out
    assert "DRY-RUN" in out and "/suggestion/s1/dismiss" in out


def test_execute_dismiss_posts_note(monkeypatch, capsys):
    calls = {}

    def fake(method, path, *, token=None, body=None):
        calls["method"], calls["path"], calls["body"] = method, path, body
        return {"id": "s1", "reviewState": "Dismissed"}

    monkeypatch.setattr(client, "assert_writes_allowed", lambda: None)
    monkeypatch.setattr(client, "get_access_token", lambda: "tok")
    monkeypatch.setattr(client, "_request", fake)
    rc = review.run(["w1", "s1", "dismiss", "--note", "needs a type", "--execute"])
    assert rc == 0
    assert calls["method"] == "POST"
    assert calls["path"].endswith("/suggestion/s1/dismiss")
    assert calls["body"] == {"reviewNote": "needs a type"}
    assert "Dismissed" in capsys.readouterr().out


def test_execute_accept_no_body(monkeypatch, capsys):
    calls = {}

    monkeypatch.setattr(client, "assert_writes_allowed", lambda: None)
    monkeypatch.setattr(client, "get_access_token", lambda: "tok")
    monkeypatch.setattr(client, "_request",
                        lambda m, p, *, token=None, body=None: calls.update(path=p, body=body)
                        or {"id": "s1", "reviewState": "Accepted", "resultElementId": "e9"})
    rc = review.run(["w1", "s1", "accept", "--execute"])
    assert rc == 0
    assert calls["path"].endswith("/suggestion/s1/accept")
    assert calls["body"] is None  # accept takes no body


def test_write_guard_blocks(monkeypatch, capsys):
    def guard():
        raise SystemExit(3)

    monkeypatch.setattr(client, "assert_writes_allowed", guard)
    try:
        review.run(["w1", "s1", "accept", "--execute"])
        assert False, "expected the write guard to stop execution"
    except SystemExit as e:
        assert e.code == 3
