#!/usr/bin/env python3
"""Tests for the story and the portrait in the D&D Beyond sync. No network: FETCH and FETCH_PORTRAIT are replaced."""

import io
import os
import socket
import sys
import urllib.error
import urllib.request
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "skills" / "shared" / "scripts"))
sys.path.insert(0, str(ROOT / "tests"))

import dnd_ddb  # noqa: E402
from ddb_builder import character  # noqa: E402
from dnd_ddb import main, sync_text  # noqa: E402
from dnd_ddb_read import Unreadable  # noqa: E402

TEMPLATE = (ROOT / "skills" / "shared" / "templates" / "pc-dnd-5e-2024.md").read_text(encoding="utf-8")
LINK = "https://www.dndbeyond.com/characters/424242"
AVATAR = "https://www.dndbeyond.com/avatars/1/2/639.jpeg?width=150&height=150&fit=crop&quality=95"
FULL_SIZE = "https://www.dndbeyond.com/avatars/1/2/639.jpeg?width=600&height=600&fit=bounds&quality=95"
JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF" + b"\x00" * 20
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 20
SUBSECTIONS = """### Backstory

{Character history}

### Appearance

{Physical description}

**Age:** {—} · **Height:** {—} · **Weight:** {—} · **Eyes:** {—} · **Hair:** {—} · **Skin:** {—} · **Faith:** {—}

### Personality

- **Traits:** {—}
- **Ideals:** {—}
- **Bonds:** {—}
- **Flaws:** {—}

"""


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    def refuse(self, *args, **kwargs):
        raise AssertionError("a test opened a socket")
    monkeypatch.setattr(socket.socket, "connect", refuse)


def new_layout(text=TEMPLATE):
    """The template with Background as the sub-sections the story goes into."""
    text = text.replace("**Backstory & Personality:** {Character history and traits}\n\n", "")
    text = text.replace("**Appearance:** {Physical description}\n\n", SUBSECTIONS)
    assert "### Backstory" in text and "Backstory & Personality" not in text
    return text


NOTE = new_layout()
STORY = dict(
    notes={"backstory": "Raised in a lighthouse.\n\nShe left at nineteen."},
    traits={"appearance": "Tall, ink on her fingers.", "personalityTraits": "Hums.", "ideals": "Light.",
            "bonds": "The keeper.", "flaws": "Never sleeps."},
    details={"age": 31, "eyes": "Grey", "gender": "Female"})


def wizard(**more):
    return character(hit_points={"base": 25}, **{**STORY, **more})


def story_rows(report):
    return [r for r in report.rows
            if r[1].startswith(("Background / Backstory", "Background / Appearance", "Background / Personality"))]


def part(text, heading):
    out, on = [], False
    for line in text.splitlines():
        if line.startswith("#"):
            on = line.strip() == heading
        elif on:
            out.append(line)
    return "\n".join(out).strip()


def test_first_sync_fills_empty_story():
    report = sync_text(NOTE, wizard())
    assert not [r for r in report.rows if r[0] == "ERROR"]
    loci = {r[1] for r in story_rows(report) if r[0] == "WRITE"}
    assert loci == {"Background / Backstory", "Background / Appearance", "Background / Appearance / Facts",
                    "Background / Personality / Traits", "Background / Personality / Ideals",
                    "Background / Personality / Bonds", "Background / Personality / Flaws"}
    assert part(report.text, "### Backstory") == "Raised in a lighthouse.\n\nShe left at nineteen."
    assert "**Age:** 31" in report.text and "- **Flaws:** Never sleeps." in report.text
    assert ("WRITE", "Frontmatter / gender", "from D&D Beyond") in report.rows


def test_second_sync_silent():
    first = sync_text(NOTE, wizard())
    second = sync_text(first.text, wizard(), first.seen)
    assert second.rows == [] and second.text == first.text
    assert second.seen == first.seen


