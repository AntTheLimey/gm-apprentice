#!/usr/bin/env python3
"""threads.py: the shared thread entry format and list operations.

Run: python3 -m pytest tests/test_threads.py -q
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "skills" / "shared" / "scripts"))

import threads  # noqa: E402
from threads import SharedThread  # noqa: E402

FIXTURE = ROOT / "tests" / "fixtures" / "shared-threads"
OVERVIEW = FIXTURE / "Campaign Overview.md"
INES = FIXTURE / "PCs" / "Ines_Marlowe.md"
WRAPUP = FIXTURE / "Chapters" / "Chapter 1 - Harbour" / "Session 03 - Wrap-Up.md"


def read(path: Path) -> str:
    with open(path, encoding="utf-8", newline="") as f:
        return f.read()


class ThreadsTests(unittest.TestCase):
    def test_format_parse_round_trip(self):
        line = threads.format_shared("**Bell** rings", "Session 4",
                                     ["Ines_Marlowe", "Corwin_Hale"])
        self.assertEqual(
            line, "- **Bell** rings — since Session 4; "
                  "involves [[Ines_Marlowe]], [[Corwin_Hale]]")
        self.assertEqual(
            threads.parse_shared(line),
            SharedThread("**Bell** rings", "Session 4",
                         ["Ines_Marlowe", "Corwin_Hale"], False))
        party = threads.format_shared("Find the ledger", "Session 2", None)
        self.assertEqual(
            party, "- Find the ledger — since Session 2; involves the party")
        self.assertEqual(threads.parse_shared(party),
                         SharedThread("Find the ledger", "Session 2", [], True))
        nosince = threads.format_shared("Find the ledger", None, None)
        self.assertEqual(nosince, "- Find the ledger — involves the party")
        self.assertEqual(threads.parse_shared(nosince),
                         SharedThread("Find the ledger", None, [], True))
        # An em dash inside the text does not confuse the tail.
        dashed = threads.format_shared("**Lead —** body — more", None, ["A"])
        self.assertEqual(threads.parse_shared(dashed).text,
                         "**Lead —** body — more")

    def test_parse_plain_bullet(self):
        self.assertEqual(threads.parse_shared("- Just a thing"),
                         SharedThread("Just a thing", None, [], False))
        self.assertEqual(threads.parse_shared("* Star bullet"),
                         SharedThread("Star bullet", None, [], False))
        self.assertIsNone(threads.parse_shared("Not a bullet"))

    def test_involves_alias_link(self):
        got = threads.parse_shared(
            "- Debt — since S1; involves [[Freddy_Cavendish|Freddy]]")
        self.assertEqual(got.involves, ["Freddy_Cavendish"])

    def test_shared_threads_reads_only_its_section(self):
        got = threads.shared_threads(read(OVERVIEW))
        self.assertEqual([t.text for t in got], [
            "**The missing ledger** — Harrow Ford's toll keeper wants it back",
            "**Corwin's debt to the ferrywoman** — owed for the night crossing",
        ])
        self.assertTrue(got[0].party)
        self.assertEqual(got[0].since, "Session 2")
        self.assertEqual(got[1].involves, ["Ines_Marlowe", "Corwin_Hale"])
        self.assertEqual(threads.shared_threads("# X\n\n## Premise\n\n- a\n"),
                         [])
        self.assertEqual(
            [t.text for t in threads.pc_thread_items(read(INES))],
            ["**The ledger page in her coat** — torn from the toll book, "
             "not yet shown to anyone",
             "Find out who lit the lamp on the north bank"])

    def test_insert_creates_section_after_current_arc(self):
        text = "# T\n\n## Current Arc\n\nArc.\n\n## Key Factions\n\nF.\n"
        out = threads.insert_shared(text, "- A — involves the party")
        self.assertEqual(
            out, "# T\n\n## Current Arc\n\nArc.\n\n## Open Threads\n\n"
                 "- A — involves the party\n\n## Key Factions\n\nF.\n")
        out2 = threads.insert_shared(out, "- B — involves the party")
        self.assertEqual([t.text for t in threads.shared_threads(out2)],
                         ["A", "B"])
        self.assertEqual(out2.count("## Open Threads"), 1)

    def test_insert_before_gm_notes_when_no_current_arc(self):
        text = "# T\n\n## Premise\n\nP.\n\n## GM Notes\n\nSecret.\n"
        out = threads.insert_shared(text, "- A — involves the party")
        self.assertEqual(
            out, "# T\n\n## Premise\n\nP.\n\n## Open Threads\n\n"
                 "- A — involves the party\n\n## GM Notes\n\nSecret.\n")
        # A gm-only opener in front of GM Notes stays in front of it.
        fenced = "# T\n\n## Premise\n\nP.\n\n<!-- gm-only -->\n\n## GM Notes\n\nS.\n"
        out = threads.insert_shared(fenced, "- A — involves the party")
        self.assertLess(out.index("## Open Threads"), out.index("<!-- gm-only"))
        # Neither heading: the end of the note.
        end = threads.insert_shared("# T\n\nBody.\n", "- A — involves the party")
        self.assertEqual(
            end, "# T\n\nBody.\n\n## Open Threads\n\n- A — involves the party\n")

    def test_insert_after_current_arc_with_fence_before_gm_notes(self):
        text = ("# T\n\n## Current Arc\n\nArc.\n\n<!-- gm-only -->\n\n"
                "## GM Notes\n\nSecret.\n\n<!-- /gm-only -->\n")
        out = threads.insert_shared(text, "- A — involves the party")
        self.assertLess(out.index("- A —"), out.index("<!-- gm-only -->"))
        self.assertLess(out.index("## Open Threads"),
                        out.index("<!-- gm-only -->"))
        self.assertEqual(out.count("<!-- gm-only -->"), 1)

    def test_insert_before_gm_notes_ignores_earlier_closed_fence(self):
        premise = ("## Premise\n\nOne.\n\n<!-- gm-only -->\nHidden.\n"
                   "<!-- /gm-only -->\n\nTwo.\n")
        text = f"# T\n\n{premise}\n<!-- gm-only -->\n\n## GM Notes\n\nS.\n"
        out = threads.insert_shared(text, "- A — involves the party")
        self.assertIn(premise, out)
        self.assertIn("Two.\n\n## Open Threads\n\n- A — involves the party"
                      "\n\n<!-- gm-only -->\n\n## GM Notes", out)

    def test_closed_fence_directly_above_gm_notes(self):
        text = ("# T\n\n## Premise\n\nP.\n\n<!-- gm-only -->\nH.\n"
                "<!-- /gm-only -->\n\n## GM Notes\n\nS.\n")
        out = threads.insert_shared(text, "- A — involves the party")
        self.assertEqual(
            out, "# T\n\n## Premise\n\nP.\n\n<!-- gm-only -->\nH.\n"
                 "<!-- /gm-only -->\n\n## Open Threads\n\n"
                 "- A — involves the party\n\n## GM Notes\n\nS.\n")

    def test_insert_never_lands_in_a_fence(self):
        open_, close = "<!-- gm-only -->", "<!-- /gm-only -->"
        layouts = {
            "fence before GM Notes":
                f"# T\n\n## Premise\n\nP.\n\n{open_}\n\n## GM Notes\n\nS.\n\n{close}\n",
            "closed fence in Premise":
                f"# T\n\n## Premise\n\nOne.\n\n{open_}\nH.\n{close}\n\nTwo.\n\n## GM Notes\n\nS.\n",
            "closed fence above GM Notes":
                f"# T\n\n## Premise\n\nP.\n\n{open_}\nH.\n{close}\n\n## GM Notes\n\nS.\n",
            "fenced Current Arc":
                f"# T\n\n{open_}\n\n## Current Arc\n\nA.\n\n{close}\n\n## Key\n\nK.\n",
            "Current Arc then fenced GM Notes":
                f"# T\n\n## Current Arc\n\nA.\n\n{open_}\n\n## GM Notes\n\nS.\n\n{close}\n",
            "Open Threads last before fenced GM Notes":
                f"# T\n\n## Open Threads\n\n- a — involves the party\n\n{open_}\n\n## GM Notes\n\nS.\n\n{close}\n",
            "unclosed opener at the end":
                f"# T\n\n## Premise\n\nP.\n\n{open_}\n",
            "marker in a code block":
                f"# T\n\n## Premise\n\n```\n{open_}\n```\n\n## GM Notes\n\nS.\n",
        }

        def nonblank(text):
            return [l for l in text.split("\n") if l.strip()]

        for name, text in layouts.items():
            for step in range(2):
                new = f"- n{step} — involves the party"
                with self.subTest(layout=name, insert=step):
                    out = threads.insert_shared(text, new)
                    lines = out.split("\n")
                    states = threads._states(lines)
                    at = [i for i, l in enumerate(lines) if l == new]
                    self.assertEqual(len(at), 1)
                    i = at[0]
                    self.assertFalse(states[i])
                    self.assertFalse(states[i + 1])
                    if "## Open Threads" in lines and "## Open Threads" not in text:
                        h = lines.index("## Open Threads")
                        self.assertFalse(states[h])
                    # Nothing else moved or was split.
                    rest = [l for l in nonblank(out) if l != new
                            and l != "## Open Threads"]
                    before = [l for l in nonblank(text)
                              if l != "## Open Threads"]
                    self.assertEqual(rest, before)
                    later = [l for l in lines[i + 1:] if l.strip()]
                    self.assertTrue(
                        not later or later[0].startswith("#")
                        or later[0] == open_, later[:1])
                    text = out

    def test_insert_with_no_point_outside_a_fence_raises(self):
        with self.assertRaises(ValueError):
            threads.insert_shared(
                "# T\n\n<!-- gm-only -->\n\nSecret.\n", "- A")

    def test_second_insert_before_fenced_gm_notes(self):
        text = ("# T\n\n## Open Threads\n\n- a — involves the party\n\n"
                "<!-- gm-only -->\n\n## GM Notes\n\nS.\n\n"
                "<!-- /gm-only -->\n")
        out = threads.insert_shared(text, "- b — involves the party")
        self.assertEqual(
            out, "# T\n\n## Open Threads\n\n- a — involves the party\n"
                 "- b — involves the party\n\n<!-- gm-only -->\n\n"
                 "## GM Notes\n\nS.\n\n<!-- /gm-only -->\n")

    def test_crlf_no_trailing_newline(self):
        out = threads.insert_shared("# T\r\n\r\nBody.",
                                    "- A — involves the party")
        self.assertEqual(out.count("\n"), out.count("\r\n"))
        self.assertNotIn("\r\r", out)
        self.assertEqual(threads.shared_threads(out)[0].text, "A")

    def test_append_resolved_creates_heading_inside_gm_fence(self):
        out = threads.append_resolved(read(WRAPUP), "- **Ledger** — returned")
        self.assertIn(
            "- **The north-bank lamp** — nobody has said who lit it.\n\n"
            "#### Resolved Threads\n\n- **Ledger** — returned\n\n"
            "#### Player-Stated Intentions\n", out)
        self.assertLess(out.index("#### Resolved Threads"),
                        out.index("<!-- /gm-only -->"))
        again = threads.append_resolved(out, "- **Lamp** — lit by the ferryman")
        self.assertEqual(again.count("#### Resolved Threads"), 1)
        self.assertIn("- **Ledger** — returned\n- **Lamp** — lit by the "
                      "ferryman\n", again)
        # Unresolved is the last heading: the closer still follows.
        last = ("### What Carries Forward\n\n#### Unresolved Threads\n\n- a\n\n"
                "<!-- /gm-only -->\n")
        out = threads.append_resolved(last, "- b")
        self.assertEqual(
            out, "### What Carries Forward\n\n#### Unresolved Threads\n\n- a\n\n"
                 "#### Resolved Threads\n\n- b\n\n<!-- /gm-only -->\n")

    def test_append_resolved_uses_existing_heading(self):
        text = ("<!-- gm-only -->\n\n### What Carries Forward\n\n"
                "#### Unresolved Threads\n\n- a\n\n"
                "#### Resolved Threads\n\n{Closed threads, with evidence.}\n\n"
                "#### Skipped Prep\n\n- x\n\n<!-- /gm-only -->\n")
        out = threads.append_resolved(text, "- b")
        self.assertEqual(
            out, "<!-- gm-only -->\n\n### What Carries Forward\n\n"
                 "#### Unresolved Threads\n\n- a\n\n"
                 "#### Resolved Threads\n\n- b\n\n"
                 "#### Skipped Prep\n\n- x\n\n<!-- /gm-only -->\n")
        self.assertEqual(out.count("#### Resolved Threads"), 1)

    def test_find_thread_by_lead_and_text(self):
        bullets = ["**Ledger** — wanted by the toll keeper", "Plain thing",
                   "**Ledger** — a second one"]
        self.assertEqual(threads.find_thread(bullets, "Ledger"), [0, 2])
        self.assertEqual(threads.find_thread(bullets, "Plain thing"), [1])
        self.assertEqual(threads.find_thread(bullets, "Nothing"), [])
        self.assertEqual(threads.lead("**Bell —** rings"), "Bell")
        self.assertEqual(threads.lead("No lead here"), "No lead here")
        self.assertEqual(threads.lead("**Bell:** rings"), "Bell")
        self.assertEqual(threads.lead("**Bell.** rings"), "Bell")
        rung = ["**Bell —** rings", "**Tolls:** the bell"]
        self.assertEqual(threads.find_thread(rung, "Bell —"), [0])
        self.assertEqual(threads.find_thread(rung, "Bell"), [0])
        self.assertEqual(threads.find_thread(rung, "Tolls"), [1])
        self.assertEqual(threads.find_thread(["**Bell.** rings"], "Bell"), [0])
        self.assertEqual(threads.find_thread(rung, "Tolls:"), [1])

    def test_remove_bullet(self):
        text = read(INES)
        out = threads.remove_bullet(
            text, ("Current Status", "**Open threads**"), 0)
        self.assertEqual([t.text for t in threads.pc_thread_items(out)],
                         ["Find out who lit the lamp on the north bank"])
        self.assertIn("## Notes", out)
        out = threads.remove_bullet(read(WRAPUP), (
            "GM Notes", "What Carries Forward", "Unresolved Threads"), 1)
        self.assertNotIn("north-bank lamp", out)
        self.assertIn("The missing ledger", out)
        with self.assertRaises(IndexError):
            threads.remove_bullet(text, ("Current Status",), 99)
        with self.assertRaises(KeyError):
            threads.remove_bullet(text, ("No Such Section",), 0)

    def test_crlf_kept(self):
        def crlf(s: str) -> str:
            return s.replace("\r\n", "\n").replace("\n", "\r\n")
        over = crlf(read(OVERVIEW).replace("## Open Threads", "## Gone")
                    .replace("## Gone", "## Elsewhere"))
        out = threads.insert_shared(over, "- A — involves the party")
        self.assertNotIn("\r\r", out)
        self.assertEqual(out.count("\n"), out.count("\r\n"))
        self.assertEqual(threads.shared_threads(out)[0].text, "A")
        wrap = crlf(read(WRAPUP))
        out = threads.append_resolved(wrap, "- done")
        self.assertEqual(out.count("\n"), out.count("\r\n"))
        self.assertIn("#### Resolved Threads\r\n\r\n- done\r\n", out)
        out = threads.remove_bullet(crlf(read(INES)),
                                    ("Current Status", "**Open threads**"), 0)
        self.assertEqual(out.count("\n"), out.count("\r\n"))
        self.assertEqual(len(threads.pc_thread_items(out)), 1)


if __name__ == "__main__":
    unittest.main()
