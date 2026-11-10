#!/usr/bin/env python3
"""session_context prints a PC section with `###` subsections as an outline
plus a fetch line; a section without them prints exactly as before.

Run: python3 tests/test_session_context_layered.py
"""

import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "skills" / "shared" / "scripts"
FIXTURE = ROOT / "tests" / "fixtures" / "layered-reads"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))
import session_context as sctx  # noqa: E402
import vaultlib as vl  # noqa: E402

NEEDS_NODE = unittest.skipUnless(shutil.which("node"), "needs node")

OUTLINE_RE = re.compile(r"^#{3,} .*\((\d+) words; (\S+): (.+)\)$", re.M)

# The plain PC's blocks, as the bundle printed them before outlines existed.
COLE_STATUS = (
    "--- Cole_Plain (PCs/Cole_Plain.md, asOfSession: 3) ---\n"
    "**Location:** Harrow Ford\n"
    "**Open threads:**\n"
    "- **Cole's borrowed boat** — due back at dawn\n"
    "\n"
    "Cole is tired and wet.\n")
COLE_ARCS = (
    "--- Cole_Plain (PCs/Cole_Plain.md, player: Jo) ---\n"
    "## Background\n"
    "A ferry hand with no secrets worth the name.\n"
    "## GM Notes\n"
    "Cole will say yes to almost anything before breakfast.\n"
    "Spotlight history")


def sc(*args, vault=FIXTURE):
    return subprocess.run(
        [sys.executable, str(SCRIPTS / "session_context.py"), str(vault),
         *args], capture_output=True, text=True)


def fetch(note, path, vault=FIXTURE):
    return subprocess.run(
        [sys.executable, str(SCRIPTS / "section.py"), str(vault), note,
         path], capture_output=True, text=True)


def copy_vault(case) -> Path:
    root = Path(tempfile.mkdtemp(prefix="layered-"))
    case.addCleanup(shutil.rmtree, root, ignore_errors=True)
    vault = root / "vault"
    shutil.copytree(FIXTURE, vault)
    return vault


