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


WRAPUP = FIXTURES / "wrapup"
S7 = "Chapters/Chapter 3 - Vienna/Sessions/Session 07"
CONFORMANT = f"{S7}/Chapter_03_Session_07_Wrap_Up.md"
LEGACY = f"{S7}/Session 07 - The Ball - Wrap-Up.md"
CHAPTER_LEVEL = "Chapters/Chapter 2 - Prague/Chapter_02_Wrap_Up.md"

# What the legacy wrap-up's body must look like once `--fix` has re-nested
# it: player H2s first in template order, every Keeper-facing H2 demoted
# under one `## GM Notes` inside a single gm-only pair, the recap and the
# decorated template heading renamed, and not one word of prose changed.
FIXED_LEGACY_BODY = """
# Session 07 — The Ball — Wrap-Up

## Narrative Recap

The party danced, and the Archduke noticed which of them could not.

## Memorable Moments

**The waltz.**

*Everyone else stopped to watch.*

<!-- gm-only -->

## GM Notes

### Keeper Checklist

- [ ] Decide whether the Archduke acts on what he saw.

### World State

- **Location:** Vienna
- **Ticking clocks:** the Congress adjourns in four days.

#### Cross-Entity Claims

*Held for Confirmation*

- The Archduke owns the Hofburg annexe. HELD.

### Reconciliation Context

**Reconciled:** 2026-05-02

Canon merged from the play notes.

<!-- /gm-only -->
"""


def copy_fixture(case, name):
    """A writable copy of a read-only fixture vault — `--fix` writes."""
    d = Path(tempfile.mkdtemp(prefix="vc-wrapup-"))
    case.addCleanup(shutil.rmtree, d, ignore_errors=True)
    shutil.copytree(FIXTURES / name, d / "vault")
    return d / "vault"


def read(vault, rel):
    """The file exactly as it sits on disk, line endings included."""
    with (Path(vault) / rel).open("r", encoding="utf-8", newline="") as f:
        return f.read()


