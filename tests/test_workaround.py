"""workaround.py and the update's offers: workarounds recorded by the issue
they stand in for, offered for retirement once a release ships it."""

import contextlib
import io
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parent.parent / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import changelog_issues  # noqa: E402
import migrate  # noqa: E402
import update  # noqa: E402
import update_record  # noqa: E402
import workaround  # noqa: E402
from test_migrate import make_vault  # noqa: E402

LOG = """# Changelog

## [1.10.129] — 2026-11-04

GURPS sheets can count local gravity (#510).

## [1.10.120] — 2026-11-01

- Hero layouts, full-bleed included (#530).
"""


def wa(vault, *args):
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = workaround.main([*args[:1], str(vault), *args[1:]])
    return code, out.getvalue(), err.getvalue()


class Base(unittest.TestCase):
    plugin = "1.10.129"

    def setUp(self):
        self.vault = make_vault(self, version=self.plugin)
        (self.vault / "PCs").mkdir()
        (self.vault / "PCs" / "Six.md").write_text("# Six\n", encoding="utf-8")
        tmp = Path(tempfile.mkdtemp(prefix="wa-"))
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        self.home = tmp / "home"
        self.changelog = tmp / "CHANGELOG.md"
        self.changelog.write_text(LOG, encoding="utf-8")
        for target, attr, value in (
                (changelog_issues, "CHANGELOG", self.changelog),
                (migrate, "plugin_version", lambda: (self.plugin, "test")),
                (workaround, "plugin_version", lambda: (self.plugin, "test"))):
            p = mock.patch.object(target, attr, value)
            p.start()
            self.addCleanup(p.stop)

    def add(self, issue=510, what="Gravity by hand on the sheet",
            where=("PCs/Six.md",), release=None):
        return workaround.add(self.vault, issue, what, "note", list(where), release)

    def update(self, answers=None, headless=False):
        return update.run(self.vault, answers or {}, headless, checks=[],
                          home=self.home)

    def asked(self):
        """The id the report prints for the one waiting workaround question."""
        [q] = self.update().questions
        return q.id

    def swept(self):
        workaround.swept(self.vault)

    def record(self):
        return update_record.load(self.vault)


class AddTests(Base):
    def test_add_records_an_active_workaround_with_a_slug_id(self):
        w = self.add()
        self.assertEqual(w["id"], "gravity-by-hand-on-the-sheet")
        self.assertEqual(self.record()["workarounds"], [w])
        self.assertEqual((w["state"], w["kept_at"], w["retired"], w["release"]),
                         ("active", None, None, None))

    def test_a_duplicate_id_gets_a_number(self):
        self.add()
        self.assertEqual(self.add()["id"], "gravity-by-hand-on-the-sheet-2")
        self.assertEqual(self.add()["id"], "gravity-by-hand-on-the-sheet-3")

    def test_add_refuses_what_it_cannot_check(self):
        for args in (dict(issue=0), dict(issue=-3),
                     dict(where=("PCs/Nobody.md",)), dict(where=("/etc/hosts",)),
                     dict(where=("../x",)), dict(where=()), dict(where=("memory:",)),
                     dict(release="soon")):
            with self.subTest(args=args), self.assertRaises(workaround.Refused):
                self.add(**args)
        with self.assertRaises(workaround.Refused):
            workaround.add(self.vault, 510, "x", "poem", ["PCs/Six.md"])
        self.assertEqual(self.record()["workarounds"], [])

    def test_a_release_is_three_numbers(self):
        for bad in ("1.10", "1", "1.10.3.4", "v1.10.3"):
            with self.subTest(release=bad), self.assertRaises(workaround.Refused):
                self.add(release=bad)
        self.assertEqual(self.add(release="1.10.3")["release"], "1.10.3")

    def test_memory_paths_need_not_exist(self):
        w = self.add(where=("memory:gravity.md", "PCs/Six.md"))
        self.assertEqual(w["where"], ["memory:gravity.md", "PCs/Six.md"])

    def test_the_cli_adds_lists_keeps_retires_and_sweeps(self):
        code, out, _ = wa(self.vault, "add", "--issue", "510", "--what",
                          "Gravity by hand", "--kind", "note",
                          "--where", "PCs/Six.md")
        self.assertEqual(code, 0, out)
        self.assertIn("Recorded gravity-by-hand", out)
        code, out, _ = wa(self.vault, "list", "--json")
        self.assertEqual(json.loads(out)[0]["issue"], 510)
        self.assertEqual(wa(self.vault, "keep", "gravity-by-hand")[0], 0)
        self.assertEqual(self.record()["workarounds"][0]["kept_at"], self.plugin)
        self.assertEqual(wa(self.vault, "retire", "gravity-by-hand",
                            "--reason", "now built in")[0], 0)
        self.assertTrue(self.record()["workarounds"][0]["retired"]
                        .endswith(": now built in"))
        self.assertEqual(wa(self.vault, "swept")[0], 0)
        self.assertIsNotNone(self.record()["swept"])
        code, _, err = wa(self.vault, "keep", "nobody")
        self.assertEqual(code, 2)
        self.assertIn("gravity-by-hand", err)
        code, _, err = wa(self.vault, "add", "--issue", "x", "--what", "y",
                          "--kind", "note", "--where", "PCs/Six.md")
        self.assertEqual(code, 2)


