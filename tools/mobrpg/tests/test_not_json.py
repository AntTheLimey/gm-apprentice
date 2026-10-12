"""#307: a 200 text/html answer, driven through the real client._request, must
keep meaning "this kind holds no elements" to every caller that relied on the
old JSONDecodeError (a ValueError)."""
import io

from mobrpg import client
from mobrpg.commands import pull, rel_baseline


class _Resp(io.BytesIO):
    headers = {"Content-Type": "text/html"}

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def _html_everywhere(monkeypatch):
    monkeypatch.setattr(client.urllib.request, "urlopen",
                        lambda req, timeout=None: _Resp(b"<!doctype html><html></html>"))


def test_live_element_ids_survives_html_200(monkeypatch, unblock_client_network):
    _html_everywhere(monkeypatch)
    assert pull.live_element_ids("w1", "tok") == set()


def test_list_all_survives_html_200(monkeypatch, unblock_client_network):
    _html_everywhere(monkeypatch)
    assert pull._list_all("w1", "race", "tok") == []


def test_get_one_survives_html_200(monkeypatch, unblock_client_network):
    _html_everywhere(monkeypatch)
    assert pull._get_one("w1", "race", "r1", "tok") == {}


def test_relations_fetch_survives_html_200(monkeypatch, unblock_client_network):
    _html_everywhere(monkeypatch)
    assert rel_baseline._get_relations("w1", "person", "p1", "tok") == []
