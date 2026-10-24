"""Scenes Part 1 update steps: `stage-keys` (a stage that hides a note
stays) and `empty-scenes-lists`."""

import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import migrate_vault as mv  # noqa: E402
from migrate_core import WILL  # noqa: E402

PLAN = "---\ntype: session-plan\nstage: draft\nstatus: planned\n---\n\n# Plan\n"
PLAN_PLAYED = PLAN.replace("stage: draft", "stage: in_play")
WRAP = ("---\ntype: session-wrapup\nstage: wrap_up     # outline | draft\n"
        "status: reviewed\n---\n\n# Wrap\n")
BLOCK = "---\ntype: session\nstage:\n  name: x\nscenes: []\n---\n\n# S\n"
EMPTY = "---\ntype: session\nscenes: []\nstatus: planned\n---\n\n# S1\n"
FULL = "---\ntype: session\nscenes:\n  - one\n  - two\nstatus: planned\n---\n"
NOT_SESSION = "---\ntype: npc\nscenes: []\n---\n"
TEMPLATE = "---\ntype: session\nstage: outline\nscenes: []\n---\n"


def make_vault(case, notes, installed=None, with_site=False):
    root = Path(tempfile.mkdtemp(prefix="mig-scenes-"))
    case.addCleanup(shutil.rmtree, root, ignore_errors=True)
    vault = root / "Vault"
    (vault / "_meta").mkdir(parents=True)
    config = "version: 1\n"
    if with_site:
        site = root / "site"
        site.mkdir()
        if installed is not None:
            pkg = site / "node_modules" / "gm-apprentice-publish"
            pkg.mkdir(parents=True)
            (pkg / "package.json").write_text(json.dumps(
                {"name": "gm-apprentice-publish", "version": installed}),
                encoding="utf-8")
        config += f"player_site:\n  folder: {site.as_posix()}\n"
    (vault / "_meta" / "vault-config.yaml").write_text(config, encoding="utf-8")
    for rel, text in notes.items():
        path = vault / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(text.encode("utf-8"))
    return vault


def raw(vault, rel):
    return (vault / rel).read_bytes().decode("utf-8")


def run(items):
    for item in items:
        item.apply(None)


class EmptyScenesTests(unittest.TestCase):
    def test_removed_from_sessions_only(self):
        v = make_vault(self, {"S/Session 1.md": EMPTY, "N/Bob.md": NOT_SESSION})
        (item,) = mv.find_empty_scenes_lists(v)
        self.assertEqual((item.id, item.group), ("empty-scenes-lists", WILL))
        run([item])
        self.assertEqual(raw(v, "S/Session 1.md"),
                         "---\ntype: session\nstatus: planned\n---\n\n# S1\n")
        self.assertEqual(raw(v, "N/Bob.md"), NOT_SESSION)

    def test_list_with_entries_untouched(self):
        v = make_vault(self, {"S/Session 2.md": FULL})
        self.assertEqual(mv.find_empty_scenes_lists(v), [])
        self.assertEqual(raw(v, "S/Session 2.md"), FULL)

    def test_crlf_kept_and_idempotent(self):
        crlf = EMPTY.replace("\n", "\r\n")
        v = make_vault(self, {"S/Session 1.md": crlf})
        run(mv.find_empty_scenes_lists(v))
        self.assertEqual(raw(v, "S/Session 1.md"),
                         "---\r\ntype: session\r\nstatus: planned\r\n---\r\n\r\n# S1\r\n")
        self.assertEqual(mv.find_empty_scenes_lists(v), [])

    def test_templates_not_walked(self):
        v = make_vault(self, {"_Templates/session.md": TEMPLATE})
        self.assertEqual(mv.find_empty_scenes_lists(v), [])


class StageKeyTests(unittest.TestCase):
    def test_removed_where_it_hides_nothing(self):
        v = make_vault(self, {"P/Plan.md": PLAN_PLAYED, "W/Wrap.md": WRAP,
                              "_Templates/session.md": TEMPLATE})
        (item,) = mv.find_stage_keys(v)
        self.assertEqual((item.id, item.group), ("stage-keys", WILL))
        run([item])
        self.assertEqual(raw(v, "P/Plan.md"),
                         "---\ntype: session-plan\nstatus: planned\n---\n\n# Plan\n")
        self.assertEqual(raw(v, "W/Wrap.md"),
                         "---\ntype: session-wrapup\nstatus: reviewed\n---\n\n# Wrap\n")
        self.assertEqual(raw(v, "_Templates/session.md"), TEMPLATE)
        self.assertEqual(mv.find_stage_keys(v), [])

    def test_a_stage_that_hides_the_note_stays(self):
        # stage: draft still keeps a note off the player site; removing it
        # would publish the note.
        for stage in ("draft", "Outline", "'ready'", "&held draft",
                      "draft   # still writing", "*held"):
            note = f"---\ntype: session-wrapup\nstage: {stage}\n---\n\n# W\n"
            v = make_vault(self, {"W/Wrap.md": note, "P/Plan.md": PLAN})
            self.assertEqual(mv.find_stage_keys(v), [], stage)
            self.assertEqual(raw(v, "W/Wrap.md"), note)

    def test_other_types_keep_their_stage(self):
        npc = "---\ntype: npc\nstage: rising\n---\n\n# Bob\n"
        notes = "---\ntype: session-play-notes\nstage: in_play\n---\n"
        v = make_vault(self, {"N/Bob.md": npc, "P/Plan.md": PLAN_PLAYED,
                              "S/Notes.md": notes})
        (item,) = mv.find_stage_keys(v)
        self.assertEqual(item.lines, ["remove stage: from P/Plan.md",
                                      "remove stage: from S/Notes.md"])
        run([item])
        self.assertEqual(raw(v, "N/Bob.md"), npc)
        self.assertEqual(mv.find_stage_keys(v), [])

    def test_block_form_stage_untouched(self):
        v = make_vault(self, {"S/Session 1.md": BLOCK})
        self.assertEqual(mv.find_stage_keys(v), [])
        self.assertEqual(raw(v, "S/Session 1.md"), BLOCK)

    def test_crlf_kept(self):
        v = make_vault(self, {"P/Plan.md": PLAN_PLAYED.replace("\n", "\r\n")})
        run(mv.find_stage_keys(v))
        self.assertEqual(
            raw(v, "P/Plan.md"),
            "---\r\ntype: session-plan\r\nstatus: planned\r\n---\r\n\r\n# Plan\r\n")

    def test_no_site_tool_needed(self):
        v = make_vault(self, {"P/Plan.md": PLAN_PLAYED}, installed="1.46.0",
                       with_site=True)
        (item,) = mv.find_stage_keys(v)
        self.assertEqual(item.group, WILL)


class RegisteredTests(unittest.TestCase):
    def test_checks_registered(self):
        by = {c.name: c for c in mv.VAULT_CHECKS}
        s, e = by["stage-keys"], by["empty-scenes-lists"]
        self.assertEqual((s.release, s.band, s.asks_site), ("1.10.93", 3, False))
        self.assertEqual((e.release, e.band, e.asks_site), ("1.10.93", 3, False))


if __name__ == "__main__":
    unittest.main()
