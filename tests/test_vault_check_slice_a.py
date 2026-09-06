#!/usr/bin/env python3
"""Regression tests for the Mechanization Slice A vault_check commands.

Covers the three commands that replace by-eye procedures in the skills:
`version` (the vault/plugin semver gate eight skills open with),
`active-pcs` (the roster helper), and `sessions` (deriving each
session's status from which chain documents actually exist).

One class per command; later Slice A tasks append their own classes.

Run: python3 tests/test_vault_check_slice_a.py
"""

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import vault_check as vc  # noqa: E402

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "slice-a"
VAULT_CHECK_FIXTURE = Path(__file__).resolve().parent / "fixtures" / "vault-check"
SCRIPT = SCRIPTS / "vault_check.py"


def run_cli(vault, *args):
    """Run vault_check.py as the skills do — as a subprocess, so the exit
    code is the real one and not an in-process return value."""
    return subprocess.run(
        [sys.executable, str(SCRIPT), str(vault), *args],
        capture_output=True, text=True)


def plugin_version_string():
    manifest = ROOT / ".claude-plugin" / "plugin.json"
    return json.loads(manifest.read_text(encoding="utf-8"))["version"]


def rows_for(rows, needle):
    return [r for r in rows if needle in r]


def make_vault(case, config=None, meta=True):
    """A throwaway vault; `config` is the vault-config.md text, or None for
    no config file. `meta=False` omits `_meta/` entirely."""
    d = Path(tempfile.mkdtemp(prefix="vc-slice-a-"))
    case.addCleanup(shutil.rmtree, d, ignore_errors=True)
    (d / "Overview.md").write_text("---\ntype: campaign_overview\n---\n",
                                   encoding="utf-8")
    if meta:
        (d / "_meta").mkdir()
        if config is not None:
            (d / "_meta" / "vault-config.md").write_text(config,
                                                         encoding="utf-8")
    return d


