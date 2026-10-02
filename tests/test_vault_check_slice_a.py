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
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

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


def stub_publish_tool(case, vault, withheld=(), which="/usr/bin/node",
                      run=None, plan=None, installed=None, mode=None,
                      stripped=None, sheet_source=None, unparseable=None):
    """Point the vault at a site and stand in for the publish tool's
    `explain --all --json`: `withheld` lists the hub paths it reports with
    `bodyWithheld: true`; `stripped` maps a path to its `strippedSections`
    (None: an older tool's answer, without the field); `sheet_source` maps
    a PC's path to its `sheetSourceSet` (None: an older tool's answer,
    without the field); `unparseable` maps a path to the parser message
    the tool reports for it (None: a tool older than 1.11.45, which gives
    the `FILE_UNPARSEABLE` code alone); `plan` is what `manifest publish-played
    --dry-run --json` answers. `which=None` means no node on PATH; `run`
    replaces subprocess.run outright; `installed` is the version of a
    gm-apprentice-publish in the site's node_modules. Returns the recorded
    calls."""
    site = Path(tempfile.mkdtemp(prefix="vc-site-"))
    case.addCleanup(shutil.rmtree, site, ignore_errors=True)
    (site / "vault.config.json").write_text("{}", encoding="utf-8")
    if installed is not None:
        pkg = site / "node_modules" / "gm-apprentice-publish"
        (pkg / "bin").mkdir(parents=True)
        (pkg / "package.json").write_text(json.dumps({"version": installed}),
                                          encoding="utf-8")
        (pkg / "bin" / "gm-publish.js").write_text("", encoding="utf-8")
    (vault / "_meta").mkdir(exist_ok=True)
    mode_line = f"  mode: {mode}\n" if mode else ""
    (vault / "_meta" / "vault-config.md").write_text(
        f"---\npublish:\n{mode_line}  site_dir: {site}\n---\n",
        encoding="utf-8")
    calls = []

    def fake(cmd, **kwargs):
        calls.append(cmd)
        if "publish-played" in cmd:
            return subprocess.CompletedProcess(cmd, 0, json.dumps(
                plan or {"applicable": True, "published": [], "unclear": []}),
                "")
        pages = [{"path": p, "bodyWithheld": True} for p in withheld]
        pages += [{"path": p, "bodyWithheld": False}
                  for p in (stripped or {}) if p not in withheld]
        if stripped is not None:
            for page in pages:
                page["strippedSections"] = stripped.get(page["path"], [])
        if sheet_source is not None:
            pages += [{"path": p, "bodyWithheld": False}
                      for p in sheet_source
                      if p not in {page["path"] for page in pages}]
            for page in pages:
                page["sheetSourceSet"] = sheet_source.get(page["path"])
        for path, message in (unparseable or {}).items():
            page = {"path": path, "bodyWithheld": False, "publishes": False,
                    "code": "FILE_UNPARSEABLE", "strippedSections": None,
                    "sheetSourceSet": None}
            if message is not None:
                page["frontmatterError"] = message
            pages.append(page)
        return subprocess.CompletedProcess(
            cmd, 0, json.dumps({"vaultPath": str(vault), "pages": pages}), "")

    patches = [mock.patch.object(vc.shutil, "which", return_value=which),
               mock.patch.object(vc.subprocess, "run", run or fake)]
    for patch in patches:
        patch.start()
        case.addCleanup(patch.stop)
    return calls


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
        vault_v = vc.parse_version("1.10.0")
        plugin_v = vc.parse_version(plugin_version_string())
        expected = ("OK" if vault_v == plugin_v
                    else "AHEAD" if vault_v > plugin_v else "MISMATCH")
        self.assertEqual(token, expected)
        # "1.9.99" sorts after "1.10.0" as text; numerically it is behind.
        self.assertLess(vc.parse_version("1.9.99"), vc.parse_version("1.10.0"))

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

    def test_quoted_wikilink_session_matches_by_number(self):
        # `session: "[[Session 08]]"` reaches the frontmatter reader as a
        # one-item list; reading it raw parsed as no number at all, so a
        # plan naming its session by link — but not by the index's exact
        # stem — fell through the number fallback and vanished from the
        # chain. vaultlib.session_ref_number unwraps it.
        vault = make_vault(self)
        (vault / "Session 08 - The Quay.md").write_text(
            "---\ntype: session\nsession_number: 8\nstatus: planned\n---\n",
            encoding="utf-8")
        (vault / "Session_08_Plan.md").write_text(
            "---\ntype: session-plan\nsession: \"[[Session 08]]\"\n---\n",
            encoding="utf-8")
        rows = vc.check_sessions(vault)
        self.assertTrue(
            rows_for(rows, "session 8: plan=\u2713"), rows)

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

    def test_link_to_another_chapters_same_named_note_is_not_this_sessions(
            self):
        # #206: Chapter 4's index pre-filled `play_notes: [[session_11_Play_Notes]]`
        # for notes not yet written, and Chapter 3 owns a note with that very
        # stem. Resolving the link by name alone claimed Chapter 3's play
        # notes and derived `played` for a session nothing had happened in.
        vault = make_vault(self)
        c3 = vault / "Chapters" / "Chapter 3 - Vienna" / "Session 11"
        c4 = vault / "Chapters" / "Chapter 4 - Calcutta" / "Sessions" / "Session 11"
        c3.mkdir(parents=True)
        c4.mkdir(parents=True)
        (c3 / "Session_11.md").write_text(
            "---\ntype: session\nsession_number: 11\nstatus: reviewed\n"
            "chapter: \"[[Chapter 3 - Vienna]]\"\n---\n", encoding="utf-8")
        (c3 / "session_11_play_notes.md").write_text(
            "---\ntype: session-play-notes\nsession: \"[[Session_11]]\"\n"
            "---\n", encoding="utf-8")
        (c4 / "Session 11 - By Command.md").write_text(
            "---\ntype: session\nsession_number: 11\nstatus: planned\n"
            "chapter: \"[[Chapter 4 - Calcutta]]\"\n"
            "documents:\n  plan: null\n"
            "  play_notes: \"[[session_11_Play_Notes]]\"\n  wrap_up: null\n"
            "---\n", encoding="utf-8")
        rows = vc.check_sessions(vault)
        ch4 = rows_for(rows, "Chapter 4 - Calcutta")
        self.assertTrue(rows_for(ch4, "derived=planned"), ch4)
        self.assertFalse(rows_for(ch4, "derived=played"), ch4)
        # The stray link is still worth telling the GM about.
        self.assertTrue(rows_for(ch4, "another chapter"), ch4)
        # And Chapter 3 keeps its own play notes.
        ch3 = rows_for(rows, "Chapter 3 - Vienna")
        self.assertTrue(rows_for(ch3, "derived=played"), ch3)

    def test_link_to_a_note_beside_the_index_survives_a_chapter_name_mismatch(
            self):
        # The index writes `chapter: [[Chapter 4]]`; its folder is
        # "Chapter 4 - Calcutta". One chapter, two spellings (vaultlib's own
        # comment documents it). A play-notes note sitting in the index's own
        # folder is this session's whatever the spellings say.
        vault = make_vault(self)
        d = vault / "Chapters" / "Chapter 4 - Calcutta" / "Session 11"
        d.mkdir(parents=True)
        (d / "Session_11.md").write_text(
            "---\ntype: session\nsession_number: 11\nstatus: played\n"
            "chapter: \"[[Chapter 4]]\"\n"
            "documents:\n  plan: null\n  play_notes: \"[[session_11_play_notes]]\"\n"
            "  wrap_up: null\n---\n", encoding="utf-8")
        (d / "session_11_play_notes.md").write_text(
            "---\ntype: session-play-notes\n---\n", encoding="utf-8")
        rows = vc.check_sessions(vault)
        self.assertTrue(rows_for(rows, "derived=played"), rows)
        self.assertFalse(rows_for(rows, "another chapter"), rows)

    def test_unfiled_note_naming_this_index_by_session_link_is_claimed(self):
        # A note with no resolvable chapter (filed loose, outside
        # Chapters/) is exactly as ambiguous by name as a same-chapter
        # one — but its own `session:` link names this index directly,
        # which is stronger evidence than the bare stem match alone.
        vault = make_vault(self)
        idx = vault / "Chapters" / "Chapter 4 - Calcutta" / "Session 11"
        idx.mkdir(parents=True)
        (idx / "Session_11.md").write_text(
            "---\ntype: session\nsession_number: 11\nstatus: played\n"
            "chapter: \"[[Chapter 4]]\"\n"
            "documents:\n  play_notes: \"[[session_11_play_notes]]\"\n---\n",
            encoding="utf-8")
        (vault / "session_11_play_notes.md").write_text(
            "---\ntype: session-play-notes\nsession: \"[[Session_11]]\"\n"
            "---\n", encoding="utf-8")
        rows = vc.check_sessions(vault)
        self.assertTrue(rows_for(rows, "derived=played"), rows)
        self.assertFalse(rows_for(rows, "another chapter"), rows)
        # The link is already in the frontmatter; do not tell the GM to add it.
        self.assertFalse(rows_for(rows, "does not link it"), rows)

    def test_session_link_does_not_override_a_known_different_chapter(self):
        # Two chapters that both restart numbering can each name their
        # index "Session_11" (the Canticle vault's own shape). A play
        # notes file that is genuinely Chapter 3's, filed in Chapter 3's
        # own tree, must not be claimed by Chapter 4's index just
        # because its `session:` link uses the same bare stem — that is
        # exactly as ambiguous as the stem match #206 already guards.
        vault = make_vault(self)
        c3 = vault / "Chapters" / "Chapter 3 - Vienna" / "Session 11"
        c4 = vault / "Chapters" / "Chapter 4 - Calcutta" / "Session 11"
        c3.mkdir(parents=True)
        c4.mkdir(parents=True)
        (c3 / "Session_11.md").write_text(
            "---\ntype: session\nsession_number: 11\nstatus: reviewed\n"
            "chapter: \"[[Chapter 3 - Vienna]]\"\n---\n", encoding="utf-8")
        (c3 / "session_11_play_notes.md").write_text(
            "---\ntype: session-play-notes\nchapter: \"[[Chapter 3 - Vienna]]\"\n"
            "session: \"[[Session_11]]\"\n---\n", encoding="utf-8")
        (c4 / "Session_11.md").write_text(
            "---\ntype: session\nsession_number: 11\nstatus: planned\n"
            "chapter: \"[[Chapter 4 - Calcutta]]\"\n"
            "documents:\n  play_notes: \"[[session_11_play_notes]]\"\n---\n",
            encoding="utf-8")
        rows = vc.check_sessions(vault)
        ch4 = rows_for(rows, "Chapter 4 - Calcutta")
        self.assertTrue(rows_for(ch4, "derived=planned"), ch4)
        self.assertTrue(rows_for(ch4, "another chapter"), ch4)
        ch3 = rows_for(rows, "Chapter 3 - Vienna")
        self.assertTrue(rows_for(ch3, "derived=played"), ch3)

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

    # #276: once a session has a Wrap-Up the site withholds the hub body, so
    # bookkeeping there leaks nothing — but it is in the wrong document.
    HUB = ("---\ntype: session\nsession_number: 1\nstatus: wrap-up\n"
           "documents:\n  wrap_up: \"[[Chapter_01_Session_01_Wrap_Up]]\"\n"
           "---\n\n# Session 01 - Lone\n\n")
    WRAP = ("---\ntype: session_wrap\nsession: \"[[Session 01 - Lone]]\"\n"
            "canon_status: DRAFT\n---\n")

    def hub_vault(self, body, wrap=True, hub=None, withheld=True):
        """`withheld`: what the (stubbed) publish tool says of the hub."""
        vault = make_vault(self)
        (vault / "Session 01 - Lone.md").write_text(
            (hub or self.HUB) + body, encoding="utf-8")
        if wrap:
            (vault / "Chapter_01_Session_01_Wrap_Up.md").write_text(
                self.WRAP, encoding="utf-8")
        stub_publish_tool(self, vault,
                          ["Session 01 - Lone.md"] if withheld else [])
        return vault

    def test_hub_bookkeeping_is_an_info_naming_where_it_belongs(self):
        vault = self.hub_vault(
            "- Plan: [[Session 01 - Lone - Plan]]\n\n## Scene Index\n\n"
            "| Scene | State |\n|---|---|\n| [[Churchyard]] | contingency |\n")
        rows = [r for r in vc.check_sessions(vault)
                if "session index body" in r]
        self.assertEqual(len(rows), 1, rows)
        row = rows[0]
        self.assertTrue(row.startswith("INFO\tSession 01 - Lone.md:11\t"), row)
        self.assertIn("5 line(s) outside a gm-only fence", row)
        self.assertIn("frontmatter `documents:`", row)
        self.assertIn("go in the Plan", row)
        self.assertIn("fenced ## GM Notes", row)
        self.assertNotIn("handoffs", row)

    def test_template_shaped_hub_is_clean(self):
        # H1, the template's comment, and a fenced GM Notes dashboard.
        vault = self.hub_vault(
            "<!-- Metadata only. -->\n\n<!-- gm-only -->\n## GM Notes\n\n"
            "- Key prep: [[Standing_Situations]] — Keeper-only\n"
            "<!-- /gm-only -->\n")
        self.assertFalse(rows_for(vc.check_sessions(vault),
                                  "session index body"))

    def test_hub_the_site_does_not_withhold_is_not_flagged(self):
        # The publish tool decides (#276): no Wrap-Up it pairs and
        # publishes, no row — the body is the session's published record.
        vault = self.hub_vault("- Plan: [[Session 01 - Lone - Plan]]\n",
                               withheld=False)
        self.assertFalse(rows_for(vc.check_sessions(vault),
                                  "session index body"))

    def test_publish_tool_unavailable_hides_the_row_and_says_so(self):
        vault = make_vault(self)
        (vault / "Session 01 - Lone.md").write_text(
            self.HUB + "- Plan: [[Session 01 - Lone - Plan]]\n",
            encoding="utf-8")
        (vault / "Chapter_01_Session_01_Wrap_Up.md").write_text(
            self.WRAP, encoding="utf-8")
        stub_publish_tool(self, vault, ["Session 01 - Lone.md"], which=None)
        rows = vc.check_sessions(vault)
        self.assertFalse(rows_for(rows, "session index body"), rows)
        note = rows_for(rows, "publish tool could not be consulted")
        self.assertEqual(len(note), 1, rows)
        self.assertIn("node is not on PATH", note[0])

    def test_cli_emits_the_section_and_all_includes_it(self):
        proc = run_cli(FIXTURES / "sessions", "sessions")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("## sessions", proc.stdout)
        self.assertIn(f"# count: {len(self.rows)}", proc.stdout)
        self.assertIn("## sessions", run_cli(FIXTURES / "sessions", "all").stdout)


