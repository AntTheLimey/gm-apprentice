#!/usr/bin/env python3
"""links.py: broken links listed by kind, retargeted, and unlinked."""

import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parent.parent / "skills" / "shared" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import links  # noqa: E402
import vaultlib  # noqa: E402


def make_vault(case, files):
    vault = Path(tempfile.mkdtemp(prefix="links-"))
    case.addCleanup(shutil.rmtree, vault, ignore_errors=True)
    for rel, text in files.items():
        path = vault / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(text.encode("utf-8"))
    return vault


def read(vault, rel):
    return (vault / rel).read_bytes().decode("utf-8")


def cli(vault, *args):
    return subprocess.run(
        [sys.executable, str(SCRIPTS / "links.py"), str(vault), *args],
        capture_output=True, text=True, encoding="utf-8")


class ReportTests(unittest.TestCase):
    def one(self, files):
        rows, _ = links.report(make_vault(self, files))
        self.assertEqual(len(rows), 1, rows)
        return rows[0]

    def test_same_ignores_punctuation(self):
        row = self.one({"Locations/Dunmoor's Rest.md": "x\n",
                        "A.md": "[[Dunmoors Rest]]\n"})
        self.assertEqual(row.kind, "NEAR")
        self.assertEqual(row.candidates,
                         [("Locations/Dunmoor's Rest.md", "same")])

    def test_same_ignores_emoji_and_accents(self):
        row = self.one({"NPCs/Doctor_Jorund_Vale.md": "x\n",
                        "A.md": "[[🩸 Doctor Jórund Vale]]\n"})
        self.assertEqual(row.candidates,
                         [("NPCs/Doctor_Jorund_Vale.md", "same")])

    def test_close_is_a_likely_typo(self):
        row = self.one({"Locations/Barabazar.md": "x\n",
                        "A.md": "[[Bara Bazaar]]\n"})
        self.assertEqual(row.candidates, [("Locations/Barabazar.md", "close")])

    def test_part_is_extra_words_before_or_after(self):
        row = self.one({"NPCs/Corvin Hollis.md": "x\n",
                        "A.md": "[[Captain Corvin Hollis]]\n"})
        self.assertEqual(row.candidates, [("NPCs/Corvin Hollis.md", "part")])

    def test_a_copy_suffix_is_a_part_not_a_typo(self):
        row = self.one({"Vienna Summary.md": "x\n",
                        "A.md": "[[Vienna Summary 1]]\n"})
        self.assertEqual(row.candidates, [("Vienna Summary.md", "part")])

    def test_a_different_number_is_not_close(self):
        row = self.one({"S/Session_10_Plan.md": "x\n", "S/Session_12_Plan.md": "x\n",
                        "S/Session 2 Plan.md": "x\n",
                        "A.md": "[[Session_02_Plan]]\n"})
        self.assertEqual(row.candidates, [("S/Session 2 Plan.md", "close")])

    def test_same_letters_but_different_numbers_is_close_not_same(self):
        cases = [("Chapter_05_Overview.md", "Chapter 0.5 Overview"),
                 ("Scene 11.md", "Scene 1.1"),
                 ("Session 12 Plan.md", "Session 1-2 Plan")]
        for filename, link in cases:
            with self.subTest(link=link):
                row = self.one({filename: "x\n", "A.md": f"[[{link}]]\n"})
                self.assertEqual(row.candidates, [(filename, "close")])

    def test_names_that_differ_by_number_are_separate_rows(self):
        rows, _ = links.report(make_vault(self, {
            "A.md": "[[Chapter 0.5]]\n", "B.md": "[[Chapter 05]]\n"}))
        self.assertEqual([(r.kind, r.spellings) for r in rows], [
            ("UNWRITTEN", ["Chapter 0.5"]), ("UNWRITTEN", ["Chapter 05"])])

    def test_an_archived_note_is_not_a_candidate(self):
        row = self.one({"_archive/old/the-secret.md": "x\n",
                        "_QA/Secret Report.md": "x\n",
                        "A.md": "[[Secret]]\n"})
        self.assertEqual((row.kind, row.candidates), ("UNWRITTEN", []))

    def test_a_missing_attachment_is_a_file_row_listed_last(self):
        rows, _ = links.report(make_vault(self, {
            "NPCs/Marquise.md": "![[Marquise .PNG]]\n[[Bath Abbey]]\n"}))
        self.assertEqual([(r.kind, r.spellings, r.candidates) for r in rows], [
            ("UNWRITTEN", ["Bath Abbey"], []),
            ("FILE", ["Marquise .PNG"], [])])

    def test_a_short_name_is_not_a_part(self):
        row = self.one({"NPCs/Al.md": "x\n", "A.md": "[[Al Fitr]]\n"})
        self.assertEqual((row.kind, row.candidates), ("UNWRITTEN", []))

    def test_an_alias_makes_its_note_a_candidate(self):
        row = self.one({
            "Locations/Barabazar.md": "---\naliases:\n  - Burra Bazar\n---\nx\n",
            "A.md": "[[Burra Bazaar]]\n"})
        self.assertEqual(row.candidates, [("Locations/Barabazar.md", "close")])

    def test_best_candidate_first_and_at_most_three(self):
        row = self.one({
            "NPCs/Karsh.md": "x\n", "NPCs/Meribel Karsh.md": "x\n",
            "NPCs/Madame Karsh.md": "x\n", "Docs/Letter to Karsh.md": "x\n",
            "A.md": "[[karsh!]]\n"})
        self.assertEqual(row.candidates[0], ("NPCs/Karsh.md", "same"))
        self.assertEqual(len(row.candidates), 3)
        self.assertEqual({tag for _, tag in row.candidates[1:]}, {"part"})

    def test_spellings_of_one_unwritten_name_share_a_row(self):
        row = self.one({"A.md": "[[Eid al-Fitr]]\n", "B.md": "[[Eid al Fitr]]\n",
                        "C.md": "[[Eid al-Fitr|the feast]]\n"})
        self.assertEqual(row.kind, "UNWRITTEN")
        self.assertEqual(row.spellings, ["Eid al Fitr", "Eid al-Fitr"])
        self.assertEqual(row.sources, ["A.md", "B.md", "C.md"])

    def test_unchecked_sources_are_counted_not_listed(self):
        rows, unchecked = links.report(make_vault(self, {
            "A.md": "[[Bath Abbey]]\n",
            "_QA/R.md": "[[Bath Abbey]] [[Gone]]\n",
            "_archive/D.md": "[[Dropped]]\n"}))
        self.assertEqual([(r.spellings, r.sources) for r in rows],
                         [(["Bath Abbey"], ["A.md"])])
        self.assertEqual(unchecked, 2)

    def test_near_rows_first_then_most_linked(self):
        rows, _ = links.report(make_vault(self, {
            "Locations/Barabazar.md": "x\n",
            "A.md": "[[Zed]] [[Abbey]] [[Bara Bazaar]]\n",
            "B.md": "[[Zed]]\n"}))
        self.assertEqual([r.spellings[0] for r in rows],
                         ["Bara Bazaar", "Zed", "Abbey"])

    def test_lines(self):
        files = {"Locations/Barabazar.md": "x\n", "_QA/R.md": "[[Gone]]\n"}
        files.update({f"N{i}.md": "[[Bath Abbey]]\n" for i in range(7)})
        files["N0.md"] = "[[Bath Abbey]] [[Bara Bazaar]]\n"
        rows, unchecked = links.report(make_vault(self, files))
        self.assertEqual(links.report_lines(rows, unchecked), [
            "# broken: 2 names in 7 notes; not checked: _QA, _archive (1 name)",
            "NEAR\tBara Bazaar\t-> Locations/Barabazar.md (close)\t1 note: N0.md",
            "UNWRITTEN\tBath Abbey\t7 notes: N0.md, N1.md, N2.md, N3.md, N4.md,"
            " +2 more"])

    def test_cli_prints_the_report(self):
        vault = make_vault(self, {"A.md": "[[Bath Abbey]]\n"})
        got = cli(vault)
        self.assertEqual(got.returncode, 0, got.stderr)
        self.assertEqual(got.stdout.splitlines(), [
            "# broken: 1 name in 1 note; not checked: _QA, _archive (0 names)",
            "UNWRITTEN\tBath Abbey\t1 note: A.md"])

    def test_cli_prints_accents_and_emoji(self):
        vault = make_vault(self, {"A.md": "[[🩸 Émile]]\n"})
        got = cli(vault)
        self.assertEqual(got.returncode, 0, got.stderr)
        self.assertEqual(got.stdout.splitlines()[1],
                         "UNWRITTEN\t🩸 Émile\t1 note: A.md")

    def test_cli_refuses_a_missing_vault(self):
        got = cli(Path("/no/such/vault"))
        self.assertEqual(got.returncode, 2)
        self.assertIn("not a directory", got.stderr)


