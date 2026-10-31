#!/usr/bin/env python3
"""vault_write.py scene-paused: the snapshot of a scene stopped mid-play."""

import sys
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "skills" / "shared" / "scripts"))
sys.path.insert(0, str(REPO / "tests"))

import schema_rules  # noqa: E402
import vaultlib as vl  # noqa: E402
from test_vw_scene_chapter_new import make_vault, run, snapshot  # noqa: E402

CH = "Chapters/Chapter 1"
S5 = "Session 05 - Beneath the Mill"
S6 = "Session 06 - The Weir"
FILES = {
    f"{CH}/Chapter 1.md": "---\ntype: chapter\ntitle: One\n---\n",
    "Chapters/Chapter 2/Chapter 2.md": "---\ntype: chapter\ntitle: Two\n---\n",
    f"{CH}/Sessions/{S5}.md":
        '---\ntype: session\nsession_number: 5\nchapter: "[[Chapter 1]]"\n'
        "---\n",
    f"{CH}/Sessions/{S6}.md":
        '---\ntype: session\nsession_number: 6\nchapter: "[[Chapter 1]]"\n'
        "---\n",
    "Sessions/Session 07 - Loose.md":
        "---\ntype: session\nsession_number: 7\n---\n",
    "NPCs/Mill Ghost.md": "---\ntype: npc\n---\n",
}
SNAP = "Mara holds the door.\n\nThe ghost has not yet spoken.\n"


def paused(case, *extra, scene="The Docks", session=S5, snap=SNAP):
    return run_in(case.vault, "scene-paused", "--scene", scene,
                  "--session", session, *extra, stdin=snap)


def run_in(vault, *argv, stdin=""):
    import io
    from unittest import mock
    import vault_write as vw
    out = io.StringIO()
    with mock.patch("sys.stdout", out), mock.patch("sys.stderr",
                                                   io.StringIO()):
        code = vw.main([str(vault), *argv], stdin=stdin)
    return code, out.getvalue()


class PausedBase(unittest.TestCase):
    def setUp(self):
        self.vault = make_vault(self, FILES)
        run(self.vault, "scene-new", "--chapter", "Chapter 1", "--title",
            "The Docks", "--write")
        self.rel = f"{CH}/Scenes/The Docks.md"

    def text(self):
        return (self.vault / self.rel).read_bytes().decode("utf-8")