@NEEDS_NODE
class LayeredTests(unittest.TestCase):
    def test_no_subsections_prints_unchanged(self):
        for args in (("--brief",), (), ("--prep",)):
            with self.subTest(args=args):
                r = sc(*args)
                self.assertEqual(r.returncode, 0, r.stderr)
                self.assertIn(COLE_STATUS, r.stdout)
        r = sc("--arcs")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn(COLE_ARCS, r.stdout)

    def test_session_log_is_outlined_in_active_pcs(self):
        out = sc("--brief").stdout
        ada = out.split("--- Ada_Quill")[1].split("--- Cole_Plain")[0]
        self.assertIn("**Open threads:**\n- **The torn page**", ada)
        self.assertIn("### Session Log  (", ada)
        self.assertIn("Ada_Quill: Current Status/Session Log)", ada)
        self.assertIn("### Wounds  (", ada)
        self.assertNotIn("She crossed the ford at night", ada)
        self.assertNotIn("split lip", ada)

    def test_gm_notes_subsections_outlined_in_arcs(self):
        out = sc("--arcs").stdout
        ada = out.split("--- Ada_Quill")[1].split("--- Cole_Plain")[0]
        self.assertIn("A lamp-trimmer's daughter", ada)   # Background whole
        self.assertIn("Ada is the one who can tell", ada)  # preamble kept
        self.assertIn("### Secrets  (", ada)
        self.assertIn("### Hooks  (", ada)
        self.assertIn("Ada_Quill: GM Notes/Hooks)", ada)
        self.assertNotIn("knows whose hand wrote it", ada)
        self.assertNotIn("#### Hook detail", ada)       # folded, no own line

    def test_outline_paths_fetch_their_subsection(self):
        out = sc("--brief").stdout + sc("--arcs").stdout
        found = OUTLINE_RE.findall(out)
        self.assertGreaterEqual(len(found), 5)
        for words, note, path in found:
            with self.subTest(path=path):
                r = fetch(note, path)
                self.assertEqual(r.returncode, 0, r.stderr)
                title = path.rsplit("/", 1)[1]
                self.assertTrue(r.stdout.startswith(f"### {title}\n"),
                                r.stdout)
                body = r.stdout.split("\n", 1)[1]
                self.assertEqual(vl.word_count(body), int(words))

    def test_slash_title_outline_line_fetches_it(self):
        note = ("---\ntype: pc\nstatus: active\n---\n# Zed\n\n"
                "## Current Status\n\nTop text.\n\n"
                "### Allies/Enemies\n\nfriends and foes here\n\n"
                "### Plain\n\nother words\n")
        vault = copy_vault(self)
        (vault / "PCs" / "Zed.md").write_text(note, encoding="utf-8")
        out = sc("--brief", vault=vault).stdout
        m = [x for x in OUTLINE_RE.findall(out) if x[1] == "Zed"]
        self.assertEqual(m[0][2], "Current Status/Allies/Enemies")
        r = fetch("Zed", m[0][2], vault=vault)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(r.stdout.startswith("### Allies/Enemies\n"))
        self.assertIn("friends and foes", r.stdout)
        self.assertNotIn("other words", r.stdout)

    def test_blank_line_before_the_outline_kept(self):
        out = sc("--brief").stdout
        ada = out.split("--- Ada_Quill")[1].split("--- Cole_Plain")[0]
        self.assertIn("others\n\n### Session Log  (", ada)

    def test_shared_name_is_named_by_path(self):
        vault = copy_vault(self)
        other = vault / "PCs" / "_resources"
        other.mkdir()
        (other / "Ada_Quill.md").write_text(
            "# Ada Quill\n\nA handout.\n", encoding="utf-8")
        found = []
        for args in (("--brief",), ("--arcs",)):
            out = sc(*args, vault=vault).stdout
            self.assertEqual(out.count("gma section "), 1, out)
            found += OUTLINE_RE.findall(out)
        names = {n for _, n, _ in found}
        self.assertIn("PCs/Ada_Quill", names)       # shared name: its path
        self.assertGreaterEqual(len(found), 5)
        for words, note, path in found:
            with self.subTest(note=note, path=path):
                r = fetch(note, path, vault=vault)
                self.assertEqual(r.returncode, 0, r.stderr)
                self.assertTrue(r.stdout.startswith(
                    "### " + path.rsplit("/", 1)[1] + "\n"))
                body = r.stdout.split("\n", 1)[1]
                self.assertEqual(vl.word_count(body), int(words))

    def test_every_printed_path_fetches_with_repeats_and_spaced_slashes(self):
        note = ("---\ntype: pc\nstatus: active\n---\n# Zed\n\n"
                "## Current Status\n\nTop.\n\n"
                "### Notes\n\none\n\n### Notes\n\ntwo\n\n"
                "### Allies / Enemies\n\nfriends\n\n### Solo\n\nthree\n")
        vault = copy_vault(self)
        (vault / "PCs" / "Zed.md").write_text(note, encoding="utf-8")
        out = sc("--brief", vault=vault).stdout
        found = [x for x in OUTLINE_RE.findall(out) if x[1] == "Zed"]
        self.assertEqual(len(found), 4)
        for words, name, path in found:
            with self.subTest(path=path):
                r = fetch(name, path, vault=vault)
                self.assertEqual(r.returncode, 0, r.stderr)
        both = fetch("Zed", "Current Status", vault=vault).stdout
        self.assertIn("one", both)
        self.assertIn("two", both)

    def test_open_threads_never_outlined(self):
        out = sc("--brief").stdout
        ada = out.split("--- Ada_Quill")[1].split("--- Cole_Plain")[0]
        self.assertIn("**Open threads:**\n- **The torn page**", ada)
        self.assertNotRegex(ada, r"(?i)open threads.*\(\d+ words")

    def test_fetch_line_printed_once(self):
        for args in (("--brief",), ("--arcs",), ("--prep",), ()):
            with self.subTest(args=args):
                out = sc(*args).stdout
                self.assertEqual(out.count("gma section "), 1, out)

    def test_no_fetch_line_when_nothing_outlined(self):
        out = subprocess.run(
            [sys.executable, str(SCRIPTS / "session_context.py"),
             str(FIXTURE), "--threads"], capture_output=True, text=True)
        self.assertNotIn("gma section ", out.stdout)


