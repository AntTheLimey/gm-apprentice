"""gen_field_lists.py: the per-type field lists are written from the
templates, and a vault holding the old entry text is offered the new."""

import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SCRIPTS = REPO / "skills" / "shared" / "scripts"
sys.path.insert(0, str(REPO / "scripts"))
sys.path.insert(0, str(SCRIPTS))
import gen_field_lists as gen  # noqa: E402
import migrate_vault as mv  # noqa: E402
import vault_scaffold as vs  # noqa: E402
import schema_rules as rules  # noqa: E402
from migrate_core import CHOICE  # noqa: E402


class Generated(unittest.TestCase):
    def test_every_region_is_current(self):
        for path, text in gen.outputs().items():
            self.assertEqual(path.read_text(encoding="utf-8"), text,
                             f"{path} is stale: run scripts/gen_field_lists.py")

    def test_check_mode_exits_zero_when_current(self):
        done = subprocess.run([sys.executable, str(REPO / "scripts/gen_field_lists.py"),
                               "--check"], capture_output=True, text=True)
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)

    def test_check_mode_names_a_stale_region(self):
        schema = (REPO / "skills/shared/entity-schema.md").read_text(encoding="utf-8")
        reference = (REPO / "skills/publish-site/references/schema-reference.md").read_text(
            encoding="utf-8")
        for path, name, text in (
                (gen.SCHEMA, "fields", schema.replace("`doc_type`", "`document_type`", 1)),
                (gen.REFERENCE, "fields-event",
                 reference.replace("`in_game_date`", "`date`", 1))):
            wanted = gen.outputs()[path]
            self.assertNotEqual(text, wanted)
            self.assertEqual(gen.stale_regions(path, text, wanted), [name])

    def test_the_drift_the_issue_named_is_fixed(self):
        schema = (REPO / "skills/shared/entity-schema.md").read_text(encoding="utf-8")
        reference = (REPO / "skills/publish-site/references/schema-reference.md").read_text(
            encoding="utf-8")
        self.assertNotIn("date_written` | Optional", reference)
        self.assertIn("`doc_type`", reference)
        self.assertIn("`in_game_date`", reference)
        for field in rules.template_fields("document") + rules.template_fields("event"):
            if field not in gen.NOT_LISTED:
                self.assertIn(f"`{field}`", schema)

    def test_every_template_field_is_listed_for_every_type(self):
        text = gen.outputs()[gen.SCHEMA]
        for entry in gen.SCHEMA_ENTRIES:
            line = next(ln for ln in text.split("\n\n") if f"**{entry.label}:**" in ln)
            # From the templates themselves, not from the generator's own list,
            # so a field the generator drops is caught.
            for t in entry.types:
                for field in rules.template_fields(t):
                    if field in gen.NOT_LISTED and field not in entry.keep:
                        continue
                    self.assertIn(f"`{field}`", line, f"{entry.label} lacks {field}")

    # A template type with no generated list must be named here, with why.
    NOT_IN_SCHEMA = {
        "chapter": "the narrative hierarchy section describes it",
        "scene": "the scene section and its own template describe it",
        "session": "the session document chain describes it",
        "session-plan": "the session document chain describes it",
        "session-wrap-up": "an older name of session_wrap",
        "session-wrapup": "an older name of session_wrap",
        "session_wrap": "the session document chain describes it",
    }
    NOT_IN_REFERENCE = {
        "campaign_overview": "its fields are prose in the Campaign Overview section",
        "character-story": "it renders inside its PC's page",
        "plan": "plans never publish",
        "prop": "props have their own reference (prop-styles)",
        "scene": "scenes publish through Story pages",
        "session-plan": "plans never publish",
        "session-wrap-up": "an older name of session_wrap",
        "session-wrapup": "an older name of session_wrap",
        "session_wrap": "wrap-ups fold into Story pages",
        "world_flags": "world flags never publish",
    }

    def test_every_template_type_has_a_list_or_a_named_reason(self):
        templated = {t for t in rules.known_types() if rules.template_sources(t)}
        in_schema = {t for e in gen.SCHEMA_ENTRIES for t in e.types}
        in_reference = {t for e in gen.REFERENCE_ENTRIES.values() for t in e.types}
        self.assertEqual(sorted(templated - in_schema), sorted(self.NOT_IN_SCHEMA),
                         "a template type has no entity-schema list and no reason here")
        self.assertEqual(sorted(templated - in_reference), sorted(self.NOT_IN_REFERENCE),
                         "a template type has no schema-reference list and no reason here")

    def test_a_hand_note_never_names_a_field_the_template_has(self):
        """`also` is for what only the site reads; a field the template
        carries is listed from the template (a note on it is fine)."""
        for entry in gen.SCHEMA_ENTRIES:
            have = {f for t in entry.types for f in rules.template_fields(t)}
            for field, _ in entry.also:
                self.assertNotIn(field, have, f"{entry.label}: {field} is in the template")
            listed = set(gen.entry_fields(entry)) | {f for f, _ in entry.also}
            for field in entry.notes:
                self.assertIn(field, listed, f"{entry.label}: note on unlisted {field}")

    def test_no_generated_text_makes_a_link(self):
        for path in (gen.SCHEMA, gen.REFERENCE):
            for name, body in gen.blocks_for(path).items():
                self.assertNotIn("[[", body, name)

    def test_a_new_vault_holds_the_entries_and_none_are_stale(self):
        vault = Path(tempfile.mkdtemp(prefix="fl-"))
        self.addCleanup(shutil.rmtree, vault, ignore_errors=True)
        (vault / "_meta").mkdir()
        (vault / "_meta" / "entity-types.md").write_text(vs.entity_types_text(), encoding="utf-8")
        self.assertNotIn("generated:", vs.entity_types_text())
        self.assertEqual(mv.find_schema_mirror(vault), [])


