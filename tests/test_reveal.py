#!/usr/bin/env python3
"""reveal.py: publish what the GM says came out, lift withheld, log it.

Run: python3 tests/test_reveal.py
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import reveal  # noqa: E402
from vault_check import ToolAnswer  # noqa: E402

VEX = "NPCs/Vex.md"
SESSION = "Chapters/Chapter 1/Sessions/Session 12 - Mill.md"
LEDGER = "Handouts/Ledger.md"
PELL = "NPCs/Pell.md"
LETTER = "Handouts/Letter.md"
S05 = "Session 05 - Beneath the Mill"


def make(root: Path, extra: dict[str, str] | None = None) -> None:
    files = {
        VEX: "---\ntype: npc\nwithheld: true\n---\n\nVex.\n",
        "Places/Mill.md": "---\ntype: location\n---\n\nMill.\n",
        SESSION: "---\ntype: session\n---\n\nIndex.\n",
        "Scenes/Hook.md": "---\ntype: scene\n---\n\nHook.\n",
        **(extra or {}),
    }
    for rel, text in files.items():
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")


def explain_answer(props: tuple[str, ...] = (), others: tuple[str, ...] = ()) -> ToolAnswer:
    pages = [{"path": p, "prop": True, "strippedSections": []} for p in props] + \
        [{"path": p, "prop": False, "strippedSections": []} for p in others]
    return ToolAnswer(data={"pages": pages})


def run(root: Path, *args: str, applied: tuple[list[str], str | None] | None = None,
        site: bool = True, state: tuple[set[str] | None, str | None] = (set(), None),
        explain: ToolAnswer | None = None, session: str = "Session 12",
        asked: list[list[str]] | None = None) -> tuple[int, str, mock.Mock]:
    buf = io.StringIO()
    config = (Path("/site/vault.config.json"), None) if site else (None, None)

    def fake(_vault: Path, paths: list[str], _before: object = None) -> tuple[list[str], str | None]:
        return (list(paths), None) if applied is None else applied

    def ask(_vault: Path, tool_args: list[str], site_optional: bool = False) -> ToolAnswer:
        if asked is not None:
            asked.append(tool_args)
        if tool_args != ["explain", "--all"]:
            raise AssertionError(f"unexpected publish tool call {tool_args}")
        return explain or explain_answer()

    with mock.patch.object(reveal, "_site_config", return_value=config), \
            mock.patch.object(reveal, "publish_state", return_value=state), \
            mock.patch.object(reveal, "apply_publish", side_effect=fake) as ap, \
            mock.patch.object(reveal, "ask_publish_tool", side_effect=ask), \
            contextlib.redirect_stdout(buf):
        code = reveal.main([str(root), "--session", session, *args])
    return code, buf.getvalue(), ap


def log_of(root: Path) -> dict:
    return json.loads((root / "_meta" / "reveals.json").read_text(encoding="utf-8"))


class RevealTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)
        make(self.root)

    def test_dry_run_writes_nothing(self) -> None:
        code, out, ap = run(self.root, "--publish", VEX, "--released", "Places/Mill.md=the wheel")
        self.assertEqual(code, 0)
        for verb in ("WOULD-PUBLISH", "WOULD-CLEAR", "WOULD-LOG"):
            self.assertIn(verb, out)
        ap.assert_not_called()
        self.assertIn("withheld: true", (self.root / VEX).read_text(encoding="utf-8"))
        self.assertFalse((self.root / "_meta" / "reveals.json").exists())

    def test_write_publishes_clears_and_logs(self) -> None:
        code, out, ap = run(self.root, "--publish", VEX, "--released",
                            "Places/Mill.md=the wheel", "--write")
        self.assertEqual(code, 0, out)
        ap.assert_called_once()
        self.assertEqual(ap.call_args.args[1], [VEX])
        self.assertIn("withheld: false", (self.root / VEX).read_text(encoding="utf-8"))
        self.assertIn("# publish: 1 clear: 1 stamp: 0 unmask: 0 log: 1 errors: 0", out)
        entries = log_of(self.root)["entries"]
        self.assertTrue(entries[0]["before_tracking"])
        self.assertEqual(entries[1]["session"], "Session 12")
        self.assertEqual(entries[1]["published"], [VEX])
        self.assertEqual(entries[1]["released"],
                         [{"page": "Places/Mill.md", "what": "the wheel"}])

    def test_absent_withheld_key_is_left_alone(self) -> None:
        code, _, _ = run(self.root, "--publish", "Places/Mill.md", "--write")
        self.assertEqual(code, 0)
        self.assertNotIn("withheld", (self.root / "Places/Mill.md").read_text(encoding="utf-8"))

    def test_apply_failure_leaves_withheld(self) -> None:
        code, out, _ = run(self.root, "--publish", VEX, "--write",
                           applied=([], "settings fault"))
        self.assertEqual(code, 1)
        self.assertIn("ERROR", out)
        self.assertIn("settings fault", out)
        self.assertIn("withheld: true", (self.root / VEX).read_text(encoding="utf-8"))
        self.assertFalse((self.root / "_meta" / "reveals.json").exists())

    def test_same_session_merges(self) -> None:
        run(self.root, "--publish", VEX, "--released", "Places/Mill.md=the wheel", "--write")
        run(self.root, "--publish", VEX, "--publish", "Places/Mill.md",
            "--released", "Places/Mill.md=the wheel", "--write")
        entries = log_of(self.root)["entries"]
        self.assertEqual(sum(1 for e in entries if e.get("before_tracking")), 1)
        mine = [e for e in entries if e.get("session") == "Session 12"]
        self.assertEqual(len(mine), 1)
        self.assertEqual(mine[0]["published"], ["NPCs/Vex.md", "Places/Mill.md"])
        self.assertEqual(len(mine[0]["released"]), 1)

    def test_no_site_config_refuses_publish(self) -> None:
        code, out, ap = run(self.root, "--publish", VEX, "--released",
                            "Places/Mill.md=the wheel", "--write", site=False)
        self.assertEqual(code, 1)
        self.assertIn("no site to publish through", out)
        ap.assert_not_called()
        self.assertIn("withheld: true", (self.root / VEX).read_text(encoding="utf-8"))
        entry = log_of(self.root)["entries"][-1]
        self.assertEqual(entry["published"], [])
        self.assertEqual(len(entry["released"]), 1)

    def test_released_only_logs(self) -> None:
        code, out, ap = run(self.root, "--released", "Places/Mill.md=the wheel", "--write")
        self.assertEqual(code, 0)
        ap.assert_not_called()
        self.assertIn("LOGGED", out)

    def test_refuses_meta_and_prep_paths(self) -> None:
        (self.root / "_meta").mkdir()
        (self.root / "_meta" / "x.md").write_text("---\n---\n", encoding="utf-8")
        for rel in ("_meta/x.md", "Scenes/Hook.md", SESSION):
            code, out, ap = run(self.root, "--publish", rel, "--write")
            self.assertEqual(code, 1, rel)
            self.assertIn("ERROR", out)
            ap.assert_not_called()

    def test_bad_args_exit_2(self) -> None:
        code, _, _ = run(self.root, "--released", "no equals sign")
        self.assertEqual(code, 2)

    def test_dry_run_warns_when_no_publish_list(self) -> None:
        code, out, ap = run(self.root, "--publish", VEX,
                            state=(None, "the vault has no publish list; set one up first"))
        self.assertEqual(code, 1)
        self.assertNotIn("WOULD-PUBLISH", out)
        self.assertIn("no publish list", out)
        ap.assert_not_called()

    def test_already_published_is_skipped_not_logged(self) -> None:
        code, out, ap = run(self.root, "--publish", "Places/Mill.md", "--publish", VEX,
                            "--write", state=({"Places/Mill.md"}, None))
        self.assertEqual(code, 0, out)
        self.assertEqual(ap.call_args.args[1], [VEX])
        self.assertIn("SKIP\tPlaces/Mill.md\talready published; not logged for this session", out)
        self.assertEqual(log_of(self.root)["entries"][-1]["published"], [VEX])

    def test_withheld_note_already_listed_is_revealed(self) -> None:
        # Listed but withheld, the site showed nothing of it: lifting withheld is this
        # session's reveal, so it is logged and its row says so.
        code, out, ap = run(self.root, "--publish", VEX, "--publish", "Places/Mill.md",
                            "--write", state=({VEX}, None))
        self.assertEqual(code, 0, out)
        self.assertEqual(ap.call_args.args[1], ["Places/Mill.md"])
        self.assertNotIn(f"SKIP\t{VEX}", out)
        self.assertIn(f"PUBLISHED\t{VEX}\talready on the publish list; withheld lifted", out)
        self.assertIn(f"CLEARED\t{VEX}\twithheld: false", out)
        self.assertIn("withheld: false", (self.root / VEX).read_text(encoding="utf-8"))
        self.assertEqual(log_of(self.root)["entries"][-1]["published"], [VEX, "Places/Mill.md"])
        self.assertIn("# publish: 2 clear: 1 stamp: 0 unmask: 0 log: 1 errors: 0", out)

    def test_withheld_note_already_listed_dry_run(self) -> None:
        before = (self.root / VEX).read_bytes()
        code, out, ap = run(self.root, "--publish", VEX, state=({VEX}, None))
        self.assertEqual(code, 0, out)
        ap.assert_not_called()
        self.assertEqual((self.root / VEX).read_bytes(), before)
        self.assertIn(f"WOULD-PUBLISH\t{VEX}\talready on the publish list; withheld lifted", out)
        self.assertIn(f"WOULD-LOG\t_meta/reveals.json\tSession 12: 1 published", out)

    def test_tool_leaves_one_out(self) -> None:
        code, out, _ = run(self.root, "--publish", VEX, "--publish", "Places/Mill.md",
                           "--write", applied=(["Places/Mill.md"], None))
        self.assertEqual(code, 1)
        self.assertIn(f"ERROR\t{VEX}\tthe publish tool does not list it", out)
        self.assertIn("withheld: true", (self.root / VEX).read_text(encoding="utf-8"))
        self.assertEqual(log_of(self.root)["entries"][-1]["published"], ["Places/Mill.md"])

    def test_failed_batch_has_one_error_row_per_path(self) -> None:
        code, out, _ = run(self.root, "--publish", VEX, "--publish", "Places/Mill.md",
                           "--write", applied=([], "no such file: X"))
        self.assertEqual(code, 1)
        errors = [ln for ln in out.splitlines() if ln.startswith("ERROR\t")]
        self.assertEqual([ln.split("\t")[1] for ln in errors], [VEX, "Places/Mill.md"])

    def test_malformed_frontmatter_reports_clear_failure(self) -> None:
        (self.root / VEX).write_text("---\ntype: npc\nwithheld: true\n--- \nbody\n",
                                     encoding="utf-8")
        code, out, _ = run(self.root, "--publish", VEX, "--write")
        self.assertEqual(code, 1)
        self.assertIn(f"ERROR\t{VEX}\tnot published, nothing changed: withheld not cleared", out)

    def test_unclearable_path_is_not_published(self) -> None:
        (self.root / VEX).write_text("---\ntype: npc\nwithheld: true\n--- \nbody\n",
                                     encoding="utf-8")
        code, out, ap = run(self.root, "--publish", VEX, "--publish", "Places/Mill.md", "--write")
        self.assertEqual(code, 1)
        self.assertEqual(ap.call_args.args[1], ["Places/Mill.md"])
        self.assertIn(f"ERROR\t{VEX}\tnot published", out)
        self.assertNotIn(f"PUBLISHED\t{VEX}", out)
        self.assertEqual(log_of(self.root)["entries"][-1]["published"], ["Places/Mill.md"])

    def test_write_failure_is_an_error_row_not_a_traceback(self) -> None:
        real = Path.write_text

        def boom(self_: Path, *a: object, **kw: object) -> int:
            if self_.name == "Vex.md":
                raise PermissionError("read-only")
            return real(self_, *a, **kw)  # type: ignore[arg-type]

        with mock.patch.object(Path, "write_text", boom):
            code, out, _ = run(self.root, "--publish", VEX, "--write")
        self.assertEqual(code, 1)
        self.assertIn(f"ERROR\t{VEX}\twithheld not cleared", out)
        self.assertIn("# publish: 1 clear: 0 stamp: 0 unmask: 0 log: 1 errors: 1", out)
        self.assertEqual(log_of(self.root)["entries"][-1]["published"], [VEX])

    def test_other_spellings_of_the_key_are_cleared(self) -> None:
        for spelled in ('withheld:    True', 'withheld:true'):
            (self.root / VEX).write_text(f"---\ntype: npc\n{spelled}\n---\n\nVex.\n",
                                         encoding="utf-8")
            code, out, _ = run(self.root, "--publish", VEX, "--write")
            self.assertEqual(code, 0, out)
            text = (self.root / VEX).read_text(encoding="utf-8")
            self.assertEqual(text, "---\ntype: npc\nwithheld: false\n---\n\nVex.\n", spelled)

    def test_crlf_note_keeps_crlf(self) -> None:
        (self.root / VEX).write_bytes(b"---\r\ntype: npc\r\nwithheld: true\r\n---\r\n\r\nVex.\r\n")
        code, out, _ = run(self.root, "--publish", VEX, "--write")
        self.assertEqual(code, 0, out)
        self.assertEqual((self.root / VEX).read_bytes(),
                         b"---\r\ntype: npc\r\nwithheld: false\r\n---\r\n\r\nVex.\r\n")

    def test_spelling_the_helpers_refuse_is_not_published(self) -> None:
        for spelled in ("withheld : true", '"withheld": true'):
            (self.root / VEX).write_text(f"---\ntype: npc\n{spelled}\n---\n\nVex.\n",
                                         encoding="utf-8")
            code, out, ap = run(self.root, "--publish", VEX, "--write")
            self.assertEqual(code, 1)
            ap.assert_not_called()
            self.assertIn("withheld not cleared", out)

    def test_publish_state_asked_once_per_run(self) -> None:
        with mock.patch.object(reveal, "ask_publish_tool") as ask, \
                mock.patch.object(reveal, "_site_config",
                                  return_value=(Path("/site/vault.config.json"), None)):
            ask.side_effect = [
                ToolAnswer(data={"listed": True, "publishing": []}),
                explain_answer(),
                ToolAnswer(data={}),
                ToolAnswer(data={"listed": True, "publishing": [VEX]})]
            reveal.run(self.root, "Session 12", [VEX], [], True)
        lists = [c for c in ask.call_args_list if c.args[1] == ["manifest", "list"]]
        self.assertEqual(len(lists), 2)     # before and after apply, no third

    def test_hand_edited_log_entry_does_not_crash(self) -> None:
        (self.root / "_meta").mkdir()
        (self.root / "_meta" / "reveals.json").write_text(json.dumps({"entries": [
            {"session": "Session 12", "date": "2026-01-01", "published": [],
             "released": [{"page": "Places/Mill.md"}, "junk",
                          {"page": "A.md", "what": "x"}]}]}), encoding="utf-8")
        code, out, _ = run(self.root, "--released", "Places/Mill.md=the wheel", "--write")
        self.assertEqual(code, 0, out)
        released = log_of(self.root)["entries"][0]["released"]
        self.assertIn({"page": "Places/Mill.md", "what": "the wheel"}, released)
        self.assertIn({"page": "A.md", "what": "x"}, released)
        self.assertIn("junk", released)


    # revealed_in: the session a prop reached the players (Review Focus 1).

    def _props(self) -> None:
        make(self.root, {
            LEDGER: "---\ntype: prop\nwithheld: true\n---\n\nLedger.\n",
            PELL: "---\ntype: npc\n---\n\nPell.\n",
            LETTER: "---\ntype: prop\n---\n\nLetter.\n",
        })

    def test_stamps_only_newly_published_props(self) -> None:
        self._props()
        asked: list[list[str]] = []
        code, out, ap = run(self.root, "--publish", LEDGER, "--publish", PELL,
                            "--publish", LETTER, "--write", session=S05,
                            state=({LETTER}, None), asked=asked,
                            explain=explain_answer((LEDGER, LETTER), (PELL,)))
        self.assertEqual(code, 0, out)
        self.assertEqual(asked, [["explain", "--all"]])
        self.assertEqual(ap.call_args.args[1], [LEDGER, PELL])
        ledger = (self.root / LEDGER).read_text(encoding="utf-8")
        self.assertIn(f'revealed_in: "[[{S05}]]"', ledger)
        self.assertIn("withheld: false", ledger)
        self.assertNotIn("revealed_in", (self.root / PELL).read_text(encoding="utf-8"))
        self.assertNotIn("revealed_in", (self.root / LETTER).read_text(encoding="utf-8"))
        self.assertIn(f"STAMPED\t{LEDGER}\trevealed_in: [[{S05}]]", out)
        self.assertNotIn(f"STAMPED\t{LETTER}", out)
        self.assertNotIn(f"STAMPED\t{PELL}", out)

    def test_prop_the_tool_does_not_list_is_not_stamped(self) -> None:
        self._props()
        code, out, _ = run(self.root, "--publish", LEDGER, "--publish", LETTER, "--write",
                           applied=([LETTER], None),
                           explain=explain_answer((LEDGER, LETTER)))
        self.assertEqual(code, 1)
        self.assertNotIn("revealed_in", (self.root / LEDGER).read_text(encoding="utf-8"))
        self.assertIn('revealed_in: "[[Session 12]]"',
                      (self.root / LETTER).read_text(encoding="utf-8"))

    def test_never_overwrites_revealed_in(self) -> None:
        self._props()
        for value in ('"[[Session 02]]"', '[[Session 02]]', '\n  - "[[Session 02]]"'):
            text = f"---\ntype: prop\nrevealed_in: {value}\nwithheld: true\n---\n\nL.\n"
            text = text.replace("revealed_in: \n", "revealed_in:\n")
            (self.root / LEDGER).write_text(text, encoding="utf-8")
            code, out, _ = run(self.root, "--publish", LEDGER, "--write",
                               explain=explain_answer((LEDGER,)))
            self.assertEqual(code, 0, out)
            after = (self.root / LEDGER).read_text(encoding="utf-8")
            self.assertEqual(after, text.replace("withheld: true", "withheld: false"), value)
            self.assertIn(f"SKIP\t{LEDGER}\trevealed_in already set", out)
            self.assertNotIn("STAMPED", out)
            self.assertIn("stamp: 0", out)

    def test_empty_revealed_in_is_filled(self) -> None:
        self._props()
        for value in ('""', "[]", '"" # written at wrap-up'):
            (self.root / LEDGER).write_text(
                f"---\ntype: prop\nrevealed_in: {value}\n---\n\nL.\n", encoding="utf-8")
            code, out, _ = run(self.root, "--publish", LEDGER, "--write",
                               explain=explain_answer((LEDGER,)))
            self.assertEqual(code, 0, out)
            self.assertEqual((self.root / LEDGER).read_text(encoding="utf-8"),
                             '---\ntype: prop\nrevealed_in: "[[Session 12]]"\n---\n\nL.\n',
                             value)

    def test_failed_publish_stamps_nothing(self) -> None:
        self._props()
        before = (self.root / LEDGER).read_text(encoding="utf-8")
        code, out, _ = run(self.root, "--publish", LEDGER, "--write",
                           applied=([], "why"), explain=explain_answer((LEDGER,)))
        self.assertEqual(code, 1)
        self.assertEqual((self.root / LEDGER).read_text(encoding="utf-8"), before)
        self.assertNotIn("STAMPED", out)
        self.assertNotIn("CLEARED", out)

    def test_explain_failure_warns_and_publishes(self) -> None:
        self._props()
        code, out, ap = run(self.root, "--publish", LEDGER, "--write",
                            explain=ToolAnswer(why="explain --all timed out after 60s"))
        self.assertEqual(code, 0, out)
        ap.assert_called_once()
        self.assertIn("WARNING\t-\trevealed_in not written: explain --all timed out after 60s",
                      out)
        text = (self.root / LEDGER).read_text(encoding="utf-8")
        self.assertIn("withheld: false", text)
        self.assertNotIn("revealed_in", text)
        self.assertIn("# publish: 1 clear: 1 stamp: 0 unmask: 0 log: 1 errors: 0", out)

    def test_explain_answer_not_understood_warns(self) -> None:
        self._props()
        code, out, _ = run(self.root, "--publish", LEDGER, "--write",
                           explain=ToolAnswer(data={"pages": "nope"}))
        self.assertEqual(code, 0, out)
        self.assertIn("WARNING\t-\trevealed_in not written: ", out)
        self.assertNotIn("revealed_in", (self.root / LEDGER).read_text(encoding="utf-8"))

    def test_stamp_and_clear_one_write_crlf(self) -> None:
        self._props()
        (self.root / LEDGER).write_bytes(b"---\r\ntype: prop\r\nwithheld: true\r\n---\r\n\r\nL.\r\n")
        real = Path.write_text
        writes: list[str] = []

        def counted(self_: Path, *a: object, **kw: object) -> int:
            if self_.name == "Ledger.md":
                writes.append(self_.name)
            return real(self_, *a, **kw)  # type: ignore[arg-type]

        with mock.patch.object(Path, "write_text", counted):
            code, out, _ = run(self.root, "--publish", LEDGER, "--write",
                               explain=explain_answer((LEDGER,)))
        self.assertEqual(code, 0, out)
        self.assertEqual(writes, ["Ledger.md"])
        self.assertEqual((self.root / LEDGER).read_bytes(),
                         b'---\r\ntype: prop\r\nwithheld: false\r\n'
                         b'revealed_in: "[[Session 12]]"\r\n---\r\n\r\nL.\r\n')
        self.assertIn("CLEARED", out)
        self.assertIn("STAMPED", out)

    def test_dry_run_would_stamp(self) -> None:
        self._props()
        before = {r: (self.root / r).read_bytes() for r in (LEDGER, PELL)}
        code, out, ap = run(self.root, "--publish", LEDGER, "--publish", PELL,
                            explain=explain_answer((LEDGER,), (PELL,)))
        self.assertEqual(code, 0, out)
        ap.assert_not_called()
        self.assertEqual({r: (self.root / r).read_bytes() for r in (LEDGER, PELL)}, before)
        self.assertIn(f"WOULD-STAMP\t{LEDGER}\trevealed_in: [[Session 12]] if it publishes", out)
        self.assertNotIn(f"WOULD-STAMP\t{PELL}", out)

    def test_dry_run_does_not_offer_stamp_on_already_published(self) -> None:
        self._props()
        _, out, _ = run(self.root, "--publish", LETTER, state=({LETTER}, None),
                        explain=explain_answer((LETTER,)))
        self.assertNotIn("WOULD-STAMP", out)

    def test_listed_prop_not_withheld_stays_skipped_and_unstamped(self) -> None:
        self._props()
        before = (self.root / LETTER).read_bytes()
        code, out, ap = run(self.root, "--publish", LETTER, "--write", state=({LETTER}, None),
                            explain=explain_answer((LETTER,)))
        self.assertEqual(code, 0, out)
        self.assertEqual((self.root / LETTER).read_bytes(), before)
        self.assertIn(f"SKIP\t{LETTER}\talready published; not logged for this session", out)
        self.assertIn("# publish: 0 clear: 0 stamp: 0 unmask: 0 log: 0 errors: 0", out)

    def test_listed_withheld_prop_is_lifted_stamped_and_logged(self) -> None:
        self._props()
        code, out, ap = run(self.root, "--publish", LEDGER, "--write", session=S05,
                            state=({LEDGER}, None), explain=explain_answer((LEDGER,)))
        self.assertEqual(code, 0, out)
        ap.assert_not_called()
        text = (self.root / LEDGER).read_text(encoding="utf-8")
        self.assertIn("withheld: false", text)
        self.assertIn(f'revealed_in: "[[{S05}]]"', text)
        self.assertIn(f"PUBLISHED\t{LEDGER}\talready on the publish list; withheld lifted", out)
        self.assertIn(f"STAMPED\t{LEDGER}\trevealed_in: [[{S05}]]", out)
        self.assertEqual(log_of(self.root)["entries"][-1]["published"], [LEDGER])
        self.assertIn("# publish: 1 clear: 1 stamp: 1 unmask: 0 log: 1 errors: 0", out)

    def test_unstampable_frontmatter_refuses_the_path(self) -> None:
        self._props()
        (self.root / LEDGER).write_text("---\ntype: prop\n--- \nL.\n", encoding="utf-8")
        code, out, ap = run(self.root, "--publish", LEDGER, "--publish", PELL, "--write",
                            explain=explain_answer((LEDGER,)))
        self.assertEqual(code, 1)
        self.assertEqual(ap.call_args.args[1], [PELL])
        self.assertIn(f"ERROR\t{LEDGER}\tnot published, nothing changed", out)

    # The shape `explain --all --json` gives for notes in a folder the site does not show
    # (gm-publish 1.51.0 on a scratch vault): no page, so strippedSections is null, and
    # prop read from the note's own frontmatter.
    def _unmapped(self) -> ToolAnswer:
        return ToolAnswer(data={"pages": [
            {"path": LEDGER, "code": "DIR_UNMAPPED", "strippedSections": None, "prop": True,
             "publishes": False},
            {"path": PELL, "code": "DIR_UNMAPPED", "strippedSections": None, "prop": False,
             "publishes": False},
            {"path": LETTER, "code": "DIR_UNMAPPED", "strippedSections": None, "prop": True,
             "publishes": False}]})

    def test_unmapped_prop_is_stamped_and_warned(self) -> None:
        self._props()
        code, out, ap = run(self.root, "--publish", LEDGER, "--publish", PELL,
                            "--publish", LETTER, "--write", state=({LETTER}, None),
                            explain=self._unmapped())
        self.assertEqual(code, 0, out)
        self.assertEqual(ap.call_args.args[1], [LEDGER, PELL])
        self.assertIn(f"WARNING\t{LEDGER}\tthe site does not show "
                      "notes in Handouts, so it has no page (add the folder to "
                      "player_site.folder_map); revealed_in: [[Session 12]] is written "
                      "all the same", out)
        self.assertIn(f"WARNING\t{PELL}\tthe site does not show "
                      "notes in NPCs, so it has no page (add the folder to "
                      "player_site.folder_map)\n", out)
        warned = [ln.split("\t")[1] for ln in out.splitlines() if ln.startswith("WARNING")]
        self.assertEqual(warned, [LEDGER, PELL])    # not Letter: already published
        ledger = (self.root / LEDGER).read_text(encoding="utf-8")
        self.assertIn('revealed_in: "[[Session 12]]"', ledger)
        self.assertIn("withheld: false", ledger)
        self.assertNotIn("revealed_in", (self.root / PELL).read_text(encoding="utf-8"))
        self.assertNotIn("revealed_in", (self.root / LETTER).read_text(encoding="utf-8"))
        self.assertIn("# publish: 2 clear: 1 stamp: 1 unmask: 0 log: 1 errors: 0", out)

    def test_unmapped_prop_dry_run_says_it_would_be_stamped(self) -> None:
        self._props()
        code, out, _ = run(self.root, "--publish", LEDGER, explain=self._unmapped())
        self.assertEqual(code, 0, out)
        self.assertIn("player_site.folder_map); revealed_in: [[Session 12]] would be "
                      "written all the same", out)
        self.assertIn(f"WOULD-STAMP\t{LEDGER}", out)
        self.assertNotIn("revealed_in", (self.root / LEDGER).read_text(encoding="utf-8"))

    def test_other_no_page_code_is_neutral(self) -> None:
        self._props()
        explain = ToolAnswer(data={"pages": [
            {"path": PELL, "prop": False, "code": "SOMETHING_ELSE", "strippedSections": None}]})
        code, out, _ = run(self.root, "--publish", PELL, explain=explain)
        self.assertEqual(code, 0, out)
        self.assertIn(f"WARNING\t{PELL}\tthe site makes no page "
                      "for it (SOMETHING_ELSE)", out)
        self.assertNotIn("revealed_in not written", out)

    def _never_vault(self, value: str, withheld: bool = False) -> None:
        self._props()
        (self.root / LEDGER).write_text(
            f"---\ntype: handout\npublish: {value}\n"
            + ("withheld: true\n" if withheld else "") + "---\n\nL.\n", encoding="utf-8")

    def test_publish_false_or_none_note_is_refused_before_any_tool_call(self) -> None:
        for value in ("false", "none", "False", "[false]"):
            for listed in (False, True):
                with self.subTest(value=value, listed=listed):
                    self._never_vault(value, withheld=listed)
                    before = (self.root / LEDGER).read_bytes()
                    asked: list[list[str]] = []
                    code, out, ap = run(self.root, "--publish", LEDGER, "--write",
                                        "--released", f"{LEDGER}=the ledger",
                                        state=({LEDGER} if listed else set(), None),
                                        asked=asked)
                    self.assertEqual(code, 1, out)
                    ap.assert_not_called()
                    self.assertEqual((self.root / LEDGER).read_bytes(), before)
                    rows = [ln for ln in out.splitlines() if ln.startswith(("ERROR", "WARNING"))]
                    self.assertEqual(len(rows), 1, out)
                    self.assertTrue(rows[0].startswith(f"ERROR\t{LEDGER}\t"), out)
                    self.assertIn(f"publish: {'none' if value == 'none' else 'false'}", rows[0])
                    self.assertNotIn("PUBLISHED", out)
                    self.assertNotIn("LOGGED", out)
                    self.assertFalse((self.root / "_meta" / "reveals.json").exists())

    def test_released_item_for_a_refused_note_is_dropped_whatever_its_spelling(self) -> None:
        self._never_vault("false")
        code, out, _ = run(self.root, "--publish", "Handouts/../" + LEDGER, "--write",
                           "--released", f"./{LEDGER}=the ledger",
                           state=(set(), None), asked=[])
        self.assertEqual(code, 1, out)
        self.assertNotIn("LOGGED", out)
        self.assertFalse((self.root / "_meta" / "reveals.json").exists())

    def test_publish_false_refused_when_explain_fails_too(self) -> None:
        self._never_vault("false")
        broken = ToolAnswer(why="the publish tool did not answer")
        code, out, ap = run(self.root, "--publish", LEDGER, "--write", explain=broken)
        self.assertEqual(code, 1, out)
        ap.assert_not_called()
        self.assertEqual(sum(ln.startswith(("ERROR", "WARNING")) for ln in out.splitlines()), 1)

    def test_publish_false_beside_a_fine_note_only_refuses_the_one(self) -> None:
        self._never_vault("false")
        code, out, ap = run(self.root, "--publish", LEDGER, "--publish", PELL, "--write")
        self.assertEqual(code, 1, out)
        self.assertEqual(ap.call_args.args[1], [PELL])
        self.assertEqual(log_of(self.root)["entries"][-1]["published"], [PELL])

    def test_session_with_quote_and_backslash_stays_valid(self) -> None:
        self._props()
        odd = 'Session "5" \\ x'
        code, out, _ = run(self.root, "--publish", LEDGER, "--write", session=odd,
                           explain=explain_answer((LEDGER,)))
        self.assertEqual(code, 0, out)
        line = next(ln for ln in (self.root / LEDGER).read_text(encoding="utf-8").splitlines()
                    if ln.startswith("revealed_in:"))
        self.assertEqual(line, 'revealed_in: "[[Session \\"5\\" \\\\ x]]"')
        # A JSON string is a valid YAML double-quoted scalar.
        self.assertEqual(json.loads(line.split(":", 1)[1]), f"[[{odd}]]")

    def test_null_revealed_in_is_filled(self) -> None:
        self._props()
        for value in ("null", "~", "Null", "NULL"):
            (self.root / LEDGER).write_text(
                f"---\ntype: prop\nrevealed_in: {value}\n---\n\nL.\n", encoding="utf-8")
            code, out, _ = run(self.root, "--publish", LEDGER, "--write",
                               explain=explain_answer((LEDGER,)))
            self.assertEqual(code, 0, out)
            self.assertNotIn("already set", out)
            self.assertEqual((self.root / LEDGER).read_text(encoding="utf-8"),
                             '---\ntype: prop\nrevealed_in: "[[Session 12]]"\n---\n\nL.\n',
                             value)

    def test_prop_with_no_frontmatter_is_not_called_already_set(self) -> None:
        self._props()
        (self.root / LEDGER).write_text("Ledger, no frontmatter.\n", encoding="utf-8")
        code, out, _ = run(self.root, "--publish", LEDGER, "--write",
                           explain=explain_answer((LEDGER,)))
        self.assertEqual(code, 0, out)
        self.assertNotIn("already set", out)
        self.assertIn(f"SKIP\t{LEDGER}\trevealed_in not written: the note has no frontmatter",
                      out)
        self.assertEqual((self.root / LEDGER).read_text(encoding="utf-8"),
                         "Ledger, no frontmatter.\n")

    def test_failed_write_on_a_stamped_note_names_both(self) -> None:
        self._props()
        real = Path.write_text

        def boom(self_: Path, *a: object, **kw: object) -> int:
            if self_.name == "Ledger.md":
                raise PermissionError("read-only")
            return real(self_, *a, **kw)  # type: ignore[arg-type]

        with mock.patch.object(Path, "write_text", boom):
            code, out, _ = run(self.root, "--publish", LEDGER, "--write",
                               explain=explain_answer((LEDGER,)))
        self.assertEqual(code, 1)
        self.assertIn(f"ERROR\t{LEDGER}\twithheld not cleared, revealed_in not written: "
                      "read-only", out)
        self.assertNotIn("STAMPED", out)
        self.assertIn("# publish: 1 clear: 0 stamp: 0 unmask: 0 log: 1 errors: 1", out)

    def test_count_line(self) -> None:
        self._props()
        code, out, _ = run(self.root, "--publish", LEDGER, "--publish", PELL, "--write",
                           explain=explain_answer((LEDGER,)))
        self.assertEqual(code, 0, out)
        self.assertEqual(out.splitlines()[-1],
                         "# publish: 2 clear: 1 stamp: 1 unmask: 0 log: 1 errors: 0")

    def test_released_only_does_not_ask_explain(self) -> None:
        asked: list[list[str]] = []
        run(self.root, "--released", "Places/Mill.md=the wheel", "--write", asked=asked)
        self.assertEqual(asked, [])


MASK = "NPCs/Pedlar.md"
MASKED = (
    "---\ntype: npc\naliases: [\"The Pedlar\"]\n"
    "unmasked_name: \"Captain Rook\"\n"
    "unmasked_portrait: \"_attachments/rook.png\"\n"
    "portrait: \"_attachments/pedlar.png\"\n---\n\n"
    "## Overview\n\nSells ribbons.\n\n<!-- gm-only -->\n\n## GM Notes\n\n"
    "### Playing Them\n\n"
    "- **Speech:** sing-song, haggles over farthings\n"
    "- **Tell:** counts on his fingers\n"
    "- **Unmasked:** clipped, a soldier's orders\n\n"
    "### Wants\n\n- **Speech:** not this one\n\n<!-- /gm-only -->\n")
# The shape a real unmasking left behind by hand: the true name already in
# `aliases`, a `voice:` set, and Playing Them still the disguise's.
GILT_SHAPED = (
    "---\ntype: npc\naliases: [\"Old Wick\", \"Wick\", \"Hesper\"]\n"
    "gm_aliases: [\"The Grey Nun\"]\n"
    "unmasked_name: \"hesper\"\n"
    "voice: \"Since the unmasking, Hesper: plain and urgent.\"\n"
    "portrait: \"_attachments/wick.png\"\n---\n\n"
    "## GM Notes\n\n### Playing Them\n\n"
    "- **Speech:** loud, quick to complain.\n"
    "- **Tell:** goes still at the hymn\n")


class UnmaskTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)
        make(self.root, {MASK: MASKED, "NPCs/Wick.md": GILT_SHAPED})
        # The true faces the notes name are real pictures in the vault.
        (self.root / "_attachments").mkdir()
        (self.root / "_attachments" / "rook.png").write_bytes(b"png")

    def fm(self, rel: str) -> dict:
        return reveal.extract_frontmatter((self.root / rel).read_text(encoding="utf-8")) or {}

    def test_unmask_moves_the_name_and_face_and_logs_the_old_face(self) -> None:
        code, out, _ = run(self.root, "--unmask", MASK, "--write")
        self.assertEqual(code, 0, out)
        fm = self.fm(MASK)
        self.assertEqual(fm["aliases"], ["The Pedlar", "Captain Rook"])
        self.assertEqual(fm["unmasked_name"], "")
        self.assertEqual(fm["portrait"], "_attachments/rook.png")
        self.assertEqual(fm["unmasked_portrait"], "")
        self.assertIn("UNMASKED\t" + MASK, out)
        self.assertIn("portrait _attachments/pedlar.png → _attachments/rook.png", out)
        self.assertIn("unmask: 1", out.splitlines()[-1])
        entries = log_of(self.root)["entries"]
        unmask = [e for e in entries if e.get("kind") == "unmask"]
        self.assertEqual(len(unmask), 1)
        self.assertEqual({k: unmask[0][k] for k in ("kind", "path", "name", "old_portrait", "session")},
                         {"kind": "unmask", "path": MASK, "name": "Captain Rook",
                          "old_portrait": "_attachments/pedlar.png", "session": "Session 12"})

    def test_unmask_on_a_gilt_shaped_note_adds_no_duplicate_alias(self) -> None:
        code, out, _ = run(self.root, "--unmask", "NPCs/Wick.md", "--write")
        self.assertEqual(code, 0, out)
        fm = self.fm("NPCs/Wick.md")
        self.assertEqual(fm["aliases"], ["Old Wick", "Wick", "Hesper"])
        self.assertEqual(fm["unmasked_name"], "")
        self.assertEqual(fm["portrait"], "_attachments/wick.png", "no unmasked face: the face stays")
        self.assertEqual(fm["gm_aliases"], ["The Grey Nun"], "a secret name without the true name stays")
        self.assertNotIn("gm_aliases -", out)
        self.assertTrue(fm["voice"].startswith("Since the unmasking"))
        self.assertIn("aliases already hold hesper", out)
        entry = next(e for e in log_of(self.root)["entries"] if e.get("kind") == "unmask")
        self.assertEqual(entry["name"], "hesper")
        self.assertIsNone(entry["old_portrait"])

    def test_unmask_needs_unmasked_name(self) -> None:
        code, out, _ = run(self.root, "--unmask", VEX, "--write")
        self.assertEqual(code, 1, out)
        self.assertIn("ERROR\t" + VEX + "\t", out)
        self.assertIn("unmasked_name", out)
        self.assertFalse((self.root / "_meta" / "reveals.json").exists())
        for missing in ("NPCs/Nobody.md", "_meta/x.md"):
            code, out, _ = run(self.root, "--unmask", missing)
            self.assertEqual(code, 1, out)
            self.assertIn("ERROR\t" + missing, out)

    def test_unmask_dry_run_writes_nothing(self) -> None:
        before = (self.root / MASK).read_text(encoding="utf-8")
        code, out, _ = run(self.root, "--unmask", MASK)
        self.assertEqual(code, 0, out)
        self.assertIn("WOULD-UNMASK\t" + MASK, out)
        self.assertIn("Captain Rook", out)
        self.assertIn("WOULD-LOG", out)
        self.assertEqual((self.root / MASK).read_text(encoding="utf-8"), before)
        self.assertFalse((self.root / "_meta" / "reveals.json").exists())

    def test_unmask_and_reveal_in_one_session_keep_their_own_entries(self) -> None:
        run(self.root, "--unmask", MASK, "--write")
        code, out, _ = run(self.root, "--publish", VEX, "--write")
        self.assertEqual(code, 0, out)
        entries = log_of(self.root)["entries"]
        reveal_entry = next(e for e in entries if e.get("session") == "Session 12" and "kind" not in e)
        self.assertEqual(reveal_entry["published"], [VEX])
        unmask = next(e for e in entries if e.get("kind") == "unmask")
        self.assertNotIn("published", unmask)

    def test_unmask_keeps_a_lone_alias(self) -> None:
        (self.root / MASK).write_text(MASKED.replace('aliases: ["The Pedlar"]', "aliases: Pedlar Jack"),
                                      encoding="utf-8")
        code, out, _ = run(self.root, "--unmask", MASK, "--write")
        self.assertEqual(code, 0, out)
        self.assertEqual(self.fm(MASK)["aliases"], ["Pedlar Jack", "Captain Rook"])

    def _aliases_written_as(self, before: str) -> str:
        (self.root / MASK).write_text(MASKED.replace('aliases: ["The Pedlar"]\n', before),
                                      encoding="utf-8")
        code, out, _ = run(self.root, "--unmask", MASK, "--write")
        self.assertEqual(code, 0, out)
        return (self.root / MASK).read_text(encoding="utf-8")

    def test_unmask_adds_to_a_block_list_in_its_own_indent_keeping_comments(self) -> None:
        text = self._aliases_written_as(
            "aliases:   # names the PCs use\n    - \"The Pedlar\"  # market name\n"
            "    # an old one, struck\n    - Ribbon Man\nportrait_note: x\n")
        self.assertIn("aliases:   # names the PCs use\n    - \"The Pedlar\"  # market name\n"
                      "    # an old one, struck\n    - Ribbon Man\n    - \"Captain Rook\"\n"
                      "portrait_note: x\n", text)
        self.assertEqual(self.fm(MASK)["aliases"], ["The Pedlar", "Ribbon Man", "Captain Rook"])

    def test_unmask_keeps_a_flow_list_flow(self) -> None:
        text = self._aliases_written_as('aliases: ["The Pedlar", "a]b"]  # see [notes]\n')
        self.assertIn('aliases: ["The Pedlar", "a]b", "Captain Rook"]  # see [notes]\n', text)
        text = self._aliases_written_as("aliases: []\n")
        self.assertIn('aliases: ["Captain Rook"]\n', text)

    def test_unmask_with_no_aliases_key_writes_a_block_list(self) -> None:
        for before in ("", "aliases:\n", 'aliases: ""\n', "aliases: ~  # none yet\n"):
            text = self._aliases_written_as(before)
            self.assertEqual(self.fm(MASK)["aliases"], ["Captain Rook"], before)
            self.assertIn('  - "Captain Rook"\n', text, before)

    def test_unmask_renames_speech_only_with_an_unmasked_line(self) -> None:
        code, out, _ = run(self.root, "--unmask", MASK, "--unmask", "NPCs/Wick.md", "--write")
        self.assertEqual(code, 0, out)
        # With an Unmasked line: Speech becomes Disguise, Unmasked becomes Speech.
        text = (self.root / MASK).read_text(encoding="utf-8")
        self.assertIn("- **Disguise:** sing-song, haggles over farthings\n", text)
        self.assertIn("- **Speech:** clipped, a soldier's orders\n", text)
        self.assertNotIn("**Unmasked:**", text)
        self.assertIn("- **Speech:** not this one", text, "only Playing Them changes")
        self.assertIn("Speech is now Disguise; Unmasked is now Speech", out)
        # Without one: the same voice, Playing Them left alone.
        text = (self.root / "NPCs/Wick.md").read_text(encoding="utf-8")
        self.assertIn("- **Speech:** loud, quick to complain.\n", text)
        self.assertNotIn("**Disguise:**", text)
        wick_row = next(r for r in out.splitlines() if r.startswith("UNMASKED\tNPCs/Wick.md"))
        self.assertNotIn("Speech", wick_row)

    def test_unmask_takes_the_true_name_out_of_gm_aliases(self) -> None:
        for before, after, gone in (
                ('gm_aliases: ["The Grey Nun", "Sister Hesper", "Hesperia"]  # secret\n',
                 'gm_aliases: ["The Grey Nun", "Hesperia"]  # secret\n', ["Sister Hesper"]),
                ("gm_aliases:\n  - The Grey Nun  # the order\n  - \"HESPER\"\n  - hesper of the lamp\n",
                 "gm_aliases:\n  - The Grey Nun  # the order\n", ["HESPER", "hesper of the lamp"]),
                ("gm_aliases: Sister Hesper\n", "gm_aliases: []\n", ["Sister Hesper"]),
                ("gm_aliases:  # only one\n  - Hesper\n", "gm_aliases: []  # only one\n", ["Hesper"])):
            (self.root / "NPCs/Wick.md").write_text(
                GILT_SHAPED.replace('gm_aliases: ["The Grey Nun"]\n', before), encoding="utf-8")
            code, out, _ = run(self.root, "--unmask", "NPCs/Wick.md", "--write")
            self.assertEqual(code, 0, out)
            text = (self.root / "NPCs/Wick.md").read_text(encoding="utf-8")
            self.assertIn(after, text, before)
            for name in gone:
                self.assertIn(f"gm_aliases - {name}", out, before)
            self.assertFalse(any("hesper" in a.lower().split()
                                 for a in self.fm("NPCs/Wick.md")["gm_aliases"]), before)

    def test_unmask_on_the_real_gilt_shape_drops_the_secret_title(self) -> None:
        gilt = ('---\nname: "Master Orrin Gilt"\ntype: "npc"\n'
                'aliases: ["Orrin Gilt", "Gilt", "Lucan"]\ngm_aliases: ["Brother Lucan"]\n'
                'unmasked_name: "Lucan"\nwithheld: false\n---\n\n## GM Notes\n\n'
                '### Playing Them\n\n- **Speech:** loud, self-important, quick to complain.\n')
        (self.root / "NPCs/Gilt.md").write_text(gilt, encoding="utf-8")
        code, out, _ = run(self.root, "--unmask", "NPCs/Gilt.md", "--write")
        self.assertEqual(code, 0, out)
        fm = self.fm("NPCs/Gilt.md")
        self.assertEqual(fm["gm_aliases"], [])
        self.assertEqual(fm["aliases"], ["Orrin Gilt", "Gilt", "Lucan"])
        self.assertIn("aliases already hold Lucan; gm_aliases - Brother Lucan", out)
        self.assertIn("- **Speech:** loud", (self.root / "NPCs/Gilt.md").read_text(encoding="utf-8"))

    def test_unmask_refuses_a_list_written_over_several_lines(self) -> None:
        for field, before in (("aliases", 'aliases: ["The Pedlar",\n  "Ribbon Man"]\n'),
                              ("gm_aliases", 'aliases: []\ngm_aliases: ["Captain Rook",\n  "X"]\n')):
            (self.root / MASK).write_text(MASKED.replace('aliases: ["The Pedlar"]\n', before),
                                          encoding="utf-8")
            text = (self.root / MASK).read_text(encoding="utf-8")
            code, out, _ = run(self.root, "--unmask", MASK, "--write")
            self.assertEqual(code, 1, out)      # the frontmatter reader refuses it first
            self.assertIn("ERROR\t" + MASK + "\tnothing changed", out)
            self.assertEqual((self.root / MASK).read_text(encoding="utf-8"), text)
            # and the list helpers refuse it themselves, rather than write a broken list
            head = [ln for ln in before.splitlines()]
            with self.assertRaisesRegex(reveal.ListShapeError, f"{field} is a list written over several lines"):
                reveal._add_to_list(head, field, "Captain Rook") if field == "aliases" \
                    else reveal._drop_from_list(head, field, "Captain Rook")

    @unittest.skipUnless(shutil.which("node"), "node is not installed")
    def test_unmask_takes_a_flush_block_list(self) -> None:
        # Items at column zero, as PyYAML and many editors write them: valid YAML.
        (self.root / MASK).write_text(
            MASKED.replace('aliases: ["The Pedlar"]\n',
                           "aliases:\n- The Pedlar\n# old\n- Ribbon Man\ngm_aliases:\n- Captain Rook of the Ninth\n"),
            encoding="utf-8")
        code, out, _ = run(self.root, "--unmask", MASK, "--write")
        self.assertEqual(code, 0, out)
        text = (self.root / MASK).read_text(encoding="utf-8")
        self.assertIn('aliases:\n- The Pedlar\n# old\n- Ribbon Man\n- "Captain Rook"\ngm_aliases: []\n', text)
        self.assertIn("gm_aliases - Captain Rook of the Ninth", out)
        self.assertEqual(self._strict(MASK)["aliases"], ["The Pedlar", "Ribbon Man", "Captain Rook"])

    def _strict(self, rel: str) -> dict:
        """The frontmatter as the publish tool's own parser reads it."""
        parse = ("const {parseNote}=require(process.argv[1]);const fs=require('fs');"
                 "process.stdout.write(JSON.stringify(parseNote(fs.readFileSync(process.argv[2],'utf8')).data))")
        lib = str(ROOT / "tools" / "publish" / "lib" / "frontmatter.js")
        got = subprocess.run(["node", "-e", parse, lib, str(self.root / rel)],
                             capture_output=True, text=True, check=False)
        self.assertEqual(got.returncode, 0, got.stderr)
        return json.loads(got.stdout)

    def test_unmask_list_valued_unmasked_name(self) -> None:
        (self.root / MASK).write_text(MASKED.replace('unmasked_name: "Captain Rook"\n',
                                                     "unmasked_name:\n  - Captain Rook\n"), encoding="utf-8")
        code, out, _ = run(self.root, "--unmask", MASK, "--write")
        self.assertEqual(code, 0, out)
        self.assertEqual(self.fm(MASK)["unmasked_name"], "")
        self.assertIn("Captain Rook", self.fm(MASK)["aliases"])
        (self.root / MASK).write_text(MASKED.replace('unmasked_name: "Captain Rook"\n',
                                                     "unmasked_name: [Rook, Captain Rook]\n"), encoding="utf-8")
        code, out, _ = run(self.root, "--unmask", MASK, "--write")
        self.assertEqual(code, 1, out)
        self.assertIn("unmasked_name is a list of 2 names", out)

    def test_unmask_refuses_before_writing_when_the_log_cannot_be_read(self) -> None:
        (self.root / "_meta").mkdir()
        (self.root / "_meta" / "reveals.json").write_text("{not json", encoding="utf-8")
        before = (self.root / MASK).read_text(encoding="utf-8")
        code, out, _ = run(self.root, "--unmask", MASK, "--write")
        self.assertEqual(code, 1, out)
        self.assertIn("not unmasked, nothing changed", out)
        self.assertEqual((self.root / MASK).read_text(encoding="utf-8"), before)

    @unittest.skipUnless(shutil.which("node"), "node is not installed")
    def test_unmasked_frontmatter_reads_strictly(self) -> None:
        """Each written shape is YAML the publish tool's own parser takes."""
        shapes = ("aliases:   # c\n    - \"The Pedlar\"  # m\n    # old\n    - Ribbon Man\n",
                  'aliases: ["The Pedlar", "a]b"]  # see [x]\n', "aliases: Pedlar Jack\n",
                  'aliases: ""\n', "")
        for before in shapes:
            self._aliases_written_as(before)
            self.assertEqual(self._strict(MASK)["aliases"][-1], "Captain Rook", before)

    def test_unmask_keeps_crlf(self) -> None:
        (self.root / MASK).write_bytes(MASKED.replace("\n", "\r\n").encode("utf-8"))
        code, out, _ = run(self.root, "--unmask", MASK, "--write")
        self.assertEqual(code, 0, out)
        raw = (self.root / MASK).read_bytes().decode("utf-8")
        self.assertNotIn("\n", raw.replace("\r\n", ""))
        self.assertIn("- **Speech:** clipped, a soldier's orders\r\n", raw)

    # --- final fix wave (silent-failure review C1, C2, I1, I2, M1, M5; final review Minor 1) ---

    def _write_mask(self, old: str, new: str, rel: str = MASK, base: str = MASKED) -> None:
        self.assertIn(old, base)
        (self.root / rel).write_text(base.replace(old, new), encoding="utf-8")

    @unittest.skipUnless(shutil.which("node"), "node is not installed")
    def test_unmask_reads_a_wikilink_true_name_as_the_name(self) -> None:
        """C1: a true name written as a link is the name it links."""
        for value in ('"[[Captain Rook]]"', '"[[Captain Rook|the captain]]"', "[[Captain Rook]]",
                      "[[Captain Rook|the captain]]", '"[[NPCs/Captain Rook]]"'):
            self._write_mask('unmasked_name: "Captain Rook"\n', f"unmasked_name: {value}\n")
            code, out, _ = run(self.root, "--unmask", MASK, "--write")
            self.assertEqual(code, 0, f"{value}: {out}")
            self.assertIn("aliases + Captain Rook;", out, value)
            strict = self._strict(MASK)
            self.assertEqual(strict["aliases"], ["The Pedlar", "Captain Rook"], value)
            self.assertEqual(strict["unmasked_name"], "", value)
            entry = [e for e in log_of(self.root)["entries"] if e.get("kind") == "unmask"][-1]
            self.assertEqual(entry["name"], "Captain Rook", value)

    def test_unmask_refuses_a_true_name_it_cannot_read(self) -> None:
        """C1: a value that is there but names no one is told, not dropped."""
        self._write_mask('unmasked_name: "Captain Rook"\n', 'unmasked_name: "[[]]"\n')
        before = (self.root / MASK).read_text(encoding="utf-8")
        code, out, _ = run(self.root, "--unmask", MASK, "--write")
        self.assertEqual(code, 1, out)
        self.assertIn(f"ERROR\t{MASK}\tnothing changed: unmasked_name holds [[]], which names no one", out)
        self.assertEqual((self.root / MASK).read_text(encoding="utf-8"), before)

    @unittest.skipUnless(shutil.which("node"), "node is not installed")
    def test_unmask_clears_a_flush_unmasked_name_list(self) -> None:
        """C2: a flush list under unmasked_name is cleared whole, not left as a stray item."""
        self._write_mask('unmasked_name: "Captain Rook"\nunmasked_portrait: "_attachments/rook.png"\n'
                         'portrait: "_attachments/pedlar.png"\n',
                         "unmasked_name:\n- Captain Rook\nunmasked_portrait:\n- _attachments/rook.png\n"
                         "portrait:\n- _attachments/pedlar.png\n")
        code, out, _ = run(self.root, "--unmask", MASK, "--write")
        self.assertEqual(code, 0, out)
        text = (self.root / MASK).read_text(encoding="utf-8")
        self.assertNotIn("- Captain Rook", text)
        strict = self._strict(MASK)
        self.assertEqual(strict["unmasked_name"], "")
        self.assertEqual(strict["unmasked_portrait"], "")
        self.assertEqual(strict["portrait"], "_attachments/rook.png")
        self.assertEqual(strict["aliases"], ["The Pedlar", "Captain Rook"])
        self.assertIn("portrait _attachments/pedlar.png → _attachments/rook.png", out)

    def test_unmask_checks_its_own_edit_and_writes_nothing_on_a_mismatch(self) -> None:
        """C2: the edit is read back before it is written; a broken one is an ERROR, nothing written."""
        before = (self.root / MASK).read_text(encoding="utf-8")
        real = reveal._set_value

        def broken(head: list[str], key: str, value: str) -> None:
            if key != "unmasked_name":
                real(head, key, value)
        with mock.patch.object(reveal, "_set_value", side_effect=broken):
            code, out, _ = run(self.root, "--unmask", MASK, "--write")
        self.assertEqual(code, 1, out)
        self.assertIn(f"ERROR\t{MASK}\tnothing changed: the edit did not come out right "
                      "(unmasked_name still holds Captain Rook)", out)
        self.assertNotIn("UNMASKED", out)
        self.assertEqual((self.root / MASK).read_text(encoding="utf-8"), before)
        self.assertFalse((self.root / "_meta" / "reveals.json").exists())

    @unittest.skipUnless(shutil.which("node"), "node is not installed")
    def test_unmask_moves_a_face_written_as_a_link_or_a_one_item_list(self) -> None:
        """I1: the face moves whatever one-picture shape it is written in."""
        for value, face in (("[[rook.png]]", "rook.png"), ('"[[_attachments/rook.png]]"', "_attachments/rook.png"),
                            ('\n  - "_attachments/rook.png"', "_attachments/rook.png")):
            self._write_mask('unmasked_portrait: "_attachments/rook.png"\n', f"unmasked_portrait: {value}\n")
            code, out, _ = run(self.root, "--unmask", MASK, "--write")
            self.assertEqual(code, 0, f"{value}: {out}")
            self.assertIn(f"portrait _attachments/pedlar.png → {face}", out, value)
            strict = self._strict(MASK)
            self.assertEqual(strict["portrait"], face, value)
            self.assertEqual(strict["unmasked_portrait"], "", value)

    def test_unmask_refuses_a_face_it_cannot_move(self) -> None:
        """I1: several pictures, or a link to nothing, is refused before anything is written."""
        for value, why in (("[a.png, b.png]", "unmasked_portrait is a list of 2 pictures"),
                           ('"[[]]"', "unmasked_portrait holds [[]], which names no picture")):
            self._write_mask('unmasked_portrait: "_attachments/rook.png"\n', f"unmasked_portrait: {value}\n")
            before = (self.root / MASK).read_text(encoding="utf-8")
            code, out, _ = run(self.root, "--unmask", MASK, "--write")
            self.assertEqual(code, 1, out)
            self.assertIn(f"ERROR\t{MASK}\tnothing changed: {why}", out)
            self.assertEqual((self.root / MASK).read_text(encoding="utf-8"), before)

    def test_unmask_batch_checks_every_note_before_writing_any(self) -> None:
        """I2: one unreadable note in a batch: nothing written, nothing logged, every note told."""
        (self.root / "NPCs/Latin.md").write_bytes("---\ntype: npc\nunmasked_name: \"René\"\n---\n".encode("latin-1"))
        before = (self.root / MASK).read_text(encoding="utf-8")
        code, out, _ = run(self.root, "--unmask", MASK, "--unmask", "NPCs/Latin.md", "--write")
        self.assertEqual(code, 1, out)
        self.assertIn("ERROR\tNPCs/Latin.md\tnothing changed: the note cannot be read", out)
        self.assertIn(f"ERROR\t{MASK}\tnot unmasked, nothing changed: NPCs/Latin.md in the same run was refused", out)
        self.assertNotIn("UNMASKED", out)
        self.assertEqual((self.root / MASK).read_text(encoding="utf-8"), before)
        self.assertFalse((self.root / "_meta" / "reveals.json").exists())
        self.assertIn("unmask: 0", out.splitlines()[-1])

    def test_unmask_batch_puts_back_what_it_wrote_when_a_write_fails(self) -> None:
        """I2: a write that fails mid-batch puts the earlier notes back; nothing is logged."""
        before = (self.root / MASK).read_text(encoding="utf-8")
        wick = (self.root / "NPCs/Wick.md").read_text(encoding="utf-8")
        real = reveal._replace_file

        def failing(path: Path, data: bytes) -> None:
            if path.name == "Wick.md":
                raise PermissionError("Permission denied")
            real(path, data)
        with mock.patch.object(reveal, "_replace_file", failing):
            code, out, _ = run(self.root, "--unmask", MASK, "--unmask", "NPCs/Wick.md", "--write")
        self.assertEqual(code, 1, out)
        self.assertIn("ERROR\tNPCs/Wick.md\tnot unmasked, nothing changed: Permission denied", out)
        self.assertIn(f"ERROR\t{MASK}\tnot unmasked, put back as it was: NPCs/Wick.md could not be written", out)
        self.assertNotIn("UNMASKED", out)
        self.assertEqual((self.root / MASK).read_text(encoding="utf-8"), before)
        self.assertEqual((self.root / "NPCs/Wick.md").read_text(encoding="utf-8"), wick)
        self.assertFalse((self.root / "_meta" / "reveals.json").exists())

    def test_unmask_write_that_fails_after_truncating_leaves_every_note_whole(self) -> None:
        """A disk-full write mid-batch: every note keeps its bytes and every note gets a row."""
        third = "NPCs/Third.md"
        (self.root / third).write_text(MASKED.replace("Captain Rook", "Old Cinders"), encoding="utf-8")
        paths = [MASK, "NPCs/Wick.md", third]
        before = {r: (self.root / r).read_bytes() for r in paths}
        real_open = open
        real_write_text = Path.write_text

        def full(path: object) -> bool:
            return "Wick" in str(path)

        def disk_full_open(file: object, mode: str = "r", *a: object, **k: object) -> object:
            f = real_open(file, mode, *a, **k)  # type: ignore[call-overload]
            if "w" in mode and full(file):
                f.close()
                raise OSError(28, "No space left on device")
            return f

        def disk_full_write_text(path: Path, *a: object, **k: object) -> int:
            if full(path):
                real_open(path, "w").close()        # truncated, then the disk is full
                raise OSError(28, "No space left on device")
            return real_write_text(path, *a, **k)  # type: ignore[arg-type]
        with mock.patch("builtins.open", disk_full_open), \
                mock.patch.object(Path, "write_text", disk_full_write_text):
            code, out, _ = run(self.root, *[a for r in paths for a in ("--unmask", r)], "--write")
        self.assertEqual(code, 1, out)
        for r in paths:
            self.assertEqual((self.root / r).read_bytes(), before[r], r)
            self.assertIn(f"ERROR\t{r}\t", out, r)
        self.assertIn("ERROR\tNPCs/Wick.md\tnot unmasked, nothing changed: [Errno 28] No space left on device", out)
        self.assertIn(f"ERROR\t{MASK}\tnot unmasked, put back as it was: NPCs/Wick.md could not be written", out)
        self.assertIn(f"ERROR\t{third}\tnot unmasked, nothing changed: NPCs/Wick.md could not be written", out)
        self.assertNotIn("UNMASKED", out)
        self.assertFalse((self.root / "_meta" / "reveals.json").exists())
        self.assertEqual([f.name for f in (self.root / "NPCs").iterdir() if f.name.startswith(".")], [],
                         "no temp file is left behind")

    def test_unmask_refuses_a_true_face_that_is_no_picture(self) -> None:
        """PR #799 B1: a face that names no file is refused, and the batch with it."""
        self._write_mask('unmasked_portrait: "_attachments/rook.png"\n',
                         'unmasked_portrait: "_attachments/not-there.png"\n')
        before = {r: (self.root / r).read_bytes() for r in (MASK, "NPCs/Wick.md")}
        code, out, _ = run(self.root, "--unmask", MASK, "--unmask", "NPCs/Wick.md", "--write")
        self.assertEqual(code, 1, out)
        self.assertIn(f"ERROR\t{MASK}\tnothing changed: unmasked_portrait names _attachments/not-there.png, "
                      "which is no picture in the vault", out)
        self.assertIn("ERROR\tNPCs/Wick.md\tnot unmasked, nothing changed", out)
        for r, b in before.items():
            self.assertEqual((self.root / r).read_bytes(), b, r)
        # a bare file name is found wherever the picture sits, as the site finds it
        self._write_mask('unmasked_portrait: "_attachments/rook.png"\n', 'unmasked_portrait: "rook.png"\n')
        code, out, _ = run(self.root, "--unmask", MASK, "--write")
        self.assertEqual(code, 0, out)

    def test_unmask_a_second_time_skips_a_note_already_unmasked(self) -> None:
        """PR #799 B2: a repeat run says the note is done and does not refuse the batch."""
        code, out, _ = run(self.root, "--unmask", MASK, "--write", session="Session 11")
        self.assertEqual(code, 0, out)
        code, out, _ = run(self.root, "--unmask", MASK, "--unmask", "NPCs/Wick.md", "--write")
        self.assertEqual(code, 0, out)
        self.assertIn(f"SKIP\t{MASK}\talready unmasked in Session 11", out)
        self.assertIn("UNMASKED\tNPCs/Wick.md", out)
        self.assertEqual(self.fm("NPCs/Wick.md")["unmasked_name"], "")
        # a note with no unmasked_name the log does not know is still an error
        code, out, _ = run(self.root, "--unmask", VEX, "--write")
        self.assertEqual(code, 1, out)
        self.assertIn(f"ERROR\t{VEX}\tnothing to unmask", out)

    def test_unmask_refuses_an_anchor_in_a_list_it_edits(self) -> None:
        """PR #799 B3: the shape that once came out as [["Gilt"], "Lucan"]."""
        self._write_mask('aliases: ["The Pedlar"]\n', "aliases: &a [Gilt]\n")
        before = (self.root / MASK).read_bytes()
        code, out, _ = run(self.root, "--unmask", MASK, "--write")
        self.assertEqual(code, 1, out)
        self.assertIn(f"ERROR\t{MASK}\tnothing changed: aliases uses a YAML anchor, alias or tag (&a)", out)
        self.assertEqual((self.root / MASK).read_bytes(), before)

    def test_unmask_check_finds_an_alias_or_secret_lost_on_the_way(self) -> None:
        """PR #799 B3: every old aliases and kept gm_aliases entry must still be there."""
        self._write_mask('aliases: ["The Pedlar"]\n',
                         'aliases: ["The Pedlar", "Ribbon Man"]\ngm_aliases: ["The Ninth", "Captain Rook"]\n')
        before = (self.root / MASK).read_bytes()
        real_add, real_drop = reveal._add_to_list, reveal._drop_from_list

        def lossy_add(head: list[str], key: str, name: str) -> None:
            real_add(head, key, name)
            head[:] = [h.replace('"Ribbon Man", ', "") for h in head]

        def lossy_drop(head: list[str], key: str, name: str) -> list[str]:
            gone = real_drop(head, key, name)
            head[:] = [h.replace('"The Ninth"', "") for h in head]
            return gone
        for patch, why in ((mock.patch.object(reveal, "_add_to_list", lossy_add), "aliases lost Ribbon Man"),
                           (mock.patch.object(reveal, "_drop_from_list", lossy_drop), "gm_aliases lost The Ninth")):
            with patch:
                code, out, _ = run(self.root, "--unmask", MASK, "--write")
            self.assertEqual(code, 1, out)
            self.assertIn(f"nothing changed: the edit did not come out right ({why})", out)
            self.assertEqual((self.root / MASK).read_bytes(), before)

    def test_unmask_refuses_before_writing_when_the_log_cannot_be_written(self) -> None:
        """M1: a log folder that cannot be written to stops the unmask before any note changes."""
        (self.root / "_meta").mkdir()
        before = (self.root / MASK).read_text(encoding="utf-8")
        with mock.patch.object(reveal, "_log_writable", return_value="Permission denied"):
            code, out, _ = run(self.root, "--unmask", MASK, "--write")
        self.assertEqual(code, 1, out)
        self.assertIn(f"ERROR\t{MASK}\tnot unmasked, nothing changed: {reveal.LOG} cannot be written (Permission denied)", out)
        self.assertEqual((self.root / MASK).read_text(encoding="utf-8"), before)

    def test_log_writable_reports_a_read_only_folder(self) -> None:
        meta = self.root / "_meta"
        meta.mkdir()
        self.assertIsNone(reveal._log_writable(self.root))
        self.assertEqual(list(meta.iterdir()), [], "the probe leaves nothing behind")
        meta.chmod(0o500)
        self.addCleanup(meta.chmod, 0o700)
        if os.access(meta, os.W_OK):
            self.skipTest("running as a user who can write anywhere")
        self.assertIsNotNone(reveal._log_writable(self.root))

    def test_unmask_keeps_the_comments_on_the_lines_it_sets(self) -> None:
        """Final review Minor 1: a trailing comment stays; a quoted key is set, not doubled."""
        self._write_mask('unmasked_name: "Captain Rook"\nunmasked_portrait: "_attachments/rook.png"\n'
                         'portrait: "_attachments/pedlar.png"\n',
                         'unmasked_name: "Captain Rook"     # a disguise\'s true name\n'
                         'unmasked_portrait: "_attachments/rook.png" # the true face\n'
                         'portrait: "_attachments/pedlar.png"  # the face players see\n')
        code, out, _ = run(self.root, "--unmask", MASK, "--write")
        self.assertEqual(code, 0, out)
        text = (self.root / MASK).read_text(encoding="utf-8")
        self.assertIn('unmasked_name: ""     # a disguise\'s true name\n', text)
        self.assertIn('unmasked_portrait: "" # the true face\n', text)
        self.assertIn('portrait: "_attachments/rook.png"  # the face players see\n', text)
        head = ['type: npc', '"unmasked_name": "Captain Rook"  # x', "aliases: []"]
        reveal._set_value(head, "unmasked_name", '""')
        self.assertEqual(head, ['type: npc', '"unmasked_name": ""  # x', "aliases: []"])

    def _playing_them(self, gm_notes: str, before: str = "") -> str:
        note = ('---\ntype: npc\nunmasked_name: "Captain Rook"\n---\n\n' + before
                + "## GM Notes\n\n" + gm_notes)
        (self.root / MASK).write_text(note, encoding="utf-8")
        code, out, _ = run(self.root, "--unmask", MASK, "--write")
        self.assertEqual(code, 0, out)
        return (self.root / MASK).read_text(encoding="utf-8")

    def test_unmask_renames_every_speech_and_unmasked_line(self) -> None:
        """M5: every Speech line, as the run sheet joins every one."""
        text = self._playing_them("### Playing Them\n\n- **Speech:** sing-song\n- **Speech:** haggles\n"
                                  "- **Unmasked:** clipped\n- **Unmasked:** orders\n")
        self.assertIn("- **Disguise:** sing-song\n- **Disguise:** haggles\n"
                      "- **Speech:** clipped\n- **Speech:** orders\n", text)

    def test_unmask_reads_playing_them_as_the_run_sheet_does(self) -> None:
        """M5: only the Playing Them under GM Notes, never in a fence, never an indented bullet."""
        text = self._playing_them(
            "### Playing Them\n\n- **Speech:** sing-song\n  - **Speech:** nested, not a label\n"
            "```\n- **Speech:** in a fence\n```\n- **Unmasked:** clipped\n",
            before="## Overview\n\n### Playing Them\n\n- **Speech:** outside GM Notes\n- **Unmasked:** no\n\n")
        self.assertIn("- **Speech:** outside GM Notes\n- **Unmasked:** no\n", text)
        self.assertIn("- **Disguise:** sing-song\n  - **Speech:** nested, not a label\n"
                      "```\n- **Speech:** in a fence\n```\n- **Speech:** clipped\n", text)

    def test_unmask_leaves_speech_alone_when_unmasked_is_a_placeholder(self) -> None:
        """M5: an Unmasked line the run sheet skips (a {placeholder}) is no voice to swap in."""
        text = self._playing_them("### Playing Them\n\n- **Speech:** sing-song\n- **Unmasked:** {the true voice}\n")
        self.assertIn("- **Speech:** sing-song\n- **Unmasked:** {the true voice}\n", text)

    @unittest.skipUnless(shutil.which("node"), "node is not installed")
    def test_unmasked_voice_matches_the_run_sheet_before_and_after(self) -> None:
        """M5: what the sheet shows behind Unmask before is what it plays as after."""
        gm = ("### Playing Them\n\n- **Speech:** sing-song\n- **Tell:** counts\n"
              "* **Speech:** haggles\n  - **Unmasked:** nested\n```\n**Unmasked:** fenced\n```\n"
              "- **Unmasked:** clipped\n**unmasked:** orders\n\n### Wants\n\n- **Speech:** not this one\n")
        note = '---\ntype: npc\nunmasked_name: "Captain Rook"\n---\n\n## GM Notes\n\n' + gm
        (self.root / MASK).write_text(note, encoding="utf-8")
        js = ("const {buildIndex}=require(process.argv[1]+'/notes');"
              "const {playAsOf,unmaskedPlayAsOf}=require(process.argv[1]+'/people-from-notes');"
              "const i=buildIndex(process.argv[2]);"
              "process.stdout.write(JSON.stringify([playAsOf(process.argv[3],i),unmaskedPlayAsOf(process.argv[3],i)]))")
        lib = str(ROOT / "tools" / "publish" / "lib" / "run-sheet")

        def sheet() -> list[str]:
            got = subprocess.run(["node", "-e", js, lib, str(self.root), MASK],
                                 capture_output=True, text=True, check=False)
            self.assertEqual(got.returncode, 0, got.stderr)
            return json.loads(got.stdout)
        _, behind_unmask = sheet()
        code, out, _ = run(self.root, "--unmask", MASK, "--write")
        self.assertEqual(code, 0, out)
        after, _ = sheet()
        self.assertEqual(after, behind_unmask)
        self.assertIn("clipped", after)


