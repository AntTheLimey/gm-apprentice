"""gma doctor: one line per check, what to do about each, and an exit status
that holds only for what the skills cannot run without."""

import json
import os
import subprocess
import sys
import tempfile
import unittest
import unittest.mock
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "skills" / "shared" / "scripts"))

import doctor  # noqa: E402
from install_layout import Layout  # noqa: E402


def _install(root: Path, *, version="1.2.3", publish="1.70.1", tool=None, home=".claude") -> Layout:
    """A plugin install under `root`/<home>/plugins: shared stamps, and a publish tool beside the
    skills at version `tool` (none when None)."""
    plugin = root / home / "plugins" / "cache" / "gm-apprentice" / "1.2.3"
    shared = plugin / "skills" / "shared"
    shared.mkdir(parents=True)
    if version is not None:
        (shared / "VERSION").write_text(version + "\n")
    if publish is not None:
        (shared / "PUBLISH_VERSION").write_text(publish + "\n")
    (plugin / ".claude-plugin").mkdir()
    (plugin / ".claude-plugin" / "plugin.json").write_text("{}")
    path = None
    if tool is not None:
        path = plugin / "tools" / "publish" / "bin" / "gm-publish.js"
        path.parent.mkdir(parents=True)
        path.write_text("")
        (plugin / "tools" / "publish" / "package.json").write_text(json.dumps({"version": tool}))
    return Layout(shared, plugin, path, path is not None)


def _run(layout, *, python=(3, 12, 1), node="/usr/bin/node", old=None, said="22.21.0"):
    return doctor.checks(layout, python=python, which=lambda name: node,
                         node_too_old=lambda n: old, node_version=lambda n: said)


class DoctorTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_a_whole_plugin_install_is_ready(self):
        found = _run(_install(self.root, tool="1.70.1"))
        self.assertEqual([c.level for c in found], ["ok"] * 4)
        self.assertIn("gm-apprentice 1.2.3, the Claude Code plugin", found[1].what)
        self.assertEqual(found[2].what, "Node 22.21.0")
        self.assertIn("the publish tool 1.70.1", found[3].what)
        self.assertEqual(doctor.report(found), ("".join(f"ok  {c.what}\n" for c in found) + "Ready.\n", 0))

    def test_the_codex_plugin_is_named(self):
        layout = _install(self.root, tool="1.70.1", home=".codex")
        (layout.root / ".git").write_text("gitdir: elsewhere\n")  # Codex copies it with the plugin
        self.assertIn("the Codex plugin", _run(layout)[1].what)

    def test_a_checkout_is_named(self):
        shared = self.root / "work" / "skills" / "shared"
        shared.mkdir(parents=True)
        (shared / "VERSION").write_text("1.2.3\n")
        (self.root / "work" / ".git").mkdir()
        found = _run(Layout(shared, self.root / "work", None))
        self.assertIn("a checkout of the repository", found[1].what)

    def test_an_agent_folder_moved_by_its_variable_is_named(self):
        layout = _install(self.root, tool="1.70.1", home="elsewhere")
        with unittest.mock.patch.dict(os.environ, {"CLAUDE_CONFIG_DIR": str(self.root / "elsewhere")}):
            self.assertIn("the Claude Code plugin", _run(layout)[1].what)
        with unittest.mock.patch.dict(os.environ, {"CODEX_HOME": str(self.root / "elsewhere")}, clear=False):
            os.environ.pop("CLAUDE_CONFIG_DIR", None)
            self.assertIn("the Codex plugin", _run(layout)[1].what)

    def test_no_node_only_warns(self):
        found = _run(_install(self.root, tool="1.70.1"), node=None)
        self.assertEqual([c.level for c in found], ["ok", "ok", "warn", "ok"])
        self.assertIn("needed only for a campaign site", found[2].fix)
        text, code = doctor.report(found)
        self.assertEqual(code, 0)
        self.assertTrue(text.endswith("Ready, with 1 warning.\n"))

    def test_an_old_node_warns_with_the_floor(self):
        found = _run(_install(self.root, tool="1.70.1"), old="v20.11.0")
        self.assertEqual(found[2].level, "warn")
        self.assertIn("v20.11.0", found[2].what)
        self.assertIn("22.21", found[2].fix)

    def test_a_node_that_does_not_say_its_version_warns(self):
        found = _run(_install(self.root, tool="1.70.1"), said=None)
        self.assertEqual(found[2].level, "warn")
        self.assertIn("did not answer", found[2].what)

    def test_a_tool_with_no_stamp_or_no_readable_version_fails(self):
        found = _run(_install(self.root, publish=None, tool="1.70.1"))
        self.assertEqual(found[3].level, "fail")
        self.assertIn("PUBLISH_VERSION", found[3].what)
        layout = _install(self.root / "b", tool="1.70.1")
        (layout.root / "tools" / "publish" / "package.json").write_text("not json")
        found = _run(layout)
        self.assertEqual(found[3].level, "fail")
        self.assertIn("no readable version", found[3].what)

    def test_an_old_python_fails(self):
        found = _run(_install(self.root, tool="1.70.1"), python=(3, 9, 6))
        self.assertEqual(found[0].level, "fail")
        text, code = doctor.report(found)
        self.assertEqual(code, 1)
        self.assertTrue(text.endswith("Not ready: 1 to fix first.\n"))

    def test_a_missing_version_stamp_fails(self):
        found = _run(_install(self.root, version=None, tool="1.70.1"))
        self.assertEqual(found[1].level, "fail")
        self.assertIn("install gm-apprentice again", found[1].fix)

    def test_a_tool_from_another_release_fails(self):
        found = _run(_install(self.root, tool="1.69.0"))
        self.assertEqual(found[3].level, "fail")
        self.assertIn("1.69.0", found[3].what)
        self.assertIn("1.70.1", found[3].what)

    def test_an_npx_install_without_the_tool_yet_warns_and_says_how(self):
        shared = self.root / ".agents" / "skills" / "shared"
        shared.mkdir(parents=True)
        (shared / "VERSION").write_text("1.2.3\n")
        (shared / "PUBLISH_VERSION").write_text("1.70.1\n")
        found = _run(Layout(shared, None, None))
        self.assertIn("installed with npx skills", found[1].what)
        self.assertEqual(found[3].level, "warn")
        self.assertIn("1.70.1 is not downloaded yet", found[3].what)
        self.assertIn("tool install", found[3].fix)
        self.assertEqual(doctor.report(found)[1], 0)

    def test_it_runs_through_gma_and_changes_nothing(self):
        done = subprocess.run([sys.executable, str(REPO / "skills" / "shared" / "scripts" / "gma.py"), "doctor"],
                              capture_output=True, text=True)
        self.assertIn(done.returncode, (0, 1), done.stderr)
        self.assertRegex(done.stdout, r"(?m)^ok\s+Python ")
        self.assertRegex(done.stdout, r"(?m)^(Ready|Not ready)")
        self.assertEqual(done.stderr, "")