def test_long_crlf_backstory_is_stable():
    paragraphs = [f"Paragraph {n}: " + ("the road went on and on, and she followed it. " * 12).strip()
                  for n in range(12)]
    backstory = "\n\n".join(paragraphs)
    assert 6000 < len(backstory) < 7000
    note = NOTE.replace("\n", "\r\n")
    first = sync_text(note, wizard(notes={"backstory": backstory}))
    assert "\n" not in first.text.replace("\r\n", "")
    assert paragraphs[11] in first.text
    second = sync_text(first.text, wizard(notes={"backstory": backstory}), first.seen)
    assert second.rows == []
    assert second.text.encode() == first.text.encode()


def test_player_change_rewrites():
    first = sync_text(NOTE, wizard())
    changed = {"backstory": "Raised in a lighthouse.\n\nShe left at twenty."}
    second = sync_text(first.text, wizard(notes=changed), first.seen)
    assert ("WRITE", "Background / Backstory", "from D&D Beyond (2 paragraphs)") in second.rows
    assert "She left at twenty." in second.text and "nineteen" not in second.text
    third = sync_text(second.text, wizard(notes=changed), second.seen)
    assert third.rows == [] and third.text == second.text


def test_vault_edit_and_player_change_checks():
    first = sync_text(NOTE, wizard())
    edited = first.text.replace("She left at nineteen.", "She left at nineteen, by night.")
    changed = {"backstory": "Raised in a lighthouse.\n\nShe left at twenty."}
    second = sync_text(edited, wizard(notes=changed), first.seen)
    assert [r[0] for r in story_rows(second)] == ["CHECK"]
    assert part(second.text, "### Backstory") == part(edited, "### Backstory")


def test_gm_only_aside_survives_player_change():
    first = sync_text(NOTE, wizard())
    aside = "<!-- gm-only -->\nThe keeper was her father.\n<!-- /gm-only -->"
    edited = first.text.replace("She left at nineteen.", "She left at nineteen.\n\n" + aside)
    changed = {"backstory": "Raised in a lighthouse.\n\nShe left at twenty."}
    second = sync_text(edited, wizard(notes=changed), first.seen)
    assert [r[0] for r in story_rows(second)] == ["CHECK"]
    assert aside in second.text
    assert second.text == edited


def test_old_layout_story_checks_not_errors():
    report = sync_text(TEMPLATE, wizard())
    assert not [r for r in report.rows if r[0] == "ERROR"]
    checks = [r for r in story_rows(report) if r[0] == "CHECK"]
    assert {r[1] for r in checks} == {"Background / Backstory", "Background / Appearance",
                                      "Background / Appearance / Facts", "Background / Personality / Traits",
                                      "Background / Personality / Ideals", "Background / Personality / Bonds",
                                      "Background / Personality / Flaws"}
    assert any(r[0] == "WRITE" and r[1].startswith("Stat Sheet") for r in report.rows)
    assert "Raised in a lighthouse" not in report.text


def test_notes_and_status_are_still_never_written():
    for heading in ("## Notes", "## GM Notes", "## Current Status"):
        assert heading in NOTE
    after = sync_text(NOTE, wizard()).text
    for heading in ("## Notes", "## GM Notes", "## Current Status"):
        assert part(after, heading) == part(NOTE, heading)


# --- portrait -----------------------------------------------------------------------------

def note_with_link(eol="\n"):
    return NOTE.replace('dndbeyond: ""', f'dndbeyond: "{LINK}"').replace("\n", eol)


class Portrait:
    """Stands in for dnd_ddb.FETCH_PORTRAIT."""

    def __init__(self, body=JPEG, ext="jpg", fail=None):
        self.asked, self.body, self.ext, self.fail = [], body, ext, fail

    def __call__(self, url):
        self.asked.append(url)
        if self.fail:
            raise Unreadable(self.fail)
        return self.body, self.ext


@pytest.fixture
def world(tmp_path, monkeypatch):
    root = tmp_path
    (root / "_meta").mkdir()
    (root / "_meta" / "vault-config.md").write_text("---\npublish:\n  system: dnd-5e-2024\n---\n", encoding="utf-8")
    (root / "Characters").mkdir()
    sheet = root / "Characters" / "Tavin Reedmere.md"
    sheet.write_bytes(note_with_link().encode())
    data = wizard(details={**STORY["details"], "decorations": {"avatarUrl": AVATAR}})
    monkeypatch.setattr(dnd_ddb, "FETCH", lambda char_id: data)
    picture = Portrait()
    monkeypatch.setattr(dnd_ddb, "FETCH_PORTRAIT", picture)
    return root, sheet, picture


