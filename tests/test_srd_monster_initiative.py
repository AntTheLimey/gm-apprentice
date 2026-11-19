"""The shipped SRD creature blocks carry the SRD's Initiative, as the SRD
gives it (never worked out from DEX)."""

import re
import unittest
from pathlib import Path

DIR = (Path(__file__).resolve().parent.parent / "skills" / "ttrpg-expert"
       / "systems" / "dnd-5e-2024")
HEAD_RE = re.compile(r"^\*\*(?P<name>[^*]+)\*\* \| ", re.M)
INIT_RE = re.compile(r"\| Init (?P<init>[+-]\d+ \(\d+\)) \|")


def blocks() -> dict[str, str]:
    found: dict[str, str] = {}
    for path in sorted(DIR.glob("monsters-cr*.md")):
        text = path.read_text(encoding="utf-8")
        heads = list(HEAD_RE.finditer(text))
        for i, m in enumerate(heads):
            end = heads[i + 1].start() if i + 1 < len(heads) else len(text)
            found[m["name"]] = text[m.start():end]
    return found


class InitiativeTests(unittest.TestCase):
    def test_every_shipped_block_has_an_init_figure(self):
        shipped = blocks()
        self.assertGreater(len(shipped), 200)
        missing = [n for n, b in shipped.items()
                   if not INIT_RE.search(b.split("\n", 2)[1])]
        self.assertEqual(missing, [])

    def test_the_young_white_dragons_is_the_srds_not_dexs(self):
        block = blocks()["Young White Dragon"]
        self.assertEqual(INIT_RE.search(block)["init"], "+3 (13)")
        self.assertIn("\n18/10/18/6/11/12\n", block)  # DEX 10

    def test_the_ice_mephits_is_plus_one(self):
        self.assertEqual(INIT_RE.search(blocks()["Ice Mephit"])["init"],
                         "+1 (11)")


if __name__ == "__main__":
    unittest.main()
