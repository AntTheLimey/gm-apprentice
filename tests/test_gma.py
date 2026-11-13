"""gma: one entry point dispatching to the vault scripts."""

import argparse
import contextlib
import io
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parent.parent / "skills" / "shared" / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import gma  # noqa: E402
import vault_check  # noqa: E402
import vaultlib  # noqa: E402

AGENT_SENTENCE = ("Agents: do not work from --help alone. Run 'gma llms' for "
                  "the command reference and when to use each command.")


def _run(argv):
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        try:
            code = gma.main(argv)
        except SystemExit as exc:
            code = exc.code
    return code, out.getvalue(), err.getvalue()


# Windows children write cp1252 to a pipe; the tests decode UTF-8.
CHILD_ENV = {**os.environ, "PYTHONIOENCODING": "utf-8"}


def _subprocess(argv):
    return subprocess.run(
        [sys.executable, str(SCRIPTS / "gma.py"), *argv],
        capture_output=True, text=True, encoding="utf-8", env=CHILD_ENV)


class GmaTests(unittest.TestCase):
    def test_dispatch_returns_the_scripts_exit_status(self):
        vault = Path(tempfile.mkdtemp(prefix="gma-vault-"))
        self.addCleanup(shutil.rmtree, vault, True)
        with contextlib.redirect_stdout(io.StringIO()):
            expected = vault_check.main([str(vault), "version"])
        code, _, _ = _run(["vault-check", str(vault), "version"])
        self.assertEqual(code, expected)

    def test_a_nonzero_status_comes_back_through_gma(self):
        # A real script: relink on a vault with no such note returns 1.
        vault = Path(tempfile.mkdtemp(prefix="gma-vault-"))
        self.addCleanup(shutil.rmtree, vault, True)
        import relink
        argv = [str(vault), "Nope", "Other"]
        with contextlib.redirect_stderr(io.StringIO()), \
                contextlib.redirect_stdout(io.StringIO()):
            direct = relink.main(argv)
        self.assertEqual(direct, 1)
        code, _, _ = _run(["relink", *argv])
        self.assertEqual(code, 1)
        # And a main that returns 3 (not 0, not an argparse exit).
        with mock.patch.object(relink, "main", return_value=3):
            self.assertEqual(_run(["relink", *argv])[0], 3)

    def test_publish_signal_death_maps_to_1(self):
        # POSIX execs node; the Windows path is the one that maps exit codes.
        with mock.patch.object(gma.os, "name", "nt"):
            with mock.patch.object(gma, "_call_tied_to_gma", return_value=-15):
                self.assertEqual(gma.main(["publish", "doctor"]), 1)
            with mock.patch.object(gma, "_call_tied_to_gma", return_value=7):
                self.assertEqual(gma.main(["publish", "doctor"]), 7)

    def test_error_wrappers_run_the_same_directly_and_through_gma(self):
        # The wrappers live in main(argv), so both paths take them.
        import index_build
        import session_context
        cases = [
            ("vault-check", vault_check, vaultlib.SettingsUnavailable("bad"), "bad"),
            ("vault-check", vault_check,
             vaultlib.PublishToolUnavailable("node died"), "node died"),
            ("index-build", index_build, vaultlib.SettingsUnavailable("bad"), "bad"),
            ("session-context", session_context,
             vaultlib.SettingsUnavailable("bad"), "bad"),
        ]
        for name, module, exc, text in cases:
            vault = Path(tempfile.mkdtemp(prefix="gma-vault-"))
            self.addCleanup(shutil.rmtree, vault, True)
            argv = [str(vault)]
            if name == "vault-check":
                argv.append("version")
            for how, call in (("direct", module.main),
                              ("gma", lambda a, n=name: gma.main([n, *a]))):
                with self.subTest(command=name, exc=type(exc).__name__, how=how):
                    err = io.StringIO()
                    with mock.patch.object(module, "_main", side_effect=exc), \
                            contextlib.redirect_stderr(err), \
                            contextlib.redirect_stdout(io.StringIO()):
                        code = call(argv)
                    self.assertEqual(code, 2)
                    lines = [l for l in err.getvalue().splitlines() if l]
                    self.assertEqual(len(lines), 1, lines)
                    self.assertTrue(lines[0].startswith("error: "), lines)
                    self.assertIn(text, lines[0])

    def test_hand_written_error_lines_name_gma_command(self):
        vault = Path(tempfile.mkdtemp(prefix="gma-vault-"))
        missing = vault / "nope"
        self.addCleanup(shutil.rmtree, vault, True)
        done = _subprocess(["migrate", str(missing)])
        self.assertEqual(done.returncode, 2, done.stderr)
        self.assertIn("gma migrate: not a directory", done.stderr)
        self.assertNotIn("migrate.py:", done.stderr)
        direct = subprocess.run(
            [sys.executable, str(SCRIPTS / "migrate.py"), str(missing)],
            capture_output=True, text=True, encoding="utf-8", env=CHILD_ENV)
        self.assertIn("migrate.py: not a directory", direct.stderr)

    def test_unknown_command_exits_2_and_names_llms(self):
        code, _, err = _run(["frobnicate"])
        self.assertEqual(code, 2)
        self.assertIn("gma: unknown command 'frobnicate'; run 'gma llms'", err)

    def test_root_help_sends_agents_to_llms(self):
        self.assertTrue(
            gma.full_tree().description.rstrip().endswith(AGENT_SENTENCE))
        code, out, _ = _run(["--help"])
        self.assertEqual(code, 0)
        self.assertIn(AGENT_SENTENCE, " ".join(out.split()))
        code, out, _ = _run([])
        self.assertIn(AGENT_SENTENCE, " ".join(out.split()))

    def test_version_prints_the_plugin_version(self):
        code, out, _ = _run(["--version"])
        self.assertEqual(code, 0)
        self.assertEqual(out.strip(), vaultlib.plugin_version()[0])

    @unittest.skipUnless(shutil.which("node"), "node not installed")
    def test_publish_passes_through(self):
        d = Path(tempfile.mkdtemp(prefix="gma-stub-"))
        self.addCleanup(shutil.rmtree, d, True)
        stub = d / "stub.js"
        stub.write_text("process.exit(7);\n", encoding="utf-8")
        old = vaultlib.PUBLISH_TOOL
        vaultlib.PUBLISH_TOOL = stub
        self.addCleanup(setattr, vaultlib, "PUBLISH_TOOL", old)
        with mock.patch.object(gma.os, "name", "nt"):
            self.assertEqual(gma.main(["publish", "doctor"]), 7)

    def test_full_tree_has_every_command(self):
        tree = gma.full_tree()
        names = set()
        for action in tree._actions:
            if isinstance(action, argparse._SubParsersAction):
                names |= set(action.choices)
        self.assertEqual(names, set(gma.COMMANDS))
        self.assertEqual(len(names), 35)

    def test_a_command_imports_only_its_own_module(self):
        vault = Path(tempfile.mkdtemp(prefix="gma-vault-"))
        self.addCleanup(shutil.rmtree, vault, True)
        sys.modules.pop("dnd_ddb", None)
        _run(["vault-check", str(vault), "version"])
        self.assertNotIn("dnd_ddb", sys.modules)

    def test_version_takes_no_arguments(self):
        self.assertEqual(_run(["--version"])[0], 0)
        for extra in (["--bogus"], ["dnd-ddb"]):
            with self.subTest(extra=extra):
                code, out, err = _run(["--version", *extra])
                self.assertEqual((code, out), (2, ""))
                self.assertIn("--version takes no arguments", err)

    def test_script_error_lines_name_gma_through_gma(self):
        # The hard-coded prefixes of dnd_ddb, dnd_sheet and scene_queue.
        vault = Path(tempfile.mkdtemp(prefix="gma-vault-"))
        self.addCleanup(shutil.rmtree, vault, True)
        missing = vault / "nope"
        for folder in ("Chapters/A", "Chapters/B"):
            (vault / folder).mkdir(parents=True)
            (vault / folder / "Same.md").write_text(
                "---\ntype: chapter\n---\n", encoding="utf-8")
        for argv, prefix in (
                (["dnd-ddb", str(missing / "a.md")], "gma dnd-ddb: "),
                (["dnd-sheet", "--party", str(missing)], "gma dnd-sheet: "),
                (["scene-queue", str(vault), "--chapter", "Same"],
                 "gma scene-queue: ")):
            with self.subTest(argv=argv[0]):
                done = _subprocess(argv)
                self.assertTrue(done.stderr.startswith(prefix), done.stderr)

    def test_help_reads_gma_at_every_depth(self):
        # Subprocess: Python 3.14 derives prog from -m in-process under pytest.
        for argv, prefix in (
                (["links", "fix", "--help"], "usage: gma links"),
                (["moments", "v", "status", "--help"],
                 "usage: gma moments vault status")):
            with self.subTest(argv=argv):
                done = _subprocess(argv)
                self.assertEqual(done.returncode, 0, done.stderr)
                self.assertTrue(done.stdout.startswith(prefix), done.stdout)

    def test_every_command_help_reads_gma_in_a_subprocess(self):
        for name in gma.COMMANDS:
            if name == "publish":
                continue
            with self.subTest(command=name):
                done = _subprocess([name, "--help"])
                self.assertEqual(done.returncode, 0, done.stderr)
                self.assertTrue(done.stdout.startswith(f"usage: gma {name}"),
                                done.stdout[:80])

    def test_full_tree_usage_reads_gma(self):
        code = ("import gma\n"
                "for n, p in gma._subparsers(gma.full_tree()).choices.items():\n"
                "    print(p.format_usage().splitlines()[0][:40], '|', n)\n")
        done = subprocess.run(
            [sys.executable, "-c", code], cwd=SCRIPTS, capture_output=True,
            text=True, encoding="utf-8", env=CHILD_ENV)
        self.assertEqual(done.returncode, 0, done.stderr)
        rows = [l.split(" | ") for l in done.stdout.splitlines()]
        self.assertEqual(len(rows), len(gma.COMMANDS))
        for usage, name in rows:
            self.assertTrue(usage.startswith(f"usage: gma {name}"), usage)

    def test_error_usage_reads_gma(self):
        done = _subprocess(["links", "fix", "--bogus"])
        self.assertEqual(done.returncode, 2)
        self.assertTrue(done.stderr.startswith("usage: gma links"), done.stderr)

    def test_option_value_help_is_not_intercepted(self):
        done = _subprocess(["links", "v", "--as", "-h"])
        self.assertNotIn("show this help message", done.stdout)

    def test_argv0_restored_even_on_system_exit(self):
        before = sys.argv[0]
        _run(["links", "fix", "--bogus"])
        _run(["links", "--help"])
        self.assertEqual(sys.argv[0], before)

    def test_missing_node_exits_1(self):
        import unittest.mock as mock
        with mock.patch("os.execvp", side_effect=FileNotFoundError), \
                mock.patch.object(gma.subprocess, "Popen",
                                  side_effect=FileNotFoundError):
            code, _, err = _run(["publish", "doctor"])
        self.assertEqual(code, 1)
        self.assertIn("needs node", err)


