#!/usr/bin/env python3
"""Regression tests for issue #219: `--file` (repeatable), `--folder` and
`--newer-than` scoping on `tables`, `relationships` and `pc-body`.

Wrap-up validation used to print every pre-existing finding vault-wide —
490 off-vocabulary relationship rows on a real vault, none of them about
the files a run just wrote. These commands now take the same `--file`
(repeatable, combines with `--folder`/`--newer-than` by AND) that
`wrapup` and `frontmatter`/`gm-leak`/`pc-body` already had a version of,
so a skill can scope validation to what it touched. A `--file` or
`--newer-than` value that doesn't resolve to a real, exactly-matching
vault file (wrong case, escapes the vault, absolute-vs-relative, a
skipped directory) is a CLI error, not a silently empty or silently
wrong report — `PathNormalizationTests` covers that resolution directly;
the earlier classes cover the ordinary scoping behaviour it sits under.

Run: python3 tests/test_vault_check_file_scope.py
"""

import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "skills" / "shared" / "scripts"
SCRIPT = SCRIPTS / "vault_check.py"
sys.path.insert(0, str(SCRIPTS))

import vault_check as vc  # noqa: E402

TABLES_FIXTURE = Path(__file__).resolve().parent / "fixtures" / "vault-check"
RELATIONSHIPS_FIXTURE = (Path(__file__).resolve().parent / "fixtures"
                         / "relationship-predicates")
LEAK = (Path(__file__).resolve().parent / "fixtures" / "slice-a" / "leak")
FENCED = "Characters/PCs/Fenced.md"
LATE = "Characters/PCs/Late.md"
BARE = "Characters/PCs/Bare.md"


def run_cli(vault, *args):
    """Run vault_check.py as the skills do — as a subprocess, so the exit
    code and stderr are the real ones, not an in-process return value."""
    return subprocess.run(
        [sys.executable, str(SCRIPT), str(vault), *args],
        capture_output=True, text=True)


def rows_for(rows, needle):
    return [r for r in rows if needle in r]


DIRTY_TABLE = ("---\ntype: reference\n---\n\n| a \\| b | c |\n|---|---|\n"
              "| x \\| y | z |\n")


def make_scoped_vault(case, tmp_dir=None):
    """A throwaway vault (with a sibling file, a skipped directory, and a
    spaced filename, for the path-normalization/escape tests) plus its
    parent directory. Returns (parent, vault). `tmp_dir` lets a caller
    force a specific temp root — `/tmp` on macOS is itself a symlink to
    `/private/tmp`, which is exactly the case the absolute-path handling
    has to get right."""
    parent = Path(tempfile.mkdtemp(prefix="vc-scope-", dir=tmp_dir))
    case.addCleanup(shutil.rmtree, parent, ignore_errors=True)
    vault = parent / "vault"
    (vault / "Notes").mkdir(parents=True)
    (vault / "Notes" / "Dirty Note.md").write_text(DIRTY_TABLE,
                                                   encoding="utf-8")
    (vault / "_Templates").mkdir()
    (vault / "_Templates" / "Ignored.md").write_text(DIRTY_TABLE,
                                                      encoding="utf-8")
    (vault / "Player Characters.md").write_text(DIRTY_TABLE,
                                                encoding="utf-8")
    (parent / "Outside.md").write_text(
        "---\ntype: reference\n---\n\noutside the vault\n", encoding="utf-8")
    return parent, vault


class TablesFileScopeTests(unittest.TestCase):
    """`Notes/Table Note.md` is the only file in this fixture with a table
    finding — everything else is a control for "did scoping exclude it"."""

    def test_unscoped_behaviour_unchanged(self):
        self.assertEqual(vc.check_tables(TABLES_FIXTURE),
                         vc.check_tables(TABLES_FIXTURE, None, None))

    def test_file_scoped_to_the_offending_file_keeps_its_findings(self):
        rows = vc.check_tables(TABLES_FIXTURE, None,
                               ["Notes/Table Note.md"])
        self.assertEqual(rows, vc.check_tables(TABLES_FIXTURE))
        self.assertTrue(rows)

    def test_file_scoped_to_a_clean_file_excludes_other_files_findings(self):
        rows = vc.check_tables(TABLES_FIXTURE, None,
                               ["Plans/Single Day.md"])
        self.assertEqual(rows, [])

    def test_folder_scoped_away_from_notes_is_silent(self):
        rows = vc.check_tables(TABLES_FIXTURE, "Plans")
        self.assertEqual(rows, [])

    def test_cli_file_flag_scopes_the_section(self):
        proc = run_cli(TABLES_FIXTURE, "tables", "--file",
                       "Plans/Single Day.md")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("# count: 0", proc.stdout)

    def test_cli_repeated_file_flag_is_additive(self):
        proc = run_cli(TABLES_FIXTURE, "tables",
                       "--file", "Plans/Single Day.md",
                       "--file", "Notes/Table Note.md")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("# count: 2", proc.stdout)