class LayeredUnitTests(unittest.TestCase):
    def test_crlf_outline_has_no_mixed_endings(self):
        body = ("Top text.\r\n\r\n### One\r\nalpha beta\r\n\r\n"
                "### Two\r\ngamma\r\n")
        text, outlined = sctx.layered(body, "Zed", "Current Status")
        self.assertTrue(outlined)
        self.assertEqual(
            text,
            "Top text.\r\n\r\n"
            "### One  (2 words; Zed: Current Status/One)\r\n"
            "### Two  (1 words; Zed: Current Status/Two)")
        self.assertNotRegex(text, r"(?<!\r)\n")

    def test_crlf_multi_line_preamble_keeps_single_returns(self):
        body = ("Line A.\r\nLine B.\r\n\r\n### One\r\nalpha beta\r\n\r\n"
                "### Two\r\ngamma\r\n")
        text, _ = sctx.layered(body, "Zed", "Current Status")
        self.assertTrue(text.startswith("Line A.\r\nLine B.\r\n\r\n### One"),
                        repr(text))
        self.assertNotIn("\r\r", text)
        self.assertNotRegex(text, r"(?<!\r)\n")

    def test_subsection_holding_the_open_threads_label_prints_whole(self):
        body = ("Top.\n\n### Quiet\nsome words\n\n### Late\n"
                "**Open threads:**\n- **The key** \u2014 still missing\n")
        text, outlined = sctx.layered(body, "Zed", "Current Status")
        self.assertTrue(outlined)
        self.assertIn("### Late\n**Open threads:**\n- **The key**", text)
        self.assertIn("### Quiet  (2 words; Zed: Current Status/Quiet)", text)
        text, outlined = sctx.layered("### Late\n- **Open threads:**\n- A\n",
                                      "Zed", "Current Status")
        self.assertFalse(outlined)
        self.assertEqual(text, "### Late\n- **Open threads:**\n- A")

    def test_repeated_title_names_the_section(self):
        body = "### Notes\none\n### Notes\ntwo\n### Solo\nthree\n"
        text, _ = sctx.layered(body, "Zed", "Current Status")
        self.assertEqual(text.count("Zed: Current Status)"), 2)
        self.assertIn("### Solo  (1 words; Zed: Current Status/Solo)", text)

    def test_note_names_are_read_once_from_the_bundle_files(self):
        import section as section_cmd
        calls = []
        real = section_cmd.name_index
        real_walk = vl.vault_files
        section_cmd.name_index = lambda b: calls.append(1) or real(b)

        def no_walk(*a, **k):
            raise AssertionError("walked the vault again")
        vl.vault_files = no_walk
        try:
            outlines = sctx.Outlines()
            outlines.files = [("PCs/Ada_Quill.md", "", {}),
                              ("PCs/Cole_Plain.md", "", {})]
            for rel in ("PCs/Ada_Quill.md", "PCs/Cole_Plain.md"):
                outlines.note_ref(FIXTURE, rel)
        finally:
            section_cmd.name_index = real
            vl.vault_files = real_walk
        self.assertEqual(len(calls), 1)

    def test_comment_and_hidden_blocks_hold_no_subsections(self):
        for body in ("lead\n<!--\n### hint\nlong text\n-->\n",
                     "lead\n<!-- gm-only -->\n### secret\nx\n"
                     "<!-- /gm-only -->\n",
                     "lead\n%%\n### aside\nx\n%%\n"):
            with self.subTest(body=body):
                self.assertEqual(sctx.layered(body, "Zed", "Background"),
                                 (body, False))
        body = "lead\n<!--\n### hint\n-->\n### Real\nwords here\n"
        text, outlined = sctx.layered(body, "Zed", "Background")
        self.assertTrue(outlined)
        self.assertIn("<!--\n### hint\n-->\n### Real  (", text)

    def test_path_is_pinned_when_the_name_repeats_in_the_note(self):
        note = ("# Ada\n## Current Status\nLead text.\n### GM Notes\ncs gm\n"
                "## GM Notes\nintro\n### Hooks\nalpha\n### Solo\nz\n")
        body = "intro\n### Hooks\nalpha\n### Solo\nz"
        text, _ = sctx.layered(body, "Ada", "GM Notes", note)
        self.assertIn("Ada: GM Notes/Hooks)", text)  # unique final heading
        note2 = note + "### Hooks\nbeta\n"
        body2 = body + "\n### Hooks\nbeta"
        text, _ = sctx.layered(body2, "Ada", "GM Notes", note2)
        self.assertEqual(text.count("Ada: ## GM Notes)"), 2, text)

    def test_nothing_unique_prints_the_subsection_whole(self):
        note = ("# Ada\n## Current Status\n### Log\na\n"
                "## Current Status\n### Log\nb\n")
        text, outlined = sctx.layered("### Log\na", "Ada", "Current Status",
                                      note)
        self.assertFalse(outlined)
        self.assertEqual(text, "### Log\na")


