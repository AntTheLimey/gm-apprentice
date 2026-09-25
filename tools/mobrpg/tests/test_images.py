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


# --- #185: images --push ---

def _push_vault(tmp_path, portrait='portrait: "Vela.png"', body="Body.\n![[map.png]]\n"):
    note = tmp_path / "Characters" / "NPCs" / "vela.md"
    note.parent.mkdir(parents=True)
    note.write_text(
        "---\nname: Vela\n" + portrait + "\nmobrpg:\n  element_id: \"e-1\"\n"
        "  element_kind: \"Person\"\n---\n" + body, encoding="utf-8")
    att = tmp_path / "_attachments" / "characters"
    att.mkdir(parents=True)
    (att / "Vela.png").write_bytes(b"portrait-bytes")
    (att / "map.png").write_bytes(b"map-bytes")
    return tmp_path


def _wire_push(monkeypatch, files, calls, fail=None):
    monkeypatch.setattr(client, "get_access_token", lambda: "tok")

    def req(m, p, **k):
        calls.append((m, p, k.get("body")))
        if fail and (m, p) == fail[0]:
            raise client.ApiError(fail[1], "", p)
        if m == "GET" and p == "/world/w1/person/e-1":
            return {"files": files}
        if m == "POST" and p.endswith("/file/url"):
            return {"key": "k-" + k["body"]["fileName"], "signedUrl": "https://s3/put",
                    "contentType": k["body"]["contentType"], "metaData": {"name": "n"}}
        if m == "PUT" and p.endswith("/file/url/complete"):
            return {"key": k["body"]["key"]}
        return {}
    monkeypatch.setattr(client, "_request", req)
    puts = []
    monkeypatch.setattr(images, "_put", lambda url, data, ct, meta: puts.append((url, data, ct, meta)))
    monkeypatch.setattr(images, "_download", lambda url: {"https://cdn/p.png": b"portrait-bytes"}.get(url, b"other"))
    return puts


def test_push_dry_run_uploads_nothing(tmp_path, monkeypatch, capsys):
    calls = []
    puts = _wire_push(monkeypatch, [], calls)
    assert images.run(["w1", "--vault", str(_push_vault(tmp_path)), "--push"]) == 0
    out = capsys.readouterr().out
    assert "would upload: vela <- _attachments/characters/Vela.png" in out
    assert "would upload: vela <- _attachments/characters/map.png" in out
    assert not puts and not [c for c in calls if c[0] != "GET"]


def test_push_execute_runs_the_three_step_upload(tmp_path, monkeypatch):
    calls = []
    puts = _wire_push(monkeypatch, [], calls)
    assert images.run(["w1", "--vault", str(_push_vault(tmp_path)), "--push", "--execute"]) == 0
    assert [p[1] for p in puts] == [b"portrait-bytes", b"map-bytes"]
    assert puts[0][2] == "image/png"
    posts = [c for c in calls if c[0] == "POST"]
    assert posts[0][1] == "/world/w1/person/e-1/file/url"
    assert posts[0][2] == {"fileName": "Vela.png", "contentType": "image/png", "contentLength": 14}
    completes = [c for c in calls if c[0] == "PUT"]
    assert completes[0][2] == {"key": "k-Vela.png"}


def test_push_skips_an_image_already_on_the_element(tmp_path, monkeypatch, capsys):
    calls = []
    puts = _wire_push(monkeypatch, [{"type": "Image", "url": "https://cdn/p.png"}], calls)
    assert images.run(["w1", "--vault", str(_push_vault(tmp_path)), "--push", "--execute"]) == 0
    assert [p[1] for p in puts] == [b"map-bytes"]
    assert "already there: 1" in capsys.readouterr().out


def test_push_respects_the_file_cap(tmp_path, monkeypatch, capsys):
    calls = []
    files = [{"type": "Image", "url": "https://cdn/a.png"}, {"type": "Image", "url": "https://cdn/b.png"}]
    puts = _wire_push(monkeypatch, files, calls)
    assert images.run(["w1", "--vault", str(_push_vault(tmp_path)), "--push", "--execute"]) == 0
    assert not puts
    assert "over the file cap: 2" in capsys.readouterr().out


def test_push_without_write_access_says_so(tmp_path, monkeypatch, capsys):
    calls = []
    _wire_push(monkeypatch, [], calls, fail=(("POST", "/world/w1/person/e-1/file/url"), 403))
    assert images.run(["w1", "--vault", str(_push_vault(tmp_path)), "--push", "--execute"]) == 1
    assert "you need write access" in capsys.readouterr().out


def test_push_only_filters_by_name(tmp_path, monkeypatch, capsys):
    calls = []
    _wire_push(monkeypatch, [], calls)
    assert images.run(["w1", "--vault", str(_push_vault(tmp_path)), "--push", "--only", "nobody"]) == 0
    assert not calls


def test_push_reports_an_unresolved_image(tmp_path, monkeypatch, capsys):
    calls = []
    _wire_push(monkeypatch, [], calls)
    v = _push_vault(tmp_path, body="![[missing.png]]\n")
    images.run(["w1", "--vault", str(v), "--push"])
    assert "not found (or more than one match) under _attachments/: vela -> missing.png" in capsys.readouterr().out


def test_only_needs_push(tmp_path):
    with pytest.raises(SystemExit):
        images.run(["w1", "--vault", str(tmp_path), "--only", "x"])


def test_push_refuses_an_ambiguous_image_name(tmp_path, monkeypatch, capsys):
    calls = []
    puts = _wire_push(monkeypatch, [], calls)
    v = _push_vault(tmp_path, body="Body.\n")
    other = v / "_attachments" / "maps"
    other.mkdir()
    (other / "Vela.png").write_bytes(b"a different image")
    images.run(["w1", "--vault", str(v), "--push", "--execute"])
    assert "more than one match" in capsys.readouterr().out
    assert not puts


def test_push_uploads_identical_bytes_once(tmp_path, monkeypatch, capsys):
    calls = []
    puts = _wire_push(monkeypatch, [], calls)
    vault = _push_vault(tmp_path)
    (vault / "_attachments" / "characters" / "map.png").write_bytes(b"portrait-bytes")
    assert images.run(["w1", "--vault", str(vault), "--push", "--execute"]) == 0
    assert [p[1] for p in puts] == [b"portrait-bytes"]
    assert "already there: 1" in capsys.readouterr().out


def test_push_survives_a_signed_url_response_without_a_url(tmp_path, monkeypatch, capsys):
    calls = []
    puts = _wire_push(monkeypatch, [], calls)
    real = client._request
    monkeypatch.setattr(client, "_request",
                        lambda m, p, **k: {} if m == "POST" else real(m, p, **k))
    assert images.run(["w1", "--vault", str(_push_vault(tmp_path)), "--push", "--execute"]) == 1
    assert not puts
    out = capsys.readouterr()
    assert out.err.count("no upload URL") == 2
    assert "failed: 2" in out.out
