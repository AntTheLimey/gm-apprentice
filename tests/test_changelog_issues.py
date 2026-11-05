"""changelog_issues.py: which release shipped each issue, from CHANGELOG.md."""

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "skills" / "shared" / "scripts"))

import changelog_issues  # noqa: E402
from changelog_issues import issue_releases  # noqa: E402

LOG = """# Changelog

## [Unreleased]

- Something not yet out (#900).

## [1.10.12] — 2026-11-04

Gravity now counts on the sheet (#510).

### Fixed

- The second half of the fix (#357).
- A long entry that wraps
  onto a second line (#401).

## [1.10.9] — 2026-11-01

### Added

- The first half of the fix (#357, #366).
- A bare #366 in prose.
"""


class IssueReleaseTests(unittest.TestCase):
    def test_highest_release_wins_for_an_issue_cited_twice(self):
        got = issue_releases(LOG)
        self.assertEqual(got[357].release, "1.10.12")
        self.assertEqual(got[357].lines, ["- The second half of the fix (#357)."])

    def test_versions_compare_as_numbers_not_strings(self):
        log = ("## [1.10.9] — x\n\n- late (#1).\n\n"
               "## [1.10.10] — y\n\n- later (#1).\n")
        self.assertEqual(issue_releases(log)[1].release, "1.10.10")

    def test_unreleased_section_is_ignored(self):
        self.assertNotIn(900, issue_releases(LOG))

    def test_list_refs_and_bare_refs_are_read(self):
        got = issue_releases(LOG)
        self.assertEqual(got[366].release, "1.10.9")
        self.assertEqual(got[366].lines, [
            "- The first half of the fix (#357, #366).",
            "- A bare #366 in prose."])

    def test_a_paragraph_and_a_wrapped_bullet_are_read_whole(self):
        got = issue_releases(LOG)
        self.assertEqual(got[510].lines, ["Gravity now counts on the sheet (#510)."])
        self.assertEqual(got[401].lines,
                         ["- A long entry that wraps onto a second line (#401)."])

    def test_against_the_real_changelog(self):
        text = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
        got = issue_releases(text)
        self.assertEqual(got[510].release, "1.10.129")
        self.assertNotIn(483, got)   # named in 1.10.94's Follow-ups, still open

    def test_only_the_intro_and_the_change_subsections_are_read(self):
        log = ("## [1.2.3] — x\n\nIntro (#1).\n\n"
               "### Added\n\n- added (#2).\n\n"
               "### Follow-ups\n\n- filed, not fixed (#3).\n\n"
               "### Testing\n\n- tested (#4).\n\n"
               "### Fixed (publish tool)\n\n- fixed (#5).\n\n"
               "### Removed\n\n- removed (#6).\n\n"
               "### Security\n\n- s (#7).\n\n### Deprecated\n\n- d (#8).\n\n"
               "### Changed\n\n- changed (#9).\n\n### Note\n\n- n (#10).\n")
        self.assertEqual(sorted(issue_releases(log)), [1, 2, 5, 6, 7, 8, 9])

    def test_another_repos_issue_and_an_html_entity_are_not_ours(self):
        log = ("## [1.2.3] — x\n\n- Borrowed from tdennis/game#67.\n"
               "- It&#39;s fixed (#5).\n")
        self.assertEqual(sorted(issue_releases(log)), [5])

    def test_every_release_citing_an_issue_keeps_its_own_lines(self):
        got = issue_releases(LOG)
        self.assertEqual(got[357].cited, {
            "1.10.12": ["- The second half of the fix (#357)."],
            "1.10.9": ["- The first half of the fix (#357, #366)."]})

    def test_a_missing_changelog_reads_as_none(self):
        self.assertIsNone(changelog_issues.plugin_releases(
            ROOT / "no-such-CHANGELOG.md"))
        self.assertEqual(changelog_issues.CHANGELOG, ROOT / "CHANGELOG.md")


if __name__ == "__main__":
    unittest.main()
