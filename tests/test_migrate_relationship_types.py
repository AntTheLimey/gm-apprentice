"""A vault's relationship-types list that names fewer types than the
vocabulary: the update offers to add the missing ones."""
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parent.parent / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))
import migrate_vault as mv  # noqa: E402
import vault_scaffold as vs  # noqa: E402
from migrate_core import CHOICE, StepFailed, plugin_tool  # noqa: E402

FILE = "_meta/relationship-types.md"
TABLE = ("# Relationship Types\n\nMy notes stay.\n\n"
         "| Category | Types |\n|---|---|\n"
         "| Kinship | parent_of, sibling_of |\n"
         "| Social | knows |\n\n## Inverses\n\nkept\n")


def vault_with(case, text):
    vault = Path(tempfile.mkdtemp(prefix="migrt-"))
    case.addCleanup(shutil.rmtree, vault, ignore_errors=True)
    (vault / "_meta").mkdir()
    if text is not None:
        (vault / FILE).write_bytes(text.encode("utf-8"))
    return vault


def read(vault):
    return (vault / FILE).read_bytes().decode("utf-8")


def words(vault=None):
    args = ["relationships", "words", "--json"]
    if vault is not None:
        args += ["--vault", str(vault)]
    code, out, err = plugin_tool(args)
    assert code == 0, err
    return json.loads(out)


def named(vault):
    return {p["type"] for p in words(vault)["predicates"]}


class RelationshipTypesMissingTests(unittest.TestCase):
    def test_a_full_list_gets_no_offer(self):
        vault = vault_with(self, vs.relationship_types_text())
        self.assertEqual(mv.find_relationship_types_missing(vault), [])

    def test_no_file_gets_no_offer(self):
        self.assertEqual(
            mv.find_relationship_types_missing(vault_with(self, None)), [])

    def test_a_subset_table_is_offered_the_missing_types_by_name(self):
        vault = vault_with(self, TABLE)
        (item,) = mv.find_relationship_types_missing(vault)
        self.assertEqual((item.id, item.group), ("relationship-types-missing", CHOICE))
        total = len(words()["predicates"])
        line = " ".join(item.lines)
        self.assertIn(f"names 3 of the {total}", line)
        self.assertIn("answer no if the list is a deliberate genre subset", line)
        for t in {p["type"] for p in words()["predicates"]} - {
                "parent_of", "sibling_of", "knows"}:
            self.assertIn(t, line)
        self.assertNotIn("is missing parent_of", line)

    def test_applying_adds_each_type_to_its_own_row_and_the_list_is_full(self):
        vault = vault_with(self, TABLE)
        (item,) = mv.find_relationship_types_missing(vault)
        item.apply(None)
        text = read(vault)
        every = {p["type"]: p["category"] for p in words()["predicates"]}
        self.assertEqual(named(vault), set(every))
        lines = text.splitlines()
        row = next(ln for ln in lines if ln.startswith("| Kinship"))
        self.assertTrue(row.startswith("| Kinship | parent_of, sibling_of, "), row)
        for t, cat in every.items():
            if cat == "kinship":
                self.assertIn(t, row)
        # other bytes untouched, categories not in the table got rows
        self.assertTrue(text.startswith("# Relationship Types\n\nMy notes stay.\n\n"))
        self.assertTrue(text.endswith("## Inverses\n\nkept\n"))
        self.assertIn("| Power |", text)
        self.assertEqual(mv.find_relationship_types_missing(vault), [])

    def test_a_scaffold_written_list_with_a_genre_column_keeps_it(self):
        # the scaffold's file, trimmed by hand: one Social type gone from
        # its row, and the Inverses and Symmetric sections (which name
        # every type again) cut
        text = vs.relationship_types_text().split("## Inverses")[0]
        lines = text.splitlines(keepends=True)
        i = next(k for k, ln in enumerate(lines) if ln.startswith("| Social"))
        cells = lines[i].split("|")
        cells[2] = cells[2].replace(" friend_of,", "", 1)
        lines[i] = "|".join(cells)
        vault = vault_with(self, "".join(lines))
        (item,) = mv.find_relationship_types_missing(vault)
        self.assertIn("friend_of", " ".join(item.lines))
        item.apply(None)
        row = next(ln for ln in read(vault).splitlines() if ln.startswith("| Social"))
        self.assertIn("friend_of", row)
        self.assertEqual(row.count("|"), lines[i].count("|"))
        self.assertEqual(mv.find_relationship_types_missing(vault), [])

    def test_crlf_survives(self):
        vault = vault_with(self, TABLE.replace("\n", "\r\n"))
        (item,) = mv.find_relationship_types_missing(vault)
        item.apply(None)
        text = read(vault)
        self.assertNotIn("\n", text.replace("\r\n", ""))
        self.assertEqual(named(vault), {p["type"] for p in words()["predicates"]})

    def test_a_bullet_file_gets_the_appended_section(self):
        original = "# My types\n\n- knows\n- parent_of\n- sibling_of\n"
        vault = vault_with(self, original)
        (item,) = mv.find_relationship_types_missing(vault)
        item.apply(None)
        text = read(vault)
        self.assertTrue(text.startswith(original + "\n## Added by the update (1.10.66)\n\n- "))
        self.assertEqual(named(vault), {p["type"] for p in words()["predicates"]})

    def test_a_list_without_a_final_newline_gets_the_section(self):
        original = "- knows\n- parent_of\n- sibling_of"
        vault = vault_with(self, original)
        (item,) = mv.find_relationship_types_missing(vault)
        item.apply(None)
        text = read(vault)
        self.assertTrue(text.startswith(original + "\n\n## Added by the update (1.10.66)\n\n- "))
        self.assertIn("\n- rules\n", text)

    def test_no_node_gives_no_offer_and_no_crash(self):
        vault = vault_with(self, TABLE)
        with mock.patch("migrate_core.shutil.which", return_value=None):
            with self.assertRaises(StepFailed):
                plugin_tool(["relationships", "words"])
            self.assertEqual(mv.find_relationship_types_missing(vault), [])

    def test_a_tool_that_fails_gives_no_offer(self):
        vault = vault_with(self, TABLE)
        with mock.patch.object(mv, "plugin_tool", return_value=(1, "", "boom")):
            self.assertEqual(mv.find_relationship_types_missing(vault), [])
        with mock.patch.object(mv, "plugin_tool", return_value=(0, "nope", "")):
            self.assertEqual(mv.find_relationship_types_missing(vault), [])


if __name__ == "__main__":
    unittest.main()
