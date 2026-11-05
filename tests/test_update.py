"""update.py: `gma update` sorts, runs, reports and records, with made-up checks."""

import contextlib
import dataclasses
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

import migrate  # noqa: E402
import update  # noqa: E402
import update_record  # noqa: E402
from migrate_core import (CHOICE, KINDS, PERSON, WILL, Check, Item,  # noqa: E402
                          StepFailed)
from test_migrate import PLUGIN, make_vault, stamp_of  # noqa: E402


def check(name, kind, items, release=None, plain=None, log=None):
    """A check whose find returns `items()` while state says pending; each
    item's apply runs `log.append(id)` and clears it."""
    state = {"pending": True, "lines": None}

    def find(_vault):
        if not state["pending"]:
            return []
        out = []
        for it in items():
            if state["lines"] is not None:
                it.lines = list(state["lines"])
            inner = it.apply

            def apply(value, inner=inner, it=it):
                if log is not None:
                    log.append(it.id if value is None else f"{it.id}={value}")
                result = inner(value) if inner else [f"did {it.id}"]
                state["pending"] = False
                return result
            it.apply = apply if it.group != PERSON else None
            out.append(it)
        return out
    c = Check(name, release, 3, f"title of {name}", find, kind=kind,
              plain=plain or f"Plainly did {name}.")
    return c, state


def will_item(name):
    return lambda: [Item(name, WILL, [f"do {name}"], None)]


def failing(name):
    def items():
        def apply(_v):
            raise StepFailed("broke")
        return [Item(name, WILL, [f"do {name}"], apply)]
    return items


class Base(unittest.TestCase):
    def setUp(self):
        self.home = Path(tempfile.mkdtemp(prefix="upd-home-"))
        self.addCleanup(shutil.rmtree, self.home, ignore_errors=True)
        patcher = mock.patch.object(migrate, "plugin_version",
                                    return_value=(PLUGIN, "test"))
        patcher.start()
        self.addCleanup(patcher.stop)

    def run_update(self, vault, checks, answers=None, headless=False):
        return update.run(vault, answers or {}, headless, checks=checks,
                          home=self.home)

    def main(self, vault, checks, *args):
        out, err = io.StringIO(), io.StringIO()
        with mock.patch.object(migrate, "CHECKS", checks), \
                mock.patch.object(update, "HOME", self.home), \
                contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = update.main([str(vault), *args])
        return code, out.getvalue(), err.getvalue()

    def backups(self):
        return list((self.home / ".gm-apprentice" / "backups").glob("*/*.tar.gz"))


class SortTests(unittest.TestCase):
    def test_every_check_is_sorted(self):
        for c in migrate.CHECKS:
            with self.subTest(check=c.name):
                self.assertIn(c.kind, KINDS)
                self.assertTrue(c.plain.strip())
                self.assertTrue(c.plain.endswith("."), c.plain)
                for word in ("frontmatter", "stamp", "lost"):
                    self.assertNotIn(word, c.plain.lower())

    def test_the_proposed_sort_holds_where_the_brief_fixed_it(self):
        kinds = {c.name: c.kind for c in migrate.CHECKS}
        for name in ("required-ties-section", "stage-keys",
                     "empty-scenes-lists", "retire-steps"):
            self.assertEqual(kinds[name], "removes", name)
        for name in ("wrapup-sections", "tone-words", "open-threads-fold",
                     "sheet-source", "props-move", "props-settle",
                     "publish-hidden"):
            self.assertEqual(kinds[name], "asks", name)
        for name in ("wrapup-filenames", "heritage-notes", "mobrpg-sections",
                     "templates", "site-repin", "settings-move"):
            self.assertEqual(kinds[name], "bookkeeping", name)


