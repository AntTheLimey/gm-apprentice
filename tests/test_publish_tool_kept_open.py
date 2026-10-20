"""The settings and `explain --all` questions go to the publish tool's
kept-open `lines` process: Node starts once a run, every answer is read
from the files as they are, an older tool is run on its own, and no
process outlives the run (#473)."""

import json
import os
import shutil
import subprocess
import sys
import textwrap
import time
from pathlib import Path
from unittest import mock

import pytest

SCRIPTS = Path(__file__).resolve().parent.parent / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import vaultlib  # noqa: E402

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(
    not NODE and not os.environ.get("VAULT_CHECK_REQUIRE_NODE"),
    reason="needs Node")


@pytest.fixture(autouse=True)
def _fresh_cache():
    vaultlib.forget_settings(None)
    yield
    vaultlib.forget_settings(None)


def no_spawn(monkeypatch):
    """Every run of a command on its own fails the test."""
    def run(cmd, **_kw):
        raise AssertionError(f"a command was run on its own: {cmd[2:4]}")
    monkeypatch.setattr(vaultlib.subprocess, "run", run)


def new_vault(tmp_path: Path, title: str) -> Path:
    vault = tmp_path / "vault"
    (vault / "_meta").mkdir(parents=True, exist_ok=True)
    (vault / "_meta" / "vault-config.yaml").write_text(
        f"player_site:\n  title: {title}\n", encoding="utf-8")
    return vault


def test_a_change_to_the_file_between_two_asks_is_read(tmp_path, monkeypatch):
    # The process stays open between questions, and holds nothing of the
    # vault: a write (here by hand) is seen by the next ask.
    vault = new_vault(tmp_path, "One")
    own = vaultlib.lines_for(vaultlib.PUBLISH_TOOL)
    assert vaultlib.settings_written(vault, "player_site.title") == ("One", "file")
    pid = own._proc.pid
    no_spawn(monkeypatch)
    vaultlib.settings_set(vault, [("player_site.title", "Two")])
    assert vaultlib.settings_written(vault, "player_site.title") == ("Two", "file")
    (vault / "_meta" / "vault-config.yaml").write_text(
        "player_site:\n  title: Three\n", encoding="utf-8")
    assert vaultlib.settings_written(vault, "player_site.title") == ("Three", "file")
    assert vaultlib.settings_raw(vault, "player_site.title") == "Three"
    vaultlib.forget_settings(vault)
    assert vaultlib.settings(vault).get("player_site.title") == "Three"
    assert own._proc.pid == pid


def test_explain_all_is_asked_of_the_same_process_and_sees_a_new_note(
        tmp_path, monkeypatch):
    vault = new_vault(tmp_path, "One")
    config = tmp_path / "site" / "vault.config.json"
    config.parent.mkdir()
    config.write_text(json.dumps({"vaultPath": str(vault),
                                  "folderMap": {"Sessions": "sessions"}}),
                      encoding="utf-8")
    cmd = [NODE, str(vaultlib.PUBLISH_TOOL), "explain", "--all", "--json",
           "--config", str(config), "--vault", str(vault)]

    def pages():
        done = vaultlib.run_tool(cmd, capture_output=True, text=True,
                                 timeout=60)
        assert done.returncode == 0, done.stderr
        return {p["path"] for p in json.loads(done.stdout)["pages"]}

    vaultlib.settings_raw(vault)
    no_spawn(monkeypatch)
    assert "Sessions/S1.md" not in pages()
    (vault / "Sessions").mkdir()
    (vault / "Sessions" / "S1.md").write_text(
        "---\ntype: session\nsession_number: 1\n---\n", encoding="utf-8")
    assert "Sessions/S1.md" in pages()


def test_a_relative_vault_is_read_from_the_callers_folder(tmp_path, monkeypatch):
    new_vault(tmp_path, "Here")
    monkeypatch.chdir(tmp_path)
    assert vaultlib.settings_written(Path("vault"), "player_site.title") == (
        "Here", "file")


def fake_tool(folder: Path, lines_answer: str) -> Path:
    """A tool whose `lines` answers every question with `lines_answer`,
    and whose own run of any other command prints {"alone": true}."""
    tool = folder / "gm-publish.js"
    folder.mkdir(parents=True, exist_ok=True)
    tool.write_text(textwrap.dedent(f"""\
        if (process.argv[2] === 'lines') {{
          require('readline').createInterface({{ input: process.stdin }})
            .on('line', () => process.stdout.write({json.dumps(lines_answer)} + '\\n'));
        }} else {{
          process.stdout.write(JSON.stringify({{ alone: true }}));
        }}
        """), encoding="utf-8")
    return tool


