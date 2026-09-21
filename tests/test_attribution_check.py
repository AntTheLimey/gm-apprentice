#!/usr/bin/env python3
"""Regression tests for scripts/attribution_check.py.

Each test builds a throwaway git repository shaped like the real one, so the
git-backed checks (tracked personal/ files, gitignore coverage, added files
versus ATTRIBUTION.md) run against real git, not mocks.

Run: python3 tests/test_attribution_check.py
"""

from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "scripts"))

import attribution_check as ac  # noqa: E402

SYSTEMS = "skills/ttrpg-expert/systems"

NOTICES = {
    "gurps-4e": (
        "# GURPS — Notice\n\n> GURPS is a trademark of Steve Jackson Games.\n"
        "> See https://www.sjgames.com/general/online_policy.html\n"
    ),
    "fitd": (
        "# FitD — Notice\n\nThis work is based on Blades in the Dark "
        "(https://www.bladesinthedark.com/), authored by John Harper, licensed "
        "under CC-BY 3.0 (https://creativecommons.org/licenses/by/3.0/).\n"
    ),
    "coc-7e": (
        "# CoC — Notice\n\n> BRP: ORC License.\n> Lovecraft: public domain.\n"
        "> Own words: uncopyrightable mechanics (Baker v. Selden, 1879).\n"
    ),
    "dnd-5e-2024": (
        "# D&D — Notice\n\nSRD 5.2 (https://www.dndbeyond.com/srd), "
        "https://creativecommons.org/licenses/by/4.0/legalcode.\n"
    ),
    "pf2e": (
        "# PF2e — Notice\n\nORC License https://paizo.com/orclicense, "
        "© Paizo Inc.\n"
    ),
}
ATTRIBUTION = (
    "## Open Game Content\n"
    "### Dungeons & Dragons System Reference Document 5.2\n"
    "### Blades in the Dark / Forged in the Dark\n"
    "### Basic Roleplaying Universal Game Engine\n"
    "### Pathfinder Second Edition (Remaster)\n"
    "## GURPS\n"
)
GITIGNORE = "".join(f"{SYSTEMS}/{s}/personal/\n" for s in NOTICES)


def git(repo: Path, *args: str) -> None:
    subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@t", *args],
        cwd=repo,
        check=True,
        capture_output=True,
    )


