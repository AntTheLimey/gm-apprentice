import pytest

from mobrpg import client, config


def test_env_token_wins_over_config(monkeypatch, tmp_path):
    monkeypatch.setenv("MOBRPG_CONFIG_DIR", str(tmp_path / "cfg"))
    config.write({"access_token": "from-config"})
    monkeypatch.setenv("MOBRPG_TOKEN", "from-env")
    assert client.get_access_token() == "from-env"


def test_config_used_when_no_env(monkeypatch, tmp_path):
    monkeypatch.delenv("MOBRPG_TOKEN", raising=False)
    monkeypatch.delenv("MOBRPG_EMAIL", raising=False)
    monkeypatch.delenv("MOBRPG_PASSWORD", raising=False)
    monkeypatch.setenv("MOBRPG_CONFIG_DIR", str(tmp_path / "cfg"))
    config.write({"access_token": "from-config"})
    assert client.get_access_token() == "from-config"


def test_falls_back_to_email_password(monkeypatch, tmp_path):
    monkeypatch.delenv("MOBRPG_TOKEN", raising=False)
    monkeypatch.setenv("MOBRPG_CONFIG_DIR", str(tmp_path / "empty"))
    monkeypatch.setenv("MOBRPG_EMAIL", "gm@x.io")
    monkeypatch.setenv("MOBRPG_PASSWORD", "pw")
    monkeypatch.setattr(client, "login",
                        lambda e, p: {"accessToken": "logged-in", "user": {"id": "u1"}})
    assert client.get_access_token() == "logged-in"


def test_error_when_nothing_configured(monkeypatch, tmp_path, capsys):
    monkeypatch.delenv("MOBRPG_TOKEN", raising=False)
    monkeypatch.delenv("MOBRPG_EMAIL", raising=False)
    monkeypatch.delenv("MOBRPG_PASSWORD", raising=False)
    monkeypatch.setenv("MOBRPG_CONFIG_DIR", str(tmp_path / "empty"))
    with pytest.raises(SystemExit) as ei:
        client.get_access_token()
    assert ei.value.code == 2
    assert "mobrpg auth import" in capsys.readouterr().err


def test_token_value_never_printed(monkeypatch, tmp_path, capsys):
    monkeypatch.delenv("MOBRPG_TOKEN", raising=False)
    monkeypatch.setenv("MOBRPG_CONFIG_DIR", str(tmp_path / "cfg"))
    config.write({"access_token": "sup3r-secret"})
    client.get_access_token()
    captured = capsys.readouterr()
    assert "sup3r-secret" not in captured.out
    assert "sup3r-secret" not in captured.err


def test_refresh_app_token_hits_refresh_endpoint(monkeypatch):
    calls = {}

    def fake_request(method, path, *, token=None, query=None, body=None):
        calls.update(method=method, path=path, query=query)
        return {"accessToken": "new-a", "refreshToken": "new-r"}

    monkeypatch.setattr(client, "_request", fake_request)
    out = client.refresh_app_token("old-r")
    assert out == {"accessToken": "new-a", "refreshToken": "new-r"}
    assert calls["method"] == "GET"
    assert calls["path"] == "/app/token/refresh"
    assert calls["query"] == {"refreshToken": "old-r"}
