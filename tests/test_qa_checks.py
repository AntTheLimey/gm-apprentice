#!/usr/bin/env python3
"""campaign-qa's hand procedures as code (qa_checks.py): `stories`,
`timeline --order`, `report-new` and `report-stats`.

Run: python3 tests/test_qa_checks.py
"""

import datetime
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "skills" / "shared" / "scripts"
SCRIPT = SCRIPTS / "vault_check.py"
sys.path.insert(0, str(SCRIPTS))

import qa_checks as qa  # noqa: E402
import vaultlib  # noqa: E402

HAS_NODE = shutil.which("node") is not None


def make(case, files):
    root = Path(tempfile.mkdtemp(prefix="qa-checks-"))
    case.addCleanup(shutil.rmtree, root, ignore_errors=True)
    for rel, text in files.items():
        (root / rel).parent.mkdir(parents=True, exist_ok=True)
        (root / rel).write_text(text, encoding="utf-8")
    return root


def run_cli(vault, *args):
    return subprocess.run([sys.executable, str(SCRIPT), str(vault), *args],
                          capture_output=True, text=True,
                          stdin=subprocess.DEVNULL)


def pc(status="alive"):
    return f"---\ntype: pc\nstatus: {status}\n---\n"


def story(as_of):
    return f'---\ntype: character-story\nasOfSession: "{as_of}"\n---\n'


def wrap(chapter, n):
    return (f'---\ntype: session_wrap\nchapter: "[[Chapter {chapter} - X]]"\n'
            f"session_number: {n}\n---\n")


class StoriesTests(unittest.TestCase):
    def test_a_living_pc_with_no_story_file_is_reported(self):
        v = make(self, {"Characters/PCs/Ada.md": pc(),
                        "Characters/PCs/Bo.md": pc(),
                        "Characters/PCs/Bo_Story.md": story("1")})
        rows = qa.check_stories(v)
        self.assertEqual(len(rows), 1, rows)
        self.assertTrue(rows[0].startswith("WARNING\tCharacters/PCs/Ada.md\t"))
        self.assertIn("Ada_Story.md", rows[0])

    def test_dead_and_retired_pcs_need_no_story(self):
        v = make(self, {"Characters/PCs/Ada.md": pc("dead"),
                        "Characters/PCs/Bo.md": pc("retired")})
        self.assertEqual(qa.check_stories(v), [])

    def test_an_archived_template_is_not_a_pc(self):
        v = make(self, {"_archive/templates/_Template_PC.md": pc()})
        self.assertEqual(qa.check_stories(v), [])

    def test_one_session_behind_is_current_two_is_stale(self):
        files = {f"Chapters/Chapter 1 - X/W{n}.md": wrap(1, n)
                 for n in range(1, 13)}
        files.update({"PCs/Ada.md": pc(), "PCs/Ada_Story.md": story("11"),
                      "PCs/Bo.md": pc(), "PCs/Bo_Story.md": story("10")})
        rows = qa.check_stories(make(self, files))
        self.assertEqual(len(rows), 1, rows)
        self.assertIn("PCs/Bo_Story.md", rows[0])
        self.assertIn("2 Wrap-Ups ahead", rows[0])

    def test_numbering_that_restarts_each_chapter_counts_wrap_ups_between(self):
        files = {"Chapters/Chapter 3 - X/W13.md": wrap(3, 13),
                 "Chapters/Chapter 3 - X/W14.md": wrap(3, 14),
                 "Chapters/Chapter 4 - Y/W1.md": wrap(4, 1),
                 "Chapters/Chapter 4 - Y/W2.md": wrap(4, 2),
                 "PCs/Ada.md": pc(),
                 "PCs/Ada_Story.md": story("Chapter 4, Session 1"),
                 "PCs/Bo.md": pc(),
                 "PCs/Bo_Story.md": story("Chapter 3, Session 14")}
        rows = qa.check_stories(make(self, files))
        self.assertEqual(len(rows), 1, rows)
        self.assertIn("PCs/Bo_Story.md", rows[0])

    def test_a_story_with_no_readable_session_is_reported(self):
        v = make(self, {"W1.md": wrap(1, 1), "PCs/Ada.md": pc(),
                        "PCs/Ada_Story.md": story("Chapter 2 - Lyon")})
        rows = qa.check_stories(v)
        self.assertEqual(len(rows), 1, rows)
        self.assertIn("names no session", rows[0])

    def test_a_story_file_that_is_not_utf8_does_not_stop_the_walk(self):
        v = make(self, {"W1.md": wrap(1, 1), "PCs/Ada.md": pc(),
                        "PCs/Bo.md": pc(), "PCs/Bo_Story.md": story("1")})
        (v / "PCs/Ada_Story.md").write_bytes(
            story("1").encode("utf-8") + b"\xff\xfe broken\n")
        self.assertEqual(qa.check_stories(v), [])

    def test_cli_emits_the_section(self):
        v = make(self, {"PCs/Ada.md": pc()})
        proc = run_cli(v, "stories")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("## stories\n# count: 1\n", proc.stdout)