class SessionsManifestTests(unittest.TestCase):
    """`vault_check.py VAULT sessions` — played sessions and their Wrap-Ups
    missing from the publish manifest's Publishing section (#277). What
    happens to each is the publish tool's answer (`manifest publish-played
    --dry-run --json`), stubbed here."""

    INDEX = "Session 01 - Lone.md"
    WRAP = "Chapter_01_Session_01_Wrap_Up.md"

    def vault(self, manifest, config="---\npublish:\n  mode: player\n---\n",
              status="reviewed"):
        vault = make_vault(self, config=config)
        (vault / self.INDEX).write_text(
            f"---\ntype: session\nsession_number: 1\nstatus: {status}\n---\n",
            encoding="utf-8")
        (vault / self.WRAP).write_text(
            "---\ntype: session_wrap\nsession: \"[[Session 01 - Lone]]\"\n"
            "canon_status: AUTHORITATIVE\n---\n", encoding="utf-8")
        if manifest is not None:
            (vault / "_meta" / "publish-manifest.md").write_text(
                manifest, encoding="utf-8")
        return vault

    def missing(self, vault):
        return [r for r in vc.check_sessions(vault)
                if "publish-manifest.md" in r]

    NEEDS = ("## Publishing (0 files)\n\n## Needs Decision (1 files)\n\n"
             "- [ ] Session 01 - Lone.md\n")

    def test_without_the_tool_the_row_promises_nothing(self):
        rows = self.missing(self.vault(self.NEEDS))
        self.assertEqual(len(rows), 1, rows)
        row = rows_for(rows, f"\t{self.INDEX}\t")[0]
        self.assertTrue(row.startswith("WARNING\t"), row)
        self.assertIn("(Needs Decision)", row)
        self.assertIn("gm-publish manifest publish-played", row)
        self.assertNotIn("will register", row)
        self.assertNotIn("will ask", row)
        self.assertNotIn("gm-only", row)

    def test_a_session_the_tool_would_tick_says_publish_played_registers_it(self):
        vault = self.vault(self.NEEDS)
        calls = stub_publish_tool(self, vault, mode="player", plan={
            "applicable": True, "published": [self.INDEX, self.WRAP],
            "unclear": []})
        rows = self.missing(vault)
        self.assertEqual(len(rows), 2, rows)
        self.assertIn("publish-played will register it",
                      rows_for(rows, f"\t{self.INDEX}\t")[0])
        wrap = rows_for(rows, f"\t{self.WRAP}\t")[0]
        self.assertIn("Wrap-Up is not under Publishing", wrap)
        self.assertIn("(no manifest section)", wrap)
        played = [c for c in calls if "publish-played" in c][0]
        self.assertEqual(played[2:6], ["manifest", "publish-played",
                                       "--dry-run", "--json"])
        self.assertEqual(played[played.index("--vault") + 1],
                         str(vault.resolve()))

    def test_an_unclear_session_says_publish_site_will_ask(self):
        vault = self.vault(self.NEEDS, status="wrap-up")
        reason = f"Wrap-Up not reviewed yet ({self.WRAP})"
        stub_publish_tool(self, vault, mode="player", plan={
            "applicable": True, "published": [],
            "unclear": [{"path": self.INDEX, "reason": reason,
                         "wrapUp": self.WRAP}]})
        rows = self.missing(vault)
        self.assertEqual(len(rows), 2, rows)
        for row in rows:
            self.assertIn(f"publish-site will ask the GM ({reason})", row)
            self.assertNotIn("will register", row)

    def test_a_session_the_tool_neither_ticks_nor_asks_about_points_at_session(self):
        # Review of #278: the fallback never says to `manifest apply --publish` a
        # session index, which would bypass pairing and the site-pin gate.
        vault = self.vault(self.NEEDS)
        stub_publish_tool(self, vault, mode="player", plan={
            "applicable": True, "published": [], "unclear": []})
        row = rows_for(self.missing(vault), f"\t{self.INDEX}\t")[0]
        self.assertNotIn("manifest apply", row)
        self.assertIn(f'manifest publish-played --session "{self.INDEX}"',
                      row)

    def test_the_python_heuristic_no_longer_names_a_wrap_up(self):
        # The folder/number guess named this Wrap-Up; the tool, asked, pairs
        # nothing and ticks nothing, so there is no Wrap-Up row.
        vault = self.vault(self.NEEDS)
        stub_publish_tool(self, vault, mode="player", plan={
            "applicable": True, "published": [], "unclear": [
                {"path": self.INDEX, "reason": "status reviewed but no "
                 "Wrap-Up linked to it", "wrapUp": None}]})
        rows = self.missing(vault)
        self.assertEqual(len(rows), 1, rows)
        self.assertIn("no Wrap-Up linked", rows[0])

    def test_a_stale_site_pin_is_not_asked(self):
        vault = self.vault(self.NEEDS)
        calls = stub_publish_tool(self, vault, mode="player",
                                  installed="1.11.39")
        rows = vc.check_sessions(vault)
        self.assertFalse([c for c in calls if "publish-played" in c], calls)
        self.assertTrue(rows_for(rows, "site pinned to 1.11.39 predates "
                                       "body withholding"), rows)
        row = rows_for(rows, f"\t{self.INDEX}\t")
        self.assertNotIn("will register", "".join(row))

    def test_the_wrap_up_of_a_published_session_is_still_reported(self):
        vault = self.vault(f"## Publishing (1 files)\n\n- [x] {self.INDEX}\n",
                           status="wrap-up")
        reason = f"Wrap-Up not reviewed yet ({self.WRAP})"
        stub_publish_tool(self, vault, mode="player", plan={
            "applicable": True, "published": [],
            "unclear": [{"path": self.INDEX, "reason": reason,
                         "wrapUp": self.WRAP}]})
        rows = self.missing(vault)
        self.assertEqual(len(rows), 1, rows)
        self.assertIn(f"\t{self.WRAP}\tWrap-Up", rows[0])
        self.assertIn(f"publish-site will ask the GM ({reason})", rows[0])

    def test_listed_under_publishing_is_silent(self):
        self.assertEqual(self.missing(self.vault(
            "## Publishing (2 files)\n\n"
            f"- [x] {self.INDEX}\n- [x] {self.WRAP} — recap\n")), [])

    def test_unchecked_publishing_entry_does_not_count(self):
        rows = self.missing(self.vault(
            f"## Publishing (2 files)\n\n- [ ] {self.INDEX}\n"
            f"- [x] {self.WRAP}\n"))
        self.assertEqual(len(rows), 1, rows)
        self.assertIn(f"\t{self.INDEX}\t", rows[0])

    def test_excluded_is_a_decision_not_a_finding(self):
        self.assertEqual(self.missing(self.vault(
            "## Excluded (2 files)\n\n"
            f"- [x] {self.INDEX} — private\n- [x] {self.WRAP}\n")), [])

    def test_no_manifest_is_silent(self):
        self.assertEqual(self.missing(self.vault(None)), [])

    def test_full_mode_is_silent(self):
        self.assertEqual(self.missing(self.vault(
            "## Publishing (0 files)\n",
            config="---\npublish:\n  mode: full\n---\n")), [])

    def test_mode_defaults_to_player(self):
        self.assertEqual(len(self.missing(self.vault(
            "## Publishing (0 files)\n", config=None))), 1)

    def test_unplayed_session_is_silent(self):
        self.assertEqual(self.missing(self.vault(
            "## Publishing (0 files)\n", status="prepped")), [])


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


class FrontmatterUnparseableTests(unittest.TestCase):
    """#287: the line reader passes frontmatter the site's build rejects,
    and the note drops off the site."""

    DUP = "---\ntype: pc\nsheet_source: paper\nsheet_source: PDF\n---\n"

    def _vault(self, **stub):
        vault = make_vault(self)
        (vault / "PCs").mkdir()
        (vault / "PCs" / "Dup.md").write_text(self.DUP, encoding="utf-8")
        (vault / "Fine.md").write_text("---\ntype: npc\n---\n",
                                       encoding="utf-8")
        return vault, stub_publish_tool(self, vault, **stub)

    def test_a_note_the_build_cannot_parse_is_an_error_with_the_message(self):
        vault, calls = self._vault(unparseable={
            "PCs/Dup.md": "duplicated mapping key (4:1)\n\n 3 | sheet_source"})
        rows = rows_for(vc.check_frontmatter(vault, None), "cannot parse")
        self.assertEqual(rows, [
            "ERROR\tPCs/Dup.md\tthe site's build cannot parse this "
            "frontmatter (duplicated mapping key (4:1)) and skips the note "
            "— most often a key written twice, or an unquoted value with a "
            "colon in it"])
        self.assertEqual(len(calls), 1, calls)

    def test_the_line_reader_alone_sees_nothing_wrong(self):
        # What #287 reported: without the tool's answer the file passes.
        vault, _calls = self._vault()
        self.assertFalse(rows_for(vc.check_frontmatter(vault, None),
                                  "cannot parse"))

    def test_an_older_tool_gives_the_code_without_a_message(self):
        vault, _calls = self._vault(unparseable={"PCs/Dup.md": None})
        rows = rows_for(vc.check_frontmatter(vault, None), "cannot parse")
        self.assertEqual(len(rows), 1, rows)
        self.assertIn("this frontmatter and skips the note", rows[0])

    def test_folder_scope_leaves_out_files_outside_it(self):
        vault, _calls = self._vault(unparseable={
            "PCs/Dup.md": "bad", "Elsewhere/Other.md": "bad"})
        (vault / "Elsewhere").mkdir()
        (vault / "Elsewhere" / "Other.md").write_text(self.DUP,
                                                      encoding="utf-8")
        rows = rows_for(vc.check_frontmatter(vault, "PCs"), "cannot parse")
        self.assertEqual(len(rows), 1, rows)
        self.assertIn("PCs/Dup.md", rows[0])

    def test_a_folder_with_nothing_broken_in_it_gets_no_row_at_all(self):
        # The post-write loops run `--folder` on a clean folder; a broken
        # note elsewhere must not leave a stray "asked the plugin's tool".
        vault, _calls = self._vault(unparseable={"PCs/Dup.md": "bad"})
        (vault / "Clean").mkdir()
        (vault / "Clean" / "Ok.md").write_text(
            "---\ntype: npc\ncanon_status: DRAFT\n---\n", encoding="utf-8")
        self.assertEqual(vc.check_frontmatter(vault, "Clean"), [])

    def test_a_file_the_build_walks_and_this_script_skips_is_still_named(self):
        # `_inbox` is in vaultlib's SKIP_DIRS and not in the tool's
        # exclude_dirs, so the build's closing line names it.
        vault, _calls = self._vault(unparseable={"_inbox/Raw.md": "bad"})
        rows = rows_for(vc.check_frontmatter(vault, None), "cannot parse")
        self.assertEqual([r.split("\t")[1] for r in rows], ["_inbox/Raw.md"])
        self.assertFalse(rows_for(vc.check_frontmatter(vault, "PCs"),
                                  "cannot parse"))

    def test_a_tab_in_the_parser_message_does_not_split_the_row(self):
        vault, _calls = self._vault(unparseable={"PCs/Dup.md": "bad\there"})
        rows = rows_for(vc.check_frontmatter(vault, None), "cannot parse")
        self.assertEqual(len(rows[0].split("\t")), 3, rows)

    def test_a_decomposed_filename_still_matches_the_tools_nfc_path(self):
        # The tool reports NFC paths; the vault walk gives the name as
        # written on disk.
        vault, _calls = self._vault(unparseable={"Ren\u00e9e.md": "bad"})
        (vault / "Rene\u0301e.md").write_text(self.DUP, encoding="utf-8")
        rows = rows_for(vc.check_frontmatter(vault, None), "cannot parse")
        self.assertEqual(len(rows), 1, rows)

    def test_a_tool_that_cannot_answer_says_what_went_unchecked(self):
        vault, _calls = self._vault(which=None)
        rows = vc.check_frontmatter(vault, None)
        info = rows_for(rows, "could not be consulted")
        self.assertEqual(len(info), 1, rows)
        self.assertIn("node is not on PATH", info[0])
        self.assertIn("were not looked for", info[0])
        self.assertFalse(rows_for(rows, "cannot parse this"), rows)

    def test_a_vault_that_does_not_publish_is_not_asked_or_told(self):
        vault = make_vault(self)
        (vault / "Dup.md").write_text(self.DUP, encoding="utf-8")
        with mock.patch.object(vc.subprocess, "run") as run:
            rows = vc.check_frontmatter(vault, None)
        run.assert_not_called()
        self.assertFalse(rows_for(rows, "publish tool"), rows)
        self.assertFalse(rows_for(rows, "cannot parse"), rows)

    def test_an_answer_of_the_wrong_shape_is_reported_not_raised(self):
        vault = make_vault(self)
        (vault / "Dup.md").write_text(self.DUP, encoding="utf-8")
        for payload in ('{"pages": [5]}', '{"nope": 1}', '[]'):
            with self.subTest(payload=payload):
                stub_publish_tool(self, vault, run=lambda cmd, **kw:
                                  subprocess.CompletedProcess(cmd, 0, payload, ""))
                rows = vc.check_frontmatter(vault, None)
                self.assertTrue(rows_for(rows, "expected JSON"), rows)

    def test_all_asks_the_tool_once_for_frontmatter_gm_leak_and_pc_body(self):
        vault, calls = self._vault(unparseable={"PCs/Dup.md": "bad"})
        explain = vc.ExplainAll(vault)
        vc.check_frontmatter(vault, None, explain)
        vc.check_gm_leak(vault, None, explain=explain)
        vc.check_pc_body(vault, explain=explain)
        self.assertEqual(len(calls), 1, calls)


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
        # A wrap-template GM heading: the row carries the re-nest advice.
        self.assertTrue(rows_for(self.rows, f"WARNING\t{LEAKY}:14\tGM-only heading "
                                 f"'Keeper Checklist' publishes"), self.rows)

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

    def test_a_fenced_gm_notes_heading_hides_nothing_below_the_closer(self):
        # `<!-- gm-only -->` wrapping `## GM Notes` is the shape
        # `wrapup --fix` writes. The publish pipeline strips the block
        # before filterSections runs, so that heading excludes nothing —
        # and letting it start an exclusion made this check blind to
        # everything a GM appended after the closer.
        vault = make_vault(self)
        (vault / "Bob.md").write_text(
            "---\ntype: npc\n---\n\n# Bob\n\n<!-- gm-only -->\n"
            "## GM Notes\nhidden\n<!-- /gm-only -->\n\n"
            "**Secret:** he runs the cult.\n\n"
            "> [!note] GM only: he lies.\n", encoding="utf-8")
        rows = vc.check_gm_leak(vault, None)
        self.assertTrue(rows_for(rows, "bold label 'Secret'"), rows)
        self.assertTrue(rows_for(rows, "callout [!note] GM only"), rows)

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
        # 8 findings and no WOULD-FIX: Config.md's and Stub.md's heading
        # rows are keyword WARNINGs, which `--fix` never moves (#228), and
        # Leaky.md's ERRORs sit beside its own unbalanced fence, so the
        # whole file is refused.
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


FIX_CONFIG = ('---\ntype: meta\npublish:\n'
              '  exclude_sections: ["GM Notes", "Keeper Secrets"]\n---\n')


def leak_heading_rows(rows, rel):
    """ERROR/WARNING heading rows for one file — what `--fix` exists to
    clear."""
    return [r for r in rows if r.startswith(("ERROR", "WARNING"))
            and f"{rel}:" in r and "heading" in r]


def assert_fences_ordered(case, text):
    """Every gm-only closer follows its opener, and none is left over."""
    states, problems = vc.scan_body(text, ())
    case.assertEqual(problems, [], text)
    case.assertLess(text.index("<!-- gm-only -->"),
                    text.index("<!-- /gm-only -->"), text)


