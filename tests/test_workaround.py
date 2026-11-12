"""workaround.py and the update's offers: workarounds recorded by the issue
they stand in for, offered for retirement once GitHub says a release ships it."""

import contextlib
import io
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parent.parent / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import github_issues  # noqa: E402
import migrate  # noqa: E402
import update  # noqa: E402
import update_record  # noqa: E402
import workaround  # noqa: E402
from test_migrate import make_vault  # noqa: E402
from layouts import write_config  # noqa: E402
import vaultlib  # noqa: E402

class FakeHub:
    """GitHub as the tests set it: #510 closed as fixed on 2026-11-04 at
    10:00, between 1.10.128 (the day before) and 1.10.129 (at 12:00)."""

    def __init__(self):
        self.issues = {510: github_issues.Issue(
            "closed", "completed", "2026-11-04T10:00:00Z")}
        self.releases = {"1.10.128": "2026-11-03T12:00:00Z",
                         "1.10.129": "2026-11-04T12:00:00Z"}
        self.asked = []
        self.slow = False

    def __call__(self, timeout=None):
        return self

    def issue(self, number):
        self.asked.append(number)
        return self.issues.get(number)

    def published(self, version):
        return self.releases.get(version)


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
        self.hub = FakeHub()
        self.bin = tmp / "bin"   # PATH holds only this: no gh unless a test puts one
        self.bin.mkdir()
        node = shutil.which("node")   # the settings are read through node
        if node:
            (self.bin / Path(node).name).symlink_to(node)
        self.gh_log = tmp / "gh.log"
        p = mock.patch.dict(os.environ, {"PATH": str(self.bin)})
        p.start()
        self.addCleanup(p.stop)
        for target, attr, value in (
                (github_issues, "GitHub", self.hub),
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
        workaround.swept(self.vault, no_memory=True)

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
                     dict(where=("",)), dict(where=(".",)), dict(where=("  ",)),
                     dict(release="soon")):
            with self.subTest(args=args), self.assertRaises(workaround.Refused):
                self.add(**args)
        with self.assertRaises(workaround.Refused):
            workaround.add(self.vault, 510, "x", "poem", ["PCs/Six.md"])
        self.assertEqual(self.record()["workarounds"], [])

    def test_a_site_path_resolves_against_the_site_folder(self):
        site = Path(tempfile.mkdtemp(prefix="wa-site-"))
        self.addCleanup(shutil.rmtree, site, ignore_errors=True)
        (site / "css").mkdir(parents=True)
        (site / "css" / "overrides.css").write_text("a{}\n", encoding="utf-8")
        write_config(self.vault, "---\ntype: meta\npublish:\n"
                                 f"  site_dir: {site}\n---\n")
        vaultlib.forget_settings(self.vault)
        workaround_vault = self.vault
        w = workaround.add(workaround_vault, 608, "Fix in css", "css",
                           ["site:css/overrides.css"])
        self.assertEqual(w["where"], ["site:css/overrides.css"])
        for bad in ("site:", "site:css/none.css", "site:../x", "site:/etc/hosts"):
            with self.subTest(where=bad), self.assertRaises(workaround.Refused):
                workaround.add(workaround_vault, 608, "x", "css", [bad])

    def test_a_site_path_needs_a_site_folder(self):
        with self.assertRaises(workaround.Refused) as cm:
            self.add(where=("site:css/overrides.css",))
        self.assertIn("no site folder", str(cm.exception))

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
        code, _, err = wa(self.vault, "swept")
        self.assertEqual(code, 2)   # no scan read a memory folder
        self.assertIn("--no-memory", err)
        self.assertIsNone(self.record()["swept"])
        self.assertEqual(wa(self.vault, "swept", "--no-memory")[0], 0)
        self.assertIsNotNone(self.record()["swept"])
        self.assertEqual(self.record()["swept_memory"], "none (--no-memory)")
        code, _, err = wa(self.vault, "keep", "nobody")
        self.assertEqual(code, 2)
        self.assertIn("gravity-by-hand", err)
        code, _, err = wa(self.vault, "add", "--issue", "x", "--what", "y",
                          "--kind", "note", "--where", "PCs/Six.md")
        self.assertEqual(code, 2)