class ScanTests(Base):
    def test_scan_finds_issue_numbers_in_meta_and_memory_and_records_nothing(self):
        (self.vault / "_meta" / "house-rules.md").write_text(
            "# House rules\n\nGravity by hand until #510 ships.\n", encoding="utf-8")
        (self.vault / "CLAUDE.md").write_text(
            "See https://github.com/AntTheLimey/gm-apprentice/issues/530 for the hero.\n",
            encoding="utf-8")
        (self.vault / "Notes").mkdir()
        (self.vault / "Notes" / "Sheet Workaround.md").write_text(
            "Waiting on #401 and #402.\n", encoding="utf-8")
        (self.vault / "Notes" / "Tagged.md").write_text(
            "---\ntags: [workaround]\n---\nSee #77.\n", encoding="utf-8")
        (self.vault / "Notes" / "Plain.md").write_text(
            "Session #3 went well.\n", encoding="utf-8")
        memory = self.vault.parent / f"{self.vault.name}-memory"
        memory.mkdir()
        self.addCleanup(shutil.rmtree, memory, ignore_errors=True)
        (memory / "gravity.md").write_text("x\n" + "y" * 300 + " #510\n",
                                           encoding="utf-8")
        before = sorted(p for p in self.vault.rglob("*"))
        hits = workaround.scan(self.vault, memory)
        got = {(h.file, h.line): h.issues for h in hits}
        self.assertEqual(got, {
            ("CLAUDE.md", 1): [530],
            ("_meta/house-rules.md", 3): [510],
            ("Notes/Sheet Workaround.md", 1): [401, 402],
            ("Notes/Tagged.md", 4): [77],
            ("memory:gravity.md", 2): [510]})
        self.assertTrue(all(len(h.text) <= 160 for h in hits))
        self.assertEqual(sorted(p for p in self.vault.rglob("*")), before)
        self.assertFalse((self.vault / update_record.RECORD_FILE).exists())
        code, out, _ = wa(self.vault, "scan", "--memory", str(memory))
        self.assertEqual(code, 0)
        self.assertIn("_meta/house-rules.md:3\t#510\t", out)


class BeforeReleaseTests(Base):
    plugin = "1.10.128"

    def test_a_workaround_is_offered_only_after_its_release(self):
        self.swept()
        self.add()   # #510 ships in 1.10.129
        res = self.update()
        self.assertEqual(res.questions, [])
        self.assertEqual(res.exit, 0)