class ExistingSceneTests(PausedBase):
    def test_dry_run_changes_nothing(self):
        before = snapshot(self.vault)
        code, out = paused(self)
        self.assertEqual(code, 0, out)
        self.assertIn(f"WOULD-ADD\t{self.rel}\t§Paused\t", out)
        self.assertEqual(snapshot(self.vault), before)

    def test_pause_existing_scene(self):
        code, out = paused(self, "--write")
        self.assertEqual(code, 0, out)
        self.assertIn(f"ADDED\t{self.rel}", out)
        text = self.text()
        fm = vl.extract_frontmatter(text)
        self.assertEqual(fm["status"], "paused")
        self.assertEqual(fm["played_in"], [f"[[{S5}]]"])
        body = text.split("\n---\n", 1)[1]
        comment_end = body.index("-->") + 3
        self.assertTrue(body[comment_end:].startswith(
            f"\n\n## Paused\n\nAfter [[{S5}]].\n\nMara holds the door."))
        self.assertLess(body.index("## Paused"), body.index("**Situation"))
        self.assertIn("The ghost has not yet spoken.\n<!-- /paused -->"
                      "\n\n**Situation:**", body)

    def test_only_status_played_in_and_paused_change(self):
        before = self.text()
        paused(self, "--write")
        after = self.text()
        sec_start = after.index("## Paused")
        sec_end = after.index("**Situation")
        rest = after[:sec_start] + after[sec_end:]
        want = (before.replace("status: planned", "status: paused")
                .replace("played_in: []",
                         f'played_in:\n  - "[[{S5}]]"'))
        self.assertEqual(rest, want)
        for keep in ("**Starts it:**", "<!-- gm-only -->", "## GM Notes",
                     "<!-- /gm-only -->", "entities: []",
                     "scene_type:"):
            self.assertIn(keep, after)

    def test_second_pause_replaces_in_place(self):
        # Part 1's overlay shape: the section sits at the end of the file,
        # after the closing gm-only marker.
        path = self.vault / self.rel
        path.write_bytes(path.read_bytes() + (
            f"\n## Paused\n\nAfter [[{S5}]].\n\nOld words.\n").encode())
        code, _ = paused(self, "--write", session=S5, snap="Old words.")
        before = self.text()
        code, out = paused(self, "--write", session=S6, snap="New words.")
        self.assertEqual(code, 0, out)
        self.assertIn(f"replaces the snapshot after [[{S5}]]", out)
        after = self.text()
        self.assertEqual(after.count("## Paused"), 1)
        self.assertTrue(after.endswith(
            f"\n## Paused\n\nAfter [[{S6}]].\n\nNew words.\n<!-- /paused -->\n"), after)
        fm = vl.extract_frontmatter(after)
        self.assertEqual(fm["played_in"], [f"[[{S5}]]", f"[[{S6}]]"])
        head = before[:before.index("\n---\n", 4)]
        body_before = before.split("\n---\n", 1)[1]
        body_after = after.split("\n---\n", 1)[1]
        self.assertEqual(body_after[:body_after.index("## Paused")],
                         body_before[:body_before.index("## Paused")])
        self.assertIn("status: paused", head)

    def test_replace_keeps_what_follows_a_section_at_the_top(self):
        paused(self, "--write", snap="One.")
        paused(self, "--write", session=S6, snap="Two.")
        after = self.text()
        self.assertEqual(after.count("## Paused"), 1)
        self.assertIn(f"After [[{S6}]].\n\nTwo.\n<!-- /paused -->\n\n**Situation:**", after)
        self.assertIn("<!-- gm-only -->\n\n## GM Notes", after)
        self.assertNotIn("One.", after)

    def test_prep_without_template_labels_survives_two_pauses(self):
        path = self.vault / self.rel
        head = path.read_bytes().split(b"\n---\n", 1)[0]
        prep = "\nGM prose line.\n\n### Beats\n- one\n- two\n"
        path.write_bytes(head + b"\n---\n" + prep.encode())
        paused(self, "--write", snap="First.")
        paused(self, "--write", session=S6, snap="Second.")
        text = self.text()
        self.assertEqual(text.count("## Paused"), 1)
        tail = "\n<!-- /paused -->\n\nGM prose line.\n\n### Beats\n" \
               "- one\n- two\n"
        self.assertTrue(text.endswith(tail), text)
        self.assertNotIn("First.", text)
        self.assertIn("Second.", text)
        paused(self, "--write", session=S5, snap="Third.")
        self.assertTrue(self.text().endswith(tail))

    def test_top_section_ends_at_its_marker_before_template_prep(self):
        paused(self, "--write")
        text = self.text()
        self.assertIn("\n<!-- /paused -->\n\n**Situation:**", text)
        self.assertIn("<!-- gm-only -->\n\n## GM Notes", text)

    def test_marker_less_old_section_at_end_still_replaced(self):
        path = self.vault / self.rel
        path.write_bytes(path.read_bytes() + b"\n## Paused\n\nOld.\n")
        paused(self, "--write", snap="New.")
        text = self.text()
        self.assertEqual(text.count("## Paused"), 1)
        self.assertTrue(text.endswith("New.\n<!-- /paused -->\n"), text)
        self.assertIn("**Situation:**", text)

    def test_marker_less_section_above_prep_is_left_and_warned(self):
        # The reviewer's repro: the GM deletes the end line, then pauses
        # again. The old section's fallback span runs over Situation and
        # Starts it, so it must not be replaced.
        paused(self, "--write", snap="Mara holds the door.")
        path = self.vault / self.rel
        text = self.text().replace("<!-- /paused -->\n", "")
        path.write_bytes(text.encode())
        code, out = paused(self, "--write", session=S6, snap="Round 3.")
        self.assertEqual(code, 0, out)
        after = self.text()
        self.assertIn("**Situation:**", after)
        self.assertIn("**Starts it:**", after)
        self.assertIn("Mara holds the door.", after)
        self.assertEqual(after.count("## Paused"), 2)
        first = after.index("## Paused")
        self.assertTrue(after[first:].startswith(
            f"## Paused\n\nAfter [[{S6}]].\n\nRound 3.\n<!-- /paused -->\n"),
            after)
        self.assertIn(f"WARNING\t{self.rel}\t", out)
        lines = after.splitlines()
        old_line = lines.index("## Paused", lines.index("## Paused") + 1) + 1
        self.assertIn(f"line {old_line}", out)
        self.assertIn("no end line was left as it is", out)
        self.assertEqual(vl.split_paused(after.split("\n---\n", 1)[1])[0],
                         f"After [[{S6}]].\n\nRound 3.")

    def test_open_fence_in_snapshot_is_closed_with_a_warning(self):
        code, out = paused(self, "--write", snap="Look:\n```\nunclosed")
        self.assertEqual(code, 0, out)
        self.assertIn("WARNING", out)
        self.assertIn("unclosed\n```\n<!-- /paused -->\n", self.text())

    def test_several_scenes_of_one_name_refused(self):
        other = "Chapters/Chapter 2/Scenes/The Docks.md"
        (self.vault / other).parent.mkdir(parents=True)
        (self.vault / other).write_bytes((self.vault / self.rel).read_bytes())
        before = snapshot(self.vault)
        for extra in ((), ("--new",)):
            code, out = paused(self, "--write", *extra)
            self.assertEqual(code, 1, out)
            self.assertIn(other, out)
            self.assertIn(self.rel, out)
        self.assertEqual(snapshot(self.vault), before)

    def test_chapter_and_folder_need_new(self):
        before = snapshot(self.vault)
        for extra in (("--chapter", "Chapter 2"), ("--folder", "X")):
            code, out = paused(self, "--write", *extra)
            self.assertEqual(code, 1, out)
            self.assertIn("--new", out)
        self.assertEqual(snapshot(self.vault), before)

    def test_end_marker_typed_in_snapshot_is_dropped(self):
        snap = "Before.\n<!-- /paused -->\nTail.\n```\n<!-- /paused -->\n```\n"
        code, out = paused(self, "--write", snap=snap)
        self.assertEqual(code, 0, out)
        self.assertTrue(any(r.startswith("WARNING") and "line 2" in r
                            for r in out.splitlines()), out)
        paused(self, "--write", session=S6, snap="Second.")
        text = self.text()
        self.assertEqual(text.count("## Paused"), 1)
        self.assertNotIn("Tail.", text)
        self.assertNotIn("Before.", text)
        self.assertEqual(text.count("<!-- /paused -->"), 1)
        self.assertIn("Second.\n<!-- /paused -->\n\n**Situation:**", text)
        paused(self, "--write", snap=snap)
        text = self.text()
        self.assertIn("Tail.\n```\n<!-- /paused -->\n```\n<!-- /paused -->"
                      "\n\n**Situation:**", text)
        paused(self, "--write", session=S6, snap="Again.")
        self.assertNotIn("Tail.", self.text())

    def test_headings_demoted(self):
        snap = "## Initiative\nMara first.\n\n```\n## x\n```\n# Top\n"
        code, out = paused(self, "--write", snap=snap)
        self.assertEqual(code, 0, out)
        text = self.text()
        self.assertIn("\n### Initiative\nMara first.\n", text)
        self.assertIn("\n```\n## x\n```\n### Top\n", text)
        warnings = [r for r in out.splitlines() if r.startswith("WARNING")]
        self.assertEqual(len(warnings), 3, out)
        self.assertTrue(any("line 1" in w for w in warnings))
        self.assertTrue(any("line 5" in w and "fence" in w
                            for w in warnings))

    def test_unknown_scene_without_new_refused(self):
        before = snapshot(self.vault)
        code, out = paused(self, "--write", scene="Nowhere")
        self.assertEqual(code, 1, out)
        self.assertIn("no scene note named 'Nowhere'", out)
        self.assertIn("--new", out)
        self.assertEqual(snapshot(self.vault), before)

    def test_empty_stdin_refused(self):
        before = snapshot(self.vault)
        for snap in ("", "  \n\n"):
            code, out = paused(self, "--write", snap=snap)
            self.assertEqual(code, 1, out)
            self.assertIn("nothing to write", out)
        self.assertEqual(snapshot(self.vault), before)

    def test_crlf_kept(self):
        path = self.vault / self.rel
        path.write_bytes(path.read_bytes().replace(b"\n", b"\r\n"))
        code, out = paused(self, "--write", snap="Line one.\nLine two.")
        self.assertEqual(code, 0, out)
        raw = path.read_bytes()
        self.assertNotIn(b"\n", raw.replace(b"\r\n", b""))
        self.assertIn(b"## Paused\r\n\r\nAfter [[", raw)
        paused(self, "--write", session=S6, snap="Again.")
        raw = path.read_bytes()
        self.assertNotIn(b"\n", raw.replace(b"\r\n", b""))
        self.assertEqual(raw.count(b"## Paused"), 1)

    def test_identical_is_skip(self):
        paused(self, "--write")
        before = snapshot(self.vault)
        for extra in ((), ("--write",)):
            code, out = paused(self, *extra)
            self.assertEqual(code, 0, out)
            self.assertIn(f"SKIP\t{self.rel}", out)
            self.assertNotIn("ADD", out)
        self.assertEqual(snapshot(self.vault), before)