OLD_EVENT = ("**Event:** `event_type` (battle, ritual, etc.), `in_game_date` (in-game),\n"
             "`location` (wiki-link), `participants` (wiki-links), `outcome`")
OLD_DOCUMENT = ("**Document:** `doc_type` (letter, journal, map, etc.), `author`,\n"
                "`date` (when written), `condition`, `current_holder` (wiki-link).\n"
                "The text goes in the body under `## The Text`; an older `content`\n"
                "field moves there")


class VaultMirror(unittest.TestCase):
    def vault_with(self, entries):
        vault = Path(tempfile.mkdtemp(prefix="fl-"))
        self.addCleanup(shutil.rmtree, vault, ignore_errors=True)
        (vault / "_meta").mkdir()
        (vault / "_meta" / "vault-config.md").write_text(
            '---\ngm_apprentice_version: "1.10.12"\n---\n', encoding="utf-8")
        body = "\n\n".join(entries.values())
        (vault / "_meta" / "entity-types.md").write_text(
            f"# Types\n\n## Type-Specific Fields\n\n{body}\n", encoding="utf-8")
        return vault

    def test_a_vault_holding_the_old_text_is_offered_the_new(self):
        entries = dict(mv.type_entries((SCRIPTS.parent / "entity-schema.md").read_text(
            encoding="utf-8")))
        entries["Event"], entries["Document"] = OLD_EVENT, OLD_DOCUMENT
        vault = self.vault_with(entries)
        (item,) = mv.find_schema_mirror(vault)
        self.assertEqual(item.group, CHOICE)
        self.assertEqual(sorted(item.lines), [
            "update the Document entry in _meta/entity-types.md (your edits inside "
            "that entry are replaced)",
            "update the Event entry in _meta/entity-types.md (your edits inside "
            "that entry are replaced)"])
        item.apply(None)
        self.assertEqual(mv.find_schema_mirror(vault), [])

    def test_an_entry_the_gm_edited_is_still_a_question(self):
        entries = dict(mv.type_entries((SCRIPTS.parent / "entity-schema.md").read_text(
            encoding="utf-8")))
        entries["Event"] = OLD_EVENT + "\n(my own note: dates are in the Calendar)"
        vault = self.vault_with(entries)
        (item,) = mv.find_schema_mirror(vault)
        self.assertEqual(item.group, CHOICE)
        self.assertEqual(len(item.lines), 1)
        self.assertIn("your edits inside that entry are replaced", item.lines[0])


if __name__ == "__main__":
    unittest.main()