class GmLeakFixTests(unittest.TestCase):
    """`vault_check.py VAULT gm-leak --fix` — re-nests the bold-wrapped
    ERROR headings only (issue #228)."""

    LEAKING = (
        "---\ntype: npc\n---\n\n"
        "# Villain\n\n"
        "Some player-facing description.\n\n"
        "## **Keeper Secrets**\n\n"
        "The villain's true plan is X.\n\n"
        "### Sub Detail\n\n"
        "More secret detail.\n\n"
        "## Notes\n\n"
        "Ordinary notes that stay put.\n"
    )

    def vault_with(self, text, name="Villain.md", config=FIX_CONFIG):
        vault = make_vault(self, config)
        (vault / name).write_text(text, encoding="utf-8")
        return vault

    def test_dry_run_changes_nothing(self):
        vault = self.vault_with(self.LEAKING)
        rows = vc.check_gm_leak(vault, None)
        self.assertTrue(rows_for(rows, "WOULD-FIX\tVillain.md"), rows)
        self.assertEqual(read(vault, "Villain.md"), self.LEAKING)

    def test_apply_renests_under_gm_notes(self):
        vault = self.vault_with(self.LEAKING)
        rows = vc.check_gm_leak(vault, None, fix=True)
        self.assertTrue(rows_for(rows, "FIXED\tVillain.md"), rows)
        after = read(vault, "Villain.md")
        self.assertIn("## GM Notes\n\n### **Keeper Secrets**\n", after)
        self.assertIn("#### Sub Detail", after)
        self.assertFalse(vc.check_gm_leak(vault, None))

    def test_idempotent_second_run(self):
        vault = self.vault_with(self.LEAKING)
        vc.check_gm_leak(vault, None, fix=True)
        once = read(vault, "Villain.md")
        rows = vc.check_gm_leak(vault, None, fix=True)
        self.assertFalse(rows_for(rows, "Villain"), rows)
        self.assertEqual(read(vault, "Villain.md"), once)

    def test_already_correct_file_is_untouched(self):
        correct = ("---\ntype: npc\n---\n\n# Ally\n\nPlayer-facing text.\n\n"
                   "## GM Notes\n\n### Keeper Secrets\n\nAlready nested.\n")
        vault = self.vault_with(correct, "Ally.md")
        rows = vc.check_gm_leak(vault, None, fix=True)
        self.assertFalse(rows_for(rows, "Ally"), rows)
        self.assertEqual(read(vault, "Ally.md"), correct)

    def test_player_facing_headings_are_left_alone(self):
        vault = self.vault_with(self.LEAKING)
        vc.check_gm_leak(vault, None, fix=True)
        self.assertIn(
            "Some player-facing description.\n\n## Notes\n\n"
            "Ordinary notes that stay put.", read(vault, "Villain.md"))

    def test_appends_to_an_existing_gm_notes(self):
        text = ("---\ntype: npc\n---\n\n# Bob\n\nPlayer text.\n\n"
                "## GM Notes\n\nSome existing gm content here.\n\n"
                "## **Keeper Secrets**\n\nSecret text.\n")
        vault = self.vault_with(text, "Bob.md")
        rows = vc.check_gm_leak(vault, None, fix=True)
        self.assertTrue(rows_for(rows, "FIXED\tBob.md"), rows)
        after = read(vault, "Bob.md")
        self.assertEqual(after.count("## GM Notes"), 1)
        self.assertIn(
            "Some existing gm content here.\n\n### **Keeper Secrets**", after)

    def test_unbalanced_fence_blocks_the_whole_file(self):
        text = ("---\ntype: npc\n---\n\n# X\n\nPlayer text.\n\n"
                "## **Keeper Secrets**\n\nhidden text\n<!-- /gm-only -->\n"
                "more text\n")
        vault = self.vault_with(text, "Leaky.md")
        rows = vc.check_gm_leak(vault, None, fix=True)
        self.assertFalse(rows_for(rows, "FIXED\tLeaky.md"), rows)
        self.assertFalse(rows_for(rows, "WOULD-FIX\tLeaky.md"), rows)
        self.assertEqual(read(vault, "Leaky.md"), text)

    def test_cli_fix_writes_and_reports_fixed(self):
        vault = self.vault_with(self.LEAKING)
        proc = run_cli(vault, "gm-leak", "--fix")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("FIXED\tVillain.md", proc.stdout)
        self.assertIn("## GM Notes", read(vault, "Villain.md"))

    def test_cli_all_never_writes(self):
        vault = self.vault_with(self.LEAKING)
        proc = run_cli(vault, "all", "--fix")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(read(vault, "Villain.md"), self.LEAKING)

    # ---- C3: keyword WARNINGs are reported, never moved ----------------

    def test_keyword_warnings_are_reported_but_never_moved(self):
        text = ("---\ntype: location\n---\n\n# The Lighthouse Keeper\n\n"
                "A tall tower.\n\n## Secret Passage\n\nBehind the stove.\n\n"
                "## Innkeeper\n\nMarta.\n\n## Shopkeeper\n\nOtto.\n\n"
                "## Tactics\n\nHold the stairs.\n")
        vault = self.vault_with(text, "Lighthouse.md")
        rows = vc.check_gm_leak(vault, None, fix=True)
        self.assertEqual(len(leak_heading_rows(rows, "Lighthouse.md")), 5,
                         rows)
        self.assertFalse(rows_for(rows, "FIXED"), rows)
        self.assertEqual(read(vault, "Lighthouse.md"), text)

    def test_a_level_one_heading_never_moves(self):
        text = ("---\ntype: npc\n---\n\n# **Keeper Secrets**\n\n"
                "Body text.\n")
        vault = self.vault_with(text, "Title.md")
        rows = vc.check_gm_leak(vault, None, fix=True)
        self.assertFalse(rows_for(rows, "FIXED"), rows)
        self.assertEqual(read(vault, "Title.md"), text)

    # ---- C2: a moved block never splits a fence ------------------------

    def test_a_moved_block_extends_to_the_closer_it_opened(self):
        text = ("---\ntype: npc\n---\n\n# Bob\n\nPlayer text.\n\n"
                "## **Keeper Secrets**\n\n<!-- gm-only -->\nHe lied.\n\n"
                "## Motive\n\nRevenge for his brother.\n<!-- /gm-only -->\n\n"
                "## Public\n\nEveryone knows this.\n")
        vault = self.vault_with(text, "Bob.md")
        vc.check_gm_leak(vault, None, fix=True)
        after = read(vault, "Bob.md")
        assert_fences_ordered(self, after)
        hidden = vc.hidden_lines(after, ["GM Notes", "Keeper Secrets"],
                                 {"type": "npc"})
        self.assertIn("Revenge for his brother.", hidden)
        self.assertNotIn("Everyone knows this.", hidden)
        self.assertFalse(vc.check_gm_leak(vault, None))

    # ---- C4: a fenced ## GM Notes takes the block inside its fence -----

    def test_fenced_gm_notes_mid_file(self):
        text = ("---\ntype: npc\n---\n\n# Bob\n\n<!-- gm-only -->\n"
                "## GM Notes\n\nOld notes.\n<!-- /gm-only -->\n\n"
                "## Description\n\nTall.\n\n## **Keeper Secrets**\n\n"
                "He lied.\n\n## Later\n\nShown.\n")
        vault = self.vault_with(text, "Bob.md")
        vc.check_gm_leak(vault, None, fix=True)
        after = read(vault, "Bob.md")
        assert_fences_ordered(self, after)
        self.assertLess(after.index("He lied."),
                        after.index("<!-- /gm-only -->"), after)
        self.assertFalse(vc.check_gm_leak(vault, None))
        once = after
        vc.check_gm_leak(vault, None, fix=True)
        self.assertEqual(read(vault, "Bob.md"), once)

    def test_fenced_gm_notes_at_eof(self):
        text = ("---\ntype: npc\n---\n\n# Bob\n\n## **Keeper Secrets**\n\n"
                "He lied.\n\n<!-- gm-only -->\n## GM Notes\n\nOld notes.\n"
                "<!-- /gm-only -->\n")
        vault = self.vault_with(text, "Bob.md")
        vc.check_gm_leak(vault, None, fix=True)
        after = read(vault, "Bob.md")
        assert_fences_ordered(self, after)
        self.assertLess(after.index("He lied."),
                        after.index("<!-- /gm-only -->"), after)
        self.assertTrue(after.rstrip().endswith("<!-- /gm-only -->"), after)
        self.assertFalse(vc.check_gm_leak(vault, None))
        once = after
        vc.check_gm_leak(vault, None, fix=True)
        self.assertEqual(read(vault, "Bob.md"), once)

    # ---- the leak invariant --------------------------------------------

    def test_gm_notes_missing_from_the_list_refuses(self):
        # Moving under a `## GM Notes` the site publishes hides nothing
        # and would demote the heading again on every run.
        config = ('---\ntype: meta\npublish:\n'
                  '  exclude_sections: ["Keeper Secrets"]\n---\n')
        vault = self.vault_with(self.LEAKING, config=config)
        rows = vc.check_gm_leak(vault, None, fix=True)
        self.assertTrue(rows_for(rows, "ERROR\tVillain.md\tre-nest refused"),
                        rows)
        self.assertEqual(read(vault, "Villain.md"), self.LEAKING)

    def test_leak_problem_catches_a_hidden_line_that_publishes(self):
        before = "## GM Notes\n\nsecret\n\n## Public\n\nshown\n"
        after = "## Public\n\nshown\n\nsecret\n"
        self.assertIn("would publish",
                      vc.leak_problem(before, ["GM Notes"], after,
                                      ["GM Notes"], {}))
        self.assertIsNone(vc.leak_problem(before, ["GM Notes"], before,
                                          ["GM Notes"], {}))

    def test_leak_problem_catches_a_new_fence_problem(self):
        before = "<!-- gm-only -->\nx\n<!-- /gm-only -->\n"
        after = "<!-- /gm-only -->\nx\n<!-- gm-only -->\n"
        self.assertIn("rewrite leaves",
                      vc.leak_problem(before, [], after, [], {}))


class GmLeakRenestExcludesTests(unittest.TestCase):
    """`gm-leak --renest-excludes` — the 1.8.3 migration in one command:
    re-nest every current exclude-list heading, then collapse the list."""

    OLD_CONFIG = (
        "---\ntype: meta\ngm_apprentice_version: \"1.8.0\"\npublish:\n"
        "  mode: player\n"
        '  exclude_sections: ["GM Notes", "World State", "Keeper Checklist",'
        ' "Player Notes", "Source References"]\n'
        "  exclude_fields: [secrets]\n---\n\n# Config\n")
    BOB = ("---\ntype: npc\n---\n\n# Bob\n\nA sailor.\n\n"
           "## World State\n\nThe harbour burns in week 3.\n\n"
           "## Keeper Checklist\n\n- Plant the letter.\n\n"
           "## Player Notes\n\nThey suspect the mate.\n\n"
           "## Source References\n\nKeeper Rulebook p. 99.\n")
    SECRETS = ("The harbour burns in week 3.", "- Plant the letter.",
               "They suspect the mate.", "Keeper Rulebook p. 99.")

    def vault(self, config=OLD_CONFIG, **files):
        vault = make_vault(self, config)
        for name, text in (files or {"Bob.md": self.BOB}).items():
            (vault / name).write_text(text, encoding="utf-8")
        return vault

    def test_plain_gm_leak_sees_nothing_before_the_collapse(self):
        # The C1 trap: every heading is hidden by today's list.
        vault = self.vault()
        self.assertFalse(rows_for(vc.check_gm_leak(vault, None), "Bob.md"))

    def test_dry_run_plans_every_heading_and_the_collapse(self):
        vault = self.vault()
        rows = vc.check_gm_leak(vault, None, renest_excludes=True)
        for title in ("World State", "Keeper Checklist", "Player Notes",
                      "Source References"):
            self.assertIn(f"WOULD-FIX\tBob.md\tre-nested '{title}' under "
                          f"## GM Notes", rows)
        self.assertTrue(rows_for(rows, "WOULD-FIX\t_meta/vault-config.md"),
                        rows)
        self.assertEqual(read(vault, "Bob.md"), self.BOB)
        self.assertEqual(read(vault, "_meta/vault-config.md"),
                         self.OLD_CONFIG)

    def test_fix_hides_everything_after_the_collapse(self):
        vault = self.vault()
        rows = vc.check_gm_leak(vault, None, fix=True, renest_excludes=True)
        self.assertTrue(rows_for(rows, "FIXED\t_meta/vault-config.md"), rows)
        self.assertEqual(vc.effective_exclude_sections(vault), ["GM Notes"])
        config = read(vault, "_meta/vault-config.md")
        self.assertIn("  exclude_fields: [secrets]", config)
        self.assertIn('gm_apprentice_version: "1.8.0"', config)
        hidden = vc.hidden_lines(read(vault, "Bob.md"), ["GM Notes"],
                                 {"type": "npc"})
        for line in self.SECRETS:
            self.assertIn(line, hidden)
        self.assertFalse(leak_heading_rows(vc.check_gm_leak(vault, None),
                                           "Bob.md"))

    def test_second_run_is_a_no_op(self):
        vault = self.vault()
        vc.check_gm_leak(vault, None, fix=True, renest_excludes=True)
        once = read(vault, "Bob.md")
        rows = vc.check_gm_leak(vault, None, fix=True, renest_excludes=True)
        self.assertFalse(rows_for(rows, "FIXED"), rows)
        self.assertEqual(read(vault, "Bob.md"), once)

    def test_a_block_list_config_collapses_cleanly(self):
        config = ("---\npublish:\n  exclude_sections:\n    - GM Notes\n"
                  "    - World State\n  mode: player\n---\n")
        vault = self.vault(config)
        vc.check_gm_leak(vault, None, fix=True, renest_excludes=True)
        self.assertEqual(read(vault, "_meta/vault-config.md"),
                         '---\npublish:\n  exclude_sections: ["GM Notes"]\n'
                         "  mode: player\n---\n")

    def test_a_vault_on_the_defaults_is_re_nested_but_keeps_its_defaults(
            self):
        # Writing ["GM Notes"] would drop Reconciliation Context, Handoff
        # to Reconcile and the rest for every future file (#144).
        text = ("---\ntype: npc\n---\n\n# Ann\n\n## Player Notes\n\nx1\n\n"
                "## Reconciliation Context\n\nx2\n")
        config = "---\npublish:\n  mode: player\n---\n"
        vault = self.vault(config, **{"Ann.md": text})
        rows = vc.check_gm_leak(vault, None, fix=True, renest_excludes=True)
        self.assertFalse(rows_for(rows, "collapsed"), rows)
        self.assertEqual(read(vault, "_meta/vault-config.md"), config)
        self.assertEqual(vc.effective_exclude_sections(vault),
                         vc.resolve_exclude_sections(None))
        hidden = vc.hidden_lines(read(vault, "Ann.md"), ["GM Notes"], {})
        self.assertIn("x1", hidden)
        self.assertIn("x2", hidden)

    def test_an_h1_that_would_leak_blocks_everything(self):
        h1 = "---\ntype: npc\n---\n\n# World State\n\nThe war is lost.\n"
        vault = self.vault(**{"Bob.md": self.BOB, "H1.md": h1})
        rows = vc.check_gm_leak(vault, None, fix=True, renest_excludes=True)
        self.assertTrue(rows_for(rows, "ERROR\tH1.md\tre-nest refused"), rows)
        self.assertTrue(rows_for(rows, "migration blocked"), rows)
        self.assertFalse(rows_for(rows, "FIXED"), rows)
        self.assertEqual(read(vault, "Bob.md"), self.BOB)
        self.assertEqual(read(vault, "_meta/vault-config.md"),
                         self.OLD_CONFIG)

    def test_an_already_nested_heading_stays_put(self):
        text = ("---\ntype: npc\n---\n\n# Cy\n\n## GM Notes\n\n"
                "### World State\n\nquiet\n")
        vault = self.vault(**{"Cy.md": text})
        rows = vc.check_gm_leak(vault, None, fix=True, renest_excludes=True)
        self.assertFalse(rows_for(rows, "Cy.md"), rows)
        self.assertEqual(read(vault, "Cy.md"), text)

    def test_cli_refuses_a_folder(self):
        vault = self.vault()
        proc = run_cli(vault, "gm-leak", "--renest-excludes", "--folder",
                       "X")
        self.assertEqual(proc.returncode, 2)
        self.assertEqual(read(vault, "Bob.md"), self.BOB)

    def test_cli_fix_runs_the_whole_migration(self):
        vault = self.vault()
        proc = run_cli(vault, "gm-leak", "--renest-excludes", "--fix")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("FIXED\t_meta/vault-config.md", proc.stdout)
        self.assertEqual(vc.effective_exclude_sections(vault), ["GM Notes"])


