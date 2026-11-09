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
import vaultlib  # noqa: E402
import vault_check as vc  # noqa: E402
import update_record  # noqa: E402
from migrate_core import (CHOICE, KINDS, PERSON, WILL, Check, Item,  # noqa: E402
                          StepFailed)
from test_migrate import (PLUGIN, REAL_FLOOR, TEST_FLOOR, make_vault,  # noqa: E402
                          stamp_of)


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


def file_check(vault, name, kind, release=None):
    """A check that finds its item until `<name>.done` exists in the vault,
    and whose apply writes that file: what it finds is the vault's state."""
    def find(_vault):
        if (vault / f"{name}.done").exists():
            return []

        def apply(_v):
            (vault / f"{name}.done").write_text("done", encoding="utf-8")
            return [f"did {name}"]
        return [Item(name, WILL, [f"do {name}"], apply)]
    return Check(name, release, 3, f"title of {name}", find, kind=kind,
                 plain=f"Plainly did {name}.")


def tag(name, lines=None):
    """The id a question is answered by: its id and the hash of the lines
    the GM was shown."""
    return f"{name}@{update_record.lines_sha(lines or [f'do {name}'])[:8]}"


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
                    self.assertNotIn(word, c.ask.lower())
                    self.assertNotIn(word, c.left.lower())
                can_ask = (c.kind != "bookkeeping"
                           or any(x.endswith("=") for x in c.choices)
                           or c.name == "exclude-lists")
                if can_ask:
                    self.assertTrue(c.ask.endswith("."), c.ask)
                    self.assertTrue(c.left.endswith("."), c.left)
                    # a consequence, not a report: no past-tense lead word
                    self.assertFalse(c.ask.split()[0].endswith("ed"), c.ask)

    def test_the_proposed_sort_holds_where_the_brief_fixed_it(self):
        kinds = {c.name: c.kind for c in migrate.CHECKS}
        for name in ("schema-mirror", "full-mode"):
            self.assertEqual(kinds[name], "removes", name)
        for name in ("hide-fields-voice",):
            self.assertEqual(kinds[name], "asks", name)
        for name in ("wrapup-filenames", "templates", "site-repin"):
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
        self.assertIn("Run without a GM: 1 question was left for next "
                      "time; nothing was asked.", out)
        self.assertIn("Waiting for you (1):", out)

    def test_headless_plural_for_several_questions(self):
        vault = make_vault(self)
        r1, _ = check("drop", "removes", will_item("drop"))
        r2, _ = check("drop2", "removes", will_item("drop2"))
        code, out, _ = self.main(vault, [r1, r2], "--headless")
        self.assertEqual(code, 3)
        self.assertIn("2 questions were left for next time", out)

    def test_headless_takes_no_answers(self):
        vault = make_vault(self)
        r, _ = check("drop", "removes", will_item("drop"))
        res = self.run_update(vault, [r], {tag("drop"): "yes"}, headless=True)
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
        self.assertEqual((q.id.split("@")[0], q.kind, q.options), ("pick", "asks",
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
        res = self.run_update(vault, [r], {tag("drop"): "yes"})
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
        res = self.run_update(vault, [r], {tag("drop"): "maybe"})
        self.assertEqual(res.exit, 2)
        self.assertEqual(self.backups(), [])

    def test_a_leave_answer_is_not_reasked_after_stamping(self):
        vault = make_vault(self)
        log = []
        r, state = check("drop", "removes", will_item("drop"), log=log)
        res = self.run_update(vault, [r], {tag("drop"): "leave"})
        self.assertEqual((res.exit, res.stamped, log), (0, PLUGIN, []))
        self.assertEqual(update_record.load(vault)["answers"]["drop"]["answer"],
                         "leave")
        again = self.run_update(vault, [r])
        self.assertEqual((again.exit, again.questions), (0, []))
        state["lines"] = ["do drop, and more"]   # what it would do changed
        changed = self.run_update(vault, [r])
        self.assertEqual(changed.exit, 3)
        self.assertEqual([q.id.split("@")[0] for q in changed.questions], ["drop"])

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
        early, _ = check("early", "bookkeeping", will_item("early"),
                         release="1.10.20")
        first = file_check(vault, "first", "removes")
        second, _ = check("second", "removes", failing("second"),
                          release="1.10.30")
        res = self.run_update(vault, [early, first, second],
                              {tag("first"): "yes", tag("second"): "yes"})
        self.assertEqual(res.exit, 1)
        self.assertIn("broke", res.error)
        self.assertTrue((vault / "first.done").is_file())
        self.assertEqual(stamp_of(vault), "1.10.20")
        rec = update_record.load(vault)
        self.assertEqual(set(rec["answers"]), {"first"})
        self.assertEqual(rec["updates"][-1]["to"], "1.10.20")
        # `first` runs every pass: it is not asked again only because the
        # file now says it is done.
        again = self.run_update(vault, [early, first, second])
        self.assertEqual([q.id.split("@")[0] for q in again.questions], ["second"])

    def test_an_unexpected_error_still_records_what_finished(self):
        vault = make_vault(self)
        first = file_check(vault, "first", "removes")

        def boom():
            def apply(_v):
                raise RuntimeError("not a step failure")
            return [Item("boom", WILL, ["do boom"], apply)]
        bad, _ = check("boom", "bookkeeping", boom)
        with contextlib.redirect_stderr(io.StringIO()):
            res = self.run_update(vault, [first, bad], {tag("first"): "yes"})
        self.assertEqual(res.exit, 1)
        self.assertIn("not a step failure", res.error)
        rec = update_record.load(vault)
        self.assertEqual(rec["answers"]["first"]["answer"], "yes")
        self.assertEqual(rec["updates"][-1]["did"], ["Plainly did first."])
        self.assertEqual(rec["updates"][-1]["to"], "1.10.12")
        self.assertEqual(stamp_of(vault), "1.10.12")

    def test_a_recorded_yes_is_never_applied_again_unasked(self):
        vault = make_vault(self)
        log = []
        r, state = check("drop", "removes", will_item("drop"), log=log)
        self.run_update(vault, [r], {tag("drop"): "yes"})
        self.assertEqual(log, ["drop"])
        state["pending"] = True   # the same change is due again (GM re-edited)
        headless = self.run_update(vault, [r], headless=True)
        self.assertEqual(log, ["drop"])
        self.assertEqual([q.id.split("@")[0] for q in headless.questions], ["drop"])
        asked = self.run_update(vault, [r])
        self.assertEqual(log, ["drop"])
        self.assertEqual((asked.exit, [q.id.split("@")[0] for q in asked.questions]),
                         (3, ["drop"]))

    def test_a_stamp_only_run_records_its_backup(self):
        vault = make_vault(self)
        c, _ = check("tidy", "bookkeeping", lambda: [])
        res = self.run_update(vault, [c])
        self.assertEqual((res.exit, res.stamped), (0, PLUGIN))
        self.assertTrue(res.backup and Path(res.backup).is_file())
        self.assertEqual(update_record.load(vault)["updates"][-1]["backup"],
                         res.backup)

    def test_an_unexpected_error_stays_the_error_when_the_record_fails(self):
        vault = make_vault(self)
        first = file_check(vault, "first", "removes")

        def boom():
            def apply(_v):
                raise RuntimeError("the original")
            return [Item("boom", WILL, ["do boom"], apply)]
        bad, _ = check("boom", "bookkeeping", boom)
        with mock.patch.object(update, "_save_record",
                               side_effect=OSError("disk full")), \
                contextlib.redirect_stderr(io.StringIO()):
            res = self.run_update(vault, [first, bad], {tag("first"): "yes"})
        self.assertIn("the original", res.error)
        self.assertTrue(any("disk full" in n for n in res.notes), res.notes)
        self.assertEqual(stamp_of(vault), "1.10.12")

    def test_an_interrupt_still_records_what_finished_and_is_raised(self):
        vault = make_vault(self)
        first = file_check(vault, "first", "removes")

        def stop():
            def apply(_v):
                raise KeyboardInterrupt
            return [Item("stop", WILL, ["do stop"], apply)]
        bad, _ = check("stop", "bookkeeping", stop)
        with self.assertRaises(KeyboardInterrupt):
            self.run_update(vault, [first, bad], {tag("first"): "yes"})
        rec = update_record.load(vault)
        self.assertEqual(rec["answers"]["first"]["answer"], "yes")
        self.assertEqual(stamp_of(vault), "1.10.12")

    def test_a_held_question_alone_writes_nothing(self):
        vault = make_vault(self)
        r, _ = check("drop", "removes", will_item("drop"), release="1.10.20")
        res = self.run_update(vault, [r])
        self.assertEqual((res.exit, res.backup), (3, None))
        self.assertEqual(self.backups(), [])
        self.assertFalse((vault / update_record.RECORD_FILE).exists())

    def test_a_leave_is_reported_in_plain_words(self):
        vault = make_vault(self)
        r, _ = check("drop", "removes", will_item("drop"))
        r = dataclasses.replace(r, left="Kept your old lines.")
        res = self.run_update(vault, [r], {tag("drop"): "leave"})
        self.assertEqual(res.did, ["Kept your old lines."])
        self.assertEqual(update_record.load(vault)["updates"][-1]["did"],
                         ["Kept your old lines."])

    def test_an_item_kind_overrides_its_check(self):
        vault = make_vault(self)
        log = []
        c, _ = check("lists", "bookkeeping", lambda: [
            Item("lists", WILL, ["write the list"], None),
            Item("lists-replace", WILL, ["replace what you typed"], None,
                 kind="asks")], log=log)
        res = self.run_update(vault, [c], headless=True)
        self.assertEqual(log, ["lists"])
        self.assertEqual([(q.id.split("@")[0], q.kind) for q in res.questions],
                         [("lists-replace", "asks")])


class AskedTextTests(Base):
    """An answer applies only to the lines the GM was shown."""

    def test_a_removes_item_whose_lines_changed_is_asked_again(self):
        vault = make_vault(self)
        log = []
        r, state = check("drop", "removes", will_item("drop"), log=log)
        [q] = self.run_update(vault, [r]).questions
        self.assertEqual(q.id, tag("drop"))
        state["lines"] = ["do drop", "and a line the GM added since"]
        res = self.run_update(vault, [r], {q.id: "yes"})
        self.assertEqual(log, [])
        self.assertEqual(res.exit, 3)
        self.assertEqual([x.id for x in res.questions],
                         [tag("drop", state["lines"])])
        self.assertTrue(any("changed since you were asked" in n
                            for n in res.notes), res.notes)

    def test_a_matching_hash_is_applied(self):
        vault = make_vault(self)
        log = []
        r, _ = check("drop", "removes", will_item("drop"), log=log)
        [q] = self.run_update(vault, [r]).questions
        res = self.run_update(vault, [r], {q.id: "yes"})
        self.assertEqual((res.exit, log), (0, ["drop"]))

    def test_a_bare_id_is_not_applied(self):
        vault = make_vault(self)
        log = []
        r, _ = check("drop", "removes", will_item("drop"), log=log)
        res = self.run_update(vault, [r], {"drop": "yes"})
        self.assertEqual((res.exit, log), (3, []))
        self.assertTrue(any("drop=yes" in n for n in res.notes), res.notes)

    def test_a_stale_id_for_an_item_already_left_says_it_was_answered(self):
        vault = make_vault(self)
        log = []
        r, _ = check("drop", "removes", will_item("drop"), log=log)
        [q] = self.run_update(vault, [r]).questions
        self.assertEqual(self.run_update(vault, [r], {q.id: "leave"}).exit, 0)
        for key in ("drop", "drop@00000000"):
            res = self.run_update(vault, [r], {key: "yes"})
            self.assertEqual((res.exit, res.questions, log), (0, [], []))
            [note] = [n for n in res.notes if "was not used" in n]
            self.assertIn("already answered (kept as it is)", note)
            self.assertNotIn("asked again", note)

    def test_an_answer_for_a_fix_by_hand_row_says_so(self):
        vault = make_vault(self)
        c, _ = check("broken", "asks", lambda: [Item(
            "broken", PERSON, ["Notes/A.md\tfix this by hand"])])
        res = self.run_update(vault, [c], {"broken": "yes"})
        self.assertTrue(any("Nothing to answer: broken is fixed by hand" in n
                            for n in res.notes), res.notes)

    def test_the_report_names_each_question_by_its_answer_id(self):
        vault = make_vault(self)
        r, _ = check("drop", "removes", will_item("drop"))
        _code, out, _ = self.main(vault, [r])
        self.assertIn(tag("drop"), out)


class OutputTests(Base):
    """The report always reaches the GM: any encoding, any failure."""

    def named_vault(self, name):
        base = Path(tempfile.mkdtemp(prefix="upd-named-"))
        self.addCleanup(shutil.rmtree, base, ignore_errors=True)
        vault = make_vault(self)
        return Path(shutil.move(str(vault), str(base / name)))

    def cp1252_main(self, vault, checks, *args):
        raw = io.BytesIO()
        out = io.TextIOWrapper(raw, encoding="cp1252", errors="strict")
        err = io.TextIOWrapper(io.BytesIO(), encoding="cp1252", errors="strict")
        with mock.patch.object(migrate, "CHECKS", checks), \
                mock.patch.object(update, "HOME", self.home), \
                mock.patch.object(sys, "stdout", out), \
                mock.patch.object(sys, "stderr", err):
            code = update.main([str(vault), *args])
            sys.stdout.flush()
        return code, raw.getvalue().decode("utf-8")

    def test_a_cp1252_stdout_still_gets_the_report_of_a_non_ascii_vault(self):
        vault = self.named_vault("カンティクル Café")
        for args in ((), ("--json",)):
            with self.subTest(args=args):
                b, _ = check("tidy", "bookkeeping", will_item("tidy"))
                code, text = self.cp1252_main(vault, [b], *args)
                self.assertIn(code, (0,), text)
                self.assertIn("カンティクル Café", text)

    def test_an_unexpected_error_in_a_step_still_reports_what_finished(self):
        vault = make_vault(self)
        first = file_check(vault, "first", "removes")

        def boom():
            def apply(_v):
                raise RuntimeError("not a step failure")
            return [Item("boom", WILL, ["do boom"], apply)]
        bad, _ = check("boom", "bookkeeping", boom)
        for args in ((), ("--json",)):
            with self.subTest(args=args):
                (vault / "first.done").unlink(missing_ok=True)
                code, out, err = self.main(vault, [first, bad],
                                           "--answer", tag("first") + "=yes",
                                           *args)
                self.assertEqual(code, 1)
                self.assertIn("not a step failure", out)
                self.assertIn("Plainly did first.", out)
                if args:
                    self.assertEqual(json.loads(out)["exit"], 1)

    def test_a_record_that_cannot_be_written_for_the_settings_still_reports(self):
        from vaultlib import SettingsUnavailable
        vault = make_vault(self)
        b, _ = check("tidy", "bookkeeping", will_item("tidy"))
        with mock.patch.object(update, "_save_record",
                               side_effect=SettingsUnavailable("tool broke")):
            code, out, _ = self.main(vault, [b])
        self.assertEqual(code, 1)
        self.assertIn("Plainly did tidy.", out)
        self.assertIn("tool broke", out)
        self.assertEqual(stamp_of(vault), "1.10.12")


class ReportTests(Base):
    """What the update says: the report's words, its JSON, its refusals."""

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
        self.assertIn("update stamp of 1.9.14 (_meta/vault-state.json), older than 1.10.12", err)
        self.assertEqual(self.backups(), [])

    def test_an_unmoved_vault_exits_2_naming_the_bridge(self):
        vault = make_vault(self, "1.10.121")
        (vault / "_meta" / "publish-manifest.md").write_text("x\n", encoding="utf-8")
        c, _ = check("tidy", "bookkeeping", will_item("tidy"))
        with mock.patch.object(vc, "MOVED_FLOOR", REAL_FLOOR):
            code, _, err = self.main(vault, [c])
        self.assertEqual(code, 2)
        self.assertIn("_meta/publish-manifest.md is the old publish list", err)
        self.assertIn("releases/tag/v1.10.137", err)
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
        self.run_update(vault, [r], {tag("drop", ["drop the old section"]): "leave"})
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