@NEEDS_NODE
class PinnedPathTests(unittest.TestCase):
    ADA = ("---\ntype: pc\nstatus: active\nplayer: Jo\n---\n# Ada\n"
           "## Current Status\nLead text.\n### GM Notes\ncs gm notes\n"
           "## GM Notes\nintro\n### Hooks\nalpha\n### Hooks\nbeta\n")

    def vault(self):
        vault = copy_vault(self)
        (vault / "PCs" / "Ada_Quill.md").write_text(self.ADA, encoding="utf-8")
        return vault

    def test_every_printed_path_fetches_one_span(self):
        vault = self.vault()
        out = sc("--arcs", vault=vault).stdout + sc("--brief",
                                                    vault=vault).stdout
        found = [x for x in OUTLINE_RE.findall(out) if x[1] == "Ada_Quill"]
        self.assertGreaterEqual(len(found), 2, out)
        for _w, name, path in found:
            with self.subTest(path=path):
                r = fetch(name, path, vault=vault)
                self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("Ada_Quill: ## GM Notes)", out)

    def test_leading_marks_pin_the_level(self):
        vault = self.vault()
        r = fetch("Ada_Quill", "GM Notes", vault=vault)
        self.assertEqual(r.returncode, 1)
        r = fetch("Ada_Quill", "## GM Notes", vault=vault)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(r.stdout.startswith("## GM Notes\n"))
        self.assertIn("beta", r.stdout)
        self.assertNotIn("cs gm notes", r.stdout)

    def test_refusal_names_the_parent_when_no_path_helps(self):
        vault = self.vault()
        r = fetch("Ada_Quill", "## GM Notes/Hooks", vault=vault)
        self.assertEqual(r.returncode, 1)
        self.assertIn("fetch the parent section", r.stderr)
        self.assertNotIn("longer path", r.stderr)
        r = fetch("Ada_Quill", "GM Notes", vault=vault)
        self.assertIn("longer path", r.stderr)

    def test_outlined_span_is_the_fetched_span_past_a_hidden_heading(self):
        note = ("---\ntype: pc\nstatus: active\nplayer: Jo\n---\n# Ada\n"
                "## Current Status\nLead.\n### A\none two\n<!--\n### B\n"
                "hidden words\n-->\nthree four\n### C\nfive\n"
                "#### Deep\nsix seven\n")
        vault = copy_vault(self)
        (vault / "PCs" / "Ada_Quill.md").write_text(note, encoding="utf-8")
        out = sc("--brief", vault=vault).stdout
        ada = out.split("--- Ada_Quill")[1].split("--- Cole_Plain")[0]
        found = OUTLINE_RE.findall(ada)
        self.assertEqual([p for _w, _n, p in found],
                         ["Current Status/C"], ada)
        self.assertIn("three four", ada)            # A printed whole
        for words, name, path in found:
            r = fetch(name, path, vault=vault)
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertEqual(vl.word_count(r.stdout.split("\n", 1)[1]),
                             int(words))

    def test_two_current_status_sections(self):
        note = ("---\ntype: pc\nstatus: active\nplayer: Jo\n---\n# Ada\n"
                "## Current Status\nLead.\n### Log\na\n### Only\nx\n"
                "## Current Status\nAgain.\n### Log\nb\n")
        vault = copy_vault(self)
        (vault / "PCs" / "Ada_Quill.md").write_text(note, encoding="utf-8")
        out = sc("--brief", vault=vault).stdout
        ada = out.split("--- Ada_Quill")[1].split("--- Cole_Plain")[0]
        for _w, name, path in OUTLINE_RE.findall(ada):
            r = fetch(name, path, vault=vault)
            self.assertEqual(r.returncode, 0, (path, r.stderr))
        self.assertIn("### Only  (", ada)           # unique: outlined
        self.assertIn("### Log\na", ada)            # not unique: whole


