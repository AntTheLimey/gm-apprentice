"""gma table: pick, pass the party and the Table Log's filing command, serve.

The tool and the roster are stubbed; the order and the arguments are what
is pinned (Review M5: a refused pick files nothing). Nothing is filed on
open (#855): the run sheet runs the command it is handed on the first thing
that happens at the table. One test runs that command for real.
"""

import contextlib
import io
import json
import os
import shutil
import subprocess
import tempfile
import sys
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parent.parent / "skills" / "shared" / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import gma  # noqa: E402
import vault_check  # noqa: E402
import vault_write  # noqa: E402
import vaultlib  # noqa: E402

TOOL = Path("tool/bin/gm-publish.js")
INDEX = "Chapter 1/Session 04 - Long Night.md"
PICK_OK = {"ok": True, "index": INDEX, "plan": "Chapter 1/Session 04 - Plan.md",
           "tableLog": None, "label": "Session 4", "stateId": "chapter-1--session-04",
           "others": []}
ROWS = ["PC\tPCs/Ana.md\tAna; aliases: none; asOfSession: 3; player: A; status: active",
        "PC\tPCs/Bo Lee.md\tBo; aliases: none; asOfSession: 3; player: B; status: active"]


def _done(payload, code=0):
    return subprocess.CompletedProcess([], code, stdout=json.dumps(payload) + "\n", stderr="")


class _Fakes(unittest.TestCase):
    """The stubbed tool and roster; the tests are in the classes below."""

    def setUp(self):
        self.calls = []
        old = vaultlib.PUBLISH_TOOL
        vaultlib.PUBLISH_TOOL = TOOL
        self.addCleanup(setattr, vaultlib, "PUBLISH_TOOL", old)
        self.pick = _done(PICK_OK)
        self.file_code = 0
        self.file_says = ""

        def fake_run(cmd, **kw):
            self.calls.append(("pick", cmd))
            return self.pick

        def fake_file(argv, *a, **kw):
            self.calls.append(("file", argv))
            if self.file_says:
                print(self.file_says, file=sys.stderr)
            return self.file_code

        def fake_serve(tool, args):
            self.calls.append(("serve", args))
            return 0

        for target, new in (
                (mock.patch.object(gma.subprocess, "run", fake_run), None),
                (mock.patch.object(vault_write, "main", fake_file), None),
                (mock.patch.object(vault_check, "list_active_pcs",
                                   lambda vault, everyone=False: list(ROWS)), None),
                (mock.patch.object(gma, "_run_tool", fake_serve), None),
                (mock.patch.object(gma, "_ensure_tool", lambda: None), None)):
            target.start()
            self.addCleanup(target.stop)

    def run_gma(self, argv):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = gma.main(argv)
        return code, out.getvalue(), err.getvalue()

    def kinds(self):
        return [k for k, _ in self.calls]

    def file_log(self, serve):
        return json.loads(serve[serve.index("--file-log") + 1])