NOTE = "Locations/Barabazar.md"
# Frontmatter with a line that is not `key: value` shaped.
ODD_FM = '---\nfoo bar baz\nloc: "[[Bara Bazaar]]"\n---\n[[Bara Bazaar]]\n'


class RetargetTests(unittest.TestCase):
    def after(self, line, keep_text=False, extra=None, name="Bara Bazaar",
              note=NOTE):
        files = {NOTE: "x\n", "A.md": f"{line}\n"}
        files.update(extra or {})
        vault = make_vault(self, files)
        p = links.plan_retarget(vault, name, note, keep_text)
        return p.texts.get("A.md", "unchanged\n")[:-1]

    def test_every_form(self):
        cases = {
            "at [[Bara Bazaar]].": "at [[Barabazar]].",
            "[[bara_bazaar]]": "[[Barabazar]]",
            "[[Bara Bazaar|the market]]": "[[Barabazar|the market]]",
            "[[Bara Bazaar#Stalls]]": "[[Barabazar#Stalls]]",
            "[[Bara Bazaar^b1]]": "[[Barabazar^b1]]",
            "[[Old/Bara Bazaar.md]]": "[[Barabazar]]",
            "![[Bara Bazaar]]": "![[Barabazar]]",
            "| a | [[Bara Bazaar\\|B]] |": "| a | [[Barabazar\\|B]] |",
            "[[Bara Bazaar]] and [[Barabazar]]": "[[Barabazar]] and [[Barabazar]]",
        }
        for line, want in cases.items():
            with self.subTest(line=line):
                self.assertEqual(self.after(line), want)

    def test_keep_text_keeps_the_words(self):
        cases = {
            "at [[Bara Bazaar]].": "at [[Barabazar|Bara Bazaar]].",
            "[[Old/Bara Bazaar.md#Stalls]]": "[[Barabazar#Stalls|Bara Bazaar]]",
            "[[Bara Bazaar|the market]]": "[[Barabazar|the market]]",
            "| a | [[Bara Bazaar]] |": "| a | [[Barabazar\\|Bara Bazaar]] |",
            "![[Bara Bazaar]]": "![[Barabazar]]",
            "> | a | [[Bara Bazaar]] |": "> | a | [[Barabazar\\|Bara Bazaar]] |",
        }
        for line, want in cases.items():
            with self.subTest(line=line):
                self.assertEqual(self.after(line, keep_text=True), want)

    def test_unusual_frontmatter_is_still_frontmatter(self):
        vault = make_vault(self, {NOTE: "x\n", "A.md": ODD_FM})
        p = links.plan_retarget(vault, "Bara Bazaar", NOTE, keep_text=True)
        self.assertEqual(
            p.texts["A.md"],
            '---\nfoo bar baz\nloc: "[[Barabazar]]"\n---\n'
            '[[Barabazar|Bara Bazaar]]\n')

    def test_frontmatter_links_are_retargeted_without_display_text(self):
        vault = make_vault(self, {
            NOTE: "x\n",
            "A.md": '---\nlocation: "[[Bara Bazaar]]"\n---\n[[Bara Bazaar]]\n'})
        p = links.plan_retarget(vault, "Bara Bazaar", NOTE, keep_text=True)
        self.assertEqual(
            p.texts["A.md"],
            '---\nlocation: "[[Barabazar]]"\n---\n[[Barabazar|Bara Bazaar]]\n')

    def test_code_is_left_alone(self):
        vault = make_vault(self, {
            NOTE: "x\n",
            "A.md": "`[[Bara Bazaar]]` [[Bara Bazaar]]\n```\n[[Bara Bazaar]]\n```\n"})
        p = links.plan_retarget(vault, "Bara Bazaar", NOTE)
        self.assertEqual(
            p.texts["A.md"],
            "`[[Bara Bazaar]]` [[Barabazar]]\n```\n[[Bara Bazaar]]\n```\n")
        self.assertEqual([(c.rel, c.lineno, c.before, c.after) for c in p.changes],
                         [("A.md", 1, "[[Bara Bazaar]]", "[[Barabazar]]")])

    def test_a_shared_filename_is_written_as_a_path(self):
        got = self.after("[[Bara Bazaar]]",
                         extra={"Archive/Barabazar.md": "old\n"})
        self.assertEqual(got, "[[Locations/Barabazar]]")

    def test_name_and_note_match_however_they_are_typed(self):
        self.assertEqual(self.after("[[Bara Bazaar]]", name="bara_bazaar",
                                    note="barabazar"), "[[Barabazar]]")

    def test_a_decomposed_filename_matches_a_composed_path(self):
        import unicodedata
        stored = unicodedata.normalize("NFD", "NPCs/Émile.md")
        vault = make_vault(self, {stored: "x\n", "A.md": "[[Emile C]]\n"})
        p = links.plan_retarget(
            vault, "Emile C", unicodedata.normalize("NFC", "NPCs/Émile.md"))
        self.assertEqual(unicodedata.normalize("NFC", p.texts["A.md"]),
                         "[[Émile]]\n")

    def test_links_in_unchecked_folders_are_fixed_too(self):
        vault = make_vault(self, {NOTE: "x\n", "A.md": "[[Bara Bazaar]]\n",
                                  "_QA/R.md": "[[Bara Bazaar]]\n"})
        p = links.plan_retarget(vault, "Bara Bazaar", NOTE)
        self.assertEqual(sorted(p.texts), ["A.md", "_QA/R.md"])

    def test_crlf_survives(self):
        vault = make_vault(self, {NOTE: "x\n",
                                  "A.md": "one\r\n[[Bara Bazaar]]\r\nthree\r\n"})
        p = links.plan_retarget(vault, "Bara Bazaar", NOTE)
        links.apply(p)
        self.assertEqual(read(vault, "A.md"), "one\r\n[[Barabazar]]\r\nthree\r\n")

    def test_refusals(self):
        vault = make_vault(self, {
            NOTE: "x\n", "Real.md": "x\n", "Two/Same.md": "x\n",
            "One/Same.md": "x\n", "_Templates/T.md": "x\n",
            "A.md": "[[Bara Bazaar]] [[Real]]\n"})
        cases = [
            ("Real", NOTE, "is not a broken link"),
            ("Nobody Wrote This", NOTE, "is not a broken link"),
            ("Bara Bazaar", "Locations/Nowhere.md", "no note"),
            ("Bara Bazaar", "Nowhere", "no note"),
            ("Bara Bazaar", "_Templates/T.md", "no note"),
            ("Bara Bazaar", "Same", "give the path"),
        ]
        for name, note, said in cases:
            with self.subTest(name=name, note=note):
                with self.assertRaises((links.LinksError,
                                        links.RelinkError)) as cm:
                    links.plan_retarget(vault, name, note)
                self.assertIn(said, str(cm.exception))