def session(chapter, n, date):
    return (f'---\ntype: session\nchapter: "[[Chapter {chapter} - X]]"\n'
            f"session_number: {n}\nin_game_date: {date}\n---\n")


@unittest.skipUnless(HAS_NODE, "needs node")
class SessionOrderTests(unittest.TestCase):
    def rows(self, *sessions):
        files = {f"Chapters/Chapter {c} - X/S{n}.md": session(c, n, d)
                 for c, n, d in sessions}
        return qa.check_session_order(make(self, files))

    def test_a_date_that_goes_backwards_is_reported(self):
        rows = self.rows((1, 1, '"August 5, 1814"'), (1, 2, '"August 3, 1814"'),
                         (1, 3, '"August 6, 1814"'))
        self.assertEqual(len(rows), 1, rows)
        self.assertIn("S2.md", rows[0])

    def test_the_same_day_is_not_backwards(self):
        self.assertEqual(self.rows((1, 1, '"August 5, 1814"'),
                                   (1, 2, '"August 5, 1814"')), [])

    def test_sessions_sort_by_chapter_then_number(self):
        # Chapter 2's session 1 comes after chapter 1's session 9.
        self.assertEqual(self.rows((1, 9, '"August 9, 1814"'),
                                   (2, 1, '"August 12, 1814"'),
                                   (1, 10, '"August 10, 1814"')), [])

    def test_ten_sorts_after_nine(self):
        self.assertEqual(self.rows((1, 9, '"August 9, 1814"'),
                                   (1, 10, '"August 10, 1814"')), [])

    def test_a_date_with_no_day_is_compared_by_month(self):
        # The timeline places "late September" on the 1st, so a session on
        # the 20th before it is not a reversal.
        self.assertEqual(self.rows((1, 1, '"September 20, 1814"'),
                                   (1, 2, '"Late September 1814"')), [])
        self.assertEqual(len(self.rows((1, 1, '"September 20, 1814"'),
                                       (1, 2, '"Early August 1814"'))), 1)

    def test_a_range_starts_on_its_first_day(self):
        self.assertEqual(self.rows((1, 1, '"August 12-20, 1814"'),
                                   (1, 2, '"August 13, 1814"')), [])

    def test_undated_sessions_are_skipped(self):
        self.assertEqual(self.rows((1, 1, '"August 5, 1814"'), (1, 2, "null"),
                                   (1, 3, '"August 6, 1814"')), [])

    def test_dates_are_the_publish_tools_own_reading(self):
        # Unparseable text is no date; and the tool, not this module, says so.
        self.assertEqual(self.rows((1, 1, '"August 5, 1814"'),
                                   (1, 2, '"someday"')), [])

    def test_cli_flag(self):
        v = make(self, {"Chapters/Chapter 1 - X/S1.md": session(1, 1, '"May 5, 1814"'),
                        "Chapters/Chapter 1 - X/S2.md": session(1, 2, '"May 1, 1814"')})
        proc = run_cli(v, "timeline", "--order")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("# count: 1", proc.stdout)


