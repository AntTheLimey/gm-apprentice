from mobrpg import client
from mobrpg.commands import whoami


def test_whoami_prints_identity_and_worlds(monkeypatch, capsys):
    monkeypatch.setenv("MOBRPG_TOKEN", "tok")
    monkeypatch.setattr(client, "whoami",
                        lambda t: {"id": "u1", "email": "gm@x.io",
                                   "firstName": "Ada", "lastName": "L"})
    monkeypatch.setattr(client, "list_worlds",
                        lambda t: {"content": [
                            {"name": "Dead End", "id": "w1", "gameSystemType": "COC"}]})
    rc = whoami.run([])
    out = capsys.readouterr().out
    assert rc == 0
    assert "gm@x.io" in out
    assert "Dead End" in out


def test_whoami_reports_api_error(monkeypatch, capsys):
    monkeypatch.setenv("MOBRPG_TOKEN", "tok")

    def boom(t):
        raise client.ApiError(500, "kaboom", "/user/me")

    monkeypatch.setattr(client, "whoami", boom)
    rc = whoami.run([])
    err = capsys.readouterr().err
    assert rc == 1
    assert "kaboom" in err
