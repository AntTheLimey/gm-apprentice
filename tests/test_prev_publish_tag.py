#!/usr/bin/env python3
"""The publish tool's release notes start from the previous publish-v tag.

`scripts/prev-publish-tag.sh <version>` reads tag names on stdin and prints
the greatest exact `publish-vX.Y.Z` strictly below <version>, or nothing.
A re-run must not pick the release's own tag (notes from itself to itself),
and a prerelease or otherwise suffixed tag is never a baseline.

Run: python3 tests/test_prev_publish_tag.py
"""

import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "scripts" / "prev-publish-tag.sh"
WORKFLOW = ROOT / ".github" / "workflows" / "publish-tool-release.yml"


def prev(version, tags):
    proc = subprocess.run(
        ["bash", str(SCRIPT), version], input="\n".join(tags) + "\n",
        capture_output=True, text=True, check=True)
    return proc.stdout.strip()


class PrevPublishTagTests(unittest.TestCase):
    def test_skips_the_current_tag_on_a_re_run(self):
        self.assertEqual(
            prev("1.11.40", ["publish-v1.11.30", "publish-v1.11.39",
                             "publish-v1.11.40"]),
            "publish-v1.11.39")

    def test_ignores_prerelease_and_suffixed_tags(self):
        self.assertEqual(
            prev("1.11.40", ["publish-v1.11.39", "publish-v1.11.40-rc.1",
                             "publish-v1.11.39-hotfix", "publish-vnext"]),
            "publish-v1.11.39")

    def test_ignores_tags_above_the_current_version(self):
        self.assertEqual(
            prev("1.11.40", ["publish-v1.11.39", "publish-v1.12.0"]),
            "publish-v1.11.39")

    def test_compares_versions_numerically(self):
        self.assertEqual(
            prev("1.11.10", ["publish-v1.11.9", "publish-v1.11.2",
                             "publish-v1.11.10"]),
            "publish-v1.11.9")

    def test_prints_nothing_without_an_earlier_tag(self):
        self.assertEqual(prev("1.11.40", []), "")
        self.assertEqual(prev("1.11.40", ["publish-v1.11.40"]), "")

    def test_the_workflow_uses_it(self):
        text = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("scripts/prev-publish-tag.sh", text)
        self.assertNotIn("--sort=-version:refname | head -1", text)


if __name__ == "__main__":
    unittest.main()
