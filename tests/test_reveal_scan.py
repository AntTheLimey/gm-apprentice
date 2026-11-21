#!/usr/bin/env python3
"""reveal_scan.py: what is still hidden in what a session touched.

Run: python3 tests/test_reveal_scan.py
"""

from __future__ import annotations

import contextlib
import io
import sys
import tempfile
import unicodedata
import unittest
from pathlib import Path
from typing import Any
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import reveal_scan as rv  # noqa: E402
from vault_check import ToolAnswer  # noqa: E402

SESS = "Chapters/Chapter 1/Sessions"
INDEX = f"{SESS}/Session 12 - Mill.md"
NOTES = f"{SESS}/Session 12 - Mill - Play Notes.md"
WRAP = f"{SESS}/Session 12 - Mill - Wrap-Up.md"
PLAN = f"{SESS}/Session 12 - Mill - Plan.md"


def base(play: str = "The party met [[Vex]].\n", wrap: str = "Nothing.\n",
         plan: str = "Plan: [[Mill]].\n") -> dict[str, str]:
    return {
        INDEX: "---\ntype: session\nsession_number: 12\ndocuments:\n"
               "  plan: \"[[Session 12 - Mill - Plan]]\"\n"
               "  play_notes: \"[[Session 12 - Mill - Play Notes]]\"\n"
               "  wrap_up: \"[[Session 12 - Mill - Wrap-Up]]\"\n---\n",
        NOTES: f"---\ntype: session-play-notes\n---\n\n{play}",
        WRAP: f"---\ntype: session_wrap\n---\n\n{wrap}",
        PLAN: f"---\ntype: session-plan\n---\n\n{plan}",
    }


def make_vault(tmp: str, files: dict[str, str]) -> Path:
    vault = Path(tmp)
    for rel, text in files.items():
        path = vault / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    return vault


def tool(listed: bool = True, publishing: list[str] | None = None,
         stripped: dict[str, list[str]] | None = None,
         props: tuple[str, ...] = ()) -> Any:
    def ask(vault: Path, args: list[str], site_optional: bool = False) -> ToolAnswer:
        if args[:2] == ["manifest", "list"]:
            if not listed:
                return ToolAnswer(data={"listed": False, "publishing": []})
            return ToolAnswer(data={"listed": True, "publishing": publishing or [],
                                    "excluded": [], "needs_decision": []})
        pages = [{"path": p, "strippedSections": s, "prop": p in props}
                 for p, s in (stripped or {}).items()]
        pages += [{"path": p, "strippedSections": [], "prop": True}
                  for p in props if p not in (stripped or {})]
        return ToolAnswer(data={"pages": pages})
    return ask


def run_scan(files: dict[str, str], also: tuple[str, ...] = (), **kw: Any) -> rv.ScanResult:
    with tempfile.TemporaryDirectory() as tmp, \
            mock.patch.object(rv, "ask_publish_tool", tool(**kw)):
        vault = make_vault(tmp, files)
        return rv.scan(vault, INDEX, also=also) if also else rv.scan(vault, INDEX)


VEX = "---\ntype: npc\nwithheld: true\n---\n\n# Vex\n"