class UnlinkTests(unittest.TestCase):
    def after(self, line):
        vault = make_vault(self, {"A.md": f"{line}\n"})
        p = links.plan_unlink(vault, ["Judo"])
        return p.texts.get("A.md", "unchanged\n")[:-1], p

    def test_every_form(self):
        cases = {
            "knows [[Judo]] well": "knows Judo well",
            "[[judo]]": "judo",
            "[[Judo|a judo throw]]": "a judo throw",
            "[[Judo#Rules]]": "Judo",
            "[[Rules/Judo.md]]": "Judo",
            "| [[Judo\\|throw]] | x |": "| throw | x |",
            "[[Judo|]]": "Judo",
            "**[[Judo]]-trained**": "**Judo-trained**",
        }
        for line, want in cases.items():
            with self.subTest(line=line):
                self.assertEqual(self.after(line)[0], want)

    def test_within_named_notes_a_link_to_an_existing_note_is_unlinked(self):
        # A published page names a note that has no page: the name becomes
        # words on that page, and every other note keeps its link.
        vault = make_vault(self, {
            "Plans/Dinner_Scene.md": "The scene.\n",
            "People/Host.md": "Seen at [[Dinner_Scene|the dinner]] and "
                              "[[Plans/Dinner_Scene]].\n",
            "People/Guest.md": "Also at [[Dinner_Scene|the dinner]].\n",
            "Plans/Plan.md": "Run [[Dinner_Scene]] first.\n"})
        with self.assertRaises(links.LinksError):
            links.plan_unlink(vault, ["Dinner_Scene"])
        p = links.plan_unlink(vault, ["Dinner_Scene"],
                              ["People/Host.md", "Guest"])
        self.assertEqual(p.texts, {
            "People/Host.md": "Seen at the dinner and Dinner_Scene.\n",
            "People/Guest.md": "Also at the dinner.\n"})
        links.apply(p)
        self.assertEqual(read(vault, "Plans/Plan.md"),
                         "Run [[Dinner_Scene]] first.\n")

    def test_a_link_to_a_withheld_note_is_not_turned_into_its_name(self):
        # Unlinking would write the secret name into the page: the link is kept
        # and listed until the GM gives the words with --as.
        vault = make_vault(self, {
            "People/Lord_Zorn.md": "---\ntype: npc\nwithheld: true\n---\n\nThe duke.\n",
            "People/Host.md": "Met [[Lord_Zorn]] and [[Lord_Zorn|the stranger]].\n"})
        p = links.plan_unlink(vault, ["Lord_Zorn"], ["People/Host.md"])
        self.assertEqual(p.texts["People/Host.md"],
                         "Met [[Lord_Zorn]] and the stranger.\n")
        shown = "\n".join(links.rows(p))
        self.assertIn("KEPT\tPeople/Host.md:1\t[[Lord_Zorn]]\tthe note is marked "
                      "withheld", shown)
        q = links.plan_unlink(vault, ["Lord_Zorn"], ["People/Host.md"],
                              "a stranger")
        self.assertEqual(q.texts["People/Host.md"],
                         "Met a stranger and the stranger.\n")
        self.assertEqual(q.kept, [])

    def test_the_guard_is_decided_per_name(self):
        vault = make_vault(self, {
            "People/Lord_Zorn.md": "---\ntype: npc\nwithheld: true\n---\n\nx\n",
            "People/Old_Gil.md": "---\ntype: npc\n---\n\ny\n",
            "People/Host.md": "Met [[Lord_Zorn]] and [[Old_Gil]].\n"})
        p = links.plan_unlink(vault, ["Lord_Zorn", "Old_Gil"], ["People/Host.md"])
        self.assertEqual(p.texts["People/Host.md"],
                         "Met [[Lord_Zorn]] and Old_Gil.\n")

    def test_a_name_that_is_an_alias_of_a_withheld_note_is_guarded_too(self):
        vault = make_vault(self, {
            "People/Lord_Zorn.md": "---\ntype: npc\nwithheld: true\n"
                                   "aliases: [Zorn the Pale]\n"
                                   "gm_aliases: [The Hollow Duke]\n---\n\nx\n",
            "People/Host.md": "Met [[Zorn the Pale]] and [[The Hollow Duke]] "
                              "and [[Zorn the Pale|him]].\n"})
        for name in ("Zorn the Pale", "The Hollow Duke"):
            with self.subTest(name=name):
                p = links.plan_unlink(vault, [name], ["People/Host.md"])
                self.assertNotIn(f"Met {name}", p.texts.get("People/Host.md", ""))
                self.assertIn(f"[[{name}]]\tthe note is marked withheld",
                              "\n".join(links.rows(p)))
        q = links.plan_unlink(vault, ["Zorn the Pale"], ["People/Host.md"], "a stranger")
        self.assertIn("Met a stranger and", q.texts["People/Host.md"])

    def test_the_flag_is_read_as_the_build_reads_it(self):
        # #352: the publish tool is asked, so a number YAML makes 1 (0x1, 1e0)
        # is a yes here as it is in the build, and a quoted one is not.
        for value, kept in (("0x1", True), ("1e0", True), ("true", True),
                            ('"0x1"', False), ("0", False)):
            with self.subTest(value=value):
                vault = make_vault(self, {
                    "People/Lord_Zorn.md": f"---\ntype: npc\nwithheld : {value}\n---\n\nx\n",
                    "People/Host.md": "Met [[Lord_Zorn]].\n"})
                p = links.plan_unlink(vault, ["Lord_Zorn"], ["People/Host.md"])
                self.assertEqual("[[Lord_Zorn]]" in p.texts.get("People/Host.md", "Met [[Lord_Zorn]].\n"), kept)

    def test_a_name_in_other_capitals_is_guarded(self):
        # #352: the name is matched as a link is, not as a path on disk, so a
        # case-sensitive file system makes no difference.
        vault = make_vault(self, {
            "People/Lord_Zorn.md": "---\ntype: npc\nwithheld: true\n---\n\nx\n",
            "People/Host.md": "Met [[people/lord_zorn]] and [[LORD ZORN]].\n"})
        p = links.plan_unlink(vault, ["people/lord_zorn", "LORD ZORN"], ["People/Host.md"])
        self.assertEqual(p.texts.get("People/Host.md"), None)
        self.assertEqual(len(p.kept), 2)

    def test_with_no_publish_tool_a_note_with_the_key_is_guarded(self):
        # Fails closed: a link is kept rather than its name printed.
        vault = make_vault(self, {
            "People/Lord_Zorn.md": "---\ntype: npc\nwithheld: false\n---\n\nx\n",
            "People/Host.md": "Met [[Lord_Zorn]].\n"})
        with mock.patch.object(links, "note_withheld",
                               side_effect=vaultlib.PublishToolUnavailable("no node")):
            p = links.plan_unlink(vault, ["Lord_Zorn"], ["People/Host.md"])
        self.assertEqual(p.texts.get("People/Host.md"), None)

    def test_a_note_that_is_not_withheld_is_unlinked_as_before(self):
        vault = make_vault(self, {
            "People/Lord_Zorn.md": "---\ntype: npc\nwithheld: false\n---\n\nx\n",
            "People/Host.md": "Met [[Lord_Zorn]].\n"})
        p = links.plan_unlink(vault, ["Lord_Zorn"], ["People/Host.md"])
        self.assertEqual(p.texts["People/Host.md"], "Met Lord_Zorn.\n")

    def test_as_gives_the_words_for_a_link_with_none_of_its_own(self):
        vault = make_vault(self, {
            "Plans/Dinner_Scene.md": "The scene.\n",
            "People/Host.md": "- [[Dinner_Scene]]\n- at [[Dinner_Scene|the "
                              "dinner]]\n- ![[Dinner_Scene]]\n"})
        p = links.plan_unlink(vault, ["Dinner_Scene"], ["People/Host.md"],
                              "the welcome dinner")
        self.assertEqual(p.texts["People/Host.md"],
                         "- the welcome dinner\n- at the dinner\n"
                         "- ![[Dinner_Scene]]\n")
        got = cli(vault, "unlink", "Dinner_Scene", "--as", "x")
        self.assertEqual(got.returncode, 2)
        self.assertIn("--as and --bare go with unlink --in", got.stderr)

    def test_as_words_with_a_pipe_stay_in_one_table_cell(self):
        vault = make_vault(self, {
            "Plans/Dinner_Scene.md": "The scene.\n",
            "People/Host.md": "| when | what |\n|---|---|\n"
                              "| noon | [[Dinner_Scene]] |\n\n"
                              "Then [[Dinner_Scene]].\n"})
        p = links.plan_unlink(vault, ["Dinner_Scene"], ["People/Host.md"],
                              "dinner | welcome")
        self.assertEqual(p.texts["People/Host.md"],
                         "| when | what |\n|---|---|\n"
                         "| noon | dinner \\| welcome |\n\n"
                         "Then dinner | welcome.\n")

    def test_as_words_with_a_pipe_stay_in_one_cell_of_a_row_with_no_leading_pipe(self):
        vault = make_vault(self, {
            "Plans/Dinner_Scene.md": "The scene.\n",
            "People/Host.md": "when | what | then\n---|---|---\n"
                              "noon | [[Dinner_Scene]] | next\n"})
        p = links.plan_unlink(vault, ["Dinner_Scene"], ["People/Host.md"],
                              "dinner | welcome")
        self.assertEqual(p.texts["People/Host.md"],
                         "when | what | then\n---|---|---\n"
                         "noon | dinner \\| welcome | next\n")

    def test_a_name_given_with_its_path_leaves_a_link_to_another_note_of_that_name(self):
        vault = make_vault(self, {
            "Plans/Scene.md": "x\n", "Other/Scene.md": "y\n",
            "People/Host.md": "At [[Plans/Scene]], not [[Other/Scene]], "
                              "nor [[Scene]], and [[Plans/Scene|the plan]].\n"})
        p = links.plan_unlink(vault, ["Plans/Scene"], ["People/Host.md"])
        # The bare link could be either note: it is left, and listed.
        self.assertEqual(p.texts["People/Host.md"],
                         "At Scene, not [[Other/Scene]], nor [[Scene]], "
                         "and the plan.\n")
        self.assertEqual([(k[2], k[3]) for k in p.kept],
                         [("[[Scene]]", "ambiguous")])
        # Every reason prints, whichever step gave it (#330).
        self.assertIn("KEPT\tPeople/Host.md:1\t[[Scene]]\t"
                      + links.KEPT["ambiguous"], links.rows(p))

    def test_two_notes_of_one_name_print_every_kind_of_link_left(self):
        vault = make_vault(self, {
            "Plans/Scene.md": "x\n", "Other/Scene.md": "y\n",
            "People/Host.md": "---\nseen_at: \"[[Scene]]\"\n---\n"
                              "At [[Scene]], [[Scene|the plan]] and "
                              "![[Scene]]; then [[Plans/Scene]].\n"})
        p = links.plan_unlink(vault, ["Plans/Scene"], ["People/Host.md"])
        self.assertEqual(p.texts["People/Host.md"].splitlines()[-1],
                         "At [[Scene]], [[Scene|the plan]] and "
                         "![[Scene]]; then Scene.")
        printed = links.rows(p)
        self.assertEqual(len([r for r in printed if r.startswith("KEPT")]),
                         len(p.kept))
        for _, _, _, why in p.kept:
            self.assertIn(why, links.KEPT)
        self.assertEqual(
            links.main([str(vault), "unlink", "Plans/Scene",
                        "--in", "People/Host.md"]), 0)

    def test_bare_turns_a_link_with_no_path_where_two_notes_share_the_name(self):
        vault = make_vault(self, {
            "Plans/Scene.md": "x\n", "Other/Scene.md": "y\n",
            "People/Host.md": "At [[Scene]], [[Scene|the plan]], "
                              "[[Other/Scene]] and [[Plans/Scene]].\n"})
        p = links.plan_unlink(vault, ["Plans/Scene"], ["People/Host.md"],
                              take_bare=True)
        # The link that names the other note by its path is never turned.
        self.assertEqual(p.texts["People/Host.md"],
                         "At Scene, the plan, [[Other/Scene]] and Scene.\n")
        self.assertEqual(p.kept, [])
        # A name two notes share still needs its path, with or without it.
        with self.assertRaises(links.LinksError):
            links.plan_unlink(vault, ["Scene"], ["People/Host.md"],
                              take_bare=True)
        self.assertEqual(
            links.main([str(vault), "unlink", "Plans/Scene", "--bare"]), 2)

    def test_a_bare_link_is_turned_when_it_can_only_be_the_note_named_by_path(self):
        vault = make_vault(self, {
            "Plans/Scene.md": "x\n",
            "People/Host.md": "At [[Scene]] and [[Plans/Scene]] and "
                              "[[Elsewhere/Scene]].\n"})
        p = links.plan_unlink(vault, ["Plans/Scene"], ["People/Host.md"])
        self.assertEqual(p.texts["People/Host.md"],
                         "At Scene and Scene and [[Elsewhere/Scene]].\n")
        # A bare name is the same one note here.
        q = links.plan_unlink(vault, ["Scene"], ["People/Host.md"])
        self.assertEqual(q.texts["People/Host.md"],
                         "At Scene and Scene and [[Elsewhere/Scene]].\n")

    def test_a_path_that_names_no_note_leaves_a_bare_link_to_the_note_that_is_there(self):
        vault = make_vault(self, {
            "Other/Scene.md": "y\n",
            "People/Host.md": "At [[Scene]] and [[Plans/Scene]].\n"})
        p = links.plan_unlink(vault, ["Plans/Scene"], ["People/Host.md"])
        self.assertEqual(p.texts["People/Host.md"],
                         "At [[Scene]] and Scene.\n")

    def test_a_bare_name_with_no_note_takes_its_links_whatever_folder_they_give(self):
        vault = make_vault(self, {
            "People/Host.md": "At [[Gone]] and [[Old/Gone]] and [[Old/Other]].\n"})
        p = links.plan_unlink(vault, ["Gone"], ["People/Host.md"])
        self.assertEqual(p.texts["People/Host.md"],
                         "At Gone and Gone and [[Old/Other]].\n")

    def test_a_bare_name_that_two_notes_share_is_refused(self):
        vault = make_vault(self, {
            "Plans/Scene.md": "x\n", "Other/Scene.md": "y\n",
            "People/Host.md": "At [[Plans/Scene]].\n"})
        with self.assertRaises(links.LinksError) as caught:
            links.plan_unlink(vault, ["Scene"], ["People/Host.md"])
        self.assertIn("give the path", str(caught.exception))

    def test_within_refuses_a_note_that_is_not_there(self):
        vault = make_vault(self, {"A.md": "[[B]]\n", "B.md": "x\n"})
        with self.assertRaises(links.LinksError) as cm:
            links.plan_unlink(vault, ["B"], ["Nope.md"])
        self.assertIn("there is no note Nope.md", str(cm.exception))

    def test_in_goes_with_unlink_only(self):
        vault = make_vault(self, {"A.md": "[[B]]\n", "B.md": "x\n"})
        got = cli(vault, "retarget", "B", "B.md", "--in", "A.md")
        self.assertEqual(got.returncode, 2)
        self.assertIn("--in goes with unlink", got.stderr)
        done = cli(vault, "unlink", "B", "--in", "A.md", "--write")
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(done.stdout.splitlines()[0],
                         "CHANGED\tA.md:1\t[[B]] -> B")

    def test_an_embed_is_kept(self):
        got, p = self.after("![[Judo]] and [[Judo]]")
        self.assertEqual(got, "![[Judo]] and Judo")
        self.assertEqual(p.kept, [("A.md", 1, "![[Judo]]", "embed")])

    def test_frontmatter_links_are_kept(self):
        vault = make_vault(self, {
            "A.md": '---\nskills: ["[[Judo]]"]\n---\n[[Judo]]\n'})
        p = links.plan_unlink(vault, ["Judo"])
        self.assertEqual(p.texts["A.md"], '---\nskills: ["[[Judo]]"]\n---\nJudo\n')
        self.assertEqual(p.kept, [("A.md", 2, "[[Judo]]", "frontmatter")])

    def test_a_note_that_is_only_frontmatter_is_kept_whole(self):
        vault = make_vault(self, {"A.md": '---\nskills: ["[[Judo]]"]\n---\n',
                                  "B.md": "[[Judo]]\n"})
        p = links.plan_unlink(vault, ["Judo"])
        self.assertEqual(sorted(p.texts), ["B.md"])
        self.assertEqual(p.kept, [("A.md", 2, "[[Judo]]", "frontmatter")])

    def test_unusual_frontmatter_is_still_frontmatter(self):
        vault = make_vault(self, {"A.md": (
            '---\ndescription: a long\n  wrapped value\nfoo bar baz\n'
            'skills: ["[[Judo]]"]\n---\n[[Judo]]\n')})
        p = links.plan_unlink(vault, ["Judo"])
        self.assertEqual(p.texts["A.md"], (
            '---\ndescription: a long\n  wrapped value\nfoo bar baz\n'
            'skills: ["[[Judo]]"]\n---\nJudo\n'))
        self.assertEqual(p.kept, [("A.md", 5, "[[Judo]]", "frontmatter")])

    def test_several_names_at_once(self):
        vault = make_vault(self, {"A.md": "[[Judo]], [[Signature Gear]]\n"})
        p = links.plan_unlink(vault, ["judo", "Signature_Gear"])
        self.assertEqual(p.texts["A.md"], "Judo, Signature Gear\n")

    def test_code_is_left_alone(self):
        got, _ = self.after("`[[Judo]]` [[Judo]]")
        self.assertEqual(got, "`[[Judo]]` Judo")

    def test_name_is_read_the_way_a_link_is_read(self):
        for name in ("Rules/Judo", "Judo#Rules", "Judo.md"):
            with self.subTest(name=name):
                vault = make_vault(self, {"A.md": "[[Judo]]\n"})
                p = links.plan_unlink(vault, [name])
                self.assertEqual(p.texts["A.md"], "Judo\n")

    def test_a_fix_covers_every_spelling_in_the_row(self):
        vault = make_vault(self, {"S1.md": "[[Bobs Bar]]\n",
                                  "S2.md": "[[Bob's Bar]]\n"})
        p = links.plan_unlink(vault, ["Bob's Bar"])
        self.assertEqual((p.texts["S1.md"], p.texts["S2.md"]),
                         ("Bobs Bar\n", "Bob's Bar\n"))

    def test_retarget_covers_every_spelling_in_the_row(self):
        vault = make_vault(self, {
            "Events/Eid.md": "x\n", "A.md": "[[Eid al-Fitr]]\n",
            "B.md": "[[Eid al Fitr]]\n", "C.md": "[[Eid al Fitr 2]]\n"})
        p = links.plan_retarget(vault, "Eid al-Fitr", "Events/Eid.md")
        self.assertEqual((p.texts["A.md"], p.texts["B.md"]),
                         ("[[Eid]]\n", "[[Eid]]\n"))
        self.assertNotIn("C.md", p.texts)

    def test_a_name_differing_only_by_number_is_not_touched(self):
        vault = make_vault(self, {"A.md": "[[Chapter 0.5]]\n",
                                  "B.md": "[[Chapter 05]]\n"})
        p = links.plan_unlink(vault, ["Chapter 0.5"])
        self.assertEqual(sorted(p.texts), ["A.md"])

    def test_a_name_that_resolves_is_refused(self):
        vault = make_vault(self, {"Real.md": "x\n", "A.md": "[[Real]] [[Judo]]\n"})
        with self.assertRaises(links.LinksError) as cm:
            links.plan_unlink(vault, ["Judo", "Real"])
        self.assertIn("Real is not a broken link", str(cm.exception))