class RenestReviewRegressionTests(unittest.TestCase):
    """The second review's reproductions (N1-N4, I1): each must hide
    everything the publisher itself hid before the fix."""

    WS = ("---\ntype: npc\n---\n\n# Bob\n\nA sailor.\n\n"
          "## World State\n\nSECRET-WS\n\n## Keeper Checklist\n\n"
          "SECRET-KC\n")

    def vault(self, config, files):
        vault = make_vault(self, config)
        for rel, text in files.items():
            (vault / rel).parent.mkdir(parents=True, exist_ok=True)
            (vault / rel).write_text(text, encoding="utf-8")
        return vault

    def published(self, vault, rel):
        text = read(vault, rel)
        fm = vc.extract_frontmatter(text) or {}
        return "\n".join(vc.publisher_lines(
            text, vc.effective_exclude_sections(vault), fm))

    # ---- N1: exclude_sections parsed strictly, fail closed -----------

    def test_key_comment_block_list_is_read_and_migrated(self):
        config = ("---\npublish:\n  exclude_sections:   # hidden bits\n"
                  "    - GM Notes\n    - World State # c\n"
                  "    - 'Keeper Checklist'\n---\n")
        vault = self.vault(config, {"Bob.md": self.WS})
        self.assertEqual(vc.effective_exclude_sections(vault),
                         ["GM Notes", "World State", "Keeper Checklist"])
        rows = vc.check_gm_leak(vault, None, fix=True, renest_excludes=True)
        self.assertTrue(rows_for(rows, "FIXED\t_meta/vault-config.md"), rows)
        self.assertEqual(read(vault, "_meta/vault-config.md"),
                         '---\npublish:\n  exclude_sections: ["GM Notes"]\n'
                         "---\n")
        out = self.published(vault, "Bob.md")
        self.assertNotIn("SECRET", out)

    def test_quoted_key_is_replaced_not_duplicated(self):
        config = ('---\npublish:\n  "exclude_sections": [GM Notes, '
                  'World State, Keeper Checklist]\n  mode: player\n---\n')
        vault = self.vault(config, {"Bob.md": self.WS})
        vc.check_gm_leak(vault, None, fix=True, renest_excludes=True)
        after = read(vault, "_meta/vault-config.md")
        self.assertEqual(after.count("exclude_sections"), 1, after)
        self.assertNotIn("SECRET", self.published(vault, "Bob.md"))

    def test_a_quoted_item_keeps_its_comma(self):
        config = ('---\npublish:\n  exclude_sections: ["GM Notes", '
                  '"Keeper, Notes"] # c\n---\n')
        vault = self.vault(config, {})
        self.assertEqual(vc.effective_exclude_sections(vault),
                         ["GM Notes", "Keeper, Notes"])

    def test_forms_not_read_exactly_fail_closed(self):
        forms = {
            "multi-line flow": "publish:\n  exclude_sections: [\n"
                               "    GM Notes,\n    World State]\n",
            "flow publish": "publish: {exclude_sections: [GM Notes, "
                            "World State]}\n",
            "duplicate publish": "publish:\n  exclude_sections: [GM Notes]"
                                 "\npublish:\n  exclude_sections: [World "
                                 "State]\n",
            "anchor": "publish:\n  exclude_sections: &x [GM Notes]\n",
            "nested item": "publish:\n  exclude_sections:\n"
                           "    - [GM Notes]\n",
        }
        for name, body in forms.items():
            with self.subTest(form=name):
                config = f"---\n{body}---\n"
                vault = self.vault(config, {"Bob.md": self.WS})
                rows = vc.check_gm_leak(vault, None, fix=True,
                                        renest_excludes=True)
                self.assertTrue(rows_for(rows, "not understood"), rows)
                self.assertFalse(rows_for(rows, "FIXED"), rows)
                self.assertEqual(read(vault, "_meta/vault-config.md"), config)
                self.assertEqual(read(vault, "Bob.md"), self.WS)

    # ---- N2: code-fence headings end exclusions on the site ----------

    def test_a_code_fence_heading_ending_gm_notes_is_reported(self):
        text = ("---\ntype: npc\n---\n\n# C\n\n## GM Notes\n\nhidden\n\n"
                "```text\n## Roll table\n```\nSECRET-after-code\n")
        vault = self.vault(FIX_CONFIG, {"C.md": text})
        rows = vc.check_gm_leak(vault, None)
        self.assertTrue(rows_for(rows, "in a code fence ends the 'GM Notes'"),
                        rows)
        self.assertIn("SECRET-after-code", self.published(vault, "C.md"))

    def test_a_moved_block_with_a_code_fence_heading_is_refused(self):
        text = ("---\ntype: npc\n---\n\n# C\n\nPublic.\n\n"
                "## **Keeper Secrets**\n\n```\n## World State\n```\n"
                "SECRET\n")
        vault = self.vault(FIX_CONFIG, {"C.md": text})
        rows = vc.check_gm_leak(vault, None, fix=True)
        self.assertTrue(rows_for(rows, "heading-shaped line in a code fence"),
                        rows)
        self.assertEqual(read(vault, "C.md"), text)

    def test_a_collapse_exposed_by_a_code_fence_heading_is_refused(self):
        # Under the old list `### World State` re-starts an exclusion after
        # the code heading ends GM Notes; under ["GM Notes"] it would not.
        text = ("---\ntype: npc\n---\n\n# C\n\n## GM Notes\n\n```\n"
                "## Roll table\n```\n\n### World State\n\nSECRET-WS\n")
        config = ('---\npublish:\n  exclude_sections: [GM Notes, '
                  'World State]\n---\n')
        vault = self.vault(config, {"C.md": text})
        rows = vc.check_gm_leak(vault, None, fix=True, renest_excludes=True)
        self.assertTrue(rows_for(rows, "migration blocked"), rows)
        self.assertEqual(read(vault, "_meta/vault-config.md"), config)

    # ---- N3: every file the publisher might ship ---------------------

    def test_a_played_session_plan_and_inbox_file_are_migrated(self):
        plan = ("---\ntype: session-plan\nstatus: played\n---\n"
                "## Session Overview\n\nOverview.\n\n## World State\n\n"
                "SECRET-PLAN\n")
        inbox = ("---\ntype: npc\n---\n## Look\n\nx\n\n## World State"
                 "\n\nSECRET-INBOX\n")
        config = ('---\npublish:\n  exclude_sections: [GM Notes, '
                  'World State]\n---\n')
        vault = self.vault(config, {"Sessions/Plan.md": plan,
                                    "_inbox/N.md": inbox})
        rows = vc.check_gm_leak(vault, None, fix=True, renest_excludes=True)
        self.assertTrue(rows_for(rows, "FIXED\tSessions/Plan.md"), rows)
        self.assertTrue(rows_for(rows, "FIXED\t_inbox/N.md"), rows)
        self.assertNotIn("SECRET", self.published(vault, "Sessions/Plan.md"))
        self.assertNotIn("SECRET", self.published(vault, "_inbox/N.md"))

    # ---- I1: moved blocks land before any nested excluded heading ----

    def test_moved_blocks_are_not_swallowed_by_a_nested_exclusion(self):
        text = ("---\ntype: npc\n---\n\n# R\n\n## Look\n\nPublic.\n\n"
                "## GM Notes\n\nGeneral GM text.\n\n### World State\n\n"
                "SECRET-WS\n\n## **World State**\n\nSECRET-BOLD\n")
        config = ('---\npublish:\n  exclude_sections: [GM Notes, '
                  'World State]\n---\n')
        vault = self.vault(config, {"R.md": text})
        rows = vc.check_gm_leak(vault, None, fix=True)
        self.assertTrue(rows_for(rows, "FIXED\tR.md"), rows)
        after = read(vault, "R.md")
        self.assertIn("General GM text.\n\n### **World State**", after)
        self.assertNotIn("SECRET", self.published(vault, "R.md"))
        self.assertFalse(after.endswith("\n\n"), after)

    def test_scan_body_never_re_anchors_a_running_exclusion(self):
        states, _ = vc.scan_body(
            "## GM Notes\n### Player Notes\nx\n### Secrets\nHe lied.\n",
            ["GM Notes", "Player Notes"])
        self.assertFalse(any(s.published for s in states))

    def test_still_published_names_the_heading(self):
        self.assertEqual(
            vc._still_published("## Keeper\nx\n", "## Keeper\nx\n",
                                ["GM Notes"], {}, ["Keeper"]), "Keeper")

    def test_still_published_counts_same_named_headings(self):
        # One `## Context` moved, one `### Context` of the handout text
        # stays: nothing still publishes that moved (#281 review).
        old = "### Context\na\n## Context\nb\n"
        new = "### Context\na\n## GM Notes\n### Context\nb\n"
        self.assertIsNone(vc._still_published(old, new, ["GM Notes"], {},
                                              ["Context"]))

    # ---- minor: page-title advice -------------------------------------

    def test_an_h1_refusal_advises_renaming_the_page(self):
        h1 = "---\ntype: npc\n---\n\n# World State\n\nThe war is lost.\n"
        config = ('---\npublish:\n  exclude_sections: [GM Notes, '
                  'World State]\n---\n')
        vault = self.vault(config, {"H1.md": h1})
        rows = vc.check_gm_leak(vault, None, renest_excludes=True)
        self.assertTrue(rows_for(rows, "rename the page title"), rows)