@unittest.skipUnless(shutil.which("node"), "node is not installed")
class ApplyPublishRealTool(unittest.TestCase):
    """apply_publish against the repo's own publish tool: the list, apply,
    list contract that every other test patches out."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        base = Path(self._tmp.name)
        self.site = base / "site"
        self.site.mkdir()
        (self.site / "vault.config.json").write_text("{}", encoding="utf-8")
        self.vault = base / "vault"
        make(self.vault, {
            "NPCs/Lady Anne.md": "---\ntype: npc\n---\n\nAnne.\n",
            "Secret/Z.md": "---\ntype: npc\n---\n\nZ.\n",
            "_meta/vault-config.yaml": f"version: 1\nplayer_site:\n  publish: true\n  folder: {self.site}\n"
                                       "  hide:\n    folders:\n      - _meta\n      - Secret\n",
        })

    def _list(self, text: str = "publishing: []\nexcluded: []\nneeds_decision: []\n") -> None:
        (self.vault / "_meta" / "publish-list.yaml").write_text(text, encoding="utf-8")

    def test_round_trip_with_spaced_name(self) -> None:
        self._list()
        done, why = reveal.apply_publish(self.vault, [VEX, "NPCs/Lady Anne.md"])
        self.assertIsNone(why)
        self.assertEqual(sorted(done), ["NPCs/Lady Anne.md", VEX])
        state, _ = reveal.publish_state(self.vault)
        self.assertEqual(state, {"NPCs/Lady Anne.md", VEX})

    def test_no_publish_list_is_refused(self) -> None:
        done, why = reveal.apply_publish(self.vault, [VEX])
        self.assertEqual(done, [])
        self.assertIn("no publish list", why or "")
        self.assertFalse((self.vault / "_meta" / "publish-list.yaml").exists())

    def test_refused_batch_shows_the_tools_reason(self) -> None:
        self._list()
        done, why = reveal.apply_publish(self.vault, [VEX, "Secret/Z.md"])
        self.assertEqual(done, [])
        self.assertIn("Secret/Z.md", why or "")
        self.assertIn("leaves out", why or "")
        state, _ = reveal.publish_state(self.vault)
        self.assertEqual(state, set())

    def test_publish_false_refused_against_the_real_tool(self) -> None:
        self._list("publishing:\n  - NPCs/Listed.md\nexcluded: []\nneeds_decision: []\n")
        (self.vault / "NPCs" / "Secret.md").write_text(
            "---\ntype: npc\npublish: false\n---\n\nS.\n", encoding="utf-8")
        (self.vault / "NPCs" / "Listed.md").write_text(
            "---\ntype: npc\npublish: none\nwithheld: true\n---\n\nL.\n", encoding="utf-8")
        for rel in ("NPCs/Secret.md", "NPCs/Listed.md"):
            with self.subTest(rel=rel):
                buf = io.StringIO()
                with contextlib.redirect_stdout(buf):
                    code = reveal.main([str(self.vault), "--session", "S1",
                                        "--publish", rel, "--write"])
                self.assertEqual(code, 1, buf.getvalue())
                self.assertIn(f"ERROR\t{rel}\t", buf.getvalue())
        state, _ = reveal.publish_state(self.vault)
        self.assertEqual(state, {"NPCs/Listed.md"})
        self.assertFalse((self.vault / "_meta" / "reveals.json").exists())


if __name__ == "__main__":
    unittest.main()