class SessionOrderOldToolTests(unittest.TestCase):
    def test_a_tool_without_the_dates_op_is_named_with_its_fix(self):
        from unittest import mock
        v = make(self, {"Chapters/Chapter 1 - X/S1.md":
                        session(1, 1, '"May 5, 1814"')})
        refuse = vaultlib.PublishToolUnavailable(
            'the publish tool refused: unknown op: "dates"')
        with mock.patch.object(vaultlib.PUBLISH_LINES, "ask",
                               side_effect=refuse):
            rows = qa.check_session_order(v)
        self.assertEqual(rows, [
            "ERROR\t(vault)\ttimeline --order did not run: the site's publish "
            "tool predates 1.41.0 and is too old for this check — run "
            "update-pin, then run this again"])


    OLD_TOOL = (Path.home() / ".claude/plugins/cache/gm-apprentice/"
                "gm-apprentice/1.10.77/tools/publish/bin/gm-publish.js")

    @unittest.skipUnless(OLD_TOOL.is_file(), "no installed 1.10.77 tool")
    def test_a_real_tool_before_dates_is_named_with_its_fix(self):
        # The installed tool 1.36.2 checks `text` before the op, so the
        # question as first asked drew "text must be a string".
        from unittest import mock
        v = make(self, {"Chapters/Chapter 1 - X/S1.md":
                        session(1, 1, '"May 5, 1814"')})
        old = vaultlib.PublishLines(self.OLD_TOOL)
        self.addCleanup(old.close)
        with mock.patch.object(vaultlib, "PUBLISH_LINES", old):
            rows = qa.check_session_order(v)
        self.assertEqual(len(rows), 1, rows)
        self.assertIn("predates 1.41.0 and is too old for this check — run "
                      "update-pin", rows[0])

    def test_text_must_be_a_string_also_means_too_old(self):
        from unittest import mock
        v = make(self, {"Chapters/Chapter 1 - X/S1.md":
                        session(1, 1, '"May 5, 1814"')})
        refuse = vaultlib.PublishToolUnavailable(
            "the publish tool refused: text must be a string")
        with mock.patch.object(vaultlib.PUBLISH_LINES, "ask",
                               side_effect=refuse):
            rows = qa.check_session_order(v)
        self.assertIn("too old for this check", rows[0])

    def test_the_question_carries_a_text(self):
        from unittest import mock
        v = make(self, {"Chapters/Chapter 1 - X/S1.md":
                        session(1, 1, '"May 5, 1814"')})
        with mock.patch.object(vaultlib.PUBLISH_LINES, "ask",
                               return_value={"dates": [{"iso": "1814-05-05",
                                                        "day": True}]}) as ask:
            qa.check_session_order(v)
        self.assertEqual(ask.call_args[0][0]["text"], "")


class ActivePcsArchiveTests(unittest.TestCase):
    def test_an_archived_template_is_not_an_active_pc(self):
        v = make(self, {"_archive/t/_Template_PC.md": pc(),
                        "Characters/PCs/Ada.md": pc()})
        self.assertEqual([r for r, _ in vaultlib.active_pcs(v)],
                         ["Characters/PCs/Ada.md"])


