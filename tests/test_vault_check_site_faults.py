#!/usr/bin/env python3
"""`vault_check.py VAULT site-faults`: the faults in a vault's notes that
change what its site shows, asked of the site's own publish tool.

The rules are the tool's (`doctor --site --json`, tools/publish/lib/
note-faults.js) and are tested there. These tests pin what the Python side
adds: which tool is asked and about which vault, the rows it prints, what
it says of a vault with no site, of a tool from before these findings, and
of an audit that stopped on an error, and that an answer larger than a
pipe's buffer is read whole.

Run: python3 tests/test_vault_check_site_faults.py
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "skills" / "shared" / "scripts"
SCRIPT = SCRIPTS / "vault_check.py"
TOOL_DIR = ROOT / "tools" / "publish"
sys.path.insert(0, str(SCRIPTS))

import vault_check as vc  # noqa: E402


def npc(body="", extra=""):
    return f"---\ntype: npc\n{extra}---\n\n{body}\n"


def make(case, files, excluded=(), tool="real", site_json=None, site=True,
         system=None):
    """A vault and its site. `files` maps vault paths to text; every note
    not in `excluded` ("path" or "path — reason") is listed under
    publishing. `tool`: "real" installs the repo's publish tool in the
    site, any other string is the text of a stand-in gm-publish.js."""
    root = Path(tempfile.mkdtemp(prefix="vc-site-faults-"))
    case.addCleanup(shutil.rmtree, root, ignore_errors=True)
    vc.use_publish_tool(vc.PUBLISH_TOOL)
    vault, site_dir = root / "vault", root / "site"
    for rel, text in files.items():
        (vault / rel).parent.mkdir(parents=True, exist_ok=True)
        (vault / rel).write_text(text, encoding="utf-8")
    (vault / "_meta").mkdir(parents=True, exist_ok=True)
    hidden = {e.split(" — ")[0] for e in excluded}
    listed = [rel for rel in files if rel not in hidden]
    entries = [(e.split(" — ", 1) + [None])[:2] for e in excluded]
    (vault / "_meta" / "publish-list.yaml").write_text("\n".join([
        "publishing:" if listed else "publishing: []",
        *[f"  - {json.dumps(rel)}" for rel in listed],
        "excluded:" if entries else "excluded: []",
        *[line for rel, why in entries for line in (
            [f"  - path: {json.dumps(rel)}"]
            + ([f"    reason: {json.dumps(why)}"] if why else []))],
        "needs_decision: []", ""]), encoding="utf-8")
    if not site:
        return vault, site_dir
    site_dir.mkdir()
    (vault / "_meta" / "vault-config.md").write_text(
        "---\npublish:\n  site: true\n"
        + (f"  system: {system}\n" if system else "") +
        f"  site_dir: {site_dir.as_posix()}\n  folder_map:\n"
        "    Characters: characters\n---\n", encoding="utf-8")
    # The site file names another vault: the one asked about must be the
    # vault the check was given.
    other = root / "other"
    other.mkdir()
    (site_dir / "vault.config.json").write_text(
        site_json if site_json is not None else json.dumps(
            {"vaultPath": other.as_posix(), "outputDir": "./docs"}),
        encoding="utf-8")
    (site_dir / "node_modules").mkdir()
    installed = site_dir / "node_modules" / "gm-apprentice-publish"
    if tool == "real":
        os.symlink(TOOL_DIR, installed, target_is_directory=True)
    else:
        (installed / "bin").mkdir(parents=True)
        (installed / "bin" / "gm-publish.js").write_text(tool,
                                                         encoding="utf-8")
    return vault, site_dir


MARA = "Characters/Mara_Quill.md"
VESPER = "Characters/Vesper_Hale.md"
ZORN = "Characters/Lord_Zorn.md"


def findings(rows):
    return [r for r in rows if not r.startswith("INFO\t")]


class SiteFaultRowsTests(unittest.TestCase):
    def test_a_vault_with_no_site_gets_one_row_saying_so(self):
        vault, _site = make(self, {MARA: npc("She met [[Vesper_Hale]].")},
                            site=False)
        rows = vc.check_site_faults(vault)
        self.assertEqual(len(rows), 1, rows)
        self.assertTrue(rows[0].startswith(
            "INFO\t(vault)\tsite-faults has no site to check"), rows)

    def test_a_named_note_with_no_page_is_a_row_with_the_tools_facts(self):
        vault, site = make(self, {
            MARA: npc("She met [[Vesper_Hale|the ferryman]] at the quay."),
            VESPER: npc("He runs the ferry for the cult.")},
            excluded=[f"{VESPER} — page body reveals the ferry"])
        rows = vc.check_site_faults(vault)
        self.assertEqual(findings(rows), [
            f"WARNING\t{VESPER}\tNAMED_NO_PAGE: entity (npc), named on 1 "
            f"published page as \"the ferryman\"; no page because "
            f"MANIFEST_EXCLUDED; reason written: page body reveals the "
            f"ferry; named on: {MARA}"])
        # The first row names the tool that answered and the site file.
        self.assertEqual(rows[0].split("\t")[:2], ["INFO", "(site)"])
        self.assertIn(str(site / "vault.config.json"), rows[0])
        self.assertIn("gm-publish.js", rows[0])
        # And the vault that was audited: a fix command acts on that one.
        self.assertTrue(rows[0].endswith(
            f'<command> --config "{site / "vault.config.json"}" '
            f'--vault "{vault.resolve()}"'), rows[0])

    def test_a_vault_file_the_tool_refused_stops_the_check_in_one_line(self):
        vault, _site = make(self, {MARA: npc("x")}, site=False)
        # The file is not valid YAML further down: the settings cannot be
        # read, and nothing is guessed from the lines that can.
        (vault / "_meta" / "vault-config.md").write_text(
            "---\npublish:\n  site: false\n  theme: [unclosed\n---\n",
            encoding="utf-8")
        with self.assertRaises(vc.SettingsUnavailable) as caught:
            vc.check_site_faults(vault)
        self.assertIn("_meta/vault-config.md frontmatter is not valid YAML",
                      str(caught.exception))
        self.assertNotIn("\n", str(caught.exception))

    def test_a_row_says_which_pages_only_an_index_page_prints_from(self):
        row = vc._site_fault_row({
            "code": "NAMED_NO_PAGE", "severity": "warning",
            "path": "Clues/Old_Tam.md", "kind": "entity", "type": "clue",
            "pages": [MARA, "Characters/Bo_Pike.md"], "pageCount": 2,
            "printed": ["Old Tam"], "why": "MANIFEST_EXCLUDED",
            "reason": None, "viaListing": ["Characters/Bo_Pike.md"],
            "listings": ["characters/npcs/index.html"]}, whole=False)
        self.assertTrue(row.endswith(
            f"named on: {MARA}; Characters/Bo_Pike.md; printed only by an "
            f"index or listing page (characters/npcs/index.html) from: "
            f"Characters/Bo_Pike.md"), row)
        plain = vc._site_fault_row({
            "code": "NAMED_NO_PAGE", "severity": "warning",
            "path": "Clues/Old_Tam.md", "kind": "entity", "type": "clue",
            "pages": [MARA], "pageCount": 1, "printed": ["Old Tam"],
            "why": "MANIFEST_EXCLUDED", "reason": None, "viaListing": [],
            "listings": ["characters/npcs/index.html"]}, whole=False)
        self.assertTrue(plain.endswith(f"named on: {MARA}"), plain)
        alias = vc._site_fault_row({
            "code": "ALIAS_IN_PROSE", "severity": "warning", "path": MARA,
            "alias": "Old Smuggler", "owner": VESPER, "count": 1,
            "context": "Kin of the old smuggler",
            "listings": ["characters/npcs/index.html"]}, whole=False)
        self.assertTrue(alias.endswith(
            "| Kin of the old smuggler | printed on the index or listing "
            "page: characters/npcs/index.html"), alias)

    def test_the_other_three_faults_each_get_a_row(self):
        vault, _site = make(self, {
            MARA: npc("Paid 100%% now, 50%% later.\n\n"
                      "The old smuggler waved.\n\n"
                      "```\ncode\n\n<!-- gm-only -->\nsecret\n"
                      "<!-- /gm-only -->"),
            VESPER: npc("A ferryman.", "gm_aliases: [Old Smuggler]\n")})
        rows = findings(vc.check_site_faults(vault))
        by_code = {r.split("\t")[2].split(":")[0]: r for r in rows}
        self.assertEqual(sorted(by_code), [
            "ALIAS_IN_PROSE", "COMMENT_STRAY", "FENCE_UNCLOSED"], rows)
        self.assertTrue(all(r.split("\t")[1] == MARA for r in rows), rows)
        self.assertIn("COMMENT_STRAY: a %% on line 5 comes straight after a "
                      "number", by_code["COMMENT_STRAY"])
        self.assertTrue(by_code["COMMENT_STRAY"].endswith(
            "| Paid 100%% now, 50%% later."), rows)
        self.assertIn(f"\"Old Smuggler\" (a secret name of {VESPER}), "
                      f"printed 1 time | The old smuggler waved.",
                      by_code["ALIAS_IN_PROSE"])
        self.assertIn("FENCE_UNCLOSED: the code fence on line 9 never "
                      "closes", by_code["FENCE_UNCLOSED"])

    def test_a_never_show_word_is_a_row(self):
        row = vc._site_fault_row({
            "code": "NEVER_SHOW_IN_PROSE", "severity": "warning",
            "path": MARA, "word": "Blue Lady", "owner": None, "count": 2,
            "context": "Bob saw the blue lady", "listings": []},
            whole=False)
        self.assertEqual(row, (
            f"WARNING\t{MARA}\tNEVER_SHOW_IN_PROSE: \"Blue Lady\" (listed "
            f"under player_site.never_show), printed 2 times | Bob saw the "
            f"blue lady"))

    def test_a_sheet_row_the_to_hit_calculator_cannot_read_is_a_row(self):
        # The tool's own words: what is wrong, then the fix.
        row = vc._site_fault_row({
            "code": "TOHIT_UNREAD", "severity": "warning",
            "path": "Characters/PCs/Six.md",
            "detail": "to-hit calculator: Melee Attacks row \"Knife\": its "
                      "Skill cell names the attribute DX, not a skill",
            "fix": "name the weapon's skill at its default level"}, whole=False)
        self.assertEqual(row, (
            "WARNING\tCharacters/PCs/Six.md\tTOHIT_UNREAD: to-hit "
            "calculator: Melee Attacks row \"Knife\": its Skill cell names "
            "the attribute DX, not a skill — name the weapon's skill at its "
            "default level"))
        info = vc._site_fault_row({
            "code": "TOHIT_UNREAD", "severity": "info", "path": "a.md",
            "detail": "d", "fix": "f"}, whole=False)
        self.assertEqual(info, "INFO\ta.md\tTOHIT_UNREAD: d — f")
        self.assertIn("TOHIT_UNREAD", vc.NOTE_FAULT_CODES)

    def test_the_real_tool_reports_a_sheet_row_the_calculator_cannot_read(self):
        pc = ("---\ntype: pc\nstatus: alive\n---\n\n## Skills\n\n"
              "| Name | Difficulty | Relative Level | Points | Effective |\n"
              "|---|---|---|---|---|\n| Knife | DX/E | DX+0 | [1] | 12 |\n\n"
              "## Melee Weapons\n\n| Weapon | Skill | Damage | Reach | Parry |\n"
              "|---|---|---|---|---|\n| Utility knife | DX-12 (default) | 1d-3 imp | C | 8 |\n"
              "| Dagger | Knife-12 | 1d-3 imp | C | 8 |\n")
        vault, _site = make(self, {"Characters/Ann_Vole.md": pc},
                            system="gurps-4e")
        rows = [r for r in findings(vc.check_site_faults(vault))
                if "TOHIT_UNREAD" in r]
        self.assertTrue(any(
            r.startswith("WARNING\tCharacters/Ann_Vole.md\tTOHIT_UNREAD: "
                         "to-hit calculator: Melee Attacks row \"Utility "
                         "knife\": its Skill cell names the attribute DX")
            and "— name the weapon's skill at its default level" in r
            for r in rows), rows)

    def test_a_coc_skill_below_its_worked_out_base_is_a_row(self):
        # The tool works the base out from the characteristics; Python only
        # carries the tool's words.
        pc = ("---\ntype: pc\nstatus: alive\n---\n\n## Stat Sheet\n\n"
              "### Characteristics\n\n| Characteristic | Regular | Half | Fifth |\n"
              "|---|---|---|---|\n| DEX | 70 | 35 | 14 |\n\n"
              "## Skills\n\n| Skill | Base | Regular | Half | Fifth |\n"
              "|---|---|---|---|---|\n| Dancing | 05 | 10 | 5 | 2 |\n")
        vault, _site = make(self, {"Characters/Ann_Vole.md": pc},
                            system="coc-7e-regency")
        rows = [r for r in vc.check_site_faults(vault)
                if "SKILL_BELOW_BASE" in r]
        self.assertEqual(len(rows), 1, rows)
        self.assertTrue(rows[0].startswith(
            "INFO\tCharacters/Ann_Vole.md\tSKILL_BELOW_BASE: Dancing is "
            "written as 10, below its base of 14"), rows)
        self.assertIn("— raise Dancing to 14 in the Regular column, or "
                      "leave it as written", rows[0])
        self.assertIn("SKILL_BELOW_BASE", vc.NOTE_FAULT_CODES)

    def test_a_hidden_heading_inside_a_hidden_block_is_a_row(self):
        # #447: the tool withholds the text after the block and says so;
        # Python only carries the tool's words.
        body = ("## Appearance\nTall.\n%% working note\n## GM Notes\n%%\n"
                "She is the informant.\n")
        vault, _site = make(self, {MARA: npc(body)})
        rows = [r for r in vc.check_site_faults(vault)
                if "HEADING_IN_HIDDEN_BLOCK" in r]
        self.assertEqual(len(rows), 1, rows)
        self.assertTrue(rows[0].startswith(
            f"INFO\t{MARA}\tHEADING_IN_HIDDEN_BLOCK: the heading \"GM Notes\" "
            "is inside a hidden block"), rows)
        self.assertIn("— move the heading out of the hidden block", rows[0])
        self.assertIn("HEADING_IN_HIDDEN_BLOCK", vc.NOTE_FAULT_CODES)

    def test_a_table_wider_than_its_header_is_a_row(self):
        # #470: the site widens the table; Python only carries the tool's words.
        body = ("## Notes\n\n| Item | Value |\n| --- | --- |\n"
                "| Sword | 5 | tacked-on remark |\n")
        vault, _site = make(self, {MARA: npc(body)})
        rows = [r for r in vc.check_site_faults(vault)
                if "TABLE_OVERWIDE" in r]
        self.assertEqual(len(rows), 1, rows)
        self.assertTrue(rows[0].startswith(
            f"INFO\t{MARA}\tTABLE_OVERWIDE: a table has 1 row with more "
            "cells than its 2-column header"), rows)
        self.assertIn("— Add header cells for the extra columns", rows[0])
        self.assertIn("TABLE_OVERWIDE", vc.NOTE_FAULT_CODES)

    def test_a_withheld_name_printed_on_a_page_is_a_row(self):
        vault, _site = make(self, {
            MARA: npc("Lord Zorn rides at dawn."),
            ZORN: npc("The duke.", "withheld: true\n")}, excluded=[ZORN])
        rows = findings(vc.check_site_faults(vault))
        self.assertEqual(rows, [
            f"WARNING\t{MARA}\tWITHHELD_IN_PROSE: \"Lord Zorn\" (a withheld "
            f"note: {ZORN}), printed 1 time | Lord Zorn rides at dawn."])

    def test_a_withheld_everyday_word_row_carries_the_rename_fix(self):
        # #454: the tool decides the name is an everyday word (one word, on
        # the page in lower case) and says to rename the note; the row
        # carries its words. Any other row of the code stays as it was.
        human = "Heritages/Human.md"
        vault, _site = make(self, {
            MARA: npc("Mara is human."),
            human: npc("Clones.", "withheld: true\n")}, excluded=[human])
        rows = findings(vc.check_site_faults(vault))
        self.assertEqual(len(rows), 1, rows)
        self.assertTrue(rows[0].startswith(
            f"WARNING\t{MARA}\tWITHHELD_IN_PROSE: \"Human\" (a withheld note: "
            f"{human}), printed 1 time | Mara is human. — \"Human\" is an "
            f"everyday word"), rows)
        self.assertIn(f"rename the note ({human})", rows[0])

    def test_a_withheld_note_that_publishes_is_an_error_row_that_does_not_stop_the_audit(self):
        vault, _site = make(self, {
            MARA: npc("She met [[Vesper_Hale]]."),
            ZORN: npc("The duke.", "withheld: true\n"),
            VESPER: npc("A ferryman.")}, excluded=[VESPER])
        rows = findings(vc.check_site_faults(vault))
        self.assertEqual([r.split("\t")[:2] for r in rows],
                         [["ERROR", ZORN], ["WARNING", VESPER]], rows)
        self.assertIn("WITHHELD_PUBLISHED: is marked withheld and is being "
                      "published: page characters/lord-zorn.html", rows[0])
        self.assertIn("remove withheld", rows[0])
        self.assertFalse(any("audit stopped" in r for r in rows), rows)

    def test_a_withheld_name_that_another_published_page_answers_to_is_a_row(self):
        vault, _site = make(self, {
            MARA: npc("Mara Quill walks."),
            ZORN: npc("The duke.", "withheld: true\naliases: [Mara Quill]\n")},
            excluded=[ZORN])
        rows = findings(vc.check_site_faults(vault))
        self.assertEqual(len(rows), 1, rows)
        self.assertTrue(rows[0].startswith(
            f"WARNING\t{ZORN}\tWITHHELD_NAME_PUBLIC: "), rows)
        self.assertIn("take withheld: true off", rows[0])

    def test_a_withheld_flag_that_cannot_be_read_is_a_row(self):
        vault, _site = make(self, {
            MARA: npc("Plain."),
            ZORN: npc("The duke.", "withheld: tru\n")}, excluded=[ZORN])
        rows = findings(vc.check_site_faults(vault))
        self.assertEqual(rows, [
            f"WARNING\t{ZORN}\tWITHHELD_FLAG_UNREADABLE: withheld: tru is not "
            f"true or false, so the note is read as not withheld — write "
            f"withheld: true or false"])

    def test_a_link_to_a_withheld_note_is_an_error_row_that_does_not_stop_the_audit(self):
        vault, _site = make(self, {
            MARA: npc("She met [[Lord_Zorn]] and [[Vesper_Hale]]."),
            ZORN: npc("The duke.", "withheld: true\n"),
            VESPER: npc("A ferryman.")}, excluded=[ZORN, VESPER])
        rows = findings(vc.check_site_faults(vault))
        self.assertEqual([r.split("\t")[:2] for r in rows], [
            ["ERROR", ZORN], ["WARNING", VESPER]], rows)
        self.assertIn("NAMED_NO_PAGE: withheld entity (npc), named on 1",
                      rows[0])
        self.assertIn("as \"someone\"", rows[0])
        self.assertFalse(any("audit stopped" in r for r in rows), rows)

    def test_a_withheld_name_in_text_cannot_be_settled(self):
        vault, _site = make(self, {
            MARA: npc("Lord Zorn rides at dawn."),
            ZORN: npc("The duke.", "withheld: true\n")},
            excluded=[f"{ZORN} — stays hidden: Zorn is also a town"])
        rows = vc.check_site_faults(vault)
        listed = [r for r in findings(rows) if "WITHHELD_IN_PROSE" in r]
        self.assertEqual(len(listed), 1, rows)
        self.assertFalse(any("settled" in r for r in rows), rows)

    def test_stays_hidden_settles_the_link_report_of_a_withheld_note(self):
        vault, _site = make(self, {
            MARA: npc("She met [[Lord_Zorn]]."),
            ZORN: npc("The duke.", "withheld: true\n")},
            excluded=[f"{ZORN} — stays hidden: the neutral word will do"])
        rows = vc.check_site_faults(vault)
        self.assertEqual(findings(rows), [])
        self.assertEqual(rows[-1], "INFO\t(vault)\t1 note is settled as "
                                   "\"stays hidden\" and not raised")

    def test_a_settled_note_is_counted_and_not_listed(self):
        vault, _site = make(self, {
            MARA: npc("She met [[Vesper_Hale]] and [[Old_Tam]]."),
            VESPER: npc("x"), "Characters/Old_Tam.md": npc("y")},
            excluded=[f"{VESPER} — stays hidden: the twist",
                      "Characters/Old_Tam.md"])
        rows = vc.check_site_faults(vault)
        self.assertEqual([r.split("\t")[1] for r in findings(rows)],
                         ["Characters/Old_Tam.md"])
        self.assertEqual(rows[-1], "INFO\t(vault)\t1 note is settled as "
                                   "\"stays hidden\" and not raised")

    def test_a_clean_site_has_no_rows(self):
        vault, _site = make(self, {MARA: npc("Nobody else is named.")})
        self.assertEqual(vc.check_site_faults(vault), [])

    def test_a_row_names_three_pages_and_file_scope_names_them_all(self):
        files = {VESPER: npc("x"), "Characters/Old_Tam.md": npc("y")}
        for i in range(5):
            files[f"Characters/Page_{i}.md"] = npc(
                "Saw [[Vesper_Hale]] and [[Old_Tam]].")
        vault, _site = make(self, files,
                            excluded=[VESPER, "Characters/Old_Tam.md"])
        rows = findings(vc.check_site_faults(vault))
        self.assertEqual(len(rows), 2, rows)
        self.assertTrue(rows[1].endswith(
            "named on: Characters/Page_0.md; Characters/Page_1.md; "
            "Characters/Page_2.md; +2 more (--file lists them all)"), rows)
        scoped = findings(vc.check_site_faults(vault, [VESPER]))
        self.assertEqual([r.split("\t")[1] for r in scoped], [VESPER])
        self.assertTrue(scoped[0].endswith(
            "; ".join(f"Characters/Page_{i}.md" for i in range(5))), scoped)

    def test_an_answer_larger_than_a_pipe_buffer_is_read_whole(self):
        # #279: a tool that exited before its output drained was cut off at
        # 64 KB when read through a pipe.
        names = [f"Ghost_{i:03d}_with_a_long_name_to_fill_the_answer"
                 for i in range(400)]
        files = {f"Characters/{n}.md": npc("x") for n in names}
        files[MARA] = npc(" ".join(f"[[{n}]]" for n in names))
        vault, site = make(self, files,
                           excluded=[f"Characters/{n}.md" for n in names])
        # One doctor run: the check's own, watched for how much it printed.
        sizes = []
        real = subprocess.run

        def watch(cmd, *args, **kwargs):
            done = real(cmd, *args, **kwargs)
            if "doctor" in cmd:
                sizes.append(len(done.stdout or ""))
            return done

        with mock.patch.object(vc.subprocess, "run", watch):
            rows = findings(vc.check_site_faults(vault))
        self.assertEqual(len(sizes), 1, sizes)
        self.assertGreater(sizes[0], 2 * 65536)
        self.assertEqual(len(rows), 400)


class SiteFaultsUnansweredTests(unittest.TestCase):
    FILES = {MARA: npc("She met [[Vesper_Hale]]."), VESPER: npc("x")}

    def test_a_tool_from_before_these_findings_is_not_a_clean_site(self):
        # Its audit answers, without `counts.settled` and without the codes.
        old = ("console.log(JSON.stringify({ok: true, findings: [], "
               "counts: {errors: 0, warnings: 0, total: 0}}));\n")
        vault, _site = make(self, self.FILES, excluded=[VESPER], tool=old)
        rows = vc.check_site_faults(vault)
        self.assertEqual(len(rows), 1, rows)
        self.assertTrue(rows[0].startswith(
            "INFO\t(vault)\tsite-faults not run: the publish tool this site "
            "builds with is from before this check"), rows)
        self.assertIn("the vault migration brings the site's tool up to date",
                      rows[0])

    def test_a_tool_with_no_site_audit_at_all_is_the_same_row(self):
        # Before `doctor --site` the flag was ignored and the machine
        # preflight answered.
        older = "console.log(JSON.stringify({ok: true, node: {ok: true}}));\n"
        vault, _site = make(self, self.FILES, excluded=[VESPER], tool=older)
        rows = vc.check_site_faults(vault)
        self.assertEqual(len(rows), 1, rows)
        self.assertIn("site-faults not run", rows[0])

    def test_a_tool_that_prints_no_json_is_the_same_row(self):
        vault, _site = make(self, self.FILES, excluded=[VESPER],
                            tool="process.exit(1);\n")
        rows = vc.check_site_faults(vault)
        self.assertEqual(len(rows), 1, rows)
        self.assertIn("site-faults not run", rows[0])

    def test_an_audit_that_stops_on_an_error_says_so(self):
        vault, _site = make(self, self.FILES, excluded=[VESPER],
                            site_json="{ not json")
        rows = vc.check_site_faults(vault)
        self.assertEqual([r.split("\t")[0] for r in rows], ["ERROR", "ERROR"])
        self.assertIn("CONFIG_INVALID", rows[0])
        self.assertIn("nothing else checked", rows[1])

    def test_a_site_whose_tool_is_not_installed_is_an_error_row(self):
        vault, site = make(self, self.FILES, excluded=[VESPER])
        os.unlink(site / "node_modules" / "gm-apprentice-publish")
        (site / "package.json").write_text(json.dumps(
            {"dependencies": {"gm-apprentice-publish": "file:../x"}}),
            encoding="utf-8")
        rows = vc.check_site_faults(vault)
        self.assertEqual(len(rows), 1, rows)
        self.assertTrue(rows[0].startswith(
            "ERROR\t(vault)\tsite-faults could not ask the publish tool"),
            rows)
        self.assertIn("nothing checked", rows[0])


class SiteFaultsCliTests(unittest.TestCase):
    def run_cli(self, vault, *args):
        return subprocess.run(
            [sys.executable, str(SCRIPT), str(vault), *args],
            capture_output=True, text=True, check=False)

    def test_the_command_prints_its_rows_and_stays_out_of_all(self):
        vault, _site = make(self, {
            MARA: npc("She met [[Vesper_Hale]]."), VESPER: npc("x")},
            excluded=[VESPER])
        done = self.run_cli(vault, "site-faults")
        self.assertEqual(done.returncode, 0, done.stderr)
        lines = done.stdout.splitlines()
        self.assertEqual(lines[:2], ["## site-faults", "# count: 2"])
        self.assertIn("NAMED_NO_PAGE", lines[3])
        everything = self.run_cli(vault, "all")
        self.assertNotIn("site-faults", everything.stdout)
        self.assertNotIn("NAMED_NO_PAGE", everything.stdout)

    def test_file_scope_takes_a_note_of_the_vault_only(self):
        vault, _site = make(self, {MARA: npc("x")})
        done = self.run_cli(vault, "site-faults", "--file", "Nope.md")
        self.assertEqual(done.returncode, 2)
        self.assertIn("--file not found in vault", done.stderr)


if __name__ == "__main__":
    unittest.main()