class Fixture:
    """A valid repo: every system has its NOTICE.md and one content file."""

    def __init__(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        git(self.root, "init", "-q", "-b", "main")
        self.write("ATTRIBUTION.md", ATTRIBUTION)
        self.write(".gitignore", GITIGNORE)
        for system, notice in NOTICES.items():
            self.write(f"{SYSTEMS}/{system}/NOTICE.md", notice)
            self.write(f"{SYSTEMS}/{system}/mechanics.md", "# Mechanics\n")
        self.write(f"{SYSTEMS}/generic/mechanics.md", "# Generic\n")
        git(self.root, "add", "-A")
        git(self.root, "commit", "-q", "-m", "base")

    def write(self, rel: str, text: str) -> Path:
        p = self.root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")
        return p

    def messages(self) -> list[str]:
        found = ac.check_systems(self.root) + ac.check_personal(self.root)
        return [str(f) for f in found]

    def close(self) -> None:
        self.tmp.cleanup()


class NoticeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.fx = Fixture()
        self.addCleanup(self.fx.close)

    def test_valid_fixture_is_clean(self) -> None:
        self.assertEqual(self.fx.messages(), [])

    def test_content_files_need_no_notice_of_their_own(self) -> None:
        # The point of one notice per system: files carry none.
        for system in NOTICES:
            self.fx.write(f"{SYSTEMS}/{system}/rules.md", "# Rules\n\nJust mechanics.\n")
        self.assertEqual(self.fx.messages(), [])

    def test_missing_notice_file_is_reported(self) -> None:
        (self.fx.root / SYSTEMS / "fitd" / "NOTICE.md").unlink()
        msgs = self.fx.messages()
        self.assertEqual(len(msgs), 1)
        self.assertIn("fitd/NOTICE.md", msgs[0])
        self.assertIn("missing", msgs[0])

    def test_notice_missing_a_required_uri_is_reported(self) -> None:
        self.fx.write(
            f"{SYSTEMS}/gurps-4e/NOTICE.md",
            "# GURPS\n\n> Steve Jackson Games owns GURPS.\n",
        )
        msgs = self.fx.messages()
        self.assertEqual(len(msgs), 1)
        self.assertIn("gurps-4e/NOTICE.md", msgs[0])
        self.assertIn("online_policy", msgs[0])

    def test_coc_notice_needs_every_notice_family(self) -> None:
        for phrase in ("ORC License", "public domain", "Baker v. Selden", "uncopyrightable"):
            with self.subTest(dropped=phrase):
                text = NOTICES["coc-7e"].replace(phrase, "REDACTED")
                self.fx.write(f"{SYSTEMS}/coc-7e/NOTICE.md", text)
                self.assertEqual(len(self.fx.messages()), 1)
        self.fx.write(f"{SYSTEMS}/coc-7e/NOTICE.md", NOTICES["coc-7e"])
        self.assertEqual(self.fx.messages(), [])

    def test_notice_match_is_case_insensitive(self) -> None:
        self.fx.write(f"{SYSTEMS}/pf2e/NOTICE.md", NOTICES["pf2e"].upper())
        self.assertEqual(self.fx.messages(), [])

    def test_nested_variant_files_do_not_need_notices(self) -> None:
        self.fx.write(f"{SYSTEMS}/coc-7e/variants/regency/x.md", "# X\n")
        self.assertEqual(self.fx.messages(), [])

    def test_generic_is_exempt(self) -> None:
        self.fx.write(f"{SYSTEMS}/generic/more.md", "# No notice, none needed\n")
        self.assertEqual(self.fx.messages(), [])

    def test_personal_directory_is_never_scanned(self) -> None:
        self.fx.write(f"{SYSTEMS}/gurps-4e/personal/full-book.md", "# No notice\n")
        self.fx.write(f"{SYSTEMS}/gurps-4e/personal/data.csv", "a,b\n")
        self.assertEqual(self.fx.messages(), [])

    def test_unknown_system_directory_is_reported(self) -> None:
        self.fx.write(f"{SYSTEMS}/newsys/core.md", "# Core\n")
        msgs = self.fx.messages()
        # Also not gitignored: a new system has no personal/ entry yet.
        self.assertEqual(len(msgs), 2)
        self.assertTrue(any("no notice rule" in m for m in msgs))
        self.assertTrue(any("not gitignored" in m for m in msgs))

    def test_missing_attribution_section_is_reported(self) -> None:
        self.fx.write("ATTRIBUTION.md", ATTRIBUTION.replace("## GURPS\n", ""))
        msgs = self.fx.messages()
        self.assertEqual(len(msgs), 1)
        self.assertIn("no section for gurps-4e", msgs[0])

    def test_non_markdown_file_in_a_system_dir_is_reported(self) -> None:
        self.fx.write(f"{SYSTEMS}/gurps-4e/weapons.csv", "name,dmg\nsword,1d\n")
        msgs = self.fx.messages()
        self.assertEqual(len(msgs), 1)
        self.assertIn("weapons.csv", msgs[0])
        self.assertIn("non-markdown", msgs[0])

    def test_ds_store_is_ignored_but_other_dotfiles_are_not(self) -> None:
        self.fx.write(f"{SYSTEMS}/gurps-4e/.DS_Store", "x")
        self.fx.write(f"{SYSTEMS}/.DS_Store", "x")
        self.assertEqual(self.fx.messages(), [])
        self.fx.write(f"{SYSTEMS}/gurps-4e/.notes.csv", "a,b\n")
        msgs = self.fx.messages()
        self.assertEqual(len(msgs), 1)
        self.assertIn(".notes.csv", msgs[0])

    def test_unclassified_file_directly_under_systems_is_reported(self) -> None:
        self.fx.write(f"{SYSTEMS}/gurps-quickref.md", "| Dmg | 1d |\n")
        msgs = self.fx.messages()
        self.assertEqual(len(msgs), 1)
        self.assertIn("directly under systems/", msgs[0])

    def test_shared_patterns_at_the_root_is_exempt(self) -> None:
        self.fx.write(f"{SYSTEMS}/shared-patterns.md", "# Shared\n")
        self.assertEqual(self.fx.messages(), [])

    def test_tracked_personal_file_is_reported(self) -> None:
        p = self.fx.write(f"{SYSTEMS}/gurps-4e/personal/book.md", "secret\n")
        git(self.fx.root, "add", "-f", str(p))
        msgs = self.fx.messages()
        self.assertEqual(len(msgs), 1)
        self.assertIn("tracked by git", msgs[0])

    def test_unignored_personal_directory_is_reported(self) -> None:
        self.fx.write(
            ".gitignore", GITIGNORE.replace(f"{SYSTEMS}/pf2e/personal/\n", "")
        )
        msgs = self.fx.messages()
        self.assertEqual(len(msgs), 1)
        self.assertIn("pf2e/personal/", msgs[0])
        self.assertIn("not gitignored", msgs[0])


class AddedFilesTests(unittest.TestCase):
    def setUp(self) -> None:
        self.fx = Fixture()
        self.addCleanup(self.fx.close)
        git(self.fx.root, "checkout", "-q", "-b", "feature")

    def commit(self, msg: str = "change") -> None:
        git(self.fx.root, "add", "-A")
        git(self.fx.root, "commit", "-q", "-m", msg)

    def test_new_licensed_file_without_attribution_update_fails(self) -> None:
        self.fx.write(f"{SYSTEMS}/gurps-4e/new.md", "# New\n")
        self.commit()
        found = ac.check_added_files(self.fx.root, "main")
        self.assertEqual(len(found), 1)
        self.assertIn("gurps-4e/new.md", str(found[0]))

    def test_new_licensed_file_with_attribution_update_passes(self) -> None:
        self.fx.write(f"{SYSTEMS}/gurps-4e/new.md", "# New\n")
        self.fx.write("ATTRIBUTION.md", ATTRIBUTION + "\nnew.md sourced from B.\n")
        self.commit()
        self.assertEqual(ac.check_added_files(self.fx.root, "main"), [])

    def test_edit_to_existing_file_needs_no_attribution_update(self) -> None:
        self.fx.write(f"{SYSTEMS}/gurps-4e/mechanics.md", "# Mechanics\nedit\n")
        self.commit()
        self.assertEqual(ac.check_added_files(self.fx.root, "main"), [])

    def test_adding_only_a_notice_file_needs_no_attribution_update(self) -> None:
        (self.fx.root / SYSTEMS / "fitd" / "NOTICE.md").unlink()
        self.commit("remove")
        git(self.fx.root, "checkout", "-q", "-b", "readd")
        self.fx.write(f"{SYSTEMS}/fitd/NOTICE.md", NOTICES["fitd"])
        self.commit("readd")
        self.assertEqual(ac.check_added_files(self.fx.root, "feature"), [])

    def test_new_generic_file_needs_no_attribution_update(self) -> None:
        self.fx.write(f"{SYSTEMS}/generic/new.md", "# Original\n")
        self.commit()
        self.assertEqual(ac.check_added_files(self.fx.root, "main"), [])

    def test_bad_base_ref_is_an_error_not_a_silent_pass(self) -> None:
        found = ac.check_added_files(self.fx.root, "no-such-ref")
        self.assertEqual(len(found), 1)
        self.assertIn("failed", str(found[0]))


class ZipTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)

    def make_zip(self, entries: list[str]) -> None:
        with zipfile.ZipFile(self.dir / "ttrpg-expert.zip", "w") as z:
            for e in entries:
                z.writestr(e, "x")

    def all_notices(self) -> list[str]:
        return [f"systems/{s}/NOTICE.md" for s in NOTICES]

    def test_zip_with_every_notice_is_clean(self) -> None:
        self.make_zip(self.all_notices() + ["systems/gurps-4e/mechanics.md", "SKILL.md"])
        self.assertEqual(ac.check_zips(self.dir), [])

    def test_zip_missing_a_notice_is_reported(self) -> None:
        self.make_zip([e for e in self.all_notices() if "pf2e" not in e])
        found = [str(f) for f in ac.check_zips(self.dir)]
        self.assertEqual(len(found), 1)
        self.assertIn("systems/pf2e/NOTICE.md", found[0])

    def test_zip_shipping_a_personal_file_is_reported(self) -> None:
        self.make_zip(self.all_notices() + ["systems/gurps-4e/personal/book.md"])
        found = [str(f) for f in ac.check_zips(self.dir)]
        self.assertEqual(len(found), 1)
        self.assertIn("personal/book.md", found[0])

    def test_missing_zip_is_an_error_not_a_silent_pass(self) -> None:
        found = [str(f) for f in ac.check_zips(self.dir)]
        self.assertEqual(len(found), 1)
        self.assertIn("zip not found", found[0])