class ApplyTests(unittest.TestCase):
    FILES = {NOTE: "x\n", "A.md": "[[Bara Bazaar]]\n", "B.md": "[[Bara Bazaar]]\n"}

    def test_preview_writes_nothing_and_write_writes(self):
        vault = make_vault(self, self.FILES)
        got = cli(vault, "retarget", "Bara Bazaar", NOTE)
        self.assertEqual(got.returncode, 0, got.stderr)
        self.assertEqual(got.stdout.splitlines(), [
            "WOULD-CHANGE\tA.md:1\t[[Bara Bazaar]] -> [[Barabazar]]",
            "WOULD-CHANGE\tB.md:1\t[[Bara Bazaar]] -> [[Barabazar]]",
            "# 2 link(s) in 2 note(s)"])
        self.assertEqual(read(vault, "A.md"), "[[Bara Bazaar]]\n")
        got = cli(vault, "retarget", "Bara Bazaar", NOTE, "--write")
        self.assertEqual(got.returncode, 0, got.stderr)
        self.assertEqual(got.stdout.splitlines()[0],
                         "CHANGED\tA.md:1\t[[Bara Bazaar]] -> [[Barabazar]]")
        self.assertEqual(read(vault, "B.md"), "[[Barabazar]]\n")
        self.assertEqual(cli(vault).stdout.splitlines()[0],
                         "# broken: 0 names in 0 notes; not checked: _QA, "
                         "_archive (0 names)")

    def test_unlink_cli_lists_what_it_kept(self):
        vault = make_vault(self, {
            "A.md": '---\nskills: ["[[Judo]]"]\n---\n[[Judo]] ![[Judo]]\n'})
        got = cli(vault, "unlink", "Judo", "--write")
        self.assertEqual(got.returncode, 0, got.stderr)
        self.assertEqual(got.stdout.splitlines(), [
            "CHANGED\tA.md:4\t[[Judo]] -> Judo",
            "KEPT\tA.md:2\t[[Judo]]\ta frontmatter link is relationship data;"
            " left as written",
            "KEPT\tA.md:4\t![[Judo]]\tan embed has no words to leave;"
            " left as written",
            "# 1 link(s) in 1 note(s), 2 left as written"])

    def test_a_refusal_is_one_line_and_exit_1(self):
        vault = make_vault(self, self.FILES)
        got = cli(vault, "retarget", "Nope", NOTE, "--write")
        self.assertEqual(got.returncode, 1)
        self.assertEqual(got.stderr.strip(),
                         "links.py: Nope is not a broken link: nothing links "
                         "to it, or a note already answers to it")

    def test_usage_errors_are_exit_2(self):
        vault = make_vault(self, self.FILES)
        for args in (["retarget", "Bara Bazaar"], ["unlink"],
                     ["--write"], ["--keep-text"],
                     ["unlink", "Bara Bazaar", "--keep-text"],
                     ["retarget", "Bara Bazaar", "Same"]):
            with self.subTest(args=args):
                extra = {"One/Same.md": "x\n", "Two/Same.md": "x\n"}
                for rel, text in extra.items():
                    (vault / rel).parent.mkdir(parents=True, exist_ok=True)
                    (vault / rel).write_bytes(text.encode())
                self.assertEqual(cli(vault, *args).returncode, 2)

    def test_a_failed_write_puts_every_note_back(self):
        vault = make_vault(self, self.FILES)
        p = links.plan_retarget(vault, "Bara Bazaar", NOTE)
        real, calls = links.write_text_atomic, []

        def flaky(path, text):
            calls.append(path.name)
            if path.name == "B.md" and calls.count("B.md") == 1:
                raise links.StepFailed("B.md cannot be written")
            real(path, text)

        with mock.patch.object(links, "write_text_atomic", flaky):
            with self.assertRaises(links.LinksError) as cm:
                links.apply(p)
        self.assertIn("B.md cannot be written; the vault is as it was",
                      str(cm.exception))
        self.assertEqual(read(vault, "A.md"), "[[Bara Bazaar]]\n")
        self.assertEqual(read(vault, "B.md"), "[[Bara Bazaar]]\n")

    def test_rollback_leaves_a_note_something_else_edited(self):
        vault = make_vault(self, self.FILES)
        p = links.plan_retarget(vault, "Bara Bazaar", NOTE)
        real = links.write_text_atomic

        def flaky(path, text):
            if path.name == "B.md":
                # Another editor saves A.md after this run rewrote it.
                (vault / "A.md").write_bytes(b"synced edit\n")
                raise links.StepFailed("B.md cannot be written")
            real(path, text)

        with mock.patch.object(links, "write_text_atomic", flaky):
            with self.assertRaises(links.LinksError) as cm:
                links.apply(p)
        self.assertIn("A.md", str(cm.exception))
        self.assertIn("changed by something else", str(cm.exception))
        self.assertNotIn("the vault is as it was", str(cm.exception))
        self.assertEqual(read(vault, "A.md"), "synced edit\n")
        self.assertEqual(read(vault, "B.md"), "[[Bara Bazaar]]\n")

    def test_an_interrupt_puts_every_note_back(self):
        vault = make_vault(self, self.FILES)
        p = links.plan_retarget(vault, "Bara Bazaar", NOTE)
        real = links.write_text_atomic

        def stop(path, text):
            if path.name == "B.md" and text != p.originals["B.md"]:
                raise KeyboardInterrupt
            real(path, text)

        with mock.patch.object(links, "write_text_atomic", stop):
            with self.assertRaises(KeyboardInterrupt) as cm:
                links.apply(p)
        self.assertIn("the vault is as it was", str(cm.exception))
        self.assertEqual(read(vault, "A.md"), "[[Bara Bazaar]]\n")

    def test_a_note_changed_since_the_plan_is_refused(self):
        vault = make_vault(self, self.FILES)
        p = links.plan_retarget(vault, "Bara Bazaar", NOTE)
        (vault / "B.md").write_bytes(b"[[Bara Bazaar]] edited\n")
        with self.assertRaises(links.LinksError) as cm:
            links.apply(p)
        self.assertIn("B.md changed", str(cm.exception))
        self.assertEqual(read(vault, "A.md"), "[[Bara Bazaar]]\n")
        self.assertEqual(read(vault, "B.md"), "[[Bara Bazaar]] edited\n")

    def test_a_non_utf8_note_holding_the_link_refuses_the_fix(self):
        vault = make_vault(self, self.FILES)
        (vault / "C.md").write_bytes(b"[[Bara Bazaar]] \xff\n")
        with self.assertRaises(links.LinksError) as cm:
            links.plan_retarget(vault, "Bara Bazaar", NOTE)
        self.assertIn("C.md is not valid UTF-8 and links to Bara Bazaar",
                      str(cm.exception))
        got = cli(vault, "retarget", "Bara Bazaar", NOTE, "--write")
        self.assertEqual(got.returncode, 1)
        self.assertEqual(read(vault, "A.md"), "[[Bara Bazaar]]\n")

    def test_a_non_utf8_note_without_the_link_is_ignored(self):
        vault = make_vault(self, self.FILES)
        (vault / "C.md").write_bytes(b"[[Elsewhere]] \xff\n")
        p = links.plan_retarget(vault, "Bara Bazaar", NOTE)
        self.assertEqual(sorted(p.texts), ["A.md", "B.md"])

    def test_a_note_that_was_never_written_is_not_reported_stuck(self):
        vault = make_vault(self, self.FILES)
        p = links.plan_retarget(vault, "Bara Bazaar", NOTE)
        real = links.write_text_atomic

        def refuse_b(path, text):
            if path.name == "B.md":
                raise links.StepFailed("B.md cannot be written")
            real(path, text)

        with mock.patch.object(links, "write_text_atomic", refuse_b):
            with self.assertRaises(links.LinksError) as cm:
                links.apply(p)
        self.assertTrue(str(cm.exception).endswith("the vault is as it was"),
                        str(cm.exception))
        self.assertNotIn("could not be put back", str(cm.exception))
        self.assertEqual(read(vault, "A.md"), "[[Bara Bazaar]]\n")


if __name__ == "__main__":
    unittest.main()
