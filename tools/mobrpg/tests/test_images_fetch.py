"""images: a download that fails oddly is one failure, and a dry run does not
download a picture whose size already says it differs (#353)."""
import http.client

from mobrpg import client
from mobrpg.commands import images

from tests.test_images import _note, _pages


def _stub(monkeypatch):
    pages = _pages()
    monkeypatch.setattr(client, "get_access_token", lambda: "tok")
    monkeypatch.setattr(client, "_request", lambda m, p, **k: pages.get((m, p), {}))


def test_an_incomplete_read_is_a_failed_image_not_a_crash(tmp_path, monkeypatch, capsys):
    _note(tmp_path)
    _stub(monkeypatch)

    def boom(url):
        raise http.client.IncompleteRead(b"par")
    monkeypatch.setattr(images, "_download", boom)
    assert images.run(["w1", "--vault", str(tmp_path), "--execute"]) == 1
    assert "failed: 1" in capsys.readouterr().out


def _with_portrait(tmp_path):
    note = _note(tmp_path, portrait='portrait: "_attachments/characters/vela.png"')
    pic = tmp_path / "_attachments" / "characters" / "vela.png"
    pic.parent.mkdir(parents=True)
    pic.write_bytes(b"local picture")
    return note


def test_dry_run_skips_the_download_when_the_remote_size_differs(tmp_path, monkeypatch, capsys):
    _with_portrait(tmp_path)
    _stub(monkeypatch)
    monkeypatch.setattr(images, "_remote_size", lambda url: 9999)

    def no_download(url):
        raise AssertionError("downloaded a picture whose size already differs")
    monkeypatch.setattr(images, "_download", no_download)
    assert images.run(["w1", "--vault", str(tmp_path)]) == 0
    assert "differs" in capsys.readouterr().out


def test_dry_run_downloads_when_the_size_matches_or_is_unknown(tmp_path, monkeypatch, capsys):
    _with_portrait(tmp_path)
    _stub(monkeypatch)
    calls = []
    monkeypatch.setattr(images, "_download", lambda url: calls.append(url) or b"local picture")
    for size in (len(b"local picture"), None):
        monkeypatch.setattr(images, "_remote_size", lambda url, s=size: s)
        assert images.run(["w1", "--vault", str(tmp_path)]) == 0
    assert len(calls) == 2
    assert "unchanged: 1" in capsys.readouterr().out


def test_execute_still_downloads_whatever_the_size(tmp_path, monkeypatch):
    _with_portrait(tmp_path)
    _stub(monkeypatch)
    monkeypatch.setattr(images, "_remote_size", lambda url: 9999)
    monkeypatch.setattr(images, "_download", lambda url: b"new picture")
    assert images.run(["w1", "--vault", str(tmp_path), "--execute"]) == 0
    saved = {p.name: p.read_bytes() for p in (tmp_path / "_attachments").rglob("*.png")}
    assert saved["vela (mobRPG).png"] == b"new picture"
