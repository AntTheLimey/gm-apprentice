#!/usr/bin/env python3
"""`companion: true` (#566): an NPC who travels with the party.

An optional NPC flag. Absent means false. The site's Story pages never
picture a companion, as they never picture a PC; its names still count as
a PC's do (a shorter name inside one is not a mention). This pins the
Python side: `validate_schema.py` accepts it and names a value that is not
true or false, the NPC template carries it, and the schema docs say what
it does.
"""

import importlib.util
import os
import pathlib
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent

SPEC = importlib.util.spec_from_file_location(
    "validate_schema", ROOT / "scripts" / "validate_schema.py")
vs = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(vs)


def companion_errors(line: str) -> list[str]:
    fm = "type: npc\ncanon_status: DRAFT"
    if line:
        fm += "\n" + line
    fd, name = tempfile.mkstemp(suffix=".md")
    os.close(fd)
    path = pathlib.Path(name)
    path.write_text(f"---\n{fm}\n---\n\nbody\n")
    try:
        return [e for e in vs.validate_file(path) if "companion" in e]
    finally:
        path.unlink(missing_ok=True)


class CompanionValidationTests(unittest.TestCase):
    def test_absent_true_and_false_are_valid(self):
        for line in ("", "companion: true", "companion: false", "companion: True"):
            with self.subTest(line=line):
                self.assertEqual(companion_errors(line), [])

    def test_a_value_that_is_not_true_or_false_is_named(self):
        for line in ("companion: maybe", "companion: 2", "companion: [a]"):
            with self.subTest(line=line):
                errors = companion_errors(line)
                self.assertEqual(len(errors), 1, errors)
                self.assertIn("true or false", errors[0])


class CompanionDocsTests(unittest.TestCase):
    def test_the_npc_template_carries_the_flag_off(self):
        text = (ROOT / "skills" / "shared" / "templates" / "npc.md").read_text(encoding="utf-8")
        self.assertRegex(text, r"\ncompanion: false +# ")

    def test_the_schema_docs_say_what_it_does(self):
        for rel in ("skills/shared/entity-schema.md",
                    "skills/publish-site/references/schema-reference.md"):
            with self.subTest(doc=rel):
                self.assertIn("`companion`", (ROOT / rel).read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