class VersionCommandTests(unittest.TestCase):
    """`vault_check.py VAULT version` — the semver gate."""

    def verdict(self, vault):
        """(verdict token, path, message) for the single contracted row."""
        rows, code = vc.check_version(Path(vault))
        self.assertEqual(len(rows), 1, rows)
        return rows[0].split("\t"), code

    def test_ok_when_vault_matches_the_installed_plugin(self):
        # Written at runtime from plugin.json so the fixture never pins a
        # version that the next release would falsify.
        version = plugin_version_string()
        vault = make_vault(
            self, f'---\ngm_apprentice_version: "{version}"\n---\n')
        (token, path, message), code = self.verdict(vault)
        self.assertEqual(token, "OK")
        self.assertEqual(path, "_meta/vault-config.md")
        self.assertEqual(message, f"vault {version} = plugin {version}")
        self.assertEqual(code, 0)

    def test_behind_is_a_mismatch_pointing_at_the_migration_workflow(self):
        (token, path, message), code = self.verdict(FIXTURES / "version-behind")
        self.assertEqual(token, "MISMATCH")
        self.assertEqual(path, "_meta/vault-config.md")
        self.assertIn(f"vault 1.8.9 < plugin {plugin_version_string()}", message)
        self.assertIn("campaign-organizer's migration workflow", message)
        self.assertIn("references/migration-procedure.md", message)
        self.assertEqual(code, 1)

    def test_comparison_is_numeric_not_lexical(self):
        # 1.8.9 < 1.9.6 lexically too; 1.10.0 vs 1.9.6 is the real test.
        vault = make_vault(self, '---\ngm_apprentice_version: "1.10.0"\n---\n')
        (token, _path, _message), _code = self.verdict(vault)
        expected = "AHEAD" if vc.parse_version("1.10.0") > vc.parse_version(
            plugin_version_string()) else "MISMATCH"
        self.assertEqual(token, expected)

    def test_ahead_tells_the_user_to_update_the_plugin(self):
        vault = make_vault(self, '---\ngm_apprentice_version: "99.0.0"\n---\n')
        (token, path, message), code = self.verdict(vault)
        self.assertEqual(token, "AHEAD")
        self.assertEqual(path, "_meta/vault-config.md")
        self.assertIn(f"vault 99.0.0 > plugin {plugin_version_string()}", message)
        self.assertIn("update the plugin before touching this vault", message)
        self.assertEqual(code, 1)

    def test_absent_field_is_a_mismatch_not_a_pass(self):
        vault = make_vault(self, "---\npublish:\n  mode: player\n---\n")
        (token, path, message), code = self.verdict(vault)
        self.assertEqual(token, "MISMATCH")
        self.assertEqual(path, "_meta/vault-config.md")
        self.assertTrue(message.startswith("gm_apprentice_version absent"),
                        message)
        self.assertIn("references/migration-procedure.md", message)
        self.assertEqual(code, 1)

    def test_meta_without_a_config_file_is_the_absent_mismatch(self):
        vault = make_vault(self, config=None, meta=True)
        (token, _path, message), code = self.verdict(vault)
        self.assertEqual(token, "MISMATCH")
        self.assertTrue(message.startswith("gm_apprentice_version absent"),
                        message)
        self.assertEqual(code, 1)

    def test_no_meta_is_first_time_setup_not_migration(self):
        (token, path, message), code = self.verdict(FIXTURES / "version-nometa")
        self.assertEqual(token, "SETUP")
        self.assertEqual(path, "(vault)")
        self.assertEqual(message, "no _meta/ — first-time setup, not migration")
        self.assertEqual(code, 0)

    def test_unknown_plugin_version_is_an_error(self):
        original = vc.plugin_version
        vc.plugin_version = lambda: None
        self.addCleanup(setattr, vc, "plugin_version", original)
        (token, path, message), code = self.verdict(
            FIXTURES / "version-behind")
        self.assertEqual(token, "ERROR")
        self.assertEqual(path, "(plugin)")
        self.assertEqual(message,
                         "cannot determine the plugin version "
                         "(no .claude-plugin/plugin.json or "
                         "shared/migrations.md)")
        self.assertEqual(code, 1)

    def test_cli_emits_the_version_section_and_exits_zero_on_ok(self):
        vault = make_vault(
            self, f'---\ngm_apprentice_version: "{plugin_version_string()}"\n---\n')
        proc = run_cli(vault, "version")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("## version", proc.stdout)
        self.assertIn("# count: 1", proc.stdout)
        self.assertIn("OK\t_meta/vault-config.md\t", proc.stdout)

    def test_cli_exit_codes(self):
        for vault, expected in ((FIXTURES / "version-behind", 1),
                                (FIXTURES / "version-nometa", 0)):
            with self.subTest(vault=vault.name):
                self.assertEqual(run_cli(vault, "version").returncode, expected)

    def test_version_is_not_part_of_all(self):
        proc = run_cli(FIXTURES / "version-behind", "all")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertNotIn("## version", proc.stdout)


class ActivePcsCommandTests(unittest.TestCase):
    """`vault_check.py VAULT active-pcs` — the roster helper five skills
    open with, exposed instead of re-walked by eye."""

    def setUp(self):
        self.rows = vc.list_active_pcs(VAULT_CHECK_FIXTURE)

    def test_every_row_is_a_pc_row(self):
        self.assertTrue(all(r.startswith("PC\t") for r in self.rows), self.rows)

    def test_lists_the_active_pcs(self):
        self.assertEqual(len(rows_for(self.rows, "PCs/Katherine.md")), 1)
        self.assertEqual(len(rows_for(self.rows, "PCs/Varrio.md")), 1)

    def test_omits_the_story_companion_note(self):
        self.assertFalse(rows_for(self.rows, "_Story.md"), self.rows)

    def test_row_carries_stem_aliases_and_as_of_session(self):
        vault = make_vault(self)
        (vault / "Ada.md").write_text(
            '---\ntype: pc\nstatus: active\naliases: [Doc, "The Colonel"]\n'
            "asOfSession: 7\n---\n", encoding="utf-8")
        rows = vc.list_active_pcs(vault)
        self.assertEqual(
            rows, ['PC\tAda.md\tAda; aliases: Doc, The Colonel; '
                   'asOfSession: 7'])

    def test_missing_aliases_and_as_of_session_render_as_placeholders(self):
        vault = make_vault(self)
        (vault / "Bo.md").write_text("---\ntype: pc\n---\n", encoding="utf-8")
        self.assertEqual(vc.list_active_pcs(vault),
                         ["PC\tBo.md\tBo; aliases: none; asOfSession: ?"])

    def test_retired_pcs_are_excluded(self):
        vault = make_vault(self)
        (vault / "Gone.md").write_text("---\ntype: pc\nstatus: retired\n---\n",
                                       encoding="utf-8")
        self.assertEqual(vc.list_active_pcs(vault), [])

    def test_cli_emits_the_section(self):
        proc = run_cli(VAULT_CHECK_FIXTURE, "active-pcs")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("## active-pcs", proc.stdout)
        self.assertIn("# count: 2", proc.stdout)

    def test_active_pcs_is_not_part_of_all(self):
        proc = run_cli(VAULT_CHECK_FIXTURE, "all")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertNotIn("## active-pcs", proc.stdout)


