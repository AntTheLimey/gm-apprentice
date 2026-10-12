#!/usr/bin/env python3
"""`withheld: true` (#291): a note's own name is a secret.

An optional frontmatter flag. Absent means false. The site build searches the
published site for a withheld note's file name, title and aliases. This pins
the Python side: the flag is read the way `gm_only` is, `validate_schema.py`
accepts it and names a value that is not true or false, and the templates that
carry `gm_aliases` carry the flag beside it.
"""

import importlib.util
import json
import os
import pathlib
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

VECTORS = ROOT / "tools" / "publish" / "test" / "fixtures" / "gm-only-vectors.json"
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


class WithheldFlagTests(unittest.TestCase):
    def test_is_withheld_reads_the_flag_as_gm_only_does(self):
        for case in json.loads(VECTORS.read_text(encoding="utf-8"))["cases"]:
            with self.subTest(value=case["value"]):
                self.assertEqual(vl.is_withheld({"withheld": case["value"]}),
                                 case["hides"])

    def test_absent_or_no_frontmatter_is_not_withheld(self):
        self.assertFalse(vl.is_withheld({}))
        self.assertFalse(vl.is_withheld(None))

    def test_the_frontmatter_parser_yields_a_string_and_it_still_reads(self):
        fm = vl.extract_frontmatter("---\ntype: npc\nwithheld: true\n---\n\nb\n")
        self.assertTrue(vl.is_withheld(fm))


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
        self.assertIn("withheld: false", text)


if __name__ == "__main__":
    unittest.main()