class WrapupLeakInvariantTests(unittest.TestCase):
    """`wrapup --fix` runs through the same leak invariant."""

    def test_a_refused_rewrite_writes_nothing(self):
        vault = make_vault(self)
        rel = "W.md"
        text = ("---\ntype: session_wrap\n---\n\n## Narrative Recap\n\n"
                "It happened.\n\n## Keeper Checklist\n\n- task\n")
        (vault / rel).write_text(text, encoding="utf-8")
        original = vc.leak_problem
        self.addCleanup(setattr, vc, "leak_problem", original)
        vc.leak_problem = lambda *a, **k: "forced for the test"
        rows = vc.check_wrapup(vault, rel, True)
        self.assertTrue(rows_for(rows, "repair refused: forced"), rows)
        self.assertEqual(read(vault, rel), text)


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
        self.assertEqual(len(self.rows), 6, self.rows)

    def test_a_sheet_with_no_stat_sheet_warns(self):
        self.assertIn(
            f"WARNING\t{LATE}\tno published ## Stat Sheet section — the PC's "
            f"page has no character sheet; fill one in, or set sheet_source "
            f"to where the sheet is kept",
            self.rows)

    def _template_pc(self, name, frontmatter="", edit=None):
        """A PC whose body is a shipped template's, optionally edited."""
        template = (Path(vc.__file__).resolve().parent.parent / "templates"
                    / name).read_text(encoding="utf-8")
        body = template.split("---\n", 2)[2]
        if edit:
            body = edit(body)
        vault = make_vault(self)
        (vault / "Hero.md").write_text(
            f"---\ntype: pc\n{frontmatter}---\n{body}", encoding="utf-8")
        return vc.check_pc_body(vault)

    def test_an_untouched_template_stat_sheet_warns_for_every_system(self):
        templates = Path(vc.__file__).resolve().parent.parent / "templates"
        names = sorted(p.name for p in templates.glob("pc-*.md"))
        self.assertGreaterEqual(len(names), 7, names)
        for name in names:
            with self.subTest(template=name):
                rows = rows_for(self._template_pc(name), "placeholder values")
                self.assertEqual(len(rows), 1, rows)
                self.assertTrue(rows[0].startswith("WARNING\tHero.md:"), rows)

    def test_a_realigned_template_table_still_counts_as_untouched(self):
        rows = self._template_pc(
            "pc-dnd-5e-2024.md",
            edit=lambda b: b.replace("| Level | 1 |", "|Level|1   |")
                            .replace("|-----------|-------|", "|---|---|"))
        self.assertTrue(rows_for(rows, "placeholder values"), rows)

    def test_a_nearly_untouched_template_still_warns(self):
        one = self._template_pc(
            "pc-dnd-5e-2024.md",
            edit=lambda b: b.replace("| Level | 1 |", "| Level | 1 (starting) |"))
        self.assertTrue(rows_for(one, "is the template's but for 1 line;"), one)

    def test_two_changed_lines_are_a_character(self):
        # A GURPS PC at all 10s but DX, with the Basic Speed that follows.
        rows = self._template_pc(
            "pc-dnd-5e-2024.md",
            edit=lambda b: b.replace("| HP (Current) | |", "| HP (Current) | 9 |")
                            .replace("| HP (Max) | |", "| HP (Max) | 9 |"))
        self.assertFalse(rows_for(rows, "## Stat Sheet"), rows)

    def test_a_pc_from_an_older_template_still_warns(self):
        rows = self._template_pc(
            "pc-dnd-5e-2024.md",
            edit=lambda b: b.replace("| Heroic Inspiration | No |\n", ""))
        self.assertTrue(rows_for(rows, "placeholder values"), rows)

    def test_a_filled_in_stat_sheet_is_not_flagged(self):
        def fill(body):
            for old, new in (("| Level | 1 |", "| Level | 3 |"),
                             ("| STR | 10 | +0 | No |", "| STR | 16 | +3 | Yes |"),
                             ("| DEX | 10 | +0 | No |", "| DEX | 14 | +2 | No |"),
                             ("| AC | 10 |", "| AC | 15 |")):
                self.assertIn(old, body)
                body = body.replace(old, new)
            return body
        rows = self._template_pc("pc-dnd-5e-2024.md", edit=fill)
        self.assertFalse(rows_for(rows, "Stat Sheet"), rows)

    def test_a_pointer_or_tbd_where_the_stats_should_be_warns(self):
        for body in ("TBD", "See D&D Beyond: https://example.com/c/12345",
                     "[[Hero Sheet 2.pdf]]"):
            with self.subTest(body=body):
                rows = self._pc(f"---\ntype: pc\n---\n\n## Stat Sheet\n\n"
                                f"{body}\n")
                self.assertTrue(rows_for(rows, "## Stat Sheet holds no stats;"),
                                rows)

    def test_a_sheet_in_words_dots_or_an_image_is_a_sheet(self):
        for body in ("**High Concept:** Disgraced Knight\n\n**Trouble:** Owes "
                     "the Guild\n\nGreat Fight, Good Athletics, Fair Will",
                     "- Skirmish ●●○○\n- Command ●○○○",
                     "![[Bryn_sheet_p1.png]]"):
            with self.subTest(body=body):
                rows = self._pc(f"---\ntype: pc\n---\n\n## Stat Sheet\n\n"
                                f"{body}\n")
                self.assertFalse(rows_for(rows, "Stat Sheet"), rows)

    def test_a_longer_pointer_tbd_or_bare_skeleton_warns(self):
        for body in ("See D&D Beyond.\n\nLink in Discord.\n\nAsk Bob.",
                     "TBD\n\nTBD\n\nTBD",
                     "### Attributes\n\n### Skills\n\n### Equipment",
                     "See D&D Beyond (2024).",
                     "Sheet is on page 12 of the group PDF.",
                     "See Bryn_2.pdf in the drive"):
            with self.subTest(body=body):
                rows = self._pc(f"---\ntype: pc\n---\n\n## Stat Sheet\n\n"
                                f"{body}\n")
                self.assertTrue(rows_for(rows, "## Stat Sheet holds no stats;"),
                                rows)

    def test_digits_that_are_not_stats_do_not_make_a_sheet(self):
        for body in ("1. Open Roll20\n2. Find Bryn",
                     "[Sheet 2](https://example.com/z)",
                     "www.dndbeyond.com/characters/12345678",
                     "dndbeyond.com/characters/12345678",
                     "Bryn_2.gcs", "Bryn_2.odt in the drive",
                     "See pp. 3 of the PDF", "pg. 12", "pages 12 and 14"):
            with self.subTest(body=body):
                rows = self._pc(f"---\ntype: pc\n---\n\n## Stat Sheet\n\n"
                                f"{body}\n")
                self.assertTrue(rows_for(rows, "## Stat Sheet holds no stats;"),
                                rows)

    def test_a_lone_stat_that_looks_like_a_pointer_is_still_a_stat(self):
        # A warning the GM cannot clear by filling in the sheet is the
        # worse error, so each strip needs a mark a stat line lacks.
        for body in ("PP 5", "Psi P 12", "Pg 12", "Armor p 3",
                     "Speed 6.md", "Move 5.csv", "Hit Points 4.txt",
                     "Move 6.5/turn", "Ver 2.0/ x"):
            with self.subTest(body=body):
                rows = self._pc(f"---\ntype: pc\n---\n\n## Stat Sheet\n\n"
                                f"{body}\n")
                self.assertFalse(rows_for(rows, "Stat Sheet"), rows)

    def test_a_sheet_in_words_takes_several_shapes(self):
        for body in ("Fight: Great\nShoot: Good\nWill: Fair",
                     "Fight — Great\nShoot — Good\nWill — Fair",
                     "*Fight* Great\n*Shoot* Good\n*Will* Fair",
                     "__Fight__ Great\n__Shoot__ Good\n__Will__ Fair",
                     "- Fight, Great\n- Shoot, Good\n- Will, Fair",
                     "1. Fight, Great\n2. Shoot, Good\n3. Will, Fair",
                     "### Fight\n\nGreat\n\n### Shoot\n\nGood\n\n"
                     "### Will\n\nFair"):
            with self.subTest(body=body):
                rows = self._pc(f"---\ntype: pc\n---\n\n## Stat Sheet\n\n"
                                f"{body}\n")
                self.assertFalse(rows_for(rows, "Stat Sheet"), rows)

    def test_a_small_table_in_words_is_a_sheet(self):
        # The build takes any table as a sheet (Odd_Table in
        # build-sheetless-pc.test.js); the two must not disagree on it.
        rows = self._pc("---\ntype: pc\n---\n\n## Stat Sheet\n\n"
                        "| Thing | Amount |\n|---|---|\n| Grit | high |\n")
        self.assertFalse(rows_for(rows, "Stat Sheet"), rows)

    def test_a_free_form_stat_line_is_a_sheet(self):
        rows = self._pc("---\ntype: pc\n---\n\n## Stat Sheet\n\n"
                        "ST 12, DX 13, IQ 11, HT 12.\n")
        self.assertFalse(rows_for(rows, "Stat Sheet"), rows)

    def test_an_excluded_stat_sheet_is_no_stat_sheet(self):
        vault = make_vault(self, config="---\npublish:\n  exclude_sections: "
                                        "[\"Stat Sheet\"]\n---\n")
        (vault / "Hero.md").write_text(
            "---\ntype: pc\n---\n\n## Stat Sheet\n\nSTR 16.\n\n"
            "## Background\n\nA sailor.\n", encoding="utf-8")
        self.assertTrue(rows_for(vc.check_pc_body(vault),
                                 "no published ## Stat Sheet"))

    def test_a_stat_sheet_with_its_body_fenced_is_empty(self):
        rows = self._pc("---\ntype: pc\n---\n\n## Stat Sheet\n\n"
                        "<!-- gm-only -->\nSTR 16.\n<!-- /gm-only -->\n\n"
                        "## Background\n\nA sailor.\n")
        self.assertTrue(rows_for(rows, "## Stat Sheet is empty;"), rows)

    def test_sheet_source_settles_a_missing_or_untouched_sheet(self):
        rows = self._template_pc(
            "pc-dnd-5e-2024.md",
            frontmatter='sheet_source: "D&D Beyond"\n')
        self.assertFalse(rows_for(rows, "placeholder values"), rows)
        vault = make_vault(self)
        (vault / "Away.md").write_text(
            '---\ntype: pc\nsheet_source: "paper, with the player"\n---\n\n'
            "## Background\n\nA sailor.\n", encoding="utf-8")
        self.assertFalse(rows_for(vc.check_pc_body(vault), "Stat Sheet section"))

    def test_a_blank_sheet_source_settles_nothing(self):
        vault = make_vault(self)
        (vault / "Away.md").write_text(
            '---\ntype: pc\nsheet_source: ""\n---\n\n'
            "## Background\n\nA sailor.\n", encoding="utf-8")
        self.assertTrue(rows_for(vc.check_pc_body(vault), "Stat Sheet section"))

    def _pc(self, text):
        vault = make_vault(self)
        (vault / "Hero.md").write_text(text, encoding="utf-8")
        return vc.check_pc_body(vault)

    SHEETLESS = "## Background\n\nA sailor.\n"

    def _asked(self, value, **stub):
        """pc-body rows for a sheetless PC with `sheet_source: <value>`, on
        a vault whose publish tool is stubbed; and the tool calls made."""
        vault = make_vault(self)
        calls = stub_publish_tool(self, vault, **stub)
        (vault / "Hero.md").write_text(
            f"---\ntype: pc\nsheet_source: {value}\n---\n\n{self.SHEETLESS}",
            encoding="utf-8")
        return vc.check_pc_body(vault), calls

    def test_the_publish_tool_says_whether_sheet_source_is_set(self):
        # One reading of the field, the tool's: nothing here parses it.
        for value in ("null", "~", "false", "[]", "5", "{where: paper}"):
            with self.subTest(sheet_source=value):
                rows, calls = self._asked(value, sheet_source={"Hero.md": False})
                self.assertTrue(rows_for(rows, "Stat Sheet section"), rows)
                self.assertEqual(len(calls), 1, calls)
        rows, _calls = self._asked("[PDF, group drive]",
                                   sheet_source={"Hero.md": True})
        self.assertFalse(rows_for(rows, "Stat Sheet section"), rows)

    def test_a_blank_sheet_source_never_asks_the_tool(self):
        for value in ("", '""', "''", '"  "'):
            with self.subTest(sheet_source=value):
                rows, calls = self._asked(value, sheet_source={"Hero.md": True})
                self.assertTrue(rows_for(rows, "Stat Sheet section"), rows)
                self.assertEqual(calls, [])

    def test_a_pc_with_a_sheet_never_asks_the_tool(self):
        vault = make_vault(self)
        calls = stub_publish_tool(self, vault, sheet_source={"Hero.md": True})
        (vault / "Hero.md").write_text(
            '---\ntype: pc\nsheet_source: "D&D Beyond"\n---\n\n'
            "## Stat Sheet\n\nST 12, DX 13.\n", encoding="utf-8")
        self.assertFalse(rows_for(vc.check_pc_body(vault), "Stat Sheet"))
        self.assertEqual(calls, [])

    def test_a_list_under_sheet_source_is_asked_about(self):
        vault = make_vault(self)
        calls = stub_publish_tool(self, vault, sheet_source={"Hero.md": True})
        (vault / "Hero.md").write_text(
            "---\ntype: pc\nsheet_source:\n  - PDF\n  - group drive\n---\n\n"
            + self.SHEETLESS, encoding="utf-8")
        self.assertFalse(rows_for(vc.check_pc_body(vault), "Stat Sheet section"))
        self.assertEqual(len(calls), 1)

    def test_other_ways_of_writing_the_key_are_asked_about(self):
        for fm in ("sheet_source : paper", '"sheet_source": paper',
                   "'sheet_source': paper",
                   "sheet_source:\n# where\n  - PDF"):
            with self.subTest(frontmatter=fm):
                vault = make_vault(self)
                calls = stub_publish_tool(self, vault,
                                          sheet_source={"Hero.md": True})
                (vault / "Hero.md").write_text(
                    f"---\ntype: pc\n{fm}\n---\n\n{self.SHEETLESS}",
                    encoding="utf-8")
                rows = vc.check_pc_body(vault)
                self.assertFalse(rows_for(rows, "Stat Sheet section"), rows)
                self.assertEqual(len(calls), 1)

    def test_a_null_or_misshapen_answer_is_reported_not_trusted(self):
        for stdout in ("null", '{"pages": "abc"}'):
            with self.subTest(stdout=stdout):
                def run(cmd, stdout=stdout, **kw):
                    return subprocess.CompletedProcess(cmd, 0, stdout, "")
                rows, _calls = self._asked("paper", run=run)
                self.assertFalse(rows_for(rows, "Stat Sheet section"), rows)
                info = rows_for(rows, "could not be consulted")
                self.assertEqual(len(info), 1, rows)
                self.assertIn("expected JSON", info[0])

    def test_one_explain_answer_serves_gm_leak_and_pc_body(self):
        vault = make_vault(self)
        calls = stub_publish_tool(self, vault, sheet_source={"Hero.md": True})
        (vault / "Hero.md").write_text(
            f"---\ntype: pc\nsheet_source: paper\n---\n\n{self.SHEETLESS}",
            encoding="utf-8")
        explain = vc.ExplainAll(vault)
        vc.check_gm_leak(vault, None, explain=explain)
        vc.check_pc_body(vault, explain=explain)
        self.assertEqual(len(calls), 1, calls)

    def test_a_pc_the_tool_makes_no_page_for_is_not_warned_about(self):
        # sheetSourceSet is null for a file in an unmapped folder.
        rows, _calls = self._asked("paper", sheet_source={"Hero.md": None})
        self.assertFalse(rows_for(rows, "Stat Sheet section"), rows)

    def test_the_tool_is_asked_once_for_many_pcs(self):
        vault = make_vault(self)
        calls = stub_publish_tool(self, vault, sheet_source={
            "A.md": True, "B.md": False})
        for name in ("A", "B"):
            (vault / f"{name}.md").write_text(
                f"---\ntype: pc\nsheet_source: paper\n---\n\n{self.SHEETLESS}",
                encoding="utf-8")
        rows = rows_for(vc.check_pc_body(vault), "Stat Sheet section")
        self.assertEqual(len(rows), 1, rows)
        self.assertIn("B.md", rows[0])
        self.assertEqual(len(calls), 1)

    def test_a_tool_that_cannot_answer_takes_a_written_value_as_set(self):
        # No node, and a tool too old to report the field: say so, and do
        # not warn about a PC whose GM wrote something.
        for stub, why in (({"which": None}, "node is not on PATH"),
                          ({"stripped": {"Hero.md": []}}, "predates 1.11.44")):
            with self.subTest(why=why):
                rows, _calls = self._asked("paper", **stub)
                self.assertFalse(rows_for(rows, "Stat Sheet section"), rows)
                info = rows_for(rows, "could not be consulted")
                self.assertEqual(len(info), 1, rows)
                self.assertIn(why, info[0])
                self.assertIn("taken as set", info[0])

    def test_a_vault_that_does_not_publish_takes_a_written_value_as_set(self):
        rows = self._pc("---\ntype: pc\nsheet_source: paper\n---\n\n"
                        + self.SHEETLESS)
        self.assertFalse(rows_for(rows, "Stat Sheet section"), rows)
        self.assertFalse(rows_for(rows, "could not be consulted"), rows)

    def test_an_edition_number_is_not_a_stat(self):
        for body in ("See D&D Beyond (5e).", "On Roll20, D&D 5th edition."):
            with self.subTest(body=body):
                rows = self._pc(f"---\ntype: pc\n---\n\n## Stat Sheet\n\n"
                                f"{body}\n")
                self.assertTrue(rows_for(rows, "holds no stats"), rows)

    def test_a_fenced_stat_sheet_is_no_stat_sheet(self):
        rows = self._pc("---\ntype: pc\n---\n\n<!-- gm-only -->\n"
                        "## Stat Sheet\n\nSTR 10.\n<!-- /gm-only -->\n\n"
                        "## Background\n\nA sailor.\n")
        self.assertTrue(rows_for(rows, "no published ## Stat Sheet"), rows)

    def test_an_empty_stat_sheet_warns(self):
        rows = self._pc("---\ntype: pc\n---\n\n## Stat Sheet\n\n"
                        "## Background\n\nA sailor.\n")
        self.assertIn("WARNING\tHero.md:5\t## Stat Sheet is empty; fill it "
                      "in, or set sheet_source to where the sheet is kept",
                      rows)

    def test_a_bold_or_colon_stat_sheet_heading_counts(self):
        for heading in ("## **Stat Sheet**", "## Stat Sheet:", "## Stat sheet"):
            with self.subTest(heading=heading):
                rows = self._pc(f"---\ntype: pc\n---\n\n{heading}\n\n"
                                "STR 12.\n")
                self.assertFalse(rows_for(rows, "Stat Sheet section"), rows)
                self.assertFalse(rows_for(rows, "; fill it in"), rows)

    def test_a_stub_pc_is_not_judged_on_its_stat_sheet(self):
        vault = make_vault(self)
        (vault / "Stubbed.md").write_text(
            "---\ntype: pc\npublish: stub\n"
            'publish_include_sections: ["Background"]\n---\n\n'
            "## Background\n\nRaised by smugglers.\n", encoding="utf-8")
        self.assertFalse(rows_for(vc.check_pc_body(vault), "Stat Sheet"))

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

    def test_folder_restricts_the_walk(self):
        # `--folder` used to be accepted and ignored here, which reads as
        # a clean bill of health for a folder that was never scanned.
        rows = vc.check_pc_body(LEAK, "Characters/PCs")
        self.assertTrue(all("Characters/PCs/" in r for r in rows), rows)
        self.assertTrue(rows_for(rows, FENCED), rows)
        self.assertEqual(vc.check_pc_body(LEAK, "Characters/NPCs"), [])

    def test_folder_restricts_the_walk_through_the_cli(self):
        proc = run_cli(LEAK, "pc-body", "--folder", "Characters/NPCs")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("# count: 0", proc.stdout)

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


