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


def test_follows_total_pages(monkeypatch, capsys):
    # A world bigger than one page must list in full. Catalog is what a user
    # reads to decide whether a Type already exists; a silently truncated list
    # reads as "it isn't there" and they mint a duplicate.
    pages = {
        0: {"content": [{"id": "a", "name": "Alpha"}], "page": {"totalPages": 3}},
        1: {"content": [{"id": "b", "name": "Bravo"}], "page": {"totalPages": 3}},
        2: {"content": [{"id": "c", "name": "Charlie"}], "page": {"totalPages": 3}},
    }
    seen = []

    def fake(method, path, *, token=None, body=None):
        page = int(path.rsplit("page=", 1)[1])
        seen.append(page)
        return pages[page]

    monkeypatch.setattr(client, "get_access_token", lambda: "tok")
    monkeypatch.setattr(client, "_request", fake)
    rc = catalog.run(["world-1", "person"])
    assert rc == 0
    assert seen == [0, 1, 2]
    out = capsys.readouterr().out
    assert "person: 3" in out
    for name in ("Alpha", "Bravo", "Charlie"):
        assert name in out


def test_bare_list_is_unpaged(monkeypatch, capsys):
    # Some endpoints answer with a bare list and no page envelope; that is the
    # whole collection, so it must not be re-requested forever.
    calls = []

    def fake(method, path, *, token=None, body=None):
        calls.append(path)
        return [{"id": str(i), "name": f"n{i}"} for i in range(3)]

    monkeypatch.setattr(client, "get_access_token", lambda: "tok")
    monkeypatch.setattr(client, "_request", fake)
    rc = catalog.run(["world-1", "person", "--size", "3"])
    assert rc == 0
    assert len(calls) == 1
    assert "person: 3" in capsys.readouterr().out


def test_paging_failure_is_reported_not_truncated(monkeypatch, capsys):
    # Strict by design: a mid-pagination failure must exit non-zero rather than
    # print a partial catalog that reads as complete.
    def fake(method, path, *, token=None, body=None):
        if path.endswith("page=0"):
            return {"content": [{"id": "a", "name": "Alpha"}], "page": {"totalPages": 2}}
        raise client.ApiError(500, "boom", path)

    monkeypatch.setattr(client, "get_access_token", lambda: "tok")
    monkeypatch.setattr(client, "_request", fake)
    assert catalog.run(["world-1", "person"]) == 1
    assert "ERROR" in capsys.readouterr().err


def test_api_error_returns_1(monkeypatch, capsys):
    def boom(*a, **k):
        raise client.ApiError(500, "boom", "/world/world-1/landfeature")

    monkeypatch.setattr(client, "get_access_token", lambda: "tok")
    monkeypatch.setattr(client, "_request", boom)
    assert catalog.run(["world-1", "landfeature"]) == 1