def test_a_tool_without_the_command_op_is_run_on_its_own(tmp_path):
    # The site's pinned tool may predate the op: its own run answers, and
    # the process is not asked again.
    tool = fake_tool(tmp_path / "old",
                     json.dumps({"error": 'unknown op: "command"'}))
    cmd = [NODE, str(tool), "explain", "--all", "--json"]
    done = vaultlib.run_tool(cmd, capture_output=True, text=True, timeout=60)
    assert json.loads(done.stdout) == {"alone": True}
    lines = vaultlib.lines_for(tool)
    assert lines._no_command
    lines.close()


def test_a_failed_process_reruns_a_read_but_never_a_write(tmp_path):
    # The process dies on the question: a read is asked again of a run of
    # its own; a write may have happened, so it is not done twice.
    tool = tmp_path / "t" / "gm-publish.js"
    tool.parent.mkdir()
    ran = tmp_path / "ran"
    asked = tmp_path / "asked"
    # The first question of the run is answered, so the tool is known to
    # have the op; every later one kills the process.
    tool.write_text(textwrap.dedent(f"""\
        const fs = require('fs');
        if (process.argv[2] === 'lines') {{
          process.stdin.on('data', () => {{
            if (fs.existsSync({json.dumps(str(asked))})) process.exit(1);
            fs.writeFileSync({json.dumps(str(asked))}, 'x');
            process.stdout.write(JSON.stringify({{ rc: 0, stdout: '{{}}', stderr: '' }}) + '\\n');
          }});
        }} else {{
          fs.appendFileSync({json.dumps(str(ran))}, process.argv[3] + '\\n');
          process.stdout.write('{{}}');
        }}
        """), encoding="utf-8")
    kw = dict(capture_output=True, text=True, timeout=60)
    vaultlib.run_tool([NODE, str(tool), "settings", "get", "--json"], **kw)
    read = vaultlib.run_tool([NODE, str(tool), "settings", "get", "--json"], **kw)
    assert read.returncode == 0 and read.stdout == "{}"
    write = vaultlib.run_tool([NODE, str(tool), "settings", "set", "a=1"], **kw)
    assert write.returncode == 1 and write.stderr.startswith("Error: ")
    assert ran.read_text(encoding="utf-8") == "get\n"
    vaultlib.lines_for(tool).close()


def test_a_replaced_tool_gets_a_new_process(tmp_path):
    tool = fake_tool(tmp_path / "t", json.dumps({"dates": []}))
    lines = vaultlib.PublishLines(tool)
    try:
        lines.ask({"op": "dates", "values": []})
        first = lines._proc.pid
        lines.ask({"op": "dates", "values": []})
        assert lines._proc.pid == first
        text = tool.read_text(encoding="utf-8")
        tool.write_text(text + "\n// the next version\n", encoding="utf-8")
        lines.ask({"op": "dates", "values": []})
        assert lines._proc.pid != first
    finally:
        lines.close()


def test_no_more_than_a_few_processes_are_open_at_once(tmp_path):
    made = [vaultlib.PublishLines(fake_tool(tmp_path / str(i),
                                            json.dumps({"dates": []})))
            for i in range(vaultlib.MAX_OPEN_LINES + 2)]
    try:
        for lines in made:
            lines.ask({"op": "dates", "values": []})
        open_now = [x for x in made if x._proc is not None]
        assert len(open_now) == vaultlib.MAX_OPEN_LINES
        assert made[-1] in open_now and made[0] not in open_now
    finally:
        for lines in made:
            lines.close()


def test_a_tool_that_exits_before_reading_is_said_to_have_exited(tmp_path):
    # It exits before the question is written: the broken pipe is the same
    # answer as no answer, not "stopped answering (BrokenPipeError)".
    tool = tmp_path / "gm-publish.js"
    tool.write_text("process.exit(1);\n", encoding="utf-8")
    lines = vaultlib.PublishLines(tool)
    proc = lines._process()
    proc.wait()
    try:
        with mock.patch.object(lines, "_process", return_value=proc):
            with pytest.raises(vaultlib.PublishToolUnavailable) as raised:
                lines.ask({"op": "stub", "text": "", "include": []})
    finally:
        lines.close()
    assert "older than 1.12.1 has no `lines` command" in str(raised.value)


def alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    return True


def test_a_process_never_closed_ends_with_the_run(tmp_path):
    # #473: a `lines` process nobody closed outlived its run, and later test
    # runs hung on it. This one does not even end when its stdin closes.
    tool = tmp_path / "stubborn.js"
    tool.write_text("process.stdin.resume(); process.stdin.on('end', () => {});"
                    " setInterval(() => {}, 1000);\n", encoding="utf-8")
    script = textwrap.dedent(f"""\
        import sys
        sys.path.insert(0, {str(SCRIPTS)!r})
        from pathlib import Path
        import vaultlib
        lines = vaultlib.PublishLines(Path({str(tool)!r}))
        print(lines._process().pid, flush=True)
        """)
    done = subprocess.run([sys.executable, "-c", script], capture_output=True,
                          text=True, stdin=subprocess.DEVNULL, timeout=60)
    assert done.returncode == 0, done.stderr
    pid = int(done.stdout.strip())
    deadline = time.monotonic() + 10
    while alive(pid) and time.monotonic() < deadline:
        time.sleep(0.1)
    if alive(pid):
        os.kill(pid, 9)
        pytest.fail("the lines process outlived the interpreter that started it")


def test_a_write_cut_off_says_the_change_may_have_been_made(
        tmp_path, monkeypatch):
    # The process dies mid-question on a write: its reason is the command's
    # own (not "failed to start ... older than 1.12.1"), and no run of its
    # own follows.
    tool = tmp_path / "t" / "gm-publish.js"
    tool.parent.mkdir()
    ran = tmp_path / "ran"
    tool.write_text(textwrap.dedent(f"""\
        if (process.argv[2] === 'lines') {{
          process.stdin.once('data', () => process.exit(1));
        }} else {{
          require('fs').appendFileSync({json.dumps(str(ran))}, 'ran\\n');
        }}
        """), encoding="utf-8")
    vault = new_vault(tmp_path, "One")
    monkeypatch.setattr(vaultlib, "PUBLISH_TOOL", tool)
    try:
        with pytest.raises(vaultlib.SettingsUnavailable) as raised:
            vaultlib.settings_set(vault, [("player_site.title", "Two")])
    finally:
        vaultlib.lines_for(tool).close()
    msg = str(raised.value)
    assert raised.value.refused
    assert 'stopped during "settings set"' in msg
    assert "the change may have been made" in msg
    assert "older than 1.12.1" not in msg
    assert not ran.exists()


def test_a_tool_replaced_after_unknown_op_is_asked_again(tmp_path):
    tool = fake_tool(tmp_path / "t",
                     json.dumps({"error": 'unknown op: "command"'}))
    lines = vaultlib.PublishLines(tool)
    try:
        assert lines.command(["settings", "get"]) is None
        assert lines._no_command
        tool.write_text(
            "require('readline').createInterface({ input: process.stdin })"
            ".on('line', () => process.stdout.write(JSON.stringify("
            "{ rc: 0, stdout: '{}', stderr: '' }) + '\\n'));\n"
            "// the next version\n", encoding="utf-8")
        assert lines.command(["settings", "get"]) == (0, "{}", "")
    finally:
        lines.close()


def test_a_tool_that_exits_unanswered_is_not_started_again(tmp_path):
    # An older or broken tool: the first ask finds out, the second does
    # not start `lines` to find out again.
    tool = tmp_path / "gm-publish.js"
    tool.write_text("if (process.argv[2] === 'lines') process.exit(1);\n"
                    "else process.stdout.write('{}');\n", encoding="utf-8")
    starts: list[list[str]] = []
    real = subprocess.Popen

    def counting(cmd, *a, **kw):
        starts.append(cmd)
        return real(cmd, *a, **kw)

    lines = vaultlib.PublishLines(tool)
    try:
        with mock.patch.object(vaultlib.subprocess, "Popen", counting):
            with pytest.raises(vaultlib.PublishToolUnavailable):
                lines.command(["settings", "get"])
            assert lines.command(["settings", "get"]) is None
    finally:
        lines.close()
    assert len(starts) == 1
