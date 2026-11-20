"""gma table: pick, file the Table Log, pass the party, serve.

The tool, the filing and the roster are stubbed; the order and the
arguments are what is pinned (Review M5: a refused pick files nothing).
"""

import contextlib
import io
import json
import subprocess
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


class TableTests(unittest.TestCase):
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

    def test_table_picks_files_a_missing_table_log_passes_the_party(self):
        code, out, _ = self.run_gma(["table", "V", "--port", "4400", "--no-open"])
        self.assertEqual(code, 0)
        self.assertEqual(self.kinds(), ["pick", "file", "serve"])
        self.assertEqual(self.calls[0][1], [
            "node", str(TOOL), "table", "V", "--pick", "--json", "--port", "4400"])
        self.assertEqual(self.calls[1][1], [
            "V", "table-log-new", "--session", INDEX, "--created-by", "run-sheet", "--write"])
        self.assertEqual(self.calls[2][1], [
            "table", "V", "--session", INDEX,
            "--party", json.dumps(["PCs/Ana.md", "PCs/Bo Lee.md"]),
            "--port", "4400", "--no-open"])

    def test_a_session_asked_for_goes_to_the_pick_only(self):
        self.run_gma(["table", "V", "--session", "Session 04"])
        self.assertEqual(self.calls[0][1][-2:], ["--session", "Session 04"])
        self.assertEqual(self.calls[2][1][2:4], ["--session", INDEX])

    def test_table_with_a_table_log_files_nothing(self):
        self.pick = _done({**PICK_OK, "tableLog": "Chapter 1/Session 04 - Table Log.md"})
        code, out, _ = self.run_gma(["table", "V"])
        self.assertEqual(code, 0)
        self.assertEqual(self.kinds(), ["pick", "serve"])
        self.assertNotIn("Filed", out)

    def test_a_busy_port_from_the_pick_files_nothing(self):
        busy = "Port 4322 is busy: something else holds it. Stop it, or start this with --port <another>."
        self.pick = _done({"ok": False, "error": busy}, 1)
        code, out, err = self.run_gma(["table", "V"])
        self.assertEqual(code, 1)
        self.assertEqual(self.kinds(), ["pick"])
        self.assertIn("gma table: " + busy, err)

    def test_filing_prints_the_one_played_line(self):
        _, out, _ = self.run_gma(["table", "V"])
        self.assertEqual(out.count("Filed the Table Log: Session 4 now counts as played.\n"), 1)
        self.assertEqual(out.count("Filed"), 1)

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

    def test_a_failed_filing_still_serves(self):
        self.file_code = 1
        code, out, err = self.run_gma(["table", "V"])
        self.assertEqual(code, 0)
        self.assertEqual(self.kinds(), ["pick", "file", "serve"])
        self.assertIn("gma table: could not file the Table Log; the sheet runs without one", err)
        self.assertNotIn("Filed", out)

    def test_a_failed_filing_prints_its_reason(self):
        # PR review L4: the reason was swallowed
        self.file_code = 1
        self.file_says = "\nvault-write: the session index has no documents block\nmore detail\n"
        code, out, err = self.run_gma(["table", "V"])
        self.assertEqual(code, 0)
        self.assertIn("gma table: could not file the Table Log (vault-write: the session "
                      "index has no documents block); the sheet runs without one", err)
        self.assertNotIn("more detail", err + out)

    def test_publish_table_routes_to_table(self):
        self.run_gma(["publish", "table", "V", "--no-open"])
        self.assertEqual(self.kinds(), ["pick", "file", "serve"])
        self.assertEqual(self.calls[2][1][-1], "--no-open")

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
        self.assertEqual(self.calls[1][1][0], vault)
        serve = self.calls[2][1]
        self.assertEqual(serve[1], vault)
        self.assertIn("PCs/Bo Lee.md", json.loads(serve[serve.index("--party") + 1]))

    def test_a_pc_note_named_like_json_passes_as_a_path(self):
        rows = ["PC\t[Guest] Mira.md\tMira; aliases: none; asOfSession: 3; player: C; status: active"]
        with mock.patch.object(vault_check, "list_active_pcs", lambda v, everyone=False: rows):
            self.run_gma(["table", "V"])
        serve = self.calls[2][1]
        self.assertEqual(serve.count("--party"), 1)
        self.assertEqual(json.loads(serve[serve.index("--party") + 1]), ["[Guest] Mira.md"])

    def test_no_party_serves_with_none(self):
        with mock.patch.object(vault_check, "list_active_pcs", lambda v, everyone=False: []):
            self.run_gma(["table", "V"])
        self.assertNotIn("--party", self.calls[2][1])

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


if __name__ == "__main__":
    unittest.main()