class RevealScan(unittest.TestCase):
    def test_lists_unpublished_and_withheld(self) -> None:
        res = run_scan({**base(), "NPCs/Vex.md": VEX})
        self.assertEqual([(r.path, r.published, r.withheld) for r in res.rows],
                         [("NPCs/Vex.md", False, True)])
        self.assertEqual(res.sources, ["Play Notes", "Wrap-Up"])

    def test_lists_hidden_parts_of_published_note(self) -> None:
        mill = ("---\ntype: location\ngm_aliases: [The Widow]\n---\n\n# Mill\n\n"
                "## GM Notes\n\nSecret.\n\n<!-- gm-only -->\nx\n<!-- /gm-only -->\n\n"
                "<!-- spoiler -->\nthe wheel hides a body\n<!-- /spoiler -->\n")
        res = run_scan({**base(play="At [[Mill]].\n"), "Places/Mill.md": mill},
                       publishing=["Places/Mill.md"],
                       stripped={"Places/Mill.md": ["GM Notes"]})
        self.assertEqual(len(res.rows), 1)
        row = res.rows[0]
        self.assertTrue(row.published)
        self.assertFalse(row.withheld)
        self.assertEqual(row.hidden, ["GM Notes", "gm-only x1",
                                      "spoiler: the wheel hides a body",
                                      "gm_aliases: The Widow"])

    def test_fully_public_note_not_listed(self) -> None:
        res = run_scan({**base(play="At [[Mill]].\n"),
                        "Places/Mill.md": "---\ntype: location\n---\n\n# Mill\n"},
                       publishing=["Places/Mill.md"])
        self.assertEqual(res.rows, [])

    def test_prep_types_never_candidates(self) -> None:
        files = {**base(play="[[Hall Scene]] [[Session 12 - Mill - Plan]] [[Session 11]]\n"),
                 f"{SESS}/Hall Scene.md": "---\ntype: scene\n---\n",
                 f"{SESS}/Session 11.md": "---\ntype: session\n---\n"}
        self.assertEqual(run_scan(files).rows, [])

    def test_no_publish_list(self) -> None:
        with tempfile.TemporaryDirectory() as tmp, \
                mock.patch.object(rv, "ask_publish_tool", tool(listed=False)):
            vault = make_vault(tmp, {**base(), "NPCs/Vex.md": VEX})
            self.assertFalse(rv.scan(vault, INDEX).listed)
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                code = rv.main([str(vault), INDEX])
        self.assertEqual(code, 0)
        self.assertEqual(out.getvalue(), "reveals: no publish list; nothing to unlock\n")

    def test_plan_only_link_not_evidence(self) -> None:
        files = {**base(play="Nothing here.\n", plan="Plan: [[Vex]].\n"),
                 "NPCs/Vex.md": VEX}
        self.assertEqual(run_scan(files).rows, [])

    def test_no_play_notes_or_wrap_up(self) -> None:
        files = {INDEX: "---\ntype: session\ndocuments:\n  plan: null\n---\n"}
        with tempfile.TemporaryDirectory() as tmp, \
                mock.patch.object(rv, "ask_publish_tool", tool()):
            res = rv.scan(make_vault(tmp, files), INDEX)
        self.assertEqual(rv.render(res), [
            "reveals: Session 12 - Mill (sources: none)", "# notes: 0"])

    def test_tool_failure_is_not_no_publish_list(self) -> None:
        def ask(vault: Path, args: list[str], site_optional: bool = False) -> ToolAnswer:
            return ToolAnswer(why="node is not on PATH")
        with tempfile.TemporaryDirectory() as tmp, \
                mock.patch.object(rv, "ask_publish_tool", ask):
            vault = make_vault(tmp, {**base(), "NPCs/Vex.md": VEX})
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                code = rv.main([str(vault), INDEX])
        self.assertEqual(code, 0)
        self.assertEqual(out.getvalue(),
                         "reveals: could not ask the publish tool: node is not on PATH\n")

    def test_no_site_quiet_answer_is_no_publish_list(self) -> None:
        def ask(vault: Path, args: list[str], site_optional: bool = False) -> ToolAnswer:
            return ToolAnswer()
        with tempfile.TemporaryDirectory() as tmp, \
                mock.patch.object(rv, "ask_publish_tool", ask):
            res = rv.scan(make_vault(tmp, base()), INDEX)
        self.assertEqual(rv.render(res), ["reveals: no publish list; nothing to unlock"])

    def test_withheld_unknown_is_said(self) -> None:
        def boom(text: str) -> Any:
            raise rv.PublishToolUnavailable("withheld answer not understood")
        with mock.patch.object(rv, "note_withheld", boom):
            res = run_scan({**base(), "NPCs/Vex.md": VEX})
        self.assertEqual(rv.render(res), [
            "reveals: Session 12 - Mill (sources: Play Notes, Wrap-Up)",
            "NPCs/Vex.md\tunpublished withheld unknown\t",
            "# warning: withheld unknown: withheld answer not understood",
            "# notes: 1"])

    def test_explain_failure_is_said(self) -> None:
        listed = tool()
        def ask(vault: Path, args: list[str], site_optional: bool = False) -> ToolAnswer:
            if args[:1] == ["explain"]:
                return ToolAnswer(why="explain --all timed out after 60s")
            return listed(vault, args, site_optional)
        with tempfile.TemporaryDirectory() as tmp, \
                mock.patch.object(rv, "ask_publish_tool", ask):
            res = rv.scan(make_vault(tmp, {**base(), "NPCs/Vex.md": VEX}), INDEX)
        self.assertIn("# warning: section titles and prop marks unknown: explain --all timed out after 60s",
                      rv.render(res))

    def test_fallback_play_notes_beside_index(self) -> None:
        files = {INDEX: "---\ntype: session\n---\n",
                 NOTES: "---\ntype: session-play-notes\n---\n\nMet [[Vex]].\n",
                 "NPCs/Vex.md": VEX}
        res = run_scan(files)
        self.assertEqual(res.sources, ["Play Notes"])
        self.assertEqual([r.path for r in res.rows], ["NPCs/Vex.md"])

    def test_recap_is_a_source(self) -> None:
        files = base(play="Nothing.\n")
        files[INDEX] = files[INDEX].replace(
            "documents:\n", "documents:\n  recap: \"[[Session 12 - Mill - Recap]]\"\n")
        files[f"{SESS}/Session 12 - Mill - Recap.md"] = "---\ntype: recap\n---\n\n[[Vex]] spoke.\n"
        files["NPCs/Vex.md"] = VEX
        res = run_scan(files)
        self.assertEqual(res.sources, ["Play Notes", "Wrap-Up", "Recap"])
        self.assertEqual([r.path for r in res.rows], ["NPCs/Vex.md"])

    def test_gm_aliases_as_a_string(self) -> None:
        mill = "---\ntype: location\ngm_aliases: The Widow\n---\n\n# Mill\n"
        res = run_scan({**base(play="At [[Mill]].\n"), "Places/Mill.md": mill},
                       publishing=["Places/Mill.md"])
        self.assertEqual(res.rows[0].hidden, ["gm_aliases: The Widow"])

    def test_a_disguised_npc_shows_its_true_name_and_face(self) -> None:
        pedlar = ("---\ntype: npc\nunmasked_name: \"Captain Rook\"\n"
                  "unmasked_portrait: rook.png\n---\n\n# Pedlar\n")
        res = run_scan({**base(play="Met [[Pedlar]].\n"), "NPCs/Pedlar.md": pedlar},
                       publishing=["NPCs/Pedlar.md"])
        self.assertEqual(res.rows[0].hidden,
                         ["unmasked_name: Captain Rook", "unmasked_portrait: rook.png"])
        plain = "---\ntype: npc\nunmasked_name: \"\"\nunmasked_portrait: \"\"\n---\n\n# Pedlar\n"
        res = run_scan({**base(play="Met [[Pedlar]].\n"), "NPCs/Pedlar.md": plain},
                       publishing=["NPCs/Pedlar.md"])
        self.assertEqual([r.hidden for r in res.rows if r.path == "NPCs/Pedlar.md"], [])

    def test_a_true_name_written_as_a_link_shows_as_the_name(self) -> None:
        """C1: the scan shows the name a link names, and says when it reads none."""
        for value, shown in (('"[[Captain Rook]]"', "unmasked_name: Captain Rook"),
                             ("[[Captain Rook|the captain]]", "unmasked_name: Captain Rook"),
                             ('"[[]]"', "unmasked_name: [[]] (names no one: write the true name)"),
                             ('["[[]]", ""]', "unmasked_name: [[]] (names no one: write the true name)"),
                             ("[[rook.png]]", "unmasked_name: rook.png")):
            pedlar = f"---\ntype: npc\nunmasked_name: {value}\n---\n\n# Pedlar\n"
            res = run_scan({**base(play="Met [[Pedlar]].\n"), "NPCs/Pedlar.md": pedlar},
                           publishing=["NPCs/Pedlar.md"])
            self.assertEqual(res.rows[0].hidden, [shown], value)
        pedlar = "---\ntype: npc\nunmasked_name: Rook\nunmasked_portrait: [[rook.png]]\n---\n\n# Pedlar\n"
        res = run_scan({**base(play="Met [[Pedlar]].\n"), "NPCs/Pedlar.md": pedlar},
                       publishing=["NPCs/Pedlar.md"])
        self.assertEqual(res.rows[0].hidden, ["unmasked_name: Rook", "unmasked_portrait: rook.png"])

    def test_true_name_readers_agree_on_nested_and_suffixed_links(self) -> None:
        """PR #799 review: a quoted link body in a nested list, and a `.md` link, read as the note's name."""
        from vaultlib import unmasked_names
        for value in ([["Captain Rook|the captain"]], [["NPCs/Captain Rook|the captain"]], ["[NPCs/Captain Rook.md]"],
                      "[[NPCs/Captain Rook.md|x]]", "[[Captain Rook#Past]]", '["Captain Rook"]'):
            self.assertEqual(unmasked_names(value), ["Captain Rook"], value)

    def test_cli_no_such_index_exits_2(self) -> None:
        with tempfile.TemporaryDirectory() as tmp, \
                mock.patch.object(rv, "ask_publish_tool", tool()):
            vault = make_vault(tmp, base())
            err = io.StringIO()
            with contextlib.redirect_stderr(err):
                code = rv.main([str(vault), "Session 99"])
        self.assertEqual(code, 2)
        self.assertIn("no session index", err.getvalue())

    def test_published_but_withheld_is_listed(self) -> None:
        res = run_scan({**base(), "NPCs/Vex.md": VEX}, publishing=["NPCs/Vex.md"])
        self.assertEqual(rv.render(res)[1], "NPCs/Vex.md\tpublished withheld\t")

    def test_bare_name_matching_several_indexes_is_an_error(self) -> None:
        other = {"Other/Session 12 - Mill.md": "---\ntype: session\n---\n"}
        with tempfile.TemporaryDirectory() as tmp, \
                mock.patch.object(rv, "ask_publish_tool", tool()):
            vault = make_vault(tmp, {**base(), **other})
            err = io.StringIO()
            with contextlib.redirect_stderr(err):
                code = rv.main([str(vault), "Session 12 - Mill"])
        self.assertEqual(code, 2)
        self.assertIn(INDEX, err.getvalue())
        self.assertIn("Other/Session 12 - Mill.md", err.getvalue())

    def test_no_publish_list_reads_no_notes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp, \
                mock.patch.object(rv, "ask_publish_tool", tool(listed=False)), \
                mock.patch.object(rv, "vault_files", side_effect=AssertionError("read")):
            res = rv.scan(make_vault(tmp, base()), INDEX)
        self.assertFalse(res.listed)

    def test_render_rows(self) -> None:
        res = run_scan({**base(), "NPCs/Vex.md": VEX})
        self.assertEqual(rv.render(res), [
            "reveals: Session 12 - Mill (sources: Play Notes, Wrap-Up)",
            "NPCs/Vex.md\tunpublished withheld\t", "# notes: 1"])


    def test_marks_prop_rows(self) -> None:
        ledger = "---\ntype: prop\nwithheld: true\n---\n\nLedger.\n"
        res = run_scan({**base(play="Met [[Vex]], found [[Ledger]].\n"),
                        "NPCs/Vex.md": VEX, "Handouts/Ledger.md": ledger},
                       props=("Handouts/Ledger.md",))
        self.assertEqual(rv.render(res)[1:3], [
            "NPCs/Vex.md\tunpublished withheld\t",
            "Handouts/Ledger.md\tunpublished withheld prop\t"])

    def test_no_marker_when_explain_fails(self) -> None:
        listed = tool()
        def ask(vault: Path, args: list[str], site_optional: bool = False) -> ToolAnswer:
            if args[:1] == ["explain"]:
                return ToolAnswer(why="explain --all timed out after 60s")
            return listed(vault, args, site_optional)
        ledger = "---\ntype: prop\n---\n\nLedger.\n"
        with tempfile.TemporaryDirectory() as tmp, \
                mock.patch.object(rv, "ask_publish_tool", ask):
            res = rv.scan(make_vault(tmp, {**base(play="[[Ledger]]\n"),
                                           "Handouts/Ledger.md": ledger}), INDEX)
        self.assertEqual(rv.render(res), [
            "reveals: Session 12 - Mill (sources: Play Notes, Wrap-Up)",
            "Handouts/Ledger.md\tunpublished\t",
            "# warning: section titles and prop marks unknown: explain --all timed out after 60s",
            "# notes: 1"])


