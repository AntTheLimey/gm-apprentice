import os
import pytest
from mobrpg import client


def test_resolve_environment_defaults_to_prod(monkeypatch):
    for k in ("MOBRPG_ENV", "MOBRPG_BASE", "MOBRPG_CLIENT_ID", "MOBRPG_REDIRECT_URI"):
        monkeypatch.delenv(k, raising=False)
    env, base, client_id, redirect = client._resolve_environment()
    assert env == "prod"
    assert base == "https://www.mobrpg.com/api"


def test_resolve_environment_dev_preset(monkeypatch):
    monkeypatch.setenv("MOBRPG_ENV", "dev")
    for k in ("MOBRPG_BASE", "MOBRPG_CLIENT_ID", "MOBRPG_REDIRECT_URI"):
        monkeypatch.delenv(k, raising=False)
    env, base, _, redirect = client._resolve_environment()
    assert env == "dev"
    assert base == "http://localhost:8080/api"
    assert redirect == "http://localhost:5173/auth/complete"


def test_resolve_environment_unknown_falls_back_to_prod(monkeypatch):
    monkeypatch.setenv("MOBRPG_ENV", "staging")
    env, base, _, _ = client._resolve_environment()
    assert env == "prod"


def test_resolve_environment_field_override(monkeypatch):
    monkeypatch.setenv("MOBRPG_ENV", "dev")
    monkeypatch.setenv("MOBRPG_BASE", "http://example.test/api")
    env, base, _, _ = client._resolve_environment()
    assert env == "dev"
    assert base == "http://example.test/api"


def test_assert_writes_allowed_refuses_prod(monkeypatch):
    monkeypatch.setattr(client, "MOBRPG_ENV", "prod")
    monkeypatch.delenv("MOBRPG_ALLOW_PROD_WRITES", raising=False)
    with pytest.raises(SystemExit) as exc:
        client.assert_writes_allowed()
    assert exc.value.code == 3


def test_assert_writes_allowed_prod_with_optin(monkeypatch):
    monkeypatch.setattr(client, "MOBRPG_ENV", "prod")
    monkeypatch.setenv("MOBRPG_ALLOW_PROD_WRITES", "1")
    client.assert_writes_allowed()  # must not raise


def test_assert_writes_allowed_dev_ok(monkeypatch):
    monkeypatch.setattr(client, "MOBRPG_ENV", "dev")
    monkeypatch.delenv("MOBRPG_ALLOW_PROD_WRITES", raising=False)
    client.assert_writes_allowed()  # must not raise


def test_get_access_token_requires_auth(monkeypatch):
    for k in ("MOBRPG_TOKEN", "MOBRPG_EMAIL", "MOBRPG_PASSWORD"):
        monkeypatch.delenv(k, raising=False)
    with pytest.raises(SystemExit) as exc:
        client.get_access_token()
    assert exc.value.code == 2


def test_get_access_token_bearer(monkeypatch):
    monkeypatch.setenv("MOBRPG_TOKEN", "tok-123")
    assert client.get_access_token() == "tok-123"
