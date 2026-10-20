#!/usr/bin/env python3
"""A vault kept by a player (`vault.kept_by: player`): the GM's own checks say
so and stop (gm-leak, stale-drafts, read-aloud, sessions, wrapup), alone and
under `all`; on a vault kept by the GM they run as before; with Node missing
the built-in `gm` is used; and a `build` that asks for a GM site on such a
vault stops with the fault and writes nothing.

Run: python3 tests/test_vault_check_kept_by.py
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "skills" / "shared" / "scripts" / "vault_check.py"
BIN = ROOT / "tools" / "publish" / "bin" / "gm-publish.js"
NEEDS_NODE = unittest.skipUnless(shutil.which("node"), "needs node")

CHECKS = ("gm-leak", "stale-drafts", "read-aloud", "sessions", "wrapup")


def row(name):
    return (f"INFO\t(vault)\tthis vault is kept by a player (vault.kept_by: "
            f"player); the {name} check is for the GM's own notes and was skipped")


def make(case, kept_by, extra=""):
    root = Path(tempfile.mkdtemp(prefix="vc-keptby-"))
    case.addCleanup(shutil.rmtree, root, ignore_errors=True)
    vault = root / "vault"
    (vault / "_meta").mkdir(parents=True)
    (vault / "_meta" / "vault-config.yaml").write_text(
        f"version: 1\nvault:\n  kept_by: {kept_by}\n{extra}", encoding="utf-8")
    (vault / "NPCs").mkdir()
    (vault / "NPCs" / "Mara.md").write_text(
        "---\ntype: npc\ncanon_status: DRAFT\n---\n\n# Mara\n\nShe waits.\n",
        encoding="utf-8")
    return vault


def run(vault, command, env=None):
    return subprocess.run([sys.executable, str(SCRIPT), str(vault), command],
                          capture_output=True, text=True, env=env)


def section(out, label):
    """The rows under `## label`, up to the next section."""
    lines = out.splitlines()
    start = lines.index(f"## {label}")
    rows = []
    for line in lines[start + 2:]:
        if line.startswith("## "):
            break
        rows.append(line)
    return rows


@NEEDS_NODE
class KeptByPlayerTests(unittest.TestCase):
    def test_a_check_run_alone_prints_exactly_the_one_row(self):
        # One check through the command line; `all` below covers the other
        # four, which share the same gate.
        vault = make(self, "player")
        r = run(vault, "gm-leak")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(section(r.stdout, "gm-leak"), [row("gm-leak")])
        self.assertIn("# count: 1", r.stdout)

    def test_all_gives_the_one_row_for_each_of_the_five(self):
        vault = make(self, "player")
        r = run(vault, "all")
        self.assertEqual(r.returncode, 0, r.stderr)
        for name in CHECKS:
            with self.subTest(check=name):
                self.assertEqual(section(r.stdout, name), [row(name)])
        # The checks that are not the GM's own still run.
        self.assertIn("## frontmatter", r.stdout)

    def test_kept_by_gm_runs_the_checks_as_before(self):
        vault = make(self, "gm")
        r = run(vault, "all")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertNotIn("kept by a player", r.stdout)
        for name in CHECKS:
            with self.subTest(check=name):
                self.assertIn(f"## {name}", r.stdout)

    def test_without_node_the_built_in_gm_is_used(self):
        vault = make(self, "player")
        env = dict(os.environ, PATH=os.devnull)
        r = subprocess.run([sys.executable, str(SCRIPT), str(vault), "sessions"],
                           capture_output=True, text=True, env=env)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertNotIn("kept by a player", r.stdout)
        self.assertIn("## sessions", r.stdout)


@NEEDS_NODE
class BuildOnAKeptByPlayerVaultTests(unittest.TestCase):
    def test_build_asking_for_a_gm_site_stops_with_the_fault_and_writes_nothing(self):
        root = Path(tempfile.mkdtemp(prefix="vc-keptby-build-"))
        self.addCleanup(shutil.rmtree, root, ignore_errors=True)
        vault, site = root / "vault", root / "site"
        (vault / "_meta").mkdir(parents=True)
        site.mkdir()
        (vault / "_meta" / "vault-config.yaml").write_text(
            "version: 1\nvault:\n  kept_by: player\ngm_site:\n  publish: on\n",
            encoding="utf-8")
        (site / "vault.config.json").write_text(
            json.dumps({"vaultPath": "../vault"}), encoding="utf-8")
        r = subprocess.run(["node", str(BIN), "build"], capture_output=True,
                           text=True, cwd=site)
        self.assertNotEqual(r.returncode, 0, r.stdout)
        self.assertIn("vault.kept_by", r.stdout + r.stderr)
        self.assertEqual(sorted(p.name for p in site.iterdir()), ["vault.config.json"])
        self.assertEqual(sorted(p.name for p in root.iterdir()), ["site", "vault"])


if __name__ == "__main__":
    unittest.main()