class RealRepoTests(unittest.TestCase):
    def test_repository_is_clean(self) -> None:
        found = ac.check_systems(REPO) + ac.check_personal(REPO)
        self.assertEqual([str(f) for f in found], [])

    def test_every_rule_system_has_a_notice_file(self) -> None:
        for system in ac.RULES:
            self.assertTrue(
                (REPO / SYSTEMS / system / "NOTICE.md").is_file(), system
            )

    def test_cli_exit_codes(self) -> None:
        fx = Fixture()
        self.addCleanup(fx.close)
        script = str(REPO / "scripts" / "attribution_check.py")
        ok = subprocess.run(
            [sys.executable, script, "--repo", str(fx.root)],
            capture_output=True,
            text=True,
        )
        self.assertEqual(ok.returncode, 0, ok.stdout + ok.stderr)
        (fx.root / SYSTEMS / "fitd" / "NOTICE.md").unlink()
        bad = subprocess.run(
            [sys.executable, script, "--repo", str(fx.root)],
            capture_output=True,
            text=True,
        )
        self.assertEqual(bad.returncode, 1)
        self.assertIn("fitd/NOTICE.md", bad.stdout)

    def test_cli_zips_flag(self) -> None:
        fx = Fixture()
        self.addCleanup(fx.close)
        zdir = fx.root / "dist"
        zdir.mkdir()
        script = str(REPO / "scripts" / "attribution_check.py")

        def run() -> subprocess.CompletedProcess[str]:
            return subprocess.run(
                [sys.executable, script, "--repo", str(fx.root), "--zips", str(zdir)],
                capture_output=True,
                text=True,
            )

        self.assertEqual(run().returncode, 1)  # no zip yet
        with zipfile.ZipFile(zdir / "ttrpg-expert.zip", "w") as z:
            for s in NOTICES:
                z.writestr(f"systems/{s}/NOTICE.md", "x")
        self.assertEqual(run().returncode, 0)


if __name__ == "__main__":
    unittest.main()