class WindowsJobTests(unittest.TestCase):
    """#609: on Windows gma stays up as node's parent, so stopping gma must
    end node too. Nothing here ran on Windows: the Win32 calls are faked, and
    only the order of the calls and the structure's layout are checked."""

    def fake_kernel32(self, job=77, set_ok=1, assign_ok=1):
        k = mock.MagicMock()
        k.CreateJobObjectW.return_value = job
        k.SetInformationJobObject.return_value = set_ok
        k.AssignProcessToJobObject.return_value = assign_ok
        return k

    def test_the_limit_structure_has_the_size_windows_gives_it(self):
        import ctypes
        limits = gma._job_limit_type()
        if ctypes.sizeof(ctypes.c_void_p) == 8:
            self.assertEqual(ctypes.sizeof(limits), 144)   # winnt.h, x64
            self.assertEqual(ctypes.sizeof(limits._fields_[0][1]), 64)
        else:
            self.assertEqual(ctypes.sizeof(limits), 112)   # winnt.h, x86

    def test_the_child_goes_in_a_job_that_kills_it_when_it_closes(self):
        import ctypes
        k = self.fake_kernel32()
        with mock.patch.object(ctypes, "WinDLL", create=True, return_value=k):
            self.assertEqual(gma._kill_on_close_job(1234), 77)
        (job, kind, ref, size), _ = k.SetInformationJobObject.call_args
        self.assertEqual((job, kind), (77, 9))   # JobObjectExtendedLimitInformation
        limits = ref._obj
        self.assertEqual(limits.BasicLimitInformation.LimitFlags, 0x2000)
        self.assertEqual(size, ctypes.sizeof(limits))
        k.AssignProcessToJobObject.assert_called_once_with(77, 1234)
        k.CloseHandle.assert_not_called()   # gma holds the job while node runs

    def test_a_job_windows_refuses_is_closed_and_the_child_runs_untied(self):
        import ctypes
        for kwargs in ({"job": 0}, {"set_ok": 0}, {"assign_ok": 0}):
            k = self.fake_kernel32(**kwargs)
            with mock.patch.object(ctypes, "WinDLL", create=True, return_value=k):
                self.assertIsNone(gma._kill_on_close_job(1234), kwargs)
            if kwargs.get("job") != 0:
                k.CloseHandle.assert_called_once_with(77)

    def test_node_runs_in_the_job_until_it_ends_and_the_job_then_closes(self):
        proc = mock.MagicMock(_handle=1234)
        proc.wait.return_value = 3
        seen = []
        with mock.patch.object(gma.subprocess, "Popen", return_value=proc) as popen, \
                mock.patch.object(gma, "_kill_on_close_job", side_effect=lambda h: seen.append(("job", h)) or 77), \
                mock.patch.object(gma, "_close_job", side_effect=lambda j: seen.append(("close", j))):
            proc.wait.side_effect = lambda: seen.append(("wait",)) or 3
            self.assertEqual(gma._call_tied_to_gma(["node", "t.js"]), 3)
        popen.assert_called_once_with(["node", "t.js"])
        self.assertEqual(seen, [("job", 1234), ("wait",), ("close", 77)])

    def test_a_job_that_cannot_be_made_still_runs_node(self):
        proc = mock.MagicMock(_handle=1234)
        proc.wait.return_value = 0
        for refusal in ({"side_effect": OSError("no")}, {"return_value": None}):
            with mock.patch.object(gma.subprocess, "Popen", return_value=proc), \
                    mock.patch.object(gma, "_kill_on_close_job", **refusal), \
                    mock.patch.object(gma, "_close_job") as close:
                self.assertEqual(gma._call_tied_to_gma(["node"]), 0)
            close.assert_not_called()

    def test_an_interrupt_of_gma_ends_node_and_closes_the_job(self):
        proc = mock.MagicMock(_handle=1234)
        proc.wait.side_effect = [KeyboardInterrupt, 0]
        with mock.patch.object(gma.subprocess, "Popen", return_value=proc), \
                mock.patch.object(gma, "_kill_on_close_job", return_value=77), \
                mock.patch.object(gma, "_close_job") as close:
            with self.assertRaises(KeyboardInterrupt):
                gma._call_tied_to_gma(["node"])
        proc.kill.assert_called_once_with()
        close.assert_called_once_with(77)

    def test_the_windows_path_goes_through_it_and_posix_still_execs(self):
        tool = Path("t.js")   # made before os.name is patched (3.10 Path reads it)
        with mock.patch.object(gma.os, "name", "nt"), \
                mock.patch.object(gma, "_call_tied_to_gma", return_value=0) as run:
            self.assertEqual(gma._run_tool(tool, ["doctor"]), 0)
        run.assert_called_once_with(["node", "t.js", "doctor"])
        with mock.patch.object(gma.os, "name", "posix"), \
                mock.patch("os.execvp") as ex:
            gma._run_tool(tool, ["doctor"])
        ex.assert_called_once_with("node", ["node", "t.js", "doctor"])


if __name__ == "__main__":
    unittest.main()