class ReportNewTests(unittest.TestCase):
    def test_creates_the_file_with_frontmatter(self):
        v = make(self, {})
        out = qa.report_new(v, "canon_audit", "full_vault", "2026-03-27")
        self.assertEqual(out, ["_QA/QA_canon_audit_2026-03-27.md"])
        text = (v / out[0]).read_text(encoding="utf-8")
        fm = vaultlib.extract_frontmatter(text) or {}
        self.assertEqual((fm["type"], fm["mode"], fm["scope"], fm["date"]),
                         ("qa_report", "canon_audit", "full_vault",
                          "2026-03-27"))
        for key in qa.STAT_KEYS:
            self.assertIn(f"  {key}: 0\n", text)
        self.assertIn("## Critical Findings", text)

    def test_the_next_free_name_gets_a_suffix(self):
        v = make(self, {})
        names = [qa.report_new(v, "timeline", "custom", "2026-03-27")[0]
                 for _ in range(3)]
        self.assertEqual(names, ["_QA/QA_timeline_2026-03-27.md",
                                 "_QA/QA_timeline_2026-03-27_2.md",
                                 "_QA/QA_timeline_2026-03-27_3.md"])

    def test_a_bad_mode_scope_or_date_is_refused_and_writes_nothing(self):
        v = make(self, {})
        for args in (("Canon Audit", "full_vault"), ("canon_audit", "chapter"),
                     ("canon_audit", "full_vault", "27/03/2026")):
            with self.assertRaises(ValueError):
                qa.report_new(v, *args)
        self.assertEqual(list(v.rglob("*.md")), [])

    def test_cli_prints_the_path(self):
        v = make(self, {})
        proc = run_cli(v, "report-new", "--mode", "full_audit", "--scope",
                       "chapter_4", "--date", "2026-10-18")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(proc.stdout.strip(), "_QA/QA_full_audit_2026-10-18.md")
        self.assertEqual(run_cli(v, "report-new", "--mode", "x").returncode, 2)


REPORT = """---
type: qa_report
mode: full_audit
scope: full_vault
date: {today}
vault_stats:
  entities_scanned: 0
  findings_total: 0
tags: [qa]
---

# QA Report

## Summary

### Not a finding

## Critical Findings

### C1 — one

**Status:** Fixed (2026-10-04)

### C2 — two

**Status:** Pending

## Warning Findings

### W1 — three

**Status:** Skipped

### W2 — four

**Status:** Dismissed — not a problem

### W3 — five

**Status:** Fixed and deployed

## Info Findings

| Finding | Files | Category | Status |
|---------|-------|----------|--------|
| a | [[x]] | Canon | Fixed |
| b | [[y]] | Canon | Pending |

## Dismissed Findings Register

| Finding | Reason | Files |
|---------|--------|-------|
| four | fine | [[z]] |
"""
REPORT = REPORT.replace("{today}", datetime.date.today().isoformat())