class AlreadyFixedTests(Base):
    def test_add_says_when_github_already_has_it_fixed(self):
        code, out, _ = wa(self.vault, "add", "--issue", "510", "--what",
                          "Gravity by hand", "--kind", "note",
                          "--where", "PCs/Six.md")
        self.assertEqual(code, 0)
        self.assertIn("#510 is already closed as fixed on GitHub. If that "
                      "fix only partly covers it, run this add again with "
                      "--release set to the release that finishes it; "
                      "otherwise the next update may offer it for "
                      "retirement.", out)
        self.assertEqual(len(self.record()["workarounds"]), 1)   # still added
        code, out, _ = wa(self.vault, "add", "--issue", "510", "--what",
                          "Gravity by hand", "--kind", "note",
                          "--where", "PCs/Six.md", "--release", "1.10.140")
        self.assertEqual(code, 0, out)
        self.assertIn("Set gravity-by-hand's release to 1.10.140", out)
        self.assertNotIn("already closed", out)
        [w] = self.record()["workarounds"]
        self.assertEqual(w["release"], "1.10.140")

    def test_no_notice_for_an_open_or_unknown_issue(self):
        self.hub.issues[998] = github_issues.Issue("open", None, None)
        for issue in ("998", "999"):
            _, out, _ = wa(self.vault, "add", "--issue", issue, "--what", "x",
                           "--kind", "note", "--where", "PCs/Six.md")
            self.assertNotIn("already closed", out)

    def test_no_notice_for_an_issue_closed_as_not_planned_or_duplicate(self):
        for issue, reason in (("997", "not_planned"), ("996", "duplicate")):
            self.hub.issues[int(issue)] = github_issues.Issue(
                "closed", reason, "2026-11-01T00:00:00Z")
            _, out, _ = wa(self.vault, "add", "--issue", issue, "--what", "x",
                           "--kind", "note", "--where", "PCs/Six.md")
            self.assertNotIn("already closed", out)


class MemoryFolderTests(Base):
    def setUp(self):
        super().setUp()
        self.home_dir = Path(tempfile.mkdtemp(prefix="wa-home-"))
        self.addCleanup(shutil.rmtree, self.home_dir, ignore_errors=True)
        p = mock.patch.dict(os.environ, {"HOME": str(self.home_dir),
                                         "USERPROFILE": str(self.home_dir)})
        p.start()
        self.addCleanup(p.stop)
        # A vault folder with an underscore and a space, as Ant's have.
        self.odd = self.vault.parent / f"{self.vault.name}_My Vault.x"
        self.vault.rename(self.odd)
        self.vault = self.odd
        self.addCleanup(shutil.rmtree, self.odd, ignore_errors=True)
        name = "".join(c if c.isalnum() else "-" for c in str(self.vault))
        self.memory = self.home_dir / ".claude" / "projects" / name / "memory"

    def test_the_folder_name_swaps_every_other_character_for_a_dash(self):
        self.assertEqual(workaround.memory_folder(self.vault), self.memory)
        self.assertNotIn("_", self.memory.parent.name)

    def test_scan_reads_the_derived_folder_and_says_how_many_files(self):
        self.memory.mkdir(parents=True)
        (self.memory / "a.md").write_text("Gravity until #510.\n", encoding="utf-8")
        (self.memory / "b.md").write_text("nothing\n", encoding="utf-8")
        code, out, _ = wa(self.vault, "scan")
        self.assertEqual(code, 0)
        self.assertIn("memory:a.md:1\t#510\t", out)
        self.assertIn(f"Read 2 memory files from {self.memory}.", out)
        scanned = self.record()["scanned"]
        self.assertEqual((scanned["memory"], scanned["memory_files"]),
                         (str(self.memory), 2))
        self.assertEqual(wa(self.vault, "swept")[0], 0)
        self.assertEqual(self.record()["swept_memory"],
                         f"{self.memory} (2 files)")

    def test_no_folder_is_said_and_swept_then_wants_no_memory(self):
        code, out, _ = wa(self.vault, "scan", "--json")
        self.assertEqual(code, 0)
        data = json.loads(out)
        self.assertEqual((data["memory"], data["memory_files"], data["looked_in"]),
                         (None, 0, str(self.memory)))
        _, out, _ = wa(self.vault, "scan")
        self.assertIn(f"No memory folder found at {self.memory}", out)
        code, _, err = wa(self.vault, "swept")
        self.assertEqual(code, 2)
        self.assertIsNone(self.record()["swept"])
        self.assertEqual(wa(self.vault, "swept", "--no-memory")[0], 0)

    @unittest.skipIf(os.name != "posix" or os.geteuid() == 0,
                     "needs file permissions that bite")
    def test_an_unreadable_memory_file_or_agent_file_is_said(self):
        self.memory.mkdir(parents=True)
        bad = self.memory / "locked.md"
        bad.write_text("#510\n", encoding="utf-8")
        bad.chmod(0)
        self.addCleanup(bad.chmod, 0o644)
        sub = self.memory / "shut"
        sub.mkdir()
        sub.chmod(0)
        self.addCleanup(sub.chmod, 0o755)
        agent = self.vault / "CLAUDE.md"
        agent.write_text("#7\n", encoding="utf-8")
        agent.chmod(0)
        self.addCleanup(agent.chmod, 0o644)
        (self.memory / "latin1.md").write_bytes("caf\xe9 #511\n".encode("latin-1"))
        code, out, err = wa(self.vault, "scan")
        self.assertEqual(code, 0, err)
        self.assertNotIn("Traceback", err)
        self.assertIn("Could not read memory:locked.md", out)
        self.assertIn("Could not read memory:shut", out)
        self.assertIn("Could not read CLAUDE.md", out)
        self.assertIn("memory:latin1.md:1\t#511\t", out)   # read, not dropped


