"""1.11.2 update step `null-last-updated`: a `lastUpdated: "null"` that the
old `vw story` wrote from a Wrap-Up with no play date is cleared to
`lastUpdated: ""` on story companions and NPC notes."""

import shutil
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import migrate_vault as mv  # noqa: E402
from migrate_core import WILL  # noqa: E402

STORY = ('---\ntype: pc\ncharacter: "[[Ada]]"\nlastUpdated: "null"\n'
         'asOfSession: "Session 2"\n---\n\n## Session 2 — Docks\n\nShe ran.\n')
NPC = "---\ntype: npc\nvoice: \"Dry.\"\nlastUpdated: 'null'\n---\n\n# Marlo\n"
NPC_FINE = '---\ntype: npc\nlastUpdated: "2026-09-30"\n---\n\n# Tom\n'
BARE_NULL = "---\ntype: npc\nlastUpdated: null\n---\n\n# Bare\n"
LOCATION = '---\ntype: location\nlastUpdated: "null"\n---\n\n# Dock\n'
TEMPLATE = '---\ntype: npc\nlastUpdated: "null"\n---\n'


def make_vault(case, notes):
    vault = Path(tempfile.mkdtemp(prefix="mig-nulldate-"))
    case.addCleanup(shutil.rmtree, vault, ignore_errors=True)
    (vault / "_meta").mkdir()
    (vault / "_meta" / "vault-config.yaml").write_text("version: 1\n",
                                                       encoding="utf-8")
    for rel, text in notes.items():
        path = vault / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(text.encode("utf-8"))
    return vault


def raw(vault, rel):
    return (vault / rel).read_bytes().decode("utf-8")


class NullLastUpdatedTests(unittest.TestCase):
    def test_cleared_on_story_files_and_npcs(self):
        v = make_vault(self, {"PCs/Ada_Story.md": STORY, "NPCs/Marlo.md": NPC,
                              "NPCs/Tom.md": NPC_FINE,
                              "NPCs/Bare.md": BARE_NULL,
                              "Places/Dock.md": LOCATION,
                              "_Templates/_Template_NPC.md": TEMPLATE})
        (item,) = mv.find_null_last_updated(v)
        self.assertEqual((item.id, item.group),
                         ("null-last-updated", WILL))
        self.assertEqual(len(item.lines), 2)
        self.assertTrue(any("NPCs/Marlo.md" in ln for ln in item.lines))
        self.assertTrue(any("PCs/Ada_Story.md" in ln for ln in item.lines))
        item.apply(None)
        self.assertEqual(raw(v, "PCs/Ada_Story.md"),
                         STORY.replace('lastUpdated: "null"', 'lastUpdated: ""'))
        self.assertEqual(raw(v, "NPCs/Marlo.md"),
                         NPC.replace("lastUpdated: 'null'", 'lastUpdated: ""'))
        for rel, text in (("NPCs/Tom.md", NPC_FINE), ("NPCs/Bare.md", BARE_NULL),
                          ("Places/Dock.md", LOCATION),
                          ("_Templates/_Template_NPC.md", TEMPLATE)):
            self.assertEqual(raw(v, rel), text, rel)
        self.assertEqual(mv.find_null_last_updated(v), [])

    def test_a_vault_without_it_is_offered_nothing(self):
        v = make_vault(self, {"NPCs/Tom.md": NPC_FINE,
                              "PCs/Ada_Story.md": STORY.replace(
                                  '"null"', '"2026-09-30"')})
        self.assertEqual(mv.find_null_last_updated(v), [])

    def test_trailing_comment_kept(self):
        v = make_vault(self, {"NPCs/Marlo.md": NPC.replace(
            "'null'", "'NULL'  # old")})
        (item,) = mv.find_null_last_updated(v)
        item.apply(None)
        self.assertIn('lastUpdated: ""  # old\n', raw(v, "NPCs/Marlo.md"))

    def test_crlf_kept(self):
        v = make_vault(self, {"NPCs/Marlo.md": NPC.replace("\n", "\r\n")})
        (item,) = mv.find_null_last_updated(v)
        item.apply(None)
        self.assertIn('lastUpdated: ""\r\n', raw(v, "NPCs/Marlo.md"))

    def test_the_check_is_registered(self):
        (check,) = [c for c in mv.VAULT_CHECKS if c.name == "null-last-updated"]
        self.assertEqual((check.release, check.band, check.kind),
                         ("1.11.2", 3, "bookkeeping"))


if __name__ == "__main__":
    unittest.main()
