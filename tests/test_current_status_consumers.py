#!/usr/bin/env python3
"""Regression tests proving the PC `## Current Status` block is consumed.

PR #57 made `## Current Status` a canonical, cumulative PC body block but
left it read by nothing except the website + GM. This follow-up wires four
consumers. These tests assert each consumer's file references the block's
contract, so the wiring cannot be silently removed (the durable drift guard
the freshness check alone cannot provide).

Structural, not behavioral: proves the wiring exists, not that a given vault
produces a given prep.

Run: python tests/test_current_status_consumers.py
"""

import unittest
from pathlib import Path

SKILLS = Path(__file__).resolve().parent.parent / "skills"


def read(rel):
    return (SKILLS / rel).read_text(encoding="utf-8")


class SpineTests(unittest.TestCase):
    def test_pc_body_structure_consumed_by_pointer(self):
        # The Current Status spec (incl. the Consumed-by contract) lives in
        # shared/pc-body-structure.md, extracted from entity-schema.md.
        text = read("shared/pc-body-structure.md")
        self.assertIn("**Consumed by:**", text)
        self.assertIn("campaign-qa", text)
        # entity-schema.md keeps a breadcrumb to the extracted file.
        self.assertIn("pc-body-structure.md", read("shared/entity-schema.md"))


class ConsumerTests(unittest.TestCase):
    def test_campaign_qa_has_current_status_check(self):
        skill = read("campaign-qa/SKILL.md")
        # The Current Status consistency check lives in the Canon Audit
        # procedure, now split into references/checks/canon-audit.md.
        proc = read("campaign-qa/references/checks/canon-audit.md")
        self.assertIn("## Current Status", skill)
        self.assertIn("Current Status", proc)
        self.assertIn("Open threads", proc)


if __name__ == "__main__":
    unittest.main(verbosity=2)
