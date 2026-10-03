#!/usr/bin/env python3
"""graph_check.py: unresolved links, skipped folders, links quoted in code."""

import shutil
import subprocess
import sys
import tempfile
import unicodedata
import unittest
from pathlib import Path

SCRIPT = (Path(__file__).resolve().parent.parent / "skills" / "shared"
          / "scripts" / "graph_check.py")


def vault_of(case, files):
    vault = Path(tempfile.mkdtemp(prefix="graphcheck-"))
    case.addCleanup(shutil.rmtree, vault, ignore_errors=True)
    for rel, text in files.items():
        path = vault / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(text.encode("utf-8"))
    return vault


def run(vault, command="unresolved"):
    out = subprocess.run([sys.executable, str(SCRIPT), str(vault), command],
                         capture_output=True, text=True, check=True).stdout
    return out.splitlines()


class UnresolvedTests(unittest.TestCase):
    def test_escaped_pipe_in_a_table_resolves(self):
        vault = vault_of(self, {
            "Note.md": "# Note\n",
            "T.md": "| a | b |\n|---|---|\n| x | [[Note\\|N]] |\n"})
        self.assertEqual(run(vault)[0], "# count: 0")

    def test_templates_and_inbox_are_skipped(self):
        vault = vault_of(self, {
            "A.md": "x\n", "_Templates/T.md": "[[Missing]]\n",
            "_templates/U.md": "[[Missing2]]\n", "_inbox/I.md": "[[Missing3]]\n",
            ".hidden/H.md": "[[Missing4]]\n"})
        self.assertEqual(run(vault)[0], "# count: 0")
        self.assertEqual(run(vault, "orphans"), ["# count: 1", "A.md"])

    def test_links_quoted_in_code_are_not_links(self):
        vault = vault_of(self, {
            "A.md": ("see `[[InlineMissing]]` and ``[[Double]]``\n"
                     "```\n[[FencedMissing]]\n```\n"
                     "[[RealMissing]]\n")})
        rows = run(vault)
        self.assertEqual(rows[0], "# count: 1")
        self.assertTrue(rows[1].startswith("realmissing"))

    def test_frontmatter_links_still_count(self):
        vault = vault_of(self, {
            "A.md": '---\nlocation: "[[Gone]]"\n---\nbody\n'})
        self.assertEqual(run(vault)[0], "# count: 1")

    def test_nfd_filename_linked_in_nfc_resolves(self):
        nfc = unicodedata.normalize("NFC", "Opeyemi Tichá")
        nfd = unicodedata.normalize("NFD", nfc)
        vault = vault_of(self, {nfd + ".md": "x\n",
                                "A.md": f"[[{nfc}]]\n"})
        self.assertEqual(run(vault)[0], "# count: 0")

    def test_a_link_to_an_existing_attachment_resolves(self):
        nfc = unicodedata.normalize("NFC", "Tich\u00e1.png")
        vault = vault_of(self, {
            "A.md": ("![[Map.PNG]] ![[maps/plan.pdf|300]] [[Sheet.pdf]] "
                     f"![[{nfc}]]\n"),
            "_attachments/map.png": "x", "docs/Plan.pdf": "x",
            "Sheet.pdf": "x",
            unicodedata.normalize("NFD", nfc): "x"})
        self.assertEqual(run(vault)[0], "# count: 0")

    def test_a_link_to_a_missing_attachment_is_reported(self):
        vault = vault_of(self, {
            "A.md": "![[gone.png]] [[Real]]\n", "Real.md": "x\n",
            "_Templates/t.png": "x", ".hid/gone.png": "x"})
        rows = run(vault)
        self.assertEqual(rows[0], "# count: 1")
        self.assertTrue(rows[1].startswith("gone.png"))


if __name__ == "__main__":
    unittest.main()
