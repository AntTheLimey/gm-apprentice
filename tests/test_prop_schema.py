#!/usr/bin/env python3
"""The `prop` note type: known to the schema, checked, templated, indexed."""

from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import index_build as ib  # noqa: E402
import migrate_vault  # noqa: E402
import schema_rules as sr  # noqa: E402


def vault_with(*notes: tuple[str, str]) -> Path:
    vault = Path(tempfile.mkdtemp(prefix="prop-schema-"))
    for rel, text in notes:
        path = vault / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    return vault


def prop_note(kind: str) -> tuple[str, str]:
    return ("Documents/Invitation.md",
            f"---\nname: Invitation\ntype: prop\ncanon_status: DRAFT\n"
            f"prop_kind: {kind}\n---\n\n# Invitation\n")


class PropSchemaTests(unittest.TestCase):
    def test_prop_is_a_known_type(self):
        result = subprocess.run(
            [sys.executable, str(SCRIPTS / "schema_rules.py"), "show", "prop"],
            capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        for field in ("prop_kind", "prop_file", "prop_address"):
            self.assertIn(field, result.stdout)

    def _validate(self, kind: str) -> str:
        return self._validate_vault(vault_with(prop_note(kind)))

    def _validate_vault(self, vault: Path) -> str:
        result = subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "validate_schema.py"), str(vault)],
            capture_output=True, text=True)
        return result.stdout + result.stderr

    def test_prop_kind_checked(self):
        self.assertIn("prop_kind", self._validate("scroll"))
        self.assertNotIn("prop_kind", self._validate("container"))

    def test_show_sealed_values(self):
        for value in ("titles", "none"):
            self.assertNotIn("show_sealed", self._validate_text(f"show_sealed: {value}\n"))
        self.assertIn("show_sealed", self._validate_text("show_sealed: all\n"))

    def _validate_text(self, extra: str) -> str:
        vault = vault_with(("Documents/Shelf.md",
                            "---\nname: Shelf\ntype: prop\ncanon_status: DRAFT\n"
                            f"prop_kind: container\n{extra}---\n\n# Shelf\n"))
        return self._validate_vault(vault)

    def test_template_lists_3b_fields(self):
        text = (ROOT / "skills" / "shared" / "templates" / "prop.md").read_text(encoding="utf-8")
        front = text.split("---")[1]
        keys = [line.split(":")[0] for line in front.splitlines() if line and not line.startswith(" ")]
        at = keys.index("prop_address")
        self.assertEqual(keys[at + 1:at + 6],
                         ["prop_style", "prop_line", "prop_group", "prop_container", "show_sealed"])

    def test_prop_template_named(self):
        self.assertEqual(sr.TEMPLATE_NAMES["prop.md"], "_Template_Prop.md")
        self.assertIn("_Template_Prop.md", migrate_vault.templates_for(None))

    def test_index_build_props_section(self):
        vault = vault_with(
            prop_note("object"),
            ("Documents/Letter.md",
             "---\nname: Letter\ntype: document\ncanon_status: DRAFT\n---\n\n# Letter\n"))
        text = ib.render(vault, today="2026-10-25", previous=None)
        self.assertIn("## Props", text)
        self.assertLess(text.index("## Documents"), text.index("## Props"))


if __name__ == "__main__":
    unittest.main()
