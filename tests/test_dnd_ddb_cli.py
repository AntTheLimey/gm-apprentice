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

    def planner(text, c, seen=None):
        if "Medium Briar" in text:
            raise KeyError("boom")
        return real(text, c, seen)
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

    def spy(text, vault=None):
        seen.append(capsys.readouterr().out)
        return real(text, vault)
    monkeypatch.setattr(dnd_ddb, "guarded_sync", spy)
    main(["--party", str(root)])
    assert seen[0] == "" and "Alder: " in seen[1]


def test_a_single_sheet_that_fails_unexpectedly_is_an_error_row_not_a_traceback(tmp_path, capsys, fake, monkeypatch):
    def planner(text, c, seen=None):
        raise KeyError("boom")
    monkeypatch.setattr(dnd_ddb, "plan_cells", planner)
    path = sheet(vault(tmp_path) / "Characters")
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


# --- the memory of what sync added ----------------------------------------------------------

GOOD = {"version": 1, "character": "31198239", "lists": {"gear": ["rope, hempen", "shield"], "spells": ["fire bolt"]}}
NOT_IN_A_VAULT = "dnd_ddb: this note is not inside a vault, so nothing is remembered and no row is ever removed"


def memory_file(root, char_id="31198239"):
    return root / "_meta" / "dndbeyond" / f"{char_id}.json"