def portrait_field(path):
    return next(ln for ln in path.read_text(encoding="utf-8").splitlines() if ln.startswith("portrait:"))


def test_portrait_fetched_into_blank_field(world, capsys):
    root, sheet, picture = world
    assert main([str(sheet)]) == 0
    assert "WRITE\tFrontmatter / portrait\twould fetch the D&D Beyond portrait" in capsys.readouterr().out
    assert picture.asked == [] and portrait_field(sheet) == 'portrait: ""'
    assert not (root / "_attachments").exists()
    assert main([str(sheet), "--write"]) == 0
    assert "WRITE\tFrontmatter / portrait\t" in capsys.readouterr().out
    image = root / "_attachments" / "characters" / "tavin-reedmere.jpg"
    assert image.read_bytes() == JPEG
    assert portrait_field(sheet) == 'portrait: "_attachments/characters/tavin-reedmere.jpg"'
    assert picture.asked == [AVATAR]
    assert main([str(sheet), "--write"]) == 0
    assert "portrait" not in capsys.readouterr().out
    assert picture.asked == [AVATAR]


def test_portrait_never_replaces_or_overwrites(world, capsys):
    root, sheet, picture = world
    sheet.write_bytes(sheet.read_bytes().replace(b'portrait: ""', b'portrait: "_attachments/characters/mine.png"'))
    assert main([str(sheet), "--write"]) == 0
    assert "portrait" not in capsys.readouterr().out
    assert picture.asked == [] and not (root / "_attachments" / "characters" / "tavin-reedmere.jpg").exists()
    sheet.write_bytes(sheet.read_bytes().replace(b'portrait: "_attachments/characters/mine.png"', b'portrait: ""'))
    taken = root / "_attachments" / "characters"
    taken.mkdir(parents=True)
    (taken / "tavin-reedmere.jpg").write_bytes(b"theirs")
    assert main([str(sheet), "--write"]) == 0
    out = capsys.readouterr().out
    assert "CHECK\tFrontmatter / portrait\t" in out and "WRITE\tFrontmatter / portrait" not in out
    assert (taken / "tavin-reedmere.jpg").read_bytes() == b"theirs"
    assert portrait_field(sheet) == 'portrait: ""' and picture.asked == []


@pytest.mark.parametrize("reply", [
    (b"<html>not a picture</html>", "jpg"), (b"", "jpg"), (b"GIF", "gif"),
])
def test_portrait_refuses_non_image_bytes(world, capsys, monkeypatch, reply):
    root, sheet, _ = world
    monkeypatch.setattr(dnd_ddb, "FETCH_PORTRAIT", lambda url: reply)
    assert main([str(sheet), "--write"]) == 0
    assert "CHECK\tFrontmatter / portrait\t" in capsys.readouterr().out
    assert portrait_field(sheet) == 'portrait: ""'
    assert not (root / "_attachments").exists()


def test_portrait_failed_fetch_is_a_check_and_the_sync_carries_on(world, capsys, monkeypatch):
    root, sheet, _ = world
    monkeypatch.setattr(dnd_ddb, "FETCH_PORTRAIT", Portrait(fail="D&D Beyond could not be read (HTTP 404)"))
    assert main([str(sheet), "--write"]) == 0
    out = capsys.readouterr().out
    assert "CHECK\tFrontmatter / portrait\t" in out and "WRITE\tStat Sheet" in out
    assert "Raised in a lighthouse" in sheet.read_text(encoding="utf-8")


def test_portrait_png_gets_png_extension_and_crlf_note_keeps_its_endings(world, capsys, monkeypatch):
    root, sheet, _ = world
    sheet.write_bytes(note_with_link("\r\n").encode())
    monkeypatch.setattr(dnd_ddb, "FETCH_PORTRAIT", Portrait(PNG, "png"))
    assert main([str(sheet), "--write"]) == 0
    raw = sheet.read_bytes()
    assert b'portrait: "_attachments/characters/tavin-reedmere.png"\r\n' in raw
    assert b"\n" not in raw.replace(b"\r\n", b"")


