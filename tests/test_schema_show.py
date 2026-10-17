#!/usr/bin/env python3
"""`schema_rules.py show`: what it prints, and that it agrees with the
validator (scripts/validate_schema.py) for every type, so neither can
drift from the other. It replaces the required-fields block that
`shared/entity-schema.md` used to carry (issue #221's drift test)."""

from __future__ import annotations

import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))
sys.path.insert(0, str(ROOT / "scripts"))

import schema_rules as sr  # noqa: E402
import validate_schema  # noqa: E402


def shown(etype: str) -> dict[str, str]:
    """`show <type>`'s lines, by label."""
    text = sr.show(etype)
    assert text is not None, etype
    out: dict[str, str] = {}
    for line in text.splitlines()[1:]:
        label, _, rest = line.partition(": ")
        out[label] = rest
    return out


def shown_values(etype: str, label: str = "values (checked)") -> dict[str, set[str]]:
    out: dict[str, set[str]] = {}
    for part in shown(etype).get(label, "").split("; "):
        if part:
            field, _, values = part.partition(" ")
            out[field] = set(values.split("|"))
    return out


def errors_for(fm: dict[str, object]) -> list[str]:
    lines = ["---"]
    for key, value in fm.items():
        lines.append(f"{key}: {value}")
    lines.append("---")
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "note.md"
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        return validate_schema.validate_file(path)


def a_valid_note(etype: str) -> dict[str, object]:
    """The type's required fields, each with a value the validator takes."""
    allowed = sr.checked_values(etype)
    return {f: (etype if f == "type" else sorted(allowed[f])[0] if f in allowed
                else "x")
            for f in sr.REQUIRED_FIELDS[etype]}


class ShowAgreesWithTheValidator(unittest.TestCase):
    def test_every_type_shows(self):
        self.assertEqual(sr.known_types(), sorted(sr.REQUIRED_FIELDS))
        for etype in sr.known_types():
            with self.subTest(type=etype):
                self.assertIsNotNone(sr.show(etype))

    def test_required_fields_match_what_the_validator_requires(self):
        for etype in sr.known_types():
            with self.subTest(type=etype):
                required = shown(etype)["required"].split(", ")
                self.assertEqual(required, sr.REQUIRED_FIELDS[etype])
                self.assertEqual(errors_for(a_valid_note(etype)), [])
                for field in required:
                    if field == "type":
                        continue
                    fm = a_valid_note(etype)
                    del fm[field]
                    self.assertIn(f"Missing required field '{field}' for type '{etype}'",
                                  errors_for(fm))

    def test_checked_values_are_exactly_what_the_validator_accepts(self):
        for etype in sr.known_types():
            for field, values in shown_values(etype).items():
                with self.subTest(type=etype, field=field):
                    for value in values:
                        fm = {**a_valid_note(etype), field: value}
                        if value == "SUPERSEDED":
                            fm["superseded_by"] = '"[[Other]]"'
                        self.assertEqual(errors_for(fm), [], value)
                    bad = errors_for({**a_valid_note(etype), field: "not-a-value"})
                    self.assertEqual(len(bad), 1, bad)
                    listed = re.search(r"must be one of: (.+)$", bad[0]).group(1)
                    self.assertEqual(set(listed.split(", ")), values)

    def test_no_field_is_checked_that_show_leaves_out(self):
        for etype in sr.known_types():
            with self.subTest(type=etype):
                self.assertEqual(shown_values(etype),
                                 {f: set(v) for f, v in sr.checked_values(etype).items()})

    def test_recommended_fields_are_never_required(self):
        # Issue #221: the old doc required these on every type.
        for etype, fields in sr.REQUIRED_FIELDS.items():
            for field in sr.RECOMMENDED_FIELDS:
                self.assertNotIn(field, fields, (etype, field))


class ShowReadsTheTemplates(unittest.TestCase):
    def test_every_template_name_is_a_template(self):
        for src in sr.TEMPLATE_NAMES:
            self.assertTrue((sr.TEMPLATES_DIR / src).is_file(), src)

    def test_optional_fields_come_from_the_template(self):
        npc = shown("npc")
        self.assertEqual(npc["template"], "_Templates/_Template_NPC.md")
        self.assertEqual(npc["folder"], "Characters/NPCs")
        for field in ("occupation", "status", "location", "portrait", "relationships"):
            self.assertIn(field, npc["optional"].split(", "))
        self.assertNotIn("canon_status", npc["optional"].split(", "))
        self.assertNotIn("aliases", npc["optional"].split(", "))

    def test_pc_templates_by_system(self):
        pc = shown("pc")
        self.assertIn("_Templates/pc-{system}.md (", pc["template"])
        self.assertIn("generic", pc["template"])
        self.assertIn("dndbeyond", pc["optional"])

    def test_listed_values_name_fields_the_type_takes(self):
        self.assertIn("stage", shown("session")["optional"].split(", "))
        self.assertEqual(shown_values("faction", "values (listed, not checked)")["status"],
                         set(sr.FACTION_STATUS))

    def test_relationships(self):
        self.assertEqual(shown("session")["relationships"], "never a relationship target")
        self.assertIn("tone one of 27 listed", shown("npc")["relationships"])
        self.assertEqual(shown("location")["fields that stand for an edge"],
                         "parent_location (part_of)")

    def test_older_names_and_subtypes(self):
        self.assertIn("write pc_roster", sr.show("player-characters") or "")
        self.assertIn("write session_wrap", sr.show("session-wrapup") or "")
        self.assertIn("abstract", sr.show("character") or "")
        self.assertIn("no rules of its own", sr.show("weapon") or "")
        self.assertIsNone(sr.show("no-such-type"))


class Cli(unittest.TestCase):
    def run_cli(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run([sys.executable, str(SCRIPTS / "schema_rules.py"), *args],
                              capture_output=True, text=True, check=False)

    def test_show_one_type(self):
        done = self.run_cli("show", "npc")
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertTrue(done.stdout.startswith("npc — kind of: character"))

    def test_show_lists_the_types(self):
        done = self.run_cli("show")
        self.assertEqual(done.returncode, 0)
        self.assertIn(" npc ", done.stdout)

    def test_unknown_type(self):
        done = self.run_cli("show", "nope")
        self.assertEqual(done.returncode, 1)
        self.assertIn("no type 'nope'", done.stderr)


if __name__ == "__main__":
    unittest.main()
