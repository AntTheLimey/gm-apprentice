"""Every shipped SRD creature block carries the Initiative, size and Speed of
the official SRD 5.2.1 (`scripts/srd521-figures.json`, made by
`scripts/srd521_figures.py`), not the community transcription's."""

import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIR = ROOT / "skills" / "ttrpg-expert" / "systems" / "dnd-5e-2024"
FIGURES = json.loads((ROOT / "scripts" / "srd521-figures.json")
                     .read_text(encoding="utf-8"))
CODES = {"Tiny": "T", "Small": "S", "Medium": "M", "Large": "L",
         "Huge": "H", "Gargantuan": "G"}
BLOCK_RE = re.compile(
    r"^\*\*(?P<name>[^*]+)\*\* \| [^|]+ \| (?P<size>[TSMLHG](?:/[TSMLHG])?) \| "
    r"CR [^\n]*\nAC \d+ \| HP \d+ \([^)]*\)"
    r"(?: \| Init (?P<init>[+-]\d+) \((?P<score>\d+)\))? "
    r"\| Speed (?P<speed>[^\n]+)$", re.M)

# Shipped creatures the official SRD 5.2.1 does not list: none today. A
# creature added here keeps its transcription figures, and the enricher
# prints a warning for it.
NOT_IN_OFFICIAL_SRD: set[str] = set()


def shipped() -> list[re.Match]:
    out = []
    for path in [*sorted(DIR.glob("monsters-cr*.md")), DIR / "animals.md"]:
        out += list(BLOCK_RE.finditer(path.read_text(encoding="utf-8")))
    return out


def code(size: str) -> str:
    return "/".join(CODES[w] for w in size.split(" or "))


class OfficialFiguresTests(unittest.TestCase):
    def test_every_shipped_block_is_read(self):
        self.assertEqual(len(shipped()), 329)

    def test_every_shipped_creature_is_in_the_official_figures(self):
        listed = {n.casefold() for n in FIGURES}
        absent = {m["name"] for m in shipped()
                  if m["name"].casefold() not in listed}
        self.assertEqual(absent, NOT_IN_OFFICIAL_SRD)

    def test_every_block_has_the_official_figures(self):
        official = {n.casefold(): f for n, f in FIGURES.items()}
        wrong = []
        for m in shipped():
            fig = official.get(m["name"].casefold())
            if fig is None:
                continue
            want = (code(fig["size"]), fig["init"],
                    str(fig["init_score"]), fig["speed"])
            got = (m["size"], m["init"], m["score"], m["speed"])
            if got != want:
                wrong.append((m["name"], got, want))
        self.assertEqual(wrong, [])

    def test_the_monsters_index_carries_the_same_sizes(self):
        by_name = {m["name"]: m["size"] for m in shipped()}
        index = (DIR / "monsters.md").read_text(encoding="utf-8")
        rows = re.findall(r"^- \*\*([^*]+)\*\* \| [^|]+ \| ([TSMLHG/]+) \|",
                          index, re.M)
        self.assertEqual(len(rows), 235)
        self.assertEqual([(n, z) for n, z in rows if by_name[n] != z], [])

    def test_the_figures_are_whole(self):
        incomplete = [n for n, f in FIGURES.items()
                      if not f["size"] or not f["speed"]]
        self.assertEqual(incomplete, [])

    def test_known_corrections(self):
        by_name = {m["name"]: m for m in shipped()}
        self.assertEqual(by_name["Adult Brass Dragon"]["init"], "+10")
        self.assertEqual(by_name["Gray Ooze"]["score"], "13")
        self.assertEqual(by_name["Imp"]["size"], "T")
        self.assertEqual(by_name["Bandit"]["size"], "M/S")
        self.assertEqual(by_name["Werewolf"]["speed"],
                         "30 ft., 40 ft. (wolf form only)")


if __name__ == "__main__":
    unittest.main()
