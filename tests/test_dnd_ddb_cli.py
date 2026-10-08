#!/usr/bin/env python3
"""Tests for dnd_ddb.py's command line, the character link and the one request. No network."""

import io
import json
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
from dnd_ddb import character_id, fetch, main  # noqa: E402
from dnd_ddb_read import Unreadable  # noqa: E402

TEMPLATE = (ROOT / "skills" / "shared" / "templates" / "pc-dnd-5e-2024.md").read_text(encoding="utf-8")
LINK = "https://www.dndbeyond.com/characters/31198239"
DATA = character(hit_points={"base": 25})
COUNT = "# write: {w}  add: {a}  remove: {r}  kept: {k}  check: {c}  fill: {f}"


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    """A test that opens a socket fails."""
    def refuse(self, *args, **kwargs):
        raise AssertionError("a test opened a socket")
    monkeypatch.setattr(socket.socket, "connect", refuse)


def test_a_socket_cannot_be_opened_in_this_file():
    with pytest.raises(AssertionError, match="opened a socket"):
        socket.create_connection(("127.0.0.1", 9))


class Fetches:
    """Stands in for dnd_ddb.FETCH: records the ids asked for."""

    def __init__(self, data=DATA, fail=None):
        self.asked, self.data, self.fail = [], data, fail

    def __call__(self, char_id):
        self.asked.append(char_id)
        if self.fail:
            raise Unreadable(self.fail)
        return self.data


@pytest.fixture
def fake(monkeypatch):
    stand_in = Fetches()
    monkeypatch.setattr(dnd_ddb, "FETCH", stand_in)
    return stand_in


def note(link=LINK, eol="\n", pc=True):
    text = TEMPLATE.replace('dndbeyond: ""', f'dndbeyond: "{link}"' if link else 'dndbeyond: ""')
    if not pc:
        text = text.replace("type: pc", "type: npc", 1)
    return text.replace("\n", eol)


def sheet(tmp_path, text=None, name="Tavin.md"):
    path = tmp_path / name
    path.write_bytes((note() if text is None else text).encode("utf-8"))
    return path


def lines(capsys):
    return capsys.readouterr().out.splitlines()


# --- one sheet ----------------------------------------------------------------------------

def test_a_preview_prints_the_rows_and_the_count_and_writes_nothing(tmp_path, capsys, fake):
    path = sheet(tmp_path)
    before = path.read_bytes()
    assert main([str(path)]) == 0
    out = lines(capsys)
    assert out[0] == "WRITE\tStat Sheet / Core / Level\t1 -> 5"
    assert out[-1].startswith("# write: ")
    assert path.read_bytes() == before
    assert fake.asked == ["31198239"]


def test_write_changes_the_note_and_a_second_run_has_nothing_to_do(tmp_path, capsys, fake):
    path = sheet(tmp_path)
    assert main([str(path), "--write"]) == 0
    assert lines(capsys)[-1].split("  ")[0] != "# write: 0"
    assert "| Level | 5 |" in path.read_text(encoding="utf-8")
    written = path.read_bytes()
    assert main([str(path), "--write"]) == 0
    assert lines(capsys)[-1] == COUNT.format(w=0, a=0, r=0, k=0, c=0, f=0)
    assert path.read_bytes() == written


def test_the_count_line_has_every_field_in_order(tmp_path, capsys, fake):
    main([str(sheet(tmp_path))])
    last = lines(capsys)[-1]
    fields = [f.split(":")[0] for f in last.removeprefix("# ").split("  ")]
    assert fields == ["write", "add", "remove", "kept", "check", "fill"]


def test_crlf_survives_a_write(tmp_path, capsys, fake):
    path = sheet(tmp_path, note(eol="\r\n"))
    assert main([str(path), "--write"]) == 0
    raw = path.read_bytes()
    assert raw.count(b"\r\n") == raw.count(b"\n") > 0


