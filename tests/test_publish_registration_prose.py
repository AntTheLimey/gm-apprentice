#!/usr/bin/env python3
"""Drift guard for who registers played sessions for publishing (#277).

Reconcile only runs `manifest publish-played` and REPORTS what it leaves
unclear: publishing an unclear hub publishes its body, so asking the GM is
publish-site's job alone. session-wrapup's "publish now" path ticks with
`manifest apply --publish`, since publish-played ticks only reviewed
sessions. Structural, not behavioral: proves the wording, not a run.

Run: python tests/test_publish_registration_prose.py
"""

import re
import unittest
from pathlib import Path

SKILLS = Path(__file__).resolve().parent.parent / "skills"


def read(rel):
    return (SKILLS / rel).read_text(encoding="utf-8")


def section(text, heading):
    start = text.index(heading)
    rest = text[start + len(heading):]
    end = re.search(r"^#{1,3} ", rest, re.M)
    return rest[:end.start()] if end else rest


class ReconcileRegistrationTests(unittest.TestCase):
    def setUp(self):
        self.step = section(read("shared/reconcile.md"),
                            "### 6.1. Publish registration")

    def test_runs_publish_played(self):
        self.assertIn("manifest publish-played", self.step)

    def test_never_offers_to_publish_an_unclear_hub(self):
        self.assertNotIn("manifest apply", self.step)
        self.assertNotRegex(self.step, r"(?i)ask the GM (once )?whether")

    def test_reports_and_leaves_asking_to_publish_site(self):
        self.assertIn("Report the unclear list", self.step)
        self.assertIn("publish-site asks the GM", self.step)

    def test_says_what_an_unset_or_relative_site_dir_means(self):
        self.assertRegex(self.step, r"`publish\.site_dir` is unset the vault"
                                    r" has no site")
        self.assertIn("relative to the vault", self.step)


class PublishSiteRegistrationTests(unittest.TestCase):
    def setUp(self):
        self.text = read("publish-site/SKILL.md")

    def test_offers_update_pin_for_a_stale_pin(self):
        self.assertRegex(self.text, r"pinned to an older tool,\s+offer "
                                    r"`update-pin")

    def test_site_dir_rules(self):
        self.assertRegex(self.text, r"relative value is relative to the\s+vault")
        self.assertRegex(self.text, r"skip\s+`publish-played`")


class WrapupPublishNowTests(unittest.TestCase):
    def test_publish_now_ticks_with_manifest_apply(self):
        text = section(read("session-wrapup/SKILL.md"), "### 6. Review (Reconcile)")
        self.assertRegex(text, r"manifest apply[^`]*--publish \"<index>\""
                               r" --publish \"<wrap-up>\"")
        self.assertRegex(text, r"ticks only\s+reviewed sessions")


if __name__ == "__main__":
    unittest.main()
