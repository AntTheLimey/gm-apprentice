#!/usr/bin/env python3
"""graph_check.py: unresolved links, skipped folders, links quoted in code."""

import shutil
import subprocess
import sys
import tempfile
import unicodedata
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "skills" / "shared" / "scripts"))

import graph_check  # noqa: E402
import vaultlib  # noqa: E402

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

    def test_hidden_folders_are_not_walked_for_attachments(self):
        from unittest import mock
        import graph_check
        vault = vault_of(self, {"A.md": "x\n", ".git/objects/pic.png": "x",
                                "_inbox/q.png": "x", "img/ok.png": "x"})
        walked = []
        real = graph_check.os.walk

        def spy(top, *a, **k):
            for root, dirs, files in real(top, *a, **k):
                walked.append(Path(root).name)
                yield root, dirs, files
        with mock.patch.object(graph_check.os, "walk", spy):
            found = graph_check.attachment_names(vault)
        self.assertEqual(found, {"ok.png"})
        self.assertNotIn(".git", walked)
        self.assertNotIn("objects", walked)


class UncheckedSourceTests(unittest.TestCase):
    def test_links_from_qa_reports_and_archives_are_not_checked(self):
        vault = vault_of(self, {
            "A.md": "[[Gone]]\n",
            "_QA/Report.md": "[[Gone]] [[Old Name]]\n",
            "_archive/design/Draft.md": "[[Dropped]]\n"})
        self.assertEqual(run(vault), ["# count: 1", "gone  <- A.md"])

    def test_a_note_in_an_archive_is_still_a_target(self):
        vault = vault_of(self, {
            "A.md": "[[Draft]] [[Report]]\n",
            "_archive/Draft.md": "x\n", "_QA/Report.md": "x\n"})
        self.assertEqual(run(vault)[0], "# count: 0")

    def test_only_a_top_level_folder_is_unchecked(self):
        self.assertTrue(vaultlib.is_unchecked_source("_QA/R.md"))
        self.assertTrue(vaultlib.is_unchecked_source("_archive/a/b.md"))
        self.assertFalse(vaultlib.is_unchecked_source("Chapters/_QA/R.md"))
        self.assertFalse(vaultlib.is_unchecked_source("_QA.md"))


class SpellingTests(unittest.TestCase):
    def test_link_name_keeps_the_spelling(self):
        cases = {
            "Bara_Bazaar": "Bara_Bazaar",
            "Dir/Bara Bazaar.md|B": "Bara Bazaar",
            "Judo#Rules": "Judo",
            "Note\\|N": "Note",
            " Eid al-Fitr ^b1": "Eid al-Fitr",
        }
        for raw, want in cases.items():
            with self.subTest(raw=raw):
                self.assertEqual(vaultlib.link_name(raw), want)
                self.assertEqual(vaultlib.link_target(raw),
                                 vaultlib.normalize(want))

    def test_broken_gives_each_source_its_spelling(self):
        vault = vault_of(self, {
            "Real.md": "x\n",
            "A.md": "[[Bara_Bazaar]] [[Real]] [[bara bazaar|shown]]\n",
            "_QA/R.md": "[[BARA BAZAAR]]\n"})
        _notes, names, _outbound, spellings = graph_check.collect(vault, [])
        self.assertEqual(graph_check.broken(vault, names, spellings), {
            "bara bazaar": {"A.md": "Bara_Bazaar", "_QA/R.md": "BARA BAZAAR"}})


class FrontmatterOnlyTests(unittest.TestCase):
    def test_backticked_link_in_a_frontmatter_only_note_is_a_link(self):
        vault = vault_of(self, {"A.md": '---\nrel: "`[[Gone]]`"\n---\n'})
        self.assertEqual(run(vault)[0], "# count: 1")
        self.assertIn("gone", run(vault)[1])

    def test_same_link_in_a_note_with_a_body_is_a_link_too(self):
        vault = vault_of(self, {"A.md": '---\nrel: "`[[Gone]]`"\n---\nx\n'})
        self.assertEqual(run(vault)[0], "# count: 1")
        self.assertIn("gone", run(vault)[1])


if __name__ == "__main__":
    unittest.main()