# Every canonical field present, so a test can isolate a body defect
# without the frontmatter backfills firing alongside it.
FULL_FM = """---
type: session_wrap
session: "[[Session 01 - Lone]]"
session_number: 1
chapter: "[[Chapter 1 - A]]"
campaign: "[[Campaign Overview]]"
play_date: null
in_game_date: null
source_document: "[[Session 01 - Lone - Play Notes]]"
canon_status: DRAFT
created_by: session-wrapup
reconciled: null
tags: []
---
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
        rows = vc.check_wrapup(vault, rel, True)
        self.assertTrue(rows_for(rows, "is a block list — map it to "
                                       "in_game_date and remove the block "
                                       "by hand"), rows)
        self.assertFalse(rows_for(rows, "removed in_game_dates"), rows)
        after = read(vault, rel)
        self.assertIn("in_game_dates:\n", after)
        self.assertIn('  - "5 March 1814"\n', after)
        self.assertIn('  - "6 March 1814"\n', after)

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

    def test_a_yaml_example_in_the_index_body_is_not_backfilled(self):
        # `get_key` matches `^key:` at column 0, so a fenced YAML example
        # in the index's own body used to be read as its frontmatter and
        # written into a wrap-up under `--fix`.
        vault = make_vault(self)
        (vault / "Session 01 - X.md").write_text(
            "---\ntype: session\nsession_number: 1\n---\n\n"
            "The frontmatter looks like this:\n\n```yaml\n"
            'chapter: "[[Not A Real Chapter]]"\n'
            'campaign: "[[Not A Real Campaign]]"\n```\n', encoding="utf-8")
        (vault / "Chapter_01_Session_01_Wrap_Up.md").write_text(
            "---\ntype: session_wrap\nsession_number: 1\n---\n\n"
            "## Narrative Recap\n\nIt happened.\n", encoding="utf-8")
        rows = vc.check_wrapup(vault, None, True)
        self.assertFalse(rows_for(rows, "Not A Real"), rows)
        self.assertNotIn("Not A Real",
                         read(vault, "Chapter_01_Session_01_Wrap_Up.md"))

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

    # ---- player-side fences survive the re-nest ----------------------

    def wrap_file(self, body, fm=FULL_FM,
                  rel="Chapter_01_Session_01_Wrap_Up.md"):
        """A wrap-up in a throwaway vault; returns (vault, rel)."""
        vault = make_vault(self)
        (vault / rel).write_text(fm + body, encoding="utf-8")
        return vault, rel

    def test_a_fenced_aside_inside_the_recap_survives_the_rename(self):
        # The re-nest used to strip every gm-only marker before
        # rebuilding one pair, which republished the aside — a leak
        # caused by the repair.
        vault, rel = self.wrap_file(
            "\n## Session Recap\n\nIt happened.\n\n<!-- gm-only -->\n\n"
            "The dagger was a fake.\n\n<!-- /gm-only -->\n\n"
            "More recap prose.\n")
        vc.check_wrapup(vault, rel, True)
        # Byte-for-byte: the heading is renamed and nothing else moves.
        self.assertEqual(
            read(vault, rel),
            FULL_FM + "## Narrative Recap\n\nIt happened.\n\n"
            "<!-- gm-only -->\n\nThe dagger was a fake.\n\n"
            "<!-- /gm-only -->\n\nMore recap prose.\n")

    def test_a_fenced_aside_in_the_preamble_survives(self):
        vault, rel = self.wrap_file(
            "\n<!-- gm-only -->\n\nKeeper preamble note.\n\n"
            "<!-- /gm-only -->\n\n# Title\n\n## Session Recap\n\n"
            "It happened.\n")
        vc.check_wrapup(vault, rel, True)
        self.assertEqual(
            read(vault, rel),
            FULL_FM + "\n<!-- gm-only -->\n\nKeeper preamble note.\n\n"
            "<!-- /gm-only -->\n\n# Title\n\n## Narrative Recap\n\n"
            "It happened.\n")

    def test_a_fence_crossing_a_section_boundary_stops_the_renest(self):
        vault, rel = self.wrap_file(
            "\n## Narrative Recap\n\nIt happened.\n\n<!-- gm-only -->\n\n"
            "Keeper aside inside the recap.\n\n## Keeper Checklist\n\n"
            "- [ ] a task\n\n<!-- /gm-only -->\n")
        before = read(vault, rel)
        rows = vc.check_wrapup(vault, rel, True)
        self.assertTrue(rows_for(
            rows, "gm-only fence crosses a player-facing section boundary — "
                  "re-nest by hand"), rows)
        self.assertTrue([r for r in rows if r.startswith("ERROR\t")], rows)
        self.assertEqual(read(vault, rel), before)

    def test_the_crossing_error_still_lets_frontmatter_fixes_through(self):
        vault, rel = self.wrap_file(
            "\n## Narrative Recap\n\nIt happened.\n\n<!-- gm-only -->\n\n"
            "Aside.\n\n## Keeper Checklist\n\n- [ ] a task\n\n"
            "<!-- /gm-only -->\n", fm="---\ntype: session-wrap-up\n---\n")
        rows = vc.check_wrapup(vault, rel, True)
        text = read(vault, rel)
        self.assertIn("type: session_wrap", text)
        self.assertIn("\n## Keeper Checklist\n", text)
        self.assertFalse(rows_for(rows, "re-nested"), rows)

    # ---- an unbalanced fence stops the body repair -------------------

    def test_an_unclosed_opener_over_player_blocks_leaves_the_body_alone(self):
        # The whole tail is player-facing, so the re-nest found no GM
        # region, built no fence, and dropped the opener — republishing
        # everything the site strips to EOF, under a fix row claiming a
        # fence it never wrote.
        vault, rel = self.wrap_file(
            "\nIntro line.\n\n<!-- gm-only -->\n\n## Narrative Recap\n\n"
            "The whole recap was Keeper-only.\n\n## Memorable Moments\n\n"
            "- A great line.\n")
        before = read(vault, rel)
        rows = vc.check_wrapup(vault, rel, True)
        self.assertEqual(read(vault, rel), before)
        self.assertFalse(rows_for(rows, "re-nested"), rows)
        self.assertTrue(rows_for(
            rows, "<!-- gm-only --> never closed — publish strips to end "
                  "of file"), rows)
        self.assertTrue(rows_for(
            rows, "gm-only fence is unbalanced — close it by hand before "
                  "--fix re-nests"), rows)

    def test_an_unclosed_opener_before_a_keeper_h2_leaves_the_body_alone(self):
        vault, rel = self.wrap_file(
            "\nIntro line.\n\n<!-- gm-only -->\n\n## Narrative Recap\n\n"
            "It happened.\n\n## Keeper Checklist\n\n- [ ] a task\n")
        before = read(vault, rel)
        rows = vc.check_wrapup(vault, rel, True)
        self.assertEqual(read(vault, rel), before)
        self.assertFalse(rows_for(rows, "re-nested"), rows)
        self.assertTrue(rows_for(
            rows, "gm-only fence is unbalanced"), rows)

    def test_an_orphan_closer_leaves_the_body_alone(self):
        vault, rel = self.wrap_file(
            "\n## Narrative Recap\n\nIt happened.\n\n<!-- /gm-only -->\n\n"
            "## Keeper Checklist\n\n- [ ] a task\n")
        before = read(vault, rel)
        rows = vc.check_wrapup(vault, rel, True)
        self.assertEqual(read(vault, rel), before)
        self.assertFalse(rows_for(rows, "re-nested"), rows)
        self.assertTrue(rows_for(
            rows, "gm-only fence is unbalanced"), rows)

    def test_an_unbalanced_fence_still_lets_frontmatter_fixes_through(self):
        vault, rel = self.wrap_file(
            "\nIntro line.\n\n<!-- gm-only -->\n\n## Narrative Recap\n\n"
            "It happened.\n", fm="---\ntype: session-wrap-up\n---\n")
        rows = vc.check_wrapup(vault, rel, True)
        text = read(vault, rel)
        self.assertIn("type: session_wrap", text)
        self.assertIn("<!-- gm-only -->\n\n## Narrative Recap", text)
        self.assertFalse(rows_for(rows, "re-nested"), rows)

    def test_an_unbalanced_spoiler_fence_names_itself(self):
        vault, rel = self.wrap_file(
            "\n## Narrative Recap\n\nIt happened.\n\n<!-- spoiler -->\n\n"
            "## Keeper Checklist\n\n- [ ] a task\n")
        rows = vc.check_wrapup(vault, rel, True)
        self.assertTrue(rows_for(rows, "spoiler fence is unbalanced"), rows)

    # ---- fix rows describe the bytes, not the findings ---------------

    def test_the_renest_row_counts_what_actually_moved(self):
        vault, rel = self.wrap_file(
            "\n## Session Recap\n\nIt happened.\n\n## Keeper Checklist\n\n"
            "- [ ] a task\n\n## World State\n\nVienna.\n")
        rows = vc.check_wrapup(vault, rel, True)
        self.assertTrue(rows_for(
            rows, "re-nested 2 Keeper-facing H2 sections under ## GM Notes "
                  "in one <!-- gm-only --> pair"), rows)
        self.assertTrue(rows_for(
            rows, "renamed heading 'Session Recap' to 'Narrative Recap'"),
            rows)
        text = read(vault, rel)
        self.assertIn("### Keeper Checklist", text)
        self.assertIn("### World State", text)

    def test_one_moved_section_is_reported_in_the_singular(self):
        vault, rel = self.wrap_file(
            "\n## Narrative Recap\n\nIt happened.\n\n## World State\n\n"
            "Vienna.\n")
        rows = vc.check_wrapup(vault, rel, True)
        self.assertTrue(rows_for(
            rows, "re-nested 1 Keeper-facing H2 section under ## GM Notes"),
            rows)

    def test_a_second_recap_variant_is_left_titled_as_it_was(self):
        vault, rel = self.wrap_file(
            "\n## Session Recap\n\nFirst.\n\n## What Happened\n\nSecond.\n")
        rows = vc.check_wrapup(vault, rel, True)
        self.assertTrue(rows_for(
            rows, "'## What Happened' is a second recap-variant heading "
                  "left as-is — merge by hand"), rows)
        text = read(vault, rel)
        self.assertEqual(text.count("## Narrative Recap"), 1)
        self.assertIn("\n## What Happened\n", text)

    # ---- structure-only repairs are reported and applied -------------

    def test_a_structure_only_defect_is_repaired_not_reported_unchanged(self):
        # Complete frontmatter, one unfenced ## GM Notes: the file used
        # to report UNCHANGED and return before the write.
        vault, rel = self.wrap_file(
            "\n## Narrative Recap\n\nIt happened.\n\n## GM Notes\n\n"
            "### World State\n\nVienna.\n")
        rows = vc.check_wrapup(vault, rel, True)
        self.assertFalse(rows_for(rows, "UNCHANGED"), rows)
        self.assertTrue(rows_for(
            rows, "re-nested: single <!-- gm-only --> fence around "
                  "## GM Notes"), rows)
        text = read(vault, rel)
        self.assertIn("<!-- gm-only -->\n\n## GM Notes", text)
        self.assertIn("<!-- /gm-only -->", text)

    def test_a_structure_only_repair_is_reported_beside_frontmatter_ones(self):
        vault, rel = self.wrap_file(
            "\n## Narrative Recap\n\nIt happened.\n\n## GM Notes\n\n"
            "### World State\n\nVienna.\n",
            fm="---\ntype: session_wrap\n---\n")
        rows = vc.check_wrapup(vault, rel, False)
        self.assertTrue(rows_for(rows, "WOULD-FIX"), rows)
        self.assertTrue(rows_for(rows, "re-nested: single"), rows)

    def test_unchanged_means_byte_identical(self):
        # The filename WARNING is a judgment call with no repair, so a
        # file carrying only that one is still byte-identical.
        vault, rel = self.wrap_file(
            "\n## Narrative Recap\n\nIt happened.\n",
            rel="Session 01 - Lone - Wrap-Up.md")
        before = read(vault, rel)
        rows = vc.check_wrapup(vault, rel, True)
        self.assertTrue(rows_for(rows, "Chapter_CC_Session_NN_Wrap_Up.md"),
                        rows)
        self.assertTrue(rows_for(rows, "UNCHANGED"), rows)
        self.assertEqual(read(vault, rel), before)

    # ---- more frontmatter edges --------------------------------------

    def test_reconciled_backfills_from_a_dated_callout(self):
        vault, rel = self.wrap_file(
            "\n## Narrative Recap\n\nIt happened.\n\n<!-- gm-only -->\n\n"
            "## GM Notes\n\n### Reconciliation Context\n\n"
            "> [!success] Reconciled against the play notes on 2026-05-02\n\n"
            "<!-- /gm-only -->\n",
            fm="---\ntype: session_wrap\ncanon_status: AUTHORITATIVE\n---\n")
        rows = vc.check_wrapup(vault, rel, True)
        self.assertTrue(rows_for(
            rows, 'reconciled: absent — backfill "2026-05-02" from the '
                  "Reconciliation Context"), rows)
        self.assertIn('reconciled: "2026-05-02"', read(vault, rel))

    def test_an_empty_legacy_value_is_reported_not_guessed(self):
        vault, rel = self.wrap_file(
            "\n## Narrative Recap\n\nIt happened.\n",
            fm="---\ntype: session_wrap\nin_game_dates:\n"
               "canon_status: DRAFT\n---\n")
        rows = vc.check_wrapup(vault, rel, True)
        self.assertTrue(rows_for(
            rows, "legacy in_game_dates has an empty value — set "
                  "in_game_date by hand"), rows)
        self.assertIn("in_game_dates:\n", read(vault, rel))

    def test_a_heading_inside_a_non_markdown_fence_is_not_reported(self):
        vault, rel = self.wrap_file(
            "\n## Narrative Recap\n\nIt happened.\n\n```python\n"
            "## Keeper Checklist\nprint(1)\n```\n")
        self.assertFalse(rows_for(vc.check_wrapup(vault, rel, False),
                                  "is inside a code fence"))

    def test_a_second_fence_does_not_inherit_the_first_ones_language(self):
        # `scan_body` marks a closing delimiter as fenced too, so two
        # fences written back to back look like one run of code lines.
        vault, rel = self.wrap_file(
            "\n## Narrative Recap\n\nIt happened.\n\n```python\n"
            "print(1)\n```\n```markdown\n## Keeper Checklist\n```\n")
        self.assertTrue(rows_for(
            vc.check_wrapup(vault, rel, False),
            "Keeper-facing H2 '## Keeper Checklist' is inside a code fence "
            "— quoted, not re-nested"))

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


class GmLeakSiteExcludeSectionsTests(unittest.TestCase):
    """#240: the site's vault.config.json `excludeSections` joins the list,
    exactly as config.js `unionExcludeList` does."""

    def vault(self, vault_list=None, site_list=None, site_json=None):
        site = Path(tempfile.mkdtemp(prefix="vc-site-"))
        self.addCleanup(shutil.rmtree, site, ignore_errors=True)
        if site_json is not None:
            (site / "vault.config.json").write_text(site_json, encoding="utf-8")
        elif site_list is not None:
            (site / "vault.config.json").write_text(
                json.dumps({"excludeSections": site_list}), encoding="utf-8")
        lines = ["---", "type: meta", "publish:", f'  site_dir: "{site}"']
        if vault_list is not None:
            lines.append(f"  exclude_sections: {json.dumps(vault_list)}")
        return make_vault(self, "\n".join(lines + ["---", ""]))

    def test_a_shorter_site_list_replaces_the_defaults(self):
        # the leak #240 describes: no vault list, so the site uses ONLY its
        # JSON list, and Player Notes publishes
        vault = self.vault(site_list=["GM Notes"])
        self.assertEqual(vc.effective_exclude_sections(vault), ["GM Notes"])

    def test_both_lists_are_unioned(self):
        vault = self.vault(vault_list=["GM Notes"], site_list=["gm notes", "Secrets"])
        self.assertEqual(vc.effective_exclude_sections(vault), ["GM Notes", "Secrets"])

    def test_no_site_list_keeps_todays_answer(self):
        self.assertEqual(vc.effective_exclude_sections(self.vault()),
                         list(__import__("vaultlib").DEFAULT_EXCLUDE_SECTIONS))
        self.assertEqual(vc.effective_exclude_sections(self.vault(vault_list=["GM Notes"])),
                         ["GM Notes"])

    def test_unreadable_site_json_fails_closed(self):
        vault = self.vault(site_json="{not json")
        self.assertEqual(vc.effective_exclude_sections(vault), [])


class GmLeakCollapsedWorldStateTests(unittest.TestCase):
    """#239: a vault collapsed to ["GM Notes"] by the pre-fix migration,
    with `## World State` left at the top level, publishing."""

    CONFIG = ('---\ntype: meta\npublish:\n  exclude_sections: ["GM Notes"]\n---\n')
    BOB = ("---\ntype: npc\n---\n\n# Bob\n\nA sailor.\n\n"
           "## World State\n\nThe harbour burns in week 3.\n")

    def test_a_published_gm_template_heading_warns_with_the_fix(self):
        vault = make_vault(self, self.CONFIG)
        (vault / "Bob.md").write_text(self.BOB, encoding="utf-8")
        rows = rows_for(vc.check_gm_leak(vault, None), "Bob.md")
        warn = [r for r in rows if "'World State'" in r]
        self.assertEqual(len(warn), 1, rows)
        self.assertTrue(warn[0].startswith("WARNING\tBob.md:9\t"), warn)
        self.assertIn("--renest-excludes", warn[0])

    def test_the_named_fix_hides_it(self):
        vault = make_vault(self, self.CONFIG.replace('["GM Notes"]', '["GM Notes", "World State"]'))
        (vault / "Bob.md").write_text(self.BOB, encoding="utf-8")
        vc.check_gm_leak(vault, None, fix=True, renest_excludes=True)
        self.assertIn("The harbour burns in week 3.",
                      vc.hidden_lines(read(vault, "Bob.md"), ["GM Notes"], {"type": "npc"}))
        self.assertFalse(rows_for(vc.check_gm_leak(vault, None), "'World State'"))

    def test_under_gm_notes_it_is_quiet(self):
        vault = make_vault(self, self.CONFIG)
        (vault / "Bob.md").write_text(self.BOB.replace("## World State", "## GM Notes\n\n### World State"),
                                      encoding="utf-8")
        self.assertFalse(rows_for(vc.check_gm_leak(vault, None), "'World State'"))


class GmLeakWithheldHubTests(unittest.TestCase):
    """#276: gm-leak skips a session hub body the site withholds — as the
    publish tool itself reports it (`explain --all --json`), stubbed here."""
    HUB = SessionsCommandTests.HUB
    WRAP = SessionsCommandTests.WRAP
    BODY = "## Scene Index\n\n**Keeper only:** the vicar is the cultist.\n"

    def vault(self):
        vault = make_vault(self)
        (vault / "Session 01 - Lone.md").write_text(self.HUB + self.BODY,
                                                    encoding="utf-8")
        (vault / "Chapter_01_Session_01_Wrap_Up.md").write_text(
            self.WRAP, encoding="utf-8")
        return vault

    def hub_rows(self, rows):
        return [r for r in rows if "Session 01 - Lone.md" in r]

    def test_withheld_hub_body_is_skipped(self):
        vault = self.vault()
        calls = stub_publish_tool(self, vault, ["Session 01 - Lone.md"])
        rows = vc.check_gm_leak(vault, None)
        self.assertEqual(self.hub_rows(rows), [])
        self.assertFalse(rows_for(rows, "could not be consulted"), rows)
        self.assertEqual(len(calls), 1)
        cmd = calls[0]
        self.assertEqual(cmd[2:5], ["explain", "--all", "--json"])
        self.assertEqual(cmd[cmd.index("--vault") + 1], str(vault.resolve()))
        self.assertTrue(cmd[cmd.index("--config") + 1].endswith(
            "vault.config.json"))

    def test_hub_body_the_tool_does_not_withhold_is_scanned(self):
        vault = self.vault()
        stub_publish_tool(self, vault, [])
        self.assertTrue(self.hub_rows(vc.check_gm_leak(vault, None)))

    def test_no_node_scans_every_hub_and_says_so(self):
        vault = self.vault()
        stub_publish_tool(self, vault, ["Session 01 - Lone.md"], which=None)
        rows = vc.check_gm_leak(vault, None)
        self.assertTrue(self.hub_rows(rows))
        note = rows_for(rows, "publish tool could not be consulted")
        self.assertEqual(len(note), 1, rows)
        self.assertIn("every session index body was scanned", note[0])

    def test_tool_failures_scan_every_hub(self):
        def failing(result):
            def run(cmd, **kwargs):
                if isinstance(result, Exception):
                    raise result
                return subprocess.CompletedProcess(cmd, *result)
            return run
        cases = {
            "timed out": subprocess.TimeoutExpired("node", 120),
            "exited 1: boom": (1, "", "trace\nboom\n"),
            "expected JSON": (0, "not json", ""),
            "could not run": OSError("exec format error"),
        }
        for reason, result in cases.items():
            with self.subTest(reason=reason):
                vault = self.vault()
                stub_publish_tool(self, vault, run=failing(result))
                rows = vc.check_gm_leak(vault, None)
                self.assertTrue(self.hub_rows(rows))
                self.assertIn(reason, "".join(
                    rows_for(rows, "could not be consulted")))
                mock.patch.stopall()

    def test_the_sites_installed_tool_answers(self):
        vault = self.vault()
        calls = stub_publish_tool(self, vault, ["Session 01 - Lone.md"],
                                  installed="1.11.40")
        rows = vc.check_gm_leak(vault, None)
        self.assertEqual(self.hub_rows(rows), [])
        self.assertIn("node_modules", calls[0][1])
        self.assertFalse(rows_for(rows, "asked the plugin"), rows)

    def test_a_site_pinned_below_withholding_scans_every_hub(self):
        # Its renderer publishes every hub body in full, whatever the
        # plugin's tool would say.
        vault = self.vault()
        calls = stub_publish_tool(self, vault, ["Session 01 - Lone.md"],
                                  installed="1.11.39")
        rows = vc.check_gm_leak(vault, None)
        self.assertEqual(calls, [])
        self.assertTrue(self.hub_rows(rows))
        note = rows_for(rows, "could not be consulted")
        self.assertEqual(len(note), 1, rows)
        self.assertIn("site pinned to 1.11.39 predates body withholding",
                      note[0])

    def test_a_pin_not_yet_installed_is_still_the_sites_tool(self):
        # Re-check: package.json pins a vendored 1.11.39 and nothing is
        # installed. The next npm install brings in 1.11.39, which publishes
        # every hub body, so the plugin's tool must not answer for it.
        vault = self.vault()
        calls = stub_publish_tool(self, vault, ["Session 01 - Lone.md"])
        site = Path(vc.read_publish_scalar(vault, "site_dir"))
        (site / "package.json").write_text(json.dumps({"dependencies": {
            "gm-apprentice-publish":
                "file:vendor/gm-apprentice-publish-1.11.39.tgz"}}),
            encoding="utf-8")
        rows = vc.check_gm_leak(vault, None)
        self.assertEqual(calls, [])
        self.assertTrue(self.hub_rows(rows))
        self.assertTrue(rows_for(rows, "site pinned to 1.11.39 predates "
                                       "body withholding"), rows)

    def test_an_installed_prerelease_is_below_the_release(self):
        vault = self.vault()
        calls = stub_publish_tool(self, vault, ["Session 01 - Lone.md"],
                                  installed="1.11.40-rc.1")
        rows = vc.check_gm_leak(vault, None)
        self.assertEqual(calls, [])
        self.assertTrue(self.hub_rows(rows))

    def test_an_unreadable_site_tool_scans_every_hub(self):
        vault = self.vault()
        stub_publish_tool(self, vault, ["Session 01 - Lone.md"],
                          installed="not-a-version")
        rows = vc.check_gm_leak(vault, None)
        self.assertTrue(self.hub_rows(rows))
        self.assertTrue(rows_for(rows, "no readable version"), rows)

    def test_the_plugins_tool_stands_in_only_without_a_site_tool_and_says_so(self):
        vault = self.vault()
        calls = stub_publish_tool(self, vault, ["Session 01 - Lone.md"])
        rows = vc.check_gm_leak(vault, None)
        self.assertEqual(calls[0][1], str(vc.PUBLISH_TOOL))
        self.assertEqual(rows_for(rows, "asked the plugin's publish tool "
                                        "(the site has none installed)"),
                         ["INFO\t(vault)\tasked the plugin's publish tool "
                          "(the site has none installed)"])

    def test_missing_site_config_scans_every_hub(self):
        vault = self.vault()
        stub_publish_tool(self, vault, ["Session 01 - Lone.md"])
        (vault / "_meta" / "vault-config.md").write_text(
            "---\npublish:\n  site_dir: /no/such/site\n---\n",
            encoding="utf-8")
        rows = vc.check_gm_leak(vault, None)
        self.assertTrue(self.hub_rows(rows))
        self.assertTrue(rows_for(rows, "no vault.config.json"), rows)

    def test_vault_that_never_publishes_does_not_ask(self):
        # No publish: block, so no site: nothing is withheld, nothing to say.
        vault = self.vault()
        with mock.patch.object(vc.subprocess, "run") as run:
            rows = vc.check_gm_leak(vault, None)
        run.assert_not_called()
        self.assertTrue(self.hub_rows(rows))
        self.assertFalse(rows_for(rows, "could not be consulted"), rows)

    def test_one_explain_run_serves_hubs_and_sections(self):
        # Hubs and a handout's stripped sections both come from the one
        # `explain --all` (#280): a vault without session indexes asks too.
        vault = self.vault()
        calls = stub_publish_tool(self, vault, ["Session 01 - Lone.md"],
                                  stripped={})
        vc.check_gm_leak(vault, None)
        self.assertEqual(len(calls), 1)
        bare = make_vault(self)
        calls = stub_publish_tool(self, bare, [], stripped={})
        vc.check_gm_leak(bare, None)
        self.assertEqual(len(calls), 1)


class GmLeakHandoutSectionTests(unittest.TestCase):
    """#280: a handout's Keeper sections outside GM Notes. The publish tool
    says which headings it withholds (`strippedSections`); gm-leak names
    the ones sitting outside ## GM Notes and --fix nests them there."""
    CHIT = ("---\ntype: document\n---\n\n# The Chit\n\n## Content\n\n"
            "> The chit.\n\n## Context\n\nThe man they came to stop.\n\n"
            "## Clues, if Katherine walks\n\nThe route.\n\n"
            "## Prop Notes\n\nKeeper-only until delivered.\n")
    STRIPPED = ["Context", "Clues, if Katherine walks", "Prop Notes"]

    def vault(self):
        vault = make_vault(self)
        (vault / "Chit.md").write_text(self.CHIT, encoding="utf-8")
        return vault

    def test_names_each_section_and_plans_the_move(self):
        vault = self.vault()
        stub_publish_tool(self, vault, stripped={"Chit.md": self.STRIPPED})
        rows = vc.check_gm_leak(vault, None)
        warned = [r for r in rows_for(rows, "Chit.md:")
                  if r.startswith("WARNING")]
        self.assertEqual(len(warned), 3, rows)
        self.assertIn("'Context' is Keeper material outside ## GM Notes",
                      warned[0])
        self.assertEqual(len(rows_for(rows, "WOULD-FIX\tChit.md")), 3, rows)
        self.assertEqual(read(vault, "Chit.md"), self.CHIT)

    def test_fix_nests_them_under_gm_notes(self):
        vault = self.vault()
        stub_publish_tool(self, vault, stripped={"Chit.md": self.STRIPPED})
        rows = vc.check_gm_leak(vault, None, fix=True)
        self.assertEqual(len(rows_for(rows, "FIXED\tChit.md")), 3, rows)
        text = read(vault, "Chit.md")
        self.assertIn("## GM Notes\n\n### Context\n", text)
        self.assertIn("### Prop Notes", text)
        self.assertIn("## Content\n\n> The chit.", text)
        self.assertFalse([r for r in rows_for(vc.check_gm_leak(vault, None),
                                              "Chit.md") if "WARNING" in r])

    def test_sections_on_the_exclude_list_are_not_reported_twice(self):
        vault = self.vault()
        stub_publish_tool(self, vault, stripped={"Chit.md": ["GM Notes"]})
        rows = vc.check_gm_leak(vault, None)
        self.assertFalse(rows_for(rows, "Keeper material outside"), rows)

    def test_an_older_tool_is_a_warning_to_repin(self):
        vault = self.vault()
        old_answer = json.dumps({"vaultPath": str(vault), "pages": [
            {"path": "Chit.md", "bodyWithheld": False}]})
        stub_publish_tool(self, vault, run=lambda cmd, **kw:
                          subprocess.CompletedProcess(cmd, 0, old_answer, ""))
        rows = vc.check_gm_leak(vault, None)
        self.assertTrue(rows_for(rows, "WARNING\t(vault)\tthe site's publish "
                                       "tool predates 1.11.41"), rows)

    def test_a_pin_below_the_rule_warns_even_when_the_plugin_answers(self):
        # Review: the site pins 1.11.40 but hasn't installed it, so the
        # plugin's 1.11.41 answers — yet the site will build with 1.11.40.
        vault = self.vault()
        stub_publish_tool(self, vault, stripped={"Chit.md": self.STRIPPED})
        site = Path(vc.read_publish_scalar(vault, "site_dir"))
        (site / "package.json").write_text(json.dumps({"dependencies": {
            "gm-apprentice-publish": "1.11.40"}}), encoding="utf-8")
        rows = vc.check_gm_leak(vault, None)
        self.assertTrue(rows_for(rows, "WARNING\t(vault)\tthe site's publish "
                                       "tool 1.11.40 predates 1.11.41"), rows)

    def test_a_site_too_old_to_ask_is_a_warning_not_a_note(self):
        vault = self.vault()
        calls = stub_publish_tool(self, vault, installed="1.11.39")
        rows = vc.check_gm_leak(vault, None)
        self.assertEqual(calls, [])
        self.assertTrue(rows_for(rows, "WARNING\t(vault)\tthe site's publish "
                                       "tool 1.11.39 predates 1.11.41"), rows)

    def test_an_emphasis_wrapped_heading_is_named_and_moved(self):
        vault = make_vault(self)
        (vault / "Chit.md").write_text(self.CHIT.replace(
            "## Context", "## **Context**"), encoding="utf-8")
        stub_publish_tool(self, vault, stripped={
            "Chit.md": ["**Context**", "Clues, if Katherine walks",
                        "Prop Notes"]})
        rows = vc.check_gm_leak(vault, None, fix=True)
        self.assertEqual(len(rows_for(rows, "FIXED\tChit.md")), 3, rows)
        self.assertIn("### **Context**", read(vault, "Chit.md"))

    def test_only_level_two_sections_are_named(self):
        vault = make_vault(self)
        (vault / "Chit.md").write_text(
            "---\ntype: document\n---\n\n## The Text\n\nDear sir.\n\n"
            "### Context\n\nPart of the letter.\n", encoding="utf-8")
        stub_publish_tool(self, vault, stripped={"Chit.md": ["Context"]})
        self.assertFalse(rows_for(vc.check_gm_leak(vault, None),
                                  "Keeper material"))

    def test_fix_moves_the_h2_and_leaves_an_h3_of_the_same_name(self):
        # CodeRabbit: the tool withholds `## Context` only; a `### Context`
        # inside the handout text is the handout's own and stays put.
        vault = make_vault(self)
        (vault / "Chit.md").write_text(
            "---\ntype: document\n---\n\n## The Text\n\nDear sir.\n\n"
            "### Context\n\nPart of the letter.\n\n## Context\n\n"
            "Keeper analysis.\n", encoding="utf-8")
        stub_publish_tool(self, vault, stripped={"Chit.md": ["Context"]})
        rows = vc.check_gm_leak(vault, None, fix=True)
        self.assertEqual(len(rows_for(rows, "FIXED\tChit.md")), 1, rows)
        text = read(vault, "Chit.md")
        self.assertIn("## The Text\n\nDear sir.\n\n### Context\n\n"
                      "Part of the letter.", text)
        self.assertIn("## GM Notes\n\n### Context\n\nKeeper analysis.", text)

    def test_a_closing_sequence_is_part_of_no_title(self):
        vault = make_vault(self)
        (vault / "Chit.md").write_text(self.CHIT.replace(
            "## Context\n", "## Context ##\n"), encoding="utf-8")
        stub_publish_tool(self, vault, stripped={"Chit.md": self.STRIPPED})
        rows = vc.check_gm_leak(vault, None, fix=True)
        self.assertEqual(len(rows_for(rows, "FIXED\tChit.md")), 3, rows)
        self.assertIn("### Context ##", read(vault, "Chit.md"))

    def test_no_tool_says_what_went_unchecked(self):
        vault = self.vault()
        stub_publish_tool(self, vault, which=None)
        note = rows_for(vc.check_gm_leak(vault, None), "could not be consulted")
        self.assertEqual(len(note), 1)
        self.assertIn("a handout's Context, Clues and Prop Notes", note[0])


