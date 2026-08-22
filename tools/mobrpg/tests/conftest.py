"""Default-deny network guard for the whole test suite.

The mobrpg CLI targets a live PRODUCTION world (https://www.mobrpg.com/api)
by default unless MOBRPG_ENV=dev is exported — see mobrpg/client.py. This test
suite must never make a real HTTP call: task #153's fix widened the surface
that can reach the network (pull-canon's main pass now calls
pull.live_element_ids unconditionally), and three tests were found to be
silently hitting production before they were individually stubbed.

Rather than rely on every test remembering to stub the network, this autouse
fixture makes it structural: it monkeypatches the two entry points every
mobrpg command funnels through (`client._request` and
`client.get_access_token`) to raise before each test runs. A test that
installs its own `monkeypatch.setattr(client, "_request", ...)` (directly or
via a module alias like `pull_canon.client`, `sync_cmd.client`, etc. — same
underlying module object) simply overrides this fixture's stub, since
pytest's fixture setup runs before the test body executes and the last
`setattr` wins. A test that reaches the network layer without installing its
own fake now fails loudly with a clear message instead of silently talking to
production.
"""
import pytest

from mobrpg import client

_REAL_REQUEST = client._request
_REAL_GET_ACCESS_TOKEN = client.get_access_token


def _blocked(*args, **kwargs):
    raise RuntimeError(
        "test reached the network layer without a stub — monkeypatch "
        "client._request in this test")


@pytest.fixture(autouse=True)
def _no_network(monkeypatch):
    monkeypatch.setattr(client, "_request", _blocked)
    monkeypatch.setattr(client, "get_access_token", _blocked)


@pytest.fixture
def unblock_client_network(monkeypatch):
    """Opt-out for tests/test_client.py and tests/test_client_auth.py, which
    unit-test the real `client._request` / `client.get_access_token` bodies
    directly (header construction, error mapping, credential precedence).
    Those tests fake the transport itself (`urllib.request.urlopen`) or the
    config/env layer, not `_request`/`get_access_token`, so the blanket
    `_no_network` guard above would otherwise block the very code under test.
    pytest instantiates explicitly-requested fixtures after autouse fixtures
    of the same scope, so this restore always runs after `_no_network` and
    wins."""
    monkeypatch.setattr(client, "_request", _REAL_REQUEST)
    monkeypatch.setattr(client, "get_access_token", _REAL_GET_ACCESS_TOKEN)