def test_a_note_with_no_link_says_so_and_asks_nothing(tmp_path, capsys, fake):
    assert main([str(sheet(tmp_path, note(link="")))]) == 0
    assert lines(capsys) == ["ERROR\tdndbeyond\tthis note has no D&D Beyond link"]
    assert fake.asked == []


def test_a_note_with_a_bare_link_key_has_no_link(tmp_path, capsys, fake):
    text = note(link="").replace('dndbeyond: ""', "dndbeyond:")
    main([str(sheet(tmp_path, text))])
    assert lines(capsys) == ["ERROR\tdndbeyond\tthis note has no D&D Beyond link"]


@pytest.mark.parametrize("link", [
    "https://evil.example/characters/1",
    "https://www.dndbeyond.com.evil.example/characters/1",
    "https://evil.example/?x=dndbeyond.com/characters/1",
    "http://169.254.169.254/characters/1",
    "file:///etc/passwd",
    "dndbeyond.com/characters/1/../../x",
    "1" * 40,
    "https://user@www.dndbeyond.com@evil.example/characters/1",
    "https://www.dndbeyond.com\\@evil.example/characters/1",
    "https://www.dndbeyond.com/characters/",
    "https://www.dndbeyond.com/characters/12ab",
    "https://www.dndbeyond.com/characters/\u0663\u0664",
    "\u0663\u0664",
])
def test_a_link_that_is_not_a_character_link_is_refused_without_a_request(tmp_path, capsys, fake, link):
    assert character_id(link) is None
    assert main([str(sheet(tmp_path, note(link=link)))]) == 0
    out = lines(capsys)
    assert len(out) == 1 and out[0].startswith("ERROR\tdndbeyond\t")
    assert fake.asked == []


@pytest.mark.parametrize("link, want", [
    ("https://www.dndbeyond.com/characters/31198239", "31198239"),
    ("https://www.dndbeyond.com/characters/31198239/", "31198239"),
    ("https://www.dndbeyond.com/characters/31198239/a-slug-here", "31198239"),
    ("https://www.dndbeyond.com/characters/31198239/builder", "31198239"),
    ("http://dndbeyond.com/characters/31198239", "31198239"),
    ("HTTPS://WWW.DNDBEYOND.COM/characters/31198239", "31198239"),
    ("dndbeyond.com/characters/31198239", "31198239"),
    ("www.dndbeyond.com/characters/31198239", "31198239"),
    ("  31198239  ", "31198239"),
    ("31198239", "31198239"),
    (31198239, "31198239"),
    ("123456789012", "123456789012"),
])
def test_character_id_accepts_the_forms_a_gm_pastes(link, want):
    assert character_id(link) == want


@pytest.mark.parametrize("link", [None, "", "   ", True, 0.5, -5, [], ["31198239"], {}, "abc", "1234567890123", 10 ** 12,
                                  "https://www.dndbeyond.com/characters/1234567890123"])
def test_character_id_refuses_the_rest(link):
    assert character_id(link) is None


def test_an_unreadable_character_is_one_error_row_and_exit_0(tmp_path, capsys, monkeypatch):
    monkeypatch.setattr(dnd_ddb, "FETCH", Fetches(fail="this character is private on D&D Beyond; set it to public"))
    path = sheet(tmp_path)
    before = path.read_bytes()
    assert main([str(path), "--write"]) == 0
    assert lines(capsys) == ["ERROR\tD&D Beyond\tthis character is private on D&D Beyond; set it to public"]
    assert path.read_bytes() == before


def test_a_file_that_cannot_be_read_exits_2(tmp_path, capsys, fake):
    assert main([str(tmp_path / "missing.md")]) == 2
    assert "cannot read" in capsys.readouterr().err
    assert fake.asked == []


def test_a_failed_write_exits_2(tmp_path, capsys, fake, monkeypatch):
    def broken(path, text):
        raise dnd_ddb.StepFailed("Tavin.md cannot be written (PermissionError)")
    monkeypatch.setattr(dnd_ddb, "write_text_atomic", broken)
    path = sheet(tmp_path)
    assert main([str(path), "--write"]) == 2
    assert "cannot be written" in capsys.readouterr().err


