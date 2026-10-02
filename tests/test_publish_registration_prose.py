#!/usr/bin/env python3
"""Drift guard for who registers played sessions for publishing (#277).

Reconcile only runs `manifest publish-played` and REPORTS what it leaves
unclear: publishing an unclear hub publishes its body, so asking the GM is
publish-site's job alone. session-wrapup's "publish now" path, and
publish-site's approved unclear sessions, go through `manifest
publish-played --session "<index>" --include-unreviewed`, which waives only
the review check and keeps pairing and the site-pin gate (#278). For an
approved session with no Wrap-Up, publish-site says the body publishes as
written and uses `--publish-body`, the GM's explicit yes. No skill may tick
a session index with `manifest apply --publish`: that bypasses all of it. Structural, not behavioral: proves the
wording, not a run.

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
        self.assertRegex(self.step, r"`publish\.site` is `false`, or it is "
                                    r"unset and so is\s+`publish\.site_dir`, "
                                    r"the vault has no site")
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


    def test_approved_unclear_sessions_go_through_publish_played(self):
        self.assertRegex(self.text, r"manifest publish-played --config\s+"
                                    r"<dir>/vault\.config\.json\s+"
                                    r"--session \"<index>\"` plus\s+"
                                    r"`--include-unreviewed` when it has a "
                                    r"Wrap-Up")
        self.assertRegex(self.text, r"`--publish-body` when it has none")

    def test_the_question_says_the_body_publishes_as_written(self):
        self.assertRegex(self.text, r"index body will publish as written")
        self.assertRegex(self.text, r"fencing any Keeper notes first")
        self.assertRegex(self.text, r"Never tick\s+a session index with\s+"
                                    r"`manifest apply`")


PUBLISH_PLAYED_SESSION = (r"manifest publish-played\s+--config\s+"
                          r"<site_dir>/vault\.config\.json\s+--session\s+"
                          r"\"<index>\"\s+--include-unreviewed")


class WrapupPublishNowTests(unittest.TestCase):
    def setUp(self):
        self.text = section(read("session-wrapup/SKILL.md"),
                            "### 6. Review (Reconcile)")

    def test_publish_now_goes_through_publish_played(self):
        self.assertRegex(self.text, PUBLISH_PLAYED_SESSION)

    def test_publish_now_never_applies_the_index(self):
        self.assertNotIn("manifest apply", self.text)

    def test_publish_now_relays_an_unclear_reason(self):
        self.assertRegex(self.text, r"lists the session as unclear, tell the"
                                    r"\s+GM its reason")


# `manifest apply --publish` naming a session index, in any wording: the
# placeholders the skills use for one.
INDEX_APPLY = re.compile(
    r"manifest apply[^`]*--publish\s+\"?<(index|session[^>]*|hub)>", re.I)


class NoSkillAppliesASessionIndexTests(unittest.TestCase):
    def test_no_skill_or_reference_applies_a_session_index(self):
        hits = []
        for path in sorted(SKILLS.rglob("*.md")):
            text = path.read_text(encoding="utf-8")
            for m in INDEX_APPLY.finditer(text):
                hits.append(f"{path.relative_to(SKILLS)}: {m.group(0)}")
        self.assertEqual(hits, [])


if __name__ == "__main__":
    unittest.main()
