"""gma: one entry point dispatching to the vault scripts."""

import argparse
import contextlib
import io
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

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


def _subprocess(argv):
    return subprocess.run(
        [sys.executable, str(SCRIPTS / "gma.py"), *argv],
        capture_output=True, text=True, encoding="utf-8")


class GmaTests(unittest.TestCase):
    def test_dispatch_returns_the_scripts_exit_status(self):
        vault = Path(tempfile.mkdtemp(prefix="gma-vault-"))
        self.addCleanup(shutil.rmtree, vault, True)
        with contextlib.redirect_stdout(io.StringIO()):
            expected = vault_check.main([str(vault), "version"])
        code, _, _ = _run(["vault-check", str(vault), "version"])
        self.assertEqual(code, expected)

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
        self.assertEqual(gma.main(["publish", "doctor"]), 7)

    def test_full_tree_has_every_command(self):
        tree = gma.full_tree()
        names = set()
        for action in tree._actions:
            if isinstance(action, argparse._SubParsersAction):
                names |= set(action.choices)
        self.assertEqual(names, set(gma.COMMANDS))
        self.assertEqual(len(names), 29)

    def test_a_command_imports_only_its_own_module(self):
        vault = Path(tempfile.mkdtemp(prefix="gma-vault-"))
        self.addCleanup(shutil.rmtree, vault, True)
        sys.modules.pop("dnd_ddb", None)
        _run(["vault-check", str(vault), "version"])
        self.assertNotIn("dnd_ddb", sys.modules)

    def test_nested_usage_reads_gma(self):
        tree = gma.full_tree()
        links = gma._subparsers(tree).choices["links"]
        self.assertTrue(links.format_usage().startswith("usage: gma links"))
        nested = [a for a in links._actions
                  if isinstance(a, argparse._SubParsersAction)]
        for action in nested:
            for child in action.choices.values():
                self.assertTrue(
                    child.format_usage().startswith("usage: gma links"),
                    child.format_usage())
        done = _subprocess(["links", "fix", "--help"])
        self.assertEqual(done.returncode, 0)
        self.assertTrue(done.stdout.startswith("usage: gma links"), done.stdout)

    def test_help_three_deep_in_the_full_tree(self):
        moments = gma._subparsers(gma.full_tree()).choices["moments"]
        depth = [a for a in moments._actions
                 if isinstance(a, argparse._SubParsersAction)][0]
        status = depth.choices["status"]
        self.assertTrue(
            status.format_usage().startswith("usage: gma moments vault status"),
            status.format_usage())

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
        with mock.patch("subprocess.call", side_effect=FileNotFoundError):
            code, _, err = _run(["publish", "doctor"])
        self.assertEqual(code, 1)
        self.assertIn("needs node", err)


if __name__ == "__main__":
    unittest.main()
