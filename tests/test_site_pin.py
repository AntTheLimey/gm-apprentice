#!/usr/bin/env python3
"""vault_check's site-pin gate against the JS gate's own test vectors
(tools/publish/test/fixtures/site-pin-vectors.json), so the two agree on
which tool a site builds with and whether it withholds hub bodies.

Run: python tests/test_site_pin.py
"""

import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "skills" / "shared" / "scripts"))
import vault_check as vc  # noqa: E402

VECTORS = json.loads((ROOT / "tools" / "publish" / "test" / "fixtures"
                      / "site-pin-vectors.json").read_text(encoding="utf-8"))


def site_from(case, v):
    site = Path(tempfile.mkdtemp(prefix="vc-site-pin-"))
    case.addCleanup(shutil.rmtree, site, ignore_errors=True)
    tool = site / "node_modules" / "gm-apprentice-publish"
    if v["installed"] == "BROKEN_SYMLINK":
        tool.parent.mkdir(parents=True)
        os.symlink(site / "no-such-dir", tool)
    elif v["installed"] is not None:
        tool.mkdir(parents=True)
        (tool / "package.json").write_text(
            "{nope" if v["installed"] == "UNPARSEABLE" else json.dumps(
                {"name": "gm-apprentice-publish",
                 "version": v["installed"]}), encoding="utf-8")
    if v["package"] is not None:
        (site / "package.json").write_text(
            "{nope" if v["package"] == "UNPARSEABLE"
            else json.dumps(v["package"]), encoding="utf-8")
    return site


class SemverTests(unittest.TestCase):
    def test_below(self):
        for a, b, below in VECTORS["below"]:
            with self.subTest(a=a, b=b):
                self.assertEqual(vc.semver_below(a, b), below)

    def test_invalid(self):
        for bad in VECTORS["invalid"]:
            with self.subTest(bad=bad):
                self.assertIsNone(vc.parse_semver(bad))
                with self.assertRaises(ValueError):
                    vc.semver_below(bad, "1.11.40")


class SitePinTests(unittest.TestCase):
    def test_vectors(self):
        for v in VECTORS["sites"]:
            with self.subTest(v["name"]):
                pin = vc.site_pin(site_from(self, v))
                self.assertEqual({"stale": bool(pin.stale),
                                  "version": pin.version,
                                  "source": pin.source}, v["expect"])

    def test_a_pinned_but_uninstalled_old_tool_fails_safe(self):
        # The re-check's repro: package.json pins a vendored 1.11.39 and
        # nothing is installed. The plugin's tool must not answer for it.
        site = site_from(self, {"installed": None, "package": {
            "dependencies": {"gm-apprentice-publish":
                             "file:vendor/gm-apprentice-publish-1.11.39.tgz"}}})
        tool, _label, why = vc._publish_tool_for(site)
        self.assertIsNone(tool)
        self.assertIn("site pinned to 1.11.39 predates body withholding", why)

    def test_a_current_pin_not_yet_installed_asks_the_plugin_and_says_so(self):
        site = site_from(self, {"installed": None, "package": {
            "dependencies": {"gm-apprentice-publish": "^1.11.40"}}})
        tool, label, why = vc._publish_tool_for(site)
        self.assertEqual(tool, vc.PUBLISH_TOOL)
        self.assertIsNone(why)
        self.assertIn("pins 1.11.40, not installed yet", label)


if __name__ == "__main__":
    unittest.main()