def test_the_arguments_are_checked():
    for argv in ([], ["a.md", "--party", "v"], ["a.md", "--on-build"]):
        with pytest.raises(SystemExit) as stopped:
            main(argv)
        assert stopped.value.code == 2


# --- --party ------------------------------------------------------------------------------

def vault(tmp_path, system="dnd-5e-2024", setting=None):
    meta = tmp_path / "_meta"
    meta.mkdir()
    config = f"---\npublish:\n  system: {system}\n" + (f"  dndbeyond_sync: {setting}\n" if setting else "") + "---\n"
    (meta / "vault-config.md").write_text(config, encoding="utf-8")
    (tmp_path / "Characters").mkdir()
    return tmp_path


def pcs(root, names=("Alder", "Briar", "Cress")):
    for n, name in enumerate(names):
        (root / "Characters" / f"{name}.md").write_text(note(link=f"{LINK[:-1]}{n}"), encoding="utf-8")


def test_party_writes_the_good_note_reports_the_failing_one_and_skips_the_unlinked(tmp_path, capsys, monkeypatch):
    root = vault(tmp_path)
    (root / "Characters" / "Alder.md").write_text(note(link=""), encoding="utf-8")
    (root / "Characters" / "Briar.md").write_text(note(link="https://www.dndbeyond.com/characters/2"), encoding="utf-8")
    (root / "Characters" / "Cress.md").write_text(note(link="https://www.dndbeyond.com/characters/3"), encoding="utf-8")
    (root / "Characters" / "Dusk.md").write_text(note(link="5", pc=False), encoding="utf-8")

    def by_id(char_id):
        by_id.asked.append(char_id)
        if char_id == "2":
            raise Unreadable("D&D Beyond has no character with that id")
        return DATA
    by_id.asked = []
    monkeypatch.setattr(dnd_ddb, "FETCH", by_id)
    untouched = (root / "Characters" / "Briar.md").read_bytes()
    assert main(["--party", str(root), "--write"]) == 0
    out = lines(capsys)
    assert by_id.asked == ["2", "3"]
    assert "ERROR\tBriar: D&D Beyond\tD&D Beyond has no character with that id" in out
    assert any(r.startswith("WRITE\tCress: Stat Sheet / Core / Level") for r in out)
    assert not any(r.startswith(("ERROR\tAlder", "WRITE\tAlder", "WRITE\tDusk")) for r in out)
    assert out[-1].endswith("  sheets: 2")
    assert (root / "Characters" / "Briar.md").read_bytes() == untouched
    assert "| Level | 5 |" in (root / "Characters" / "Cress.md").read_text(encoding="utf-8")
    assert (root / "Characters" / "Alder.md").read_text(encoding="utf-8") == note(link="")


def test_party_preview_writes_nothing(tmp_path, capsys, fake):
    root = vault(tmp_path)
    pcs(root)
    before = {p.name: p.read_bytes() for p in (root / "Characters").iterdir()}
    assert main(["--party", str(root)]) == 0
    assert {p.name: p.read_bytes() for p in (root / "Characters").iterdir()} == before
    assert lines(capsys)[-1].endswith("sheets: 3")
    assert len(fake.asked) == 3


def test_party_on_something_that_is_not_a_folder_exits_2(tmp_path, capsys, fake):
    assert main(["--party", str(tmp_path / "nope")]) == 2
    assert "is not a folder" in capsys.readouterr().err


def test_party_on_a_gurps_vault_asks_nothing(tmp_path, capsys, fake):
    root = vault(tmp_path, system="gurps-4e")
    pcs(root)
    assert main(["--party", str(root)]) == 0
    assert lines(capsys) == ["dnd_ddb: this vault's system is gurps-4e, not dnd-5e-2024; nothing was read"]
    assert fake.asked == []


