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
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "scripts"))

import attribution_check as ac  # noqa: E402

SYSTEMS = "skills/ttrpg-expert/systems"

GURPS_NOTICE = (
    "> GURPS is a trademark of Steve Jackson Games.\n"
    "> See https://www.sjgames.com/general/online_policy.html\n\n"
)
FITD_NOTICE = (
    "\nThis work is based on Blades in the Dark "
    "(https://www.bladesinthedark.com/), authored by John Harper, licensed "
    "under CC-BY 3.0 (https://creativecommons.org/licenses/by/3.0/).\n"
)
ATTRIBUTION = (
    "## Open Game Content\n"
    "### Dungeons & Dragons System Reference Document 5.2\n"
    "### Blades in the Dark / Forged in the Dark\n"
    "### Basic Roleplaying Universal Game Engine\n"
    "### Pathfinder Second Edition (Remaster)\n"
    "## GURPS\n"
)
GITIGNORE = "".join(
    f"{SYSTEMS}/{s}/personal/\n"
    for s in ("gurps-4e", "fitd", "coc-7e", "dnd-5e-2024", "pf2e")
)


def git(repo: Path, *args: str) -> None:
    subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@t", *args],
        cwd=repo,
        check=True,
        capture_output=True,
    )


class Fixture:
    """A minimal valid repo: one GURPS file, one FitD file, one CoC file."""

    def __init__(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        git(self.root, "init", "-q", "-b", "main")
        self.write("ATTRIBUTION.md", ATTRIBUTION)
        self.write(".gitignore", GITIGNORE)
        self.write(f"{SYSTEMS}/gurps-4e/mechanics.md", GURPS_NOTICE + "# Mechanics\n")
        self.write(f"{SYSTEMS}/fitd/mechanics.md", "# Mechanics\n" + FITD_NOTICE)
        self.write(
            f"{SYSTEMS}/coc-7e/setting.md",
            "> Content is in the public domain.\n\n# Setting\n",
        )
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


class AttributionCheckTests(unittest.TestCase):
    def setUp(self) -> None:
        self.fx = Fixture()
        self.addCleanup(self.fx.close)

    def test_valid_fixture_is_clean(self) -> None:
        self.assertEqual(self.fx.messages(), [])

    def test_missing_notice_is_reported_with_path(self) -> None:
        self.fx.write(f"{SYSTEMS}/fitd/rules.md", "# Rules\n\nSome mechanics.\n")
        msgs = self.fx.messages()
        self.assertEqual(len(msgs), 1)
        self.assertIn("fitd/rules.md", msgs[0])
        self.assertIn("missing", msgs[0])

    def test_gurps_notice_at_the_bottom_is_misplaced(self) -> None:
        self.fx.write(
            f"{SYSTEMS}/gurps-4e/traits.md",
            "# Traits\n" + "filler line\n" * 30 + GURPS_NOTICE,
        )
        msgs = self.fx.messages()
        self.assertEqual(len(msgs), 1)
        self.assertIn("present but not in the first 20 lines", msgs[0])

    def test_fitd_notice_at_the_top_is_misplaced(self) -> None:
        self.fx.write(
            f"{SYSTEMS}/fitd/top.md",
            FITD_NOTICE + "\n# Heading\n" + "body line\n\n" * 30,
        )
        msgs = self.fx.messages()
        self.assertEqual(len(msgs), 1)
        self.assertIn("present but not in the last 12", msgs[0])

    def test_notice_needs_every_marker_not_just_one(self) -> None:
        # Names the licence but omits the required URI.
        self.fx.write(
            f"{SYSTEMS}/gurps-4e/half.md",
            "> Steve Jackson Games owns GURPS.\n\n# Half\n",
        )
        self.assertEqual(len(self.fx.messages()), 1)

    def test_coc_accepts_each_notice_family(self) -> None:
        for i, phrase in enumerate(
            ("ORC License", "public domain", "Baker v. Selden", "uncopyrightable")
        ):
            self.fx.write(f"{SYSTEMS}/coc-7e/f{i}.md", f"> {phrase}.\n\n# T\n")
        self.assertEqual(self.fx.messages(), [])

    def test_coc_file_with_no_notice_fails(self) -> None:
        self.fx.write(f"{SYSTEMS}/coc-7e/bare.md", "# Bare\n")
        self.assertEqual(len(self.fx.messages()), 1)

    def test_nested_variant_files_are_checked(self) -> None:
        self.fx.write(f"{SYSTEMS}/coc-7e/variants/regency/x.md", "# X\n")
        msgs = self.fx.messages()
        self.assertEqual(len(msgs), 1)
        self.assertIn("variants/regency/x.md", msgs[0])

    def test_generic_is_exempt(self) -> None:
        self.fx.write(f"{SYSTEMS}/generic/more.md", "# No notice, none needed\n")
        self.assertEqual(self.fx.messages(), [])

    def test_personal_directory_is_never_scanned(self) -> None:
        self.fx.write(f"{SYSTEMS}/gurps-4e/personal/full-book.md", "# No notice\n")
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
        self.fx.write(f"{SYSTEMS}/pf2e/core.md", "> ORC License paizo.com/orclicense Paizo Inc\n")
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
        self.fx.write(f"{SYSTEMS}/gurps-4e/new.md", GURPS_NOTICE + "# New\n")
        self.commit()
        found = ac.check_added_files(self.fx.root, "main")
        self.assertEqual(len(found), 1)
        self.assertIn("gurps-4e/new.md", str(found[0]))

    def test_new_licensed_file_with_attribution_update_passes(self) -> None:
        self.fx.write(f"{SYSTEMS}/gurps-4e/new.md", GURPS_NOTICE + "# New\n")
        self.fx.write("ATTRIBUTION.md", ATTRIBUTION + "\nnew.md sourced from B.\n")
        self.commit()
        self.assertEqual(ac.check_added_files(self.fx.root, "main"), [])

    def test_edit_to_existing_file_needs_no_attribution_update(self) -> None:
        self.fx.write(
            f"{SYSTEMS}/gurps-4e/mechanics.md", GURPS_NOTICE + "# Mechanics\nedit\n"
        )
        self.commit()
        self.assertEqual(ac.check_added_files(self.fx.root, "main"), [])

    def test_new_generic_file_needs_no_attribution_update(self) -> None:
        self.fx.write(f"{SYSTEMS}/generic/new.md", "# Original\n")
        self.commit()
        self.assertEqual(ac.check_added_files(self.fx.root, "main"), [])

    def test_bad_base_ref_is_an_error_not_a_silent_pass(self) -> None:
        found = ac.check_added_files(self.fx.root, "no-such-ref")
        self.assertEqual(len(found), 1)
        self.assertIn("failed", str(found[0]))


class RealRepoTests(unittest.TestCase):
    def test_repository_is_clean(self) -> None:
        found = ac.check_systems(REPO) + ac.check_personal(REPO)
        self.assertEqual([str(f) for f in found], [])

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
        fx.write(f"{SYSTEMS}/fitd/bad.md", "# Bad\n")
        bad = subprocess.run(
            [sys.executable, script, "--repo", str(fx.root)],
            capture_output=True,
            text=True,
        )
        self.assertEqual(bad.returncode, 1)
        self.assertIn("fitd/bad.md", bad.stdout)


if __name__ == "__main__":
    unittest.main()