SPOILED = ("---\ntype: npc\n---\n\n# Ida\n\n"
           "<!-- spoiler -->\nIda is the heir\n<!-- /spoiler -->\n")


class RevealScanAlso(unittest.TestCase):
    """`--also`: notes this run wrote that the session's notes do not link."""

    def test_unlinked_note_listed_only_with_also(self) -> None:
        files = {**base(), "NPCs/Vex.md": VEX, "NPCs/Ida.md": SPOILED}
        pub = ["NPCs/Ida.md"]
        self.assertEqual([r.path for r in run_scan(files, publishing=pub).rows],
                         ["NPCs/Vex.md"])
        res = run_scan(files, also=("NPCs/Ida.md",), publishing=pub)
        self.assertEqual([(r.path, r.hidden) for r in res.rows],
                         [("NPCs/Vex.md", []),
                          ("NPCs/Ida.md", ["spoiler: Ida is the heir"])])

    def test_also_path_forms_and_no_duplicates(self) -> None:
        files = {**base(), "NPCs/Vex.md": VEX, "NPCs/Ida.md": SPOILED}
        res = run_scan(files, also=("./NPCs/Ida", "NPCs/Vex.md", "NPCs\\Ida.md"))
        self.assertEqual([r.path for r in res.rows], ["NPCs/Vex.md", "NPCs/Ida.md"])

    def test_also_skips_structural_notes(self) -> None:
        files = {**base(play="Nothing.\n"), f"{SESS}/Hall Scene.md": "---\ntype: scene\n---\n"}
        res = run_scan(files, also=(f"{SESS}/Hall Scene.md", PLAN, INDEX))
        self.assertEqual(res.rows, [])

    def test_also_unknown_path_is_a_warning(self) -> None:
        res = run_scan(base(play="Nothing.\n"), also=("NPCs/Nobody.md",))
        self.assertEqual(rv.render(res), [
            "reveals: Session 12 - Mill (sources: Play Notes, Wrap-Up)",
            "# warning: --also NPCs/Nobody.md: no such note",
            "# notes: 0"])

    def test_also_finds_a_decomposed_file_name(self) -> None:
        nfd = unicodedata.normalize("NFD", "NPCs/Zoë.md")
        files = {**base(play="Nothing.\n"), nfd: SPOILED}
        res = run_scan(files, also=(unicodedata.normalize("NFC", "NPCs/Zoë.md"),))
        self.assertEqual(res.warnings, [])
        self.assertEqual(len(res.rows), 1)

    def test_cli_also_repeats(self) -> None:
        files = {**base(play="Nothing.\n"), "NPCs/Vex.md": VEX, "NPCs/Ida.md": SPOILED}
        with tempfile.TemporaryDirectory() as tmp, \
                mock.patch.object(rv, "ask_publish_tool", tool()):
            vault = make_vault(tmp, files)
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                code = rv.main([str(vault), INDEX, "--also", "NPCs/Vex.md",
                                "--also", "NPCs/Ida.md"])
        self.assertEqual(code, 0)
        self.assertEqual(out.getvalue().splitlines()[1:3], [
            "NPCs/Vex.md\tunpublished withheld\t",
            "NPCs/Ida.md\tunpublished\tspoiler: Ida is the heir"])