def put(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(value if isinstance(value, str) else json.dumps(value), encoding="utf-8")
    return path


def test_state_path_is_inside_the_vaults_meta_folder():
    assert dnd_ddb.state_path(Path("v"), "31198239") == Path("v") / "_meta" / "dndbeyond" / "31198239.json"


@pytest.mark.parametrize("bad", ["", "../x", "12ab", "1" * 13, "1/2", "٣", "1\n", " 1", "x"])
def test_state_path_refuses_an_id_that_is_not_digits(bad):
    with pytest.raises(ValueError):
        dnd_ddb.state_path(Path("v"), bad)


def test_save_seen_writes_sorted_indented_lf_json_and_creates_the_folder(tmp_path):
    path = memory_file(tmp_path)
    dnd_ddb.save_seen(path, "31198239", {"spells": ["fire bolt"], "gear": ["shield", "rope, hempen"]})
    raw = path.read_bytes()
    assert raw.endswith(b"}\n") and b"\r" not in raw
    assert raw.decode("utf-8") == json.dumps(GOOD, indent=1, sort_keys=True) + "\n"
    assert dnd_ddb.load_seen(path) == {"gear": ["rope, hempen", "shield"], "spells": ["fire bolt"]}
    assert [p.name for p in path.parent.iterdir()] == ["31198239.json"]


def test_save_seen_keeps_non_ascii_names_as_utf8(tmp_path):
    path = memory_file(tmp_path)
    dnd_ddb.save_seen(path, "31198239", {"gear": ["bâton"]})
    assert "bâton" in path.read_text(encoding="utf-8")
    assert dnd_ddb.load_seen(path) == {"gear": ["bâton"]}


def test_load_seen_reads_a_good_file_and_trusts_nothing_else(tmp_path):
    path = memory_file(tmp_path)
    assert dnd_ddb.load_seen(path) is None                                     # missing
    put(path, GOOD)
    assert dnd_ddb.load_seen(path) == GOOD["lists"]
    path.write_text("{not json", encoding="utf-8")
    assert dnd_ddb.load_seen(path) is None
    path.write_bytes(b"\xff\xfe\x00")
    assert dnd_ddb.load_seen(path) is None
    path.write_text(json.dumps({**GOOD, "pad": "x" * 1_100_000}), encoding="utf-8")
    assert dnd_ddb.load_seen(path) is None                                     # over 1 MB
    for bad in ([], "x", 3, None, {**GOOD, "version": 2}, {**GOOD, "version": True}, {**GOOD, "version": "1"},
                {**GOOD, "character": "5"}, {**GOOD, "character": 31198239}, {**GOOD, "lists": []},
                {**GOOD, "lists": "x"}, {k: v for k, v in GOOD.items() if k != "lists"},
                {k: v for k, v in GOOD.items() if k != "character"}):
        put(path, bad)
        assert dnd_ddb.load_seen(path) is None, bad


def test_load_seen_drops_a_list_that_is_not_a_list_of_strings_and_keeps_the_rest(tmp_path):
    path = put(memory_file(tmp_path), {**GOOD, "lists": {"gear": ["a"], "spells": "fire bolt", "feats": [1, "x"],
                                                           "tools": {"a": 1}, "languages": ["common"]}})
    assert dnd_ddb.load_seen(path) == {"gear": ["a"], "languages": ["common"]}


def test_load_seen_on_a_folder_or_a_deep_nest_is_none_not_a_crash(tmp_path):
    folder = memory_file(tmp_path)
    folder.mkdir(parents=True)
    assert dnd_ddb.load_seen(folder) is None
    assert dnd_ddb.load_seen(put(memory_file(tmp_path, "7"), "[" * 100000)) is None


def test_a_single_sheet_inside_a_vault_is_found_by_walking_up(tmp_path):
    root = vault(tmp_path)
    deep = root / "Characters" / "PCs" / "Old"
    deep.mkdir(parents=True)
    path = sheet(deep)
    assert dnd_ddb.find_vault(path) == root.resolve()
    assert dnd_ddb.find_vault(sheet(tmp_path / "Characters", name="Up.md")) == root.resolve()


def test_a_single_sheet_outside_a_vault_has_none(tmp_path):
    assert dnd_ddb.find_vault(sheet(tmp_path)) is None


def test_a_single_sheet_in_a_vault_saves_what_d_and_d_beyond_gave_only_with_write(tmp_path, capsys, fake):
    root = vault(tmp_path)
    path = sheet(root / "Characters")
    assert main([str(path)]) == 0
    assert not (root / "_meta" / "dndbeyond").exists()                         # a preview creates nothing
    assert main([str(path), "--write"]) == 0
    saved = json.loads(memory_file(root).read_text(encoding="utf-8"))
    assert saved["version"] == 1 and saved["character"] == "31198239" and "gear" in saved["lists"]
    assert capsys.readouterr().err == ""


def test_a_single_sheet_outside_a_vault_says_so_once_on_stderr_and_saves_nothing(tmp_path, capsys, fake):
    path = sheet(tmp_path)
    assert main([str(path), "--write"]) == 0
    captured = capsys.readouterr()
    assert captured.err.splitlines() == [NOT_IN_A_VAULT]
    assert "| Level | 5 |" in path.read_text(encoding="utf-8")
    assert not (tmp_path / "_meta").exists()


def test_a_row_sync_added_is_removed_on_the_next_run_after_d_and_d_beyond_drops_it(tmp_path, capsys, monkeypatch):
    root = vault(tmp_path)
    path = sheet(root / "Characters")
    with_rope = character(hit_points={"base": 25}, inventory=(("Rope, Hempen", 1, 10, False, False, "gear"),))
    monkeypatch.setattr(dnd_ddb, "FETCH", Fetches(with_rope))
    main([str(path), "--write"])
    assert "| Rope, Hempen | 1 |" in path.read_text(encoding="utf-8")
    monkeypatch.setattr(dnd_ddb, "FETCH", Fetches(DATA))
    capsys.readouterr()
    main([str(path), "--write"])
    assert "REMOVE\tEquipment / Gear / Rope, Hempen\tD&D Beyond no longer has it" in lines(capsys)
    assert "Rope, Hempen" not in path.read_text(encoding="utf-8")
    assert json.loads(memory_file(root).read_text(encoding="utf-8"))["lists"]["gear"] == []


def test_party_write_creates_the_memory_and_a_preview_creates_nothing(tmp_path, capsys, fake):
    root = vault(tmp_path)
    pcs(root, ("Alder",))
    assert main(["--party", str(root)]) == 0
    assert not (root / "_meta" / "dndbeyond").exists()
    assert main(["--party", str(root), "--write"]) == 0
    files = sorted(p.name for p in (root / "_meta" / "dndbeyond").iterdir())
    assert files == ["31198230.json"]
    assert capsys.readouterr().err == ""


def test_party_does_not_save_the_memory_of_a_note_that_errored_or_was_not_written(tmp_path, capsys, monkeypatch):
    root = vault(tmp_path)
    (root / "Characters" / "Briar.md").write_text(note(link="https://www.dndbeyond.com/characters/2"), encoding="utf-8")
    (root / "Characters" / "Cress.md").write_text(note(link="https://www.dndbeyond.com/characters/3"), encoding="utf-8")

    def by_id(char_id):
        if char_id == "2":
            raise Unreadable("D&D Beyond has no character with that id")
        return DATA
    monkeypatch.setattr(dnd_ddb, "FETCH", by_id)
    assert main(["--party", str(root), "--write"]) == 0
    assert sorted(p.name for p in (root / "_meta" / "dndbeyond").iterdir()) == ["3.json"]
    monkeypatch.setattr(dnd_ddb, "FETCH", Fetches())
    (root / "Characters" / "Cress.md").write_text(note(link="https://www.dndbeyond.com/characters/3"), encoding="utf-8")
    (root / "_meta" / "dndbeyond" / "3.json").unlink()

    def broken(path, text):
        raise dnd_ddb.StepFailed("Cress.md cannot be written (PermissionError)")
    monkeypatch.setattr(dnd_ddb, "write_text_atomic", broken)
    assert main(["--party", str(root), "--write"]) == 2
    assert not (root / "_meta" / "dndbeyond" / "3.json").exists()


def test_a_memory_that_cannot_be_saved_is_one_stderr_line_and_the_note_is_still_written(tmp_path, capsys, fake, monkeypatch):
    def refuse(path, char_id, seen):
        raise OSError("disk full")
    monkeypatch.setattr(dnd_ddb, "save_seen", refuse)
    root = vault(tmp_path)
    path = sheet(root / "Characters")
    assert main([str(path), "--write"]) == 0
    captured = capsys.readouterr()
    assert captured.err.splitlines() == ["dnd_ddb: could not save what was synced for Tavin: disk full"]
    assert "| Level | 5 |" in path.read_text(encoding="utf-8")
    (tmp_path / "party").mkdir()
    other = vault(tmp_path / "party")
    pcs(other, ("Alder",))
    capsys.readouterr()
    assert main(["--party", str(other), "--write"]) == 0
    assert capsys.readouterr().err.splitlines() == ["dnd_ddb: could not save what was synced for Alder: disk full"]


@pytest.mark.skipif(sys.platform == "win32", reason="folder modes are not enforced the same way on Windows")
def test_an_unwritable_memory_folder_leaves_the_note_written_and_exit_0(tmp_path, capsys, fake):
    import os
    root = vault(tmp_path)
    (root / "_meta" / "dndbeyond").mkdir()
    os.chmod(root / "_meta" / "dndbeyond", 0o500)
    try:
        if os.access(root / "_meta" / "dndbeyond", os.W_OK):
            pytest.skip("this account can write anywhere")
        path = sheet(root / "Characters")
        assert main([str(path), "--write"]) == 0
        assert "could not save what was synced for Tavin" in capsys.readouterr().err
        assert "| Level | 5 |" in path.read_text(encoding="utf-8")
    finally:
        os.chmod(root / "_meta" / "dndbeyond", 0o700)


def test_a_damaged_memory_file_removes_nothing_and_is_replaced_whole(tmp_path, capsys, fake):
    root = vault(tmp_path)
    put(memory_file(root), "{broken")
    path = sheet(root / "Characters")
    assert main([str(path), "--write"]) == 0
    assert not [r for r in lines(capsys) if r.startswith("REMOVE")]
    assert dnd_ddb.load_seen(memory_file(root)) is not None


def test_the_memory_is_never_written_outside_the_vaults_meta_folder(tmp_path, capsys, fake):
    root = vault(tmp_path)
    pcs(root, ("Alder", "Briar"))
    main(["--party", str(root), "--write"])
    found = {p.relative_to(root).as_posix() for p in root.rglob("*.json")}
    assert found and all(f.startswith("_meta/dndbeyond/") for f in found)