class RelationshipsFileScopeTests(unittest.TestCase):
    """`Off Vocabulary NPC.md` and `Mobrpg Sync.md` carry findings;
    `Clean NPC.md` and `Empty Edges.md` do not."""

    def test_unscoped_behaviour_unchanged(self):
        self.assertEqual(vc.check_relationships(RELATIONSHIPS_FIXTURE),
                         vc.check_relationships(RELATIONSHIPS_FIXTURE,
                                                None, None))

    def test_file_scoped_to_one_offender_excludes_the_other(self):
        rows = vc.check_relationships(
            RELATIONSHIPS_FIXTURE, None, ["Mobrpg Sync.md"])
        self.assertTrue(all("Mobrpg Sync.md" in r for r in rows), rows)
        self.assertTrue(rows)
        self.assertFalse(rows_for(rows, "Off Vocabulary NPC.md"))

    def test_file_scoped_to_a_clean_file_is_silent(self):
        rows = vc.check_relationships(
            RELATIONSHIPS_FIXTURE, None, ["Clean NPC.md"])
        self.assertEqual(rows, [])

    def test_cli_file_flag_scopes_the_section(self):
        proc = run_cli(RELATIONSHIPS_FIXTURE, "relationships",
                       "--file", "Clean NPC.md")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("# count: 0", proc.stdout)


class PcBodyFileScopeTests(unittest.TestCase):
    """`Characters/PCs/Fenced.md` and `.../Late.md` each carry a finding;
    scoping to one must not surface the other's."""

    def setUp(self):
        self.unscoped = vc.check_pc_body(LEAK)

    def test_unscoped_behaviour_unchanged(self):
        self.assertEqual(self.unscoped, vc.check_pc_body(LEAK, None, None))

    def test_file_scoped_to_fenced_excludes_late_and_bare(self):
        rows = vc.check_pc_body(LEAK, None, [FENCED])
        self.assertTrue(all(FENCED in r for r in rows), rows)
        self.assertTrue(rows)
        self.assertFalse(rows_for(rows, LATE))
        self.assertFalse(rows_for(rows, BARE))

    def test_file_list_combines_two_refreshed_pcs(self):
        rows = vc.check_pc_body(LEAK, None, [FENCED, LATE])
        seen = {r.split("\t")[1].split(":")[0] for r in rows}
        self.assertEqual(seen, {FENCED, LATE})

    def test_folder_and_file_combine_by_and(self):
        # FENCED is under Characters/PCs — a folder that excludes it must
        # win even though the file is named explicitly.
        rows = vc.check_pc_body(LEAK, "Characters/NPCs", [FENCED])
        self.assertEqual(rows, [])

    def test_cli_repeated_file_flag_scopes_the_section(self):
        proc = run_cli(LEAK, "pc-body", "--file", FENCED, "--file", LATE)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        seen_files = {r.split("\t")[1].split(":")[0]
                     for r in proc.stdout.splitlines()
                     if r.startswith(("ERROR\t", "WARNING\t", "INFO\t"))}
        self.assertEqual(seen_files, {FENCED, LATE})