class NewSceneTests(unittest.TestCase):
    def setUp(self):
        self.vault = make_vault(self, FILES)

    def test_new_files_scene_in_session_chapter(self):
        code, out = paused(self, "--new", "--write", scene="The Weir Fight")
        self.assertEqual(code, 0, out)
        rel = f"{CH}/Scenes/The Weir Fight.md"
        self.assertIn(f"CREATED\t{rel}\t§Paused", out)
        text = (self.vault / rel).read_text("utf-8")
        fm = vl.extract_frontmatter(text)
        self.assertEqual(fm["type"], "scene")
        self.assertEqual(fm["status"], "paused")
        self.assertEqual(fm["played_in"], [f"[[{S5}]]"])
        self.assertIn('chapter: "[[Chapter 1]]"', text)
        body = text.split("\n---\n", 1)[1]
        self.assertTrue(body.startswith("\n## Paused\n\nAfter [["), body)
        self.assertNotIn("Situation", body)
        self.assertNotIn("gm-only", body)
        self.assertEqual(
            [m for lvl, m in schema_rules.frontmatter_findings(
                fm, None, vl.raw_frontmatter(text)) if lvl == "ERROR"], [])
        self.assertNotIn("WARNING", out)

    def test_dry_run_creates_nothing(self):
        before = snapshot(self.vault)
        code, out = paused(self, "--new", scene="Fresh")
        self.assertEqual(code, 0, out)
        self.assertIn("WOULD-CREATE", out)
        self.assertEqual(snapshot(self.vault), before)

    def test_new_with_chapter_and_folder(self):
        code, out = paused(self, "--new", "--chapter", "Chapter 2",
                           "--folder", "Side_Adventures/X", "--write",
                           scene="Detour")
        self.assertEqual(code, 0, out)
        rel = "Chapters/Chapter 2/Side_Adventures/X/Scenes/Detour.md"
        text = (self.vault / rel).read_text("utf-8")
        self.assertIn('chapter: "[[Chapter 2]]"', text)

    def test_new_refused_when_scene_exists(self):
        run(self.vault, "scene-new", "--chapter", "Chapter 1", "--title",
            "Taken", "--write")
        before = snapshot(self.vault)
        code, out = paused(self, "--new", "--write", scene="Taken")
        self.assertEqual(code, 1, out)
        self.assertIn("already exists at", out)
        self.assertIn("drop --new", out)
        self.assertEqual(snapshot(self.vault), before)

    def test_new_refused_on_stem_clash(self):
        before = snapshot(self.vault)
        code, out = paused(self, "--new", "--write", scene="Mill Ghost")
        self.assertEqual(code, 1, out)
        self.assertIn("NPCs/Mill Ghost.md", out)
        self.assertEqual(snapshot(self.vault), before)

    def test_new_falls_back_to_the_sessions_folder_chapter(self):
        path = self.vault / f"{CH}/Sessions/{S5}.md"
        path.write_text(path.read_text("utf-8").replace(
            "[[Chapter 1]]", "[[Chapter 1 - The Ashford Case]]"), "utf-8")
        code, out = paused(self, "--new", "--write", scene="Fallback")
        self.assertEqual(code, 0, out)
        text = (self.vault / f"{CH}/Scenes/Fallback.md").read_text("utf-8")
        self.assertIn('chapter: "[[Chapter 1]]"', text)

    def test_new_without_chapter_refused(self):
        before = snapshot(self.vault)
        code, out = paused(self, "--new", "--write", scene="Orphan",
                           session="Session 07 - Loose")
        self.assertEqual(code, 1, out)
        self.assertIn("chapter-new", out)
        self.assertEqual(snapshot(self.vault), before)