@pytest.mark.parametrize("setting, asked, said", [
    (None, 0, []),
    ("manual", 0, []),
    ('"manual"', 0, []),
    ("build", 1, None),
    ('"build"', 1, None),
    ("always", 0, ['dnd_ddb: publish.dndbeyond_sync is "always", not build or manual; nothing was synced']),
])
def test_on_build_follows_the_vault_setting(tmp_path, capsys, fake, setting, asked, said):
    root = vault(tmp_path, setting=setting)
    pcs(root, ("Alder",))
    assert main(["--party", str(root), "--on-build"]) == 0
    out = lines(capsys)
    assert len(fake.asked) == asked
    if said is not None:
        assert out == said
    else:
        assert out[-1].endswith("sheets: 1")


def test_on_build_never_writes_unless_asked(tmp_path, capsys, fake):
    root = vault(tmp_path, setting="build")
    pcs(root, ("Alder",))
    before = (root / "Characters" / "Alder.md").read_bytes()
    main(["--party", str(root), "--on-build"])
    assert (root / "Characters" / "Alder.md").read_bytes() == before


# --- fetch --------------------------------------------------------------------------------

class Response:
    def __init__(self, body, tick=None):
        self.body, self.tick = body, tick

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def read(self, size=-1):
        if self.tick:
            self.tick()
        out, self.body = (self.body, b"") if size < 0 else (self.body[:size], self.body[size:])
        return out


class Opener:
    def __init__(self, result, tick=None):
        self.result, self.requests, self.tick = result, [], tick

    def open(self, request, timeout=None):
        self.requests.append((request, timeout))
        if isinstance(self.result, BaseException):
            raise self.result
        return Response(self.result, self.tick)


@pytest.fixture
def opens(monkeypatch):
    def install(result, tick=None):
        stand_in = Opener(result, tick)
        monkeypatch.setattr(dnd_ddb, "opener", lambda: stand_in)
        return stand_in
    return install


def http_error(code):
    return urllib.error.HTTPError("https://x", code, "no", {}, io.BytesIO(b""))


def test_fetch_asks_the_character_service_once_and_returns_the_data(opens):
    seen = opens(json.dumps({"success": True, "data": {"id": 31198239}}).encode())
    assert fetch("31198239") == {"id": 31198239}
    (request, timeout), = seen.requests
    assert request.full_url == "https://character-service.dndbeyond.com/character/v5/character/31198239"
    assert request.get_header("User-agent").startswith("gm-apprentice dnd_ddb")
    assert request.get_header("Accept") == "application/json" and timeout == 15


@pytest.mark.parametrize("bad", ["", "abc", "1/../2", "31198239/x", "1" * 13, "٣"])
def test_fetch_refuses_an_id_that_is_not_digits_without_a_request(opens, bad):
    seen = opens(b"{}")
    with pytest.raises(Unreadable, match="could not be read"):
        fetch(bad)
    assert seen.requests == []


@pytest.mark.parametrize("result, message", [
    (http_error(403), "this character is private on D&D Beyond; set it to public"),
    (http_error(404), "D&D Beyond has no character with that id"),
    (http_error(500), "D&D Beyond could not be read (HTTP 500)"),
    (urllib.error.URLError("Name or service not known"), "D&D Beyond could not be read (Name or service not known)"),
    (TimeoutError(), "D&D Beyond could not be read (it timed out)"),
    (ConnectionResetError(), "D&D Beyond could not be read (ConnectionResetError)"),
    (b"x" * (9 * 1024 * 1024), "D&D Beyond could not be read (the response is too large)"),
    (b"not json", "D&D Beyond could not be read (the response is not JSON)"),
    (b'{"data": []}', "D&D Beyond could not be read (the response holds no character)"),
    (b'[1]', "D&D Beyond could not be read (the response holds no character)"),
    (b'{"success": false}', "D&D Beyond could not be read (the response holds no character)"),
])
def test_fetch_says_what_went_wrong_in_one_sentence(opens, result, message):
    opens(result)
    with pytest.raises(Unreadable) as stopped:
        fetch("31198239")
    assert str(stopped.value) == message


