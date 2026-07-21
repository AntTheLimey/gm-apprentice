from mobrpg import client, config
from mobrpg.commands import auth


def _stub_whoami(monkeypatch, email="gm@x.io"):
    monkeypatch.setattr(client, "whoami",
                        lambda t: {"id": "u1", "email": email,
                                   "firstName": "Ada", "lastName": "L"})


def test_import_from_csv_verifies_and_writes(monkeypatch, tmp_path, capsys):
    monkeypatch.setenv("MOBRPG_CONFIG_DIR", str(tmp_path / "cfg"))
    _stub_whoami(monkeypatch)
    csv_path = tmp_path / "credentials.csv"
    csv_path.write_text("Type,Token\r\nAccessToken,acc-jwt\r\nRefreshToken,ref-jwt\r\n")
    rc = auth.run(["import", str(csv_path)])
    out = capsys.readouterr().out
    assert rc == 0
    assert "gm@x.io" in out
    assert "acc-jwt" not in out  # token never printed
    stored = config.read()
    assert stored["access_token"] == "acc-jwt"
    assert stored["refresh_token"] == "ref-jwt"
    assert stored["user"]["email"] == "gm@x.io"
    assert stored["source"] == "import"


def test_import_bad_csv_writes_nothing(monkeypatch, tmp_path, capsys):
    monkeypatch.setenv("MOBRPG_CONFIG_DIR", str(tmp_path / "cfg"))
    csv_path = tmp_path / "bad.csv"
    csv_path.write_text("Type,Token\nNope,whatever\n")
    rc = auth.run(["import", str(csv_path)])
    assert rc != 0
    assert config.read() is None


def test_import_verify_failure_writes_nothing(monkeypatch, tmp_path):
    monkeypatch.setenv("MOBRPG_CONFIG_DIR", str(tmp_path / "cfg"))

    def boom(t):
        raise client.ApiError(401, "unauthorized", "/user/me")

    monkeypatch.setattr(client, "whoami", boom)
    csv_path = tmp_path / "credentials.csv"
    csv_path.write_text("Type,Token\nAccessToken,acc\nRefreshToken,ref\n")
    rc = auth.run(["import", str(csv_path)])
    assert rc == 1
    assert config.read() is None


def test_import_access_token_flag(monkeypatch, tmp_path):
    monkeypatch.setenv("MOBRPG_CONFIG_DIR", str(tmp_path / "cfg"))
    _stub_whoami(monkeypatch)
    rc = auth.run(["import", "--access-token", "acc", "--refresh-token", "ref"])
    assert rc == 0
    assert config.read()["access_token"] == "acc"


def test_import_delete_source_removes_file(monkeypatch, tmp_path):
    monkeypatch.setenv("MOBRPG_CONFIG_DIR", str(tmp_path / "cfg"))
    _stub_whoami(monkeypatch)
    csv_path = tmp_path / "credentials.csv"
    csv_path.write_text("Type,Token\nAccessToken,acc\nRefreshToken,ref\n")
    rc = auth.run(["import", str(csv_path), "--delete-source"])
    assert rc == 0
    assert not csv_path.exists()


def test_import_without_delete_keeps_file_and_warns(monkeypatch, tmp_path, capsys):
    monkeypatch.setenv("MOBRPG_CONFIG_DIR", str(tmp_path / "cfg"))
    _stub_whoami(monkeypatch)
    csv_path = tmp_path / "credentials.csv"
    csv_path.write_text("Type,Token\nAccessToken,acc\nRefreshToken,ref\n")
    auth.run(["import", str(csv_path)])
    assert csv_path.exists()
    assert "delete" in capsys.readouterr().out.lower()


def test_status_configured(monkeypatch, tmp_path, capsys):
    monkeypatch.setenv("MOBRPG_CONFIG_DIR", str(tmp_path / "cfg"))
    config.write({"access_token": "acc", "user": {"email": "gm@x.io"},
                  "source": "import", "created_at": "2026-07-21T00:00:00Z"})
    rc = auth.run(["status"])
    out = capsys.readouterr().out
    assert rc == 0
    assert "gm@x.io" in out
    assert "acc" not in out  # token never printed


def test_status_not_configured(monkeypatch, tmp_path):
    monkeypatch.setenv("MOBRPG_CONFIG_DIR", str(tmp_path / "empty"))
    assert auth.run(["status"]) == 1


def test_refresh_rewrites_tokens(monkeypatch, tmp_path):
    monkeypatch.setenv("MOBRPG_CONFIG_DIR", str(tmp_path / "cfg"))
    config.write({"access_token": "old-a", "refresh_token": "old-r",
                  "user": {"email": "gm@x.io"}, "source": "import"})
    monkeypatch.setattr(client, "refresh_app_token",
                        lambda r: {"accessToken": "new-a", "refreshToken": "new-r"})
    _stub_whoami(monkeypatch)
    rc = auth.run(["refresh"])
    assert rc == 0
    stored = config.read()
    assert stored["access_token"] == "new-a"
    assert stored["refresh_token"] == "new-r"


def test_refresh_without_stored_token(monkeypatch, tmp_path):
    monkeypatch.setenv("MOBRPG_CONFIG_DIR", str(tmp_path / "empty"))
    assert auth.run(["refresh"]) == 1


def test_logout_removes_and_reports(monkeypatch, tmp_path, capsys):
    monkeypatch.setenv("MOBRPG_CONFIG_DIR", str(tmp_path / "cfg"))
    config.write({"access_token": "acc"})
    assert auth.run(["logout"]) == 0
    assert config.read() is None
    assert auth.run(["logout"]) == 0  # idempotent


def test_unknown_subcommand(monkeypatch, tmp_path):
    monkeypatch.setenv("MOBRPG_CONFIG_DIR", str(tmp_path / "cfg"))
    assert auth.run(["frobnicate"]) == 2
