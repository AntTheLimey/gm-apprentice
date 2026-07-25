import os
import urllib.error

import pytest
from mobrpg import client


class _FakeResp:
    """Minimal context-manager stand-in for a urllib response object."""

    def __init__(self, raw: bytes):
        self._raw = raw

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def read(self):
        return self._raw


def test_request_sends_authorization_bearer_header(monkeypatch):
    captured = {}

    def fake_urlopen(req, timeout=None):
        captured["req"] = req
        return _FakeResp(b'{"ok": true}')

    monkeypatch.setattr(client.urllib.request, "urlopen", fake_urlopen)
    out = client._request("GET", "/user/me", token="tok-abc")
    assert out == {"ok": True}
    assert captured["req"].get_header("Authorization") == "Bearer tok-abc"


def test_request_no_token_sends_no_authorization_header(monkeypatch):
    captured = {}

    def fake_urlopen(req, timeout=None):
        captured["req"] = req
        return _FakeResp(b"{}")

    monkeypatch.setattr(client.urllib.request, "urlopen", fake_urlopen)
    client._request("GET", "/health")
    assert captured["req"].get_header("Authorization") is None


def test_request_urlerror_maps_to_apierror_status_0(monkeypatch):
    def fake_urlopen(req, timeout=None):
        raise urllib.error.URLError("connection refused")

    monkeypatch.setattr(client.urllib.request, "urlopen", fake_urlopen)
    with pytest.raises(client.ApiError) as ei:
        client._request("GET", "/user/me", token="t")
    assert ei.value.status == 0


def test_request_empty_body_decodes_to_none(monkeypatch):
    def fake_urlopen(req, timeout=None):
        return _FakeResp(b"   ")

    monkeypatch.setattr(client.urllib.request, "urlopen", fake_urlopen)
    assert client._request("GET", "/x", token="t") is None


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


def test_get_access_token_requires_auth(monkeypatch):
    for k in ("MOBRPG_TOKEN", "MOBRPG_EMAIL", "MOBRPG_PASSWORD"):
        monkeypatch.delenv(k, raising=False)
    with pytest.raises(SystemExit) as exc:
        client.get_access_token()
    assert exc.value.code == 2


def test_get_access_token_bearer(monkeypatch):
    monkeypatch.setenv("MOBRPG_TOKEN", "tok-123")
    assert client.get_access_token() == "tok-123"
