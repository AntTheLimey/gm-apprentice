import pytest

from mobrpg import client
from mobrpg.commands import images


def _note(tmp_path, portrait='portrait: ""'):
    note = tmp_path / "Characters" / "NPCs" / "vela.md"
    note.parent.mkdir(parents=True)
    note.write_text(
        "---\nname: Vela\n" + portrait + "\nmobrpg:\n  element_id: \"e-1\"\n"
        "  element_kind: \"Person\"\n---\nBody.\n",
        encoding="utf-8",
    )
    return note


def _pages():
    return {
        ("GET", "/world/w1/person"): {"content": [{"id": "e-1", "name": "Vela"}],
                                       "page": {"totalPages": 1}},
        ("GET", "/world/w1/person/e-1"): {"files": [
            {"type": "Image", "url": "https://cdn/x.png", "name": "x.png"}]},
        ("GET", "/world/w1/generated/images"): [],
    }


def test_execute_downloads_and_fills_portrait(tmp_path, monkeypatch):
    note = _note(tmp_path)
    pages = _pages()
    monkeypatch.setattr(client, "get_access_token", lambda: "tok")
    monkeypatch.setattr(client, "_request",
                         lambda m, p, **k: pages.get((m, p), {}))
    monkeypatch.setattr(images, "_download", lambda url: b"\x89PNG fake")
    assert images.run(["w1", "--vault", str(tmp_path), "--execute"]) == 0
    saved = list((tmp_path / "_attachments").rglob("*.png"))
    assert saved
    assert saved[0].read_bytes() == b"\x89PNG fake"
    assert 'portrait: ""' not in note.read_text(encoding="utf-8")
    assert 'portrait: "_attachments/characters/vela.png"' in note.read_text(encoding="utf-8")


def test_dry_run_downloads_and_writes_nothing(tmp_path, monkeypatch, capsys):
    note = _note(tmp_path)
    before = note.read_text(encoding="utf-8")
    pages = _pages()
    monkeypatch.setattr(client, "get_access_token", lambda: "tok")
    monkeypatch.setattr(client, "_request",
                         lambda m, p, **k: pages.get((m, p), {}))

    def boom(url):
        raise AssertionError("dry-run must never download")
    monkeypatch.setattr(images, "_download", boom)

    assert images.run(["w1", "--vault", str(tmp_path)]) == 0
    assert not (tmp_path / "_attachments").exists()
    assert note.read_text(encoding="utf-8") == before
    out = capsys.readouterr().out
    assert "would wire" in out
    assert "dry-run" in out


def test_never_overwrites_existing_attachment(tmp_path, monkeypatch):
    _note(tmp_path)
    dest_dir = tmp_path / "_attachments" / "characters"
    dest_dir.mkdir(parents=True)
    (dest_dir / "vela.png").write_bytes(b"existing")
    pages = _pages()
    monkeypatch.setattr(client, "get_access_token", lambda: "tok")
    monkeypatch.setattr(client, "_request",
                         lambda m, p, **k: pages.get((m, p), {}))
    monkeypatch.setattr(images, "_download", lambda url: b"new bytes")
    assert images.run(["w1", "--vault", str(tmp_path), "--execute"]) == 0
    assert (dest_dir / "vela.png").read_bytes() == b"existing"          # untouched
    assert (dest_dir / "vela (mobRPG).png").read_bytes() == b"new bytes"


def test_occupied_portrait_left_alone_and_reported(tmp_path, monkeypatch, capsys):
    note = _note(tmp_path, portrait='portrait: "already/set.png"')
    pages = _pages()
    monkeypatch.setattr(client, "get_access_token", lambda: "tok")
    monkeypatch.setattr(client, "_request",
                         lambda m, p, **k: pages.get((m, p), {}))
    monkeypatch.setattr(images, "_download", lambda url: b"bytes")
    assert images.run(["w1", "--vault", str(tmp_path), "--execute"]) == 0
    assert 'portrait: "already/set.png"' in note.read_text(encoding="utf-8")
    assert "portrait already set" in capsys.readouterr().out


def test_download_refuses_non_https_schemes():
    # The image URL comes from the world API. urlopen speaks file: too, so an
    # unchecked URL turns `images --execute` into a local-file read.
    for bad in ("file:///etc/passwd", "ftp://host/x.png", "http://example.com/x.png"):
        with pytest.raises(ValueError):
            images._check_url(bad)


def test_download_refuses_embedded_credentials():
    with pytest.raises(ValueError):
        images._check_url("https://user:pw@cdn/x.png")


def test_download_allows_https_and_loopback_http():
    # loopback http is the dev/local environment preset, not a bypass
    assert images._check_url("https://cdn/x.png")
    assert images._check_url("http://localhost:8080/x.png")


def test_safe_component_cannot_escape_or_break_yaml():
    assert "/" not in images._safe_component("../../etc/passwd")
    assert ".." not in images._safe_component("../../etc/passwd")
    assert '"' not in images._safe_component('he said "hi"')
    assert images._safe_component("") == "unnamed"
    # a dots-only name must not survive as a relative path segment
    assert images._safe_component("...") not in (".", "..", "...")
    assert images._safe_component("..") not in (".", "..")


def test_safe_ext_rejects_junk_carved_off_a_url():
    assert images._safe_ext(".png") == ".png"
    assert images._safe_ext('.pn"g') == ".png"   # would have broken portrait: "..."
    assert images._safe_ext("") == ".png"
    assert images._safe_ext("./../x") == ".png"
