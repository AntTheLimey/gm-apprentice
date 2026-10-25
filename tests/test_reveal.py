#!/usr/bin/env python3
"""reveal.py: publish what the GM says came out, lift withheld, log it.

Run: python3 tests/test_reveal.py
"""

from __future__ import annotations

import contextlib
import io
import json
import shutil
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


def run(root: Path, *args: str, applied: tuple[list[str], str | None] | None = None,
        site: bool = True, state: tuple[set[str] | None, str | None] = (set(), None)) -> tuple[int, str, mock.Mock]:
    buf = io.StringIO()
    config = (Path("/site/vault.config.json"), None) if site else (None, None)

    def fake(_vault: Path, paths: list[str], _before: object = None) -> tuple[list[str], str | None]:
        return (list(paths), None) if applied is None else applied

    with mock.patch.object(reveal, "_site_config", return_value=config), \
            mock.patch.object(reveal, "publish_state", return_value=state), \
            mock.patch.object(reveal, "apply_publish", side_effect=fake) as ap, \
            contextlib.redirect_stdout(buf):
        code = reveal.main([str(root), "--session", "Session 12", *args])
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
        self.assertIn("# publish: 1 clear: 1 log: 1 errors: 0", out)
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
        code, out, ap = run(self.root, "--publish", VEX, "--publish", "Places/Mill.md",
                            "--write", state=({VEX}, None))
        self.assertEqual(code, 0, out)
        self.assertEqual(ap.call_args.args[1], ["Places/Mill.md"])
        self.assertIn(f"SKIP\t{VEX}", out)
        self.assertIn("withheld: false", (self.root / VEX).read_text(encoding="utf-8"))
        self.assertEqual(log_of(self.root)["entries"][-1]["published"], ["Places/Mill.md"])

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
        self.assertIn("# publish: 1 clear: 0 log: 1 errors: 1", out)
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
            "_meta/vault-config.md": f"---\npublish:\n  site: true\n  site_dir: {self.site}\n"
                                     "  exclude_dirs:\n    - _meta\n    - Secret\n---\n",
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


if __name__ == "__main__":
    unittest.main()