class NonexistentFileTests(unittest.TestCase):
    """A `--file` naming no real vault file is a clear CLI error, not a
    silently empty report — across every command that accepts it."""

    def test_tables_reports_a_clear_error(self):
        proc = run_cli(TABLES_FIXTURE, "tables", "--file", "No/Such/File.md")
        self.assertEqual(proc.returncode, 2)
        self.assertIn("No/Such/File.md", proc.stderr)
        self.assertIn("not found", proc.stderr)
        self.assertEqual(proc.stdout, "")

    def test_relationships_reports_a_clear_error(self):
        proc = run_cli(RELATIONSHIPS_FIXTURE, "relationships",
                       "--file", "Nope.md")
        self.assertEqual(proc.returncode, 2)
        self.assertIn("Nope.md", proc.stderr)

    def test_pc_body_reports_a_clear_error(self):
        proc = run_cli(LEAK, "pc-body", "--file", "Characters/PCs/Nobody.md")
        self.assertEqual(proc.returncode, 2)
        self.assertIn("Characters/PCs/Nobody.md", proc.stderr)

    def test_wrapup_now_errors_on_a_genuinely_missing_path(self):
        # Before this validation existed, a nonexistent wrapup --file fell
        # through to the same "no wrap-up with that path" INFO row (exit
        # 0) as a real file of the wrong type — existence is now checked
        # first, so the two cases are no longer indistinguishable.
        proc = run_cli(LEAK, "wrapup", "--file", "Nowhere/Nothing.md")
        self.assertEqual(proc.returncode, 2)
        self.assertIn("Nowhere/Nothing.md", proc.stderr)

    def test_one_bad_path_among_several_still_errors(self):
        proc = run_cli(TABLES_FIXTURE, "tables",
                       "--file", "Notes/Table Note.md",
                       "--file", "No/Such/File.md")
        self.assertEqual(proc.returncode, 2)
        self.assertIn("No/Such/File.md", proc.stderr)

    def test_existing_file_of_the_wrong_type_is_not_this_error(self):
        # A real file that just has no findings is a clean scoped report,
        # not the "no such file" error — existence, not type, gates it.
        proc = run_cli(TABLES_FIXTURE, "tables",
                       "--file", "PCs/Varrio.md")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("# count: 0", proc.stdout)


