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

    def test_pc_thread_items_lazy_line(self):
        pc = ("## Current Status\n\n**Open threads:**\n"
              "- **Ledger** — the keeper\nwants it back\n"
              "- Second\n<!-- gm-only -->\n- Third\n<!-- /gm-only -->\n"
              "- Fourth\n**Knows:** x\n")
        got = threads.pc_thread_items(pc)
        self.assertEqual([t.text for t in got], [
            "**Ledger** — the keeper wants it back", "Second", "Third",
            "Fourth"])
        self.assertEqual(got[0].lines,
                         ("**Ledger** — the keeper", "wants it back"))
        self.assertEqual([t.hidden for t in got], [False, False, True, False])
        out = threads.remove_pc_thread(pc, got[0])
        self.assertNotIn("wants it back", out)
        self.assertIn("**Open threads:**\n- Second\n", out)
        heading = "## Current Status\n\n**Open threads:**\n- A\n## Notes\n"
        self.assertEqual(
            [t.text for t in threads.pc_thread_items(heading)], ["A"])

    HIDING_FORMS = {
        "spoiler fence": ("<!-- spoiler -->", "<!-- /spoiler -->"),
        "%% comment": ("%%", "%%"),
        "HTML comment": ("<!--", "-->"),
    }

    def test_shared_threads_read_as_the_publish_tool_reads_them(self):
        # The vectors lib/shared-threads.js is pinned to: each visible
        # thread with a tail, as the tool puts it on a PC page.
        import json
        vectors = json.loads(read(ROOT / "tools" / "publish" / "test"
                                  / "fixtures" / "shared-thread-vectors.json"))
        for case in vectors["cases"]:
            with self.subTest(case["about"]):
                got = [{"markdown": f"- {t.text}" + (
                            f" — since {t.since.strip()}" if t.since else ""),
                        "involves": t.involves, "party": t.party}
                       for t in threads.shared_threads(case["markdown"])
                       if t.party or t.involves]
                self.assertEqual(got, case["entries"])

    def test_template_open_threads_holds_no_prose(self):
        # The section is player-facing: anything in the template would
        # publish above the shared threads for good.
        template = read(ROOT / "skills" / "shared" / "templates"
                        / "campaign-overview.md")
        lines = template.split("\n")
        start, end = threads._shared_span(lines)
        self.assertEqual([l for l in lines[start + 1:end] if l.strip()], [])
        out = threads.insert_shared(template, "- A — involves the party")
        self.assertIn("## Open Threads\n\n- A — involves the party\n\n"
                      "## Key Factions", out)

    def test_bulleted_open_threads_label(self):
        # `- **Open threads:**` with its threads nested under it, as a
        # bulleted Current Status writes it; the next bulleted field ends it.
        pc = ("## Current Status\n\n- **Location:** the dock\n"
              "- **Open threads:**\n    - the ledger;\n    - the bell\n"
              "      rings at noon\n* **Knows:** x\n    - not a thread\n")
        got = threads.pc_thread_items(pc)
        self.assertEqual([t.text for t in got],
                         ["the ledger;", "the bell rings at noon"])
        out = threads.remove_pc_thread(pc, got[1])
        self.assertIn("- **Open threads:**\n    - the ledger;\n* **Knows:**",
                      out)
        # A wrapped line that starts in bold is not the next field.
        pc3 = ("## Current Status\n\n- **Open threads:**\n    - **S7:** the\n"
               "      **unrecorded** XP\n    - b\n- **Knows:** x\n")
        self.assertEqual([t.text for t in threads.pc_thread_items(pc3)],
                         ["**S7:** the **unrecorded** XP", "b"])
        # An unbulleted label after it ends it too.
        pc2 = ("## Current Status\n\n- **Open threads:**\n    - a\n"
               "**Knows:** x\n- b\n")
        self.assertEqual([t.text for t in threads.pc_thread_items(pc2)],
                         ["a"])

    def test_inline_open_threads_is_one_thread(self):
        # `**Open threads:** text` (bulleted or not) is one thread: the text
        # and any bullets nested under it.
        for marker in ("- ", "* ", ""):
            with self.subTest(marker=marker):
                pc = (f"## Current Status\n\n{marker}**Open threads:** the "
                      "ledger; the bell\n    - **Session 5:** fled\n"
                      f"{marker}**Knows:** x\n")
                got = threads.pc_thread_items(pc)
                self.assertEqual([t.text for t in got],
                                 ["the ledger; the bell; **Session 5:** fled"])
                self.assertEqual(got[0].lines, (
                    "the ledger; the bell", "- **Session 5:** fled"))
                out = threads.remove_pc_thread(pc, got[0])
                self.assertEqual(out, f"## Current Status\n\n"
                                      f"{marker}**Open threads:**\n"
                                      f"{marker}**Knows:** x\n")
                self.assertEqual(threads.pc_thread_items(out), [])
        # CRLF: the label line keeps its CR.
        pc = ("## Current Status\r\n\r\n- **Open threads:** a\r\n"
              "- **Knows:** x\r\n")
        got = threads.pc_thread_items(pc)
        self.assertEqual([t.text for t in got], ["a"])
        self.assertEqual(threads.remove_pc_thread(pc, got[0]),
                         "## Current Status\r\n\r\n- **Open threads:**\r\n"
                         "- **Knows:** x\r\n")
        # Unbulleted, with bullets under it: the text, then each bullet.
        pc = ("## Current Status\n\n**Open threads:** first\n- second\n"
              "- third\n")
        self.assertEqual([t.text for t in threads.pc_thread_items(pc)],
                         ["first", "second", "third"])

    def test_open_threads_stop_at_a_subsection(self):
        # The last field before a subsection: its bullets are not threads.
        for head in ("### Journal", "#### Notes", "## Next"):
            with self.subTest(head=head):
                pc = ("## Current Status\n\n**Open threads:**\n- a\n\n"
                      f"{head}\n\n- not a thread\n")
                self.assertEqual(
                    [t.text for t in threads.pc_thread_items(pc)], ["a"])
        # A heading inside a code fence does not stop it.
        pc = ("## Current Status\n\n**Open threads:**\n- a\n```\n"
              "### x\n```\n- b\n")
        self.assertEqual([t.text for t in threads.pc_thread_items(pc)],
                         ["a", "b"])

    def test_hidden_forms_are_hidden(self):
        # Every bullet inside a spoiler fence, a %% comment or an HTML
        # comment is hidden, the middle one (next to no mark) too.
        for form, (opener, closer) in self.HIDING_FORMS.items():
            with self.subTest(form):
                pc = ("## Current Status\n\n**Open threads:**\n- Own\n\n"
                      f"{opener}\n- Secret one\n- Secret two\n"
                      f"- Secret three\n{closer}\n\n- After\n"
                      "**Knows:** x\n")
                got = threads.pc_thread_items(pc)
                self.assertEqual([t.text for t in got], [
                    "Own", "Secret one", "Secret two", "Secret three",
                    "After"])
                self.assertEqual([t.hidden for t in got],
                                 [False, True, True, True, False])
                self.assertEqual([t.fenced for t in got],
                                 [False, True, True, True, False])

    def test_inline_and_adjacent_comments_are_hidden(self):
        pc = ("## Current Status\n\n**Open threads:**\n"
              "- Aside <!-- the abbot lies --> here\n"
              "- Next to a comment\n<!-- an aside -->\n\n"
              "- Under a closer\n\n%%x%%\n- Under a mark\n\n- Clear\n"
              "**Knows:** x\n")
        got = threads.pc_thread_items(pc)
        self.assertEqual([(t.text, t.hidden) for t in got], [
            ("Aside <!-- the abbot lies --> here", True),
            ("Next to a comment", True), ("Under a closer", False),
            ("Under a mark", True), ("Clear", False)])
        self.assertFalse(any(t.fenced for t in got))

    def test_lazy_line_never_joins_a_comment_or_callout(self):
        for line in ("<!-- spoiler -->", "<!--", "-->", "%%",
                     "> [!note] see story", "> quoted"):
            with self.subTest(line):
                pc = ("## Current Status\n\n**Open threads:**\n"
                      f"- **Ledger** — keeper\n{line}\n**Knows:** x\n")
                (got,) = threads.pc_thread_items(pc)
                self.assertEqual(got.text, "**Ledger** — keeper")
                self.assertEqual(got.lines, ("**Ledger** — keeper",))
                self.assertIn(f"\n{line}\n",
                              threads.remove_pc_thread(pc, got))

    def test_remove_shared(self):
        text = read(OVERVIEW)
        out = threads.remove_shared(text, 0)
        self.assertEqual([t.text for t in threads.shared_threads(out)],
                         ["**Corwin's debt to the ferrywoman** — owed for "
                          "the night crossing"])
        self.assertIn("## Key Factions", out)
        wrapped = ("# T\n\n## Open Threads\n\n- a — involves the party\n"
                   "  more of a\n- b — involves the party\n")
        self.assertEqual(threads.remove_shared(wrapped, 0),
                         "# T\n\n## Open Threads\n\n"
                         "- b — involves the party\n")
        with self.assertRaises(IndexError):
            threads.remove_shared(text, 99)
        with self.assertRaises(KeyError):
            threads.remove_shared("# T\n\n## Premise\n\n- a\n", 0)

    def test_one_finder_for_the_shared_section(self):
        # Level 2, any case, outside a code fence: read, add and remove
        # all find the same section.
        text = ("# T\n\n```\n## Open Threads\n- not this — involves the "
                "party\n```\n\n### Open Threads\n\n- nor this\n\n"
                "## Open threads\n\n- a — involves the party\n\n"
                "## Key\n\nK.\n")
        self.assertEqual([t.text for t in threads.shared_threads(text)],
                         ["a"])
        out = threads.insert_shared(text, "- b — involves the party")
        self.assertEqual(out.count("\n## Open"), 2)
        self.assertEqual([t.text for t in threads.shared_threads(out)],
                         ["a", "b"])
        self.assertIn("- a — involves the party\n- b — involves the party\n",
                      out)
        out = threads.remove_shared(out, 0)
        self.assertEqual([t.text for t in threads.shared_threads(out)],
                         ["b"])
        self.assertIn("- not this", out)
        self.assertIn("- nor this", out)
        # A code-fenced bullet inside the section is not a thread.
        fenced = ("## Open Threads\n\n```\n- code — involves the party\n"
                  "```\n- real — involves the party\n")
        self.assertEqual([t.text for t in threads.shared_threads(fenced)],
                         ["real"])
        self.assertNotIn("real", threads.remove_shared(fenced, 0))

    def test_existing_section_with_no_open_point_raises(self):
        # Open Threads runs into an unclosed gm-only fence: no second heading.
        text = ("# T\n\n## Current Arc\n\nA.\n\n## Open Threads\n\n- a\n\n"
                "<!-- gm-only -->\n\nhid\n")
        with self.assertRaises(ValueError):
            threads.insert_shared(text, "- b — involves the party")
        # The heading itself sits inside a gm-only fence.
        text = ("# T\n\n<!-- gm-only -->\n\n## Open Threads\n\n- a\n\n"
                "<!-- /gm-only -->\n\n## GM Notes\n\nS.\n")
        with self.assertRaises(ValueError):
            threads.insert_shared(text, "- b — involves the party")

    def test_hidden_shared_entries_are_marked(self):
        text = ("## Open Threads\n\n- open — involves [[A]]\n"
                "<!-- gm-only -->\n- secret — involves [[A]]\n"
                "<!-- /gm-only -->\n- %%aside%% note — involves [[A]]\n")
        got = threads.shared_threads(text)
        self.assertEqual([(t.text, t.hidden) for t in got],
                         [("open", False), ("secret", True),
                          ("%%aside%% note", True)])

    def test_shared_entry_in_or_next_to_a_comment_is_hidden(self):
        # The PC side's rule: in a comment, holding a mark, or next to a
        # line with one (a gm-only marker line next to it does not count).
        for opener, closer in (("<!--", "-->"), ("%%", "%%")):
            with self.subTest(opener):
                text = ("## Open Threads\n\n- Clear — involves [[A]]\n\n"
                        f"- Bell — involves [[A]] {opener}\n"
                        f"The sexton rang it.\n{closer}\n\n"
                        f"- Beside — involves [[A]]\n{opener}\naside\n"
                        f"{closer}\n\n- Last — involves [[A]]\n")
                got = threads.shared_threads(text)
                self.assertEqual([(t.text, t.hidden) for t in got], [
                    ("Clear", False), ("Bell The sexton rang it.", True),
                    ("Beside", True), ("Last", False)])
                # widen_shared never edits a hidden entry.
                for name in ("Bell The sexton rang it.", "Beside"):
                    with self.assertRaises(KeyError):
                        threads.widen_shared(text, name, ["Cole"])

    NESTED = ("# T\n\n## Open Threads\n\n"
              "- **Bell** — rings at dusk — since Session 2; involves "
              "[[Ines_Marlowe]]\n"
              "  - the sexton knows\n"
              "    more of the sexton\n"
              "- **Ledger** — involves the party\n\n## Key\n\nK.\n")

    def test_nested_shared_bullet_belongs_to_its_parent(self):
        # The same input as the publish tool's sharedEntries test.
        got = threads.shared_threads(self.NESTED)
        self.assertEqual([t.text for t in got], [
            "**Bell** — rings at dusk; the sexton knows more of the sexton",
            "**Ledger**"])
        self.assertEqual(got[0].involves, ["Ines_Marlowe"])
        self.assertEqual(got[0].since, "Session 2")
        self.assertTrue(got[1].party)
        self.assertEqual(threads.remove_shared(self.NESTED, 0),
                         "# T\n\n## Open Threads\n\n"
                         "- **Ledger** — involves the party\n\n## Key\n\nK.\n")
        out = threads.widen_shared(
            self.NESTED, "**Bell** — rings at dusk; the sexton knows more "
            "of the sexton", ["Cole"])
        self.assertIn("involves [[Ines_Marlowe]], [[Cole]]\n"
                      "  - the sexton knows\n", out)
        # A tail on a wrapped line is the entry's tail; widening extends it.
        wrapped = ("## Open Threads\n\n- The bell rings\n"
                   "  — involves [[A]]\n")
        (t,) = threads.shared_threads(wrapped)
        self.assertEqual((t.text, t.involves), ("The bell rings", ["A"]))
        self.assertEqual(threads.widen_shared(wrapped, "The bell rings",
                                              ["B"]),
                         wrapped.replace("[[A]]", "[[A]], [[B]]"))
        # No tail at all: the first line gets one.
        bare = "## Open Threads\n\n- Bare\n  - nested\n"
        self.assertEqual(threads.widen_shared(bare, "Bare; nested", ["B"]),
                         "## Open Threads\n\n- Bare — involves [[B]]\n"
                         "  - nested\n")

    def test_widen_shared_adds_missing_names_only(self):
        text = ("# T\r\n\r\n## Open Threads\r\n\r\n"
                "- **Bell** — owed — since Session 2; involves [[Ada|A]], "
                "[[Bram]]\r\n- Party one — involves the party\r\n"
                "- Bare one\r\n\r\n## Key\r\n")
        out = threads.widen_shared(text, "**Bell** — owed",
                                   ["Cole", "bram", "Ada"])
        self.assertIn("- **Bell** — owed — since Session 2; involves "
                      "[[Ada|A]], [[Bram]], [[Cole]]\r\n", out)
        self.assertEqual(out.count("\n"), out.count("\r\n"))
        self.assertEqual(threads.widen_shared(out, "**Bell** — owed",
                                              ["Cole"]), out)
        self.assertEqual(threads.widen_shared(text, "Party one", ["Cole"]),
                         text)
        bare = threads.widen_shared(text, "Bare one", ["Cole", "Ada"])
        self.assertIn("- Bare one — involves [[Cole]], [[Ada]]\r\n", bare)
        with self.assertRaises(KeyError):
            threads.widen_shared(text, "Nothing", ["Cole"])
        # A hidden entry is never the one widened.
        fenced = ("## Open Threads\n\n<!-- gm-only -->\n- Bell — involves "
                  "[[Ada]]\n<!-- /gm-only -->\n")
        with self.assertRaises(KeyError):
            threads.widen_shared(fenced, "Bell", ["Cole"])

    def test_party_is_any_case(self):
        got = threads.parse_shared("- X — involves The Party")
        self.assertTrue(got.party)

    def test_append_resolved_fences_an_unfenced_block(self):
        text = ("# W\n\n### What Carries Forward\n\n#### Unresolved Threads"
                "\n\n- a\n\n## Next\n\nN.\n")
        out = threads.append_resolved(text, "- b")
        self.assertEqual(
            out, "# W\n\n### What Carries Forward\n\n#### Unresolved Threads"
                 "\n\n- a\n\n<!-- gm-only -->\n\n#### Resolved Threads\n\n"
                 "- b\n\n<!-- /gm-only -->\n\n## Next\n\nN.\n")
        again = threads.append_resolved(out, "- c")
        self.assertIn("- b\n- c\n\n<!-- /gm-only -->", again)
        self.assertEqual(again.count("#### Resolved Threads"), 1)
        # At the end of the note too.
        end = threads.append_resolved(
            "### What Carries Forward\n\n#### Unresolved Threads\n\n- a\n",
            "- b")
        self.assertEqual(
            end, "### What Carries Forward\n\n#### Unresolved Threads\n\n"
                 "- a\n\n<!-- gm-only -->\n\n#### Resolved Threads\n\n- b\n\n"
                 "<!-- /gm-only -->\n")

    def test_append_resolved_fences_under_an_unfenced_heading(self):
        # An existing Resolved Threads heading outside any gm-only fence:
        # the evidence goes in a fence of its own, and later lines join it.
        text = ("# W\n\n### What Carries Forward\n\n#### Resolved Threads\n\n"
                "- a\n\n## Next\n\nN.\n")
        out = threads.append_resolved(text, "- b")
        self.assertEqual(
            out, "# W\n\n### What Carries Forward\n\n#### Resolved Threads\n\n"
                 "- a\n\n<!-- gm-only -->\n\n- b\n\n<!-- /gm-only -->\n\n"
                 "## Next\n\nN.\n")
        again = threads.append_resolved(out, "- c")
        self.assertEqual(
            again, out.replace("- b\n", "- b\n- c\n"))
        # A lone placeholder under it.
        blank = ("### What Carries Forward\n\n#### Resolved Threads\n\n"
                 "{Closed threads, with evidence.}\n\n#### Skipped Prep\n")
        self.assertEqual(
            threads.append_resolved(blank, "- b"),
            "### What Carries Forward\n\n#### Resolved Threads\n\n"
            "<!-- gm-only -->\n\n- b\n\n<!-- /gm-only -->\n\n"
            "#### Skipped Prep\n")
        # Inside a fence that opens under the heading and never closes:
        # already hidden, no second fence.
        open_ = ("#### Resolved Threads\n\n<!-- gm-only -->\n\n- a\n")
        self.assertEqual(threads.append_resolved(open_, "- b"),
                         open_ + "- b\n")

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
        out = threads.remove_shared(crlf(read(OVERVIEW)), 0)
        self.assertEqual(out.count("\n"), out.count("\r\n"))
        self.assertEqual(len(threads.shared_threads(out)), 1)


if __name__ == "__main__":
    unittest.main()
