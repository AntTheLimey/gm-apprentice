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
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "skills" / "shared" / "scripts"
SCRIPT = SCRIPTS / "vault_check.py"
TOOL_DIR = ROOT / "tools" / "publish"
sys.path.insert(0, str(SCRIPTS))

import vault_check as vc  # noqa: E402


def npc(body="", extra=""):
    return f"---\ntype: npc\n{extra}---\n\n{body}\n"


def make(case, files, excluded=(), tool="real", site_json=None, site=True):
    """A vault and its site. `files` maps vault paths to text; every note
    not in `excluded` ("path" or "path — reason") is listed under
    Publishing. `tool`: "real" installs the repo's publish tool in the
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
    (vault / "_meta" / "publish-manifest.md").write_text("\n".join([
        "---", "mode: player", "---", "",
        f"## Publishing ({len(listed)} files)", "",
        *[f"- [x] {rel}" for rel in listed], "",
        f"## Excluded ({len(excluded)} files)", "",
        *[f"- [x] {e}" for e in excluded], ""]), encoding="utf-8")
    if not site:
        return vault, site_dir
    site_dir.mkdir()
    (vault / "_meta" / "vault-config.md").write_text(
        "---\npublish:\n  mode: player\n  site: true\n"
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

    def test_a_vault_file_the_tool_refused_is_said_with_its_fix_not_as_a_site_that_is_off(self):
        vault, _site = make(self, {MARA: npc("x")}, site=False)
        # The switch reads off, and the file is not valid YAML further down.
        (vault / "_meta" / "vault-config.md").write_text(
            "---\npublish:\n  site: false\n  theme: [unclosed\n---\n",
            encoding="utf-8")
        rows = vc.check_site_faults(vault)
        self.assertEqual(len(rows), 1, rows)
        self.assertTrue(rows[0].startswith(
            "INFO\t(vault)\tsite-faults has no site to check (the publish "
            "tool refused"), rows)
        self.assertIn("; fix _meta/vault-config.md", rows[0])
        self.assertNotIn("publish.site is not on", rows[0])

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

    def test_a_withheld_name_printed_on_a_page_is_a_row(self):
        vault, _site = make(self, {
            MARA: npc("Lord Zorn rides at dawn."),
            ZORN: npc("The duke.", "withheld: true\n")}, excluded=[ZORN])
        rows = findings(vc.check_site_faults(vault))
        self.assertEqual(rows, [
            f"WARNING\t{MARA}\tWITHHELD_IN_PROSE: \"Lord Zorn\" (a withheld "
            f"note: {ZORN}), printed 2 times | Lord Zorn rides at dawn."])

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
        raw = subprocess.run(
            ["node", str(TOOL_DIR / "bin" / "gm-publish.js"), "doctor",
             "--site", "--json", "--config", str(site / "vault.config.json"),
             "--vault", str(vault)], capture_output=True, check=False).stdout
        self.assertGreater(len(raw), 2 * 65536)
        self.assertEqual(len(findings(vc.check_site_faults(vault))), 400)


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
