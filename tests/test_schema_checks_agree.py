#!/usr/bin/env python3
"""#431: the vault's check (`vault_check.py frontmatter`) and the repo's
validator (`scripts/validate_schema.py`) give the same answer for every
note, because both ask one function, `schema_rules.frontmatter_findings`.

The one difference left is on purpose: a custom type is INFO to the vault
(a GM may invent types) and an error to the validator, which guards the
repo's own fixtures."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "skills" / "shared" / "scripts"))
sys.path.insert(0, str(ROOT / "scripts"))

import schema_rules as sr  # noqa: E402
import validate_schema  # noqa: E402
import vault_check as vc  # noqa: E402


def both(front: str, settings_yaml: str | None = None
         ) -> tuple[list[tuple[str, str]], list[str]]:
    """(vault_check's rows as (level, message), validate_schema's errors)
    for one note with this frontmatter, in a vault whose settings file
    holds `settings_yaml` (none: the built-in settings)."""
    text = f"---\n{front}\n---\n\nbody\n"
    with tempfile.TemporaryDirectory() as tmp:
        vault = Path(tmp)
        (vault / "Note.md").write_text(text, encoding="utf-8")
        if settings_yaml is not None:
            (vault / "_meta").mkdir()
            (vault / "_meta" / "vault-config.yaml").write_text(
                "version: 1\n" + settings_yaml, encoding="utf-8")
        # No site: the publish tool has nothing to say about parsing.
        rows = vc.check_frontmatter(vault, None, explain=lambda: vc.ToolAnswer())
        errors = validate_schema.validate_file(vault / "Note.md", text, vault)
    found = []
    for row in rows:
        level, rel, message = row.split("\t", 2)
        assert rel == "Note.md", row
        found.append((level, message))
    return found, errors


class ValidatorSurvivesUnreadableSettings(unittest.TestCase):
    def test_a_pc_status_outside_the_schema_words_does_not_crash(self):
        from unittest import mock

        import vaultlib
        front = front_of({**a_valid_note("pc"), "status": "wandering"})
        text = f"---\n{front}\n---\n\nbody\n"
        with tempfile.TemporaryDirectory() as tmp:
            vault = Path(tmp)
            (vault / "Note.md").write_text(text, encoding="utf-8")
            with mock.patch.object(validate_schema, "setting_or_builtin",
                                   side_effect=vaultlib.SettingsUnavailable("no")):
                errors = validate_schema.validate_file(vault / "Note.md", text, vault)
            with mock.patch.object(validate_schema, "setting_or_builtin",
                                   return_value=None):
                validate_schema.validate_file(vault / "Note.md", text, vault)
        self.assertTrue(any("wandering" in e for e in errors), errors)


def a_valid_note(etype: str) -> dict[str, str]:
    allowed = sr.checked_values(etype)
    return {f: (etype if f == "type" else sorted(allowed[f])[0] if f in allowed else "x")
            for f in sr.REQUIRED_FIELDS[etype]}


def front_of(fm: dict[str, str]) -> str:
    return "\n".join(f"{k}: {v}" for k, v in fm.items())


class BothChecksAgree(unittest.TestCase):
    def assertAgree(self, front: str, errors_expected: int,
                    settings_yaml: str | None = None) -> list[str]:
        rows, errors = both(front, settings_yaml)
        vault_errors = [m for level, m in rows if level == "ERROR"]
        self.assertEqual(vault_errors, errors, front)
        self.assertEqual(len(errors), errors_expected, (front, errors))
        return errors

    def test_a_retired_pc_passes(self):
        self.assertIn("retired", sr.checked_values("pc")["status"])
        self.assertAgree("type: pc\ncanon_status: DRAFT\nstatus: retired", 0)

    OUT_OF_PLAY = "vault:\n  statuses:\n    out_of_play: [dead, Ascended]\n"

    def test_a_pc_status_only_in_the_vaults_out_of_play_list_passes(self):
        # A word the GM added for the campaign, read through the publish
        # tool's settings, never a second reading here.
        self.assertAgree("type: pc\ncanon_status: DRAFT\nstatus: ascended", 0,
                         self.OUT_OF_PLAY)
        self.assertAgree("type: pc\ncanon_status: DRAFT\nstatus: Ascended", 0,
                         self.OUT_OF_PLAY)

    def test_a_pc_status_in_neither_list_is_flagged(self):
        errors = self.assertAgree("type: pc\ncanon_status: DRAFT\nstatus: wandering", 1,
                                  self.OUT_OF_PLAY)
        self.assertIn("vault.statuses.out_of_play", errors[0])
        # The built-in list counts when the vault sets none.
        self.assertAgree("type: pc\ncanon_status: DRAFT\nstatus: kia", 0)
        # An NPC's status does not take the setting's words.
        self.assertAgree("type: npc\ncanon_status: DRAFT\nstatus: ascended", 1,
                         self.OUT_OF_PLAY)

    def test_every_checked_value_is_checked_by_both(self):
        # The vault's check used to check canon_status, scene_type and three
        # statuses only; it now reads the same table.
        for etype in sr.known_types():
            for field in sr.checked_values(etype):
                with self.subTest(type=etype, field=field):
                    fm = {**a_valid_note(etype), field: "not-a-value"}
                    self.assertAgree(front_of(fm), 1)

    def test_a_valid_note_of_every_type_is_clean_to_both(self):
        for etype in sr.known_types():
            with self.subTest(type=etype):
                self.assertAgree(front_of(a_valid_note(etype)), 0)

    def test_campaign_overview_status_takes_active_as_in_progress(self):
        overview = "type: campaign_overview\ncanon_status: DRAFT\nstatus: "
        self.assertAgree(overview + "active", 0)
        self.assertAgree(overview + "in_progress", 0)
        errors = self.assertAgree(overview + "ongoing", 1)
        self.assertIn("active = in_progress", errors[0])
        self.assertEqual(sr.VALUE_ALIASES["campaign_overview"]["status"],
                         {"active": "in_progress"})

    def test_show_names_the_alias_and_the_setting(self):
        self.assertIn("status active = in_progress", sr.show("campaign_overview") or "")
        self.assertIn("status may also be a word in vault.statuses.out_of_play",
                      sr.show("pc") or "")

    def test_missing_required_fields(self):
        self.assertAgree("type: scene\ncanon_status: DRAFT", 1)

    def test_an_empty_required_field_is_missing_to_both(self):
        for empty in ('""', "", "[]", "'  '"):
            errors = self.assertAgree(f"type: npc\ncanon_status: {empty}", 1)
            self.assertEqual(errors, ["missing required field 'canon_status' for type 'npc'"])
        # A map indented under a required key is a value, not an empty one.
        session = "type: session\nsession_number: 1\nstatus: planned\ndocuments:"
        self.assertAgree(f'{session}\n  plan: "[[P]]"\n  wrap_up: null', 0)
        self.assertAgree(session, 1)

    def test_superseded_needs_superseded_by_in_both(self):
        self.assertAgree("type: npc\ncanon_status: SUPERSEDED", 1)
        self.assertAgree('type: npc\ncanon_status: SUPERSEDED\nsuperseded_by: "[[B]]"', 0)

    def test_an_empty_value_is_unset_to_both(self):
        # A template's placeholder (`plan_type: ""`) is not a wrong value.
        self.assertAgree('type: npc\ncanon_status: DRAFT\nstatus: ""', 0)
        self.assertAgree("type: npc\ncanon_status: DRAFT\nstatus:", 0)

    def test_a_list_where_one_value_goes_is_an_error_to_both(self):
        self.assertAgree("type: npc\ncanon_status: DRAFT\nstatus: [alive, dead]", 1)

    def test_old_field_names(self):
        self.assertAgree("type: npc\ncanon_status: DRAFT\nconfidence: DRAFT", 1)

    def test_portrait_leads_to_and_withheld(self):
        self.assertAgree("type: npc\ncanon_status: DRAFT\nportrait: pics/a.png", 1)
        self.assertAgree("type: plan\ncanon_status: DRAFT\nplan_type: arc\n"
                         "chapter: x\nleads_to: 7", 1)
        self.assertAgree("type: npc\ncanon_status: DRAFT\nwithheld: maybe", 1)

    def test_missing_or_listed_type(self):
        self.assertAgree("canon_status: DRAFT", 1)
        self.assertAgree("type: [npc]\ncanon_status: DRAFT", 1)

    def test_a_hierarchy_subtype_is_a_schema_type_to_both(self):
        # `type: weapon` sits under item in the ontology and the folder map
        # takes it: not custom to the vault, not unknown to the validator.
        rows, errors = both("type: weapon\ncanon_status: DRAFT")
        self.assertEqual((rows, errors), ([], []))
        self.assertAgree("type: weapon\ncanon_status: PENDING", 1)

    def test_a_custom_type_is_info_to_the_vault_and_unknown_to_the_validator(self):
        rows, errors = both("type: handout\ncanon_status: DRAFT")
        self.assertEqual(rows, [("INFO", "custom type 'handout' (no schema rules applied)")])
        self.assertEqual(len(errors), 1)
        self.assertTrue(errors[0].startswith("Unknown type 'handout'"), errors)
        # canon_status's values still hold on a custom one, in the vault.
        rows, _errors = both("type: handout\ncanon_status: PENDING")
        self.assertIn("ERROR", [level for level, _m in rows])
        # superseded_by does not: on the GM's vaults 8 of 13 superseded
        # notes are custom reference notes replaced by several others.
        rows, _errors = both("type: reference\ncanon_status: SUPERSEDED")
        self.assertEqual([level for level, _m in rows], ["INFO"])

    def test_an_abstract_type_is_not_a_note_type(self):
        self.assertFalse(sr.is_schema_type("character"))
        self.assertTrue(sr.is_schema_type("weapon"))
        self.assertTrue(sr.is_schema_type("npc"))
        self.assertFalse(sr.is_schema_type("handout"))


class NoSecondCopy(unittest.TestCase):
    def test_vault_check_keeps_no_value_table_of_its_own(self):
        for name in ("ENUM_CHECKS", "STATUS_BY_TYPE"):
            self.assertFalse(hasattr(vc, name), name)


if __name__ == "__main__":
    unittest.main()