class PathNormalizationTests(unittest.TestCase):
    """`--file` values are normalised once, up front, and a path that
    would never be walked — one escaping the vault, or landing in a
    skipped directory — is rejected the same as a nonexistent one."""

    def test_leading_dot_slash_matches_the_plain_form(self):
        parent, vault = make_scoped_vault(self)
        plain = run_cli(vault, "tables", "--file", "Notes/Dirty Note.md")
        dotted = run_cli(vault, "tables",
                         "--file", "./Notes/Dirty Note.md")
        self.assertEqual(plain.returncode, 0, plain.stderr)
        self.assertEqual(dotted.returncode, 0, dotted.stderr)
        self.assertEqual(plain.stdout, dotted.stdout)
        self.assertIn("Notes/Dirty Note.md", plain.stdout)

    def test_repeated_leading_dot_slash_is_also_stripped(self):
        parent, vault = make_scoped_vault(self)
        proc = run_cli(vault, "tables",
                       "--file", "././Notes/Dirty Note.md")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("Notes/Dirty Note.md", proc.stdout)

    def test_backslashes_are_converted_to_forward_slashes(self):
        parent, vault = make_scoped_vault(self)
        proc = run_cli(vault, "tables",
                       "--file", "Notes\\Dirty Note.md")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("Notes/Dirty Note.md", proc.stdout)

    def test_a_path_that_escapes_the_vault_is_rejected(self):
        # Real file, real relative path — but it resolves outside the
        # vault, which must be caught even though the file exists.
        parent, vault = make_scoped_vault(self)
        proc = run_cli(vault, "tables", "--file", "../Outside.md")
        self.assertEqual(proc.returncode, 2)
        self.assertIn("../Outside.md", proc.stderr)
        self.assertEqual(proc.stdout, "")

    def test_a_skipped_directory_is_rejected_not_silently_empty(self):
        # _Templates/Ignored.md is real on disk but vault_files never
        # walks it — scoping to it must not read as a clean report.
        parent, vault = make_scoped_vault(self)
        proc = run_cli(vault, "tables", "--file", "_Templates/Ignored.md")
        self.assertEqual(proc.returncode, 2)
        self.assertIn("_Templates/Ignored.md", proc.stderr)

    def test_a_hidden_path_is_rejected_not_silently_empty(self):
        parent, vault = make_scoped_vault(self)
        hidden = vault / ".obsidian"
        hidden.mkdir()
        (hidden / "Config.md").write_text(
            "---\ntype: reference\n---\n", encoding="utf-8")
        proc = run_cli(vault, "tables", "--file", ".obsidian/Config.md")
        self.assertEqual(proc.returncode, 2)
        self.assertIn(".obsidian/Config.md", proc.stderr)

    def test_an_absolute_path_matches_the_relative_form(self):
        # Forced under /tmp, which is itself a symlink to /private/tmp on
        # macOS — exactly the case that breaks a naive string-prefix
        # comparison between an absolute --file value and the vault root.
        parent, vault = make_scoped_vault(self, tmp_dir="/tmp")
        relative = run_cli(vault, "tables", "--file", "Notes/Dirty Note.md")
        absolute = run_cli(
            vault, "tables", "--file",
            str(vault / "Notes" / "Dirty Note.md"))
        self.assertEqual(relative.returncode, 0, relative.stderr)
        self.assertEqual(absolute.returncode, 0, absolute.stderr)
        self.assertEqual(relative.stdout, absolute.stdout)
        self.assertIn("Notes/Dirty Note.md", absolute.stdout)

    def test_wrong_case_is_rejected_not_silently_unmatched(self):
        # The old validation resolved this against a case-insensitive
        # filesystem and passed it through, giving "# count: 0" — a
        # clean-looking report for a typo, not an error.
        parent, vault = make_scoped_vault(self)
        proc = run_cli(vault, "tables", "--file", "notes/dirty note.md")
        self.assertEqual(proc.returncode, 2)
        self.assertIn("notes/dirty note.md", proc.stderr)

    def test_interior_dotdot_that_stays_inside_the_vault_is_accepted(self):
        parent, vault = make_scoped_vault(self)
        proc = run_cli(vault, "tables", "--file",
                       "Notes/../Notes/Dirty Note.md")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("Notes/Dirty Note.md", proc.stdout)

    def test_doubled_slashes_are_collapsed(self):
        parent, vault = make_scoped_vault(self)
        proc = run_cli(vault, "tables", "--file", "Notes//Dirty Note.md")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("Notes/Dirty Note.md", proc.stdout)

    def test_filename_with_spaces_is_matched(self):
        parent, vault = make_scoped_vault(self)
        proc = run_cli(vault, "tables", "--file", "Player Characters.md")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("Player Characters.md", proc.stdout)
        self.assertNotIn("Notes/Dirty Note.md", proc.stdout)

    def test_an_absolute_path_outside_the_vault_is_rejected(self):
        parent, vault = make_scoped_vault(self)
        proc = run_cli(vault, "tables", "--file", str(parent / "Outside.md"))
        self.assertEqual(proc.returncode, 2)
        self.assertIn("Outside.md", proc.stderr)
        self.assertEqual(proc.stdout, "")

    def test_a_path_that_normalises_to_the_vault_root_is_rejected(self):
        parent, vault = make_scoped_vault(self)
        proc = run_cli(vault, "tables", "--file", "Notes/..")
        self.assertEqual(proc.returncode, 2)
        self.assertIn("Notes/..", proc.stderr)
        self.assertEqual(proc.stdout, "")

    def test_a_directory_named_dot_md_is_rejected_not_silently_empty(self):
        # A directory can be named "Foo.md" too — rglob("*.md") matches it,
        # and only an explicit is_file() check tells it apart from a note.
        parent, vault = make_scoped_vault(self)
        (vault / "Weird.md").mkdir()
        proc = run_cli(vault, "tables", "--file", "Weird.md")
        self.assertEqual(proc.returncode, 2)
        self.assertIn("Weird.md", proc.stderr)
        self.assertEqual(proc.stdout, "")