class WrapupCommandTests(unittest.TestCase):
    """`vault_check.py VAULT wrapup [--file REL] [--fix]` — the Session
    Wrap-Up conformance check from campaign-qa's wrapup-conformance.md
    Steps 2-4, with the 1.9.5 migration's structural re-nest as `--fix`."""

    def setUp(self):
        self.rows = vc.check_wrapup(WRAPUP, None, False)

    def findings(self, rel):
        """The finding rows for one file — fix rows excluded."""
        return [r for r in self.rows
                if r.split("\t")[0] in ("ERROR", "WARNING", "INFO")
                and r.split("\t")[1].split(":")[0] == rel]

    def fixes(self, rel):
        return [r for r in self.rows if r.startswith(f"WOULD-FIX\t{rel}\t")]

    # ---- enumeration -----------------------------------------------

    def test_enumerates_by_frontmatter_type_not_filename(self):
        # The play notes and the session index share the session's name;
        # only the three files whose `type:` is a wrap-up synonym count.
        seen = {r.split("\t")[1].split(":")[0] for r in self.rows}
        self.assertEqual(seen, {CONFORMANT, LEGACY, CHAPTER_LEVEL})

    def test_file_restricts_to_one_wrap_up(self):
        rows = vc.check_wrapup(WRAPUP, LEGACY, False)
        self.assertTrue(all(LEGACY in r for r in rows), rows)
        self.assertTrue(rows)

    def test_file_that_is_not_a_wrap_up_says_so(self):
        rows = vc.check_wrapup(WRAPUP, f"{S7}/Session 07 - The Ball.md", False)
        self.assertEqual(len(rows), 1, rows)
        self.assertTrue(rows[0].startswith("INFO\t"), rows)
        self.assertIn("no wrap-up", rows[0])

    # ---- the conformant file ---------------------------------------

    def test_the_conformant_wrap_up_has_no_findings(self):
        self.assertEqual(self.findings(CONFORMANT), [])

    def test_the_conformant_wrap_up_is_unchanged(self):
        self.assertIn(f"UNCHANGED\t{CONFORMANT}\tnothing to fix", self.rows)

    def test_renest_is_byte_identical_on_the_conformant_file(self):
        text = read(WRAPUP, CONFORMANT)
        self.assertEqual(vc.renest_wrapup(text), text)

    # ---- frontmatter findings --------------------------------------

    def test_type_synonym_is_an_info_with_the_canonical_spelling(self):
        self.assertIn(
            f"INFO\t{LEGACY}\ttype: 'session-wrap-up' — normalise to "
            f"session_wrap", self.rows)

    def test_non_link_session_warns_with_the_derived_link(self):
        self.assertIn(
            f'WARNING\t{LEGACY}\tsession: 7 is not a quoted wiki-link — '
            f'derive "[[Session 07 - The Ball]]"', self.rows)

    def test_absent_session_number_backfills_from_the_index(self):
        self.assertIn(f"INFO\t{LEGACY}\tsession_number: absent — backfill 7",
                      self.rows)

    def test_a_legacy_date_range_is_a_warning_that_refuses_to_delete(self):
        self.assertIn(
            f"WARNING\t{LEGACY}\tlegacy in_game_dates — range "
            f"5–6 March 1814 must be preserved in body prose before "
            f"removing the legacy keys", self.rows)

    def test_the_legacy_range_is_never_deleted(self):
        self.assertFalse([r for r in self.fixes(LEGACY)
                          if "in_game_date" in r], self.fixes(LEGACY))

    def test_single_legacy_value_maps_and_is_removed(self):
        vault = make_vault(self)
        (vault / "Chapter_01_Session_01_Wrap_Up.md").write_text(
            "---\ntype: session_wrap\nsession: \"[[S1]]\"\n"
            "session_number: 1\nplay_date: null\n"
            'in_game_date_end: "6 March 1814"\n'
            'source_document: "[[N]]"\ncanon_status: DRAFT\n'
            "created_by: session-wrapup\nreconciled: null\ntags: []\n"
            'chapter: "[[C]]"\ncampaign: "[[X]]"\n---\n\n'
            "## Narrative Recap\n\nIt happened.\n", encoding="utf-8")
        rows = vc.check_wrapup(vault, None, False)
        self.assertTrue(rows_for(rows, "legacy in_game_date_end — map to "
                                       'in_game_date: "6 March 1814"'), rows)
        self.assertTrue(rows_for(rows, 'added in_game_date: "6 March 1814"'),
                        rows)
        self.assertTrue(rows_for(rows, "removed in_game_date_end:"), rows)

    def test_a_block_list_legacy_date_is_never_touched(self):
        # `delete_key` removes one line; the `- "…"` items under a block
        # list would be left behind as orphan YAML.
        vault = make_vault(self)
        rel = "Chapter_01_Session_01_Wrap_Up.md"
        (vault / rel).write_text(
            "---\ntype: session_wrap\nin_game_dates:\n"
            '  - "5 March 1814"\n  - "6 March 1814"\n---\n\n'
            "## Narrative Recap\n\nIt happened.\n", encoding="utf-8")
        before = read(vault, rel)
        rows = vc.check_wrapup(vault, rel, True)
        self.assertTrue(rows_for(rows, "is a block list — map it to "
                                       "in_game_date and remove the block "
                                       "by hand"), rows)
        self.assertFalse(rows_for(rows, "removed in_game_dates"), rows)
        self.assertIn("in_game_dates:\n", read(vault, rel))
        self.assertIn('  - "5 March 1814"\n', before)

    def test_source_document_backfills_from_the_unique_play_notes(self):
        self.assertIn(
            f'INFO\t{LEGACY}\tsource_document: absent — backfill '
            f'"[[Session 07 - The Ball - Play Notes]]"', self.rows)

    def test_reconciled_backfills_from_the_reconciliation_context(self):
        self.assertIn(
            f'INFO\t{LEGACY}\treconciled: absent — backfill "2026-05-02" '
            f"from the Reconciliation Context", self.rows)

    def test_chapter_and_campaign_come_from_the_session_index(self):
        self.assertIn(
            f'INFO\t{LEGACY}\tchapter: absent — backfill '
            f'"[[Chapter 3 - Vienna]]" from the session index', self.rows)
        self.assertIn(
            f'INFO\t{LEGACY}\tcampaign: absent — backfill '
            f'"[[Vienna Campaign]]" from the session index', self.rows)

    def test_created_by_and_tags_are_backfilled(self):
        self.assertIn(
            f"INFO\t{LEGACY}\tcreated_by: absent — backfill session-wrapup",
            self.rows)
        self.assertIn(f"INFO\t{LEGACY}\ttags: absent — backfill []", self.rows)

    def test_a_reconstruction_note_makes_created_by_vault_ingest(self):
        vault = make_vault(self)
        (vault / "Chapter_01_Wrap_Up.md").write_text(
            "---\ntype: session_wrap\n---\n\n"
            "> [!info] Reconstruction Note\n> Reconstructed from notes.\n\n"
            "## Narrative Recap\n\nIt happened.\n", encoding="utf-8")
        self.assertTrue(rows_for(vc.check_wrapup(vault, None, False),
                                 "created_by: absent — backfill vault-ingest"))

    def test_a_dateless_reconciliation_context_asks_the_gm(self):
        vault = make_vault(self)
        (vault / "Chapter_01_Session_01_Wrap_Up.md").write_text(
            "---\ntype: session_wrap\n---\n\n## Narrative Recap\n\nIt "
            "happened.\n\n<!-- gm-only -->\n\n## GM Notes\n\n"
            "### Reconciliation Context\n\nMerged, undated.\n\n"
            "<!-- /gm-only -->\n", encoding="utf-8")
        rows = vc.check_wrapup(vault, None, False)
        self.assertTrue(rows_for(rows, "ask the GM once for the date"), rows)
        self.assertFalse(rows_for(rows, "added reconciled:"), rows)

    def test_no_reconciliation_context_writes_null(self):
        vault = make_vault(self)
        (vault / "Chapter_01_Session_01_Wrap_Up.md").write_text(
            "---\ntype: session_wrap\n---\n\n## Narrative Recap\n\nIt "
            "happened.\n", encoding="utf-8")
        self.assertTrue(rows_for(vc.check_wrapup(vault, None, False),
                                 "added reconciled: null"))

    def test_authoritative_without_reconcile_evidence_warns(self):
        self.assertIn(
            f"WARNING\t{CHAPTER_LEVEL}\tcanon_status: AUTHORITATIVE with "
            f"reconciled: null and no Reconciliation Context — the "
            f"promotion bypassed reconcile", self.rows)

    def test_a_non_iso_play_date_is_reported_not_fixed(self):
        vault = make_vault(self)
        (vault / "Chapter_01_Session_01_Wrap_Up.md").write_text(
            '---\ntype: session_wrap\nplay_date: "18/04/2026"\n---\n\n'
            "## Narrative Recap\n\nIt happened.\n", encoding="utf-8")
        rows = vc.check_wrapup(vault, None, False)
        self.assertTrue(rows_for(rows, "play_date: '18/04/2026' is not "
                                       "YYYY-MM-DD"), rows)
        self.assertFalse(rows_for(rows, "play_date: null"), rows)

    def test_an_ambiguous_session_derivation_is_refused(self):
        vault = make_vault(self)
        for name in ("Session 01 - A.md", "Session 01 - B.md"):
            (vault / name).write_text(
                "---\ntype: session\nsession_number: 1\n---\n",
                encoding="utf-8")
        (vault / "Chapter_01_Session_01_Wrap_Up.md").write_text(
            "---\ntype: session_wrap\nsession: 1\n---\n\n"
            "## Narrative Recap\n\nIt happened.\n", encoding="utf-8")
        rows = vc.check_wrapup(vault, None, False)
        self.assertTrue(rows_for(rows, "no unique session index matches"),
                        rows)
        self.assertFalse(rows_for(rows, 'session: 1 -> session: "[['), rows)

    # ---- structure findings ----------------------------------------

    def test_a_published_keeper_sibling_h2_is_an_error(self):
        self.assertIn(
            f"ERROR\t{LEGACY}:15\tKeeper-facing H2 '## Keeper Checklist' "
            f"publishes — re-nest it under ## GM Notes", self.rows)
        self.assertIn(
            f"ERROR\t{LEGACY}:25\tKeeper-facing H2 '## World State' "
            f"publishes — re-nest it under ## GM Notes", self.rows)

    def test_an_excluded_keeper_sibling_h2_is_only_a_warning(self):
        # `Reconciliation Context` is in the publish tool's own default
        # exclude list, so it is already hidden — the same drift, but not
        # a leak today.
        self.assertIn(
            f"WARNING\t{LEGACY}:34\tKeeper-facing H2 "
            f"'## Reconciliation Context' is already hidden (exclude list "
            f"or fence) — re-nest it under ## GM Notes", self.rows)

    def test_recap_variant_is_an_info_rename(self):
        self.assertIn(
            f"INFO\t{LEGACY}:11\trecap heading "
            f"'## What Happened — Narrative Recap' — rename to "
            f"## Narrative Recap", self.rows)

    def test_decorated_template_heading_is_an_info_rename(self):
        self.assertIn(
            f"INFO\t{LEGACY}:30\tdecorated heading 'Cross-Entity Claims — "
            f"Held for Confirmation' — rename to the template name "
            f"'Cross-Entity Claims' and keep the qualifier as an italic "
            f"first line", self.rows)

    def test_a_wrap_up_with_no_recap_heading_warns_before_the_fix(self):
        # Every H2 but the recap and Memorable Moments is Keeper-facing by
        # default, so a wrap-up that never names its recap has its whole
        # body re-nested — right, and worth saying out loud first.
        vault = make_vault(self)
        (vault / "Chapter_01_Session_01_Wrap_Up.md").write_text(
            "---\ntype: session_wrap\n---\n\n## Session Summary\n\nIt "
            "happened.\n\n## Open Threads\n\nThe door.\n", encoding="utf-8")
        self.assertTrue(rows_for(
            vc.check_wrapup(vault, None, False),
            "no ## Narrative Recap — the publish tool lifts that section"))

    def test_a_conformant_wrap_up_never_gets_the_missing_recap_row(self):
        self.assertFalse(rows_for(self.rows, "no ## Narrative Recap"),
                         self.rows)

    def test_unfenced_gm_notes_warns(self):
        vault = make_vault(self)
        (vault / "Chapter_01_Session_01_Wrap_Up.md").write_text(
            "---\ntype: session_wrap\n---\n\n## Narrative Recap\n\n"
            "It happened.\n\n## GM Notes\n\n### World State\n\nVienna.\n",
            encoding="utf-8")
        self.assertTrue(rows_for(
            vc.check_wrapup(vault, None, False),
            "## GM Notes is not inside a <!-- gm-only --> pair"))

    def test_two_gm_only_openers_warn(self):
        vault = make_vault(self)
        (vault / "Chapter_01_Session_01_Wrap_Up.md").write_text(
            "---\ntype: session_wrap\n---\n\n## Narrative Recap\n\nIt "
            "happened.\n\n<!-- gm-only -->\n\n## GM Notes\n\nA.\n\n"
            "<!-- /gm-only -->\n\n<!-- gm-only -->\n\nB.\n"
            "<!-- /gm-only -->\n", encoding="utf-8")
        self.assertTrue(rows_for(
            vc.check_wrapup(vault, None, False),
            "2 <!-- gm-only --> openers outside code"))

    def test_fence_problems_are_reported_through_the_shared_helper(self):
        vault = make_vault(self)
        (vault / "Chapter_01_Session_01_Wrap_Up.md").write_text(
            "---\ntype: session_wrap\n---\n\n## Narrative Recap\n\nIt "
            "happened.\n\n<!-- /gm-only -->\n", encoding="utf-8")
        self.assertTrue(rows_for(
            vc.check_wrapup(vault, None, False),
            "<!-- /gm-only --> with no opener — everything above it "
            "publishes"))

    def test_a_quoted_heading_inside_a_code_fence_is_never_re_nested(self):
        vault = copy_fixture(self, "wrapup")
        rel = "Quoted_Chapter_01_Session_01_Wrap_Up.md"
        (vault / rel).write_text(
            "---\ntype: session_wrap\n---\n\n## Narrative Recap\n\n"
            "The template looks like this:\n\n```markdown\n"
            "## Keeper Checklist\n\n- [ ] a task\n```\n\nAnd that is all.\n",
            encoding="utf-8")
        before = read(vault, rel).split("\n---\n", 1)[1]
        rows = vc.check_wrapup(vault, rel, True)
        self.assertTrue(rows_for(rows, "is inside a code fence — quoted, "
                                       "not re-nested"), rows)
        # Frontmatter is still backfilled; the body is untouched.
        self.assertEqual(read(vault, rel).split("\n---\n", 1)[1], before)

    def test_structure_findings_on_an_unpublished_file_cap_at_warning(self):
        vault = make_vault(self)
        (vault / "Chapter_01_Session_01_Wrap_Up.md").write_text(
            "---\ntype: session_wrap\npublish: false\n---\n\n"
            "## Narrative Recap\n\nIt happened.\n\n## Keeper Checklist\n\n"
            "- [ ] a task\n", encoding="utf-8")
        rows = vc.check_wrapup(vault, None, False)
        self.assertFalse([r for r in rows if r.startswith("ERROR\t")], rows)
        self.assertTrue(rows_for(rows, "Keeper-facing H2 "
                                       "'## Keeper Checklist'"), rows)

    # ---- filename findings -----------------------------------------

    def test_a_drifted_filename_warns_and_is_never_renamed(self):
        self.assertIn(
            f"WARNING\t{LEGACY}\tfilename 'Session 07 - The Ball - "
            f"Wrap-Up.md' is not Chapter_CC_Session_NN_Wrap_Up.md — opt-in "
            f"on a published vault — a rename changes the page URL and "
            f"needs every inbound link updated", self.rows)
        self.assertFalse([r for r in self.fixes(LEGACY) if "filename" in r],
                         self.fixes(LEGACY))

    def test_a_chapter_level_filename_is_conformant_as_is(self):
        self.assertIn(
            f"INFO\t{CHAPTER_LEVEL}\tchapter-level wrap-up filename — "
            f"conformant as-is", self.rows)

    # ---- the fix -----------------------------------------------------

    def test_the_dry_run_writes_nothing(self):
        vault = copy_fixture(self, "wrapup")
        before = {rel: read(vault, rel)
                  for rel in (CONFORMANT, LEGACY, CHAPTER_LEVEL)}
        rows = vc.check_wrapup(vault, None, False)
        self.assertTrue([r for r in rows if r.startswith("WOULD-FIX\t")], rows)
        for rel, text in before.items():
            self.assertEqual(read(vault, rel), text, rel)

    def test_fix_rewrites_the_legacy_frontmatter(self):
        vault = copy_fixture(self, "wrapup")
        vc.check_wrapup(vault, None, True)
        text = read(vault, LEGACY)
        for line in ("type: session_wrap",
                     'session: "[[Session 07 - The Ball]]"',
                     "session_number: 7",
                     'source_document: "[[Session 07 - The Ball - '
                     'Play Notes]]"',
                     'reconciled: "2026-05-02"',
                     'chapter: "[[Chapter 3 - Vienna]]"',
                     'campaign: "[[Vienna Campaign]]"',
                     "created_by: session-wrapup",
                     "tags: []",
                     'in_game_dates: "5–6 March 1814"'):
            with self.subTest(line=line):
                self.assertIn(f"\n{line}\n", text)

    def test_fix_renests_the_legacy_body(self):
        vault = copy_fixture(self, "wrapup")
        vc.check_wrapup(vault, None, True)
        text = read(vault, LEGACY)
        body = text.split("\n---\n", 1)[1]
        self.assertEqual(body, FIXED_LEGACY_BODY)

    def test_fix_leaves_exactly_one_gm_only_pair(self):
        vault = copy_fixture(self, "wrapup")
        vc.check_wrapup(vault, None, True)
        text = read(vault, LEGACY)
        self.assertEqual(text.count("<!-- gm-only -->"), 1)
        self.assertEqual(text.count("<!-- /gm-only -->"), 1)

    def test_fix_rows_report_every_applied_action(self):
        vault = copy_fixture(self, "wrapup")
        rows = vc.check_wrapup(vault, None, True)
        applied = [r for r in rows if r.startswith(f"FIXED\t{LEGACY}\t")]
        self.assertIn(f"FIXED\t{LEGACY}\ttype: session-wrap-up -> "
                      f"type: session_wrap", applied)
        self.assertIn(f"FIXED\t{LEGACY}\tadded session_number: 7", applied)
        self.assertIn(f"FIXED\t{LEGACY}\tre-nested 3 Keeper-facing H2 "
                      f"sections under ## GM Notes in one <!-- gm-only --> "
                      f"pair", applied)
        self.assertIn(f"FIXED\t{LEGACY}\trenamed heading 'What Happened — "
                      f"Narrative Recap' to 'Narrative Recap'", applied)
        self.assertIn(f"FIXED\t{LEGACY}\trenamed heading 'Cross-Entity "
                      f"Claims — Held for Confirmation' to 'Cross-Entity "
                      f"Claims' (qualifier kept as an italic line)", applied)

    def test_after_the_fix_only_the_filename_and_range_rows_remain(self):
        vault = copy_fixture(self, "wrapup")
        vc.check_wrapup(vault, None, True)
        rows = vc.check_wrapup(vault, LEGACY, False)
        findings = [r for r in rows
                    if r.split("\t")[0] in ("ERROR", "WARNING", "INFO")]
        self.assertEqual(len(findings), 2, findings)
        self.assertTrue(rows_for(findings, "must be preserved in body prose"),
                        findings)
        self.assertTrue(rows_for(findings, "Chapter_CC_Session_NN_Wrap_Up.md"),
                        findings)

    def test_the_fix_is_idempotent(self):
        vault = copy_fixture(self, "wrapup")
        vc.check_wrapup(vault, None, True)
        once = read(vault, LEGACY)
        vc.check_wrapup(vault, None, True)
        self.assertEqual(read(vault, LEGACY), once)

    def test_the_conformant_and_chapter_files_are_left_alone(self):
        vault = copy_fixture(self, "wrapup")
        before = {rel: read(vault, rel)
                  for rel in (CONFORMANT, CHAPTER_LEVEL)}
        vc.check_wrapup(vault, None, True)
        for rel, text in before.items():
            self.assertEqual(read(vault, rel), text, rel)

    def test_crlf_line_endings_survive_the_fix(self):
        vault = copy_fixture(self, "wrapup")
        rel = "Chapter_09_Session_09_Wrap_Up.md"
        body = ("---\ntype: session-wrapup\n---\n\n## Recap\n\nIt happened."
                "\n\n## Keeper Checklist\n\n- [ ] a task\n")
        with (vault / rel).open("w", encoding="utf-8", newline="") as f:
            f.write(body.replace("\n", "\r\n"))
        vc.check_wrapup(vault, rel, True)
        after = read(vault, rel)
        self.assertNotIn("\n", after.replace("\r\n", ""))
        self.assertIn("\r\n## Narrative Recap\r\n", after)
        self.assertIn("\r\n<!-- gm-only -->\r\n", after)

    def test_a_wrap_up_with_no_gm_content_gets_no_empty_fence(self):
        vault = make_vault(self)
        rel = "Chapter_01_Session_01_Wrap_Up.md"
        (vault / rel).write_text(
            "---\ntype: session_wrap\n---\n\n## Session Recap\n\n"
            "It happened.\n", encoding="utf-8")
        vc.check_wrapup(vault, rel, True)
        text = read(vault, rel)
        self.assertIn("## Narrative Recap", text)
        self.assertNotIn("gm-only", text)
        self.assertNotIn("## GM Notes", text)

    # ---- CLI ---------------------------------------------------------

    def test_cli_emits_the_section_and_all_includes_it(self):
        proc = run_cli(WRAPUP, "wrapup")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("## wrapup", proc.stdout)
        self.assertIn(f"# count: {len(self.rows)}", proc.stdout)
        self.assertIn("## wrapup", run_cli(WRAPUP, "all").stdout)

    def test_all_never_applies_the_fix(self):
        vault = copy_fixture(self, "wrapup")
        before = read(vault, LEGACY)
        proc = subprocess.run(
            [sys.executable, str(SCRIPT), str(vault), "all", "--fix"],
            capture_output=True, text=True)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(read(vault, LEGACY), before)
        self.assertNotIn("FIXED\t", proc.stdout)

    def test_cli_fix_writes_and_exits_zero(self):
        vault = copy_fixture(self, "wrapup")
        proc = run_cli(vault, "wrapup", "--fix")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("FIXED\t", proc.stdout)
        self.assertIn("type: session_wrap", read(vault, LEGACY))


if __name__ == "__main__":
    unittest.main(verbosity=2)