# CI sets VAULT_CHECK_REQUIRE_NODE so a runner without node fails here
# instead of skipping the only proof that vault_check and the site agree.
@unittest.skipUnless(os.environ.get("VAULT_CHECK_REQUIRE_NODE")
                     or (shutil.which("node") and (
                         vc.PUBLISH_TOOL.parent.parent / "node_modules").is_dir()),
                     "node and the publish tool's node_modules are needed")
class PublishToolEndToEndTests(unittest.TestCase):
    """vault_check asks the real publish tool (#276 review): the withheld
    decision is the site's, including cases a re-implementation got wrong."""

    BARON = "**Keeper-only:** the Baron appears in scene 3.\n"

    def site_vault(self, hub_fm, wrap_fm, wrap_name="Session 01 Wrap-Up.md"):
        vault = make_vault(self)
        site = Path(tempfile.mkdtemp(prefix="vc-e2e-site-"))
        self.addCleanup(shutil.rmtree, site, ignore_errors=True)
        (site / "vault.config.json").write_text(json.dumps({
            "siteTitle": "T", "vaultPath": str(vault), "outputDir": "./docs",
            "excludeDirs": ["_meta"],
            "folderMap": {"Sessions": "sessions"}}), encoding="utf-8")
        (vault / "_meta" / "vault-config.md").write_text(
            f"---\npublish:\n  mode: player\n  site_dir: {site}\n---\n",
            encoding="utf-8")
        (vault / "Sessions").mkdir()
        (vault / "Sessions" / "Session 01 - Arrival.md").write_text(
            f"---\ntype: session\nsession_number: 1\nstatus: played\n"
            f"{hub_fm}---\n\n# Session 01 - Arrival\n\n{self.BARON}",
            encoding="utf-8")
        (vault / "Sessions" / wrap_name).write_text(
            f"---\ntype: session_wrap\n{wrap_fm}---\n\n## Narrative Recap"
            f"\n\nThey arrived.\n", encoding="utf-8")
        return vault

    def baron_rows(self, vault):
        rows = vc.check_gm_leak(vault, None)
        self.assertFalse(rows_for(rows, "could not be consulted"), rows)
        return rows_for(rows, "Session 01 - Arrival.md")

    def test_explicitly_linked_published_wrap_up_withholds_the_body(self):
        vault = self.site_vault(
            'documents:\n  wrap_up: "[[Session 01 Wrap-Up]]"\n', "")
        self.assertEqual(self.baron_rows(vault), [])

    def test_broken_link_and_number_match_leave_the_body_published(self):
        # The reviewer's case: Python treated this hub as withheld and
        # reported nothing, while the site published the Baron line.
        vault = self.site_vault(
            'documents:\n  wrap_up: "[[No Such Wrap-Up]]"\n',
            "session_number: 1\n")
        self.assertTrue(self.baron_rows(vault))

    def test_unpublished_wrap_up_does_not_withhold(self):
        vault = self.site_vault(
            'documents:\n  wrap_up: "[[Session 01 Wrap-Up]]"\n',
            "publish: none\n")
        self.assertTrue(self.baron_rows(vault))

    def test_sessions_row_follows_the_same_answer(self):
        vault = self.site_vault(
            'documents:\n  wrap_up: "[[Session 01 Wrap-Up]]"\n', "")
        self.assertTrue(rows_for(vc.check_sessions(vault),
                                 "session index body"))
        broken = self.site_vault(
            'documents:\n  wrap_up: "[[No Such Wrap-Up]]"\n',
            "session_number: 1\n")
        self.assertFalse(rows_for(vc.check_sessions(broken),
                                  "session index body"))


    def test_notes_the_build_cannot_parse_come_from_the_tool(self):
        # #287, against the real tool: a duplicated key and an unquoted
        # colon both pass the line reader and both lose their page. Two
        # notes with identical text must both be named.
        vault = self.site_vault("", "session_number: 1\n")
        dup = "---\ntype: session\nstatus: played\nstatus: prepped\n---\n"
        for name, text in (("Dup.md", dup), ("Dup Twin.md", dup),
                           ("Colon.md", "---\ntype: session\ntitle: a: b\n---\n")):
            (vault / "Sessions" / name).write_text(text, encoding="utf-8")
        rows = vc.check_frontmatter(vault, None)
        self.assertFalse(rows_for(rows, "could not be consulted"), rows)
        warned = rows_for(rows, "cannot parse this frontmatter")
        self.assertEqual(sorted(r.split("\t")[1] for r in warned),
                         ["Sessions/Colon.md", "Sessions/Dup Twin.md",
                          "Sessions/Dup.md"], rows)
        self.assertTrue(all(r.startswith("ERROR\t") for r in warned))
        self.assertIn("duplicated mapping key",
                      rows_for(warned, "Sessions/Dup.md")[0])
        self.assertTrue(all("\n" not in r for r in warned))

    def test_a_broken_vault_config_is_named_in_one_readable_line(self):
        # The tool's error ended in js-yaml's caret line, and the row's
        # reason was "exited 1: ^".
        vault = self.site_vault("", "session_number: 1\n")
        config = vault / "_meta" / "vault-config.md"
        config.write_text(config.read_text(encoding="utf-8").replace(
            "  mode: player\n", "  mode: player\n  mode: gm\n"),
            encoding="utf-8")
        info = rows_for(vc.check_frontmatter(vault, None),
                        "could not be consulted")
        self.assertEqual(len(info), 1, info)
        self.assertIn("_meta/vault-config.md frontmatter is not valid YAML: "
                      "duplicated mapping key", info[0])

    def test_a_handouts_keeper_sections_come_from_the_tool(self):
        # #280, against the real tool: it withholds the handout's Context
        # and Prop Notes, so gm-leak names both and --fix nests them.
        vault = self.site_vault("", "")
        folder = vault / "Sessions"
        (folder / "Chit.md").write_text(
            "---\ntype: document\n---\n\n## Content\n\nThe chit.\n\n"
            "## Context\n\nThe man they came to stop.\n\n"
            "## Prop Notes\n\nTea-stained.\n", encoding="utf-8")
        rows = vc.check_gm_leak(vault, None)
        self.assertFalse(rows_for(rows, "could not be consulted"), rows)
        self.assertEqual(len(rows_for(rows, "Keeper material outside")), 2,
                         rows)
        vc.check_gm_leak(vault, None, fix=True)
        self.assertFalse(rows_for(vc.check_gm_leak(vault, None),
                                  "Keeper material outside"))

    def test_manifest_rows_follow_publish_played(self):
        # The real `manifest publish-played --dry-run --json --vault`: a
        # reviewed session with its linked Wrap-Up will be registered; one
        # whose Wrap-Up is a DRAFT and whose index isn't reviewed is asked.
        for status, canon, expect in (
                ("reviewed", "AUTHORITATIVE", "publish-played will register it"),
                ("wrap-up", "DRAFT", "publish-site will ask the GM (Wrap-Up "
                 "not reviewed yet")):
            with self.subTest(status=status):
                vault = self.site_vault(
                    'documents:\n  wrap_up: "[[Session 01 Wrap-Up]]"\n',
                    f"canon_status: {canon}\n")
                hub = vault / "Sessions" / "Session 01 - Arrival.md"
                hub.write_text(hub.read_text(encoding="utf-8").replace(
                    "status: played", f"status: {status}"), encoding="utf-8")
                (vault / "_meta" / "publish-manifest.md").write_text(
                    "## Publishing (0 files)\n\n## Needs Decision (1 files)"
                    "\n\n- [ ] Sessions/Session 01 - Arrival.md\n",
                    encoding="utf-8")
                rows = vc.check_sessions(vault)
                self.assertFalse(rows_for(rows, "could not be consulted"), rows)
                row = rows_for(rows, "Session 01 - Arrival.md\tplayed session")
                self.assertEqual(len(row), 1, rows)
                self.assertIn(expect, row[0])


