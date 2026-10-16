"""The retired Required Relationships section: the update offers to remove it."""
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))
import migrate_vault as mv  # noqa: E402
from migrate_core import CHOICE  # noqa: E402

ONE_LINER = ("`npc`, `pc`, `creature` → `located_at`; "
             "`faction`, `organization` → `headquartered_at`.")
TABLE = ("| Entity Type | Required Relationship |\n"
         "|-------------|----------------------|\n"
         "| `npc` | `located_at` |\n"
         "| `heritage` | — (none required) |\n")


def vault_with(case, text, raw=False):
    vault = Path(tempfile.mkdtemp(prefix="migreq-"))
    case.addCleanup(shutil.rmtree, vault, ignore_errors=True)
    (vault / "_meta").mkdir()
    if text is not None:
        data = text.encode("utf-8")
        (vault / "_meta" / "entity-types.md").write_bytes(data)
    return vault


def read(vault):
    return (vault / "_meta" / "entity-types.md").read_bytes().decode("utf-8")


class RequiredTiesSectionTests(unittest.TestCase):
    def test_the_stock_line_is_one_choice_and_comes_out(self):
        text = ("# Types\n\n## Required Relationships\n\n" + ONE_LINER
                + "\n\n## Universal Fields\n\nkept\n")
        vault = vault_with(self, text)
        (item,) = mv.find_required_ties_section(vault)
        self.assertEqual((item.id, item.group), ("required-ties-section", CHOICE))
        self.assertIn("Required Relationships", " ".join(item.lines))
        self.assertIn(ONE_LINER, " ".join(item.lines))
        item.apply(None)
        self.assertEqual(read(vault), "# Types\n\n## Universal Fields\n\nkept\n")
        self.assertEqual(mv.find_required_ties_section(vault), [])

    def test_the_old_table_is_stock_too(self):
        text = f"## Required Relationships\n\n{TABLE}\n## Default Folder Mapping\n\nx\n"
        vault = vault_with(self, text)
        (item,) = mv.find_required_ties_section(vault)
        self.assertNotIn("your own lines", " ".join(item.lines))

    def test_crlf_and_every_other_byte_survive(self):
        text = ("# Types\r\n\r\n## Required Relationships\r\n\r\n" + ONE_LINER
                + "\r\n\r\n## Universal Fields\r\n\r\nkept\r\n")
        vault = vault_with(self, text)
        (item,) = mv.find_required_ties_section(vault)
        item.apply(None)
        self.assertEqual(read(vault),
                         "# Types\r\n\r\n## Universal Fields\r\n\r\nkept\r\n")

    def test_a_section_at_the_end_of_the_file_comes_out(self):
        vault = vault_with(self, f"# Types\n\n## Required Relationships\n\n{ONE_LINER}\n")
        (item,) = mv.find_required_ties_section(vault)
        item.apply(None)
        self.assertEqual(read(vault), "# Types\n\n")

    def test_a_heading_of_the_first_level_after_the_section_stays(self):
        text = (f"# Types\n\n## Required Relationships\n\n{ONE_LINER}\n\n"
                "### Aside\n\nsub\n\n# Notes\n\nmine\n")
        vault = vault_with(self, text)
        (item,) = mv.find_required_ties_section(vault)
        self.assertNotIn("mine", " ".join(item.lines))
        item.apply(None)
        self.assertEqual(read(vault), "# Types\n\n# Notes\n\nmine\n")

    def test_your_own_lines_are_named_in_the_offer(self):
        text = (f"## Required Relationships\n\n{ONE_LINER}\n"
                "Every shrine needs a `patron`.\n\n## Universal Fields\n\nkept\n")
        vault = vault_with(self, text)
        (item,) = mv.find_required_ties_section(vault)
        joined = "\n".join(item.lines)
        self.assertIn("your own lines in it go too", joined)
        self.assertIn("Every shrine needs a `patron`.", joined)
        self.assertNotIn("kept", joined)
        item.apply(None)
        self.assertEqual(read(vault), "## Universal Fields\n\nkept\n")

    def test_no_section_or_no_file_plans_nothing(self):
        self.assertEqual(mv.find_required_ties_section(
            vault_with(self, "## Universal Fields\n\nx\n")), [])
        self.assertEqual(mv.find_required_ties_section(vault_with(self, None)), [])

    def test_the_check_is_registered(self):
        ids = [c.name for c in mv.VAULT_CHECKS]
        self.assertIn("required-ties-section", ids)
        self.assertEqual(ids.index("required-ties-section"),
                         ids.index("schema-mirror") + 1)


if __name__ == "__main__":
    unittest.main()
