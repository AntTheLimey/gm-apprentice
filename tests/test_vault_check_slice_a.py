#!/usr/bin/env python3
"""Regression tests for the Mechanization Slice A vault_check commands.

Covers the commands that replace by-eye procedures in the skills:
`version` (the vault/plugin semver gate eight skills open with),
`active-pcs` (the roster helper), `sessions` (deriving each session's
status from which chain documents actually exist), and the two
publish-safety checks — `gm-leak` (Keeper-facing content that would
reach the player site) and `pc-body` (the PC sheet skeleton and where
`## Current Status` sits).

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


LEAK = FIXTURES / "leak"
GOOD = "Characters/NPCs/Good.md"
LEAKY = "Characters/NPCs/Leaky.md"
CONFIG = "Characters/NPCs/Config.md"
PLAN = "Chapters/C1/Sessions/S1/Session 01 - X - Plan.md"
FINE = "Characters/PCs/Fine.md"
FENCED = "Characters/PCs/Fenced.md"
LATE = "Characters/PCs/Late.md"
BARE = "Characters/PCs/Bare.md"
STORY = "Characters/PCs/Fine_Story.md"
UNPUBLISHED = "Characters/NPCs/Unpublished.md"
STUB = "Characters/NPCs/Stub.md"
HIDDEN = "Characters/PCs/Hidden.md"


class GmLeakCommandTests(unittest.TestCase):
    """`vault_check.py VAULT gm-leak` — Keeper-facing content that would
    actually reach the published site, with the fence and excluded-section
    containment a grep cannot express."""

    def setUp(self):
        self.rows = vc.check_gm_leak(LEAK, None)

    def test_bold_wrapped_exclude_heading_is_an_error(self):
        # processor.js filterSections compares the raw title, so the `**`
        # defeats the exclude list and the section publishes.
        self.assertIn(
            f"ERROR\t{LEAKY}:10\tbold-wrapped heading 'GM Notes' defeats "
            f"the exclude list and publishes — remove the ** or move it "
            f"under ## GM Notes",
            self.rows)

    def test_keeper_facing_sibling_heading_warns(self):
        self.assertIn(
            f"WARNING\t{LEAKY}:14\tKeeper-facing heading 'Keeper Checklist' "
            f"publishes — nest it under ## GM Notes or fence it",
            self.rows)

    def test_bold_label_is_an_info(self):
        self.assertIn(
            f"INFO\t{LEAKY}:18\tbold label 'Secret' looks Keeper-facing — "
            f"confirm with the GM (not a heading; not auto-movable)",
            self.rows)

    def test_keeper_callout_is_an_info(self):
        self.assertIn(
            f"INFO\t{LEAKY}:20\tcallout [!warning] Keeper eyes only reads "
            f"Keeper-facing — confirm it should publish",
            self.rows)

    def test_single_asterisk_emphasis_is_the_same_error(self):
        # `### *GM Notes*` defeats filterSections exactly as `**` does;
        # the remedy names the marker that is actually there.
        self.assertIn(
            f"ERROR\t{LEAKY}:27\tbold-wrapped heading 'GM Notes' defeats "
            f"the exclude list and publishes — remove the * or move it "
            f"under ## GM Notes",
            self.rows)

    def test_publish_false_files_are_skipped(self):
        # build.js drops these before the link map exists, so nothing in
        # them can publish however it is written.
        self.assertFalse(rows_for(self.rows, UNPUBLISHED), self.rows)

    def test_a_stub_reports_only_its_included_sections(self):
        self.assertIn(
            f"WARNING\t{STUB}:12\tKeeper-facing heading 'Keeper Tactics' "
            f"publishes — nest it under ## GM Notes or fence it",
            self.rows)
        # `### Keeper Hooks` sits under `## Plot`, which keepOnlySections
        # drops wholesale.
        self.assertFalse(rows_for(self.rows, f"{STUB}:18"), self.rows)

    def test_a_stub_with_no_include_list_publishes_nothing(self):
        vault = make_vault(self)
        (vault / "Empty.md").write_text(
            "---\ntype: npc\npublish: stub\n---\n\n"
            "## Keeper Checklist\n\nNothing ships.\n", encoding="utf-8")
        self.assertEqual(vc.check_gm_leak(vault, None), [])

    def test_an_unrecognised_fence_problem_is_never_dropped(self):
        self.assertEqual(
            vc._fence_rows("X.md", ["something new from scan_body"]),
            ["WARNING\tX.md\tsomething new from scan_body"])

    def test_orphan_closer_is_an_error(self):
        self.assertIn(
            f"ERROR\t{LEAKY}:23\t<!-- /gm-only --> with no opener — "
            f"everything above it publishes",
            self.rows)

    def test_unclosed_marker_warns(self):
        vault = make_vault(self)
        (vault / "Open.md").write_text(
            "---\ntype: npc\n---\n\n## Description\n\n"
            "<!-- spoiler -->\nHe is the killer.\n", encoding="utf-8")
        self.assertIn(
            "WARNING\tOpen.md:7\t<!-- spoiler --> never closed — "
            "publish strips to end of file",
            vc.check_gm_leak(vault, None))

    def test_a_config_exclude_entry_silences_its_own_section(self):
        self.assertFalse(rows_for(self.rows, f"{CONFIG}:6"), self.rows)
        self.assertFalse(rows_for(self.rows, f"{CONFIG}:10"), self.rows)

    def test_a_heading_containing_an_exclude_entry_still_warns(self):
        self.assertIn(
            f"WARNING\t{CONFIG}:14\tKeeper-facing heading "
            f"'Keeper Notes — Draft' publishes — nest it under ## GM Notes "
            f"or fence it",
            self.rows)

    def test_the_clean_npc_is_silent(self):
        # Fenced aside, a nested `### Tactics` under `## GM Notes`, and a
        # fenced code example that quotes both a Keeper heading and a bold
        # label — none of them reach a reader.
        self.assertFalse(rows_for(self.rows, GOOD), self.rows)

    def test_never_published_types_are_skipped(self):
        self.assertFalse(rows_for(self.rows, PLAN), self.rows)

    def test_canonical_pc_sheets_are_silent(self):
        for rel in (FINE, FENCED, LATE, BARE, STORY):
            with self.subTest(rel=rel):
                self.assertFalse(rows_for(self.rows, rel), self.rows)

    def test_that_is_every_row(self):
        self.assertEqual(len(self.rows), 8, self.rows)

    def test_folder_restricts_the_walk(self):
        rows = vc.check_gm_leak(LEAK, "Characters/NPCs")
        self.assertTrue(all("Characters/NPCs/" in r for r in rows), rows)
        self.assertTrue(rows_for(rows, LEAKY), rows)

    def test_cli_emits_the_section_and_all_includes_it(self):
        proc = run_cli(LEAK, "gm-leak")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("## gm-leak", proc.stdout)
        self.assertIn(f"# count: {len(self.rows)}", proc.stdout)
        self.assertIn("## gm-leak", run_cli(LEAK, "all").stdout)


class PcBodyCommandTests(unittest.TestCase):
    """`vault_check.py VAULT pc-body` — the skeleton and `## Current Status`
    placement rules from shared/pc-body-structure.md."""

    def setUp(self):
        self.rows = vc.check_pc_body(LEAK)

    def test_current_status_inside_a_fence_is_an_error(self):
        self.assertIn(
            f"ERROR\t{FENCED}:12\t## Current Status is inside a "
            f"<!-- gm-only --> / <!-- spoiler --> fence — it publishes; "
            f"move it outside",
            self.rows)

    def test_current_status_after_the_protected_sections_warns(self):
        self.assertIn(
            f"WARNING\t{LATE}:22\t## Current Status comes after ## Notes — "
            f"it must precede the protected sections",
            self.rows)

    def test_duplicate_h2_warns_at_the_repeat(self):
        self.assertIn(f"WARNING\t{LATE}:14\tduplicate H2 'Equipment'",
                      self.rows)

    def test_first_h2_that_is_not_stat_sheet_is_an_info(self):
        self.assertIn(
            f"INFO\t{LATE}\tfirst body H2 is '## Background' — the canonical "
            f"skeleton opens with ## Stat Sheet",
            self.rows)

    def test_prose_only_current_status_is_an_info(self):
        self.assertIn(
            f"INFO\t{BARE}:10\t## Current Status has no labelled fields "
            f"(**Location:** …) — machine consumers read the labels",
            self.rows)

    def test_the_canonical_sheet_is_silent(self):
        self.assertFalse(rows_for(self.rows, FINE + "\t"), self.rows)
        self.assertFalse(rows_for(self.rows, FINE + ":"), self.rows)

    def test_publish_false_pcs_are_skipped(self):
        # Hidden.md's Current Status sits inside a gm-only fence — an
        # ERROR on any sheet that actually reaches the site, and a false
        # alarm on one build.js never builds a page for.
        self.assertFalse(rows_for(self.rows, HIDDEN), self.rows)

    def test_a_stub_pc_that_omits_current_status_is_silent(self):
        vault = make_vault(self)
        (vault / "Stubbed.md").write_text(
            "---\ntype: pc\npublish: stub\n"
            'publish_include_sections: ["Background"]\n---\n\n'
            "## Background\n\nRaised by smugglers.\n\n"
            "## Current Status\n\nProse only, and never shipped.\n",
            encoding="utf-8")
        self.assertEqual(vc.check_pc_body(vault), [])

    def test_a_stub_pc_that_ships_current_status_is_still_checked(self):
        vault = make_vault(self)
        (vault / "Shown.md").write_text(
            "---\ntype: pc\npublish: stub\n"
            'publish_include_sections: ["Current Status"]\n---\n\n'
            "## Background\n\nRaised by smugglers.\n\n"
            "## Current Status\n\nProse only, and it ships.\n",
            encoding="utf-8")
        self.assertEqual(
            vc.check_pc_body(vault),
            ["INFO\tShown.md:11\t## Current Status has no labelled fields "
             "(**Location:** …) — machine consumers read the labels"])

    def test_the_story_companion_is_ignored(self):
        self.assertFalse(rows_for(self.rows, STORY), self.rows)

    def test_that_is_every_row(self):
        self.assertEqual(len(self.rows), 5, self.rows)

    def test_absent_block_is_an_info_pointing_at_wrapup(self):
        vault = make_vault(self)
        (vault / "Nobody.md").write_text(
            "---\ntype: pc\n---\n\n## Stat Sheet\n\nSTR 10.\n",
            encoding="utf-8")
        self.assertEqual(
            vc.check_pc_body(vault),
            ["INFO\tNobody.md\tno ## Current Status block — "
             "session-wrapup Step 3c creates it"])

    def test_wrong_heading_level_warns(self):
        vault = make_vault(self)
        (vault / "Deep.md").write_text(
            "---\ntype: pc\n---\n\n## Stat Sheet\n\n"
            "### Current Status\n\n**Location:** Here\n", encoding="utf-8")
        self.assertIn(
            "WARNING\tDeep.md:7\tCurrent Status is an H3 — it must be an H2 "
            "outside the protected sections",
            vc.check_pc_body(vault))

    def test_an_h2_wins_over_a_stray_lower_level_heading(self):
        vault = make_vault(self)
        (vault / "Both.md").write_text(
            "---\ntype: pc\n---\n\n## Stat Sheet\n\n"
            "### Current Status\n\n## Current Status\n\n"
            "**Location:** Here\n", encoding="utf-8")
        rows = vc.check_pc_body(vault)
        self.assertFalse(rows_for(rows, "must be an H2"), rows)

    def test_inactive_pcs_are_checked_because_they_still_publish(self):
        vault = make_vault(self)
        (vault / "Dead.md").write_text(
            "---\ntype: pc\nstatus: dead\n---\n\n## Stat Sheet\n\n"
            "STR 0.\n", encoding="utf-8")
        self.assertTrue(rows_for(vc.check_pc_body(vault),
                                 "no ## Current Status block"))

    def test_fence_problems_are_reported_here_too(self):
        vault = make_vault(self)
        (vault / "Torn.md").write_text(
            "---\ntype: pc\n---\n\n## Stat Sheet\n\n"
            "<!-- /gm-only -->\n\n## Current Status\n\n"
            "**Location:** Here\n", encoding="utf-8")
        self.assertIn(
            "ERROR\tTorn.md:7\t<!-- /gm-only --> with no opener — "
            "everything above it publishes",
            vc.check_pc_body(vault))

    def test_a_vault_with_no_pcs_is_empty(self):
        self.assertEqual(vc.check_pc_body(make_vault(self)), [])

    def test_cli_emits_the_section_and_all_includes_it(self):
        proc = run_cli(LEAK, "pc-body")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("## pc-body", proc.stdout)
        self.assertIn(f"# count: {len(self.rows)}", proc.stdout)
        self.assertIn("## pc-body", run_cli(LEAK, "all").stdout)


if __name__ == "__main__":
    unittest.main(verbosity=2)