TLOG = f"{SESS}/Session 12 - Mill - Table Log.md"


def with_log(body: str) -> dict[str, str]:
    files = base(play="Nothing.\n")
    files[INDEX] = files[INDEX].replace(
        "documents:\n", "documents:\n  table_log: \"[[Session 12 - Mill - Table Log]]\"\n")
    files[TLOG] = ("---\ntype: session-table-log\n---\n\n# Table Log\n\n"
                   + body.replace("\r\n", "\n"))
    return files


class TableLogSections(unittest.TestCase):
    """Only the Table Log sections that record what the players got count."""

    def test_not_reached_link_gives_no_row(self) -> None:
        res = run_scan({**with_log("## Not reached\n\n- [[Vex]] in the vault\n"),
                        "NPCs/Vex.md": VEX})
        self.assertEqual(res.sources, ["Play Notes", "Wrap-Up", "Table Log"])
        self.assertEqual(res.rows, [])

    def test_indented_heading_ends_the_section(self) -> None:
        body = ("## Points landed\n\n- [[Ida]]\n\n"
                " ## Not reached\n\n- [[Vex]] in the vault\n")
        res = run_scan({**with_log(body), "NPCs/Vex.md": VEX, "NPCs/Ida.md": VEX.replace("# Vex", "# Ida")})
        self.assertEqual([r.path for r in res.rows], ["NPCs/Ida.md"])

    def test_vitals_only_link_gives_no_row(self) -> None:
        body = ("## Vitals at the end\n\n| Who | HP | Conditions |\n"
                "| --- | --- | --- |\n| [[Vex]] | 3/12 | |\n")
        res = run_scan({**with_log(body), "NPCs/Vex.md": VEX})
        self.assertEqual(res.rows, [])

    def test_unread_sections_give_no_rows(self) -> None:
        body = "".join(f"## {name}\n\n- [[Vex]]\n\n" for name in (
            "Stopped in", "Tried and missed", "Overtaken", "Reached but not landed",
            "Not reached", "Changed since play started", "Contingencies that fired",
            "Log", "Advancement"))
        res = run_scan({**with_log(body), "NPCs/Vex.md": VEX})
        self.assertEqual(res.rows, [])

    def test_handout_handed_over_gives_a_row(self) -> None:
        res = run_scan({**with_log("## Not reached\n\n- x\n\n"
                                   "## handouts handed over\n\n- [[Vex]]\n"),
                        "NPCs/Vex.md": VEX})
        self.assertEqual([r.path for r in res.rows], ["NPCs/Vex.md"])

    def test_unpublished_place_under_improvised_beats_is_offered(self) -> None:
        # the run sheet links a known place the players were at tonight (moved there, or a fight there) under
        # Improvised beats (plan 6a Task 7 fix round 1, Ant's ruling): wrap-up must offer it for publishing
        cellar = "---\ntype: location\npublish: false\n---\n\n# Secret Cellar\n"
        body = ("## Where everyone ended\n\n- [[Ada]]: The Docks\n\n"
                "## Improvised beats\n\n- New place: The Docks\n- [[Secret Cellar]]\n")
        res = run_scan({**with_log(body), "Locations/Secret Cellar.md": cellar})
        self.assertEqual([(r.path, r.published) for r in res.rows], [("Locations/Secret Cellar.md", False)])
        # a typed place is plain words: it names no note, so it gives no row
        self.assertNotIn("The Docks", [r.path for r in res.rows])

    def test_every_read_section_gives_a_row(self) -> None:
        for name in rv.TABLE_LOG_READ:
            with self.subTest(name=name):
                res = run_scan({**with_log(f"## {name}\n\n- [[Vex]]\n"),
                                "NPCs/Vex.md": VEX})
                self.assertEqual([r.path for r in res.rows], ["NPCs/Vex.md"])


if __name__ == "__main__":
    unittest.main()