class OfferTests(Base):
    def test_a_shipped_workaround_is_asked(self):
        self.swept()
        self.add()
        res = self.update()
        self.assertEqual(res.exit, 3)
        [q] = res.questions
        self.assertRegex(q.id, r"^workaround:gravity-by-hand-on-the-sheet@[0-9a-f]{8}$")
        self.assertEqual((q.kind, q.options), ("asks", ["retire", "keep"]))
        self.assertEqual(
            q.text, "Gravity by hand on the sheet (PCs/Six.md) stands in for "
            "#510, built in since 1.10.129: GURPS sheets can count local "
            "gravity (#510). Retire it and switch to the built-in way?")

    def test_a_long_changelog_entry_is_cut_to_160(self):
        self.swept()
        self.changelog.write_text(
            "## [1.10.129] — x\n\n" + "word " * 500 + "(#510).\n",
            encoding="utf-8")
        self.add()
        [q] = self.update().questions
        said = q.text.split("built in since 1.10.129: ", 1)[1]
        said = said.rsplit(". Retire it", 1)[0]
        self.assertLessEqual(len(said), 160)
        self.assertTrue(said.endswith("…"))

    def test_release_override_wins(self):
        self.swept()
        self.add(release="1.10.200")   # the CHANGELOG says 1.10.129
        self.assertEqual(self.update().questions, [])
        self.add(issue=9999, what="Unmapped", release="1.10.1")
        [q] = self.update().questions
        self.assertTrue(q.id.startswith("workaround:unmapped@"))
        self.assertIn("built in since 1.10.1. Retire", q.text)

    def test_kept_workaround_is_not_offered_again(self):
        self.swept()
        self.add()
        res = self.update({self.asked(): "keep"})
        self.assertEqual(res.exit, 0, res)
        self.assertEqual(res.questions, [])
        [w] = self.record()["workarounds"]
        self.assertEqual((w["state"], w["kept_at"]), ("kept", "1.10.129"))
        self.assertEqual(self.update().questions, [])
        self.assertEqual(self.update(headless=True).questions, [])

    def test_retire_removes_nothing_and_names_the_paths(self):
        self.swept()
        self.add(where=("PCs/Six.md", "memory:gravity.md"))
        before = (self.vault / "_meta" / "update-record.json").read_text()
        res = self.update({self.asked(): "retire"})
        self.assertEqual(res.exit, 0)
        self.assertIn("Retire gravity-by-hand-on-the-sheet: PCs/Six.md, "
                      "memory:gravity.md", res.notes)
        self.assertTrue((self.vault / "PCs" / "Six.md").exists())
        self.assertEqual((self.vault / "_meta" / "update-record.json").read_text(),
                         before)
        self.assertIsNone(res.backup)
        self.assertEqual(len(self.update().questions), 1)   # until retire runs
        workaround.retire(self.vault, "gravity-by-hand-on-the-sheet", "built in")
        self.assertEqual(self.update().questions, [])

    def test_a_bare_or_stale_id_is_not_applied(self):
        self.swept()
        self.add()
        for key in ("workaround:gravity-by-hand-on-the-sheet",
                    "workaround:gravity-by-hand-on-the-sheet@00000000"):
            with self.subTest(key=key):
                res = self.update({key: "keep"})
                self.assertEqual(res.exit, 3)
                self.assertEqual(len(res.questions), 1)
                self.assertTrue(any("was not used" in n for n in res.notes))
                self.assertEqual(self.record()["workarounds"][0]["state"], "active")

    def test_headless_leaves_the_question_open(self):
        self.swept()
        self.add()
        res = self.update(headless=True)
        self.assertEqual([q.id.split("@")[0] for q in res.questions],
                         ["workaround:gravity-by-hand-on-the-sheet"])
        self.assertEqual(res.left_open, ["workaround:gravity-by-hand-on-the-sheet"])
        self.assertEqual(self.record()["workarounds"][0]["state"], "active")

    def test_an_answer_outside_the_options_is_refused(self):
        self.swept()
        self.add()
        res = self.update({self.asked(): "yes"})
        self.assertEqual(res.exit, 2)
        self.assertEqual(self.record()["workarounds"][0]["state"], "active")

    def test_missing_sweep_adds_one_line_and_keeps_exit_0(self):
        res = self.update()
        self.assertEqual(res.exit, 0)
        self.assertEqual(res.notes, [update.NO_SWEEP])
        self.assertIn("- No workaround record yet: run the one-time sweep "
                      "(campaign-organizer, workaround-sweep.md).",
                      update.report(res))
        self.swept()
        self.assertEqual(self.update().notes, [])

    def test_a_missing_changelog_offers_nothing_and_says_so(self):
        self.swept()
        self.add()
        self.changelog.unlink()
        res = self.update()
        self.assertEqual((res.exit, res.questions), (0, []))
        self.assertEqual(res.notes, [update.NO_CHANGELOG])


if __name__ == "__main__":
    unittest.main()
