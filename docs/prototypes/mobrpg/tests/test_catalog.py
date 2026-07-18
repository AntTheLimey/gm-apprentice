from mobrpg import client
from mobrpg.commands import catalog


def test_lists_names_sorted(monkeypatch, capsys):
    calls = {}

    def fake(method, path, *, token=None, body=None):
        calls["path"] = path
        return [{"id": "t2", "name": "District"}, {"id": "t1", "name": "City"}]

    monkeypatch.setattr(client, "get_access_token", lambda: "tok")
    monkeypatch.setattr(client, "_request", fake)
    rc = catalog.run(["world-1", "political/type"])
    assert rc == 0
    assert "/world/world-1/political/type?size=200" in calls["path"]  # paginated request
    out = capsys.readouterr().out
    # sorted: City before District
    assert out.index("City") < out.index("District")
    assert "political/type: 2" in out


def test_names_only(monkeypatch, capsys):
    monkeypatch.setattr(client, "get_access_token", lambda: "tok")
    monkeypatch.setattr(client, "_request",
                        lambda *a, **k: {"content": [{"id": "1", "name": "River Thames"}]})
    rc = catalog.run(["world-1", "landfeature", "--names-only"])
    assert rc == 0
    assert capsys.readouterr().out.strip() == "River Thames"


def test_full_page_warns_of_more(monkeypatch, capsys):
    monkeypatch.setattr(client, "get_access_token", lambda: "tok")
    monkeypatch.setattr(client, "_request",
                        lambda *a, **k: [{"id": str(i), "name": f"n{i}"} for i in range(3)])
    rc = catalog.run(["world-1", "person", "--size", "3"])
    assert rc == 0
    assert "there may be more" in capsys.readouterr().err


def test_api_error_returns_1(monkeypatch, capsys):
    def boom(*a, **k):
        raise client.ApiError(500, "boom", "/world/world-1/landfeature")

    monkeypatch.setattr(client, "get_access_token", lambda: "tok")
    monkeypatch.setattr(client, "_request", boom)
    assert catalog.run(["world-1", "landfeature"]) == 1
