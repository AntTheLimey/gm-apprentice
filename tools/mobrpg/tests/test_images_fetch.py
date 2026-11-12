"""images: a download that fails oddly is one failure, and a dry run does not
download a picture whose size already says it differs (#353)."""
import os

import pytest
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


def _ship_note(tmp_path, kind="Item"):
    note = tmp_path / "Items & Artifacts" / "st160.md"
    note.parent.mkdir(parents=True)
    note.write_text(
        '---\nname: ST-160\nportrait: "_attachments/items/st160.png"\nmobrpg:\n'
        f'  element_id: "e-9"\n  element_kind: "{kind}"\n---\nBody.\n',
        encoding="utf-8")
    items = tmp_path / "_attachments" / "items"
    items.mkdir(parents=True)
    (items / "st160.png").write_bytes(b"a different picture")
    (items / "The Albatross.png").write_bytes(b"albatross one")
    (items / "The Albatross 2.png").write_bytes(b"albatross two")
    return note


def _item_pages(monkeypatch, images_up):
    pages = {
        ("GET", "/world/w1/item"): {"content": [{"id": "e-9", "name": "ST-160"}],
                                    "page": {"totalPages": 1}},
        ("GET", "/world/w1/item/e-9"): {"files": [
            {"type": "Image", "url": f"https://cdn/{n}.png", "name": f"{n}.png"}
            for n in images_up]},
        ("GET", "/world/w1/generated/images"): [],
    }
    monkeypatch.setattr(client, "get_access_token", lambda: "tok")
    monkeypatch.setattr(client, "_request", lambda m, p, **k: pages.get((m, p), {}))
    bodies = {"https://cdn/a.png": b"albatross one",
              "https://cdn/b.png": b"albatross two"}
    monkeypatch.setattr(images, "_download", lambda url: bodies[url])
    monkeypatch.setattr(images, "_remote_size", lambda url: len(bodies[url]))


def test_an_image_already_in_the_vault_under_another_name_is_not_saved_again(
        tmp_path, monkeypatch, capsys):
    # #630: both upstream pictures sit in _attachments under other names
    _ship_note(tmp_path)
    _item_pages(monkeypatch, ["a", "b"])
    for flags in ([], ["--execute"]):
        assert images.run(["w1", "--vault", str(tmp_path), *flags]) == 0
        out = capsys.readouterr().out
        assert "saved only" not in out and "saved beside it" not in out
        assert "saved-only: 0" in out and "unchanged: 2" in out
    assert not list((tmp_path / "_attachments").rglob("*(mobRPG)*"))


def test_an_image_held_under_another_name_wires_an_empty_portrait(tmp_path, monkeypatch):
    note = _ship_note(tmp_path)
    note.write_text(note.read_text(encoding="utf-8").replace(
        'portrait: "_attachments/items/st160.png"', 'portrait: ""'), encoding="utf-8")
    _item_pages(monkeypatch, ["a"])
    assert images.run(["w1", "--vault", str(tmp_path), "--execute"]) == 0
    assert 'portrait: "_attachments/items/The Albatross.png"' in note.read_text(encoding="utf-8")
    assert not list((tmp_path / "_attachments").rglob("*(mobRPG)*"))
    assert not (tmp_path / "_attachments" / "items" / "st160 (mobRPG).png").exists()


@pytest.mark.skipif(os.name == "nt", reason="Windows file names cannot hold quotes")
def test_a_wired_portrait_path_with_quotes_stays_valid_yaml(tmp_path, monkeypatch):
    note = _ship_note(tmp_path)
    note.write_text(note.read_text(encoding="utf-8").replace(
        'portrait: "_attachments/items/st160.png"', 'portrait: ""'), encoding="utf-8")
    items = tmp_path / "_attachments" / "items"
    (items / "The Albatross.png").rename(items / 'The "Albatross" \\1.png')
    _item_pages(monkeypatch, ["a"])
    assert images.run(["w1", "--vault", str(tmp_path), "--execute"]) == 0
    text = note.read_text(encoding="utf-8")
    assert 'portrait: "_attachments/items/The \\"Albatross\\" \\\\1.png"' in text


def test_a_new_image_with_a_matching_size_but_other_bytes_is_still_saved(tmp_path, monkeypatch):
    _ship_note(tmp_path)
    _item_pages(monkeypatch, ["a"])
    monkeypatch.setattr(images, "_download", lambda url: b"albatross ONE")
    assert images.run(["w1", "--vault", str(tmp_path), "--execute"]) == 0
    assert (tmp_path / "_attachments" / "items" / "st160 (mobRPG).png").read_bytes() == b"albatross ONE"


def test_dry_run_downloads_when_the_server_gives_no_size_and_the_note_has_no_collision(
        tmp_path, monkeypatch, capsys):
    note = _ship_note(tmp_path)
    note.write_text(note.read_text(encoding="utf-8").replace(
        'portrait: "_attachments/items/st160.png"', 'portrait: ""'), encoding="utf-8")
    (tmp_path / "_attachments" / "items" / "st160.png").unlink()
    _item_pages(monkeypatch, ["a", "b"])
    monkeypatch.setattr(images, "_remote_size", lambda url: None)
    assert images.run(["w1", "--vault", str(tmp_path)]) == 0
    out = capsys.readouterr().out
    assert "would wire: 1" in out and "saved-only: 0" in out and "unchanged: 1" in out