C1 = "Chapters/Chapter 1 - A/Sessions"
C2 = "Chapters/Chapter 2 - B/Sessions"
ARRIVAL = f"{C1}/Session 01/Session 01 - Arrival.md"
FOG = f"{C1}/Session 02/Session 02 - Fog.md"
QUIET = f"{C1}/Session 03/Session 03 - Quiet.md"
RETURN = f"{C2}/Session 01/Session 01 - Return.md"


class SessionsCommandTests(unittest.TestCase):
    """`vault_check.py VAULT sessions` — derive each session's status from
    which chain documents exist, per shared/session-document-chain.md."""

    def setUp(self):
        self.rows = vc.check_sessions(FIXTURES / "sessions")

    def summary(self, rel):
        found = [r for r in self.rows
                 if r.startswith(f"INFO\t{rel}\tsession ")]
        self.assertEqual(len(found), 1, self.rows)
        return found[0]

    def test_one_summary_row_per_session_index(self):
        summaries = [r for r in self.rows if "\tsession " in r]
        self.assertEqual(len(summaries), 4, self.rows)

    def test_rows_are_grouped_by_index_in_path_order(self):
        order = [rel for rel in (ARRIVAL, FOG, QUIET, RETURN)]
        seen = [next(i for i, r in enumerate(self.rows) if f"\t{rel}\t" in r)
                for rel in order]
        self.assertEqual(seen, sorted(seen))

    def test_plan_only_session_derives_prepped(self):
        self.assertEqual(
            self.summary(ARRIVAL),
            f"INFO\t{ARRIVAL}\tsession 1: plan=✓ play-notes=– "
            f"wrap-up=– declared=planned derived=prepped")

    def test_declared_status_mismatch_warns_with_the_stamp_command(self):
        self.assertIn(
            f"WARNING\t{ARRIVAL}\tstatus 'planned' but the documents that "
            f"exist derive 'prepped' — stamp_entities.py VAULT "
            f'"{ARRIVAL}" --set status=prepped',
            self.rows)

    def test_broken_documents_link_is_reported(self):
        self.assertIn(
            f"WARNING\t{ARRIVAL}\tdocuments.wrap_up links "
            f"'[[Chapter_01_Session_01_Wrap_Up]]' but no such note exists",
            self.rows)

    def test_authoritative_wrap_up_derives_reviewed(self):
        self.assertEqual(
            self.summary(FOG),
            f"INFO\t{FOG}\tsession 2: plan=– play-notes=– "
            f"wrap-up=✓ declared=played derived=reviewed")

    def test_unlinked_document_is_an_info_with_the_stamp_command(self):
        wrap = f"{C1}/Session 02/Chapter_01_Session_02_Wrap_Up.md"
        self.assertIn(
            f"INFO\t{FOG}\twrap-up exists ({wrap}) but documents.wrap_up "
            f'does not link it — stamp_entities.py VAULT "{FOG}" --set '
            f'documents.wrap_up="[[Chapter_01_Session_02_Wrap_Up]]"',
            self.rows)

    def test_index_with_no_chain_documents_derives_planned(self):
        self.assertEqual(
            self.summary(QUIET),
            f"INFO\t{QUIET}\tsession 3: plan=– play-notes=– "
            f"wrap-up=– declared=prepped derived=planned")
        self.assertTrue(rows_for(
            self.rows, f"WARNING\t{QUIET}\tstatus 'prepped' but"))

    def test_chapter_two_session_one_derives_played_not_prepped(self):
        # Chapter 1's plan is also "session 1" — chapter scoping (mirroring
        # session_context.prefer_chapter) must keep it out of this chain.
        self.assertEqual(
            self.summary(RETURN),
            f"INFO\t{RETURN}\tsession 1: plan=– play-notes=✓ "
            f"wrap-up=– declared=played derived=played")

    def test_matching_declared_status_produces_no_warning(self):
        self.assertFalse(
            [r for r in self.rows
             if r.startswith(f"WARNING\t{RETURN}\tstatus ")], self.rows)

    def test_absent_status_still_warns(self):
        vault = make_vault(self)
        (vault / "Session 01 - Lone.md").write_text(
            "---\ntype: session\nsession_number: 1\n---\n", encoding="utf-8")
        rows = vc.check_sessions(vault)
        self.assertTrue(rows_for(rows, "status '?' but the documents that "
                                       "exist derive 'planned'"), rows)

    def test_non_authoritative_wrap_up_derives_wrap_up(self):
        vault = make_vault(self)
        (vault / "Session 01 - Lone.md").write_text(
            "---\ntype: session\nsession_number: 1\nstatus: played\n---\n",
            encoding="utf-8")
        (vault / "Chapter_01_Session_01_Wrap_Up.md").write_text(
            "---\ntype: session_wrap\nsession: \"[[Session 01 - Lone]]\"\n"
            "canon_status: DRAFT\n---\n", encoding="utf-8")
        rows = vc.check_sessions(vault)
        self.assertTrue(rows_for(rows, "derived=wrap-up"), rows)

    def test_chapters_own_document_outranks_an_unfiled_copy(self):
        # An archived copy at the vault root sorts before any Chapters/
        # path; taking the first number match handed it to the chapter
        # that owns a real wrap-up of its own (#162's shape).
        vault = Path(__file__).resolve().parent / "fixtures" / \
            "mini-vault-prep-chapters"
        rows = vc.check_sessions(vault)
        calcutta = rows_for(rows, "Session 07 - The Sterile Bay.md")
        self.assertTrue(rows_for(calcutta, "Chapter_04_Session_07_Wrap_Up.md"),
                        calcutta)
        self.assertFalse(rows_for(calcutta, "Archive_Session_07_Wrap_Up.md"),
                         calcutta)
        # Chapter 3's session 7 has no wrap-up of its own, so the unfiled
        # archive is still the right answer for it.
        vienna = rows_for(rows, "Sessions/Session 07.md")
        self.assertTrue(rows_for(vienna, "Archive_Session_07_Wrap_Up.md"),
                        vienna)

    def test_null_document_placeholder_is_not_a_broken_link(self):
        # `plan: null` is the schema's own "not yet" placeholder — the
        # shape most indexes in a live vault are actually in.
        vault = make_vault(self)
        (vault / "Session 01 - Lone.md").write_text(
            "---\ntype: session\nsession_number: 1\nstatus: planned\n"
            "documents:\n  plan: null\n  play_notes: ~\n  wrap_up:\n---\n",
            encoding="utf-8")
        rows = vc.check_sessions(vault)
        self.assertFalse(rows_for(rows, "no such note exists"), rows)
        self.assertTrue(rows_for(rows, "derived=planned"), rows)

    def test_empty_vault_says_so(self):
        vault = make_vault(self)
        self.assertEqual(vc.check_sessions(vault),
                         ["INFO\t(vault)\tno session indexes found"])

    def test_cli_emits_the_section_and_all_includes_it(self):
        proc = run_cli(FIXTURES / "sessions", "sessions")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("## sessions", proc.stdout)
        self.assertIn(f"# count: {len(self.rows)}", proc.stdout)
        self.assertIn("## sessions", run_cli(FIXTURES / "sessions", "all").stdout)


if __name__ == "__main__":
    unittest.main(verbosity=2)