class NewerThanScopeTests(unittest.TestCase):
    """`--newer-than <path>` — a backstop scope (or completeness
    cross-check) that keeps files with an mtime at or after a named
    file's own, independent of an explicit `--file` list."""

    def _touch(self, path, when):
        os.utime(path, (when, when))

    def test_newer_than_excludes_files_older_than_the_marker(self):
        parent, vault = make_scoped_vault(self)
        marker = vault / "Notes" / "Dirty Note.md"
        older = vault / "Player Characters.md"
        now = time.time()
        self._touch(older, now - 3600)
        self._touch(marker, now)
        proc = run_cli(vault, "tables", "--newer-than", "Notes/Dirty Note.md")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("Notes/Dirty Note.md", proc.stdout)
        self.assertNotIn("Player Characters.md", proc.stdout)

    def test_newer_than_includes_files_at_or_after_the_marker(self):
        parent, vault = make_scoped_vault(self)
        marker = vault / "Notes" / "Dirty Note.md"
        newer = vault / "Player Characters.md"
        now = time.time()
        self._touch(marker, now - 3600)
        self._touch(newer, now)
        proc = run_cli(vault, "tables", "--newer-than", "Notes/Dirty Note.md")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("Notes/Dirty Note.md", proc.stdout)
        self.assertIn("Player Characters.md", proc.stdout)

    def test_newer_than_combines_with_file_by_and(self):
        parent, vault = make_scoped_vault(self)
        marker = vault / "Notes" / "Dirty Note.md"
        newer = vault / "Player Characters.md"
        now = time.time()
        self._touch(marker, now - 3600)
        self._touch(newer, now)
        # --file names only the marker; --newer-than alone would also
        # include "Player Characters.md", but the AND with --file must
        # still exclude it.
        proc = run_cli(vault, "tables",
                       "--file", "Notes/Dirty Note.md",
                       "--newer-than", "Notes/Dirty Note.md")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("Notes/Dirty Note.md", proc.stdout)
        self.assertNotIn("Player Characters.md", proc.stdout)

    def test_newer_than_naming_no_file_is_a_clear_error(self):
        parent, vault = make_scoped_vault(self)
        proc = run_cli(vault, "tables", "--newer-than", "No/Such/File.md")
        self.assertEqual(proc.returncode, 2)
        self.assertIn("No/Such/File.md", proc.stderr)
        self.assertEqual(proc.stdout, "")

    def test_newer_than_applies_to_relationships_and_pc_body_too(self):
        # A throwaway vault, not the shared fixtures — this test needs to
        # control mtimes, and mutating a fixture other tests read would
        # be a hidden cross-test dependency.
        parent = Path(tempfile.mkdtemp(prefix="vc-newer-than-"))
        self.addCleanup(shutil.rmtree, parent, ignore_errors=True)
        vault = parent / "vault"
        (vault / "PCs").mkdir(parents=True)
        old_npc = vault / "Old.md"
        new_npc = vault / "New.md"
        old_npc.write_text(
            "---\ntype: npc\ncanon_status: DRAFT\nrelationships:\n"
            '  - target: "[[Somewhere]]"\n    type: works_for\n---\n',
            encoding="utf-8")
        new_npc.write_text(
            "---\ntype: npc\ncanon_status: DRAFT\nrelationships:\n"
            '  - target: "[[Somewhere]]"\n    type: works_for\n---\n',
            encoding="utf-8")
        old_pc = vault / "PCs" / "Old.md"
        new_pc = vault / "PCs" / "New.md"
        fenced = ("---\ntype: pc\n---\n\n## Stat Sheet\n\nSTR 10.\n\n"
                 "<!-- gm-only -->\n\n## Current Status\n\n"
                 "**Location:** Here\n\n<!-- /gm-only -->\n")
        old_pc.write_text(fenced, encoding="utf-8")
        new_pc.write_text(fenced, encoding="utf-8")

        now = time.time()
        self._touch(old_npc, now - 3600)
        self._touch(old_pc, now - 3600)
        self._touch(new_npc, now)
        self._touch(new_pc, now)

        rel_proc = run_cli(vault, "relationships", "--newer-than", "New.md")
        self.assertEqual(rel_proc.returncode, 0, rel_proc.stderr)
        self.assertIn("New.md", rel_proc.stdout)
        self.assertNotIn("Old.md", rel_proc.stdout)

        pc_proc = run_cli(vault, "pc-body",
                          "--newer-than", "PCs/New.md")
        self.assertEqual(pc_proc.returncode, 0, pc_proc.stderr)
        self.assertIn("PCs/New.md", pc_proc.stdout)
        self.assertNotIn("PCs/Old.md", pc_proc.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=2)
