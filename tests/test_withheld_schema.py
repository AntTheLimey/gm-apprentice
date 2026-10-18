#!/usr/bin/env python3
"""`withheld: true` (#291): a note's own name is a secret.

An optional frontmatter flag. Absent means false. The site build searches the
published site for a withheld note's file name, title and aliases. This pins
the Python side: the flag is the publish tool's answer, `validate_schema.py`
accepts it and names a value that is not true or false, and the templates that
carry `gm_aliases` carry the flag beside it.
"""

import importlib.util
import os
import pathlib
import shutil
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "skills" / "shared" / "scripts"))

import vaultlib as vl  # noqa: E402

SPEC = importlib.util.spec_from_file_location(
    "validate_schema", ROOT / "scripts" / "validate_schema.py")
vs = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(vs)

TEMPLATES = ROOT / "skills" / "shared" / "templates"


def withheld_errors(line: str) -> list[str]:
    fm = "type: npc\ncanon_status: DRAFT"
    if line:
        fm += "\n" + line
    fd, name = tempfile.mkstemp(suffix=".md")
    os.close(fd)
    path = pathlib.Path(name)
    path.write_text(f"---\n{fm}\n---\n\nbody\n")
    try:
        return [e for e in vs.validate_file(path) if "withheld" in e]
    finally:
        path.unlink(missing_ok=True)


@unittest.skipUnless(shutil.which("node"), "node is not on PATH")
class WithheldFlagTests(unittest.TestCase):
    """The flag is the publish tool's answer (`note_withheld`, #352): read
    with the build's YAML reader and its flag rule, never a second way."""

    def test_the_flag_reads_as_the_build_reads_it(self):
        for value, withheld in (("true", True), ("yes", True), ("1", True),
                                ("0x1", True), ("1e0", True), ("1.0", True),
                                ('"0x1"', False), ("false", False),
                                ("2", False), ("maybe", False)):
            with self.subTest(value=value):
                got, _ = vl.note_withheld(f"---\ntype: npc\nwithheld: {value}\n---\n\nb\n")
                self.assertEqual(got, withheld)

    def test_a_note_without_the_key_is_not_asked_about(self):
        self.assertEqual(vl.note_withheld("---\ntype: npc\n---\n\nwithheld: true\n"), (False, []))
        self.assertEqual(vl.note_withheld("no frontmatter\n"), (False, []))

    def test_the_names_are_the_builds(self):
        self.assertEqual(vl.note_withheld(
            "---\nwithheld : true\ntitle: The Ferryman\naliases: Old Nick\n"
            "gm_aliases: [Vesper]\n---\n"), (True, ["The Ferryman", "Old Nick", "Vesper"]))


class WithheldValidationTests(unittest.TestCase):
    def test_absent_true_and_false_are_valid(self):
        for line in ("", "withheld: true", "withheld: false", "withheld: True"):
            with self.subTest(line=line):
                self.assertEqual(withheld_errors(line), [])

    def test_a_value_that_is_not_true_or_false_is_named(self):
        for line in ("withheld: maybe", "withheld: 2", "withheld: [a]"):
            with self.subTest(line=line):
                errors = withheld_errors(line)
                self.assertEqual(len(errors), 1, errors)
                self.assertIn("true or false", errors[0])

    def test_a_forgiving_yes_does_not_crash(self):
        # The build reads yes, on and 1 as true; the validator asks for the real word.
        for line in ("withheld: yes", 'withheld: "1"', "withheld: 1"):
            with self.subTest(line=line):
                self.assertEqual(len(withheld_errors(line)), 1)


class WithheldTemplateTests(unittest.TestCase):
    def test_every_template_with_gm_aliases_carries_the_flag_beside_it(self):
        carrying = [p for p in sorted(TEMPLATES.glob("*.md"))
                    if "\ngm_aliases:" in p.read_text(encoding="utf-8")]
        self.assertGreaterEqual(len(carrying), 5)
        for path in carrying:
            with self.subTest(template=path.name):
                lines = path.read_text(encoding="utf-8").splitlines()
                at = next(i for i, l in enumerate(lines) if l.startswith("gm_aliases:"))
                self.assertTrue(lines[at + 1].startswith("withheld:"), lines[at + 1])

    def test_entity_schema_documents_the_flag(self):
        text = (ROOT / "skills" / "shared" / "entity-schema.md").read_text(encoding="utf-8")
        self.assertIn("`withheld`", text)
        self.assertIn("Write `true` or `false`", text)


if __name__ == "__main__":
    unittest.main()