class GmLeakReviewFollowupTests(unittest.TestCase):
    """Review of #239/#240: the advice mustn't un-hide the defaults, and the
    site_dir reader reads only publish's own key."""

    def test_advice_pastes_the_whole_effective_list(self):
        # a vault with no list relies on the defaults; adding only World State
        # would replace them, and the collapse would then un-hide the rest
        vault = make_vault(self, "---\ntype: meta\n---\n")
        (vault / "Bob.md").write_text("---\ntype: npc\n---\n\n# Bob\n\n## World State\n\nx\n",
                                      encoding="utf-8")
        row = next(r for r in vc.check_gm_leak(vault, None) if "'World State'" in r)
        self.assertIn('"World State"', row)
        self.assertIn('"Handoff to Reconcile"', row)
        self.assertIn('"GM Notes"', row)

    def test_following_the_pasted_list_hides_every_default_section(self):
        vault = make_vault(self, "---\ntype: meta\n---\n")
        bob = ("---\ntype: npc\n---\n\n# Bob\n\n## World State\n\nburns\n\n"
               "## Handoff to Reconcile\n\nsecret handoff\n")
        (vault / "Bob.md").write_text(bob, encoding="utf-8")
        row = next(r for r in vc.check_gm_leak(vault, None) if "'World State'" in r)
        pasted = row[row.index("["):row.index("]") + 1]
        (vault / "_meta" / "vault-config.md").write_text(
            f"---\ntype: meta\npublish:\n  exclude_sections: {pasted}\n---\n", encoding="utf-8")
        vc.check_gm_leak(vault, None, fix=True, renest_excludes=True)
        hidden = vc.hidden_lines(read(vault, "Bob.md"), ["GM Notes"], {"type": "npc"})
        self.assertIn("burns", hidden)
        self.assertIn("secret handoff", hidden)

    def test_site_dir_is_read_only_as_publishs_direct_child(self):
        import vaultlib
        vault = make_vault(self, (
            "---\ntype: meta\npublish:\n  deploy:\n    site_dir: /wrong\n"
            "# a column-0 comment inside the block\n  notes: |\n    site_dir: /also-wrong\n"
            '  site_dir: "C:\\\\Sites\\\\x"\n---\n'))
        self.assertEqual(vaultlib.read_publish_scalar(vault, "site_dir"), "C:\\Sites\\x")

    def test_a_bom_site_json_is_read(self):
        site = Path(tempfile.mkdtemp(prefix="vc-site-"))
        self.addCleanup(shutil.rmtree, site, ignore_errors=True)
        (site / "vault.config.json").write_text(
            "\ufeff" + json.dumps({"excludeSections": ["GM Notes"]}), encoding="utf-8")
        vault = make_vault(self, f'---\ntype: meta\npublish:\n  site_dir: "{site}"\n---\n')
        self.assertEqual(vc.effective_exclude_sections(vault), ["GM Notes"])

    def test_no_site_dir_and_no_vault_list_is_an_info(self):
        vault = make_vault(self, "---\ntype: meta\npublish:\n  mode: player\n---\n")
        rows = vc.check_gm_leak(vault, None)
        self.assertTrue([r for r in rows if r.startswith("INFO\t_meta/vault-config.md")
                         and "site_dir" in r], rows)
        listed = make_vault(self, '---\ntype: meta\npublish:\n  exclude_sections: ["GM Notes"]\n---\n')
        self.assertFalse([r for r in vc.check_gm_leak(listed, None) if "site_dir" in r])

    def test_a_vault_that_never_publishes_gets_no_site_dir_info(self):
        vault = make_vault(self, "---\ntype: meta\nsystem: coc-7e\n---\n")
        self.assertFalse([r for r in vc.check_gm_leak(vault, None) if "site_dir" in r])


class GmLeakCodeRabbitTests(unittest.TestCase):
    """CodeRabbit on #263."""

    def test_keeper_checklist_gets_the_renest_advice(self):
        vault = make_vault(self, '---\ntype: meta\npublish:\n  exclude_sections: ["GM Notes"]\n---\n')
        (vault / "Bob.md").write_text("---\ntype: npc\n---\n\n# Bob\n\n## Keeper Checklist\n\n- x\n",
                                      encoding="utf-8")
        row = next(r for r in vc.check_gm_leak(vault, None) if "Keeper Checklist" in r)
        self.assertIn("--renest-excludes", row)

    def test_an_apostrophe_in_a_plain_site_dir_is_not_a_quote(self):
        import vaultlib
        vault = make_vault(self, "---\ntype: meta\npublish:\n  site_dir: /sites/GM's Site # player site\n---\n")
        self.assertEqual(vaultlib.read_publish_scalar(vault, "site_dir"), "/sites/GM's Site")


import vaultlib  # noqa: E402


class InlineMarkerTests(unittest.TestCase):
    """Markers not on their own line: the exact port and
    scan_body must agree with stripMarkedBlocks."""

    def strip(self, text, word="gm-only"):
        return "\n".join(vaultlib._js_strip_marked(text.split("\n"), word))

    def test_same_line_pair(self):
        out = self.strip("a <!-- gm-only -->SECRET<!-- /gm-only --> b")
        self.assertNotIn("SECRET", out)
        self.assertIn("a", out)

    def test_two_pairs_one_line(self):
        out = self.strip("x <!-- spoiler -->S1<!-- /spoiler --> y "
                         "<!-- spoiler -->S2<!-- /spoiler --> z", "spoiler")
        self.assertNotIn("S1", out)
        self.assertNotIn("S2", out)
        self.assertIn("y", out)

    def test_inline_in_div_multiline(self):
        out = self.strip("<div><!-- gm-only -->\nSECRET\n<!-- /gm-only --></div>\nAfter")
        self.assertNotIn("SECRET", out)
        self.assertIn("After", out)

    def test_fenced_markers_stay(self):
        text = "```\na <!-- gm-only -->X<!-- /gm-only --> b\n```"
        self.assertEqual(self.strip(text), text)

    def test_scan_body_tracks_inline_markers(self):
        states, problems = vc.scan_body(
            "<div><!-- gm-only -->\nSECRET\n<!-- /gm-only --></div>\nAfter", ())
        self.assertEqual(problems, [])
        self.assertEqual([s.gm_depth for s in states], [1, 1, 0, 0])

    def test_scan_body_unclosed_inline_reports(self):
        _states, problems = vc.scan_body("a <!-- gm-only -->SECRET", ())
        self.assertTrue(any("never closed" in p for p in problems))