def test_no_link_or_foreign_link_means_no_portrait_row(world, capsys, monkeypatch):
    root, sheet, picture = world
    data = wizard(details={"decorations": {"avatarUrl": "https://evil.example/avatars/1/x.jpg"}})
    monkeypatch.setattr(dnd_ddb, "FETCH", lambda char_id: data)
    assert main([str(sheet), "--write"]) == 0
    assert "portrait" not in capsys.readouterr().out and picture.asked == []


def test_party_places_portraits_when_writing(world, capsys):
    root, sheet, picture = world
    assert main(["--party", str(root)]) == 0
    assert "Tavin Reedmere: Frontmatter / portrait\twould fetch" in capsys.readouterr().out
    assert main(["--party", str(root), "--write"]) == 0
    assert (root / "_attachments" / "characters" / "tavin-reedmere.jpg").is_file()
    assert picture.asked == [AVATAR]


def test_a_note_write_that_fails_leaves_no_image_and_the_next_run_fetches_again(world, capsys, monkeypatch):
    root, sheet, picture = world
    real = dnd_ddb.write_text_atomic

    def broken(path, text):
        raise dnd_ddb.StepFailed("cannot be written")
    monkeypatch.setattr(dnd_ddb, "write_text_atomic", broken)
    assert main([str(sheet), "--write"]) == 2
    assert not list((root / "_attachments").rglob("*.*")) and picture.asked == [AVATAR]
    assert portrait_field(sheet) == 'portrait: ""'
    monkeypatch.setattr(dnd_ddb, "write_text_atomic", real)
    assert main([str(sheet), "--write"]) == 0
    assert (root / "_attachments" / "characters" / "tavin-reedmere.jpg").is_file()
    assert picture.asked == [AVATAR, AVATAR]


def test_party_one_failed_portrait_does_not_stop_the_other_character(tmp_path, capsys, monkeypatch):
    root = tmp_path
    (root / "_meta").mkdir()
    (root / "_meta" / "vault-config.md").write_text("---\npublish:\n  system: dnd-5e-2024\n---\n", encoding="utf-8")
    (root / "Characters").mkdir()
    for name, ident in (("Alder", 1), ("Briar", 2)):
        text = NOTE.replace('dndbeyond: ""', f'dndbeyond: "https://www.dndbeyond.com/characters/{ident}"')
        (root / "Characters" / f"{name}.md").write_text(text, encoding="utf-8")
    face = {"decorations": {"avatarUrl": AVATAR}}
    monkeypatch.setattr(dnd_ddb, "FETCH", lambda char_id: wizard(details={**STORY["details"], **face}))

    def by_url(url):
        by_url.n += 1
        if by_url.n == 1:
            raise Unreadable("D&D Beyond could not be read (HTTP 500)")
        return JPEG, "jpg"
    by_url.n = 0
    monkeypatch.setattr(dnd_ddb, "FETCH_PORTRAIT", by_url)
    assert main(["--party", str(root), "--write"]) == 0
    out = capsys.readouterr().out
    assert "Alder: Frontmatter / portrait" in out and out.count("CHECK\tAlder: Frontmatter / portrait") == 1
    assert (root / "_attachments" / "characters" / "briar.jpg").is_file()
    assert not (root / "_attachments" / "characters" / "alder.jpg").exists()
    assert portrait_field(root / "Characters" / "Alder.md") == 'portrait: ""'
    assert "briar.jpg" in portrait_field(root / "Characters" / "Briar.md")
    assert "Raised in a lighthouse" in (root / "Characters" / "Alder.md").read_text(encoding="utf-8")


# --- fetch_portrait -----------------------------------------------------------------------

class Reply:
    def __init__(self, body):
        self.body = body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def read1(self, size=-1):
        out, self.body = self.body[:size], self.body[size:]
        return out