@NEEDS_NODE
class PrepLeavesOutTests(unittest.TestCase):
    """--prep leaves out what no prep plan used: the PCs' Backgrounds and
    the deferred world flags. --arcs and the default bundle keep them."""

    def arcs(self, out):
        return out.split("===== PC Arcs")[1].split("===== Scene Queue")[0]

    def test_prep_has_gm_notes_but_no_background(self):
        arcs = self.arcs(sc("--prep").stdout)
        self.assertNotIn("## Background", arcs)
        self.assertNotIn("A lamp-trimmer's daughter", arcs)
        self.assertNotIn("A ferry hand with no secrets", arcs)
        self.assertIn("## GM Notes\nCole will say yes", arcs)
        self.assertIn("Ada is the one who can tell", arcs)
        self.assertIn("Ada_Quill: GM Notes/Hooks)", arcs)
        self.assertIn("Spotlight history", arcs)

    def test_arcs_still_prints_background(self):
        out = sc("--arcs").stdout
        self.assertIn(COLE_ARCS, out)
        self.assertIn("A lamp-trimmer's daughter", out)

    def test_world_flags_only_outside_prep(self):
        vault = copy_vault(self)
        (vault / "_World").mkdir()
        (vault / "_World" / "_flags.md").write_text(
            "# Flags\n\n## Deferred\n\n- Who owns the toll house.\n",
            encoding="utf-8")
        prep = sc("--prep", vault=vault).stdout
        self.assertNotIn("World Flags", prep)
        self.assertNotIn("toll house", prep)
        brief = sc("--brief", vault=vault).stdout
        self.assertIn("===== World Flags — Deferred =====", brief)
        self.assertIn("Who owns the toll house.", brief)


class MapTests(unittest.TestCase):
    """--prep's Map: where the linked notes and latest sessions are."""

    def note(self, rel, fm, body=""):
        return (rel, "---\n---\n" + body, fm)

    def test_map_lists_linked_notes_and_latest_sessions(self):
        ch = {"chapter": "[[Chapter 1]]"}
        wrap_body = ("[[Bo]] met [[Ada]] at [[The Ford|the ford]]; "
                     "[[Nowhere]]; [[Twin]]\n\n#### Resolved Threads\n\n"
                     "- [[Gone]]\n\n## Next\n\n[[Bo]] again\n")
        wrap = self.note("Ch1/S5 Wrap.md",
                         {"type": "session_wrap", "session": "[[Session 5]]", **ch},
                         wrap_body)
        plan = self.note("Ch1/S6 Plan.md",
                         {"type": "session-plan", "session": "[[Session 6]]", **ch},
                         "[[Inn]] and [[Bo]]")
        files = [
            wrap, plan,
            self.note("NPCs/Bo.md", {"type": "npc"}, "one two three"),
            self.note("PCs/Ada.md", {"type": "pc"}, "x"),
            self.note("Places/The Ford.md", {"type": "location"}, "a b"),
            self.note("Places/Inn.md", {"type": "location"}, "c"),
            self.note("NPCs/Gone.md", {"type": "npc"}, "g"),
            self.note("A/Twin.md", {"type": "npc"}, "t"),
            self.note("B/Twin.md", {"type": "npc"}, "t"),
        ] + [self.note(f"Ch1/S{n} Plan.md",
                       {"type": "session-plan", "session_number": n, **ch},
                       "p") for n in (1, 2, 3, 4)] + [
            self.note("Ch2/S4 Plan.md", {"type": "session-plan",
                                         "session_number": 4,
                                         "chapter": "[[Chapter 2]]"}, "q")]
        out = sctx.map_report(files, wrap[:2], plan[:2], "chapter 1", 5)
        linked = out.split("--- Linked")[1].split("--- Latest")[0]
        self.assertEqual(
            [r.split("\t")[1] for r in linked.split("\n")[1:]
             if "\t" in r],
            ["NPCs/Bo.md", "Places/The Ford.md", "Places/Inn.md"])
        self.assertIn("npc\tNPCs/Bo.md\t3 words", linked)
        self.assertIn("(2 linked names have no single note)", linked)
        latest = out.split("--- Latest sessions ---")[1]
        self.assertIn("Session 5 wrap-up\tCh1/S5 Wrap.md", latest)
        self.assertIn("Session 4 plan\tCh1/S4 Plan.md", latest)
        self.assertIn("Session 3 plan\tCh1/S3 Plan.md", latest)
        self.assertNotIn("S2 Plan", latest)       # only the latest three
        self.assertNotIn("Ch2/", latest)          # this chapter only

    def test_prep_ends_with_the_map(self):
        out = sc("--prep").stdout
        self.assertIn("===== Map =====", out)
        self.assertIn("--- Latest sessions ---", out)


if __name__ == "__main__":
    unittest.main()