class TableTests(_Fakes):

    def test_table_picks_passes_the_party_and_the_filing_command_and_files_nothing(self):
        code, out, _ = self.run_gma(["table", "V", "--port", "4400", "--no-open"])
        self.assertEqual(code, 0)
        self.assertEqual(self.kinds(), ["pick", "serve"], "nothing is filed on open (#855)")
        self.assertEqual(self.calls[0][1], [
            "node", str(TOOL), "table", "V", "--pick", "--json", "--port", "4400"])
        cmd = gma._table_log_command("V", INDEX)
        self.assertEqual(self.calls[1][1], [
            "table", "V", "--session", INDEX,
            "--party", json.dumps(["PCs/Ana.md", "PCs/Bo Lee.md"]),
            "--port", "4400", "--file-log", json.dumps(cmd), "--no-open"])
        self.assertEqual(cmd[2:], ["vault-write", os.path.abspath("V"), "table-log-new",
                                   "--session", INDEX, "--created-by", "run-sheet", "--write"])
        self.assertNotIn("Filed", out)
        self.assertNotIn("played", out)

    def test_a_session_asked_for_goes_to_the_pick_only(self):
        self.run_gma(["table", "V", "--session", "Session 04"])
        self.assertEqual(self.calls[0][1][-2:], ["--session", "Session 04"])
        self.assertEqual(self.calls[1][1][2:4], ["--session", INDEX])

    def test_table_with_a_table_log_passes_no_filing_command(self):
        self.pick = _done({**PICK_OK, "tableLog": "Chapter 1/Session 04 - Table Log.md"})
        code, out, _ = self.run_gma(["table", "V"])
        self.assertEqual(code, 0)
        self.assertEqual(self.kinds(), ["pick", "serve"])
        self.assertNotIn("--file-log", self.calls[1][1])

    def test_a_busy_port_from_the_pick_files_nothing(self):
        busy = "Port 4322 is busy: something else holds it. Stop it, or start this with --port <another>."
        self.pick = _done({"ok": False, "error": busy}, 1)
        code, out, err = self.run_gma(["table", "V"])
        self.assertEqual(code, 1)
        self.assertEqual(self.kinds(), ["pick"])
        self.assertIn("gma table: " + busy, err)

    def test_a_refused_pick_prints_the_tools_words_and_exits_1(self):
        words = "Session 3 is wrapped up; its record is the Wrap-Up."
        self.pick = _done({"ok": False, "error": words}, 1)
        code, _, err = self.run_gma(["table", "V", "--session", "Session 03"])
        self.assertEqual(code, 1)
        self.assertEqual(err.strip(), "gma table: " + words)
        self.assertEqual(self.kinds(), ["pick"])

    def test_a_pick_with_no_json_answer_files_nothing(self):
        self.pick = subprocess.CompletedProcess([], 1, stdout="", stderr="boom\n")
        code, _, err = self.run_gma(["table", "V"])
        self.assertEqual(code, 1)
        self.assertEqual(self.kinds(), ["pick"])
        self.assertIn("boom", err)

    def test_publish_table_routes_to_table(self):
        self.run_gma(["publish", "table", "V", "--no-open"])
        self.assertEqual(self.kinds(), ["pick", "serve"])
        self.assertEqual(self.calls[1][1][-1], "--no-open")

    def test_no_tool_exits_1(self):
        vaultlib.PUBLISH_TOOL = None
        code, _, err = self.run_gma(["table", "V"])
        self.assertEqual(code, 1)
        self.assertIn("the publish tool is not installed", err)
        self.assertEqual(self.calls, [])

    def test_paths_with_spaces_and_windows_vaults_pass_as_single_arguments(self):
        vault = "C:\\Users\\Ann Lee\\My Vault"
        self.run_gma(["table", vault])
        self.assertEqual(self.calls[0][1][3], vault)
        serve = self.calls[1][1]
        self.assertEqual(serve[1], vault)
        self.assertIn(os.path.abspath(vault), self.file_log(serve))
        self.assertIn("PCs/Bo Lee.md", json.loads(serve[serve.index("--party") + 1]))

    def test_a_pc_note_named_like_json_passes_as_a_path(self):
        rows = ["PC\t[Guest] Mira.md\tMira; aliases: none; asOfSession: 3; player: C; status: active"]
        with mock.patch.object(vault_check, "list_active_pcs", lambda v, everyone=False: rows):
            self.run_gma(["table", "V"])
        serve = self.calls[1][1]
        self.assertEqual(serve.count("--party"), 1)
        self.assertEqual(json.loads(serve[serve.index("--party") + 1]), ["[Guest] Mira.md"])

    def test_no_party_serves_with_none(self):
        with mock.patch.object(vault_check, "list_active_pcs", lambda v, everyone=False: []):
            self.run_gma(["table", "V"])
        self.assertNotIn("--party", self.calls[1][1])

    def test_stdout_is_flushed_before_serving(self):
        # posix replaces the process: buffered lines would be lost.
        class Out(io.StringIO):
            flushes = 0

            def flush(self):
                Out.flushes += 1

        seen = []

        def serve(tool, args):
            seen.append(Out.flushes)
            return 0
        with mock.patch.object(gma, "_run_tool", serve), \
                contextlib.redirect_stdout(Out()):
            gma.main(["table", "V"])
        self.assertGreater(seen[0], 0)

    def test_a_missing_node_says_so(self):
        def boom(cmd, **kw):
            raise FileNotFoundError("node")
        with mock.patch.object(gma.subprocess, "run", boom):
            code, _, err = self.run_gma(["table", "V"])
        self.assertEqual(code, 1)
        self.assertIn("node", err)
        self.assertEqual(self.kinds(), [])