class Opens:
    def __init__(self, result):
        self.result, self.requests = result, []

    def open(self, request, timeout=None):
        self.requests.append((request, timeout))
        if isinstance(self.result, BaseException):
            raise self.result
        return Reply(self.result)


@pytest.fixture
def opens(monkeypatch):
    def install(result):
        stand_in = Opens(result)
        monkeypatch.setattr(dnd_ddb, "avatar_opener", lambda: stand_in)
        return stand_in
    return install


def test_fetch_portrait_asks_for_the_full_size_and_reads_the_type_from_the_bytes(opens):
    seen = opens(PNG)
    assert dnd_ddb.fetch_portrait(AVATAR) == (PNG, "png")
    (request, timeout), = seen.requests
    assert request.full_url == FULL_SIZE and timeout == 15
    assert request.get_header("User-agent").startswith("gm-apprentice dnd_ddb")


@pytest.mark.parametrize("body, ext", [
    (b"\xff\xd8\xff\xdb" + b"0" * 9, "jpg"), (b"GIF89a" + b"0" * 9, "gif"), (b"GIF87a" + b"0" * 9, "gif"),
    (b"RIFF\x00\x00\x00\x00WEBPVP8 ", "webp")])
def test_fetch_portrait_knows_four_types(opens, body, ext):
    opens(body)
    assert dnd_ddb.fetch_portrait(AVATAR) == (body, ext)


@pytest.mark.parametrize("body", [b"<svg></svg>", b"%PDF-1.4", b"", b"RIFF\x00\x00\x00\x00WAVEfmt "])
def test_fetch_portrait_refuses_anything_else(opens, body):
    opens(body)
    with pytest.raises(Unreadable, match="not a picture"):
        dnd_ddb.fetch_portrait(AVATAR)


def test_fetch_portrait_refuses_more_than_five_megabytes(opens):
    opens(JPEG + b"\x00" * (5 * 1024 * 1024))
    with pytest.raises(Unreadable, match="too large"):
        dnd_ddb.fetch_portrait(AVATAR)


@pytest.mark.parametrize("url", [
    "https://evil.example/avatars/x.jpg", "http://www.dndbeyond.com/avatars/x.jpg",
    "https://www.dndbeyond.com/characters/x.jpg", "https://www.dndbeyond.com.evil.example/avatars/x.jpg",
    "https://www.dndbeyond.com/avatars/../x.jpg", ""])
def test_fetch_portrait_refuses_a_foreign_address_without_a_request(opens, url):
    seen = opens(JPEG)
    with pytest.raises(Unreadable):
        dnd_ddb.fetch_portrait(url)
    assert seen.requests == []


def test_fetch_portrait_http_errors_are_unreadable(opens):
    opens(urllib.error.HTTPError("https://x", 404, "no", {}, io.BytesIO(b"")))
    with pytest.raises(Unreadable, match="HTTP 404"):
        dnd_ddb.fetch_portrait(AVATAR)


def redirect(target):
    handler = dnd_ddb.OnlyAvatars()
    request = urllib.request.Request(FULL_SIZE)
    return handler.redirect_request(request, io.BytesIO(b""), 302, "Found", {}, target)


def test_a_redirect_is_followed_only_within_the_avatars_path():
    assert redirect("https://www.dndbeyond.com/avatars/9/other.jpg").full_url.endswith("other.jpg")
    for target in ("https://evil.example/avatars/x.jpg", "http://www.dndbeyond.com/avatars/x.jpg",
                   "https://www.dndbeyond.com/somewhere/x.jpg", "https://www.dndbeyond.com:8443/avatars/x.jpg"):
        with pytest.raises(urllib.error.URLError):
            redirect(target)


def test_the_image_is_written_beside_and_swapped_in_never_over_a_file(tmp_path):
    target = tmp_path / "_attachments" / "characters" / "a.jpg"
    dnd_ddb.write_new_bytes(target, b"one")
    assert target.read_bytes() == b"one"
    with pytest.raises(FileExistsError):
        dnd_ddb.write_new_bytes(target, b"two")
    assert target.read_bytes() == b"one"
    assert sorted(os.listdir(target.parent)) == ["a.jpg"]