class InstallPromptTests(unittest.TestCase):
    """The README's one-line prompt fetches INSTALL.md, whose steps install what the hand-install sections do."""

    def setUp(self):
        text = (REPO / "README.md").read_text(encoding="utf-8")
        start, end = text.index("<!-- install-prompt: begin -->"), text.index("<!-- install-prompt: end -->")
        self.line = " ".join(text[start:end].split())
        self.manual = text[end:]
        self.steps = " ".join((REPO / "INSTALL.md").read_text(encoding="utf-8").split())

    def test_the_line_fetches_install_md_from_main_with_curl(self):
        # curl, not a fetch tool that hands the page to a model to summarise: the commands must arrive exact.
        self.assertIn("https://raw.githubusercontent.com/AntTheLimey/gm-apprentice/main/INSTALL.md", self.line)
        self.assertIn("with curl", self.line)

    def test_its_commands_are_the_hand_install_commands(self):
        for line in ("marketplace add AntTheLimey/gm-apprentice", "codex plugin add gm-apprentice@gm-apprentice",
                     "skills add AntTheLimey/gm-apprentice --all -g"):
            self.assertIn(line, self.steps)
            self.assertIn(line, self.manual)
        # Claude Code's hand install is slash commands at its prompt; the agent runs the same from a shell.
        self.assertIn("/plugin install gm-apprentice", self.manual)
        self.assertIn("claude plugin install gm-apprentice@gm-apprentice", self.steps)

    def test_an_older_install_is_brought_up_to_the_latest_release(self):
        # #814: "already installed" left 1.12.96 in place, which has no doctor.
        for line in ("claude plugin marketplace update gm-apprentice", "claude plugin update gm-apprentice@gm-apprentice",
                     "codex plugin marketplace upgrade gm-apprentice"):
            self.assertIn(line, self.steps)
        self.assertIn("codex plugin marketplace upgrade gm-apprentice", self.manual)
        self.assertIn("unknown command 'doctor'", self.steps)
        # The update lines follow the install lines, so a new install runs them too.
        self.assertLess(self.steps.index("claude plugin install"), self.steps.index("claude plugin update"))
        self.assertLess(self.steps.index("marketplace upgrade"), self.steps.index("codex plugin add"))

    def test_it_checks_with_doctor_and_the_floors_match(self):
        self.assertIn("skills/shared/scripts/gma.py", self.steps)
        self.assertIn('python3 "<that path>" doctor', self.steps)
        self.assertIn("older than 3.10", self.steps)
        self.assertEqual(doctor.PYTHON_FLOOR, (3, 10))
        self.assertIn(f"older than {doctor.tool_cache.NODE_FLOOR}", self.steps)

if __name__ == "__main__":
    unittest.main()
