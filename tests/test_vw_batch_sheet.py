#!/usr/bin/env python3
"""vault-write batch: the `sheet` block writes a PC's vitals (#749)."""

import shutil
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

from test_vault_write import make_vault, read  # noqa: E402
from test_vw_batch import batch  # noqa: E402

import vaultlib  # noqa: E402

FIXTURE = (Path(__file__).resolve().parent.parent / "tools" / "publish"
           / "test" / "fixtures" / "with-dnd-pc" / "Characters" / "PCs"
           / "Brannoch_Vale.md")
# Brannoc after session 2 on Snowbound: 34 of 44, no Hit Die spent.
BRANNOC = (FIXTURE.read_text(encoding="utf-8").replace("\r\n", "\n")
           .replace("| HP (Current) | 38 |", "| HP (Current) | 34 |")
           .replace("| Hit Dice (Spent/Max) | 1/5 |",
                    "| Hit Dice (Spent/Max) | 0/5 |"))
PC = "Characters/PCs/Brannoc.md"
SETTINGS = "vault:\n  system: dnd-5e-2024\n"
LINE = "✓ Brannoc — HP (Current) 34→41, Hit Dice (Spent/Max) 0/5→1/5"


def row_of(text, label):
    return next(ln for ln in text.splitlines() if ln.startswith(f"| {label}"))


@unittest.skipUnless(shutil.which("node") and vaultlib.PUBLISH_TOOL
                     and vaultlib.PUBLISH_TOOL.is_file(),
                     "needs node and the publish tool")
class SheetBlock(unittest.TestCase):
    def vault(self, note=BRANNOC):
        return make_vault(self, {PC: note,
                                 "_meta/vault-config.yaml": SETTINGS})

    def test_preview_shows_the_tools_lines_and_writes_nothing(self):
        vault = self.vault()
        code, out = batch(vault, f"=== sheet {PC} hp=41 hit-dice=1/5\n")
        self.assertEqual(code, 0, out)
        self.assertIn(f"## 1 sheet {PC}\nWOULD-SET\t{PC}\t\t{LINE}\n", out)
        self.assertIn("set: 1", out)
        self.assertIn("# plan only: nothing written", out)
        self.assertEqual(read(vault, PC), BRANNOC)

    def test_write_puts_41_and_1_of_5_on_the_sheet(self):
        vault = self.vault()
        code, out = batch(vault, f"=== sheet {PC} hp=41 hit-dice=1/5\n",
                          "--write")
        self.assertEqual(code, 0, out)
        self.assertIn(f"SET\t{PC}\t\t{LINE}", out)
        text = read(vault, PC)
        self.assertIn("| 41 |", row_of(text, "HP (Current)"))
        self.assertIn("| 44 |", row_of(text, "HP (Max)"))
        self.assertIn("| 1/5 |", row_of(text, "Hit Dice"))

    def test_it_sets_the_note_as_earlier_blocks_left_it(self):
        # The Current Status prose and the sheet in one batch: both land.
        vault = self.vault()
        text = (f'=== section {PC} "Current Status" --replace\n'
                f"**Location:** On the road north.\n"
                f"**Condition:** 41 of 44 hit points after a Hit Die.\n"
                f"=== sheet Brannoc hp=41 hit-dice=1/5\n")
        code, out = batch(vault, text, "--write")
        self.assertEqual(code, 0, out)
        note = read(vault, PC)
        self.assertIn("**Condition:** 41 of 44 hit points after a Hit Die.",
                      note)
        self.assertNotIn("Unhurt.", note)
        self.assertIn("| 41 |", row_of(note, "HP (Current)"))

    def test_a_row_the_sheet_lacks_is_a_warning(self):
        vault = self.vault(BRANNOC.replace("| Temp HP | 0 |\n", ""))
        code, out = batch(vault, f"=== sheet {PC} temp=3 hp=41\n", "--write")
        self.assertEqual(code, 0, out)
        self.assertIn(f"WARNING\t{PC}\t\t⚠ Brannoc — no writable Temp HP row "
                      f"on this sheet: temp left alone", out)
        self.assertIn("| 41 |", row_of(read(vault, PC), "HP (Current)"))

    def test_an_unknown_key_refuses_the_batch(self):
        vault = self.vault()
        text = (f"=== sheet {PC} hp=41 stamina=2\n"
                f'=== section {PC} "Stat Sheet" --append\nA note.\n')
        code, out = batch(vault, text, "--write")
        self.assertEqual(code, 1)
        self.assertIn('unknown key "stamina". Keys for this sheet: hp, temp',
                      out)
        self.assertIn("# nothing written", out)
        self.assertEqual(read(vault, PC), BRANNOC)

    def test_a_flag_or_a_body_is_refused(self):
        vault = self.vault()
        for text, said in (
                (f"=== sheet {PC} hp=41 --write\n", "'--write' is not KEY=VALUE"),
                (f"=== sheet {PC}\n", "at least one KEY=VALUE"),
                (f"=== sheet {PC} hp=41\nsome text\n", "sheet takes no body")):
            code, out = batch(vault, text)
            self.assertEqual(code, 1, text)
            self.assertIn(said, out)

    def test_no_publish_tool_fails_loudly(self):
        vault = self.vault()
        with mock.patch.object(vaultlib, "PUBLISH_TOOL",
                               Path("/no/such/gm-publish.js")):
            code, out = batch(vault, f"=== sheet {PC} hp=41\n", "--write")
        self.assertEqual(code, 1)
        self.assertIn("could not ask the publish tool to set the sheet: the "
                      "publish tool is not at /no/such/gm-publish.js", out)
        self.assertEqual(read(vault, PC), BRANNOC)

    def test_no_node_fails_loudly(self):
        vault = self.vault()
        with mock.patch.object(vaultlib.shutil, "which", return_value=None):
            code, out = batch(vault, f"=== sheet {PC} hp=41\n", "--write")
        self.assertEqual(code, 1)
        self.assertIn("could not ask the publish tool to set the sheet: node "
                      "is not on PATH", out)
        self.assertEqual(read(vault, PC), BRANNOC)


if __name__ == "__main__":
    unittest.main()