class RunTests(Base):
    def test_nothing_to_do_exits_0_without_a_backup(self):
        vault = make_vault(self, PLUGIN)
        c, _ = check("tidy", "bookkeeping", lambda: [])
        res = self.run_update(vault, [c])
        self.assertEqual(res.exit, 0)
        self.assertIsNone(res.backup)
        self.assertEqual(self.backups(), [])
        self.assertFalse((vault / update_record.RECORD_FILE).exists())

    def test_bookkeeping_runs_without_asking_and_is_reported_in_plain_words(self):
        vault = make_vault(self)
        log = []
        c, _ = check("tidy", "bookkeeping", will_item("tidy"),
                     plain="Tidied your notes.", log=log)
        code, out, _ = self.main(vault, [c])
        self.assertEqual(code, 0)
        self.assertEqual(log, ["tidy"])
        self.assertIn(f"from 1.10.12 to {PLUGIN}", out)
        self.assertIn("Done:\n- Tidied your notes.", out)
        self.assertNotIn("did tidy", out)
        self.assertNotIn("Waiting for you", out)
        self.assertEqual(stamp_of(vault), PLUGIN)
        self.assertIn("Backup: ", out)

    def test_a_yes_no_choice_in_a_bookkeeping_check_runs_too(self):
        vault = make_vault(self)
        log = []
        c, _ = check("rename", "bookkeeping",
                     lambda: [Item("rename", CHOICE, ["rename a"], None)],
                     log=log)
        res = self.run_update(vault, [c])
        self.assertEqual((res.exit, log), (0, ["rename"]))

    def test_headless_runs_bookkeeping_only_and_says_what_it_left(self):
        vault = make_vault(self)
        log = []
        b, _ = check("tidy", "bookkeeping", will_item("tidy"), log=log)
        r, _ = check("drop", "removes", will_item("drop"), log=log)
        code, out, _ = self.main(vault, [b, r], "--headless")
        self.assertEqual(code, 3)
        self.assertEqual(log, ["tidy"])
        self.assertIn("Run without a GM: 1 questions were left for next "
                      "time; nothing was asked.", out)
        self.assertIn("Waiting for you (1):", out)

    def test_headless_takes_no_answers(self):
        vault = make_vault(self)
        r, _ = check("drop", "removes", will_item("drop"))
        res = self.run_update(vault, [r], {"drop": "yes"}, headless=True)
        self.assertEqual(res.exit, 2)

    def test_headless_never_stamps_past_a_question_that_holds_it(self):
        vault = make_vault(self)
        b, _ = check("tidy", "bookkeeping", will_item("tidy"))
        # A release-gated question is never offered again past the stamp.
        r, _ = check("drop", "removes", will_item("drop"), release="1.10.20")
        res = self.run_update(vault, [b, r], headless=True)
        self.assertEqual(res.exit, 3)
        self.assertIsNone(res.stamped)
        self.assertEqual(stamp_of(vault), "1.10.12")
        self.assertEqual(res.left_open, ["drop"])

    def test_an_every_pass_question_does_not_hold_the_stamp(self):
        vault = make_vault(self)
        r, _ = check("drop", "removes", will_item("drop"))
        res = self.run_update(vault, [r], headless=True)
        self.assertEqual((res.exit, res.stamped), (3, PLUGIN))

    def test_open_question_exits_3_and_lists_it(self):
        vault = make_vault(self)
        c, _ = check("pick", "asks", lambda: [Item(
            "pick", CHOICE, ["move the old lists"], None,
            wants="move or leave", holds_stamp=True)])
        code, out, _ = self.main(vault, [c])
        self.assertEqual(code, 3)
        self.assertIn("Waiting for you (1):\n- move the old lists", out)
        res = self.run_update(vault, [c])
        [q] = res.questions
        self.assertEqual((q.id, q.kind, q.options), ("pick", "asks",
                                                     ["move", "leave"]))
        self.assertEqual(stamp_of(vault), "1.10.12")

    def test_a_value_choice_asks_even_in_a_bookkeeping_check(self):
        vault = make_vault(self)
        c, _ = check("templates", "bookkeeping", lambda: [Item(
            "template:x.md", CHOICE, ["Your x template differs."], None,
            wants="keep or take", detail={"summary": "only yours has 1 field"})])
        res = self.run_update(vault, [c])
        [q] = res.questions
        self.assertEqual(q.options, ["keep", "take"])
        self.assertEqual(q.detail["summary"], "only yours has 1 field")

    def test_answer_applies_and_is_recorded(self):
        vault = make_vault(self)
        log = []
        r, _ = check("drop", "removes", will_item("drop"), release="1.10.20",
                     plain="Removed the old lines.", log=log)
        res = self.run_update(vault, [r], {"drop": "yes"})
        self.assertEqual((res.exit, log), (0, ["drop"]))
        self.assertIn("Removed the old lines.", res.did)
        self.assertEqual(res.stamped, PLUGIN)
        rec = update_record.load(vault)
        entry = rec["answers"]["drop"]
        self.assertEqual(entry["answer"], "yes")
        self.assertEqual(entry["lines_sha"], update_record.lines_sha(["do drop"]))
        self.assertEqual(entry["plugin"], PLUGIN)
        last = rec["updates"][-1]
        self.assertEqual((last["from"], last["to"], last["asked"]),
                         ("1.10.12", PLUGIN, ["drop"]))
        self.assertEqual(last["backup"], res.backup)

    def test_an_answer_outside_the_options_is_refused_before_any_write(self):
        vault = make_vault(self)
        r, _ = check("drop", "removes", will_item("drop"))
        res = self.run_update(vault, [r], {"drop": "maybe"})
        self.assertEqual(res.exit, 2)
        self.assertEqual(self.backups(), [])

    def test_a_leave_answer_is_not_reasked_after_stamping(self):
        vault = make_vault(self)
        log = []
        r, state = check("drop", "removes", will_item("drop"), log=log)
        res = self.run_update(vault, [r], {"drop": "leave"})
        self.assertEqual((res.exit, res.stamped, log), (0, PLUGIN, []))
        self.assertEqual(update_record.load(vault)["answers"]["drop"]["answer"],
                         "leave")
        again = self.run_update(vault, [r])
        self.assertEqual((again.exit, again.questions), (0, []))
        state["lines"] = ["do drop, and more"]   # what it would do changed
        changed = self.run_update(vault, [r])
        self.assertEqual(changed.exit, 3)
        self.assertEqual([q.id for q in changed.questions], ["drop"])

    def test_backup_exists_before_the_first_write(self):
        vault = make_vault(self)
        seen = []

        def items():
            def apply(_v):
                seen.append(len(self.backups()))
                return ["wrote"]
            return [Item("tidy", WILL, ["do tidy"], apply)]
        c, _ = check("tidy", "bookkeeping", items)
        res = self.run_update(vault, [c])
        self.assertEqual(seen, [1])
        self.assertTrue(Path(res.backup).is_file())

    def test_failed_step_records_only_what_finished_and_rerun_asks_nothing_new(self):
        vault = make_vault(self)
        log = []
        a, _ = check("first", "removes", will_item("first"), release="1.10.20",
                     log=log)
        b, _ = check("second", "removes", failing("second"), release="1.10.30",
                     log=log)
        res = self.run_update(vault, [a, b], {"first": "yes", "second": "yes"})
        self.assertEqual(res.exit, 1)
        self.assertIn("broke", res.error)
        self.assertEqual(stamp_of(vault), "1.10.20")
        rec = update_record.load(vault)
        self.assertEqual(set(rec["answers"]), {"first"})
        self.assertEqual(rec["updates"][-1]["to"], "1.10.20")
        again = self.run_update(vault, [a, b])
        self.assertEqual([q.id for q in again.questions], ["second"])

    def test_report_never_says_lost(self):
        vault = make_vault(self)
        b, _ = check("tidy", "bookkeeping", will_item("tidy"))
        q, _ = check("pick", "asks", lambda: [Item(
            "template:x.md", CHOICE, ["Your x template differs."], None,
            wants="keep or take")])
        for args in ((), ("--headless",), ("--json",)):
            _code, out, err = self.main(vault, [b, q], *args)
            self.assertNotIn("lost", (out + err).lower())

    def test_json_matches_the_plain_report(self):
        vault = make_vault(self)
        twin = make_vault(self)
        b, _ = check("tidy", "bookkeeping", will_item("tidy"))
        q, _ = check("pick", "asks", lambda: [Item(
            "pick", CHOICE, ["choose"], None, wants="move or leave")])
        b2, _ = check("tidy", "bookkeeping", will_item("tidy"))
        q2, _ = check("pick", "asks", lambda: [Item(
            "pick", CHOICE, ["choose"], None, wants="move or leave")])
        code, out, _ = self.main(vault, [b, q])
        jcode, jout, _ = self.main(twin, [b2, q2], "--json")
        data = json.loads(jout)
        self.assertEqual(code, jcode)
        self.assertEqual(data["exit"], code)
        done = out.split("Done:\n")[1].split("\n\n")[0]
        self.assertEqual(len(data["did"]), done.count("- "))
        self.assertIn(f"Waiting for you ({len(data['questions'])}):", out)
        self.assertEqual(data["questions"][0]["options"], ["move", "leave"])

    def test_refused_gate_exits_2(self):
        vault = make_vault(self, "1.9.14")
        c, _ = check("tidy", "bookkeeping", will_item("tidy"))
        code, out, err = self.main(vault, [c])
        self.assertEqual(code, 2)
        self.assertIn("below 1.10.12", err)
        self.assertEqual(self.backups(), [])

    def test_an_unreadable_template_is_a_read_problem_not_a_question(self):
        vault = make_vault(self, PLUGIN)
        c, _ = check("templates", "bookkeeping", lambda: [Item(
            "template-unreadable:x.md", PERSON,
            ["_Templates/x.md\tcould not be read; run brctl download"])])
        res = self.run_update(vault, [c])
        self.assertEqual((res.exit, res.questions), (0, []))
        self.assertEqual(res.read_problems,
                         ["_Templates/x.md: could not be read; run brctl download"])

    def test_a_remembered_keep_is_reported_as_bookkeeping(self):
        vault = make_vault(self)
        c, _ = check("templates", "bookkeeping", lambda: [Item(
            "template-kept:x.md", WILL, ["keep your x template (decided 2026-11-01)"],
            lambda _v: ["kept your x template (decided 2026-11-01)"])])
        res = self.run_update(vault, [c])
        self.assertEqual(res.did, ["kept your x template (decided 2026-11-01)"])

    def test_a_person_row_waits_with_no_options(self):
        vault = make_vault(self)
        c, _ = check("broken", "asks", lambda: [Item(
            "broken", PERSON, ["Notes/A.md\tfix this by hand"])])
        res = self.run_update(vault, [c])
        [q] = res.questions
        self.assertEqual((q.kind, q.options, q.text),
                         ("person", [], "Notes/A.md: fix this by hand"))
        self.assertEqual((res.exit, res.stamped), (3, PLUGIN))

    def test_migrate_plan_does_not_show_an_answer_the_record_keeps(self):
        vault = make_vault(self, PLUGIN)
        r, _ = check("drop", "removes", lambda: [Item(
            "drop", CHOICE, ["drop the old section"], None)])
        self.run_update(vault, [r], {"drop": "leave"})
        out = io.StringIO()
        with mock.patch.object(migrate, "CHECKS", [r]), \
                contextlib.redirect_stdout(out):
            migrate.main([str(vault), "plan"])
        self.assertIn("up to date", out.getvalue())
        self.assertNotIn("drop the old section", out.getvalue())

    def test_an_unused_answer_is_said(self):
        vault = make_vault(self)
        b, _ = check("tidy", "bookkeeping", will_item("tidy"))
        res = self.run_update(vault, [b], {"gone": "yes"})
        self.assertTrue(any("gone=yes" in n for n in res.notes), res.notes)


if __name__ == "__main__":
    unittest.main()