class ReportStatsTests(unittest.TestCase):
    def stats(self, text=REPORT, extra=None):
        files = {"_QA/QA_full_audit_2026-10-04.md": text,
                 "Characters/Ada.md": "---\ntype: npc\n---\n",
                 "Characters/Bo.md": "---\ntype: npc\n---\n",
                 "Notes/plain.md": "no frontmatter\n"}
        files.update(extra or {})
        v = make(self, files)
        lines = qa.report_stats(v, "_QA/QA_full_audit_2026-10-04.md")
        return v, dict(ln.split(": ") for ln in lines)

    def test_counts_the_nine(self):
        _, got = self.stats()
        self.assertEqual(got, {
            "entities_scanned": "2", "files_read": "3",
            "findings_total": "7", "findings_critical": "2",
            "findings_warning": "3", "findings_info": "2",
            "findings_fixed": "3", "findings_skipped": "1",
            "findings_dismissed": "1"})

    def test_rewrites_the_report_frontmatter_and_keeps_the_rest(self):
        v, got = self.stats()
        text = (v / "_QA/QA_full_audit_2026-10-04.md").read_text(
            encoding="utf-8")
        fm = vaultlib.extract_frontmatter(text) or {}
        self.assertEqual(text.count("vault_stats:"), 1)
        for key in qa.STAT_KEYS:
            self.assertRegex(text, rf"\n  {key}: {got[key]}\n")
        self.assertEqual(fm["tags"], ["qa"])
        self.assertTrue(text.endswith(REPORT[REPORT.index("\n---\n\n# QA") + 5:]))

    def test_a_report_with_no_vault_stats_gets_the_block(self):
        text = REPORT.replace(
            "vault_stats:\n  entities_scanned: 0\n  findings_total: 0\n",
            "")
        v, got = self.stats(text)
        self.assertEqual(got["findings_total"], "7")
        self.assertIn("vault_stats:", (v / "_QA/QA_full_audit_2026-10-04.md"
                                       ).read_text(encoding="utf-8"))

    def test_an_info_table_with_no_status_column_counts_each_row(self):
        text = REPORT.replace(
            "| Finding | Files | Category | Status |\n"
            "|---------|-------|----------|--------|\n"
            "| a | [[x]] | Canon | Fixed |\n| b | [[y]] | Canon | Pending |",
            "| # | Finding | Files | Check |\n|---|---|---|---|\n"
            "| I1 | a | [[x]] | Canon |\n"
            "| I2 | **FIXED 2026-10-07.** b | [[y]] | Canon |\n"
            "| I3 | c | [[y]] | Canon |")
        _, got = self.stats(text)
        self.assertEqual((got["findings_info"], got["findings_total"],
                          got["findings_fixed"]), ("3", "8", "3"))

    def test_a_heading_with_no_status_line_is_not_a_finding(self):
        text = REPORT.replace("## Dismissed Findings Register",
                              "### Not yet written\n\n- `Foo` — 3 notes\n\n"
                              "## Dismissed Findings Register")
        _, got = self.stats(text)
        self.assertEqual((got["findings_total"], got["findings_info"]),
                         ("7", "2"))

    def test_the_report_itself_and_other_reports_are_not_scanned(self):
        _, got = self.stats(extra={"_QA/QA_other.md": REPORT})
        self.assertEqual(got["files_read"], "3")

    def test_a_chapter_scope_counts_that_chapter(self):
        text = REPORT.replace("scope: full_vault", "scope: chapter_4")
        _, got = self.stats(text, {
            "Chapters/Chapter 4 - Y/s.md":
                '---\ntype: session\nchapter: "[[Chapter 4 - Y]]"\n---\n',
            "Chapters/Chapter 3 - Z/s.md":
                '---\ntype: session\nchapter: "[[Chapter 3 - Z]]"\n---\n'})
        self.assertEqual((got["entities_scanned"], got["files_read"]),
                         ("1", "1"))

    PATH = "_QA/QA_full_audit_2026-10-04.md"

    def old_report(self, stats, extra=None, **kw):
        """A report whose vault_stats is `stats` (key: value lines), in a
        vault with 2 typed notes and 1 plain one."""
        text = REPORT.replace(
            "vault_stats:\n  entities_scanned: 0\n  findings_total: 0\n",
            "vault_stats:\n" + stats)
        files = {self.PATH: text,
                 "Characters/Ada.md": "---\ntype: npc\n---\n",
                 "Characters/Bo.md": "---\ntype: npc\n---\n",
                 "Notes/plain.md": "no frontmatter\n"}
        files.update(extra or {})
        return make(self, files)

    def test_other_vault_stats_keys_stay(self):
        v = self.old_report("  entities_scanned: 0\n  site_faults: 86\n"
                            "  checks_run: [a, b]\n")
        qa.report_stats(v, self.PATH)
        text = (v / self.PATH).read_text(encoding="utf-8")
        self.assertIn("\n  site_faults: 86\n", text)
        self.assertIn("\n  checks_run: [a, b]\n", text)
        self.assertIn("\n  findings_total: 7\n", text)
        self.assertEqual(text.count("site_faults"), 1)

    def test_scan_counts_already_in_the_report_are_kept(self):
        v = self.old_report("  entities_scanned: 400\n  files_read: 520\n"
                            "  findings_total: 0\n")
        lines = dict(ln.split(": ") for ln in qa.report_stats(v, self.PATH))
        self.assertEqual((lines["entities_scanned"], lines["files_read"]),
                         ("400", "520"))

    def test_an_older_reports_scan_counts_are_not_taken_from_todays_vault(self):
        v = self.old_report("  entities_scanned: 0\n  files_read: 0\n")
        path = v / self.PATH
        path.write_text(path.read_text(encoding="utf-8").replace(
            f"date: {datetime.date.today().isoformat()}", "date: 2026-05-08"),
            encoding="utf-8")
        out = qa.report_stats(v, self.PATH)
        lines = dict(ln.split(": ") for ln in out if not ln.startswith("#"))
        self.assertEqual((lines["entities_scanned"], lines["files_read"],
                          lines["findings_total"]), ("0", "0", "7"))
        note = "# scan counts not taken from today's vault (the report is " \
               "dated 2026-05-08, not today)"
        self.assertEqual(out[-1], note)
        self.assertEqual(qa.report_stats(v, self.PATH, dry_run=True)[-1],
                         note)

    def test_a_count_that_is_not_a_number_is_left_as_written(self):
        v = self.old_report("  entities_scanned: 272+\n  files_read: 200+\n"
                            "  findings_fixed: \"5\"\n")
        dry = qa.report_stats(v, self.PATH, dry_run=True)
        self.assertIn("entities_scanned: 272+ (kept, not a number)", dry)
        self.assertIn('findings_fixed: "5" (kept, not a number)', dry)
        for force in (False, True):
            qa.report_stats(v, self.PATH, force=force)
            text = (v / self.PATH).read_text(encoding="utf-8")
            self.assertIn("\n  entities_scanned: 272+\n", text)
            self.assertIn("\n  files_read: 200+\n", text)
            self.assertIn('\n  findings_fixed: "5"\n', text)
            self.assertIn("\n  findings_total: 7\n", text)

    def test_only_a_qa_report_is_written(self):
        v = make(self, {"CONTINUE_HERE.md": "---\ntype: note\n---\n\nx\n",
                        "plain.md": "no frontmatter\n"})
        for rel in ("CONTINUE_HERE.md", "plain.md"):
            with self.assertRaises(ValueError):
                qa.report_stats(v, rel)
        with self.assertRaisesRegex(ValueError, "not a QA report"):
            qa.report_stats(v, "CONTINUE_HERE.md")
        self.assertEqual((v / "CONTINUE_HERE.md").read_text(encoding="utf-8"),
                         "---\ntype: note\n---\n\nx\n")

    def test_a_count_that_would_drop_is_refused_unless_forced(self):
        v = self.old_report("  findings_total: 86\n  findings_fixed: 52\n")
        before = (v / self.PATH).read_text(encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "findings_total 86 -> 7"):
            qa.report_stats(v, self.PATH)
        self.assertEqual((v / self.PATH).read_text(encoding="utf-8"), before)
        lines = dict(ln.split(": ") for ln in
                     qa.report_stats(v, self.PATH, force=True))
        self.assertEqual(lines["findings_total"], "7")

    def test_a_dry_run_prints_old_and_new_and_writes_nothing(self):
        v = self.old_report("  findings_total: 86\n  files_read: 5\n")
        before = (v / self.PATH).read_text(encoding="utf-8")
        out = qa.report_stats(v, self.PATH, dry_run=True)
        self.assertEqual((v / self.PATH).read_text(encoding="utf-8"), before)
        self.assertIn("findings_total: 86 -> 7  (refused: lower; needs "
                      "--force)", out)
        self.assertIn("files_read: 5 -> 5", out)
        self.assertIn("findings_critical: - -> 2", out)

    def test_cli_dry_run_and_force(self):
        v = self.old_report("  findings_total: 86\n")
        proc = run_cli(v, "report-stats", "--file", self.PATH)
        self.assertEqual(proc.returncode, 2)
        proc = run_cli(v, "report-stats", "--file", self.PATH, "--dry-run")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("findings_total: 86 -> 7", proc.stdout)
        proc = run_cli(v, "report-stats", "--file", self.PATH, "--force")
        self.assertEqual(proc.returncode, 0, proc.stderr)

    def test_cli_needs_one_file_and_prints_the_counts(self):
        v = make(self, {"_QA/r.md": REPORT})
        self.assertEqual(run_cli(v, "report-stats").returncode, 2)
        proc = run_cli(v, "report-stats", "--file", "_QA/r.md")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertTrue(re.search(r"^findings_total: 7$", proc.stdout, re.M))


if __name__ == "__main__":
    unittest.main()