class AgentFileCaseTests(Base):
    def test_scan_reads_a_lower_case_claude_md_once(self):
        (self.vault / "claude.md").write_text("Waiting on #510.\n",
                                              encoding="utf-8")
        result = workaround.scan(self.vault, None)
        self.assertEqual([(h.file, h.issues) for h in result.hits],
                         [("claude.md", [510])])


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
        hits = workaround.scan(self.vault, memory).hits
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
        self.assertIn(f"Read 1 memory file from {memory}.", out)
        # The command writes only what it read, to the update record.
        rec = self.record()
        self.assertEqual(rec["workarounds"], [])
        self.assertEqual(rec["scanned"]["memory"], str(memory))


class BeforeReleaseTests(Base):
    plugin = "1.10.128"

    def test_a_workaround_is_offered_only_after_its_release(self):
        self.swept()
        self.add()   # #510 was closed after 1.10.128 came out
        res = self.update()
        self.assertEqual(res.questions, [])
        self.assertEqual(res.exit, 0)


class OfferTests(Base):
    def test_an_unknown_state_is_a_note_not_a_crash(self):
        self.swept()
        self.add()
        rec = self.record()
        rec["workarounds"][0]["state"] = "actve"
        update_record.save(self.vault, rec)
        res = self.update()
        self.assertEqual((res.exit, res.questions), (0, []))
        self.assertTrue(any("state 'actve'" in n and "fix it there" in n
                            for n in res.notes), res.notes)

    def test_a_non_list_where_is_a_note_not_a_crash(self):
        self.swept()
        self.add()
        rec = self.record()
        rec["workarounds"][0]["where"] = 5
        update_record.save(self.vault, rec)
        res = self.update()
        self.assertEqual((res.exit, res.questions), (0, []))
        self.assertTrue(any("where" in n and "not a list" in n
                            for n in res.notes), res.notes)

    def test_keep_on_a_retired_workaround_is_refused(self):
        w = self.add()
        workaround.retire(self.vault, w["id"], "built in")
        code, _, err = wa(self.vault, "keep", w["id"])
        self.assertNotEqual(code, 0)
        self.assertIn("already retired", err)
        self.assertEqual(self.record()["workarounds"][0]["state"], "retired")

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
            "#510. GitHub closed #510 as fixed on 2026-11-04, before 1.10.129 "
            "came out. If that release built in what this stands in for, "
            "retire it and switch to the built-in way; otherwise keep it.")

    def test_release_override_wins(self):
        self.swept()
        self.add(release="1.10.200")   # GitHub alone would offer it now
        self.assertEqual(self.update().questions, [])
        self.add(issue=9999, what="Unmapped", release="1.10.1")
        [q] = self.update().questions
        self.assertTrue(q.id.startswith("workaround:unmapped@"))
        self.assertIn("stands in for #9999. You set 1.10.1 by hand as the "
                      "release that builds it in. If that release", q.text)

    def test_a_hand_set_release_is_offered_once_reached(self):
        self.swept()
        self.add(release="1.10.125")
        [q] = self.update().questions
        self.assertIn("You set 1.10.125 by hand as the release that builds it "
                      "in.", q.text)
        self.assertEqual(q.detail["release"], "1.10.125")

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
                      "(campaign-organizer/references/workaround-sweep.md).",
                      update.report(res))
        self.swept()
        self.assertEqual(self.update().notes, [])

    def test_an_issue_still_open_on_github_is_not_offered(self):
        self.swept()
        self.hub.issues[510] = github_issues.Issue("open", None, None)
        self.add()
        self.add(what="Gravity in the GM notes")
        res = self.update()
        self.assertEqual((res.exit, res.questions), (0, []))
        self.assertIn("#510 is still open, so gravity-by-hand-on-the-sheet was "
                      "not offered.", res.notes)

    def test_closed_as_not_planned_is_said_not_offered(self):
        self.swept()
        self.hub.issues[510] = github_issues.Issue(
            "closed", "not_planned", "2026-11-04T10:00:00Z")
        self.add()
        res = self.update()
        self.assertEqual(res.questions, [])
        self.assertIn("#510 was closed as not planned, so "
                      "gravity-by-hand-on-the-sheet was not offered.", res.notes)

    def test_closed_as_duplicate_is_not_offered(self):
        self.swept()
        self.hub.issues[510] = github_issues.Issue(
            "closed", "duplicate", "2026-11-04T10:00:00Z")
        self.add()
        res = self.update()
        self.assertEqual(res.questions, [])
        self.assertIn("#510 was closed as duplicate, so "
                      "gravity-by-hand-on-the-sheet was not offered.", res.notes)

    def test_github_unreachable_checks_nothing_and_says_so_once(self):
        self.swept()
        self.hub.issues.clear()
        self.add()
        self.add(issue=511, what="Another")
        res = self.update()
        self.assertEqual((res.exit, res.questions), (0, []))
        self.assertEqual(res.notes, [update.NO_GITHUB])

    def test_an_unreleased_install_is_not_offered(self):
        self.swept()
        del self.hub.releases["1.10.129"]   # a build with no GitHub release
        self.add()
        res = self.update()
        self.assertEqual(res.questions, [])
        self.assertEqual(res.notes, [update.no_release("1.10.129")])

    def test_a_release_lookup_that_timed_out_says_could_not_ask(self):
        self.swept()
        del self.hub.releases["1.10.129"]
        self.hub.slow = True   # the release question timed out
        self.add()
        self.assertEqual(self.update().notes, [update.NO_GITHUB])

    def test_a_hand_set_release_is_offered_without_github(self):
        self.swept()
        self.hub.issues.clear()
        self.add(release="1.10.100")
        self.assertEqual(len(self.update().questions), 1)

    def test_a_hand_edited_issue_or_release_is_said_not_skipped(self):
        self.swept()
        self.add()
        self.add(what="Second")
        rec = self.record()
        rec["workarounds"][0]["issue"] = "510"
        rec["workarounds"][1]["release"] = "soon"
        update_record.save(self.vault, rec)
        res = self.update()
        self.assertEqual(res.questions, [])
        self.assertIn("gravity-by-hand-on-the-sheet has issue '510' in "
                      "_meta/update-record.json, not a number, so it was not "
                      "checked; fix it there.", res.notes)
        self.assertIn("second has release 'soon' in _meta/update-record.json, "
                      "not X.Y.Z, so it was not checked; fix it there.",
                      res.notes)


if __name__ == "__main__":
    unittest.main()
