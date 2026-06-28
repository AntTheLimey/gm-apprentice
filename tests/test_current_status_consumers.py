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
    def test_arc_spotlight_documents_current_status(self):
        text = read("ttrpg-expert/arc-spotlight-reference.md")
        self.assertIn("## Current Status", text)
        self.assertIn("Open threads", text)
        self.assertIn("Knows (exclusive)", text)

    def test_continuity_engine_documents_current_status(self):
        text = read("ttrpg-expert/continuity-engine.md")
        self.assertIn("## Current Status", text)
        self.assertIn("Open threads", text)
        self.assertIn("thread-decay", text)

    def test_entity_schema_consumed_by_pointer(self):
        text = read("shared/entity-schema.md")
        self.assertIn("**Consumed by:**", text)
        self.assertIn("campaign-qa", text)


class ConsumerTests(unittest.TestCase):
    def test_session_prep_reads_current_status(self):
        text = read("session-prep/SKILL.md")
        # Context Source declares the per-PC read
        self.assertIn("## Current Status", text)
        # Step 8 folds in Open threads as the always-current source
        self.assertIn("Open threads", text)
        # Step 11 uses Knows (exclusive) for personalization
        self.assertIn("Knows (exclusive)", text)


    def test_midwife_reads_current_status(self):
        text = read("the-midwife/SKILL.md")
        self.assertIn("## Current Status", text)
        self.assertIn("Open threads", text)
        self.assertIn("Knows (exclusive)", text)


if __name__ == "__main__":
    unittest.main(verbosity=2)