def test_a_redirect_to_another_host_is_refused():
    handler = dnd_ddb.OnlyServiceHost()
    request = urllib.request.Request("https://character-service.dndbeyond.com/character/v5/character/1")
    for target in ("https://evil.example/x", "http://character-service.dndbeyond.com/x",
                   "https://character-service.dndbeyond.com.evil.example/x", "file:///etc/passwd"):
        with pytest.raises(urllib.error.URLError, match="another host"):
            handler.redirect_request(request, None, 302, "Found", {}, target)
    again = handler.redirect_request(request, None, 302, "Found", {}, "https://character-service.dndbeyond.com/other")
    assert again is not None and again.full_url == "https://character-service.dndbeyond.com/other"


def test_the_real_opener_carries_the_redirect_guard():
    assert any(isinstance(h, dnd_ddb.OnlyServiceHost) for h in dnd_ddb.opener().handlers)


def test_a_deeply_nested_body_is_unreadable_not_a_crash(opens):
    opens(b"[" * 400_000)
    with pytest.raises(Unreadable, match=r"^D&D Beyond could not be read \(the response is not JSON\)$"):
        fetch("31198239")


def test_a_slow_response_is_given_up_on_after_the_deadline(opens, monkeypatch):
    now = [100.0]
    monkeypatch.setattr(dnd_ddb, "CLOCK", lambda: now[0])
    seen = opens(b'{"data": {}}' + b" " * 200_000, tick=lambda: now.__setitem__(0, now[0] + 20))
    with pytest.raises(Unreadable, match=r"\(it took too long\)"):
        fetch("31198239")
    assert len(seen.requests) == 1


def test_a_big_body_is_cut_off_at_the_cap_while_it_is_read(opens):
    reads = []
    seen = opens(b"x" * (20 * 1024 * 1024), tick=lambda: reads.append(1))
    with pytest.raises(Unreadable, match="too large"):
        fetch("31198239")
    assert len(reads) <= 8 * 1024 * 1024 // dnd_ddb.CHUNK + 2 and seen.requests


def test_a_redirect_to_another_port_is_refused():
    handler = dnd_ddb.OnlyServiceHost()
    request = urllib.request.Request("https://character-service.dndbeyond.com/x")
    for target in ("https://character-service.dndbeyond.com:8443/x", "https://character-service.dndbeyond.com:bad/x"):
        with pytest.raises(urllib.error.URLError, match="another host"):
            handler.redirect_request(request, None, 302, "Found", {}, target)
    ok = handler.redirect_request(request, None, 302, "Found", {}, "https://character-service.dndbeyond.com:443/y")
    assert ok is not None


# --- what --party does to the bytes, and to the run, when a note goes wrong ---------------

def test_party_write_keeps_crlf_on_every_line(tmp_path, capsys, fake):
    root = vault(tmp_path)
    (root / "Characters" / "Alder.md").write_bytes(note(eol="\r\n").encode("utf-8"))
    assert main(["--party", str(root), "--write"]) == 0
    raw = (root / "Characters" / "Alder.md").read_bytes()
    assert b"| Level | 5 |" in raw
    assert raw.count(b"\r\n") == raw.count(b"\n") > 0


def test_party_leaves_a_note_that_is_not_utf8_alone_and_goes_on(tmp_path, capsys, fake):
    root = vault(tmp_path)
    bad = note().replace("Medium", "Me\u00e9dium").encode("latin-1", "replace") + b"\xff\xfe tail\n"
    (root / "Characters" / "Alder.md").write_bytes(bad)
    (root / "Characters" / "Briar.md").write_text(note(), encoding="utf-8")
    assert main(["--party", str(root), "--write"]) == 0
    out = lines(capsys)
    assert (root / "Characters" / "Alder.md").read_bytes() == bad
    assert "ERROR\tAlder: note\tthe note is not valid UTF-8; nothing was written" in out
    assert any(r.startswith("WRITE\tBriar: ") for r in out)
    assert "| Level | 5 |" in (root / "Characters" / "Briar.md").read_text(encoding="utf-8")


