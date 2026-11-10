#!/usr/bin/env python3
"""vault_write.py wrapup-settle: tick checklist items, strike answered questions.

Run: python3 -m pytest tests/test_vault_write_settle.py -q
"""

import io
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "skills" / "shared" / "scripts"))

import vault_write as vw  # noqa: E402

WRAPUP = "Session 03 - Wrap-Up.md"
NOTE = """---
type: session-wrap-up
canon_status: DRAFT
---
# Session 3 Wrap-Up

## Summary

- Not an item to touch.

<!-- gm-only -->

## GM Notes

### Keeper Checklist

- [ ] **Bell** — decide who rang it
  - nested detail stays
- [ ] Letter: who wrote it
- [ ] Letter: who burned it

### Open Questions for Reconcile

1. Does Roy know about the cellar?
2. Who owns the boat?
   - maybe Anne

```
### Keeper Checklist
- [ ] Bell fake
```

<!-- /gm-only -->
"""


def run(vault, *argv, stdin=""):
    out = io.StringIO()
    with mock.patch("sys.stdout", out), mock.patch("sys.stderr", io.StringIO()):
        code = vw.main([str(vault), *argv], stdin=stdin)
    return code, out.getvalue()


def rows(*cols):
    return "\n".join("\t".join(c) for c in cols) + "\n"


class SettleTests(unittest.TestCase):
    def vault(self, note=NOTE):
        vault = Path(tempfile.mkdtemp(prefix="vwsettle-"))
        self.addCleanup(shutil.rmtree, vault, ignore_errors=True)
        (vault / WRAPUP).write_bytes(note.encode("utf-8"))
        return vault

    def read(self, vault):
        return (vault / WRAPUP).read_bytes().decode("utf-8")

    def settle(self, vault, *cols, write=True):
        argv = ["wrapup-settle", WRAPUP] + (["--write"] if write else [])
        return run(vault, *argv, stdin=rows(*cols))

    def test_settle_checklist_item(self):
        vault = self.vault()
        code, out = self.settle(vault, ("keeper checklist", "Bell", "the sexton"))
        self.assertEqual(code, 0, out)
        self.assertIn("- [x] ~~**Bell** — decide who rang it~~ — the sexton",
                      self.read(vault))
        self.assertIn("SETTLED\t" + WRAPUP + "\t§keeper checklist", out)

    def test_settle_numbered_question(self):
        vault = self.vault()
        code, out = self.settle(vault, ("Open Questions for Reconcile",
                                        "Does Roy", "no, he never went down"))
        self.assertEqual(code, 0, out)
        self.assertIn("1. ~~Does Roy know about the cellar?~~ — answered: "
                      "no, he never went down", self.read(vault))

    def test_settle_keeps_nested_lines(self):
        vault = self.vault()
        self.settle(vault, ("Keeper Checklist", "Bell", "x"),
                    ("Open Questions for Reconcile", "Who owns", "Anne"))
        text = self.read(vault)
        self.assertIn("— x\n  - nested detail stays\n", text)
        self.assertIn("— answered: Anne\n   - maybe Anne\n", text)

    def test_settle_already_settled_errors(self):
        vault = self.vault()
        self.settle(vault, ("Keeper Checklist", "Bell", "x"))
        before = self.read(vault)
        code, out = self.settle(vault, ("Keeper Checklist", "Bell", "y"))
        self.assertEqual(code, 1)
        self.assertIn("already settled", out)
        self.assertEqual(self.read(vault), before)

    def test_settle_two_matches_errors(self):
        vault = self.vault()
        code, out = self.settle(vault, ("Keeper Checklist", "Bell", "x"),
                                ("Keeper Checklist", "Letter", "y"))
        self.assertEqual(code, 1)
        self.assertIn("2 items match", out)
        self.assertEqual(self.read(vault), NOTE)  # the good row wrote nothing

    def test_settle_no_section_or_match_errors(self):
        vault = self.vault()
        for cols, why in ((("Nope", "Bell", "x"), "no section"),
                          (("Keeper Checklist", "Zzz", "x"), "no item"),
                          (("Keeper Checklist", "Bell fake", "x"), "no item")):
            code, out = self.settle(vault, cols)
            self.assertEqual(code, 1)
            self.assertIn(why, out)
        self.assertEqual(self.read(vault), NOTE)

    def test_settle_lead_by_bold_lead(self):
        vault = self.vault()
        code, _ = self.settle(vault, ("Keeper Checklist", "Letter: who wrote", "w"))
        self.assertEqual(code, 0)
        self.assertIn("~~Letter: who wrote it~~ — w", self.read(vault))

    def test_settle_crlf(self):
        vault = self.vault(NOTE.replace("\n", "\r\n"))
        code, out = self.settle(vault, ("Keeper Checklist", "Bell", "x"),
                                ("Open Questions for Reconcile", "Who owns", "Anne"))
        self.assertEqual(code, 0, out)
        text = self.read(vault)
        self.assertEqual(text.count("\r\n"), NOTE.count("\n"))
        self.assertEqual(text.replace("\r\n", "").count("\n"), 0)
        self.assertIn("— x\r\n", text)

    def test_settle_preview_writes_nothing(self):
        vault = self.vault()
        code, out = self.settle(vault, ("Keeper Checklist", "Bell", "x"),
                                write=False)
        self.assertEqual(code, 0)
        self.assertIn("WOULD-SETTLE", out)
        self.assertIn("settled: 1", out)
        self.assertEqual(self.read(vault), NOTE)


if __name__ == "__main__":
    unittest.main()