class TableLogCommandTests(unittest.TestCase):
    """The command the run sheet is handed, run for real: it files the Table
    Log beside the index and leaves the status alone (#855)."""

    def test_the_command_files_the_log_and_keeps_the_status(self):
        root = Path(tempfile.mkdtemp(prefix="gma-table-log-"))
        self.addCleanup(shutil.rmtree, root, True)
        index = "Chapters/Chapter 1/Sessions/Session 04 - Long Night.md"
        (root / index).parent.mkdir(parents=True)
        (root / index).write_text(
            '---\ntype: session\nsession_number: 4\nstatus: prepped\n'
            'chapter: "[[Chapter 1]]"\n---\n\n# Session 04 - Long Night\n',
            encoding="utf-8")
        done = subprocess.run(gma._table_log_command(str(root), index),
                              capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        text = (root / index).read_text(encoding="utf-8")
        self.assertIn("status: prepped\n", text)
        self.assertIn('table_log: "[[Session 04 - Long Night - Table Log]]"', text)
        log = root / "Chapters/Chapter 1/Sessions/Session 04 - Long Night - Table Log.md"
        self.assertIn("type: session-table-log", log.read_text(encoding="utf-8"))


RECORD = Path(__file__).resolve().parent.parent / "tools" / "publish" / "test" / "fixtures" / "run-sheet-record"
CH3 = "Chapters/Chapter 3/Sessions"


def _record_copy(case):
    root = Path(tempfile.mkdtemp(prefix="gma-table-file-"))
    case.addCleanup(shutil.rmtree, root, True)
    shutil.copytree(RECORD, root, dirs_exist_ok=True)
    return root


def _tree(root):
    return {str(p.relative_to(root)): p.read_bytes() for p in sorted(root.rglob("*")) if p.is_file()}


def _table_file(root, *extra, number="15", chapter="Chapter 3", title="Quiet", date="2026-11-29"):
    cmd = [sys.executable, str(SCRIPTS / "gma.py"), "table-file", str(root), "--number", number,
           *(["--chapter", chapter] if chapter else []),
           "--title", title, "--play-date", date, *extra]
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")


class TableFileTests(unittest.TestCase):
    """`gma table-file`, run for real on a copy of the no-Plan fixture."""

    def test_table_file_files_index_and_log_as_one_batch(self):
        root = _record_copy(self)
        done = _table_file(root)
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        index = root / CH3 / "Session 15" / "Session 15 - Quiet.md"
        log = root / CH3 / "Session 15" / "Session 15 - Quiet - Table Log.md"
        text = index.read_text(encoding="utf-8")
        self.assertIn("status: planned\n", text)
        self.assertIn('play_date: "2026-11-29"', text)
        self.assertIn('table_log: "[[Session 15 - Quiet - Table Log]]"', text)
        logtext = log.read_text(encoding="utf-8")
        self.assertIn("type: session-table-log", logtext)
        self.assertIn('[[Session 15 - Quiet]]', logtext)
        self.assertIn("run-sheet", logtext)
        # the index's row comes first, in vault-write's row format
        rows = [ln for ln in done.stdout.splitlines() if ln and not ln.startswith(("#", "="))]
        self.assertEqual(rows[0].split("\t")[:2], ["CREATED", f"{CH3}/Session 15/Session 15 - Quiet.md"])

    def test_table_file_beside_an_index_prep_made(self):
        root = _record_copy(self)
        made = _table_file(root, title="Prepped")  # prep files it
        self.assertEqual(made.returncode, 0, made.stderr)
        for p in (root / CH3 / "Session 15").glob("* - Table Log.md"):
            p.unlink()
        idx = root / CH3 / "Session 15" / "Session 15 - Prepped.md"
        text = idx.read_text(encoding="utf-8")
        idx.write_text(text.replace('table_log: "[[Session 15 - Prepped - Table Log]]"', "table_log: null"), encoding="utf-8")
        done = _table_file(root, title="Something Else")
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        self.assertEqual(len(list((root / CH3).rglob("Session 15 - *.md"))), 2, "one index and its log")
        self.assertTrue((root / CH3 / "Session 15" / "Session 15 - Prepped - Table Log.md").exists())
        rows = [ln for ln in done.stdout.splitlines() if ln and not ln.startswith(("#", "="))]
        self.assertEqual(rows[0].split("\t")[:2], ["ADDED", f"{CH3}/Session 15/Session 15 - Prepped.md"])
        self.assertIn("table_log", idx.read_text(encoding="utf-8"))

    def test_table_file_refusal_writes_nothing(self):
        root = _record_copy(self)
        # no chapter given, and no earlier session of that number: session 40 has no session 39
        before = _tree(root)
        done = _table_file(root, number="40", chapter=None)
        self.assertEqual(done.returncode, 1, done.stdout)
        self.assertEqual(_tree(root), before)
        first = next(ln for ln in done.stdout.splitlines() if ln.strip())
        self.assertTrue(first.startswith("ERROR"), done.stdout)
        self.assertIn("no session 39 index found", first)

    def test_table_file_title_with_a_colon_files_under_the_date(self):
        root = _record_copy(self)
        done = _table_file(root, title="Night: the Lamp")
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        self.assertTrue((root / CH3 / "Session 15" / "Session 15 - 29 Nov 2026.md").exists())
        self.assertTrue((root / CH3 / "Session 15" / "Session 15 - 29 Nov 2026 - Table Log.md").exists())

    def test_table_file_title_starting_with_a_dash(self):
        root = _record_copy(self)
        done = _table_file(root, "--title=-Dash")  # a second --title: the last one wins
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        self.assertTrue((root / CH3 / "Session 15" / "Session 15 - -Dash.md").exists())

    def test_a_blank_title_files_under_the_date(self):
        root = _record_copy(self)
        done = _table_file(root, title="   ")
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        self.assertTrue((root / CH3 / "Session 15" / "Session 15 - 29 Nov 2026.md").exists())

    def test_an_index_that_appears_between_the_look_and_the_batch(self):
        # session-new refuses "already has an index": the log is filed beside it in the same run
        root = _record_copy(self)
        self.assertEqual(_table_file(root, title="First").returncode, 0)
        for p in (root / CH3 / "Session 15").glob("* - Table Log.md"):
            p.unlink()
        idx = root / CH3 / "Session 15" / "Session 15 - First.md"
        idx.write_text(idx.read_text(encoding="utf-8").replace(
            'table_log: "[[Session 15 - First - Table Log]]"', "table_log: null"), encoding="utf-8")
        done = _table_file(root, title="Second", chapter=None)
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        self.assertFalse(list((root / CH3).rglob("Session 15 - Second*")))
        self.assertTrue((root / CH3 / "Session 15" / "Session 15 - First - Table Log.md").exists())

    def test_table_file_is_hidden_from_the_command_list(self):
        self.assertNotIn("table-file", gma.COMMANDS)


class RecordPickTests(_Fakes):
    """`_table` with a pick for a session not filed yet."""

    RECORD_PICK = {"ok": True, "index": None, "plan": None, "tableLog": None, "label": "Session 15",
                   "stateId": "chapter-3--session-15", "others": [], "fromRecord": True, "number": 15,
                   "chapter": "Chapters/Chapter 3/Chapter 3.md", "after": None, "planVault": None,
                   "playDate": None}

    def test_table_record_pick_never_passes_session_None(self):
        self.pick = _done(self.RECORD_PICK)
        code, _, err = self.run_gma(["table", "V", "--no-open"])
        self.assertEqual(code, 0, err)
        serve = self.calls[1][1]
        self.assertNotIn("None", serve)
        self.assertNotIn("--session", serve)

    def test_table_hands_the_server_a_title_taking_command(self):
        self.pick = _done(self.RECORD_PICK)
        self.run_gma(["table", "V", "--no-open"])
        handed = self.file_log(self.calls[1][1])
        self.assertEqual(handed["takesTitle"], True)
        self.assertEqual(handed["cmd"][1:], [
            str(Path(gma.__file__).resolve()), "table-file", os.path.abspath("V"),
            "--number", "15", "--chapter", "Chapter 3"])
        self.assertEqual(handed["cmd"][0], sys.executable)

    def test_a_record_pick_with_no_chapter_passes_none(self):
        self.pick = _done({**self.RECORD_PICK, "chapter": None})
        self.run_gma(["table", "V", "--no-open"])
        self.assertNotIn("--chapter", self.file_log(self.calls[1][1])["cmd"])

    def test_a_record_pick_whose_index_now_exists_files_just_the_log(self):
        self.pick = _done({**self.RECORD_PICK, "index": INDEX})
        self.run_gma(["table", "V", "--no-open"])
        serve = self.calls[1][1]
        self.assertEqual(serve[2:4], ["--session", INDEX])
        self.assertEqual(self.file_log(serve), gma._table_log_command("V", INDEX))


if __name__ == "__main__":
    unittest.main()