def test_one_note_failing_does_not_stop_or_unwrite_the_others(tmp_path, capsys, fake, monkeypatch):
    root = vault(tmp_path)
    for name in ("Alder", "Briar", "Cress"):
        (root / "Characters" / f"{name}.md").write_text(note().replace("Medium", f"Medium {name}"), encoding="utf-8")
    real = dnd_ddb.plan_cells

    def planner(text, c):
        if "Medium Briar" in text:
            raise KeyError("boom")
        return real(text, c)
    monkeypatch.setattr(dnd_ddb, "plan_cells", planner)
    before = (root / "Characters" / "Briar.md").read_bytes()
    assert main(["--party", str(root), "--write"]) == 0
    captured = capsys.readouterr()
    out = captured.out.splitlines()
    assert captured.err == ""
    assert "ERROR\tBriar: sync\tcould not be synced (KeyError); nothing was written" in out
    assert (root / "Characters" / "Briar.md").read_bytes() == before
    for name in ("Alder", "Cress"):
        assert "| Level | 5 |" in (root / "Characters" / f"{name}.md").read_text(encoding="utf-8")
        assert any(r.startswith(f"WRITE\t{name}: ") for r in out)
    assert out[-1].endswith("sheets: 3")


def test_rows_are_printed_as_each_note_finishes(tmp_path, capsys, fake, monkeypatch):
    root = vault(tmp_path)
    for name in ("Alder", "Briar"):
        (root / "Characters" / f"{name}.md").write_text(note(), encoding="utf-8")
    seen = []
    real = dnd_ddb.guarded_sync

    def spy(text):
        seen.append(capsys.readouterr().out)
        return real(text)
    monkeypatch.setattr(dnd_ddb, "guarded_sync", spy)
    main(["--party", str(root)])
    assert seen[0] == "" and "Alder: " in seen[1]


def test_a_single_sheet_that_fails_unexpectedly_is_an_error_row_not_a_traceback(tmp_path, capsys, fake, monkeypatch):
    def planner(text, c):
        raise KeyError("boom")
    monkeypatch.setattr(dnd_ddb, "plan_cells", planner)
    path = sheet(tmp_path)
    before = path.read_bytes()
    assert main([str(path), "--write"]) == 0
    captured = capsys.readouterr()
    assert captured.out.splitlines() == ["ERROR\tsync\tcould not be synced (KeyError); nothing was written"]
    assert captured.err == "" and path.read_bytes() == before


@pytest.mark.skipif(sys.platform == "win32", reason="a tab cannot be in a Windows file name")
def test_a_control_character_in_a_file_name_cannot_shift_the_columns(tmp_path, capsys, fake):
    root = vault(tmp_path)
    (root / "Characters" / "Al\tder.md").write_text(note(), encoding="utf-8")
    main(["--party", str(root)])
    out = lines(capsys)
    assert out[0].startswith("WRITE\tAl der: ")
    assert all(len(r.split("\t")) == 3 for r in out[:-1])


def test_on_build_with_an_unreadable_settings_file_says_so_once(tmp_path, capsys, fake):
    root = vault(tmp_path, setting="build")
    pcs(root, ("Alder",))
    (root / "_meta" / "vault-config.md").write_bytes(b"---\npublish:\n  dndbeyond_sync: build\n\xff\xfe\n---\n")
    assert main(["--party", str(root), "--on-build"]) == 0
    assert lines(capsys) == ["dnd_ddb: _meta/vault-config.md could not be read; nothing was synced"]
    assert fake.asked == []


def test_on_build_with_no_settings_file_stays_silent(tmp_path, capsys, fake):
    (tmp_path / "Characters").mkdir()
    assert main(["--party", str(tmp_path), "--on-build"]) == 0
    assert lines(capsys) == [] and fake.asked == []