GM_SNAP = ("Mara holds the door.\n\n<!-- gm-only -->\nThe ghost is her "
           "mother.\n<!-- /gm-only -->\n\nRound 3, Mara next.\n")


class GmOnlyInSnapshotTests(PausedBase):
    """A snapshot may hold a balanced gm-only pair: its end marker, not
    the inner marker, ends the section, for the writer and every reader."""

    def sc(self, *args):
        import subprocess
        scripts = Path(__file__).resolve().parent.parent / "skills" / \
            "shared" / "scripts"
        return subprocess.run(
            [sys.executable, str(scripts / "session_context.py"),
             str(self.vault), *args], capture_output=True, text=True,
            timeout=60)

    def body(self):
        return self.text().split("\n---\n", 1)[1]

    def test_span_runs_to_the_end_marker(self):
        paused(self, "--write", snap=GM_SNAP)
        got, rest = vl.split_paused(self.body())
        self.assertIn("The ghost is her mother.", got)
        self.assertTrue(got.endswith("Round 3, Mara next."), got)
        self.assertNotIn("/paused", rest)
        self.assertNotIn("ghost", rest)

    def test_prep_and_play_print_the_whole_snapshot(self):
        paused(self, "--write", snap=GM_SNAP)
        for flag in ("--prep", "--play"):
            out = self.sc(flag).stdout
            self.assertIn("Round 3, Mara next.", out, flag)
            self.assertIn("The ghost is her mother.", out, flag)
            self.assertNotIn("/paused", out, flag)

    def test_pausing_twice_leaves_no_junk(self):
        paused(self, "--write", snap=GM_SNAP)
        first = vl.split_paused(self.body())[1]
        paused(self, "--write", session=S6, snap="New snapshot.\n")
        text = self.text()
        self.assertEqual(text.count("## Paused"), 1)
        self.assertEqual(text.count("<!-- /paused -->"), 1)
        for gone in ("Round 3", "ghost is her mother"):
            self.assertNotIn(gone, text)
        self.assertEqual(text.count("<!-- gm-only -->"),
                         text.count("<!-- /gm-only -->"))
        got, second = vl.split_paused(self.body())
        self.assertEqual(got, f"After [[{S6}]].\n\nNew snapshot.")
        self.assertEqual(first, second)

    def test_older_section_without_end_marker_keeps_the_old_rule(self):
        lines = ["## Paused\n", "Old words.\n", "<!-- gm-only -->\n",
                 "secret\n", "<!-- /gm-only -->\n"]
        self.assertEqual(vl.paused_span(lines), (0, 2))
        lines = ["## Paused\n", "Old.\n", "\n", "## Next\n", "x\n"]
        self.assertEqual(vl.paused_span(lines), (0, 2))
        lines = ["## Paused\n", "Old.\n", "## Next\n", "<!-- /paused -->\n"]
        self.assertEqual(vl.paused_span(lines), (0, 2))

    def test_end_marker_in_a_code_fence_does_not_count(self):
        lines = ["## Paused\n", "Old.\n", "```\n", "<!-- /paused -->\n",
                 "```\n", "## Next\n"]
        self.assertEqual(vl.paused_span(lines), (0, 5))


if __name__ == "__main__":
    unittest.main()
