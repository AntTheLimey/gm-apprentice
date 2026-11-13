#!/usr/bin/env python3
"""`vault_check.py npc-pairs`: one character with an NPC note and a PC note
(#445). Matches by name whatever the case, spaces, underscores and
punctuation, or by a PC alias; different people, archived copies and
merged notes give no row. Each row names the merge to run.

Run: python3 -m pytest tests/test_vault_check_npc_pairs.py
"""

import shutil
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "skills" / "shared" / "scripts"))

import vault_check as vc  # noqa: E402

NPC = "---\ntype: npc\n{extra}---\n"
PC = "---\ntype: pc\n{extra}---\n"


def make(case, notes):
    root = Path(tempfile.mkdtemp(prefix="vc-npc-pairs-"))
    case.addCleanup(shutil.rmtree, root, ignore_errors=True)
    for rel, text in notes.items():
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")
    return root


class NpcPairTests(unittest.TestCase):
    def test_exact_name(self):
        v = make(self, {"Characters/NPCs/Mira Vale.md": NPC.format(extra=""),
                        "Characters/PCs/Mira Vale.md": PC.format(extra="")})
        self.assertEqual(vc.check_npc_pairs(v), [
            "ASK\tCharacters/NPCs/Mira Vale.md <> Characters/PCs/Mira Vale.md"
            "\tan NPC note and a PC note of one name: merge with gma "
            "vault-write <vault> npc-merge \"Characters/NPCs/Mira Vale.md\" "
            "\"Characters/PCs/Mira Vale.md\""])

    def test_underscores_case_and_punctuation(self):
        v = make(self, {"Characters/NPCs/john_smith.md": NPC.format(extra=""),
                        "Characters/PCs/John Smith.md": PC.format(extra=""),
                        "NPCs/Dr. O'Hara.md": NPC.format(extra=""),
                        "PCs/Dr OHara.md": PC.format(extra="")})
        rows = vc.check_npc_pairs(v)
        self.assertEqual(len(rows), 2, rows)
        self.assertTrue(any("john_smith.md <> Characters/PCs/John Smith.md"
                            in r for r in rows))
        self.assertTrue(any("Dr. O'Hara.md <> PCs/Dr OHara.md" in r
                            for r in rows))

    def test_pc_alias_names_the_npc(self):
        v = make(self, {"Characters/NPCs/Bob.md": NPC.format(extra=""),
                        "Characters/PCs/Robert Hale.md":
                            PC.format(extra="aliases: [Bob]\n")})
        rows = vc.check_npc_pairs(v)
        self.assertEqual(len(rows), 1)
        self.assertIn("a PC whose alias is this NPC's name", rows[0])
        self.assertIn('npc-merge "Characters/NPCs/Bob.md" '
                      '"Characters/PCs/Robert Hale.md"', rows[0])

    def test_npc_alias_names_the_pc(self):
        v = make(self, {"Characters/NPCs/The Stranger.md":
                            NPC.format(extra="aliases: [Robert Hale]\n"),
                        "Characters/PCs/Robert Hale.md": PC.format(extra="")})
        rows = vc.check_npc_pairs(v)
        self.assertEqual(len(rows), 1)
        self.assertIn("an NPC whose alias is this PC's name", rows[0])

    def test_different_people_give_no_row(self):
        v = make(self, {"Characters/NPCs/Jane Smith.md": NPC.format(extra=""),
                        "Characters/NPCs/John Smyth.md": NPC.format(extra=""),
                        "Characters/PCs/John Smith.md":
                            PC.format(extra="aliases: [Johnny]\n"),
                        # Two PCs or two NPCs of one name are not this check's.
                        "Characters/PCs/Ana.md": PC.format(extra=""),
                        "Other/Ana.md": PC.format(extra="")})
        self.assertEqual(vc.check_npc_pairs(v), [])

    def test_archived_and_merged_notes_are_not_live(self):
        v = make(self, {
            "_archive/Characters/NPCs/Mira Vale.md":
                NPC.format(extra='merged_into: "[[Mira Vale]]"\n'),
            "Characters/NPCs/Kit.md":
                NPC.format(extra='merged_into: "[[Kit]]"\n'),
            "Characters/PCs/Kit.md": PC.format(extra=""),
            "Characters/PCs/Mira Vale.md": PC.format(extra="")})
        self.assertEqual(vc.check_npc_pairs(v), [])
        # Nor does the names check call the archived copy a duplicate.
        self.assertEqual(vc.check_names(v, 0.85), [])

    def test_command_prints_rows(self):
        import io
        from contextlib import redirect_stdout
        v = make(self, {"Characters/NPCs/Mira Vale.md": NPC.format(extra=""),
                        "Characters/PCs/Mira Vale.md": PC.format(extra="")})
        out = io.StringIO()
        with redirect_stdout(out):
            vc.main([str(v), "npc-pairs"])
        self.assertIn("## npc-pairs\n# count: 1\nASK\t", out.getvalue())


if __name__ == "__main__":
    unittest.main()
